#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
MODEL_DIR="$BASE_DIR/trained-models"
OUTPUT_DIR="$BASE_DIR/verification-output"
APP_CHARS_DIR="$(dirname "$BASE_DIR")/app/public/characters"
APP_REFS_DIR="$(dirname "$BASE_DIR")/app/public/voice-refs"

PORT="${1:-9880}"
API_BASE="http://127.0.0.1:$PORT"

mkdir -p "$OUTPUT_DIR"

echo "=== GPT-SoVITS 声线验证 ==="
echo "API: $API_BASE"
echo ""

# 检查服务是否运行
if ! curl -sf "$API_BASE/docs" >/dev/null 2>&1; then
  echo "✗ GPT-SoVITS 服务未运行！请先执行: ./scripts/04_start_server.sh"
  exit 1
fi
echo "✓ 服务已连接"
echo ""

# 测试文本（匹配每个角色的性格）
declare -A TEST_TEXT
TEST_TEXT[mao]="喵～你来啦！今天有什么好玩的？我超级期待的！"
TEST_TEXT[hiyori]="嗯...你今天看起来有点累呢。要不要休息一下？"
TEST_TEXT[dk]="哼，你又来了。不是说想你了啦。有什么事就直说嘛。"
TEST_TEXT[suit]="好的，我已经确认了所有数据。按计划推进即可。"
TEST_TEXT[freemale]="没问题，这个事情交给我就好了。你先去忙你的。"
TEST_TEXT[cybermaid]="嗯...了解。我会按照既定方案执行。"

PASSED=0
FAILED=0

for dir in "$MODEL_DIR"/*/; do
  id=$(basename "$dir")
  info_file="$dir/model_info.json"

  if [ ! -f "$info_file" ]; then
    continue
  fi

  echo "━━━ $id ━━━"

  # 读取模型信息
  ref_audio=$(python3 -c "import json; d=json.load(open('$info_file')); print(d.get('ref_audio',''))")
  ref_text=$(python3 -c "import json; d=json.load(open('$info_file')); print(d.get('ref_text',''))")
  ref_path="$dir/$ref_audio"

  if [ ! -f "$ref_path" ]; then
    echo "  ✗ 参考音频不存在: $ref_path"
    FAILED=$((FAILED + 1))
    continue
  fi

  text="${TEST_TEXT[$id]:-你好，这是一段测试语音。}"
  out_file="$OUTPUT_DIR/${id}_test.wav"

  echo "  参考: $ref_audio"
  echo "  文本: $text"

  # 调用 API 合成
  HTTP_CODE=$(curl -sf -o "$out_file" -w "%{http_code}" \
    -X POST "$API_BASE/tts" \
    -H "Content-Type: application/json" \
    -d "{
      \"text\": \"$text\",
      \"text_lang\": \"zh\",
      \"ref_audio_path\": \"$ref_path\",
      \"prompt_text\": \"$ref_text\",
      \"prompt_lang\": \"zh\",
      \"text_split_method\": \"cut5\"
    }" 2>/dev/null || echo "000")

  if [ "$HTTP_CODE" = "200" ] && [ -f "$out_file" ]; then
    file_size=$(stat -f%z "$out_file" 2>/dev/null || stat -c%s "$out_file" 2>/dev/null || echo "0")
    if [ "$file_size" -gt 1000 ]; then
      echo "  ✓ 合成成功: $out_file ($file_size bytes)"
      PASSED=$((PASSED + 1))

      # 复制到应用目录
      echo "  → 同步参考音频到应用..."
      mkdir -p "$APP_REFS_DIR"
      cp "$ref_path" "$APP_REFS_DIR/${id}_ref.wav"

    else
      echo "  ✗ 合成文件太小: $file_size bytes"
      FAILED=$((FAILED + 1))
    fi
  else
    echo "  ✗ API 调用失败 (HTTP $HTTP_CODE)"
    FAILED=$((FAILED + 1))
  fi
done

echo ""
echo "=== 验证结果 ==="
echo "通过: $PASSED | 失败: $FAILED"
echo "验证音频: $OUTPUT_DIR/"
echo ""

if [ $PASSED -gt 0 ]; then
  echo "下一步: 更新应用 manifest"
  echo "  运行: python3 $SCRIPT_DIR/update_manifests.py"
fi
