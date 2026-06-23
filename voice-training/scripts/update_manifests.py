#!/usr/bin/env python3
"""训练完成后，更新角色 manifest 的 gpt_sovits 配置指向训练产出。

将 trained-models/<id>/ref.wav 复制到 app/public/voice-refs/<id>_ref.wav，
并更新 character.manifest.yaml 的 gpt_sovits 字段。
"""
import json
import os
import shutil
import glob
import sys

# 添加 yaml 支持
try:
    from yaml import safe_load, dump
except ImportError:
    print("需要 pyyaml: pip install pyyaml")
    sys.exit(1)


def main():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    project_root = os.path.dirname(base_dir)
    model_dir = os.path.join(base_dir, "trained-models")
    app_chars = os.path.join(project_root, "app", "public", "characters")
    app_refs = os.path.join(project_root, "app", "public", "voice-refs")

    os.makedirs(app_refs, exist_ok=True)

    updated = 0

    for char_dir in sorted(glob.glob(os.path.join(model_dir, "*"))):
        if not os.path.isdir(char_dir):
            continue

        char_id = os.path.basename(char_dir)
        info_file = os.path.join(char_dir, "model_info.json")

        if not os.path.isfile(info_file):
            continue

        with open(info_file, "r") as f:
            info = json.load(f)

        ref_audio_src = os.path.join(char_dir, info.get("ref_audio", "ref.wav"))
        ref_text = info.get("ref_text", "")

        if not os.path.isfile(ref_audio_src):
            print(f"  {char_id}: 跳过（无参考音频）")
            continue

        # 复制参考音频到应用
        ref_dst_name = f"{char_id}_ref.wav"
        ref_dst = os.path.join(app_refs, ref_dst_name)
        shutil.copy2(ref_audio_src, ref_dst)

        # 更新 manifest
        manifest_path = os.path.join(app_chars, char_id, "character.manifest.yaml")
        if not os.path.isfile(manifest_path):
            print(f"  {char_id}: manifest 不存在于 {manifest_path}")
            continue

        with open(manifest_path, "r", encoding="utf-8") as f:
            content = f.read()
            manifest = safe_load(content)

        # 更新 gpt_sovits 字段
        # 参考音频路径使用相对于 voice-refs 的路径
        manifest["gpt_sovits"] = {
            "ref_audio": f"/voice-refs/{ref_dst_name}",
            "ref_text": ref_text,
            "ref_lang": "zh",
        }

        # 写回 YAML（保持格式尽量整洁）
        with open(manifest_path, "w", encoding="utf-8") as f:
            dump(
                manifest,
                f,
                default_flow_style=False,
                allow_unicode=True,
                sort_keys=False,
                width=120,
            )

        print(f"  {char_id}: ✓ manifest 已更新")
        print(f"    ref_audio: /voice-refs/{ref_dst_name}")
        print(f"    ref_text: {ref_text[:50]}{'...' if len(ref_text) > 50 else ''}")
        updated += 1

    print(f"\n已更新 {updated} 个角色 manifest")

    if updated > 0:
        print("\n在桌面助理中测试:")
        print("  1. 确保 GPT-SoVITS 服务在运行 (./scripts/04_start_server.sh)")
        print("  2. 设置中选择 TTS provider = GPT-SoVITS")
        print("  3. 设置服务地址 = http://127.0.0.1:9880")
        print("  4. 点击角色说话，验证声线")


if __name__ == "__main__":
    main()
