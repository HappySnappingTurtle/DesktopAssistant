# GPT-SoVITS Voice Training Pipeline

6 角色声线训练完整流程。

## 前置条件

- Python 3.10+
- GPU (NVIDIA, 4GB+ VRAM) 或 Apple Silicon (MPS)
- ~5GB 磁盘空间（GPT-SoVITS + 预训练模型 + AISHELL-3 子集）

## 快速开始

```bash
# 1. 安装 GPT-SoVITS 环境（首次）
./scripts/01_setup_env.sh

# 2. 下载 AISHELL-3 说话人子集 + 准备参考音频
./scripts/02_prepare_data.sh

# 3. 训练全部 6 角色（每角色约 2-5 分钟 GPU）
./scripts/03_train_all.sh

# 4. 启动推理服务
./scripts/04_start_server.sh

# 5. 验证全部角色声线
./scripts/05_verify.sh
```

## 目录结构

```
voice-training/
  scripts/           # 自动化脚本
  ref-audio/          # 参考音频（训练源 + 推理参考）
    mao/              # 每角色一个子目录
    hiyori/
    dk/
    suit/
    freemale/
    cybermaid/
  trained-models/     # 训练产出的模型文件
    mao/
    ...
  aishell3-subset/    # AISHELL-3 筛选后的说话人数据
```

## 参考音频来源

- **AISHELL-3**：从 218 位说话人中筛选匹配角色音色的说话人
- **社区开源**：GPT-SoVITS 社区分享的高质量中文女声/男声参考音频
- **自行录制**：3-10 秒清晰中文语音 + 对应文本
