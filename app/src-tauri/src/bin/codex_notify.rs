//! Codex notify 桥接程序（跨平台）。
//! Codex 通过 stdin 传入 JSON 事件，本程序转换为 AgentEvent POST 到桌面助理 HTTP 端点。
//! 用法：在 ~/.codex/config.toml 中设 notify = ["path/to/codex-notify"]

use std::io::Read;

const ENDPOINT: &str = "http://127.0.0.1:7321/agent-event";

fn main() {
    let mut input = String::new();
    if std::io::stdin().read_to_string(&mut input).is_err() {
        return;
    }

    let event_json = match convert_event(&input) {
        Some(j) => j,
        None => return,
    };

    // 发送到桌面助理（fire-and-forget，超时 3s）
    let _ = std::thread::spawn(move || {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(std::time::Duration::from_secs(3)))
            .build()
            .into();
        let _ = agent.post(ENDPOINT).send_json(&event_json);
    })
    .join();
}

fn convert_event(input: &str) -> Option<serde_json::Value> {
    let d: serde_json::Value = serde_json::from_str(input.trim()).ok()?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let event_type = d["type"]
        .as_str()
        .or_else(|| d["event"].as_str())
        .unwrap_or("");
    let msg = d["message"]
        .as_str()
        .or_else(|| d["summary"].as_str())
        .unwrap_or("")
        .to_string();
    let session = d["session_id"].as_str().unwrap_or("codex-session").to_string();
    let cwd = d["cwd"].as_str().unwrap_or("").to_string();

    let event = if event_type.contains("approval") || msg.to_lowercase().contains("approval") {
        serde_json::json!({
            "kind": "approval_needed",
            "agent": "codex",
            "session_id": session,
            "cwd": cwd,
            "tool": "terminal",
            "prompt_text": truncate(&msg, 300),
            "ts": ts
        })
    } else if event_type.contains("error") {
        serde_json::json!({
            "kind": "agent_error",
            "agent": "codex",
            "session_id": session,
            "message": truncate(&msg, 200),
            "ts": ts
        })
    } else {
        serde_json::json!({
            "kind": "task_completed",
            "agent": "codex",
            "session_id": session,
            "cwd": cwd,
            "summary": truncate(&format!("Codex: {}", if msg.is_empty() { event_type } else { &msg }), 200),
            "ts": ts
        })
    };

    Some(event)
}

fn truncate(s: &str, max: usize) -> &str {
    if s.len() <= max { s } else { &s[..s.floor_char_boundary(max)] }
}
