use tauri::Window;

pub fn pong() -> &'static str {
    "pong"
}

#[tauri::command]
pub fn ping() -> String {
    pong().to_string()
}

#[tauri::command]
pub fn set_click_through(window: Window, enable: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(enable)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_returns_pong() {
        assert_eq!(pong(), "pong");
    }

    #[test]
    fn window_config_has_companion_flags() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let win = &conf["app"]["windows"][0];
        assert_eq!(win["transparent"], true);
        assert_eq!(win["alwaysOnTop"], true);
        assert_eq!(win["decorations"], false);
        assert_eq!(conf["app"]["macOSPrivateApi"], true);
    }
}

#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}
