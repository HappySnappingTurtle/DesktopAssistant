#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
SOVITS_DIR="$BASE_DIR/GPT-SoVITS"
VENV_DIR="$BASE_DIR/.venv"
SUBSET_DIR="$BASE_DIR/aishell3-subset"
MODEL_DIR="$BASE_DIR/trained-models"
REF_DIR="$BASE_DIR/ref-audio"

source "$VENV_DIR/bin/activate"

echo "=== GPT-SoVITS 训练全部角色 ==="

# 角色配置: ID|说话人|描述
CHARACTERS=(
  "mao|SSB0073|活泼猫系少女"
  "hiyori|SSB0189|温柔安静少女"
  "dk|SSB0152|傲娇赛博猫耳"
  "suit|SSB1285|沉稳西装绅士"
  "freemale|SSB1150|随和邻家少年"
  "cybermaid|SSB1092|安静内敛少年"
)

TRAINED=0
FAILED=0

for char in "${CHARACTERS[@]}"; do
  IFS='|' read -r id speaker desc <<< "$char"

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "训练角色: $id ($desc) — 说话人: $speaker"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  CHAR_TRAIN_DIR="$SUBSET_DIR/$speaker"
  CHAR_MODEL_DIR="$MODEL_DIR/$id"
  CHAR_REF_DIR="$REF_DIR/$id"
  mkdir -p "$CHAR_MODEL_DIR"

  # 检查训练数据
  wav_count=$(find "$CHAR_TRAIN_DIR" -name "*.wav" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$wav_count" -lt 5 ]; then
    echo "  ✗ 训练数据不足（${wav_count} 个 WAV），跳过"
    FAILED=$((FAILED + 1))
    continue
  fi
  echo "  训练数据: ${wav_count} 个音频文件"

  # 检查参考音频
  ref_file=$(find "$CHAR_REF_DIR" -name "*.wav" -o -name "*.mp3" 2>/dev/null | head -1)
  if [ -z "$ref_file" ]; then
    echo "  ✗ 缺少参考音频，跳过"
    FAILED=$((FAILED + 1))
    continue
  fi
  echo "  参考音频: $ref_file"

  # 检查是否已训练
  if [ -f "$CHAR_MODEL_DIR/sovits.pth" ] && [ -f "$CHAR_MODEL_DIR/gpt.ckpt" ]; then
    echo "  ✓ 已有训练模型，跳过（删除 $CHAR_MODEL_DIR 可重新训练）"
    TRAINED=$((TRAINED + 1))
    continue
  fi

  # 运行训练
  python3 "$SCRIPT_DIR/train_character.py" \
    --id "$id" \
    --speaker "$speaker" \
    --train-dir "$CHAR_TRAIN_DIR" \
    --ref-dir "$CHAR_REF_DIR" \
    --output "$CHAR_MODEL_DIR" \
    --sovits-dir "$SOVITS_DIR" \
    && {
      echo "  ✓ 训练完成: $CHAR_MODEL_DIR"
      TRAINED=$((TRAINED + 1))
    } || {
      echo "  ✗ 训练失败"
      FAILED=$((FAILED + 1))
    }
done

echo ""
echo "=== 训练结果 ==="
echo "成功: $TRAINED | 失败: $FAILED | 总计: ${#CHARACTERS[@]}"
echo ""

if [ $TRAINED -gt 0 ]; then
  echo "下一步: ./scripts/04_start_server.sh"
fi
