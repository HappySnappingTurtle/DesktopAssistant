#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
SOVITS_DIR="$BASE_DIR/GPT-SoVITS"

echo "=== GPT-SoVITS 环境安装 ==="

# 选择兼容的 Python（3.11 优先，3.12 次之）
PYTHON=""
for p in python3.11 python3.12 python3.10 python3; do
  found=$(which "$p" 2>/dev/null || find /Users /opt/homebrew -name "$p" -type f 2>/dev/null | head -1)
  if [ -n "$found" ]; then
    ver=$("$found" --version 2>&1 | grep -oE '[0-9]+\.[0-9]+')
    major=$(echo "$ver" | cut -d. -f1)
    minor=$(echo "$ver" | cut -d. -f2)
    if [ "$major" = "3" ] && [ "$minor" -ge 10 ] && [ "$minor" -le 12 ]; then
      PYTHON="$found"
      echo "使用 Python: $PYTHON ($("$PYTHON" --version))"
      break
    fi
  fi
done

if [ -z "$PYTHON" ]; then
  echo "错误: 需要 Python 3.10-3.12（GPT-SoVITS 不支持 3.13+）"
  echo "安装: brew install python@3.11"
  exit 1
fi

# 1. 克隆 GPT-SoVITS（如果不存在）
if [ ! -d "$SOVITS_DIR" ]; then
  echo "[1/4] 克隆 GPT-SoVITS..."
  git clone --depth 1 https://github.com/RVC-Boss/GPT-SoVITS.git "$SOVITS_DIR"
else
  echo "[1/4] GPT-SoVITS 已存在，跳过克隆"
fi

# 2. 创建 Python 虚拟环境
VENV_DIR="$BASE_DIR/.venv"
if [ ! -d "$VENV_DIR" ]; then
  echo "[2/4] 创建 Python 虚拟环境..."
  "$PYTHON" -m venv "$VENV_DIR"
else
  echo "[2/4] 虚拟环境已存在"
fi

source "$VENV_DIR/bin/activate"
# 确保 venv 内 python 版本正确
echo "  venv Python: $(python3 --version)"

# 3. 安装依赖
echo "[3/4] 安装 Python 依赖..."
pip install --upgrade pip
cd "$SOVITS_DIR"

# 检测平台
if python3 -c "import torch; print(torch.backends.mps.is_available())" 2>/dev/null | grep -q True; then
  echo "  检测到 Apple Silicon MPS，使用 CPU/MPS 模式"
  pip install -r requirements.txt 2>/dev/null || pip install torch torchaudio numpy scipy librosa soundfile gradio fastapi uvicorn transformers cn2an pypinyin g2p_en jieba wordsegment
elif command -v nvidia-smi &>/dev/null; then
  echo "  检测到 NVIDIA GPU"
  pip install -r requirements.txt
else
  echo "  无 GPU 检测到，使用 CPU 模式（训练会很慢）"
  pip install -r requirements.txt 2>/dev/null || pip install torch torchaudio numpy scipy librosa soundfile gradio fastapi uvicorn transformers cn2an pypinyin g2p_en jieba wordsegment
fi

# 4. 下载预训练模型
PRETRAINED_DIR="$SOVITS_DIR/GPT_SoVITS/pretrained_models"
mkdir -p "$PRETRAINED_DIR/gsv-v2final-pretrained"

if [ ! -f "$PRETRAINED_DIR/gsv-v2final-pretrained/s2G2333k.pth" ]; then
  echo "[4/4] 下载 GPT-SoVITS v2 预训练模型..."
  if command -v huggingface-cli &>/dev/null; then
    huggingface-cli download lj1995/GPT-SoVITS \
      --local-dir "$PRETRAINED_DIR" \
      --include "gsv-v2final-pretrained/*"
  else
    pip install huggingface-hub
    python3 -c "
from huggingface_hub import snapshot_download
snapshot_download(
    'lj1995/GPT-SoVITS',
    local_dir='$PRETRAINED_DIR',
    allow_patterns=['gsv-v2final-pretrained/*']
)
"
  fi
else
  echo "[4/4] 预训练模型已存在"
fi

# 下载中文 G2PW 模型（中文推理必需）
G2PW_DIR="$SOVITS_DIR/GPT_SoVITS/text/G2PWModel"
if [ ! -d "$G2PW_DIR" ]; then
  echo "  下载 G2PWModel（中文音素转换）..."
  pip install g2pw
  python3 -c "
import g2pw
import os, shutil
# g2pw 自动下载模型到缓存，拷贝到目标位置
converter = g2pw.G2PWConverter()
cache_dir = os.path.dirname(g2pw.__file__)
# 找到模型目录
for root, dirs, files in os.walk(os.path.expanduser('~/.cache')):
    if 'G2PWModel' in dirs:
        src = os.path.join(root, 'G2PWModel')
        shutil.copytree(src, '$G2PW_DIR', dirs_exist_ok=True)
        print(f'G2PWModel 已拷贝: {src} -> $G2PW_DIR')
        break
" 2>/dev/null || echo "  G2PWModel 下载需手动处理，见 GPT-SoVITS 文档"
fi

echo ""
echo "=== 环境安装完成 ==="
echo "GPT-SoVITS: $SOVITS_DIR"
echo "虚拟环境:   $VENV_DIR"
echo "预训练模型: $PRETRAINED_DIR"
echo ""
echo "下一步: ./scripts/02_prepare_data.sh"
