use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Clone, Debug, Deserialize)]
pub struct ChatMessage {
    pub role: String, // "user" | "assistant"
    pub content: String,
}

pub struct LlmRequest {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Value,
}

const MAX_HISTORY: usize = 16; // 8 轮对话

/// 截取最近 MAX_HISTORY 条（system 由调用方单独传）
pub fn truncate_history(messages: &[ChatMessage]) -> &[ChatMessage] {
    if messages.len() > MAX_HISTORY {
        &messages[messages.len() - MAX_HISTORY..]
    } else {
        messages
    }
}

pub fn build_request(
    provider: &str,
    base_url: &str,
    model: &str,
    api_key: Option<&str>,
    system: &str,
    messages: &[ChatMessage],
) -> Result<LlmRequest, String> {
    let messages = truncate_history(messages);
    let msgs_json: Vec<Value> = messages
        .iter()
        .map(|m| json!({"role": m.role, "content": m.content}))
        .collect();

    match provider {
        "anthropic" => {
            let key = api_key.ok_or("Anthropic 需要 API key")?;
            Ok(LlmRequest {
                url: format!("{}/v1/messages", base_url.trim_end_matches('/')),
                headers: vec![
                    ("x-api-key".into(), key.into()),
                    ("anthropic-version".into(), "2023-06-01".into()),
                ],
                body: json!({
                    "model": model,
                    "max_tokens": 512,
                    "system": system,
                    "messages": msgs_json
                }),
            })
        }
        "openai-compatible" => {
            let mut headers = vec![];
            if let Some(key) = api_key {
                headers.push(("Authorization".into(), format!("Bearer {key}")));
            }
            let mut all = vec![json!({"role": "system", "content": system})];
            all.extend(msgs_json);
            Ok(LlmRequest {
                url: format!("{}/chat/completions", base_url.trim_end_matches('/')),
                headers,
                body: json!({ "model": model, "messages": all }),
            })
        }
        "ollama" => {
            let mut all = vec![json!({"role": "system", "content": system})];
            all.extend(msgs_json);
            Ok(LlmRequest {
                url: format!("{}/api/chat", base_url.trim_end_matches('/')),
                headers: vec![],
                body: json!({ "model": model, "messages": all, "stream": false }),
            })
        }
        other => Err(format!("未知 provider: {other}")),
    }
}

pub fn parse_reply(provider: &str, response: &Value) -> Result<String, String> {
    let text = match provider {
        "anthropic" => response["content"][0]["text"].as_str(),
        "openai-compatible" => response["choices"][0]["message"]["content"].as_str(),
        "ollama" => response["message"]["content"].as_str(),
        _ => None,
    };
    text.map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("响应解析失败: {}", truncate_debug(response)))
}

fn truncate_debug(v: &Value) -> String {
    let s = v.to_string();
    s.chars().take(200).collect()
}

#[tauri::command]
pub async fn llm_chat(system: String, messages: Vec<ChatMessage>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = crate::config::get_config();
        let llm = &config["llm"];
        let provider = llm["provider"].as_str().unwrap_or("openai-compatible").to_string();
        let base_url = llm["base_url"].as_str().unwrap_or("").to_string();
        let model = llm["model"].as_str().unwrap_or("").to_string();
        let api_key = crate::config::get_secret("llm_api_key");

        let req = build_request(&provider, &base_url, &model, api_key.as_deref(), &system, &messages)?;

        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(std::time::Duration::from_secs(60)))
            .build()
            .into();
        let mut http = agent.post(&req.url);
        for (k, v) in &req.headers {
            http = http.header(k, v);
        }
        let mut resp = http
            .send_json(&req.body)
            .map_err(|e| format!("LLM 请求失败: {e}"))?;
        let body: Value = resp
            .body_mut()
            .read_json()
            .map_err(|e| format!("LLM 响应读取失败: {e}"))?;
        parse_reply(&provider, &body)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msgs(n: usize) -> Vec<ChatMessage> {
        (0..n)
            .map(|i| ChatMessage {
                role: if i % 2 == 0 { "user" } else { "assistant" }.into(),
                content: format!("m{i}"),
            })
            .collect()
    }

    #[test]
    fn l01_anthropic_body() {
        let r = build_request("anthropic", "https://api.anthropic.com", "claude-sonnet-4-6", Some("sk-x"), "你是三月七", &msgs(2)).unwrap();
        assert!(r.url.ends_with("/v1/messages"));
        assert_eq!(r.body["system"], "你是三月七");
        assert_eq!(r.body["messages"].as_array().unwrap().len(), 2);
        assert!(r.headers.iter().any(|(k, _)| k == "x-api-key"));
    }

    #[test]
    fn l02_openai_body_system_first() {
        let r = build_request("openai-compatible", "http://127.0.0.1:11434/v1/", "qwen3", None, "sys", &msgs(2)).unwrap();
        assert!(r.url.ends_with("/chat/completions"));
        let all = r.body["messages"].as_array().unwrap();
        assert_eq!(all[0]["role"], "system");
        assert_eq!(all.len(), 3);
    }

    #[test]
    fn l03_ollama_body() {
        let r = build_request("ollama", "http://127.0.0.1:11434", "qwen3", None, "sys", &msgs(1)).unwrap();
        assert!(r.url.ends_with("/api/chat"));
        assert_eq!(r.body["stream"], false);
    }

    #[test]
    fn l04_history_truncated() {
        let m = msgs(30);
        let r = build_request("ollama", "http://x", "m", None, "s", &m).unwrap();
        // system + 16
        assert_eq!(r.body["messages"].as_array().unwrap().len(), 17);
        let last = r.body["messages"].as_array().unwrap().last().unwrap();
        assert_eq!(last["content"], "m29");
    }

    #[test]
    fn l07_parse_replies() {
        assert_eq!(
            parse_reply("anthropic", &json!({"content":[{"type":"text","text":" hi "}]})).unwrap(),
            "hi"
        );
        assert_eq!(
            parse_reply("openai-compatible", &json!({"choices":[{"message":{"content":"yo"}}]})).unwrap(),
            "yo"
        );
        assert_eq!(
            parse_reply("ollama", &json!({"message":{"content":"嗨"}})).unwrap(),
            "嗨"
        );
        assert!(parse_reply("ollama", &json!({"weird": 1})).is_err());
        assert!(parse_reply("anthropic", &json!({"content":[]})).is_err());
    }

    #[test]
    fn unknown_provider_err() {
        assert!(build_request("gpt9", "x", "m", None, "s", &[]).is_err());
    }

    #[test]
    fn anthropic_without_key_err() {
        assert!(build_request("anthropic", "x", "m", None, "s", &[]).is_err());
    }
}
