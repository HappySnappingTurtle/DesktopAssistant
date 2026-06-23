#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
SOVITS_DIR="$BASE_DIR/GPT-SoVITS"
VENV_DIR="$BASE_DIR/.venv"
MODEL_DIR="$BASE_DIR/trained-models"

source "$VENV_DIR/bin/activate"

PORT="${1:-9880}"

echo "=== 启动 GPT-SoVITS 推理服务 ==="
echo "端口: $PORT"
echo ""

# 检查是否有训练好的模型
READY_CHARS=()
for dir in "$MODEL_DIR"/*/; do
  id=$(basename "$dir")
  if [ -f "$dir/model_info.json" ]; then
    READY_CHARS+=("$id")
    echo "  ✓ $id"
  fi
done

if [ ${#READY_CHARS[@]} -eq 0 ]; then
  echo "  ✗ 没有找到训练好的模型"
  echo "  请先运行: ./scripts/03_train_all.sh"
  exit 1
fi

echo ""
echo "共 ${#READY_CHARS[@]} 个角色模型就绪"

# 生成推理配置
INFER_CONFIG="$BASE_DIR/tts_infer_config.yaml"

# 使用第一个角色作为默认模型
FIRST_CHAR="${READY_CHARS[0]}"
FIRST_INFO="$MODEL_DIR/$FIRST_CHAR/model_info.json"

python3 -c "
import json, yaml, os

with open('$FIRST_INFO') as f:
    info = json.load(f)

config = {
    'custom': {
        'bert_base_path': 'GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large',
        'cnhuhbert_base_path': 'GPT_SoVITS/pretrained_models/chinese-hubert-base',
        'device': 'auto',
        'is_half': False,
        't2s_weights_path': os.path.join('$MODEL_DIR', '$FIRST_CHAR', 'gpt.ckpt') if info.get('gpt_model') else '',
        'vits_weights_path': os.path.join('$MODEL_DIR', '$FIRST_CHAR', 'sovits.pth') if info.get('sovits_model') else '',
        'version': 'v2',
    },
    'default': {
        'bert_base_path': 'GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large',
        'cnhuhbert_base_path': 'GPT_SoVITS/pretrained_models/chinese-hubert-base',
        'device': 'auto',
        'is_half': False,
        't2s_weights_path': 'GPT_SoVITS/pretrained_models/gsv-v2final-pretrained/s1bert25hz-5kh-longer-epoch=12-step=369668.ckpt',
        'vits_weights_path': 'GPT_SoVITS/pretrained_models/gsv-v2final-pretrained/s2G2333k.pth',
        'version': 'v2',
    },
}

with open('$INFER_CONFIG', 'w') as f:
    yaml.dump(config, f, default_flow_style=False, allow_unicode=True)

print(f'推理配置已写入: $INFER_CONFIG')
" 2>/dev/null || {
  echo "  配置生成失败，尝试直接启动..."
}

# 启动 API 服务
cd "$SOVITS_DIR"
echo ""
echo "启动 API 服务..."
echo "API 文档: http://127.0.0.1:$PORT/docs"
echo "按 Ctrl+C 停止服务"
echo ""

# 尝试不同的 API 入口
if [ -f "api_v2.py" ]; then
  python3 api_v2.py -p "$PORT" -a "127.0.0.1"
elif [ -f "api.py" ]; then
  python3 api.py -p "$PORT" -a "127.0.0.1"
else
  echo "未找到 API 入口文件，请检查 GPT-SoVITS 安装"
  exit 1
fi
