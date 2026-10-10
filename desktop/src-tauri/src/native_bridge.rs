use crate::db::Result;
use serde_json::{json, Value};
use std::{collections::HashMap, io::{Read, Write}, path::Path, process::{Child,ChildStdin,Command,Stdio}, sync::{Arc,Mutex}};
use tauri::ipc::Channel;

const MAX_INPUT: usize = 12 * 1024 * 1024;
const MAX_OUTPUT: usize = 1024 * 1024;

struct Session { child: Child, input: ChildStdin }
#[derive(Default)]
pub struct NativeBridge { sessions: Arc<Mutex<HashMap<String,Session>>> }

impl NativeBridge {
    pub fn connect(&self, host: &Path, channel: Channel<Value>) -> Result<String> {
        if !host.is_file() { return Err("未找到随应用提供的 Codex 桥接程序".into()); }
        let mut command = Command::new(host);
        command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        #[cfg(windows)] {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let mut child = command.spawn().map_err(|e| format!("无法启动 Codex 桥接：{e}"))?;
        let input = child.stdin.take().ok_or("无法打开 Codex 桥接输入")?;
        let mut output = child.stdout.take().ok_or("无法打开 Codex 桥接输出")?;
        let id = uuid::Uuid::new_v4().to_string();
        {
            let mut sessions = self.sessions.lock().map_err(|_| "Codex 会话状态不可用")?;
            if sessions.len() >= 4 { let _ = child.kill(); return Err("Codex 连接数量已达到限制".into()); }
            sessions.insert(id.clone(),Session { child,input });
        }
        let sessions = self.sessions.clone();
        let session_id = id.clone();
        std::thread::spawn(move || {
            let failure = loop {
                match read_frame(&mut output) {
                    Ok(Some(value)) => if channel.send(value).is_err() { break "阅读窗口已关闭"; },
                    Ok(None) => break "Codex 连接已关闭，请重新连接",
                    Err(_) => break "Codex 桥接返回了无效消息，请重新连接",
                }
            };
            let _ = channel.send(json!({"event":"disconnect","error":failure}));
            let session = sessions.lock().ok().and_then(|mut map| map.remove(&session_id));
            if let Some(mut session) = session { let _ = session.child.kill(); let _ = session.child.wait(); }
        });
        Ok(id)
    }

    pub fn send(&self, id: &str, message: Value) -> Result<()> {
        let request_type = message.get("type").and_then(Value::as_str).ok_or("Codex 请求类型无效")?;
        if !["status","models","chat","tool-result","cancel"].contains(&request_type) { return Err("不允许此 Codex 请求类型".into()); }
        let data = serde_json::to_vec(&message).map_err(|e| e.to_string())?;
        if data.is_empty() || data.len() > MAX_INPUT { return Err("Codex 请求超过大小限制".into()); }
        let mut sessions = self.sessions.lock().map_err(|_| "Codex 会话状态不可用")?;
        let session = sessions.get_mut(id).ok_or("Codex 连接已关闭")?;
        session.input.write_all(&(data.len() as u32).to_le_bytes()).and_then(|_| session.input.write_all(&data)).and_then(|_| session.input.flush()).map_err(|_| "无法向 Codex 桥接发送消息".into())
    }

    pub fn disconnect(&self, id: &str) -> Result<()> {
        let session = self.sessions.lock().map_err(|_| "Codex 会话状态不可用")?.remove(id);
        if let Some(mut session) = session { drop(session.input); let _ = session.child.kill(); let _ = session.child.wait(); }
        Ok(())
    }

    pub fn disconnect_all(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for (_,mut session) in sessions.drain() { drop(session.input); let _ = session.child.kill(); let _ = session.child.wait(); }
        }
    }
}
impl Drop for NativeBridge { fn drop(&mut self) { self.disconnect_all(); } }

fn read_frame(input: &mut impl Read) -> Result<Option<Value>> {
    let mut length = [0_u8;4];
    match input.read(&mut length[..1]) { Ok(0) => return Ok(None),Ok(_) => (),Err(e) => return Err(e.to_string()) }
    input.read_exact(&mut length[1..]).map_err(|e| e.to_string())?;
    let length = u32::from_le_bytes(length) as usize;
    if length == 0 || length > MAX_OUTPUT { return Err("Host frame exceeds limit".into()); }
    let mut body = vec![0;length]; input.read_exact(&mut body).map_err(|e| e.to_string())?;
    let value: Value = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
    if !value.is_object() { return Err("Host frame must be an object".into()); }
    Ok(Some(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn framing_and_request_allowlist() {
        let body = br#"{"id":"hello","ok":true}"#;
        let mut data = (body.len() as u32).to_le_bytes().to_vec(); data.extend(body);
        assert_eq!(read_frame(&mut &data[..]).unwrap().unwrap()["id"],"hello");
        assert!(read_frame(&mut &[(MAX_OUTPUT as u32 + 1).to_le_bytes()].concat()[..]).is_err());
        assert!(read_frame(&mut &data[..5]).is_err());
        assert!(read_frame(&mut &b""[..]).unwrap().is_none());
        let bridge = NativeBridge::default();
        assert!(bridge.send("missing",json!({"type":"shell","command":"anything"})).unwrap_err().contains("不允许"));
    }
}
