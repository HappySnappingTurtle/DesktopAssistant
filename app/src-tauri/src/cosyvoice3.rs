use serde::{Deserialize, Serialize};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

pub struct CosyVoice3State(pub Mutex<Option<Child>>);

#[derive(Serialize)]
pub struct EnvCheckResult {
    pub python_available: bool,
    pub python_version: String,
    pub python_path: String,
    pub platform: String,
    pub gpu_cores: u32,
    pub ram_gb: f64,
    pub mlx_compatible: bool,
    pub performance_warning: Option<String>,
    pub already_installed: bool,
    pub model_downloaded: bool,
}

#[derive(Serialize, Deserialize)]
pub struct CosyVoice3Status {
    pub installed: bool,
    pub model_downloaded: bool,
    pub server_running: bool,
    pub server_url: Option<String>,
    pub server_pid: Option<u32>,
}

fn detect_platform() -> String {
    let arch = std::env::consts::ARCH;
    let os = std::env::consts::OS;
    format!("{os}-{arch}")
}

fn detect_python() -> (bool, String, String) {
    for cmd in &["python3.11", "python3.12", "python3.10", "python3"] {
        if let Ok(out) = Command::new(cmd).arg("--version").output() {
            if out.status.success() {
                let ver = String::from_utf8_lossy(&out.stdout).trim().to_string();
                let ver = ver.strip_prefix("Python ").unwrap_or(&ver).to_string();
                if let Some(minor) = ver.split('.').nth(1).and_then(|s| s.parse::<u32>().ok()) {
                    if (10..=12).contains(&minor) {
                        let path = which_python(cmd).unwrap_or_else(|| cmd.to_string());
                        return (true, ver, path);
                    }
                }
            }
        }
    }
    (false, String::new(), String::new())
}

fn which_python(cmd: &str) -> Option<String> {
    Command::new("which").arg(cmd).output().ok()
        .and_then(|o| if o.status.success() {
            Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
        } else { None })
}

#[cfg(target_os = "macos")]
fn detect_gpu_cores() -> u32 {
    Command::new("sysctl").arg("-n").arg("machdep.gpu.core_count")
        .output().ok()
        .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse().ok())
        .unwrap_or(0)
}

#[cfg(not(target_os = "macos"))]
fn detect_gpu_cores() -> u32 { 0 }

fn detect_ram_gb() -> f64 {
    #[cfg(target_os = "macos")]
    {
        Command::new("sysctl").arg("-n").arg("hw.memsize")
            .output().ok()
            .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse::<u64>().ok())
            .map(|b| b as f64 / 1024.0 / 1024.0 / 1024.0)
            .unwrap_or(0.0)
    }
    #[cfg(not(target_os = "macos"))]
    { 0.0 }
}

pub fn generate_performance_warning(platform: &str, ram_gb: f64, gpu_cores: u32) -> Option<String> {
    if ram_gb > 0.0 && ram_gb < 8.0 {
        return Some("内存不足 8GB，CosyVoice3 可能无法运行".into());
    }
    if !platform.contains("aarch64") && platform.contains("macos") {
        return Some("当前为 Intel Mac，不支持 MLX 加速，推理极慢".into());
    }
    if !platform.contains("macos") {
        return Some("当前平台暂不支持 MLX 加速，将使用 CPU 推理（较慢）".into());
    }
    if ram_gb < 16.0 {
        return Some(format!(
            "内存 {ram_gb:.0}GB：推理较慢（每句约 7-9 秒），建议仅在非实时场景使用"
        ));
    }
    if gpu_cores > 0 && gpu_cores < 10 {
        return Some(format!(
            "GPU {gpu_cores} 核心：推理较慢（每句约 7-9 秒），建议仅在非实时场景使用"
        ));
    }
    None
}

#[tauri::command]
pub async fn cosyvoice3_check_env() -> Result<EnvCheckResult, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let (python_available, python_version, python_path) = detect_python();
        let platform = detect_platform();
        let gpu_cores = detect_gpu_cores();
        let ram_gb = detect_ram_gb();
        let mlx_compatible = platform.contains("macos") && platform.contains("aarch64") && ram_gb >= 8.0;
        let performance_warning = generate_performance_warning(&platform, ram_gb, gpu_cores);
        let already_installed = crate::paths::cosyvoice3_python().exists();
        let model_downloaded = crate::paths::cosyvoice3_model_dir().join("model.safetensors").exists();

        Ok(EnvCheckResult {
            python_available, python_version, python_path,
            platform, gpu_cores, ram_gb, mlx_compatible,
            performance_warning, already_installed, model_downloaded,
        })
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn cosyvoice3_install(
    app: tauri::AppHandle,
    hf_mirror: Option<String>,
) -> Result<(), String> {
    let mirror = hf_mirror.unwrap_or_else(|| "https://hf-mirror.com".into());

    tauri::async_runtime::spawn_blocking(move || {
        let emit = |step: u32, total: u32, msg: &str| {
            let _ = app.emit("cosyvoice3://progress", serde_json::json!({
                "step": step, "total_steps": total, "message": msg,
                "percent": (step as f64 / total as f64 * 100.0) as u32,
            }));
        };

        let base = crate::paths::cosyvoice3_dir();
        let venv = crate::paths::cosyvoice3_venv();
        let model_dir = crate::paths::cosyvoice3_model_dir();

        // Step 1: create dirs
        emit(1, 5, "创建插件目录…");
        std::fs::create_dir_all(&base).map_err(|e| format!("创建目录失败: {e}"))?;
        std::fs::create_dir_all(base.join("voice-refs")).map_err(|e| format!("创建目录失败: {e}"))?;

        // Step 2: create venv
        if !venv.exists() {
            emit(2, 5, "创建 Python 虚拟环境…");
            let (ok, _, py_path) = detect_python();
            if !ok { return Err("未找到 Python 3.10-3.12，请先安装".into()); }
            let out = Command::new(&py_path).args(["-m", "venv"])
                .arg(&venv).output()
                .map_err(|e| format!("创建 venv 失败: {e}"))?;
            if !out.status.success() {
                return Err(format!("venv 创建失败: {}", String::from_utf8_lossy(&out.stderr)));
            }
        } else {
            emit(2, 5, "虚拟环境已存在，跳过");
        }

        // Step 3: install mlx-audio-plus
        emit(3, 5, "安装 mlx-audio-plus（约 2 分钟）…");
        let pip = crate::paths::cosyvoice3_python();
        let pip_path = pip.parent().unwrap().join("pip");
        let out = Command::new(&pip_path)
            .args(["install", "mlx-audio-plus", "huggingface_hub"])
            .env_remove("http_proxy").env_remove("https_proxy")
            .env_remove("HTTP_PROXY").env_remove("HTTPS_PROXY")
            .output()
            .map_err(|e| format!("pip install 失败: {e}"))?;
        if !out.status.success() {
            let log_path = base.join("install.log");
            let _ = std::fs::write(&log_path, &out.stderr);
            return Err(format!("pip install 失败，日志: {}", log_path.display()));
        }

        // Step 4: download model
        if !model_dir.join("model.safetensors").exists() {
            emit(4, 5, "下载 CosyVoice3 4-bit 模型（约 1.2GB）…");
            let py = crate::paths::cosyvoice3_python();
            let script = format!(
                "from huggingface_hub import snapshot_download; \
                 snapshot_download('mlx-community/Fun-CosyVoice3-0.5B-2512-4bit', local_dir='{}')",
                model_dir.display()
            );
            let out = Command::new(&py).args(["-c", &script])
                .env("HF_ENDPOINT", &mirror)
                .env_remove("http_proxy").env_remove("https_proxy")
                .env_remove("HTTP_PROXY").env_remove("HTTPS_PROXY")
                .output()
                .map_err(|e| format!("模型下载失败: {e}"))?;
            if !out.status.success() {
                return Err(format!("模型下载失败: {}", String::from_utf8_lossy(&out.stderr)));
            }
        } else {
            emit(4, 5, "模型已存在，跳过下载");
        }

        // Step 5: write status
        emit(5, 5, "安装完成 ✓");
        let status = serde_json::json!({
            "installed": true,
            "model_downloaded": true,
            "version": "0.1.0"
        });
        let _ = std::fs::write(
            crate::paths::cosyvoice3_status_file(),
            serde_json::to_string_pretty(&status).unwrap(),
        );

        Ok(())
    }).await.map_err(|e| e.to_string())?
}

pub async fn start_server_internal(app: &tauri::AppHandle, port: u16) -> Result<String, String> {
    let py = crate::paths::cosyvoice3_python();
    if !py.exists() {
        return Err("CosyVoice3 未安装，请先在设置中安装".into());
    }
    let model = crate::paths::cosyvoice3_model_dir();
    if !model.join("model.safetensors").exists() {
        return Err("CosyVoice3 模型未下载".into());
    }

    let child = Command::new(&py)
        .args(["-m", "mlx_audio.server", "--host", "127.0.0.1", "--port", &port.to_string()])
        .env("HF_HUB_OFFLINE", "1")
        .env_remove("http_proxy").env_remove("https_proxy")
        .env_remove("HTTP_PROXY").env_remove("HTTPS_PROXY")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动 CosyVoice3 服务失败: {e}"))?;

    let pid = child.id();
    let _ = std::fs::write(crate::paths::cosyvoice3_pid_file(), pid.to_string());

    let state = app.state::<CosyVoice3State>();
    *state.0.lock().map_err(|e| e.to_string())? = Some(child);

    let url = format!("http://127.0.0.1:{port}");
    let check_url = format!("{url}/v1/models");

    for i in 0..60 {
        std::thread::sleep(std::time::Duration::from_secs(1));
        if let Ok(resp) = ureq::get(&check_url).call() {
            if resp.status() == 200 {
                let _ = app.emit("cosyvoice3://started", serde_json::json!({ "url": &url }));
                eprintln!("[cosyvoice3] server ready at {url} (waited {i}s)");
                return Ok(url);
            }
        }
        // Check if process died
        let alive = {
            let mut guard = state.0.lock().map_err(|e| e.to_string())?;
            if let Some(ref mut c) = *guard {
                c.try_wait().map_err(|e| e.to_string())?.is_none()
            } else { false }
        };
        if !alive {
            let _ = std::fs::remove_file(crate::paths::cosyvoice3_pid_file());
            return Err("CosyVoice3 服务进程意外退出".into());
        }
    }
    Err("CosyVoice3 服务启动超时（60s）".into())
}

#[tauri::command]
pub async fn cosyvoice3_start(
    app: tauri::AppHandle,
    port: Option<u16>,
) -> Result<String, String> {
    let port = port.unwrap_or(8000);
    // Check if already running
    {
        let state = app.state::<CosyVoice3State>();
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(ref mut child) = *guard {
            if child.try_wait().map_err(|e| e.to_string())?.is_none() {
                return Ok(format!("http://127.0.0.1:{port}"));
            }
            *guard = None;
        }
    }
    start_server_internal(&app, port).await
}

#[tauri::command]
pub async fn cosyvoice3_stop(
    app: tauri::AppHandle,
) -> Result<(), String> {
    let state = app.state::<CosyVoice3State>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    let _ = std::fs::remove_file(crate::paths::cosyvoice3_pid_file());
    let _ = app.emit("cosyvoice3://stopped", serde_json::json!({}));
    Ok(())
}

#[tauri::command]
pub async fn cosyvoice3_status(
    app: tauri::AppHandle,
) -> Result<CosyVoice3Status, String> {
    let installed = crate::paths::cosyvoice3_python().exists();
    let model_downloaded = crate::paths::cosyvoice3_model_dir().join("model.safetensors").exists();

    let (server_running, server_pid) = {
        let state = app.state::<CosyVoice3State>();
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(ref mut child) = *guard {
            match child.try_wait() {
                Ok(None) => (true, Some(child.id())),
                _ => { *guard = None; (false, None) }
            }
        } else { (false, None) }
    };

    let cfg = crate::config::get_config();
    let port = cfg.pointer("/tts/cosyvoice3/port")
        .and_then(|v| v.as_u64())
        .unwrap_or(8000) as u16;
    let server_url = if server_running {
        Some(format!("http://127.0.0.1:{port}"))
    } else { None };

    Ok(CosyVoice3Status { installed, model_downloaded, server_running, server_url, server_pid })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cv01_platform_detection() {
        let p = detect_platform();
        assert!(p.contains('-'));
        assert!(!p.is_empty());
    }

    #[test]
    fn cv02_performance_warning_low_ram() {
        let w = generate_performance_warning("macos-aarch64", 4.0, 8);
        assert!(w.unwrap().contains("不足 8GB"));
    }

    #[test]
    fn cv03_performance_warning_ok_ram_low_gpu() {
        let w = generate_performance_warning("macos-aarch64", 16.0, 8);
        assert!(w.unwrap().contains("7-9 秒"));
    }

    #[test]
    fn cv04_no_warning_high_spec() {
        let w = generate_performance_warning("macos-aarch64", 32.0, 30);
        assert!(w.is_none());
    }

    #[test]
    fn cv05_warning_non_macos() {
        let w = generate_performance_warning("linux-x86_64", 32.0, 0);
        assert!(w.unwrap().contains("暂不支持 MLX"));
    }

    #[test]
    fn cv06_warning_intel_mac() {
        let w = generate_performance_warning("macos-x86_64", 16.0, 0);
        assert!(w.unwrap().contains("Intel Mac"));
    }

    #[test]
    fn cv07_paths_are_consistent() {
        let dir = crate::paths::cosyvoice3_dir();
        assert!(dir.ends_with("plugins/cosyvoice3") || dir.ends_with("plugins\\cosyvoice3"));
        assert!(crate::paths::cosyvoice3_venv().starts_with(&dir));
        assert!(crate::paths::cosyvoice3_model_dir().starts_with(&dir));
        assert!(crate::paths::cosyvoice3_pid_file().starts_with(&dir));
    }
}
