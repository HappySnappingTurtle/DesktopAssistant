#!/usr/bin/env python3
"""从 AISHELL-3 提取指定说话人的音频数据 + 生成参考音频。

支持两种模式：
  1. --local-path: 从已下载的 AISHELL-3 目录提取
  2. 自动模式: 尝试从 HuggingFace 下载指定说话人数据
"""
import argparse
import os
import shutil
import glob
import json
import random

def extract_from_local(local_path: str, speakers: list[str], output: str, ref_output: str):
    """从本地 AISHELL-3 目录提取说话人数据"""
    # AISHELL-3 结构: train/wav/<speaker_id>/*.wav
    # 也有: train/content.txt 包含转录
    wav_base = os.path.join(local_path, "train", "wav")
    if not os.path.isdir(wav_base):
        # 尝试其他常见路径
        for alt in ["wav", "data_aishell3/train/wav", "."]:
            p = os.path.join(local_path, alt)
            if os.path.isdir(p):
                wav_base = p
                break

    # 读取转录文本
    content_file = None
    for cf in [
        os.path.join(local_path, "train", "content.txt"),
        os.path.join(local_path, "content.txt"),
        os.path.join(local_path, "train", "label_train-set.txt"),
    ]:
        if os.path.isfile(cf):
            content_file = cf
            break

    transcripts = {}
    if content_file:
        with open(content_file, "r", encoding="utf-8") as f:
            for line in f:
                parts = line.strip().split("\t")
                if len(parts) >= 2:
                    # SSB00730001\t你好世界\tni3 hao3 shi4 jie4
                    utt_id = parts[0].strip()
                    text = parts[1].strip()
                    # 去除拼音标注（如果有）
                    text = text.split("\t")[0] if "\t" in text else text
                    transcripts[utt_id] = text

    for speaker in speakers:
        speaker_dir = os.path.join(wav_base, speaker)
        if not os.path.isdir(speaker_dir):
            print(f"  警告: 说话人 {speaker} 不存在于 {wav_base}")
            continue

        # 复制音频到子集目录
        out_speaker = os.path.join(output, speaker)
        os.makedirs(out_speaker, exist_ok=True)

        wav_files = sorted(glob.glob(os.path.join(speaker_dir, "*.wav")))
        print(f"  {speaker}: 找到 {len(wav_files)} 个音频文件")

        # 创建标注文件
        annotations = []
        for wav_file in wav_files:
            basename = os.path.splitext(os.path.basename(wav_file))[0]
            dst = os.path.join(out_speaker, os.path.basename(wav_file))
            if not os.path.exists(dst):
                shutil.copy2(wav_file, dst)

            text = transcripts.get(basename, "")
            if text:
                annotations.append({"file": os.path.basename(wav_file), "text": text})

        # 写标注
        ann_file = os.path.join(out_speaker, "annotations.json")
        with open(ann_file, "w", encoding="utf-8") as f:
            json.dump(annotations, f, ensure_ascii=False, indent=2)

        # 选择最佳参考音频（选中等长度、有转录的）
        ref_dir = os.path.join(ref_output, _speaker_to_char_id(speaker))
        os.makedirs(ref_dir, exist_ok=True)

        if annotations:
            # 选文本长度适中的（15-30字）
            good_refs = [a for a in annotations if 15 <= len(a["text"]) <= 30]
            if not good_refs:
                good_refs = [a for a in annotations if len(a["text"]) >= 8]
            if not good_refs:
                good_refs = annotations

            # 选 3 个作为参考
            selected = random.sample(good_refs, min(3, len(good_refs)))
            for i, ref in enumerate(selected):
                src = os.path.join(out_speaker, ref["file"])
                dst = os.path.join(ref_dir, f"ref_{i:02d}.wav")
                if not os.path.exists(dst):
                    shutil.copy2(src, dst)

                # 写参考文本
                txt_file = os.path.join(ref_dir, f"ref_{i:02d}.txt")
                with open(txt_file, "w", encoding="utf-8") as f:
                    f.write(ref["text"])

            print(f"    → 已生成 {len(selected)} 个参考音频到 {ref_dir}")

def _speaker_to_char_id(speaker: str) -> str:
    """AISHELL-3 说话人 ID → 角色 ID"""
    mapping = {
        "SSB0073": "mao",
        "SSB0189": "hiyori",
        "SSB0152": "dk",
        "SSB1285": "suit",
        "SSB1150": "freemale",
        "SSB1092": "cybermaid",
    }
    return mapping.get(speaker, speaker)


def try_huggingface_download(speakers: list[str], output: str, ref_output: str):
    """尝试从 HuggingFace 下载 AISHELL-3 指定说话人"""
    try:
        from huggingface_hub import HfApi, hf_hub_download
        api = HfApi()

        print("  尝试从 HuggingFace 下载 AISHELL-3 说话人子集...")
        dataset_id = "AISHELL/AISHELL-3"

        # 列出文件
        files = api.list_repo_files(dataset_id, repo_type="dataset")

        for speaker in speakers:
            speaker_files = [f for f in files if speaker in f and f.endswith(".wav")]
            if not speaker_files:
                print(f"  {speaker}: HuggingFace 上未找到音频文件")
                continue

            out_speaker = os.path.join(output, speaker)
            os.makedirs(out_speaker, exist_ok=True)

            # 下载前 60 个（约 5 分钟音频）
            to_download = speaker_files[:60]
            print(f"  {speaker}: 下载 {len(to_download)} 个文件...")

            for fpath in to_download:
                try:
                    local = hf_hub_download(
                        dataset_id, fpath,
                        repo_type="dataset",
                        local_dir=output,
                    )
                except Exception as e:
                    print(f"    下载失败 {fpath}: {e}")
                    continue

        return True
    except ImportError:
        print("  huggingface_hub 未安装，尝试 pip install huggingface-hub")
        return False
    except Exception as e:
        print(f"  HuggingFace 下载失败: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="AISHELL-3 说话人提取器")
    parser.add_argument("--speakers", nargs="+", required=True, help="说话人 ID 列表")
    parser.add_argument("--output", required=True, help="输出目录")
    parser.add_argument("--ref-output", required=True, help="参考音频输出目录")
    parser.add_argument("--local-path", help="本地 AISHELL-3 数据集路径")
    args = parser.parse_args()

    os.makedirs(args.output, exist_ok=True)
    os.makedirs(args.ref_output, exist_ok=True)

    if args.local_path:
        print(f"从本地路径提取: {args.local_path}")
        extract_from_local(args.local_path, args.speakers, args.output, args.ref_output)
    else:
        # 尝试自动下载
        if not try_huggingface_download(args.speakers, args.output, args.ref_output):
            print("\n请手动下载 AISHELL-3 后使用 --local-path 参数指定路径")
            exit(1)


if __name__ == "__main__":
    main()
