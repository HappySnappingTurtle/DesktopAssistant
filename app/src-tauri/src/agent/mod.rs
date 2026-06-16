pub mod bus;
pub mod claude_hook;
pub mod detector;
pub mod event;
pub mod http_server;

use bus::{EventBus, EventSink, PublishResult};
use event::AgentEvent;
use std::sync::Mutex;
use tauri::Emitter;

pub struct TauriSink {
    pub app: tauri::AppHandle,
}

impl EventSink for TauriSink {
    fn emit(&self, event: &AgentEvent) {
        if let Err(e) = self.app.emit("agent://event", event) {
            eprintln!("[agent-bus] emit failed: {e}");
        }
    }
}

pub struct BusState(pub Mutex<EventBus>);

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 带 3s 超时的 JSON POST（ureq 3.x）
pub fn post_json(url: &str, body: &serde_json::Value) -> Result<(), String> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(3)))
        .build()
        .into();
    agent
        .post(url)
        .send_json(body)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn inject_agent_event(
    state: tauri::State<'_, BusState>,
    event: AgentEvent,
) -> Result<PublishResult, String> {
    let mut bus = state.0.lock().map_err(|e| e.to_string())?;
    Ok(bus.publish(event))
}

#[tauri::command]
pub fn hook_endpoint(
    ep: tauri::State<'_, http_server::EndpointState>,
) -> Result<String, String> {
    match *ep.0.lock().map_err(|e| e.to_string())? {
        Some(port) => Ok(format!("http://127.0.0.1:{port}")),
        None => Err("hook 服务未启动".into()),
    }
}

#[tauri::command]
pub fn install_claude_hook(
    project_dir: String,
    ep: tauri::State<'_, http_server::EndpointState>,
) -> Result<String, String> {
    let port = ep
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .ok_or("hook 服务未启动")?;
    let endpoint = format!("http://127.0.0.1:{port}");
    let settings_path = std::path::Path::new(&project_dir)
        .join(".claude")
        .join("settings.json");
    let existing = std::fs::read_to_string(&settings_path).unwrap_or_default();
    let merged = claude_hook::merge_hook_config(&existing, &endpoint)?;
    std::fs::create_dir_all(settings_path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&settings_path, &merged).map_err(|e| e.to_string())?;
    Ok(settings_path.display().to_string())
}

/// 语音/UI 审批 → 通过包装器注入按键。安全白名单（T10）在调用方校验后才许进入此函数。
#[tauri::command]
pub fn pty_inject(
    session_id: String,
    keys: String,
    registry: tauri::State<'_, http_server::PtyRegistry>,
) -> Result<(), String> {
    let url = registry
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .get(&session_id)
        .cloned()
        .ok_or(format!("未注册的 PTY 会话: {session_id}"))?;
    post_json(&url, &serde_json::json!({ "keys": keys }))
        .map_err(|e| format!("注入失败: {e}"))
}

#[tauri::command]
pub fn uninstall_claude_hook(project_dir: String) -> Result<(), String> {
    let settings_path = std::path::Path::new(&project_dir)
        .join(".claude")
        .join("settings.json");
    let existing =
        std::fs::read_to_string(&settings_path).map_err(|e| format!("读取失败: {e}"))?;
    let removed = claude_hook::remove_hook_config(&existing)?;
    std::fs::write(&settings_path, &removed).map_err(|e| e.to_string())
}
