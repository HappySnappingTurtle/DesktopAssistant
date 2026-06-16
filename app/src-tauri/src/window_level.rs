//! macOS 窗口层级控制：通过编译期链接的 ObjC helper 直接操作 NSWindow。

#[cfg(target_os = "macos")]
extern "C" {
    fn set_window_level_for_pid(level: i64, behavior: i64);
    fn start_level_watchdog(level: i64, behavior: i64);
}

// NSWindow level 常量
#[cfg(target_os = "macos")]
pub const LEVEL_SCREEN_SAVER_MINUS_1: i64 = 999;
#[cfg(target_os = "macos")]
pub const LEVEL_NORMAL: i64 = 0;

// collectionBehavior 位
// CanJoinAllSpaces = 1<<0 = 1
// Stationary = 1<<4 = 16
// IgnoresCycle = 1<<6 = 64
// FullScreenAuxiliary = 1<<8 = 256
#[cfg(target_os = "macos")]
pub const BEHAVIOR_ALWAYS_VISIBLE: i64 = 1 | 16 | 64 | 256; // = 337

#[cfg(target_os = "macos")]
pub fn set_window_level_status(win: &tauri::WebviewWindow) -> Result<(), String> {
    win.set_always_on_top(true).map_err(|e| e.to_string())?;
    unsafe {
        set_window_level_for_pid(LEVEL_SCREEN_SAVER_MINUS_1, BEHAVIOR_ALWAYS_VISIBLE);
        start_level_watchdog(LEVEL_SCREEN_SAVER_MINUS_1, BEHAVIOR_ALWAYS_VISIBLE);
    }
    eprintln!("[window-level] 设置 level=999 behavior=337 + watchdog 已启动");
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn set_window_level_status(win: &tauri::WebviewWindow) -> Result<(), String> {
    win.set_always_on_top(true).map_err(|e| e.to_string())
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
            set_window_level_for_pid(LEVEL_NORMAL, 0);
        }
        win.set_always_on_top(false).map_err(|e| e.to_string())
    }
}
