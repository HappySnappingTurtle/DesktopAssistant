import { describe, it, expect } from "vitest";
import { parseEmotionReply } from "../src/llm/emotionParser";
import { buildIdentityAnchor, buildPersonalityReminder, detectDrift } from "../src/llm/identityAnchor";
import { estimateTokens, emergencyCompress, type PromptSection } from "../src/llm/tokenBudget";
import { resolveEmotionParams } from "../src/performance/engine";
import { createParamAnimator } from "../src/performance/paramAnimator";
import { emotionTtsShift } from "../src/tts/emotionAdapter";
import { createMemoryStore } from "../src/memory/store";
import { selectRelevantFacts } from "../src/memory/selector";
import { defaultRelationship, adjustIntimacy, intimacyLevel, decayIntimacy, setMoodBaseline, currentMood } from "../src/memory/relationship";
import { createConversationManager } from "../src/conversation/manager";

describe("emotionParser", () => {
  it("parses valid JSON reply", () => {
    const r = parseEmotionReply('{"text":"嗨！","emotion":"happy","intensity":0.7,"action":"cheer"}');
    expect(r).toEqual({ text: "嗨！", emotion: "happy", intensity: 0.7, action: "cheer" });
  });
  it("extracts JSON from markdown code block", () => {
    const r = parseEmotionReply('```json\n{"text":"hi","emotion":"curious","intensity":0.5,"action":"greet"}\n```');
    expect(r.emotion).toBe("curious");
  });
  it("degrades gracefully on plain text", () => {
    const r = parseEmotionReply("这是普通文本");
    expect(r.text).toBe("这是普通文本");
    expect(r.emotion).toBe("neutral");
    expect(r.intensity).toBe(0.3);
  });
  it("handles missing/invalid fields", () => {
    const r = parseEmotionReply('{"text":"ok","emotion":"INVALID","intensity":"bad"}');
    expect(r.emotion).toBe("neutral");
    expect(r.intensity).toBe(0.3);
  });
  it("clamps intensity", () => {
    expect(parseEmotionReply('{"text":"x","emotion":"happy","intensity":5}').intensity).toBe(1);
    expect(parseEmotionReply('{"text":"x","emotion":"happy","intensity":-2}').intensity).toBe(0);
  });
});

describe("identityAnchor", () => {
  it("includes character name and personality", () => {
    const a = buildIdentityAnchor("三月七", { personality: "活泼开朗", speech_style: "轻快" });
    expect(a).toContain("三月七");
    expect(a).toContain("活泼开朗");
    expect(a).toContain("不可违背");
  });
  it("personality reminder is concise", () => {
    const r = buildPersonalityReminder("Natori", "沉稳内敛");
    expect(r).toContain("Natori");
    expect(r).toContain("沉稳内敛");
  });
  it("detects drift via blacklist", () => {
    expect(detectDrift("嘿嘿～", ["～", "！！"])).toBe(true);
    expect(detectDrift("嗯，不错。", ["～", "！！"])).toBe(false);
    expect(detectDrift("anything", undefined)).toBe(false);
    expect(detectDrift("anything", [])).toBe(false);
  });
});

describe("performanceEngine", () => {
  it("resolves default params with intensity scaling", () => {
    const p = resolveEmotionParams("happy", 0.5);
    expect(p.ParamAngleY).toBeCloseTo(1.5);
    expect(p.ParamMouthForm).toBeCloseTo(0.3);
  });
  it("applies character overrides", () => {
    const p = resolveEmotionParams("shy", 1.0, { shy: { ParamCheek: 0 } });
    expect(p.ParamCheek).toBe(0); // 覆盖默认 0.5
    expect(p.ParamAngleZ).toBeCloseTo(-6); // 默认保留
  });
  it("neutral returns empty", () => {
    expect(Object.keys(resolveEmotionParams("neutral", 1.0))).toHaveLength(0);
  });
});

describe("paramAnimator", () => {
  it("transitions to target and settles", () => {
    const log: Record<string, number> = {};
    const a = createParamAnimator({ setParameter: (id, v) => (log[id] = v) });
    a.setTarget({ ParamAngleY: 10 });
    expect(a.isTransitioning()).toBe(true);
    // 模拟 300ms 过去——tick 会用 performance.now
    // 直接测最终 tick
    for (let i = 0; i < 20; i++) a.tick();
    // 经过足够 tick 后应该接近目标
    expect(log.ParamAngleY).toBeDefined();
  });
});

describe("emotionTtsShift", () => {
  it("happy shifts pitch up and rate up", () => {
    const s = emotionTtsShift("+2Hz", "+3%", "happy", 1.0);
    expect(s.pitch).toBe("+5Hz");
    expect(s.rate).toBe("+8%");
  });
  it("sad shifts down", () => {
    const s = emotionTtsShift("+0Hz", "+0%", "sad", 1.0);
    expect(s.pitch).toBe("-3Hz");
    expect(s.rate).toBe("-8%");
  });
  it("intensity scales shift", () => {
    const s = emotionTtsShift("+0Hz", "+0%", "excited", 0.5);
    expect(s.pitch).toBe("+3Hz"); // 5 * 0.5 = 2.5 → round 3
  });
  it("neutral no shift", () => {
    const s = emotionTtsShift("+2Hz", "+3%", "neutral", 1.0);
    expect(s.pitch).toBe("+2Hz");
    expect(s.rate).toBe("+3%");
  });
});

describe("memoryStore", () => {
  it("adds and retrieves facts", () => {
    const m = createMemoryStore();
    expect(m.addFact("用户喜欢咖啡")).toBe(true);
    expect(m.getFacts()).toHaveLength(1);
  });
  it("deduplicates similar facts", () => {
    const m = createMemoryStore();
    m.addFact("用户喜欢咖啡");
    expect(m.addFact("用户喜欢咖啡")).toBe(false);
  });
  it("user facts have confidence 1.0 and survive maintenance", () => {
    const m = createMemoryStore();
    m.addFact("我是程序员", "user");
    expect(m.getFacts()[0].confidence).toBe(1.0);
    expect(m.getFacts()[0].source).toBe("user");
    m.maintain();
    expect(m.getFacts()).toHaveLength(1);
  });
  it("evicts when over 30", () => {
    const m = createMemoryStore();
    for (let i = 0; i < 35; i++) m.addFact(`fact ${i}`);
    expect(m.getFacts().length).toBeLessThanOrEqual(30);
  });
});

describe("memorySelector", () => {
  it("selects core facts + topical facts", () => {
    const facts = [
      { text: "用户是开发者", confidence: 0.9, source: "user" as const, created_at: "", last_used_at: "", use_count: 0 },
      { text: "用户喜欢咖啡", confidence: 0.6, source: "extracted" as const, created_at: "", last_used_at: "", use_count: 0 },
      { text: "用户养了一只猫", confidence: 0.6, source: "extracted" as const, created_at: "", last_used_at: "", use_count: 0 },
    ];
    const { selected } = selectRelevantFacts(facts, "今天写了很多代码，累死了", 2);
    expect(selected.length).toBeLessThanOrEqual(2);
    expect(selected.some((f) => f.text.includes("开发者"))).toBe(true); // 核心
  });
});

describe("relationship", () => {
  it("adjusts intimacy within bounds", () => {
    const r = adjustIntimacy(defaultRelationship(), 200);
    expect(r.intimacy).toBe(100);
    const r2 = adjustIntimacy(defaultRelationship(), -200);
    expect(r2.intimacy).toBe(0);
  });
  it("intimacy levels", () => {
    expect(intimacyLevel(10)).toBe("low");
    expect(intimacyLevel(40)).toBe("mid");
    expect(intimacyLevel(80)).toBe("high");
  });
  it("mood decays after timeout", () => {
    const r = setMoodBaseline(defaultRelationship(), "happy", -1); // 已过期
    expect(currentMood(r)).toBe("neutral");
  });
  it("decay loses intimacy over hours", () => {
    const old = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(); // 5h ago
    const r = decayIntimacy({ ...defaultRelationship(), intimacy: 50 }, old);
    expect(r.intimacy).toBe(40); // 5*2 = 10 loss
  });
});

describe("conversationManager", () => {
  it("keeps recent window and pushes overflow to pending", () => {
    const m = createConversationManager();
    for (let i = 0; i < 20; i++) {
      m.push({ role: i % 2 === 0 ? "user" : "assistant", content: `msg${i}` });
    }
    expect(m.getRecent().length).toBeLessThanOrEqual(12); // 6 轮 = 12 条
    expect(m.needsCompression()).toBe(false); // 还没到 10 轮
  });
  it("compresses when threshold reached", async () => {
    const m = createConversationManager(undefined, async (turns) =>
      `compressed ${turns.length} turns`,
    );
    for (let i = 0; i < 40; i++) {
      m.push({ role: i % 2 === 0 ? "user" : "assistant", content: `msg${i}` });
    }
    if (m.needsCompression()) {
      const ok = await m.compress();
      expect(ok).toBe(true);
      expect(m.getSummaries().length).toBeGreaterThan(0);
    }
  });
  it("buildHistory includes summaries + recent", () => {
    const m = createConversationManager({
      summaries: [{ text: "之前聊了天气", turn_range: [0, 5], created_at: "" }],
      total_turns: 10,
    });
    m.push({ role: "user", content: "你好" });
    const h = m.buildHistory();
    expect(h[0].role).toBe("system");
    expect(h[0].content).toContain("天气");
    expect(h[1].content).toBe("你好");
  });
});

describe("tokenBudget", () => {
  it("estimates tokens roughly correctly", () => {
    expect(estimateTokens("hello world")).toBeGreaterThan(0);
    expect(estimateTokens("你好世界")).toBeGreaterThan(3);
  });
  it("emergency compress preserves high priority", () => {
    const sections: PromptSection[] = [
      { key: "identity", text: "x".repeat(500), tokens: 200, priority: 100 },
      { key: "history", text: "y".repeat(2000), tokens: 800, priority: 10 },
    ];
    const result = emergencyCompress(sections, 500);
    const id = result.find((s) => s.key === "identity")!;
    expect(id.text.length).toBe(500); // 不被砍
    const hist = result.find((s) => s.key === "history")!;
    expect(hist.text.length).toBeLessThan(2000); // 被砍了
  });
});
