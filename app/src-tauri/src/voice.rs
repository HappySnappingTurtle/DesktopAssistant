use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Emitter;

pub const TARGET_RATE: u32 = 16_000;

pub struct RecorderState(pub Mutex<Option<Recording>>);

pub struct Recording {
    samples: Arc<Mutex<Vec<f32>>>,
    source_rate: u32,
    active: Arc<AtomicBool>,
    // Stream 不是 Send：保活在录音线程内，用 active 标志结束
}

/// 线性重采样到 16kHz 单声道
pub fn resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate || samples.is_empty() {
        return samples.to_vec();
    }
    let ratio = from_rate as f64 / to_rate as f64;
    let out_len = (samples.len() as f64 / ratio) as usize;
    (0..out_len)
        .map(|i| {
            let pos = i as f64 * ratio;
            let idx = pos as usize;
            let frac = pos - idx as f64;
            let a = samples[idx.min(samples.len() - 1)];
            let b = samples[(idx + 1).min(samples.len() - 1)];
            a + (b - a) * frac as f32
        })
        .collect()
}

pub fn write_wav_16k(samples: &[f32], source_rate: u32, path: &std::path::Path) -> Result<(), String> {
    let resampled = resample(samples, source_rate, TARGET_RATE);
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: TARGET_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(path, spec).map_err(|e| e.to_string())?;
    for s in resampled {
        writer
            .write_sample((s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)
            .map_err(|e| e.to_string())?;
    }
    writer.finalize().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn voice_start_recording(state: tauri::State<'_, RecorderState>) -> Result<(), String> {
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    if slot.is_some() {
        return Ok(()); // 已在录音
    }

    let samples: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
    let active = Arc::new(AtomicBool::new(true));

    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or("找不到麦克风设备")?;
    let config = device
        .default_input_config()
        .map_err(|e| format!("无法读取输入配置: {e}"))?;
    let source_rate = config.sample_rate();
    let channels = config.channels() as usize;

    {
        let samples = samples.clone();
        let active = active.clone();
        std::thread::spawn(move || {
            let stream = device.build_input_stream(
                config.into(),
                move |data: &[f32], _| {
                    // 多声道 → 单声道（取均值）
                    let mut buf = samples.lock().unwrap();
                    for frame in data.chunks(channels) {
                        buf.push(frame.iter().sum::<f32>() / channels as f32);
                    }
                },
                |e| eprintln!("[voice] stream error: {e}"),
                None,
            );
            match stream {
                Ok(s) => {
                    if s.play().is_ok() {
                        while active.load(Ordering::Relaxed) {
                            std::thread::sleep(std::time::Duration::from_millis(50));
                        }
                    }
                    drop(s);
                }
                Err(e) => eprintln!("[voice] build stream failed: {e}"),
            }
        });
    }

    *slot = Some(Recording { samples, source_rate, active });
    Ok(())
}

pub fn transcribe_wav(wav: &std::path::Path) -> Result<String, String> {
    let model = crate::paths::whisper_model_path();
    if !model.exists() {
        return Err(format!("whisper 模型缺失: {}", model.display()));
    }
    let out = std::process::Command::new(crate::paths::whisper_bin())
        .args(["-m"])
        .arg(&model)
        .args(["-l", "zh", "-nt", "-np", "-f"])
        .arg(wav)
        .output()
        .map_err(|e| format!("whisper-cli 启动失败（未安装？）: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "whisper-cli 失败: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[tauri::command]
pub async fn voice_stop_and_transcribe(
    app: tauri::AppHandle,
    state: tauri::State<'_, RecorderState>,
) -> Result<String, String> {
    let recording = state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or("没有进行中的录音")?;

    recording.active.store(false, Ordering::Relaxed);
    std::thread::sleep(std::time::Duration::from_millis(80)); // 让流停稳

    let samples = recording.samples.lock().unwrap().clone();
    if samples.len() < (recording.source_rate as usize / 5) {
        return Err("录音太短".into());
    }

    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let wav = std::env::temp_dir().join(format!("da-voice-{}.wav", std::process::id()));
        write_wav_16k(&samples, recording.source_rate, &wav)?;
        let text = transcribe_wav(&wav)?;
        let _ = std::fs::remove_file(&wav);
        let _ = app2.emit("voice://transcript", serde_json::json!({ "text": text }));
        Ok(text)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resample_halves_length() {
        let input: Vec<f32> = (0..32000).map(|i| (i as f32 / 100.0).sin()).collect();
        let out = resample(&input, 32000, 16000);
        assert!((out.len() as i64 - 16000).abs() <= 1);
    }

    #[test]
    fn resample_same_rate_identity() {
        let input = vec![0.1f32, 0.2, 0.3];
        assert_eq!(resample(&input, 16000, 16000), input);
    }

    #[test]
    fn wav_written_at_16k() {
        let samples: Vec<f32> = (0..48000).map(|i| (i as f32 / 50.0).sin() * 0.5).collect();
        let path = std::env::temp_dir().join("da-test-16k.wav");
        write_wav_16k(&samples, 48000, &path).unwrap();
        let reader = hound::WavReader::open(&path).unwrap();
        assert_eq!(reader.spec().sample_rate, 16000);
        assert_eq!(reader.spec().channels, 1);
        let _ = std::fs::remove_file(&path);
    }
}
