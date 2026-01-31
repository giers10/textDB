#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{Emitter, Manager, RunEvent, Wry};

struct PendingOpens(Mutex<Vec<String>>);

#[tauri::command]
fn take_pending_opens(state: tauri::State<PendingOpens>) -> Vec<String> {
  let mut pending = state.0.lock().expect("pending opens lock");
  pending.drain(..).collect()
}

fn main() {
  tauri::Builder::default()
    .setup(|app| {
      app.manage(PendingOpens(Mutex::new(Vec::new())));
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![take_pending_opens])
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_clipboard_manager::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_sql::Builder::default().build())
    .plugin(
      tauri::plugin::Builder::<Wry, ()>::new("file-open")
        .on_event(|app, event| {
          #[cfg(any(target_os = "macos", target_os = "ios"))]
          if let RunEvent::Opened { urls } = event {
            let paths: Vec<String> = urls
              .iter()
              .filter_map(|url| url.to_file_path().ok())
              .map(|path| path.to_string_lossy().to_string())
              .collect();
            if paths.is_empty() {
              return;
            }
            let state = app.state::<PendingOpens>();
            let mut pending = state.0.lock().expect("pending opens lock");
            pending.extend(paths.iter().cloned());
            let _ = app.emit("file-opened", paths);
          }
        })
        .build(),
    )
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
