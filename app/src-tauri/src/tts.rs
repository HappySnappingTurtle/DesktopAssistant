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

/// 返回 base64 mp3（前端拼 data:audio/mpeg;base64, 前缀）
#[tauri::command]
pub async fn tts_synthesize(
    text: String,
    voice: String,
    pitch: String,
    rate: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = synthesize_blocking(&text, &voice, &pitch, &rate)?;
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    })
    .await
    .map_err(|e| e.to_string())?
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
}

#[cfg(test)]
mod integration {
    use super::*;

    #[test]
    #[ignore = "需要网络：cargo test -- --ignored 显式运行"]
    fn synthesizes_real_mp3() {
        let bytes = synthesize_blocking("你好，我是三月七", "zh-CN-XiaoyiNeural", "+2Hz", "+3%")
            .expect("合成失败");
        assert!(bytes.len() > 1024, "音频太小: {} bytes", bytes.len());
    }
}
