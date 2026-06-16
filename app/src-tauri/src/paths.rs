use std::path::PathBuf;

/// 跨平台用户数据目录：~/.desktop-assistant
/// macOS: /Users/xxx/.desktop-assistant
/// Windows: C:\Users\xxx\AppData\Roaming\desktop-assistant
/// Linux: /home/xxx/.desktop-assistant
pub fn data_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            return PathBuf::from(appdata).join("desktop-assistant");
        }
    }

    if let Some(home) = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
    {
        return PathBuf::from(home).join(".desktop-assistant");
    }

    // 最后兜底
    std::env::temp_dir().join("desktop-assistant")
}

pub fn config_path() -> PathBuf {
    data_dir().join("config.json")
}

pub fn whisper_model_path() -> PathBuf {
    data_dir().join("models").join("ggml-base-q5_1.bin")
}

/// whisper 可执行文件名（Windows 为 whisper.exe，其他为 whisper-cli）
pub fn whisper_bin() -> &'static str {
    #[cfg(target_os = "windows")]
    { "whisper" }

    #[cfg(not(target_os = "windows"))]
    { "whisper-cli" }
}
