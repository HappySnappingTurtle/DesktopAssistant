import { getCurrentWindow } from "@tauri-apps/api/window";

export interface OnboardingDeps {
  setConfig: (patch: Record<string, unknown>) => Promise<unknown>;
  setSecret: (name: string, value: string) => Promise<void>;
  onDone: (config: Record<string, unknown>) => void;
}

const STEPS = [
  {
    title: "欢迎使用 DesktopAssistant ✨",
    body: `
      <p>你的 AI Agent 桌面伴侣——帮你监控 Claude/Codex 等编码 Agent 的审批状态，用语音完成批准/拒绝操作。</p>
      <p style="margin-top:12px;color:#9ab">她也可以陪你聊天、播报消息、陪伴工作。</p>
    `,
  },
  {
    title: "基本操作",
    body: `
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr><td style="padding:6px 0;color:#8cf">左键按住拖动</td><td>移动角色位置</td></tr>
        <tr><td style="padding:6px 0;color:#8cf">左键点击</td><td>角色互动（说话+动作）</td></tr>
        <tr><td style="padding:6px 0;color:#8cf">右键</td><td>打开菜单（设置/放大缩小/静音/退出）</td></tr>
        <tr><td style="padding:6px 0;color:#8cf">捏合/Cmd+滚轮</td><td>缩放角色大小</td></tr>
        <tr><td style="padding:6px 0;color:#8cf">Alt + Space（按住）</td><td>语音输入（松开后自动识别）</td></tr>
      </table>
    `,
  },
  {
    title: "语音审批（核心功能）",
    body: `
      <p>当 Claude Code 等 Agent 需要审批时，角色会<b>语音提醒</b>你。</p>
      <p style="margin-top:8px">你可以：</p>
      <ul style="margin:6px 0;padding-left:18px;line-height:1.8">
        <li>按住 <b>Alt+Space</b> 说「同意」→ 自动帮你批准</li>
        <li>说「不行」→ 自动拒绝</li>
        <li>说其他指令 → 直接发送给 Agent</li>
      </ul>
      <p style="margin-top:8px;color:#f99">⚠️ 高危操作（rm -rf、sudo 等）会被自动拦截，要求你亲自在终端确认。</p>
    `,
  },
  {
    title: "语音唤醒（可选）",
    body: `
      <p>默认使用 <b>按住说话</b>（Alt+Space），不会持续监听麦克风。</p>
      <p style="margin-top:8px;color:#9ab">持续唤醒词功能（呼叫名字即可对话）将在后续版本提供，届时可在设置中开启。</p>
      <p style="margin-top:12px">现在的交互方式：</p>
      <div style="background:rgba(255,255,255,.06);border-radius:8px;padding:10px;margin-top:6px;font-size:13px">
        按住 Alt+Space → 说话 → 松开 → 自动识别 → 角色回应
      </div>
    `,
  },
  {
    title: "关于你",
    body: `
      <p>角色需要知道怎么称呼你，这样对话更自然。</p>
      <div style="margin:10px 0">
        <label style="display:block;margin:6px 0;color:#9aa">角色怎么称呼你？</label>
        <input id="ob-nickname" style="__INPUT__" value="" placeholder="如：老板、小明、Boss（留空则用「你」）">
        <label style="display:block;margin:8px 0 4px;color:#9aa">简单介绍自己（可选，帮助角色理解上下文）</label>
        <input id="ob-intro" style="__INPUT__" value="" placeholder="如：全栈开发者，主要写 TS 和 Rust">
      </div>
      <p style="color:#777;font-size:12px">这些信息只存在本地，随时可在设置中修改。</p>
    `,
  },
  {
    title: "配置 LLM（让角色能聊天）",
    body: `
      <p>角色需要一个 LLM 来理解你说的话。支持三种接入方式：</p>
      <div style="margin:10px 0">
        <label style="display:block;margin:6px 0;color:#9aa">Provider</label>
        <select id="ob-provider" style="__INPUT__">
          <option value="openai-compatible">OpenAI 兼容（含 Ollama /v1）</option>
          <option value="anthropic">Anthropic</option>
          <option value="ollama">Ollama 原生</option>
        </select>
        <label style="display:block;margin:6px 0;color:#9aa">Base URL</label>
        <input id="ob-baseurl" style="__INPUT__" value="http://127.0.0.1:11434/v1" placeholder="http://...">
        <label style="display:block;margin:6px 0;color:#9aa">模型名</label>
        <input id="ob-model" style="__INPUT__" value="qwen3:8b" placeholder="qwen3:8b / claude-sonnet-4-6">
        <label style="display:block;margin:6px 0;color:#9aa">API Key（Ollama 本地可留空）</label>
        <input id="ob-key" type="password" style="__INPUT__" placeholder="sk-...">
      </div>
      <p style="color:#777;font-size:12px">跳过也行——右键菜单「设置…」随时可改。</p>
    `,
  },
];

const INPUT_STYLE =
  "width:100%;box-sizing:border-box;padding:6px 8px;border-radius:8px;border:1px solid #444;" +
  "background:#15151a;color:#eee;font:13px -apple-system,sans-serif;";

export function showOnboarding(deps: OnboardingDeps): Promise<void> {
  return new Promise((resolve) => {
    let step = 0;
    const overlay = document.createElement("div");
    overlay.id = "onboarding";
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:20000;background:rgba(10,10,16,.97);" +
      "display:flex;align-items:center;justify-content:center;";

    const card = document.createElement("div");
    card.style.cssText =
      "width:340px;max-height:90vh;overflow-y:auto;background:rgba(30,30,38,.98);" +
      "border-radius:18px;padding:24px 22px;color:#eee;font:14px -apple-system,sans-serif;" +
      "box-shadow:0 12px 48px rgba(0,0,0,.6);";

    // 标题栏可拖窗口
    const titleBar = document.createElement("div");
    titleBar.style.cssText = "cursor:grab;margin-bottom:4px;";
    titleBar.addEventListener("pointerdown", (e) => {
      if (e.button === 0) void getCurrentWindow().startDragging();
    });

    const title = document.createElement("h2");
    title.style.cssText = "margin:0 0 14px;font-size:17px;font-weight:600;";

    const body = document.createElement("div");
    body.style.cssText = "line-height:1.7;color:#ccc;";

    const nav = document.createElement("div");
    nav.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-top:18px;";

    const dots = document.createElement("div");
    dots.style.cssText = "display:flex;gap:6px;";

    const btnPrev = document.createElement("button");
    btnPrev.textContent = "上一步";
    btnPrev.style.cssText =
      "padding:7px 14px;border-radius:9px;border:1px solid #555;background:transparent;color:#aaa;cursor:pointer;font-size:13px;";

    const btnNext = document.createElement("button");
    btnNext.style.cssText =
      "padding:7px 18px;border-radius:9px;border:0;background:#3b82f6;color:#fff;cursor:pointer;font-size:13px;font-weight:500;";

    function render() {
      const s = STEPS[step];
      title.textContent = s.title;
      body.innerHTML = s.body.replace(/__INPUT__/g, INPUT_STYLE);
      dots.innerHTML = STEPS.map(
        (_, i) =>
          `<span style="width:8px;height:8px;border-radius:50%;background:${i === step ? "#3b82f6" : "#444"}"></span>`,
      ).join("");
      btnPrev.style.display = step === 0 ? "none" : "inline-block";
      const isLast = step === STEPS.length - 1;
      btnNext.textContent = isLast ? "开始使用 🎉" : "下一步 →";
    }

    btnPrev.addEventListener("click", () => {
      if (step > 0) {
        step--;
        render();
      }
    });

    btnNext.addEventListener("click", async () => {
      if (step === STEPS.length - 1) {
        // 最后一步：保存 LLM 配置
        const v = (id: string) =>
          (overlay.querySelector(id) as HTMLInputElement | null)?.value.trim() ?? "";
        const patch: Record<string, unknown> = {
          onboarded: true,
          user_profile: {
            nickname: v("#ob-nickname") || "你",
            self_intro: v("#ob-intro"),
            system_prompt_extra: "",
          },
          llm: {
            provider: v("#ob-provider"),
            base_url: v("#ob-baseurl"),
            model: v("#ob-model"),
          },
        };
        const key = v("#ob-key");
        try {
          if (key) await deps.setSecret("llm_api_key", key);
          await deps.setConfig(patch);
          deps.onDone(patch);
        } catch (e) {
          console.error("[onboarding] save failed:", e);
        }
        overlay.remove();
        resolve();
      } else {
        step++;
        render();
      }
    });

    titleBar.appendChild(title);
    card.appendChild(titleBar);
    card.appendChild(body);
    nav.appendChild(btnPrev);
    nav.appendChild(dots);
    nav.appendChild(btnNext);
    card.appendChild(nav);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    render();
  });
}
