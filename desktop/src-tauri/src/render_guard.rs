//! 页面进程守护：WebView2 的页面（renderer）进程崩溃或卡死时，记下技术信息并自动重新载入，
//! 不再停在浏览器的崩溃页上。也管 Graphite 开关（WebView2 启动参数，改了要重启才生效）。
//!
//! 只记技术元数据（进程类型、原因、退出码、运行时版本、出错模块），不记文档内容和密钥。
//! 记录在应用数据目录的 render-failures.jsonl，每行一条。
use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::{Path, PathBuf}, sync::{Arc, Mutex}, time::{SystemTime, UNIX_EPOCH}};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Failure {
    pub at: u64,
    pub kind: String,
    pub reason: String,
    pub exit_code: i32,
    pub runtime: String,
    pub process: String,
    pub module: String,
    pub graphite: bool,
    /// 这次有没有自动重新载入（短时间内连续失败就不再重载，免得循环）。
    pub reloaded: bool,
}

#[derive(Default)]
pub struct Guard {
    /// 最近一次页面失败，页面重新载入后取一次（用来给出「刚才页面出错，已恢复」的提示）。
    pub pending: Mutex<Option<Failure>>,
    /// 最近几次自动重载的时间，限次用。
    reloads: Mutex<Vec<u64>>,
}

#[derive(Serialize, Deserialize)]
struct RenderSettings { graphite: bool }

pub fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) }

fn settings_path(dir: &Path) -> PathBuf { dir.join("render.json") }

/// Graphite 默认开着；只有用户在设置里关掉时才关。
pub fn graphite_enabled(dir: &Path) -> bool {
    fs::read_to_string(settings_path(dir)).ok()
        .and_then(|text| serde_json::from_str::<RenderSettings>(&text).ok())
        .map(|value| value.graphite).unwrap_or(true)
}

pub fn set_graphite(dir: &Path, graphite: bool) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    fs::write(settings_path(dir), serde_json::to_string(&RenderSettings { graphite })?)
}

/// 启动参数：Graphite 关掉时去掉 --enable-features=SkiaGraphite，其余照旧。
pub fn browser_args(configured: &str, graphite: bool) -> String {
    if graphite { return configured.to_string(); }
    configured.split_whitespace().filter(|part| *part != "--enable-features=SkiaGraphite").collect::<Vec<_>>().join(" ")
}

pub fn log_path(dir: &Path) -> PathBuf { dir.join("render-failures.jsonl") }

fn append(dir: &Path, failure: &Failure) {
    let path = log_path(dir);
    // 只留最近 200 条。
    if let Ok(text) = fs::read_to_string(&path) {
        let lines: Vec<&str> = text.lines().collect();
        if lines.len() >= 200 { let _ = fs::write(&path, lines[lines.len() - 150..].join("\n") + "\n"); }
    }
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(&path) {
        if let Ok(line) = serde_json::to_string(failure) { let _ = writeln!(file, "{line}"); }
    }
}

pub fn recent(dir: &Path, limit: usize) -> Vec<Failure> {
    let text = fs::read_to_string(log_path(dir)).unwrap_or_default();
    let mut items: Vec<Failure> = text.lines().filter_map(|line| serde_json::from_str(line).ok()).collect();
    let skip = items.len().saturating_sub(limit);
    items.drain(..skip);
    items.reverse();
    items
}

impl Guard {
    /// 10 分钟内最多自动重载 3 次；再多就停在崩溃页，不进入循环。
    fn allow_reload(&self) -> bool {
        let Ok(mut times) = self.reloads.lock() else { return false };
        let now = now();
        times.retain(|at| now.saturating_sub(*at) < 600);
        if times.len() >= 3 { return false; }
        times.push(now);
        true
    }
}

#[cfg(windows)]
pub fn watch(window: &tauri::WebviewWindow, guard: Arc<Guard>, dir: PathBuf, graphite: bool) {
    use webview2_com::{take_pwstr, Microsoft::Web::WebView2::Win32::*, ProcessFailedEventHandler};
    use windows::core::{Interface, PWSTR};
    let _ = window.with_webview(move |webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else { return };
        let mut version = PWSTR::null();
        let runtime = if webview.environment().BrowserVersionString(&mut version).is_ok() { take_pwstr(version) } else { String::new() };
        let handler = ProcessFailedEventHandler::create(Box::new(move |sender: Option<ICoreWebView2>, args: Option<ICoreWebView2ProcessFailedEventArgs>| {
            let (Some(core), Some(args)) = (sender, args) else { return Ok(()) };
            let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
            let _ = args.ProcessFailedKind(&mut kind);
            let mut failure = Failure { at: now(), kind: kind_name(kind).into(), runtime: runtime.clone(), graphite, ..Default::default() };
            if let Ok(more) = args.cast::<ICoreWebView2ProcessFailedEventArgs2>() {
                let mut reason = COREWEBVIEW2_PROCESS_FAILED_REASON::default();
                if more.Reason(&mut reason).is_ok() { failure.reason = reason_name(reason).into(); }
                let _ = more.ExitCode(&mut failure.exit_code);
                let mut description = PWSTR::null();
                if more.ProcessDescription(&mut description).is_ok() { failure.process = take_pwstr(description); }
            }
            if let Ok(more) = args.cast::<ICoreWebView2ProcessFailedEventArgs3>() {
                let mut module = PWSTR::null();
                if more.FailureSourceModulePath(&mut module).is_ok() {
                    // 只留文件名，不留本机路径。
                    let path = take_pwstr(module);
                    failure.module = path.rsplit(['\\', '/']).next().unwrap_or_default().to_string();
                }
            }
            // 整个页面进程退出或卡死：重新载入页面。其他进程（GPU、工具进程）会由 WebView2 自己重启，只记下来。
            let page = kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED || kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE;
            if page && guard.allow_reload() {
                failure.reloaded = true;
                if let Ok(mut pending) = guard.pending.lock() { *pending = Some(failure.clone()); }
                let _ = core.Reload();
            }
            append(&dir, &failure);
            Ok(())
        }));
        let mut token = 0i64;
        let _ = core.add_ProcessFailed(&handler, &mut token);
    });
}

#[cfg(not(windows))]
pub fn watch(_window: &tauri::WebviewWindow, _guard: Arc<Guard>, _dir: PathBuf, _graphite: bool) {}

#[cfg(windows)]
fn kind_name(kind: webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PROCESS_FAILED_KIND) -> &'static str {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    match kind {
        COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED => "browser-exited",
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED => "render-exited",
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE => "render-unresponsive",
        COREWEBVIEW2_PROCESS_FAILED_KIND_FRAME_RENDER_PROCESS_EXITED => "frame-render-exited",
        COREWEBVIEW2_PROCESS_FAILED_KIND_GPU_PROCESS_EXITED => "gpu-exited",
        COREWEBVIEW2_PROCESS_FAILED_KIND_UTILITY_PROCESS_EXITED => "utility-exited",
        COREWEBVIEW2_PROCESS_FAILED_KIND_SANDBOX_HELPER_PROCESS_EXITED => "sandbox-helper-exited",
        _ => "other",
    }
}

#[cfg(windows)]
fn reason_name(reason: webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PROCESS_FAILED_REASON) -> &'static str {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    match reason {
        COREWEBVIEW2_PROCESS_FAILED_REASON_CRASHED => "crashed",
        COREWEBVIEW2_PROCESS_FAILED_REASON_UNRESPONSIVE => "unresponsive",
        COREWEBVIEW2_PROCESS_FAILED_REASON_OUT_OF_MEMORY => "out-of-memory",
        COREWEBVIEW2_PROCESS_FAILED_REASON_TERMINATED => "terminated",
        COREWEBVIEW2_PROCESS_FAILED_REASON_LAUNCH_FAILED => "launch-failed",
        COREWEBVIEW2_PROCESS_FAILED_REASON_PROFILE_DELETED => "profile-deleted",
        COREWEBVIEW2_PROCESS_FAILED_REASON_UNEXPECTED => "unexpected",
        _ => "other",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn graphite_switch_only_touches_its_flag() {
        let configured = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --enable-features=SkiaGraphite";
        assert_eq!(browser_args(configured, true), configured);
        assert_eq!(browser_args(configured, false), "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection");
    }
    #[test]
    fn reloads_are_limited() {
        let guard = Guard::default();
        assert!(guard.allow_reload() && guard.allow_reload() && guard.allow_reload());
        assert!(!guard.allow_reload());
    }
}
