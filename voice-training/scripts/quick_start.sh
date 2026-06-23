#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
SOVITS_DIR="$BASE_DIR/GPT-SoVITS"
VENV_DIR="$BASE_DIR/.venv"
PRETRAINED="$SOVITS_DIR/GPT_SoVITS/pretrained_models/gsv-v2final-pretrained"
PORT="${1:-9880}"

echo "=== GPT-SoVITS 快速启动 ==="
echo ""

# 1. 检查虚拟环境
if [ ! -d "$VENV_DIR" ]; then
  echo "✗ 虚拟环境不存在，请先运行: ./scripts/01_setup_env.sh"
  exit 1
fi

source "$VENV_DIR/bin/activate"

# 2. 检查/下载预训练模型
if [ ! -f "$PRETRAINED/s2G2333k.pth" ]; then
  echo "[下载] GPT-SoVITS v2 预训练模型..."
  pip install -q huggingface_hub 2>/dev/null
  python3 -c "
from huggingface_hub import snapshot_download
snapshot_download(
    'lj1995/GPT-SoVITS',
    local_dir='$SOVITS_DIR/GPT_SoVITS/pretrained_models',
    allow_patterns=['gsv-v2final-pretrained/*'],
)
print('✓ 下载完成')
" || {
    echo "✗ 下载失败，请手动下载:"
    echo "  huggingface-cli download lj1995/GPT-SoVITS --local-dir '$SOVITS_DIR/GPT_SoVITS/pretrained_models' --include 'gsv-v2final-pretrained/*'"
    exit 1
  }
fi

echo "✓ 预训练模型就绪"

# 3. 检查中文 BERT 模型
BERT_DIR="$SOVITS_DIR/GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large"
if [ ! -d "$BERT_DIR" ]; then
  echo "[下载] Chinese BERT 模型..."
  python3 -c "
from huggingface_hub import snapshot_download
snapshot_download('hfl/chinese-roberta-wwm-ext-large', local_dir='$BERT_DIR')
print('✓ BERT 下载完成')
" || echo "⚠ BERT 下载失败（推理可能降级）"
fi

# 4. 检查 HuBERT 模型
HUBERT_DIR="$SOVITS_DIR/GPT_SoVITS/pretrained_models/chinese-hubert-base"
if [ ! -d "$HUBERT_DIR" ]; then
  echo "[下载] Chinese HuBERT 模型..."
  python3 -c "
from huggingface_hub import snapshot_download
snapshot_download('TencentGameMate/chinese-hubert-base', local_dir='$HUBERT_DIR')
print('✓ HuBERT 下载完成')
" || echo "⚠ HuBERT 下载失败（推理可能降级）"
fi

# 5. 启动 API
echo ""
echo "✓ 启动 GPT-SoVITS API 服务"
echo "  端口: $PORT"
echo "  文档: http://127.0.0.1:$PORT/docs"
echo ""
echo "桌面助理设置:"
echo "  TTS Provider = GPT-SoVITS"
echo "  服务地址 = http://127.0.0.1:$PORT"
echo ""
echo "按 Ctrl+C 停止服务"
echo ""

cd "$SOVITS_DIR"
python3 api_v2.py -p "$PORT" -a "127.0.0.1" 2>&1 || python3 api.py -p "$PORT" -a "127.0.0.1"
