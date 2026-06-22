import { describe, it, expect } from "vitest";
import { createMemoryStore, type MemoryFact } from "../src/memory/store";
import { selectRelevantFacts } from "../src/memory/selector";
import {
  defaultRelationship,
  adjustIntimacy,
  setMoodBaseline,
  currentMood,
  decayIntimacy,
  intimacyLevel,
} from "../src/memory/relationship";
import { createMemoryExtractor } from "../src/memory/extractor";
import { createConversationManager } from "../src/conversation/manager";
import { createCompressor } from "../src/conversation/compressor";
import { assemblePrompt } from "../src/llm/promptAssembler";
import { allocateBudget } from "../src/llm/tokenBudget";

// ── MemoryStore ──────────────────────────────────────────

describe("memoryStore (extended)", () => {
  it("removeFact removes by exact text", () => {
    const m = createMemoryStore();
    m.addFact("用户喜欢猫");
    m.addFact("用户是程序员");
    expect(m.removeFact("用户喜欢猫")).toBe(true);
    expect(m.getFacts()).toHaveLength(1);
    expect(m.getFacts()[0].text).toBe("用户是程序员");
  });

  it("removeFact returns false for non-existent", () => {
    const m = createMemoryStore();
    expect(m.removeFact("不存在")).toBe(false);
  });

  it("markUsed increments use_count and updates last_used_at", () => {
    const m = createMemoryStore();
    m.addFact("fact1");
    m.addFact("fact2");
    m.markUsed([0, 1]);
    expect(m.getFacts()[0].use_count).toBe(1);
    expect(m.getFacts()[1].use_count).toBe(1);
    m.markUsed([0]);
    expect(m.getFacts()[0].use_count).toBe(2);
  });

  it("markUsed ignores out-of-bound indices", () => {
    const m = createMemoryStore();
    m.addFact("fact1");
    m.markUsed([99, -1]);
    expect(m.getFacts()[0].use_count).toBe(0);
  });

  it("maintain removes old low-confidence unused facts", () => {
    const m = createMemoryStore();
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    m.addFact("old low-conf fact");
    const facts = m.getFacts() as unknown as Array<Record<string, unknown>>;
    facts[0].created_at = old;
    facts[0].confidence = 0.3;
    facts[0].use_count = 1;
    const removed = m.maintain();
    expect(removed).toBe(1);
    expect(m.getFacts()).toHaveLength(0);
  });

  it("maintain keeps user-sourced facts regardless of age", () => {
    const m = createMemoryStore();
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    m.addFact("user fact", "user");
    const facts = m.getFacts() as unknown as Array<Record<string, unknown>>;
    facts[0].created_at = old;
    facts[0].use_count = 0;
    const removed = m.maintain();
    expect(removed).toBe(0);
    expect(m.getFacts()).toHaveLength(1);
  });

  it("getState returns a copy that doesn't mutate original", () => {
    const m = createMemoryStore();
    m.addFact("test");
    const state = m.getState();
    state.facts.push({
      text: "injected",
      source: "user",
      confidence: 1,
      created_at: "",
      last_used_at: "",
      use_count: 0,
    });
    expect(m.getFacts()).toHaveLength(1);
  });

  it("restores from persisted state", () => {
    const initial = {
      facts: [
        {
          text: "restored fact",
          source: "extracted" as const,
          confidence: 0.7,
          created_at: new Date().toISOString(),
          last_used_at: new Date().toISOString(),
          use_count: 3,
        },
      ],
      last_interaction: new Date().toISOString(),
    };
    const m = createMemoryStore(initial);
    expect(m.getFacts()).toHaveLength(1);
    expect(m.getFacts()[0].text).toBe("restored fact");
    expect(m.getFacts()[0].use_count).toBe(3);
  });

  it("touchInteraction updates last_interaction", () => {
    const m = createMemoryStore();
    const before = m.getState().last_interaction;
    m.touchInteraction();
    expect(m.getState().last_interaction).not.toBe("");
  });

  it("deduplication allows sufficiently different facts", () => {
    const m = createMemoryStore();
    m.addFact("用户喜欢喝咖啡");
    // Different enough content passes dedup
    expect(m.addFact("用户养了一只猫叫小白")).toBe(true);
    expect(m.getFacts()).toHaveLength(2);
  });
});

// ── MemorySelector ───────────────────────────────────────

describe("memorySelector (extended)", () => {
  const makeFact = (text: string, confidence = 0.6): MemoryFact => ({
    text,
    source: "extracted",
    confidence,
    created_at: "",
    last_used_at: "",
    use_count: 0,
  });

  it("returns empty when no facts", () => {
    const { selected } = selectRelevantFacts([], "hello");
    expect(selected).toHaveLength(0);
  });

  it("respects maxCount limit", () => {
    const facts = Array.from({ length: 20 }, (_, i) => makeFact(`fact ${i}`, 0.9));
    const { selected } = selectRelevantFacts(facts, "anything", 5);
    expect(selected.length).toBeLessThanOrEqual(5);
  });

  it("prioritizes core facts (high confidence)", () => {
    const facts = [
      makeFact("low relevance", 0.9),
      makeFact("topical match 代码", 0.4),
    ];
    const { selected } = selectRelevantFacts(facts, "今天写代码", 1);
    expect(selected[0].confidence).toBe(0.9);
  });

  it("filters out very low confidence facts", () => {
    const facts = [makeFact("too low", 0.1)];
    const { selected } = selectRelevantFacts(facts, "something");
    expect(selected).toHaveLength(0);
  });

  it("returns correct indices for markUsed", () => {
    const facts = [makeFact("a"), makeFact("b"), makeFact("c", 0.9)];
    const { indices } = selectRelevantFacts(facts, "anything");
    expect(indices.every((i) => i >= 0 && i < facts.length)).toBe(true);
  });
});

// ── MemoryExtractor ──────────────────────────────────────

describe("memoryExtractor", () => {
  it("extracts facts from LLM response", async () => {
    const added: string[] = [];
    const ext = createMemoryExtractor({
      llmExtract: async () => '[{"text":"用户喜欢跑步","confidence":0.7}]',
      existingFacts: () => [],
      addFact: (t) => added.push(t),
    });
    const count = await ext.extract([
      { role: "user", content: "我每天早上都去跑步" },
      { role: "assistant", content: "好习惯！" },
    ]);
    expect(count).toBe(1);
    expect(added).toContain("用户喜欢跑步");
  });

  it("caps at 3 facts per extraction", async () => {
    const added: string[] = [];
    const ext = createMemoryExtractor({
      llmExtract: async () =>
        JSON.stringify([
          { text: "用户喜欢跑步运动", confidence: 0.5 },
          { text: "用户是全栈工程师", confidence: 0.5 },
          { text: "用户养了一只猫", confidence: 0.5 },
          { text: "用户住在北京海淀", confidence: 0.5 },
        ]),
      existingFacts: () => [],
      addFact: (t) => added.push(t),
    });
    const count = await ext.extract([
      { role: "user", content: "test" },
      { role: "assistant", content: "test" },
    ]);
    expect(count).toBe(3);
    expect(added).toHaveLength(3);
  });

  it("handles malformed LLM output gracefully", async () => {
    const ext = createMemoryExtractor({
      llmExtract: async () => "这不是JSON",
      existingFacts: () => [],
      addFact: () => {},
    });
    const count = await ext.extract([
      { role: "user", content: "test" },
      { role: "assistant", content: "test" },
    ]);
    expect(count).toBe(0);
  });

  it("handles LLM error gracefully", async () => {
    const ext = createMemoryExtractor({
      llmExtract: async () => { throw new Error("API down"); },
      existingFacts: () => [],
      addFact: () => {},
    });
    const count = await ext.extract([
      { role: "user", content: "test" },
      { role: "assistant", content: "test" },
    ]);
    expect(count).toBe(0);
  });

  it("skips extraction when too few turns", async () => {
    const ext = createMemoryExtractor({
      llmExtract: async () => { throw new Error("should not be called"); },
      existingFacts: () => [],
      addFact: () => {},
    });
    const count = await ext.extract([{ role: "user", content: "hi" }]);
    expect(count).toBe(0);
  });

  it("prevents concurrent extraction", async () => {
    let callCount = 0;
    const ext = createMemoryExtractor({
      llmExtract: async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 50));
        return "[]";
      },
      existingFacts: () => [],
      addFact: () => {},
    });
    const turns = [
      { role: "user" as const, content: "a" },
      { role: "assistant" as const, content: "b" },
    ];
    const [r1, r2] = await Promise.all([ext.extract(turns), ext.extract(turns)]);
    expect(callCount).toBe(1);
    expect(r2).toBe(0);
  });

  it("filters out short text items", async () => {
    const added: string[] = [];
    const ext = createMemoryExtractor({
      llmExtract: async () => '[{"text":"ab","confidence":0.8},{"text":"valid long text","confidence":0.7}]',
      existingFacts: () => [],
      addFact: (t) => added.push(t),
    });
    await ext.extract([
      { role: "user", content: "test" },
      { role: "assistant", content: "test" },
    ]);
    expect(added).not.toContain("ab");
    expect(added).toContain("valid long text");
  });
});

// ── ConversationManager (extended) ───────────────────────

describe("conversationManager (extended)", () => {
  it("totalTurns counts non-system turns only", () => {
    const m = createConversationManager();
    m.push({ role: "system", content: "sys" });
    m.push({ role: "user", content: "hi" });
    m.push({ role: "assistant", content: "hello" });
    expect(m.totalTurns()).toBe(2);
  });

  it("persistBeforeClose creates final summary", async () => {
    const m = createConversationManager(undefined, async (turns) =>
      `final summary of ${turns.length} msgs`,
    );
    for (let i = 0; i < 8; i++) {
      m.push({ role: i % 2 === 0 ? "user" : "assistant", content: `msg${i}` });
    }
    const state = await m.persistBeforeClose();
    expect(state.summaries.length).toBeGreaterThan(0);
    expect(state.summaries.some((s) => s.text.includes("final summary"))).toBe(true);
  });

  it("persistBeforeClose with no compressFn preserves state", async () => {
    const m = createConversationManager();
    m.push({ role: "user", content: "hi" });
    const state = await m.persistBeforeClose();
    expect(state.summaries).toHaveLength(0);
  });

  it("summary stack merges when over limit", async () => {
    const m = createConversationManager(
      { summaries: [], total_turns: 0 },
      async () => "summary",
    );
    for (let i = 0; i < 200; i++) {
      m.push({ role: i % 2 === 0 ? "user" : "assistant", content: `msg${i}` });
    }
    while (m.needsCompression()) await m.compress();
    expect(m.getSummaries().length).toBeLessThanOrEqual(5);
  });

  it("getState returns independent copy", () => {
    const m = createConversationManager();
    m.push({ role: "user", content: "test" });
    const state = m.getState();
    state.total_turns = 999;
    expect(m.totalTurns()).toBe(1);
  });
});

// ── Compressor ───────────────────────────────────────────

describe("compressor", () => {
  it("calls llmSummarize and returns result", async () => {
    const compress = createCompressor({
      llmSummarize: async () => "摘要：聊了天气和旅行计划",
    });
    const result = await compress([
      { role: "user", content: "今天天气真不错，适合出门" },
      { role: "assistant", content: "是啊，这种天气最适合去公园散步了" },
      { role: "user", content: "下周末想去爬山" },
      { role: "assistant", content: "好主意！推荐去西山" },
    ]);
    expect(result).toBe("摘要：聊了天气和旅行计划");
  });

  it("falls back to truncation on LLM error", async () => {
    const compress = createCompressor({
      llmSummarize: async () => { throw new Error("API error"); },
    });
    const result = await compress([
      { role: "user", content: "a".repeat(300) },
      { role: "assistant", content: "response" },
    ]);
    expect(result.length).toBeLessThanOrEqual(210);
    expect(result.endsWith("…")).toBe(true);
  });

  it("returns formatted text for very short conversations without calling LLM", async () => {
    let called = false;
    const compress = createCompressor({
      llmSummarize: async () => { called = true; return "summary"; },
    });
    const result = await compress([
      { role: "user", content: "hi" },
    ]);
    expect(called).toBe(false);
    expect(result).toContain("hi");
  });

  it("filters system messages from compression input", async () => {
    let receivedPrompt = "";
    const compress = createCompressor({
      llmSummarize: async (prompt) => {
        receivedPrompt = prompt;
        return "summary";
      },
    });
    await compress([
      { role: "system", content: "secret system prompt" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ]);
    expect(receivedPrompt).not.toContain("secret system prompt");
    expect(receivedPrompt).toContain("hello");
  });
});

// ── Relationship (extended) ──────────────────────────────

describe("relationship (extended)", () => {
  it("setMoodBaseline with positive duration keeps mood active", () => {
    const r = setMoodBaseline(defaultRelationship(), "excited", 60000);
    expect(currentMood(r)).toBe("excited");
  });

  it("decayIntimacy does not decay within 1 hour", () => {
    const recent = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min ago
    const r = decayIntimacy({ ...defaultRelationship(), intimacy: 50 }, recent);
    expect(r.intimacy).toBe(50);
  });

  it("decayIntimacy clamps at 0", () => {
    const veryOld = new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString();
    const r = decayIntimacy({ ...defaultRelationship(), intimacy: 5 }, veryOld);
    expect(r.intimacy).toBe(0);
  });

  it("intimacyLevel boundary values", () => {
    expect(intimacyLevel(0)).toBe("low");
    expect(intimacyLevel(24)).toBe("low");
    expect(intimacyLevel(25)).toBe("mid");
    expect(intimacyLevel(59)).toBe("mid");
    expect(intimacyLevel(60)).toBe("high");
    expect(intimacyLevel(100)).toBe("high");
  });
});

// ── PromptAssembler ──────────────────────────────────────

describe("promptAssembler", () => {
  const baseInput = {
    displayName: "测试角色",
    persona: { personality: "活泼开朗" },
    motionKeys: ["idle", "greet", "cheer"],
    nickname: "老板",
    selfIntro: "全栈开发者",
    systemPromptExtra: "",
    selectedFacts: [],
    intimacy: 30,
    moodBaseline: "neutral",
    minutesSinceLastInteraction: 5,
    additionalContext: "",
    time: "14:30",
    weekday: "周三",
    historySummaries: "",
    recentHistory: [{ role: "user", content: "你好" }],
    driftCorrection: undefined,
    budget: allocateBudget(8192),
  };

  it("includes identity, format, user info in system prompt", () => {
    const { system } = assemblePrompt(baseInput);
    expect(system).toContain("测试角色");
    expect(system).toContain("老板");
    expect(system).toContain("全栈开发者");
    expect(system).toContain("idle/greet/cheer");
  });

  it("includes memory facts in system prompt", () => {
    const { system } = assemblePrompt({
      ...baseInput,
      selectedFacts: [
        { text: "用户喜欢猫", source: "extracted", confidence: 0.7, created_at: "", last_used_at: "", use_count: 0 },
      ],
    });
    expect(system).toContain("用户喜欢猫");
  });

  it("includes drift correction when provided", () => {
    const { system } = assemblePrompt({
      ...baseInput,
      driftCorrection: "注意保持活泼性格",
    });
    expect(system).toContain("注意保持活泼性格");
  });

  it("passes recent history as messages", () => {
    const { messages } = assemblePrompt(baseInput);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("你好");
  });

  it("includes time and weekday context", () => {
    const { system } = assemblePrompt(baseInput);
    expect(system).toContain("14:30");
    expect(system).toContain("周三");
  });
});
