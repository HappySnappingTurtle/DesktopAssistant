use base64::Engine;
use msedge_tts::tts::client::connect;
use msedge_tts::tts::SpeechConfig;

/// "+2Hz" / "-3%" / "+0" → 2 / -3 / 0（解析失败 → 0）
pub fn parse_signed_number(s: &str) -> i32 {
    let cleaned: String = s
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '-' || *c == '+')
        .collect();
    cleaned.trim_start_matches('+').parse().unwrap_or(0)
}

fn ensure_crypto_provider() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

/// Edge TTS 情绪风格映射（XiaoyiNeural / XiaoxiaoNeural 支持这些风格）
fn emotion_to_style(emotion: &str) -> Option<&'static str> {
    match emotion {
        "happy" | "excited" => Some("cheerful"),
        "sad" => Some("sad"),
        "angry" => Some("angry"),
        "shy" => Some("gentle"),
        "worried" => Some("fearful"),
        "surprised" => Some("surprised"),
        "curious" => Some("friendly"),
        _ => None,
    }
}

/// 转义 SSML 特殊字符
fn escape_ssml(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

pub fn synthesize_blocking(
    text: &str,
    voice: &str,
    pitch: &str,
    rate: &str,
) -> Result<Vec<u8>, String> {
    ensure_crypto_provider();
    let config = SpeechConfig {
        voice_name: voice.to_string(),
        audio_format: "audio-24khz-48kbitrate-mono-mp3".to_string(),
        pitch: parse_signed_number(pitch),
        rate: parse_signed_number(rate),
        volume: 0,
    };
    let mut client = connect().map_err(|e| format!("edge-tts 连接失败: {e:?}"))?;
    let audio = client
        .synthesize(text, &config)
        .map_err(|e| format!("edge-tts 合成失败: {e:?}"))?;
    if audio.audio_bytes.is_empty() {
        return Err("edge-tts 返回空音频".into());
    }
    Ok(audio.audio_bytes)
}

/// 带情绪风格的 SSML 合成——使用 mstts:express-as 标签
/// 支持风格的声音：XiaoyiNeural, XiaoxiaoNeural, YunxiNeural, YunjianNeural 等
pub fn synthesize_with_emotion(
    text: &str,
    voice: &str,
    pitch: &str,
    rate: &str,
    emotion: &str,
    intensity: f32,
) -> Result<Vec<u8>, String> {
    ensure_crypto_provider();

    let style = emotion_to_style(emotion);
    let escaped = escape_ssml(text);
    let pitch_val = parse_signed_number(pitch);
    let rate_val = parse_signed_number(rate);
    // styledegree: 0.01~2.0，映射 intensity 0~1 → 0.5~2.0
    let degree = 0.5 + intensity * 1.5;

    let ssml_body = if let Some(style_name) = style {
        format!(
            "<mstts:express-as style=\"{}\" styledegree=\"{:.2}\">\
             <prosody pitch=\"{:+}Hz\" rate=\"{:+}%\">{}</prosody>\
             </mstts:express-as>",
            style_name, degree, pitch_val, rate_val, escaped
        )
    } else {
        format!(
            "<prosody pitch=\"{:+}Hz\" rate=\"{:+}%\">{}</prosody>",
            pitch_val, rate_val, escaped
        )
    };

    let ssml = format!(
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' \
         xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='zh-CN'>\
         <voice name='{}'>{}</voice></speak>",
        voice, ssml_body
    );

    // 直接通过 msedge-tts 底层发送自定义 SSML
    let config = SpeechConfig {
        voice_name: voice.to_string(),
        audio_format: "audio-24khz-48kbitrate-mono-mp3".to_string(),
        pitch: pitch_val,
        rate: rate_val,
        volume: 0,
    };
    let mut client = connect().map_err(|e| format!("edge-tts 连接失败: {e:?}"))?;

    // 先尝试带情绪风格的合成
    // msedge-tts 的 synthesize 内部会构建 SSML，我们直接用它（暂不注入 express-as，
    // 因为 crate 不暴露原始 SSML 接口）。
    // 折中方案：用 synthesize 做基础合成，情绪通过 pitch/rate 偏移模拟。
    // 未来接入 GPT-SoVITS/CosyVoice 后情绪表达才真正自然。
    //
    // 实际 pitch/rate 已在前端 emotionAdapter 中根据情绪调整过了，这里直接用。
    let audio = client
        .synthesize(text, &config)
        .map_err(|e| format!("edge-tts 合成失败: {e:?}"))?;

    if audio.audio_bytes.is_empty() {
        return Err("edge-tts 返回空音频".into());
    }
    Ok(audio.audio_bytes)
}

/// 统一入口：根据 tts_provider 配置分发到不同后端
#[tauri::command]
pub async fn tts_synthesize(
    text: String,
    voice: String,
    pitch: String,
    rate: String,
    emotion: Option<String>,
    intensity: Option<f32>,
    provider: Option<String>,
    provider_url: Option<String>,
    prompt_text: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let provider = provider.as_deref().unwrap_or("edge-tts");
        let bytes = match provider {
            "gpt-sovits" => {
                let url = provider_url.as_deref().unwrap_or("http://127.0.0.1:9880");
                let pt = prompt_text.as_deref().unwrap_or("");
                synthesize_gpt_sovits(&text, url, &voice, pt)?
            }
            "cosyvoice" => {
                let url = provider_url.as_deref().unwrap_or("http://127.0.0.1:50000");
                synthesize_cosyvoice(&text, url, &voice)?
            }
            _ => {
                // edge-tts（默认）
                synthesize_blocking(&text, &voice, &pitch, &rate)?
            }
        };
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 解析 ref_audio 路径：manifest 中的 `/voice-refs/xxx.mp3` → 绝对文件路径
fn resolve_ref_audio_path(path: &str) -> String {
    if path.starts_with('/') && !std::path::Path::new(path).exists() {
        // 尝试解析为 public/ 下的资源（dev 模式从 src-tauri/ 运行）
        let trimmed = path.trim_start_matches('/');
        let candidates = [
            std::path::PathBuf::from("../public").join(trimmed),
            std::path::PathBuf::from("public").join(trimmed),
        ];
        for c in &candidates {
            if c.exists() {
                if let Ok(abs) = c.canonicalize() {
                    return abs.to_string_lossy().to_string();
                }
            }
        }
    }
    path.to_string()
}

/// GPT-SoVITS HTTP API 合成
fn synthesize_gpt_sovits(text: &str, base_url: &str, refer_voice: &str, prompt_text: &str) -> Result<Vec<u8>, String> {
    ensure_crypto_provider();
    let url = format!("{}/tts", base_url.trim_end_matches('/'));

    let resolved_ref = resolve_ref_audio_path(refer_voice);
    eprintln!("[gpt-sovits] text={} ref={} prompt_text={}", &text[..text.len().min(30)], &resolved_ref, &prompt_text[..prompt_text.len().min(30)]);
    let mut body = serde_json::json!({
        "text": text,
        "text_lang": "zh",
        "ref_audio_path": resolved_ref,
        "prompt_lang": "zh",
        "text_split_method": "cut5",
    });
    if !prompt_text.is_empty() {
        body["prompt_text"] = serde_json::Value::String(prompt_text.to_string());
    }
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(90)))
        .build()
        .into();
    let resp = agent
        .post(&url)
        .send_json(&body)
        .map_err(|e| format!("GPT-SoVITS 请求失败: {e}"))?;
    let bytes = resp.into_body().read_to_vec()
        .map_err(|e| format!("GPT-SoVITS 读取失败: {e}"))?;
    if bytes.len() < 100 {
        return Err(format!("GPT-SoVITS 返回太短: {} bytes", bytes.len()));
    }
    Ok(bytes)
}

/// CosyVoice 2 HTTP API 合成
fn synthesize_cosyvoice(text: &str, base_url: &str, refer_voice: &str) -> Result<Vec<u8>, String> {
    ensure_crypto_provider();
    let url = format!("{}/inference_zero_shot", base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "tts_text": text,
        "prompt_text": "",
        "prompt_wav": refer_voice,
    });
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(30)))
        .build()
        .into();
    let resp = agent
        .post(&url)
        .send_json(&body)
        .map_err(|e| format!("CosyVoice 请求失败: {e}"))?;
    let bytes = resp.into_body().read_to_vec()
        .map_err(|e| format!("CosyVoice 读取失败: {e}"))?;
    if bytes.len() < 100 {
        return Err(format!("CosyVoice 返回太短: {} bytes", bytes.len()));
    }
    Ok(bytes)
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_signed_numbers() {
        assert_eq!(parse_signed_number("+2Hz"), 2);
        assert_eq!(parse_signed_number("-3%"), -3);
        assert_eq!(parse_signed_number("+0Hz"), 0);
        assert_eq!(parse_signed_number("garbage"), 0);
        assert_eq!(parse_signed_number("15"), 15);
    }

    #[test]
    fn emotion_style_mapping() {
        assert_eq!(emotion_to_style("happy"), Some("cheerful"));
        assert_eq!(emotion_to_style("sad"), Some("sad"));
        assert_eq!(emotion_to_style("neutral"), None);
        assert_eq!(emotion_to_style("thinking"), None);
    }

    #[test]
    fn ssml_escaping() {
        assert_eq!(escape_ssml("a<b>c&d"), "a&lt;b&gt;c&amp;d");
    }
}

#[cfg(test)]
mod integration {
    use super::*;

    #[test]
    #[ignore = "需要网络：cargo test -- --ignored 显式运行"]
    fn synthesizes_real_mp3() {
        let bytes = synthesize_blocking("你好，我是三月七", "zh-CN-XiaoyiNeural", "+5Hz", "+8%")
            .expect("合成失败");
        assert!(bytes.len() > 1024, "音频太小: {} bytes", bytes.len());
    }
}
