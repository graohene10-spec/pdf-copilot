fn main() {
    const COMMANDS: &[&str] = &[
        "list_documents", "import_documents", "read_document", "update_document",
        "remove_document", "read_asset", "index_document", "get_setting", "set_setting",
        "get_credential", "set_credential", "native_connect", "native_send", "native_disconnect",
        "http_start", "http_cancel",
    ];
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    ).expect("Tauri configuration could not be built");
}
