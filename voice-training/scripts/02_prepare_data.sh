#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
REF_DIR="$BASE_DIR/ref-audio"
SUBSET_DIR="$BASE_DIR/aishell3-subset"
VENV_DIR="$BASE_DIR/.venv"

source "$VENV_DIR/bin/activate"

echo "=== 准备训练数据 + 参考音频 ==="

# ── 角色配置 ──────────────────────────────────────────
# 格式: ID|性别|AISHELL-3说话人|性格描述
CHARACTERS=(
  "mao|female|SSB0073|活泼猫系少女"
  "hiyori|female|SSB0189|温柔安静少女"
  "dk|female|SSB0152|傲娇赛博猫耳"
  "suit|male|SSB1285|沉稳西装绅士"
  "freemale|male|SSB1150|随和邻家少年"
  "cybermaid|male|SSB1092|安静内敛少年"
)

# ── Step 1: 下载 AISHELL-3 说话人子集 ──────────────────
echo "[1/3] 准备 AISHELL-3 说话人数据..."
mkdir -p "$SUBSET_DIR"

# AISHELL-3 完整数据集约 26GB，只下载需要的说话人
# 优先从 HuggingFace 获取（支持单文件下载）
SPEAKERS_NEEDED=()
for char in "${CHARACTERS[@]}"; do
  IFS='|' read -r id gender speaker desc <<< "$char"
  SPEAKERS_NEEDED+=("$speaker")
done

python3 "$SCRIPT_DIR/extract_aishell3_speakers.py" \
  --speakers "${SPEAKERS_NEEDED[@]}" \
  --output "$SUBSET_DIR" \
  --ref-output "$REF_DIR" 2>&1 || {
    echo ""
    echo "  自动下载失败。请手动下载 AISHELL-3："
    echo "  1. 访问 https://www.openslr.org/93/ 或 https://huggingface.co/datasets/AISHELL/AISHELL-3"
    echo "  2. 下载并解压到 $SUBSET_DIR"
    echo "  3. 或运行: python3 $SCRIPT_DIR/extract_aishell3_speakers.py --local-path <解压目录> --speakers ${SPEAKERS_NEEDED[*]}"
    echo ""
  }

# ── Step 2: 补充社区高质量女声参考音频 ─────────────────
echo ""
echo "[2/3] 检查社区参考音频..."

for char in "${CHARACTERS[@]}"; do
  IFS='|' read -r id gender speaker desc <<< "$char"
  char_ref_dir="$REF_DIR/$id"
  mkdir -p "$char_ref_dir"

  ref_count=$(find "$char_ref_dir" -name "*.wav" -o -name "*.mp3" 2>/dev/null | wc -l)
  if [ "$ref_count" -lt 1 ]; then
    echo "  $id ($desc): 缺少参考音频！"
    echo "    请将 3-10 秒的清晰中文 WAV/MP3 放入: $char_ref_dir/"
    echo "    推荐来源:"
    if [ "$gender" = "female" ]; then
      echo "      - GPT-SoVITS 社区分享的中文女声包"
      echo "      - AISHELL-3 说话人 $speaker 的音频片段（自动提取中）"
      echo "      - B 站/GitHub 开源 VTuber 语音包"
    else
      echo "      - AISHELL-3 说话人 $speaker 的音频片段（自动提取中）"
    fi
  else
    echo "  $id ($desc): 已有 $ref_count 个参考音频 ✓"
  fi
done

# ── Step 3: 生成训练清单 ────────────────────────────────
echo ""
echo "[3/3] 生成训练清单..."

MANIFEST="$BASE_DIR/training_manifest.json"
python3 -c "
import json, os, glob

characters = [
    {'id': 'mao',       'gender': 'female', 'speaker': 'SSB0073', 'desc': '活泼猫系少女'},
    {'id': 'hiyori',    'gender': 'female', 'speaker': 'SSB0189', 'desc': '温柔安静少女'},
    {'id': 'dk',        'gender': 'female', 'speaker': 'SSB0152', 'desc': '傲娇赛博猫耳'},
    {'id': 'suit',      'gender': 'male',   'speaker': 'SSB1285', 'desc': '沉稳西装绅士'},
    {'id': 'freemale',  'gender': 'male',   'speaker': 'SSB1150', 'desc': '随和邻家少年'},
    {'id': 'cybermaid', 'gender': 'male',   'speaker': 'SSB1092', 'desc': '安静内敛少年'},
]

manifest = []
for c in characters:
    ref_dir = os.path.join('$REF_DIR', c['id'])
    refs = glob.glob(os.path.join(ref_dir, '*.wav')) + glob.glob(os.path.join(ref_dir, '*.mp3'))
    train_dir = os.path.join('$SUBSET_DIR', c['speaker'])
    train_files = glob.glob(os.path.join(train_dir, '**', '*.wav'), recursive=True)

    manifest.append({
        'id': c['id'],
        'gender': c['gender'],
        'speaker': c['speaker'],
        'desc': c['desc'],
        'ref_audio_count': len(refs),
        'ref_audio_best': refs[0] if refs else None,
        'train_audio_count': len(train_files),
        'train_audio_minutes': round(len(train_files) * 5 / 60, 1),  # ~5s per utterance
        'status': 'ready' if refs and train_files else 'needs_data',
    })

with open('$MANIFEST', 'w') as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)

print(f'训练清单已写入: $MANIFEST')
for m in manifest:
    status = '✓ 就绪' if m['status'] == 'ready' else '✗ 缺数据'
    print(f\"  {m['id']:10s} | ref={m['ref_audio_count']} | train={m['train_audio_count']} ({m['train_audio_minutes']}min) | {status}\")
"

echo ""
echo "=== 数据准备完成 ==="
echo "下一步: ./scripts/03_train_all.sh"
