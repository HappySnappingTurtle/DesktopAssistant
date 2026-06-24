use serde_json::{json, Value};

const KEYRING_SERVICE: &str = "desktop-assistant";

pub fn default_config() -> Value {
    json!({
        "approval_mode": "safe-list",
        "muted": false,
        "onboarded": false,
        "active_character": "hiyori",
        "llm": {
            "provider": "openai-compatible",
            "base_url": "http://127.0.0.1:11434/v1",
            "model": "qwen3:8b"
        },
        "approval_rules": {
            "auto": ["Read", "Grep", "Glob", "LS", "ListDir", "SearchDir"],
            "notify": ["Write", "Edit", "NotebookEdit", "CreateFile"],
            "confirm": ["Bash", "WebFetch", "WebSearch", "BrowserAction"],
            "block_patterns": [
                "rm\\s+(-[a-z]*[rf][a-z]*\\s+)+",
                "\\bsudo\\s",
                "chmod\\s+777",
                "git\\s+push\\b[^\\n]*--force",
                "\\bcurl\\b[^|\\n]*\\|\\s*(ba|z)?sh",
                "\\bwget\\b[^|\\n]*\\|\\s*(ba|z)?sh",
                ">\\s*/etc/",
                "gh\\s+repo\\s+delete",
                "drop\\s+(table|database)",
                "\\bmkfs\\b",
                "\\bdd\\s+if="
            ]
        },
        "result_report_level": "notify",
        "mode_shortcut": "Cmd+Shift+A"
    })
}

/// 读配置：缺失/损坏 → 默认（不 panic）
pub fn load_config_from(text: Option<&str>) -> Value {
    match text {
        Some(t) => match serde_json::from_str::<Value>(t) {
            Ok(v) if v.is_object() => merge(default_config(), v),
            _ => default_config(),
        },
        None => default_config(),
    }
}

/// 深合并：patch 覆盖 base（对象递归，其他直接替换）
pub fn merge(base: Value, patch: Value) -> Value {
    match (base, patch) {
        (Value::Object(mut b), Value::Object(p)) => {
            for (k, v) in p {
                let merged = match b.remove(&k) {
                    Some(old) => merge(old, v),
                    None => v,
                };
                b.insert(k, merged);
            }
            Value::Object(b)
        }
        (_, p) => p,
    }
}

#[tauri::command]
pub fn get_config() -> Value {
    let text = std::fs::read_to_string(crate::paths::config_path()).ok();
    load_config_from(text.as_deref())
}

#[tauri::command]
pub fn set_config(patch: Value) -> Result<Value, String> {
    let current = get_config();
    let merged = merge(current, patch);
    let path = crate::paths::config_path();
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&path, serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    Ok(merged)
}

#[tauri::command]
pub fn set_secret(name: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &name).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())?;
    invalidate_secret_cache(&name); // 清除旧缓存，下次 get 会重新读取
    Ok(())
}

#[tauri::command]
pub fn has_secret(name: String) -> bool {
    keyring::Entry::new(KEYRING_SERVICE, &name)
        .and_then(|e| e.get_password())
        .is_ok()
}

/// 内存缓存——避免每次 LLM 调用都触发 Keychain 授权弹窗
static SECRET_CACHE: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<String, String>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));

pub fn get_secret(name: &str) -> Option<String> {
    // 先查缓存
    if let Some(val) = SECRET_CACHE.lock().ok()?.get(name) {
        return Some(val.clone());
    }
    // 缓存未命中→从 Keychain 读取（可能弹密码框，但只弹一次）
    let val = keyring::Entry::new(KEYRING_SERVICE, name)
        .and_then(|e| e.get_password())
        .ok()?;
    SECRET_CACHE.lock().ok()?.insert(name.to_string(), val.clone());
    Some(val)
}

/// 写入密钥时同步更新缓存
pub fn invalidate_secret_cache(name: &str) {
    if let Ok(mut cache) = SECRET_CACHE.lock() {
        cache.remove(name);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn c01_defaults() {
        let c = default_config();
        assert_eq!(c["approval_mode"], "safe-list");
        assert_eq!(c["muted"], false);
    }

    #[test]
    fn c03_corrupt_falls_back() {
        assert_eq!(load_config_from(Some("{not json")), default_config());
        assert_eq!(load_config_from(Some("[1,2]")), default_config());
        assert_eq!(load_config_from(None), default_config());
    }

    #[test]
    fn c04_merge_partial_keeps_rest() {
        let merged = merge(default_config(), json!({"llm": {"model": "llama3"}}));
        assert_eq!(merged["llm"]["model"], "llama3");
        assert_eq!(merged["llm"]["provider"], "openai-compatible");
        assert_eq!(merged["approval_mode"], "safe-list");
    }

    #[test]
    fn c02_loaded_overrides_defaults() {
        let loaded = load_config_from(Some(r#"{"muted": true}"#));
        assert_eq!(loaded["muted"], true);
        assert_eq!(loaded["approval_mode"], "safe-list");
    }
}
