pub mod agent;
mod commands;
pub mod config;
pub mod cosyvoice3;
pub mod llm;
pub mod paths;
pub mod tts;
mod tray;
pub mod voice;
mod window_level;

use agent::bus::EventBus;
use agent::{BusState, TauriSink};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// 当前注册的快捷键，用于动态更换
pub struct ShortcutState2(pub Mutex<Shortcut>);

fn ptt_handler(app: &tauri::AppHandle, _shortcut: &Shortcut, event: tauri_plugin_global_shortcut::ShortcutEvent) {
    // 确保窗口可见（不 steal focus，只确保 show+层级正确）
    fn ensure_visible(app: &tauri::AppHandle) {
        if let Some(win) = app.get_webview_window("companion") {
            let _ = win.show();
            let _ = window_level::set_window_level_status(&win);
        }
    }

    match event.state() {
        ShortcutState::Pressed => {
            ensure_visible(app);
            let state = app.state::<voice::RecorderState>();
            match voice::voice_start_recording(state) {
                Ok(()) => {
                    let _ = app.emit("voice://state", serde_json::json!({ "state": "recording" }));
                }
                Err(e) => {
                    let _ = app.emit("voice://error", serde_json::json!({ "message": e }));
                }
            }
        }
        ShortcutState::Released => {
            let _ = app.emit("voice://state", serde_json::json!({ "state": "transcribing" }));
            let app2 = app.clone();
            tauri::async_runtime::spawn(async move {
                let state = app2.state::<voice::RecorderState>();
                match voice::voice_stop_and_transcribe(app2.clone(), state).await {
                    Ok(_) => {
                        let _ = app2.emit("voice://state", serde_json::json!({ "state": "idle" }));
                    }
                    Err(e) => {
                        let _ = app2.emit("voice://error", serde_json::json!({ "message": e }));
                        let _ = app2.emit("voice://state", serde_json::json!({ "state": "idle" }));
                    }
                }
            });
        }
    }
}

/// 解析快捷键字符串 "Alt+Space" / "Ctrl+Shift+K" → Shortcut
fn parse_shortcut(s: &str) -> Result<Shortcut, String> {
    let parts: Vec<&str> = s.split('+').map(str::trim).collect();
    if parts.is_empty() {
        return Err("空快捷键".into());
    }
    let mut mods = Modifiers::empty();
    for &p in &parts[..parts.len() - 1] {
        match p.to_lowercase().as_str() {
            "alt" | "option" => mods |= Modifiers::ALT,
            "ctrl" | "control" => mods |= Modifiers::CONTROL,
            "shift" => mods |= Modifiers::SHIFT,
            "cmd" | "command" | "super" | "meta" => mods |= Modifiers::META,
            _ => return Err(format!("未知修饰键: {p}")),
        }
    }
    let key_str = parts.last().unwrap().to_lowercase();
    let code = match key_str.as_str() {
        "space" => Code::Space,
        "enter" | "return" => Code::Enter,
        "tab" => Code::Tab,
        "escape" | "esc" => Code::Escape,
        "backspace" => Code::Backspace,
        s if s.len() == 1 => {
            let c = s.chars().next().unwrap();
            match c {
                'a'..='z' => {
                    let codes = [Code::KeyA,Code::KeyB,Code::KeyC,Code::KeyD,Code::KeyE,Code::KeyF,
                                 Code::KeyG,Code::KeyH,Code::KeyI,Code::KeyJ,Code::KeyK,Code::KeyL,
                                 Code::KeyM,Code::KeyN,Code::KeyO,Code::KeyP,Code::KeyQ,Code::KeyR,
                                 Code::KeyS,Code::KeyT,Code::KeyU,Code::KeyV,Code::KeyW,Code::KeyX,
                                 Code::KeyY,Code::KeyZ];
                    codes[(c as u8 - b'a') as usize]
                }
                '0'..='9' => {
                    let codes = [Code::Digit0,Code::Digit1,Code::Digit2,Code::Digit3,Code::Digit4,
                                 Code::Digit5,Code::Digit6,Code::Digit7,Code::Digit8,Code::Digit9];
                    codes[(c as u8 - b'0') as usize]
                }
                _ => return Err(format!("未知按键: {s}")),
            }
        }
        s => return Err(format!("未知按键: {s}")),
    };
    let mods_opt = if mods.is_empty() { None } else { Some(mods) };
    Ok(Shortcut::new(mods_opt, code))
}

#[tauri::command]
fn get_mode_shortcut() -> String {
    let default = if cfg!(target_os = "windows") { "Ctrl+Shift+A" } else { "Cmd+Shift+A" };
    let cfg = crate::config::get_config();
    cfg["mode_shortcut"].as_str().unwrap_or(default).to_string()
}

#[tauri::command]
fn set_mode_shortcut(app: tauri::AppHandle, shortcut_str: String) -> Result<String, String> {
    let new_sc = parse_shortcut(&shortcut_str)?;
    if !shortcut_str.contains('+') {
        return Err("模式切换快捷键必须包含修饰键（Cmd/Ctrl/Alt/Shift）".into());
    }
    let state = app.state::<ModeShortcutState>();
    let mut current = state.0.lock().map_err(|e| e.to_string())?;
    let gs = app.global_shortcut();
    let _ = gs.unregister(*current);
    gs.on_shortcut(new_sc, mode_switch_handler).map_err(|e| format!("注册失败: {e}"))?;
    *current = new_sc;
    let _ = crate::config::set_config(serde_json::json!({ "mode_shortcut": shortcut_str }));
    Ok(shortcut_str)
}

pub struct ModeShortcutState(pub Mutex<Shortcut>);

fn mode_switch_handler(app: &tauri::AppHandle, _shortcut: &Shortcut, event: tauri_plugin_global_shortcut::ShortcutEvent) {
    if event.state() != ShortcutState::Pressed { return; }
    let _ = app.emit("voice://mode_switch", serde_json::json!({}));
}

#[tauri::command]
fn set_ptt_shortcut(app: tauri::AppHandle, shortcut_str: String) -> Result<String, String> {
    let new_sc = parse_shortcut(&shortcut_str)?;
    let state = app.state::<ShortcutState2>();
    let mut current = state.0.lock().map_err(|e| e.to_string())?;

    let gs = app.global_shortcut();
    let _ = gs.unregister(*current);
    gs.on_shortcut(new_sc, ptt_handler)
        .map_err(|e| format!("注册失败: {e}"))?;
    *current = new_sc;

    // 持久化
    let _ = crate::config::set_config(
        serde_json::json!({ "ptt_shortcut": shortcut_str }),
    );
    Ok(shortcut_str)
}

#[tauri::command]
fn get_ptt_shortcut() -> String {
    let default = if cfg!(target_os = "windows") { "Ctrl+Space" } else { "Alt+Space" };
    let cfg = crate::config::get_config();
    cfg["ptt_shortcut"]
        .as_str()
        .unwrap_or(default)
        .to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 读取保存的快捷键
    let default_shortcut = if cfg!(target_os = "windows") { "Ctrl+Space" } else { "Alt+Space" };
    let default_mode_sc = if cfg!(target_os = "windows") { "Ctrl+Shift+A" } else { "Cmd+Shift+A" };
    let cfg_snapshot = config::get_config();
    let saved = cfg_snapshot["ptt_shortcut"].as_str().unwrap_or(default_shortcut).to_string();
    let saved_mode = cfg_snapshot["mode_shortcut"].as_str().unwrap_or(default_mode_sc).to_string();
    let ptt = parse_shortcut(&saved).unwrap_or_else(|_| Shortcut::new(Some(Modifiers::ALT), Code::Space));
    let mode_sc = parse_shortcut(&saved_mode).unwrap_or_else(|_| Shortcut::new(Some(Modifiers::META | Modifiers::SHIFT), Code::KeyA));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(ptt_handler)
                .build(),
        )
        .setup(move |app| {
            if let Some(win) = app.get_webview_window("companion") {
                let _ = win.set_visible_on_all_workspaces(true);
                if let Err(e) = window_level::set_window_level_status(&win) {
                    eprintln!("[window] 高层级设置失败（回退 alwaysOnTop）: {e}");
                }
            }
            let bus = EventBus::new(
                Box::new(TauriSink { app: app.handle().clone() }),
                Box::new(agent::now_ms),
            );
            app.manage(BusState(Mutex::new(bus)));
            app.manage(agent::http_server::EndpointState(Mutex::new(None)));
            app.manage(agent::session::SessionRegistry(Mutex::new(
                agent::session::SessionRegistryInner::new(),
            )));
            app.manage(voice::RecorderState(Mutex::new(None)));
            app.manage(cosyvoice3::CosyVoice3State(Mutex::new(None)));
            app.manage(ShortcutState2(Mutex::new(ptt)));
            app.manage(ModeShortcutState(Mutex::new(mode_sc)));
            agent::http_server::start(app.handle().clone());

            if let Err(e) = tray::setup(app) {
                eprintln!("[tray] 初始化失败: {e}");
            }

            if let Err(e) = app.global_shortcut().register(ptt) {
                eprintln!("[voice] PTT 快捷键注册失败: {e}");
            }
            if let Err(e) = app.global_shortcut().on_shortcut(mode_sc, mode_switch_handler) {
                eprintln!("[voice] 模式切换快捷键注册失败: {e}");
            }

            // CosyVoice3 auto-start
            let cfg = config::get_config();
            if cfg.pointer("/tts/provider").and_then(|v| v.as_str()) == Some("cosyvoice3") {
                if cfg.pointer("/tts/cosyvoice3/auto_start").and_then(|v| v.as_bool()) == Some(true) {
                    let port = cfg.pointer("/tts/cosyvoice3/port")
                        .and_then(|v| v.as_u64()).unwrap_or(8000) as u16;
                    let handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        match cosyvoice3::start_server_internal(&handle, port).await {
                            Ok(url) => eprintln!("[cosyvoice3] auto-started at {url}"),
                            Err(e) => eprintln!("[cosyvoice3] auto-start failed: {e}"),
                        }
                    });
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::set_click_through,
            commands::quit_app,
            agent::inject_agent_event,
            agent::hook_endpoint,
            agent::install_claude_hook,
            agent::uninstall_claude_hook,
            agent::pty_inject,
            tts::tts_synthesize,
            config::get_config,
            config::set_config,
            config::set_secret,
            config::has_secret,
            llm::llm_chat,
            voice::voice_start_recording,
            voice::voice_stop_and_transcribe,
            set_ptt_shortcut,
            get_ptt_shortcut,
            set_mode_shortcut,
            get_mode_shortcut,
            window_level::set_always_visible,
            agent::list_agent_sessions,
            cosyvoice3::cosyvoice3_check_env,
            cosyvoice3::cosyvoice3_install,
            cosyvoice3::cosyvoice3_start,
            cosyvoice3::cosyvoice3_stop,
            cosyvoice3::cosyvoice3_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
