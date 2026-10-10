mod credentials;
mod db;
mod files;
mod http_stream;
mod native_bridge;

use db::{Document,DocumentPatch,Library,Result};
use std::{path::{Path,PathBuf},sync::{Arc,Mutex}};
use tauri::{ipc::{Channel,Response},Manager,State};

struct AppState {
    library: Arc<Mutex<Library>>,
    credentials: Arc<Mutex<credentials::Credentials>>,
    bridge: Arc<native_bridge::NativeBridge>,
    http: Arc<http_stream::HttpBridge>,
    host: PathBuf,
}

fn main_window(window: &tauri::Window) -> Result<()> {
    if window.label() != "main" { return Err("只有主阅读窗口能够使用此功能".into()); }
    Ok(())
}

async fn library_operation<T: Send + 'static>(
    library: Arc<Mutex<Library>>,
    operation: impl FnOnce(&mut Library) -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = library.lock().map_err(|_| "文档库不可用")?;
        operation(&mut guard)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_documents(window: tauri::Window, state: State<'_,AppState>, query: Option<String>) -> Result<Vec<Document>> {
    main_window(&window)?;
    library_operation(state.library.clone(),move |library| library.list(query.as_deref())).await
}

#[tauri::command]
async fn import_documents(window: tauri::Window, state: State<'_,AppState>, paths: Vec<String>) -> Result<Vec<Document>> {
    main_window(&window)?;
    library_operation(state.library.clone(),move |library| library.import(paths)).await
}

#[tauri::command]
async fn read_document(window: tauri::Window, state: State<'_,AppState>, id: String) -> Result<Response> {
    main_window(&window)?;
    let doc = library_operation(state.library.clone(),move |library| library.get(&id)).await?;
    tauri::async_runtime::spawn_blocking(move || files::read_bounded(Path::new(&doc.path),if doc.kind == "pdf" { 256 * 1024 * 1024 } else { 16 * 1024 * 1024 }).map(Response::new)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn update_document(window: tauri::Window, state: State<'_,AppState>, id: String, patch: DocumentPatch) -> Result<Document> {
    main_window(&window)?;
    library_operation(state.library.clone(),move |library| library.update(&id,patch)).await
}

#[tauri::command]
async fn remove_document(window: tauri::Window, state: State<'_,AppState>, id: String) -> Result<()> {
    main_window(&window)?;
    library_operation(state.library.clone(),move |library| library.remove(&id)).await
}

#[tauri::command]
async fn read_asset(window: tauri::Window, state: State<'_,AppState>, id: String, relative_path: String) -> Result<Response> {
    main_window(&window)?;
    let doc = library_operation(state.library.clone(),move |library| library.get(&id)).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = files::resolve_asset(Path::new(&doc.path),&relative_path)?;
        files::read_bounded(&path,16 * 1024 * 1024).map(Response::new)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn index_document(window: tauri::Window, state: State<'_,AppState>, id: String, text: String) -> Result<()> {
    main_window(&window)?;
    library_operation(state.library.clone(),move |library| library.index(&id,&text)).await
}

#[tauri::command]
async fn get_setting(window: tauri::Window, state: State<'_,AppState>, key: String) -> Result<Option<String>> {
    main_window(&window)?;
    library_operation(state.library.clone(),move |library| library.get_setting(&key)).await
}

#[tauri::command]
async fn set_setting(window: tauri::Window, state: State<'_,AppState>, key: String, value: String) -> Result<()> {
    main_window(&window)?;
    library_operation(state.library.clone(),move |library| library.set_setting(&key,&value)).await
}

#[tauri::command]
async fn get_credential(window: tauri::Window, state: State<'_,AppState>, provider: String) -> Result<Option<String>> {
    main_window(&window)?;
    let credentials = state.credentials.clone();
    tauri::async_runtime::spawn_blocking(move || credentials.lock().map_err(|_| "凭据存储不可用")?.get(&provider)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn set_credential(window: tauri::Window, state: State<'_,AppState>, provider: String, key: String) -> Result<()> {
    main_window(&window)?;
    let credentials = state.credentials.clone();
    tauri::async_runtime::spawn_blocking(move || credentials.lock().map_err(|_| "凭据存储不可用")?.set(&provider,&key)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn native_connect(window: tauri::Window, state: State<'_,AppState>, channel: Channel<serde_json::Value>) -> Result<String> {
    main_window(&window)?;
    let bridge = state.bridge.clone(); let host = state.host.clone();
    tauri::async_runtime::spawn_blocking(move || bridge.connect(&host,channel)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn native_send(window: tauri::Window, state: State<'_,AppState>, session_id: String, message: serde_json::Value) -> Result<()> {
    main_window(&window)?;
    let bridge = state.bridge.clone();
    tauri::async_runtime::spawn_blocking(move || bridge.send(&session_id,message)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn native_disconnect(window: tauri::Window, state: State<'_,AppState>, session_id: String) -> Result<()> {
    main_window(&window)?;
    let bridge = state.bridge.clone();
    tauri::async_runtime::spawn_blocking(move || bridge.disconnect(&session_id)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn http_start(window: tauri::Window,state: State<'_,AppState>,id: String,url: String,method: String,headers: Vec<(String,String)>,body: Option<String>,channel: Channel<http_stream::HttpEvent>) -> Result<()> {
    main_window(&window)?;
    state.http.start(id,url,method,headers,body,channel)
}

#[tauri::command]
async fn http_cancel(window: tauri::Window,state: State<'_,AppState>,id: String) -> Result<()> {
    main_window(&window)?;
    state.http.cancel(&id).await
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let library = Library::open(&data_dir.join("library.sqlite3")).map_err(std::io::Error::other)?;
            let resource_dir = app.path().resource_dir()?;
            let bundled_host = resource_dir.join("native-host").join("PdfCopilotHost.exe");
            let host = if bundled_host.is_file() { bundled_host } else {
                // Development builds use the same fixed copied resource, never a caller-provided executable.
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("PdfCopilotHost.exe")
            };
            app.manage(AppState {
                library: Arc::new(Mutex::new(library)),
                credentials: Arc::new(Mutex::new(credentials::Credentials::new(data_dir.join("credentials")))),
                bridge: Arc::new(native_bridge::NativeBridge::default()),host,
                http: Arc::new(http_stream::HttpBridge::new().map_err(std::io::Error::other)?),
            });
            Ok(())
        })
        .on_window_event(|window,event| {
            if window.label() == "main" && matches!(event,tauri::WindowEvent::Destroyed) {
                window.state::<AppState>().bridge.disconnect_all();
                window.state::<AppState>().http.cancel_all();
            }
        })
        .invoke_handler(tauri::generate_handler![list_documents,import_documents,read_document,update_document,remove_document,read_asset,index_document,get_setting,set_setting,get_credential,set_credential,native_connect,native_send,native_disconnect,http_start,http_cancel])
        .run(tauri::generate_context!())
        .expect("开智启动失败");
}
