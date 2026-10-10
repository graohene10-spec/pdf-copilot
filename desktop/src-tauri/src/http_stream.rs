//! A request owns its response for its entire lifetime. Aborting and joining that
//! task drops even an in-flight body read, instead of merely hiding it from JS.
use crate::db::Result;
use reqwest::{header::{HeaderMap,HeaderName,HeaderValue},Client,Method,Url};
use serde::Serialize;
use std::{collections::HashMap,sync::{Arc,Mutex},time::Duration};
use tauri::{async_runtime::JoinHandle,ipc::Channel};

const MAX_ACTIVE: usize = 8;
const MAX_BODY: usize = 16 * 1024 * 1024;
const MAX_RESPONSE: usize = 32 * 1024 * 1024;
const MAX_CHUNK: usize = 64 * 1024;
const MAX_HEADERS: usize = 64;
const MAX_HEADER_BYTES: usize = 32 * 1024;

#[derive(Serialize,Debug)]
#[serde(tag = "type",rename_all = "lowercase")]
pub enum HttpEvent {
    #[serde(rename_all = "camelCase")]
    Headers { status: u16,status_text: String,headers: Vec<(String,String)> },
    Chunk { data: Vec<u8> },
    End,
    Error { message: String },
}

struct ActiveRequest { token: uuid::Uuid,task: JoinHandle<()> }
type ActiveRequests = Arc<Mutex<HashMap<String,ActiveRequest>>>;

pub struct HttpBridge { client: Client,active: ActiveRequests }

struct Completion { id: String,token: uuid::Uuid,active: ActiveRequests }
impl Drop for Completion {
    fn drop(&mut self) {
        if let Ok(mut requests) = self.active.lock() {
            if requests.get(&self.id).is_some_and(|request| request.token == self.token) {
                requests.remove(&self.id);
            }
        }
    }
}

impl HttpBridge {
    pub fn new() -> Result<Self> {
        // System proxy and verified TLS are supported; the caller cannot supply
        // proxy settings, disable certificate validation, or follow redirects.
        let client = Client::builder().redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(30)).build()
            .map_err(|_| "无法初始化网络连接")?;
        Ok(Self { client,active: Arc::new(Mutex::new(HashMap::new())) })
    }

    pub fn start(&self,id: String,url: String,method: String,headers: Vec<(String,String)>,body: Option<String>,channel: Channel<HttpEvent>) -> Result<()> {
        self.start_with_sink(id,url,method,headers,body,move |event| channel.send(event).map_err(|_| "阅读窗口已关闭".into()))
    }

    fn start_with_sink(&self,id: String,url: String,method: String,headers: Vec<(String,String)>,body: Option<String>,sink: impl Fn(HttpEvent) -> Result<()> + Send + Sync + 'static) -> Result<()> {
        uuid::Uuid::parse_str(&id).map_err(|_| "网络请求标识无效")?;
        let request = validate_request(&url,&method,headers,body)?;
        let mut active = self.active.lock().map_err(|_| "网络连接状态不可用")?;
        if active.contains_key(&id) { return Err("网络请求标识已被使用".into()); }
        if active.len() >= MAX_ACTIVE { return Err("同时进行的网络请求过多".into()); }
        let client = self.client.clone();
        let token = uuid::Uuid::new_v4();
        // Construct before spawning so cancellation before the first poll also
        // cleans up. The token protects a new request that reuses a finished ID.
        let completion = Completion { id: id.clone(),token,active: self.active.clone() };
        let task = tauri::async_runtime::spawn(async move {
            let _completion = completion;
            if let Err(message) = stream_response(client,request,&sink).await {
                let _ = sink(HttpEvent::Error { message });
            }
        });
        active.insert(id,ActiveRequest { token,task });
        Ok(())
    }

    pub async fn cancel(&self,id: &str) -> Result<()> {
        let request = self.active.lock().map_err(|_| "网络连接状态不可用")?.remove(id);
        if let Some(request) = request {
            request.task.abort();
            // Await outside the map lock: response/future destruction and its
            // cleanup guard complete before acknowledging cancellation to JS.
            let _ = request.task.await;
        }
        Ok(())
    }

    pub fn cancel_all(&self) {
        let requests: Vec<_> = self.active.lock().map(|mut active| active.drain().map(|(_,request)| request).collect()).unwrap_or_default();
        for request in requests { request.task.abort(); }
    }
}

impl Drop for HttpBridge { fn drop(&mut self) { self.cancel_all(); } }

struct Request { url: Url,method: Method,headers: HeaderMap,body: Option<String> }

fn validate_url(address: &str) -> Result<Url> {
    if address.len() > 8192 || address.chars().any(char::is_control) { return Err("接口地址无效".into()); }
    let url = Url::parse(address).map_err(|_| "接口地址无效")?;
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() || url.host().is_none() {
        return Err("接口地址无效".into());
    }
    let host = url.host_str().unwrap_or_default();
    let loopback = host.eq_ignore_ascii_case("localhost") || host.trim_start_matches('[').trim_end_matches(']').parse::<std::net::IpAddr>().is_ok_and(|address| address.is_loopback());
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err("接口需要使用 HTTPS，本机接口可以使用 HTTP".into());
    }
    Ok(url)
}

fn validate_request(address: &str,method: &str,headers: Vec<(String,String)>,body: Option<String>) -> Result<Request> {
    let url = validate_url(address)?;
    let method = match method { "GET" => Method::GET,"POST" => Method::POST,_ => return Err("不支持此网络请求方式".into()) };
    if body.as_ref().is_some_and(|body| body.len() > MAX_BODY) { return Err("网络请求超过大小限制".into()); }
    if method == Method::GET && body.is_some() { return Err("GET 请求不能携带正文".into()); }
    if headers.len() > MAX_HEADERS || headers.iter().map(|(name,value)| name.len() + value.len()).sum::<usize>() > MAX_HEADER_BYTES {
        return Err("请求头超过大小限制".into());
    }
    let mut request_headers = HeaderMap::new();
    for (name,value) in headers {
        let name = HeaderName::from_bytes(name.as_bytes()).map_err(|_| "请求头无效")?;
        if matches!(name.as_str(),"host" | "connection" | "content-length" | "transfer-encoding" | "cookie" | "upgrade" | "te" | "trailer") || name.as_str().starts_with("proxy-") || name.as_str().starts_with("sec-") {
            return Err("不允许此请求头".into());
        }
        let value = HeaderValue::from_str(&value).map_err(|_| "请求头无效")?;
        request_headers.append(name,value);
    }
    Ok(Request { url,method,headers: request_headers,body })
}

async fn stream_response(client: Client,request: Request,sink: &impl Fn(HttpEvent) -> Result<()>) -> Result<()> {
    let mut builder = client.request(request.method,request.url).headers(request.headers);
    if let Some(body) = request.body { builder = builder.body(body); }
    let mut response = builder.send().await.map_err(|_| "网络请求未能完成，请检查接口与连接")?;
    if response.content_length().is_some_and(|size| size > MAX_RESPONSE as u64) { return Err("接口响应超过大小限制".into()); }
    let mut headers = Vec::new();
    let mut header_bytes = 0;
    for (name,value) in response.headers() {
        header_bytes += name.as_str().len() + value.as_bytes().len();
        if headers.len() >= MAX_HEADERS || header_bytes > MAX_HEADER_BYTES { return Err("接口响应头超过大小限制".into()); }
        headers.push((name.as_str().to_owned(),value.to_str().map_err(|_| "接口响应头无效")?.to_owned()));
    }
    sink(HttpEvent::Headers { status: response.status().as_u16(),status_text: response.status().canonical_reason().unwrap_or_default().to_owned(),headers })?;
    let mut received = 0_usize;
    while let Some(chunk) = response.chunk().await.map_err(|_| "读取接口响应失败，请检查连接")? {
        received += chunk.len();
        if received > MAX_RESPONSE { return Err("接口响应超过大小限制".into()); }
        for data in chunk.chunks(MAX_CHUNK) {
            sink(HttpEvent::Chunk { data: data.to_vec() })?;
            // A continuously ready socket must still give cancellation a turn.
            tokio::task::yield_now().await;
        }
    }
    sink(HttpEvent::End)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::{Read,Write},net::TcpListener,sync::mpsc,time::Instant};

    #[test]
    fn validates_gateway_scope_and_request_bounds() {
        for url in ["https://api.example/v1/chat?api-version=2026-01","https://api.example:8443/chat","http://localhost:1234/chat","http://127.0.0.2:1234/chat","http://[::1]:1234/chat"] { assert!(validate_url(url).is_ok(),"{url}"); }
        for url in ["http://external.example/chat","file:///C:/Windows/win.ini","https://user:key@api.example/chat","https://api.example/chat#private","http://localhost.evil/chat","https://api.example/\nchat"] { assert!(validate_url(url).is_err(),"{url}"); }
        assert!(validate_request("https://api.example","DELETE",vec![],None).is_err());
        assert!(validate_request("https://api.example","GET",vec![],Some("x".into())).is_err());
        assert!(validate_request("https://api.example","POST",vec![("Host".into(),"other".into())],None).is_err());
        assert!(validate_request("https://api.example","POST",vec![("Authorization".into(),"secret\r\nextra: value".into())],None).is_err());
        assert!(validate_request("https://api.example","POST",vec![],Some("x".repeat(MAX_BODY + 1))).is_err());
        let event = serde_json::to_value(HttpEvent::Headers { status: 200,status_text: "OK".into(),headers: vec![] }).unwrap();
        assert_eq!(event["statusText"],"OK");
        assert_eq!(event["type"],"headers");
    }

    #[test]
    fn cancellation_closes_real_connection_while_waiting_for_headers_or_next_chunk() {
        for (send_headers,close_window) in [(false,false),(true,false),(true,true)] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let (ready_tx,ready_rx) = mpsc::channel();
            let (closed_tx,closed_rx) = mpsc::channel();
            let server = std::thread::spawn(move || {
                let (mut stream,_) = listener.accept().unwrap();
                stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
                let mut request = Vec::new();
                let mut byte = [0_u8];
                while !request.ends_with(b"\r\n\r\n") { stream.read_exact(&mut byte).unwrap(); request.push(byte[0]); }
                if send_headers {
                    stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\nd\r\ndata: first\n\n\r\n").unwrap();
                    stream.flush().unwrap();
                }
                ready_tx.send(()).unwrap();
                let closed = match stream.read(&mut byte) { Ok(0) => true,Err(error) => matches!(error.kind(),std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionAborted),_ => false };
                closed_tx.send(closed).unwrap();
            });
            let bridge = HttpBridge::new().unwrap();
            let (events_tx,events_rx) = mpsc::channel();
            let id = uuid::Uuid::new_v4().to_string();
            bridge.start_with_sink(id.clone(),format!("http://{address}/synthetic"),"GET".into(),vec![],None,move |event| events_tx.send(event).map_err(|_| "test receiver closed".into())).unwrap();
            ready_rx.recv_timeout(Duration::from_secs(3)).unwrap();
            if send_headers {
                loop { if matches!(events_rx.recv_timeout(Duration::from_secs(3)).unwrap(),HttpEvent::Chunk { .. }) { break; } }
                // The server will never send a second chunk: ensure the native
                // task is suspended in that read before testing cancellation.
                std::thread::sleep(Duration::from_millis(20));
            }
            let stopped = Instant::now();
            if close_window { bridge.cancel_all(); }
            else { tauri::async_runtime::block_on(bridge.cancel(&id)).unwrap(); }
            assert!(closed_rx.recv_timeout(Duration::from_secs(2)).unwrap(),"cancellation must close the actual TCP response, not only the UI stream");
            assert!(stopped.elapsed() < Duration::from_secs(2));
            assert!(bridge.active.lock().unwrap().is_empty());
            tauri::async_runtime::block_on(bridge.cancel(&id)).unwrap(); // idempotent
            server.join().unwrap();
        }
    }
}
