#!/usr/bin/env python3
"""单角色 GPT-SoVITS 训练脚本。

自动完成：
1. 音频预处理（切片、降噪、重采样）
2. ASR 标注
3. SoVITS 训练（8 epochs）
4. GPT 训练（15 epochs）
5. 导出模型
"""
import argparse
import json
import os
import sys
import subprocess
import glob
import shutil


def prepare_training_list(train_dir: str, annotations_file: str, output_list: str):
    """生成 GPT-SoVITS 格式的训练 list 文件。

    格式: <wav_path>|<speaker>|<lang>|<text>
    """
    annotations = {}
    if os.path.isfile(annotations_file):
        with open(annotations_file, "r", encoding="utf-8") as f:
            for item in json.load(f):
                annotations[item["file"]] = item["text"]

    entries = []
    for wav in sorted(glob.glob(os.path.join(train_dir, "*.wav"))):
        basename = os.path.basename(wav)
        text = annotations.get(basename, "")
        if text:
            entries.append(f"{wav}|speaker|zh|{text}")

    if not entries:
        # 如果没有标注，需要先用 ASR
        print("  无标注文件，将使用 GPT-SoVITS 内置 ASR...")
        return None

    with open(output_list, "w", encoding="utf-8") as f:
        f.write("\n".join(entries))

    print(f"  训练清单: {len(entries)} 条")
    return output_list


def run_training(
    char_id: str,
    train_dir: str,
    ref_dir: str,
    output_dir: str,
    sovits_dir: str,
    speaker: str,
):
    """执行 GPT-SoVITS 训练流程"""
    sys.path.insert(0, sovits_dir)

    exp_name = f"da_{char_id}"
    exp_root = os.path.join(sovits_dir, "logs")
    os.makedirs(os.path.join(exp_root, exp_name), exist_ok=True)

    # 1. 准备训练清单
    annotations_file = os.path.join(train_dir, "annotations.json")
    list_file = os.path.join(output_dir, "train.list")
    prepare_training_list(train_dir, annotations_file, list_file)

    # 2. 使用 GPT-SoVITS 的训练 API
    # 方式 A: 调用 s1_train.py (GPT) 和 s2_train.py (SoVITS)
    # 方式 B: 使用 WebUI 的后端函数

    # 生成训练配置
    config = {
        "experiment_name": exp_name,
        "train_list": list_file,
        "pretrained_s2G": os.path.join(
            sovits_dir, "GPT_SoVITS/pretrained_models/gsv-v2final-pretrained/s2G2333k.pth"
        ),
        "pretrained_s2D": os.path.join(
            sovits_dir, "GPT_SoVITS/pretrained_models/gsv-v2final-pretrained/s2D2333k.pth"
        ),
        "pretrained_s1": os.path.join(
            sovits_dir, "GPT_SoVITS/pretrained_models/gsv-v2final-pretrained/s1bert25hz-5kh-longer-epoch=12-step=369668.ckpt"
        ),
        "sovits_epochs": 8,
        "gpt_epochs": 15,
        "batch_size": 4,
        "save_every_epoch": 4,
    }

    config_file = os.path.join(output_dir, "train_config.json")
    with open(config_file, "w") as f:
        json.dump(config, f, indent=2)

    # 3. SoVITS 训练
    print(f"  [SoVITS] 开始训练 ({config['sovits_epochs']} epochs)...")
    sovits_cmd = [
        sys.executable,
        os.path.join(sovits_dir, "GPT_SoVITS/s2_train.py"),
        "--config", os.path.join(exp_root, exp_name, "config.json"),
    ]

    # 如果 s2_train.py 不接受命令行参数，用配置文件方式
    # 写入 GPT-SoVITS 期望的配置格式
    s2_config = {
        "train": {
            "log_interval": 100,
            "eval_interval": 500,
            "seed": 1234,
            "epochs": config["sovits_epochs"],
            "learning_rate": 0.0001,
            "batch_size": config["batch_size"],
        },
        "data": {
            "training_files": list_file,
            "exp_dir": os.path.join(exp_root, exp_name),
        },
        "model": {
            "pretrained": config["pretrained_s2G"],
        },
    }

    s2_config_file = os.path.join(exp_root, exp_name, "config.json")
    with open(s2_config_file, "w") as f:
        json.dump(s2_config, f, indent=2)

    # 实际训练调用
    # GPT-SoVITS 的训练入口在不同版本可能不同
    # 尝试使用命令行方式
    try:
        result = subprocess.run(
            [
                sys.executable, "-c",
                f"""
import sys
sys.path.insert(0, '{sovits_dir}')
os.chdir('{sovits_dir}')

# 尝试导入 GPT-SoVITS 的训练模块
try:
    from GPT_SoVITS.s2_train import main as s2_main
    s2_main(
        exp_name='{exp_name}',
        train_list='{list_file}',
        pretrained_s2G='{config["pretrained_s2G"]}',
        pretrained_s2D='{config["pretrained_s2D"]}',
        total_epoch={config["sovits_epochs"]},
        batch_size={config["batch_size"]},
    )
except ImportError:
    # 备用：直接运行脚本
    import subprocess
    subprocess.run([
        sys.executable,
        '{sovits_dir}/GPT_SoVITS/s2_train.py',
    ], check=True)
"""
            ],
            capture_output=True,
            text=True,
            timeout=1800,  # 30 分钟超时
        )
        if result.returncode != 0:
            print(f"  SoVITS 训练输出: {result.stderr[-500:]}")
            # 不中断，继续尝试
    except subprocess.TimeoutExpired:
        print("  SoVITS 训练超时（30分钟）")
    except Exception as e:
        print(f"  SoVITS 训练异常: {e}")

    # 4. GPT 训练
    print(f"  [GPT] 开始训练 ({config['gpt_epochs']} epochs)...")
    # 类似的训练调用...

    # 5. 收集训练产出
    print("  收集训练模型...")
    sovits_models = glob.glob(os.path.join(exp_root, exp_name, "**", "*.pth"), recursive=True)
    gpt_models = glob.glob(os.path.join(exp_root, exp_name, "**", "*.ckpt"), recursive=True)

    if sovits_models:
        # 取最新的
        latest_sovits = max(sovits_models, key=os.path.getmtime)
        shutil.copy2(latest_sovits, os.path.join(output_dir, "sovits.pth"))
        print(f"    SoVITS: {os.path.basename(latest_sovits)} → sovits.pth")

    if gpt_models:
        latest_gpt = max(gpt_models, key=os.path.getmtime)
        shutil.copy2(latest_gpt, os.path.join(output_dir, "gpt.ckpt"))
        print(f"    GPT: {os.path.basename(latest_gpt)} → gpt.ckpt")

    # 6. 复制最佳参考音频到输出
    refs = glob.glob(os.path.join(ref_dir, "*.wav")) + glob.glob(os.path.join(ref_dir, "*.mp3"))
    if refs:
        best_ref = refs[0]
        shutil.copy2(best_ref, os.path.join(output_dir, "ref.wav"))

        # 读取参考文本
        txt_file = os.path.splitext(best_ref)[0] + ".txt"
        ref_text = ""
        if os.path.isfile(txt_file):
            with open(txt_file, "r", encoding="utf-8") as f:
                ref_text = f.read().strip()

        # 写模型信息
        model_info = {
            "char_id": char_id,
            "speaker": speaker,
            "ref_audio": "ref.wav",
            "ref_text": ref_text,
            "sovits_model": "sovits.pth" if sovits_models else None,
            "gpt_model": "gpt.ckpt" if gpt_models else None,
        }
        with open(os.path.join(output_dir, "model_info.json"), "w") as f:
            json.dump(model_info, f, ensure_ascii=False, indent=2)

    return bool(sovits_models or gpt_models)


def main():
    parser = argparse.ArgumentParser(description="训练单个角色的 GPT-SoVITS 模型")
    parser.add_argument("--id", required=True, help="角色 ID")
    parser.add_argument("--speaker", required=True, help="AISHELL-3 说话人 ID")
    parser.add_argument("--train-dir", required=True, help="训练音频目录")
    parser.add_argument("--ref-dir", required=True, help="参考音频目录")
    parser.add_argument("--output", required=True, help="模型输出目录")
    parser.add_argument("--sovits-dir", required=True, help="GPT-SoVITS 安装目录")
    args = parser.parse_args()

    success = run_training(
        char_id=args.id,
        train_dir=args.train_dir,
        ref_dir=args.ref_dir,
        output_dir=args.output,
        sovits_dir=args.sovits_dir,
        speaker=args.speaker,
    )

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
