//! 跨平台窗口层级控制。
//! macOS: ObjC helper 设 NSStatusWindowLevel + collectionBehavior
//! Windows: Tauri alwaysOnTop（WinAPI HWND_TOPMOST 由 Tauri 内部处理）
//! Linux: Tauri alwaysOnTop

#[cfg(target_os = "macos")]
extern "C" {
    fn set_window_level_for_pid(level: i64, behavior: i64);
    fn start_level_watchdog(level: i64, behavior: i64);
}

#[cfg(target_os = "macos")]
pub const LEVEL_SCREEN_SAVER_MINUS_1: i64 = 999;
#[cfg(target_os = "macos")]
pub const BEHAVIOR_ALWAYS_VISIBLE: i64 = 1 | 16 | 64 | 256; // 337

#[cfg(target_os = "macos")]
pub fn set_window_level_status(win: &tauri::WebviewWindow) -> Result<(), String> {
    win.set_always_on_top(true).map_err(|e| e.to_string())?;
    unsafe {
        set_window_level_for_pid(LEVEL_SCREEN_SAVER_MINUS_1, BEHAVIOR_ALWAYS_VISIBLE);
        start_level_watchdog(LEVEL_SCREEN_SAVER_MINUS_1, BEHAVIOR_ALWAYS_VISIBLE);
    }
    eprintln!("[window-level] macOS: level=999 behavior=337 + watchdog");
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn set_window_level_status(win: &tauri::WebviewWindow) -> Result<(), String> {
    win.set_always_on_top(true).map_err(|e| e.to_string())?;
    eprintln!("[window-level] Windows: alwaysOnTop=true (HWND_TOPMOST via Tauri)");
    Ok(())
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
pub fn set_window_level_status(win: &tauri::WebviewWindow) -> Result<(), String> {
    win.set_always_on_top(true).map_err(|e| e.to_string())?;
    eprintln!("[window-level] Linux: alwaysOnTop=true");
    Ok(())
}

#[tauri::command]
pub fn set_always_visible(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri::Manager;
    let win = app
        .get_webview_window("companion")
        .ok_or("companion 窗口不存在")?;
    if enabled {
        set_window_level_status(&win)
    } else {
        #[cfg(target_os = "macos")]
        unsafe {
            set_window_level_for_pid(0, 0);
        }
        win.set_always_on_top(false).map_err(|e| e.to_string())
    }
}
