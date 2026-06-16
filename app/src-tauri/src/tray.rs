use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};

pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    let toggle_window =
        MenuItem::with_id(app, "toggle_window", "显示角色", true, None::<&str>)?;
    let muted = CheckMenuItem::with_id(app, "muted", "静音播报", true, false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle_window, &muted, &quit])?;

    let muted_item = muted.clone();
    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().cloned().expect("缺少应用图标"))
        .icon_as_template(false) // 不用模板模式，确保图标可见
        .tooltip("DesktopAssistant - 点击显示角色")
        .menu(&menu)
        .show_menu_on_left_click(false) // 左键不弹菜单，而是直接显示窗口
        .on_tray_icon_event(|tray, event| {
            // 左键单击托盘图标 → 直接显示/聚焦窗口
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(win) = app.get_webview_window("companion") {
                    let _ = win.show();
                    let _ = win.set_focus();
                    // 重新应用置顶
                    let _ = crate::window_level::set_window_level_status(&win);
                }
            }
        })
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "toggle_window" => {
                if let Some(win) = app.get_webview_window("companion") {
                    let _ = win.show();
                    let _ = win.set_focus();
                    let _ = crate::window_level::set_window_level_status(&win);
                }
            }
            "muted" => {
                let m = muted_item.is_checked().unwrap_or(false);
                let _ = app.emit("tray://muted", serde_json::json!({ "muted": m }));
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}
