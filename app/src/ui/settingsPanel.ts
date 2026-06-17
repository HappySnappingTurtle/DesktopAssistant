import { getCurrentWindow } from "@tauri-apps/api/window";

export interface SettingsDeps {
  getConfig: () => Promise<Record<string, unknown>>;
  setConfig: (patch: Record<string, unknown>) => Promise<unknown>;
  setSecret: (name: string, value: string) => Promise<void>;
  hasSecret: (name: string) => Promise<boolean>;
  getPttShortcut: () => Promise<string>;
  setPttShortcut: (s: string) => Promise<string>;
  getHookEndpoint: () => Promise<string>;
  installClaudeHook: (dir: string) => Promise<string>;
  setAlwaysVisible: (enabled: boolean) => Promise<void>;
  characters: Array<{ id: string; displayName: string }>;
  onApplied: (config: Record<string, unknown>) => void;
}

const VOICE_PRESETS = [
  ["zh-CN-XiaoyiNeural", "晓伊（活泼少女・三月七）"],
  ["zh-CN-YunxiNeural", "云希（沉稳青年・丹恒）"],
  ["zh-CN-XiaoxiaoNeural", "晓晓（温暖女声）"],
  ["zh-CN-YunjianNeural", "云健（磁性男声）"],
] as const;

let panel: HTMLElement | null = null;

export function hideSettings() {
  panel?.remove();
  panel = null;
}

export async function showSettings(deps: SettingsDeps) {
  console.log("[settings] opening...");
  hideSettings();
  const cfg = await deps.getConfig();
  const llm = (cfg.llm ?? {}) as Record<string, string>;
  const vo = (cfg.voice_override ?? {}) as Record<string, unknown>;
  // 不在打开面板时检查 Keychain（避免触发密码弹窗）
  // hasSecret 延迟到用户展开 LLM 段时才调用
  let hasKey: boolean | null = null; // null=未检查
  let pttShortcut = "Alt+Space";
  try { pttShortcut = await deps.getPttShortcut(); } catch (e) { console.warn("[settings] getPttShortcut:", e); }
  const up = (cfg.user_profile ?? {}) as Record<string, string>;
  const ttsConf = (cfg.tts ?? {}) as Record<string, string>;
  let hookEndpoint = "";
  try { hookEndpoint = await deps.getHookEndpoint(); } catch { /* not running */ }
  console.log("[settings] data loaded, ptt:", pttShortcut, "hook:", hookEndpoint);

  panel = document.createElement("div");
  panel.id = "settings";
  panel.style.cssText =
    "position:fixed;inset:12px;z-index:9990;border-radius:16px;overflow-y:auto;" +
    "background:rgba(24,24,30,.97);color:#eee;padding:16px 18px;" +
    "font:13px -apple-system,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.5);";

  const field = (label: string, input: string) =>
    `<label style="display:block;margin:8px 0 2px;color:#9aa">${label}</label>${input}`;
  const inputStyle =
    "width:100%;box-sizing:border-box;padding:6px 8px;border-radius:8px;border:1px solid #444;" +
    "background:#15151a;color:#eee;font:13px -apple-system,sans-serif;";

  panel.innerHTML = `
    <div id="st-titlebar" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;cursor:grab;padding:4px 0;user-select:none">
      <b style="font-size:15px">设置</b>
      <span style="color:#666;font-size:11px;flex:1;text-align:center">（拖此处移动窗口）</span>
      <span id="st-close" style="cursor:pointer;padding:4px 8px;color:#888">✕</span>
    </div>

    <fieldset style="border:1px solid #333;border-radius:10px;margin:10px 0;padding:8px 12px">
      <legend style="color:#8ab">用户信息</legend>
      ${field("角色怎么称呼你", `<input id="st-nickname" style="${inputStyle}" value="${up.nickname ?? ""}" placeholder="如：老板、小明（留空则用「你」）">`)}
      ${field("自我介绍（可选）", `<input id="st-intro" style="${inputStyle}" value="${up.self_intro ?? ""}" placeholder="帮助角色理解你的工作上下文">`)}
      ${field("自定义 Prompt 补充（高级，可选）", `<textarea id="st-prompt-extra" style="${inputStyle}height:60px;resize:vertical;" placeholder="追加到 system prompt 末尾，如：回复用英文 / 不要用敬语">${up.system_prompt_extra ?? ""}</textarea>`)}
    </fieldset>

    <details id="st-llm-details" style="border:1px solid #333;border-radius:10px;margin:10px 0;padding:8px 12px">
      <summary style="color:#8ab;cursor:pointer;user-select:none;padding:2px 0">LLM 模型（点击展开修改）</summary>
      <div style="margin-top:8px">
      ${field("Provider", `<select id="st-provider" style="${inputStyle}">
        <option value="openai-compatible">OpenAI 兼容（含 Ollama /v1）</option>
        <option value="anthropic">Anthropic</option>
        <option value="ollama">Ollama 原生</option>
      </select>`)}
      ${field("Base URL", `<input id="st-baseurl" style="${inputStyle}" value="${llm.base_url ?? ""}">`)}
      ${field("模型名", `<input id="st-model" style="${inputStyle}" value="${llm.model ?? ""}">`)}
      ${field(`API Key <span id="st-key-status" style="color:#777">（展开时检查状态…）</span>`,
        `<input id="st-key" type="password" style="${inputStyle}" placeholder="sk-...">`)}
      </div>
    </details>

    <fieldset style="border:1px solid #333;border-radius:10px;margin:10px 0;padding:8px 12px">
      <legend style="color:#8ab">语音</legend>
      <label style="display:flex;gap:6px;align-items:center;margin:6px 0">
        <input id="st-vo-on" type="checkbox" ${vo.enabled ? "checked" : ""}> 覆盖角色默认声线
      </label>
      ${field("声线", `<select id="st-voice" style="${inputStyle}">
        ${VOICE_PRESETS.map(([v, n]) => `<option value="${v}">${n}</option>`).join("")}
      </select>`)}
      ${field("音调（如 +2Hz）", `<input id="st-pitch" style="${inputStyle}" value="${vo.pitch ?? "+0Hz"}">`)}
      ${field("语速（如 +3%）", `<input id="st-rate" style="${inputStyle}" value="${vo.rate ?? "+0%"}">`)}
      <label style="display:flex;gap:6px;align-items:center;margin:8px 0 2px">
        <input id="st-muted" type="checkbox" ${cfg.muted ? "checked" : ""}> 静音播报
      </label>
      ${field("语音审批模式", `<select id="st-mode" style="${inputStyle}">
        <option value="safe-list">safe-list（黑名单外可语音审批）</option>
        <option value="auto">auto（禁用语音审批）</option>
        <option value="parrot">parrot（只播报不操作）</option>
      </select>`)}
      <div style="border-top:1px solid #333;margin-top:10px;padding-top:8px">
      ${field("TTS 引擎", `<select id="st-tts-provider" style="${inputStyle}">
        <option value="edge-tts">Edge TTS（默认，联网，零配置）</option>
        <option value="gpt-sovits">GPT-SoVITS（本地，需启动服务）</option>
        <option value="cosyvoice">CosyVoice 2（本地，需 Docker + GPU）</option>
      </select>`)}
      ${field("TTS 服务地址（仅 GPT-SoVITS / CosyVoice）", `<input id="st-tts-url" style="${inputStyle}" value="${ttsConf.provider_url ?? ""}" placeholder="如 http://127.0.0.1:9880">`)}
      </div>
    </fieldset>

    <fieldset style="border:1px solid #333;border-radius:10px;margin:10px 0;padding:8px 12px">
      <legend style="color:#8ab">窗口</legend>
      <label style="display:flex;gap:6px;align-items:center;margin:6px 0;line-height:1.6">
        <input id="st-topmost" type="checkbox" checked> 始终在所有应用之上（包括切换桌面/全屏应用后）
      </label>
      <div style="color:#777;font-size:12px">关闭后角色只在当前桌面可见，切换应用可能被遮挡</div>
    </fieldset>

    <fieldset style="border:1px solid #333;border-radius:10px;margin:10px 0;padding:8px 12px">
      <legend style="color:#8ab">快捷键</legend>
      ${field("语音输入（按住说话）", `<div style="display:flex;gap:8px;align-items:center">
        <input id="st-ptt" style="${inputStyle}flex:1;" value="${pttShortcut}" readonly placeholder="点击后按下快捷键">
        <button id="st-ptt-record" style="padding:6px 12px;border-radius:8px;border:1px solid #555;background:transparent;color:#8cf;cursor:pointer;white-space:nowrap;font-size:13px">录制</button>
      </div>`)}
      <div id="st-ptt-hint" style="color:#777;font-size:12px;margin-top:4px">点击「录制」后按下你想用的快捷键组合</div>
    </fieldset>

    <fieldset style="border:1px solid #333;border-radius:10px;margin:10px 0;padding:8px 12px">
      <legend style="color:#8ab">Agent 监控</legend>
      <div style="margin:6px 0;line-height:1.6">
        <div style="color:#9aa;margin-bottom:4px">Hook 端点：<span style="color:#8cf">${hookEndpoint || "未启动"}</span></div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input id="st-hookdir" style="${inputStyle}flex:1;min-width:120px;" placeholder="项目路径（如 /Users/xxx/my-project）">
          <button id="st-install-hook" style="padding:6px 14px;border-radius:8px;border:0;background:#3b82f6;color:#fff;cursor:pointer;white-space:nowrap;font-size:13px">安装 Claude Hook</button>
        </div>
        <div id="st-hook-result" style="color:#7a7;font-size:12px;margin-top:4px"></div>
        <div style="color:#777;font-size:12px;margin-top:6px">
          在指定项目的 .claude/settings.json 中自动添加 Notification+Stop hook。<br>
          Codex/Gemini 请用 <code>assist run -- codex</code> 包装运行。
        </div>
      </div>
    </fieldset>

    <fieldset style="border:1px solid #333;border-radius:10px;margin:10px 0;padding:8px 12px">
      <legend style="color:#8ab">Live2D 角色</legend>
      ${field("当前角色", `<select id="st-char" style="${inputStyle}">
        ${deps.characters.map((c) => `<option value="${c.id}">${c.displayName}</option>`).join("")}
      </select>`)}
      <div style="color:#777;margin-top:6px;line-height:1.5">
        导入新模型：把含 character.manifest.yaml 的角色包放入应用目录后重启（拖入导入将在后续版本提供）。
        三月七/丹恒模型下载：BOOTH / Ko-fi（需登录）。
      </div>
    </fieldset>

    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:12px">
      <button id="st-cancel" style="padding:7px 16px;border-radius:9px;border:1px solid #555;background:transparent;color:#ccc;cursor:pointer">取消</button>
      <button id="st-save" style="padding:7px 16px;border-radius:9px;border:0;background:#3b82f6;color:#fff;cursor:pointer">保存</button>
    </div>`;

  document.body.appendChild(panel);
  (panel.querySelector("#st-provider") as HTMLSelectElement).value =
    (llm.provider as string) ?? "openai-compatible";
  (panel.querySelector("#st-voice") as HTMLSelectElement).value =
    (vo.voice as string) ?? "zh-CN-XiaoyiNeural";
  (panel.querySelector("#st-mode") as HTMLSelectElement).value =
    (cfg.approval_mode as string) ?? "safe-list";
  (panel.querySelector("#st-tts-provider") as HTMLSelectElement).value =
    ttsConf.provider ?? "edge-tts";
  (panel.querySelector("#st-char") as HTMLSelectElement).value =
    (cfg.active_character as string) ?? deps.characters[0]?.id ?? "";

  // 标题栏拖拽窗口
  const titlebar = panel.querySelector("#st-titlebar")!;
  titlebar.addEventListener("pointerdown", (e) => {
    const ev = e as PointerEvent;
    if (ev.button !== 0) return;
    void getCurrentWindow().startDragging();
  });

  // LLM 段展开时才检查 Keychain（避免无关操作触发密码弹窗）
  panel.querySelector("#st-llm-details")!.addEventListener("toggle", async (e) => {
    const details = e.target as HTMLDetailsElement;
    if (details.open && hasKey === null) {
      try {
        hasKey = await deps.hasSecret("llm_api_key");
      } catch {
        hasKey = false;
      }
      const status = panel!.querySelector("#st-key-status");
      const keyInput = panel!.querySelector("#st-key") as HTMLInputElement;
      if (status) status.textContent = hasKey ? "（已保存，留空则不变）" : "（未设置）";
      if (keyInput) keyInput.placeholder = hasKey ? "••••••••" : "sk-...";
    }
  });

  // 快捷键录制
  {
    const pttInput = panel.querySelector("#st-ptt") as HTMLInputElement;
    const recordBtn = panel.querySelector("#st-ptt-record") as HTMLElement;
    const hint = panel.querySelector("#st-ptt-hint") as HTMLElement;
    let recording = false;

    function keyToName(e: KeyboardEvent): string | null {
      const map: Record<string, string> = {
        " ": "Space", Enter: "Enter", Tab: "Tab", Escape: "Escape", Backspace: "Backspace",
      };
      if (map[e.key]) return map[e.key];
      if (e.code.startsWith("Key")) return e.code.slice(3);
      if (e.code.startsWith("Digit")) return e.code.slice(5);
      if (e.key.length === 1) return e.key.toUpperCase();
      return null;
    }

    function handleKey(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      // 只按修饰键时不确认（等用户按主键）
      if (["Alt", "Control", "Shift", "Meta"].includes(e.key)) {
        const parts: string[] = [];
        if (e.ctrlKey) parts.push("Ctrl");
        if (e.altKey) parts.push("Alt");
        if (e.shiftKey) parts.push("Shift");
        if (e.metaKey) parts.push("Cmd");
        hint.textContent = `已按下：${parts.join("+")}+...（再按一个主键确认）`;
        hint.style.color = "#8cf";
        return;
      }
      const parts: string[] = [];
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");
      if (e.metaKey) parts.push("Cmd");
      const keyName = keyToName(e);
      if (!keyName) return;
      parts.push(keyName);
      pttInput.value = parts.join("+");
      stopRecording();
      hint.textContent = `✓ 已设置为 ${pttInput.value}`;
      hint.style.color = "#7a7";
    }

    function stopRecording() {
      recording = false;
      recordBtn.textContent = "录制";
      recordBtn.style.borderColor = "#555";
      recordBtn.style.color = "#8cf";
      window.removeEventListener("keydown", handleKey, true);
    }

    recordBtn.addEventListener("click", () => {
      if (recording) {
        stopRecording();
        hint.textContent = "点击「录制」后按下你想用的快捷键组合";
        hint.style.color = "#777";
        return;
      }
      recording = true;
      recordBtn.textContent = "取消";
      recordBtn.style.borderColor = "#f55";
      recordBtn.style.color = "#f88";
      hint.textContent = "⏺ 请按下快捷键组合...（如 Alt+Space）";
      hint.style.color = "#fc0";
      window.addEventListener("keydown", handleKey, true);
    });
  }

  // Hook 安装按钮
  panel.querySelector("#st-install-hook")!.addEventListener("click", async () => {
    const dir = (panel!.querySelector("#st-hookdir") as HTMLInputElement).value.trim();
    const result = panel!.querySelector("#st-hook-result") as HTMLElement;
    if (!dir) {
      result.textContent = "❌ 请输入项目路径";
      result.style.color = "#f77";
      return;
    }
    try {
      const path = await deps.installClaudeHook(dir);
      result.textContent = `✅ 已安装到 ${path}`;
      result.style.color = "#7a7";
    } catch (e) {
      result.textContent = `❌ ${String(e)}`;
      result.style.color = "#f77";
    }
  });

  panel.querySelector("#st-close")!.addEventListener("click", hideSettings);
  panel.querySelector("#st-cancel")!.addEventListener("click", hideSettings);
  panel.querySelector("#st-save")!.addEventListener("click", async () => {
    const v = (id: string) => (panel!.querySelector(id) as HTMLInputElement).value.trim();
    const checked = (id: string) => (panel!.querySelector(id) as HTMLInputElement).checked;

    const patch: Record<string, unknown> = {
      llm: { provider: v("#st-provider"), base_url: v("#st-baseurl"), model: v("#st-model") },
      voice_override: {
        enabled: checked("#st-vo-on"),
        voice: v("#st-voice"),
        pitch: v("#st-pitch"),
        rate: v("#st-rate"),
      },
      muted: checked("#st-muted"),
      approval_mode: v("#st-mode"),
      tts: {
        provider: v("#st-tts-provider"),
        provider_url: v("#st-tts-url"),
      },
      active_character: v("#st-char"),
    };
    patch.user_profile = {
      nickname: v("#st-nickname") || "你",
      self_intro: v("#st-intro"),
      system_prompt_extra: (panel!.querySelector("#st-prompt-extra") as HTMLTextAreaElement).value.trim(),
    };
    const key = v("#st-key");
    const newPtt = v("#st-ptt");
    const topmost = checked("#st-topmost");
    patch.always_visible = topmost;
    const errors: string[] = [];
    try {
      if (key) await deps.setSecret("llm_api_key", key);
    } catch (e) {
      errors.push("API Key 保存失败: " + String(e));
    }
    if (newPtt && newPtt !== pttShortcut) {
      try {
        await deps.setPttShortcut(newPtt);
      } catch (e) {
        errors.push("快捷键设置失败: " + String(e));
      }
    }
    try {
      await deps.setAlwaysVisible(topmost);
    } catch (e) {
      errors.push("窗口置顶设置失败: " + String(e));
    }
    try {
      const merged = (await deps.setConfig(patch)) as Record<string, unknown>;
      deps.onApplied(merged);
    } catch (e) {
      errors.push("配置保存失败: " + String(e));
    }
    if (errors.length > 0) {
      // 在面板内显示错误（而不是 alert——透明窗口里 alert 可能不可见）
      let errEl = panel!.querySelector("#st-errors") as HTMLElement | null;
      if (!errEl) {
        errEl = document.createElement("div");
        errEl.id = "st-errors";
        errEl.style.cssText = "color:#f77;font-size:12px;margin-top:8px;padding:8px;background:rgba(200,50,50,.15);border-radius:8px;";
        panel!.querySelector("#st-save")!.parentElement!.after(errEl);
      }
      errEl.textContent = errors.join("\n");
    } else {
      hideSettings();
    }
  });
}
