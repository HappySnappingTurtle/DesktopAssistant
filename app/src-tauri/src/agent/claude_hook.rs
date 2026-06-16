use super::event::AgentEvent;
use serde_json::{json, Value};

/// Claude Code hook payload → AgentEvent（纯函数）
pub fn parse_hook_payload(payload: &Value, now: u64) -> Option<AgentEvent> {
    let obj = payload.as_object()?;
    let hook = obj.get("hook_event_name")?.as_str()?;
    let session_id = obj
        .get("session_id")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let cwd = obj
        .get("cwd")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    match hook {
        "Notification" => {
            let message = obj
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let lower = message.to_lowercase();
            if lower.contains("permission") {
                return Some(AgentEvent::ApprovalNeeded {
                    agent: "claude-code".into(),
                    session_id,
                    cwd,
                    tool: extract_tool(&message).unwrap_or_else(|| "unknown".into()),
                    prompt_text: message,
                    ts: now,
                });
            }
            Some(AgentEvent::IdlePrompt {
                agent: "claude-code".into(),
                session_id,
                cwd,
                prompt_text: message,
                ts: now,
            })
        }
        "Stop" => Some(AgentEvent::TaskCompleted {
            agent: "claude-code".into(),
            session_id,
            cwd,
            summary: "会话回合完成".into(),
            ts: now,
        }),
        _ => None,
    }
}

/// 从 "… to use Bash" / "… to use mcp__foo__bar" 提取工具名
fn extract_tool(message: &str) -> Option<String> {
    let idx = message.find("to use ")?;
    let rest = &message[idx + "to use ".len()..];
    let tool: String = rest
        .chars()
        .take_while(|c| c.is_alphanumeric() || *c == '_')
        .collect();
    if tool.is_empty() {
        None
    } else {
        Some(tool)
    }
}

const MARKER: &str = "desktop-assistant";

fn hook_entry(endpoint: &str) -> Value {
    json!({
        "matcher": "",
        "hooks": [{
            "type": "command",
            "command": format!(
                "curl -s -m 3 -X POST {endpoint}/event -H 'Content-Type: application/json' -d @- # {MARKER}"
            )
        }]
    })
}

fn is_ours(entry: &Value) -> bool {
    entry["hooks"]
        .as_array()
        .map(|hooks| {
            hooks.iter().any(|h| {
                h["command"]
                    .as_str()
                    .map(|c| c.contains(MARKER))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

/// 合并 hook 配置（幂等；替换旧 endpoint；保留用户条目）
pub fn merge_hook_config(existing: &str, endpoint: &str) -> Result<String, String> {
    let mut root: Value = if existing.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(existing).map_err(|e| format!("settings.json 非法: {e}"))?
    };
    if !root.is_object() {
        return Err("settings.json 顶层必须是对象".into());
    }

    let hooks = root
        .as_object_mut()
        .unwrap()
        .entry("hooks")
        .or_insert_with(|| json!({}));
    if !hooks.is_object() {
        return Err("hooks 字段必须是对象".into());
    }

    for event in ["Notification", "Stop"] {
        let arr = hooks
            .as_object_mut()
            .unwrap()
            .entry(event)
            .or_insert_with(|| json!([]));
        let list = arr.as_array_mut().ok_or(format!("hooks.{event} 必须是数组"))?;
        list.retain(|entry| !is_ours(entry));
        list.push(hook_entry(endpoint));
    }

    serde_json::to_string_pretty(&root).map_err(|e| e.to_string())
}

/// 移除本应用 hook 条目，保留用户条目
pub fn remove_hook_config(existing: &str) -> Result<String, String> {
    let mut root: Value =
        serde_json::from_str(existing).map_err(|e| format!("settings.json 非法: {e}"))?;
    if let Some(hooks) = root.get_mut("hooks").and_then(|h| h.as_object_mut()) {
        for (_, arr) in hooks.iter_mut() {
            if let Some(list) = arr.as_array_mut() {
                list.retain(|entry| !is_ours(entry));
            }
        }
        hooks.retain(|_, v| !v.as_array().map(|a| a.is_empty()).unwrap_or(false));
    }
    serde_json::to_string_pretty(&root).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notif(message: &str) -> Value {
        json!({
            "hook_event_name": "Notification",
            "session_id": "s1",
            "cwd": "/proj",
            "message": message
        })
    }

    #[test]
    fn h01_permission_bash() {
        let e = parse_hook_payload(&notif("Claude needs your permission to use Bash"), 1).unwrap();
        match e {
            AgentEvent::ApprovalNeeded { tool, session_id, .. } => {
                assert_eq!(tool, "Bash");
                assert_eq!(session_id, "s1");
            }
            _ => panic!("wrong kind"),
        }
    }

    #[test]
    fn h02_permission_mcp_tool() {
        let e =
            parse_hook_payload(&notif("needs your permission to use mcp__foo__bar"), 1).unwrap();
        match e {
            AgentEvent::ApprovalNeeded { tool, .. } => assert_eq!(tool, "mcp__foo__bar"),
            _ => panic!(),
        }
    }

    #[test]
    fn h03_waiting_input_idle() {
        let e = parse_hook_payload(&notif("Claude is waiting for your input"), 1).unwrap();
        assert!(matches!(e, AgentEvent::IdlePrompt { .. }));
    }

    #[test]
    fn h04_other_message_idle_fallback() {
        let e = parse_hook_payload(&notif("auth success"), 1).unwrap();
        assert!(matches!(e, AgentEvent::IdlePrompt { .. }));
    }

    #[test]
    fn h05_stop_completed() {
        let p = json!({"hook_event_name": "Stop", "session_id": "s2", "cwd": "/p"});
        let e = parse_hook_payload(&p, 1).unwrap();
        assert!(matches!(e, AgentEvent::TaskCompleted { .. }));
    }

    #[test]
    fn h06_h07_h08_invalid_inputs() {
        assert!(parse_hook_payload(&json!({"session_id": "x"}), 1).is_none());
        assert!(parse_hook_payload(&json!({"hook_event_name": "PreToolUse"}), 1).is_none());
        assert!(parse_hook_payload(&json!(["array"]), 1).is_none());
        assert!(parse_hook_payload(&json!("string"), 1).is_none());
    }

    #[test]
    fn h09_missing_fields_fallback() {
        let p = json!({"hook_event_name": "Notification", "message": "needs your permission to use Edit"});
        let e = parse_hook_payload(&p, 1).unwrap();
        match e {
            AgentEvent::ApprovalNeeded { session_id, cwd, .. } => {
                assert_eq!(session_id, "unknown");
                assert_eq!(cwd, "");
            }
            _ => panic!(),
        }
    }

    const EP: &str = "http://127.0.0.1:7321";

    #[test]
    fn c01_empty_input_generates_config() {
        let out = merge_hook_config("", EP).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert!(v["hooks"]["Notification"].as_array().unwrap().len() == 1);
        assert!(v["hooks"]["Stop"].as_array().unwrap().len() == 1);
        assert!(out.contains("desktop-assistant"));
    }

    #[test]
    fn c02_preserves_user_hooks() {
        let existing = r#"{"hooks":{"Notification":[{"matcher":"","hooks":[{"type":"command","command":"my-own-thing"}]}]},"model":"opus"}"#;
        let out = merge_hook_config(existing, EP).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["model"], "opus");
        let n = v["hooks"]["Notification"].as_array().unwrap();
        assert_eq!(n.len(), 2);
        assert!(out.contains("my-own-thing"));
    }

    #[test]
    fn c03_idempotent() {
        let once = merge_hook_config("", EP).unwrap();
        let twice = merge_hook_config(&once, EP).unwrap();
        assert_eq!(once, twice);
    }

    #[test]
    fn c04_replaces_old_endpoint() {
        let old = merge_hook_config("", "http://127.0.0.1:9999").unwrap();
        let new = merge_hook_config(&old, EP).unwrap();
        assert!(!new.contains("9999"));
        assert!(new.contains("7321"));
        let v: Value = serde_json::from_str(&new).unwrap();
        assert_eq!(v["hooks"]["Notification"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn c05_invalid_json_err() {
        assert!(merge_hook_config("{not json", EP).is_err());
    }

    #[test]
    fn c06_remove_keeps_user_entries() {
        let existing = r#"{"hooks":{"Notification":[{"matcher":"","hooks":[{"type":"command","command":"my-own-thing"}]}]}}"#;
        let merged = merge_hook_config(existing, EP).unwrap();
        let removed = remove_hook_config(&merged).unwrap();
        assert!(removed.contains("my-own-thing"));
        assert!(!removed.contains("desktop-assistant"));
    }
}
