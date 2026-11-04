mod higgsfield;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());

    #[cfg(feature = "updater")]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .invoke_handler(tauri::generate_handler![
            higgsfield::hf_key_status,
            higgsfield::hf_set_key,
            higgsfield::hf_clear_key,
            higgsfield::hf_estimate,
            higgsfield::hf_submit,
            higgsfield::hf_status,
            higgsfield::hf_cancel,
            higgsfield::hf_upload,
            higgsfield::hf_download,
        ])
        .run(tauri::generate_context!())
        .expect("error while running THREADFORGE");
}
