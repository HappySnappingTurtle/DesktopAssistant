use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager};

pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    let toggle_window =
        MenuItem::with_id(app, "toggle_window", "显示/隐藏角色", true, None::<&str>)?;
    let muted = CheckMenuItem::with_id(app, "muted", "静音播报", true, false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle_window, &muted, &quit])?;

    let muted_item = muted.clone();
    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().cloned().expect("缺少应用图标"))
        .icon_as_template(true)
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "toggle_window" => {
                if let Some(win) = app.get_webview_window("companion") {
                    let visible = win.is_visible().unwrap_or(true);
                    let _ = if visible { win.hide() } else { win.show() };
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
