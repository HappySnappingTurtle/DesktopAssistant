<p align="center">
  <img src="https://github.com/user-attachments/assets/placeholder" width="120" alt="DesktopAssistant Logo">
</p>

<h1 align="center">DesktopAssistant</h1>

<p align="center">
  <strong>AI Agent 桌面伴侣 — 你的编码 Agent 传令官</strong>
</p>

<p align="center">
  Live2D 角色 · 语音审批 · Claude/Codex 监控 · 情绪驱动表演
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS-blue" alt="macOS">
  <img src="https://img.shields.io/badge/Tauri-2.0-orange" alt="Tauri 2">
  <img src="https://img.shields.io/badge/Live2D-Cubism_4-pink" alt="Live2D">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT">
</p>

---

## What is this?

写代码时，Claude Code / Codex / Gemini 这些 AI Agent 经常在等你审批——你离开键盘、切了个窗口，审批就被阻塞了。

**DesktopAssistant** 是一个桌面上的 Live2D 角色，她/他会：

- **监控 Agent 审批状态**，语音提醒你 "Claude 在等你审批 Bash 操作"
- **按住说话**（Alt+Space），说"同意"就帮你批准；说"不行"就拒绝
- **高危操作自动拦截**（`rm -rf`、`sudo` 等），要求你亲自在终端确认
- 没有审批时，就是你的**聊天伴侣**——角色有性格、有记忆、有情绪表演

<p align="center">
  <img src="https://github.com/user-attachments/assets/placeholder-screenshot" width="280" alt="三月七审批提醒">
  <img src="https://github.com/user-attachments/assets/placeholder-screenshot2" width="280" alt="设置面板">
</p>

## Features

### 核心能力

| 功能 | 描述 |
|---|---|
| **Agent 审批监控** | Claude Code（Hook 直连）+ Codex（notify 桥接）+ 任意 CLI Agent（PTY 包装器） |
| **语音审批闭环** | 按住 Alt+Space → 说话 → whisper 本地识别 → 安全门 → 自动注入按键 |
| **高危黑名单** | `rm -rf` / `sudo` / `git push --force` 等 14 种模式，100% 拦截 |
| **Live2D 角色** | 透明置顶窗口，拖拽移动，缩放，点击互动，口型同步 |
| **情绪驱动表演** | LLM 返回 `{text, emotion, intensity}` → 实时参数驱动表情 + TTS 语调变化 |
| **角色记忆** | 用户偏好自动提取（L1），对话摘要压缩，跨会话持久化 |
| **性格一致性** | 身份锚永不压缩 + 10 轮 reminder + 漂移检测自动修正 |

### 内置角色

| 角色 | 声线 | 性格 |
|---|---|---|
| **三月七**（星穹铁道） | 晓伊（活泼少女） | 活泼开朗、爱拍照、偶尔撒娇 |
| **Natori**（Live2D 官方） | 云希（沉稳青年） | 内敛沉稳、逻辑清晰、冷幽默 |
| **Hiyori**（Live2D 官方） | 晓伊（温柔） | 温柔安静、细心体贴 |

角色性格由 `character.manifest.yaml` 的 `persona` 段定义，**引擎代码零性格文本**——换个 manifest 就换个灵魂。

## Quick Start

### 前置条件

- macOS（Apple Silicon / Intel）
- [Node.js](https://nodejs.org/) 20+ & [pnpm](https://pnpm.io/)
- [Rust](https://rustup.rs/) stable
- [whisper-cpp](https://github.com/ggerganov/whisper.cpp)（语音识别）: `brew install whisper-cpp`

### 安装

```bash
git clone git@github.com:HappySnappingTurtle/DesktopAssistant.git
cd DesktopAssistant/app
pnpm install

# 下载 whisper 模型（57MB）
mkdir -p ~/.desktop-assistant/models
curl -L -o ~/.desktop-assistant/models/ggml-base-q5_1.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin
```

### 运行

```bash
# 开发模式（热更新）
pnpm tauri dev

# 打包发布
pnpm tauri build
# 产物：src-tauri/target/release/bundle/macos/DesktopAssistant.app
```

### 首次启动

1. 引导页会带你完成基本设置（称呼、LLM 配置）
2. 角色出现在桌面 → 右键打开菜单
3. 配置 LLM（推荐本地 [Ollama](https://ollama.com) + qwen3:8b，免费无需 API Key）
4. 按住 **Alt+Space** 试试语音

## Usage

| 操作 | 效果 |
|---|---|
| 左键点击角色 | 互动（说话 + 动作） |
| 左键按住拖动 | 移动角色位置 |
| 右键 | 菜单（设置 / 缩放 / 静音 / 退出） |
| 捏合 / Cmd+滚轮 | 缩放角色 |
| **Alt+Space（按住）** | 语音输入 |

### Agent 监控接入

**Claude Code**（自动 Hook）：
```bash
# 在设置面板 → Agent 监控 → 填项目路径 → 点击「安装 Claude Hook」
```

**Codex**（自动配置）：
安装时自动配置 `~/.codex/config.toml` 的 notify 桥接。

**其他 CLI Agent**（PTY 包装器）：
```bash
cd app/src-tauri && cargo build --release --bin assist
./target/release/assist run -- gemini   # 包装任意 CLI
./target/release/assist run --agent aider -- aider
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Tauri Main Process (Rust)            │
│  Event Bus · Claude Hook · PTY Wrapper · TTS     │
│  Config(Keychain) · LLM Provider · Voice(cpal)   │
└────────────────────┬────────────────────────────┘
                     │ Tauri IPC
┌────────────────────┴────────────────────────────┐
│              WebView (TypeScript)                 │
│  Live2D Renderer · Behavior Engine · TTS Queue   │
│  Emotion System · Memory · Conversation Manager  │
│  Settings Panel · Onboarding · Context Menu      │
└──────────────────────────────────────────────────┘
```

**低耦合设计**：每个模块通过接口注入依赖，`main.ts` 是唯一接线层。新增模型只填 YAML manifest，不改代码。

## 自定义角色

创建 `app/public/characters/<id>/` 目录：

```yaml
# character.manifest.yaml
schema_version: 1
id: my-character
display_name: "我的角色"
model_entry: model/xxx.model3.json
gender_presentation: male

persona:
  personality: "沉稳可靠、言简意赅"
  speech_style: "简洁平和，偶尔冷幽默"
  greeting: "嗯，开始吧。"
  taboos: "不喜欢废话"
  style_blacklist: ["～", "！！"]  # 防止性格漂移

voice:
  provider: edge-tts
  voice: zh-CN-YunxiNeural

motion_map:
  idle: Idle
  greet: TapMotion
  cheer: HappyMotion

emotion_param_overrides:  # 可选：覆盖默认参数
  shy:
    ParamCheek: 0  # 关闭腮红
```

## Tech Stack

| 层 | 技术 |
|---|---|
| 桌面壳 | Tauri 2 (Rust + WebView) |
| 前端 | TypeScript + PixiJS 7 + pixi-live2d-display |
| 语音识别 | whisper.cpp (本地，base-q5_1) |
| 语音合成 | Edge TTS (联网) + 系统 TTS (降级) |
| LLM | Anthropic / OpenAI 兼容 / Ollama |
| 存储 | config.json + macOS Keychain |

## Tests

```bash
cd app
pnpm test          # 前端 129 tests
cd src-tauri
cargo test         # Rust 53 tests
```

## Roadmap

- [ ] 多会话看板（同时监控多个 Agent）
- [ ] GPT-SoVITS 声线克隆
- [ ] 唤醒词持续监听
- [ ] 屏幕视觉陪玩（截屏 + 视觉 LLM）
- [ ] 模型社区导入（zip 拖入）
- [ ] Windows 支持

## License

MIT

## Credits

- [Live2D Cubism SDK](https://www.live2d.com/) — 模型渲染
- [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display) — PixiJS 集成
- [Tauri](https://tauri.app/) — 桌面框架
- [whisper.cpp](https://github.com/ggerganov/whisper.cpp) — 本地语音识别
- [Edge TTS](https://github.com/nickerqin/msedge-tts) — 语音合成
- 三月七模型来自 [v3ucn/live2d-TTS-LLM-GPT-SoVITS-Vtuber](https://github.com/v3ucn/live2d-TTS-LLM-GPT-SoVITS-Vtuber)（同人创作）
