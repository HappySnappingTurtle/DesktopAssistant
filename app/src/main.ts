import * as PIXI from "pixi.js";
import { Live2DModel } from "pixi-live2d-display-lipsyncpatch";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ping, setClickThrough } from "./ipc";
import { createClickThroughController } from "./window/clickThrough";
import { createDragTapController } from "./window/dragTap";
import { createRenderer, type RendererHandle } from "./live2d/renderer";
import { createCharacterStore } from "./character/store";
import { createWebCharacterFs } from "./character/webFs";
import {
  applyVoiceOverride,
  DEFAULT_VOICES,
  type VoiceOverride,
  type VoiceProfile,
} from "./character/voice";
import { subscribeAgentEvents } from "./agent/events";
import { mapEvent } from "./behavior/engine";
import { createTTSManager } from "./tts/manager";
import { createApprovalRouter } from "./voice/approvalRouter";
import { parseEmotionReply } from "./llm/emotionParser";
import { assemblePrompt, type AssemblerInput } from "./llm/promptAssembler";
import { buildPersonalityReminder, detectDrift, type Persona } from "./llm/identityAnchor";
import { allocateBudget } from "./llm/tokenBudget";
import { resolveEmotionParams } from "./performance/engine";
import { createParamAnimator } from "./performance/paramAnimator";
import { emotionTtsShift } from "./tts/emotionAdapter";
import { createMemoryStore, type UserMemoryState } from "./memory/store";
import { selectRelevantFacts } from "./memory/selector";
import { defaultRelationship, adjustIntimacy, setMoodBaseline, currentMood, decayIntimacy, type RelationshipState } from "./memory/relationship";
import { createConversationManager, type ConversationState } from "./conversation/manager";
import { createCompressor } from "./conversation/compressor";
import { createMemoryExtractor } from "./memory/extractor";
import type { ApprovalMode } from "./voice/securityGate";
import { createPhraseCache } from "./tts/phraseCache";
import { showContextMenu } from "./ui/contextMenu";
import { showSettings } from "./ui/settingsPanel";
import { showOnboarding } from "./ui/onboarding";

Live2DModel.registerTicker(PIXI.Ticker as never);

const BUILTIN_CHARACTERS = ["march7th", "natori", "hiyori"];

/** 默认点击短语，manifest 里的 triggers.*.tts 可覆盖 */
const DEFAULT_TAP_PHRASES: Record<string, string[]> = {
  head: ["嗯？怎么啦～", "干嘛戳我头啦", "在呢在呢！"],
  body: ["嘿嘿，找我有事吗？", "我在听～", "想聊点什么？"],
};

function getTapPhrase(area: string, manifest?: { triggers?: Record<string, { tts?: string }> }): string {
  const custom = manifest?.triggers?.[area]?.tts;
  if (custom) return custom;
  const pool = DEFAULT_TAP_PHRASES[area] ?? DEFAULT_TAP_PHRASES.body;
  return pool[Math.floor(Math.random() * pool.length)];
}

function badge(text: string, bg = "rgba(40,40,60,.85)") {
  let el = document.getElementById("dev-badge");
  if (!el) {
    el = document.createElement("div");
    el.id = "dev-badge";
    el.style.cssText =
      "position:fixed;top:8px;left:8px;padding:4px 10px;border-radius:8px;color:#fff;font:12px monospace;z-index:9999;";
    document.body.appendChild(el);
  }
  el.style.background = bg;
  el.textContent = text;
}

async function setup() {
  badge("booting…");
  const root = document.getElementById("app")!;
  root.innerHTML = `
    <div id="stage" style="position:absolute;inset:0;">
      <canvas id="live2d" style="width:100%;height:100%;"></canvas>
    </div>`;

  const canvas = document.getElementById("live2d") as HTMLCanvasElement;
  let renderer: RendererHandle | null = null;

  // ── 运行时配置（设置页可改） ─────────────────────────────
  let config: Record<string, unknown> = {};
  let approvalMode: ApprovalMode = "safe-list";
  let manifestVoice: VoiceProfile = DEFAULT_VOICES.female;

  // ── TTS ────────────────────────────────────────────────
  const tts = createTTSManager(
    {
      synthesize: async (text, v: VoiceProfile) => {
        const ttsConfig = (config.tts ?? {}) as Record<string, string>;
        const b64 = await invoke<string>("tts_synthesize", {
          text,
          voice: v.voice,
          pitch: v.pitch,
          rate: v.rate,
          provider: ttsConfig.provider ?? null,
          providerUrl: ttsConfig.provider_url ?? null,
        });
        return `data:audio/mpeg;base64,${b64}`;
      },
      play: (url) => renderer?.speak(url) ?? Promise.resolve(),
      fallback: (text) =>
        new Promise<void>((resolve) => {
          const u = new SpeechSynthesisUtterance(text);
          u.lang = "zh-CN";
          // 尝试匹配中文声音
          const voices = speechSynthesis.getVoices();
          const zhVoice = voices.find((v) => v.lang.startsWith("zh"));
          if (zhVoice) u.voice = zhVoice;
          u.onend = () => resolve();
          u.onerror = () => resolve();
          speechSynthesis.speak(u);
        }),
    },
    DEFAULT_VOICES.female,
  );

  // 点击台词预合成缓存（正确声线 + 零延迟）
  const phraseCache = createPhraseCache({
    synthesize: async (text, v) => {
      const b64 = await invoke<string>("tts_synthesize", {
        text, voice: v.voice, pitch: v.pitch, rate: v.rate,
      });
      return `data:audio/mpeg;base64,${b64}`;
    },
  });

  function applyVoice() {
    const voice = applyVoiceOverride(manifestVoice, config.voice_override as VoiceOverride);
    tts.setVoice(voice);
    // 预合成当前角色的所有点击台词
    const activeChar = store.getActive();
    const allPhrases = collectTapPhrases(activeChar?.manifest);
    phraseCache.setVoice(voice, allPhrases);
  }

  function collectTapPhrases(manifest?: { triggers?: Record<string, { tts?: string }> }): string[] {
    const phrases: string[] = [];
    for (const pool of Object.values(DEFAULT_TAP_PHRASES)) phrases.push(...pool);
    if (manifest?.triggers) {
      for (const t of Object.values(manifest.triggers)) {
        if (t.tts) phrases.push(t.tts);
      }
    }
    return [...new Set(phrases)];
  }

  // ── 情绪驱动对话系统 ──────────────────────────────────────

  // 持久状态（从 config 恢复）
  let relationship: RelationshipState = (config.relationship as RelationshipState) ?? defaultRelationship();
  const memoryStore = createMemoryStore(config.user_memory as UserMemoryState | undefined);
  const compressor = createCompressor({
    llmSummarize: (prompt) => invoke<string>("llm_chat", { system: "你是摘要助手。", messages: [{ role: "user", content: prompt }] }),
  });
  const conversation = createConversationManager(
    config.conversation as ConversationState | undefined,
    compressor,
  );
  const memoryExtractor = createMemoryExtractor({
    llmExtract: (prompt) => invoke<string>("llm_chat", { system: "你是信息提取助手。只返回JSON。", messages: [{ role: "user", content: prompt }] }),
    existingFacts: () => memoryStore.getFacts().map((f) => f.text),
    addFact: (text) => memoryStore.addFact(text),
  });

  // 参数动画器
  const paramAnimator = createParamAnimator({
    setParameter: (id, v) => renderer?.setParameter(id, v),
  });
  // ticker 在渲染器创建后通过 requestAnimationFrame 驱动
  function startParamTicker() {
    const tick = () => { paramAnimator.tick(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  startParamTicker();

  let turnsSinceReminder = 0;
  let activePersona: Persona = {};
  let activeMotionKeys: string[] = [];
  let emotionParamOverrides: Record<string, Record<string, number>> | undefined;

  async function chat(text: string, additionalContext = "") {
    const userProfile = (config.user_profile ?? {}) as Record<string, string>;
    const nickname = userProfile.nickname || "你";

    conversation.push({ role: "user", content: text });
    showBubble("💭 …");
    void renderer?.playMotion("think");

    // 选相关记忆
    const { selected, indices } = selectRelevantFacts(memoryStore.getFacts(), text);
    memoryStore.markUsed(indices);

    // 定期 reminder
    turnsSinceReminder++;
    const driftCorrection = turnsSinceReminder >= 10
      ? (() => { turnsSinceReminder = 0; return buildPersonalityReminder(
          store.getActive()?.displayName ?? "", activePersona.personality?.slice(0, 30) ?? ""); })()
      : undefined;

    // 组装 prompt
    const now = new Date();
    const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
    const msSinceInteraction = Date.now() - new Date(memoryStore.getState().last_interaction).getTime();
    relationship = decayIntimacy(relationship, memoryStore.getState().last_interaction);

    const input: AssemblerInput = {
      displayName: store.getActive()?.displayName ?? "助手",
      persona: activePersona,
      motionKeys: activeMotionKeys,
      nickname,
      selfIntro: userProfile.self_intro ?? "",
      systemPromptExtra: userProfile.system_prompt_extra ?? "",
      selectedFacts: selected,
      intimacy: relationship.intimacy,
      moodBaseline: currentMood(relationship),
      minutesSinceLastInteraction: Math.floor(msSinceInteraction / 60000),
      additionalContext,
      time: `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`,
      weekday: `周${weekdays[now.getDay()]}`,
      historySummaries: conversation.getSummaries().map((s) => s.text).join("\n"),
      recentHistory: [...conversation.getRecent()].map(t => ({ role: t.role as "user" | "assistant", content: t.content })),
      driftCorrection,
      budget: allocateBudget(8192),
    };

    const { system, messages } = assemblePrompt(input);

    try {
      const raw = await invoke<string>("llm_chat", { system, messages });
      const reply = parseEmotionReply(raw);

      // 漂移检测
      if (detectDrift(reply.text, activePersona.style_blacklist)) {
        console.warn("[drift] 检测到性格漂移，下轮将注入修正");
        turnsSinceReminder = 8; // 提前触发 reminder
      }

      // 情绪表演
      const params = resolveEmotionParams(reply.emotion, reply.intensity, emotionParamOverrides);
      paramAnimator.setTarget(params);
      void renderer?.playMotion(reply.action);
      renderer?.setExpression(reply.emotion === "happy" || reply.emotion === "excited" ? "happy" :
        reply.emotion === "sad" || reply.emotion === "worried" ? "sad" : "neutral");

      // TTS 语调偏移
      const voice = tts.getVoice();
      const shifted = emotionTtsShift(voice.pitch, voice.rate, reply.emotion, reply.intensity);
      const emotionVoice = { ...voice, pitch: shifted.pitch, rate: shifted.rate };
      tts.setVoice(emotionVoice);

      conversation.push({ role: "assistant", content: reply.text });
      showBubble(reply.text);
      tts.enqueue({ text: reply.text, urgency: "med" });

      // 恢复基准声线（情绪偏移是临时的）
      setTimeout(() => applyVoice(), 5000);

      // 关系更新
      relationship = adjustIntimacy(relationship, 1);
      if (reply.emotion === "happy" || reply.emotion === "excited") {
        relationship = setMoodBaseline(relationship, reply.emotion);
      }
      memoryStore.touchInteraction();

      // 异步压缩 + 记忆提取
      if (conversation.needsCompression()) void conversation.compress();
      void memoryExtractor.extract(conversation.getRecent());

      // 持久化
      void invoke("set_config", { patch: {
        relationship,
        user_memory: memoryStore.getState(),
        conversation: conversation.getState(),
      } });

    } catch (e) {
      console.warn("[llm]", e);
      showBubble("抱歉，我现在连不上大脑…右键打开设置配置一下 LLM？");
      renderer?.setExpression("sad");
      conversation.push({ role: "assistant", content: "(连接失败)" });
    }
  }

  // paramAnimator ticker 在 loadCharacter 后挂载（renderer 可用后）

  // ── 缩放 ─────────────────────────────────────────────────
  let currentScale = 1.0;
  function changeScale(delta: number) {
    currentScale = Math.min(2.0, Math.max(0.3, currentScale + delta));
    if (renderer) {
      renderer.setScale(currentScale);
    }
    void invoke("set_config", { patch: { character_scale: currentScale } });
  }

  // ── 角色 ────────────────────────────────────────────────
  const store = createCharacterStore(createWebCharacterFs(BUILTIN_CHARACTERS));

  store.onChanged((e) => {
    console.log("[character] →", e.id, "voice:", e.voice.voice);
    manifestVoice = e.voice;
    applyVoice();
    // 更新情绪系统的角色信息
    activePersona = e.manifest.persona ?? {};
    activeMotionKeys = Object.keys(e.manifest.motion_map ?? {});
    emotionParamOverrides = e.manifest.emotion_param_overrides;
    turnsSinceReminder = 0;
  });

  async function loadCharacter(id: string) {
    const active = await store.activate(id);
    renderer?.destroy();
    renderer = null;
    // 路径可能含空格（如 "March 7th.model3.json"），需要正确编码
    const modelUrl = `${active.baseUrl}/${active.manifest.model_entry}`
      .split("/")
      .map((seg) => encodeURIComponent(seg))
      .join("/");
    renderer = await createRenderer(canvas, {
      source: modelUrl,
      motionMap: active.manifest.motion_map,
      expressionMap: active.manifest.expression_map,
      scale: active.manifest.scale,
    });
    // 恢复缩放
    if (currentScale !== 1.0) renderer.setScale(currentScale);
    return active;
  }

  try {
    badge("loading character…");
    await store.refresh();
    for (const w of store.warnings) console.warn("[character]", w);

    config = await invoke<Record<string, unknown>>("get_config");
    approvalMode = (config.approval_mode as ApprovalMode) ?? "safe-list";
    tts.setMuted(Boolean(config.muted));

    const wanted = (config.active_character as string) ?? BUILTIN_CHARACTERS[0];
    const id = store.list().some((c) => c.id === wanted) ? wanted : BUILTIN_CHARACTERS[0];
    const active = await loadCharacter(id);
    badge("✓", "rgba(30,120,60,.6)");
    setTimeout(() => document.getElementById("dev-badge")?.remove(), 3000);
    console.log("[live2d] ready:", active.displayName);

    // 首次启动引导
    if (!config.onboarded) {
      await showOnboarding({
        setConfig: (patch) => invoke("set_config", { patch }),
        setSecret: (name, value) => invoke("set_secret", { name, value }),
        onDone: (patch) => {
          config = { ...config, ...patch, onboarded: true };
          if ((patch.llm as Record<string, string>)?.provider) {
            approvalMode = (config.approval_mode as ApprovalMode) ?? "safe-list";
          }
        },
      });
    }
  } catch (e) {
    badge("load failed ✗ " + String(e), "rgba(180,30,30,.9)");
    console.error("[live2d] load failed:", e);
  }

  // 恢复上次保存的缩放
  if (typeof config.character_scale === "number" && renderer !== null) {
    currentScale = config.character_scale as number;
    (renderer as RendererHandle).setScale(currentScale);
  }

  // ── 鼠标：穿透 + 拖拽/点击 + 右键菜单 ────────────────────
  const hit = (x: number, y: number) => (renderer ? renderer.hitTest(x, y) : false);

  const clickThrough = createClickThroughController(
    (x, y) => hit(x, y) || document.getElementById("settings") !== null || document.getElementById("ctx-menu") !== null,
    setClickThrough,
  );

  const dragTap = createDragTapController({
    hitTest: hit,
    onDragStart: () => void getCurrentWindow().startDragging(),
    onTap: (x, y) => {
      if (!renderer) return;
      const area = renderer.hitArea(x, y) ?? "body";
      const activeChar = store.getActive();
      const phrase = getTapPhrase(area, activeChar?.manifest);
      void renderer.playMotion(area === "head" ? "greet" : "cheer");
      renderer.setExpression("happy");
      showBubble(phrase);
      // 优先用预缓存音频（正确声线 + 口型同步）
      const cached = phraseCache.get(phrase);
      if (cached) {
        void renderer.speak(cached);
      } else {
        // 缓存未命中——用系统 TTS 兜底（立即发声），同时触发后台缓存
        const u = new SpeechSynthesisUtterance(phrase);
        u.lang = "zh-CN";
        speechSynthesis.speak(u);
        phraseCache.preload(phrase);
      }
    },
  });

  window.addEventListener("pointermove", (e) => {
    clickThrough.onPointerMove(e.clientX, e.clientY);
    dragTap.onPointerMove(e.clientX, e.clientY);
  });
  window.addEventListener("pointerdown", (e) => dragTap.onPointerDown(e.clientX, e.clientY, e.button));
  window.addEventListener("pointerup", (e) => dragTap.onPointerUp(e.clientX, e.clientY));

  function openSettings() {
    showSettings({
      getConfig: () => invoke("get_config"),
      setConfig: (patch) => invoke("set_config", { patch }),
      setSecret: (name, value) => invoke("set_secret", { name, value }),
      hasSecret: (name) => invoke("has_secret", { name }),
      getPttShortcut: () => invoke("get_ptt_shortcut"),
      setPttShortcut: (s) => invoke("set_ptt_shortcut", { shortcutStr: s }),
      getHookEndpoint: () => invoke("hook_endpoint"),
      installClaudeHook: (dir) => invoke("install_claude_hook", { projectDir: dir }),
      setAlwaysVisible: (enabled) => invoke("set_always_visible", { enabled }),
      characters: store.list().map((c) => ({ id: c.id, displayName: c.displayName })),
      onApplied: (merged) => {
        const prevChar = config.active_character;
        config = merged;
        approvalMode = (merged.approval_mode as ApprovalMode) ?? "safe-list";
        tts.setMuted(Boolean(merged.muted));
        applyVoice();
        const nextChar = merged.active_character as string;
        if (nextChar && nextChar !== prevChar) void loadCharacter(nextChar);
        showBubble("✅ 设置已保存");
      },
    }).catch((e) => {
      console.error("[settings]", e);
      showBubble("⚠️ 设置打开失败: " + String(e));
    });
  }

  // 右键菜单：先临时关闭点穿（否则透明区域事件到不了 WebView），菜单关闭后恢复
  window.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    void setClickThrough(false); // 确保菜单可交互
    showContextMenu(e.clientX, e.clientY, [
      { label: "设置…", onClick: openSettings },
      { label: "放大", onClick: () => changeScale(0.05) },
      { label: "缩小", onClick: () => changeScale(-0.05) },
      {
        label: "静音播报",
        checked: Boolean(config.muted),
        onClick: () => {
          const m = !config.muted;
          config = { ...config, muted: m };
          tts.setMuted(m);
          void invoke("set_config", { patch: { muted: m } });
          showBubble(m ? "🔇 已静音" : "🔊 已恢复");
        },
      },
      { label: "隐藏（托盘可恢复）", onClick: () => void getCurrentWindow().hide() },
      { label: "退出", onClick: () => void invoke("quit_app") },
    ]);
  });

  // 缩放：仅 pinch-to-zoom（触摸板捏合，ctrlKey=true）或 Cmd+滚轮触发
  // 普通双指滑动不触发，避免 Mac 触摸板误触
  window.addEventListener("wheel", (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    if (!hit(e.clientX, e.clientY)) return;
    e.preventDefault();
    changeScale(e.deltaY < 0 ? 0.03 : -0.03);
  }, { passive: false });

  // ── 语音审批路由 ────────────────────────────────────────
  const router = createApprovalRouter({
    inject: (sessionId, keys) => invoke("pty_inject", { sessionId, keys }),
    onChat: (text) => void chat(text),
    onFeedback: (speech, mood) => {
      showBubble(speech);
      renderer?.setExpression(
        mood === "happy" ? "happy" : mood === "worried" ? "worried" : "neutral",
      );
      tts.enqueue({ text: speech, urgency: "high" });
    },
    mode: () => approvalMode,
  });

  // ── Agent 事件 → 行为引擎 ───────────────────────────────
  subscribeAgentEvents((e) => {
    console.log("[agent]", e);
    router.onAgentEvent(e);
    const action = mapEvent(e);
    showBubble(action.bubble);
    void renderer?.playMotion(action.motion);
    if (action.expression) renderer?.setExpression(action.expression);
    if (action.ttsText) tts.enqueue({ text: action.ttsText, urgency: action.urgency });
  });

  // ── 语音管线状态 ────────────────────────────────────────
  void listen("voice://state", (e) => {
    const s = (e.payload as { state: string }).state;
    setMicState(s);
    if (s === "recording") void renderer?.playMotion("listen");
  });
  void listen("voice://transcript", (e) => {
    const text = (e.payload as { text: string }).text;
    console.log("[voice] transcript:", text);
    showBubble(`🎤 ${text}`);
    void router.onTranscript(text);
  });
  void listen("tray://muted", (e) => {
    const m = (e.payload as { muted: boolean }).muted;
    config = { ...config, muted: m };
    tts.setMuted(m);
    void invoke("set_config", { patch: { muted: m } });
    showBubble(m ? "🔇 已静音播报" : "🔊 已恢复播报");
  });
  void listen("voice://error", (e) => {
    const msg = (e.payload as { message: string }).message;
    console.warn("[voice] error:", msg);
    setMicState("idle");
    showBubble(`🎤 ${msg.includes("太短") ? "我没听清，再说一次？" : msg}`);
  });

  // 开发调试：HTTP 驱动 UI（仅 dev 构建，release 端点不存在）
  if (import.meta.env.DEV) {
    void listen("dev://ui", (e) => {
      const action = (e.payload as { action: string }).action;
      if (action === "open-settings") openSettings();
      else if (action.startsWith("switch:")) {
        const charId = action.slice("switch:".length);
        loadCharacter(charId).then((a) => showBubble("✅ 切换到 " + a.displayName)).catch((e) => showBubble("❌ " + String(e)));
      } else if (action === "open-menu") {
        const evt = new MouseEvent("contextmenu", {
          clientX: 200,
          clientY: 300,
          bubbles: true,
        });
        window.dispatchEvent(evt);
      } else if (action === "tap") {
        dragTap.onPointerDown(200, 300, 0);
        dragTap.onPointerUp(200, 300);
      }
    });
  }

  ping()
    .then((r) => console.log("[ipc] ping →", r))
    .catch((e) => console.error("[ipc] ping failed:", e));
}

/** 麦克风状态指示：idle 隐藏 / recording 红点 / transcribing 黄点 */
function setMicState(state: string) {
  let el = document.getElementById("mic");
  if (!el) {
    el = document.createElement("div");
    el.id = "mic";
    el.style.cssText =
      "position:fixed;bottom:14px;left:50%;transform:translateX(-50%);padding:5px 12px;" +
      "border-radius:12px;color:#fff;font:12px -apple-system,sans-serif;z-index:998;display:none;";
    document.body.appendChild(el);
  }
  if (state === "recording") {
    el.style.display = "block";
    el.style.background = "rgba(200,40,40,.9)";
    el.textContent = "● 正在听…（松开 Alt+Space 结束）";
  } else if (state === "transcribing") {
    el.style.display = "block";
    el.style.background = "rgba(190,140,20,.9)";
    el.textContent = "◌ 识别中…";
  } else {
    el.style.display = "none";
  }
}

let bubbleTimer: ReturnType<typeof setTimeout> | null = null;
function showBubble(text: string) {
  let el = document.getElementById("bubble");
  if (!el) {
    el = document.createElement("div");
    el.id = "bubble";
    el.style.cssText =
      "position:fixed;top:24px;left:50%;transform:translateX(-50%);max-width:85%;" +
      "background:rgba(255,255,255,.95);color:#333;border-radius:14px;padding:10px 14px;" +
      "font:13px -apple-system,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.18);z-index:999;";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.display = "block";
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => (el!.style.display = "none"), 6000);
}

window.addEventListener("DOMContentLoaded", () => void setup());
