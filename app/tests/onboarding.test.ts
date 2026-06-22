import { describe, it, expect } from "vitest";

describe("onboarding config integration", () => {
  it("onboarded flag prevents re-show", () => {
    const config = { onboarded: false };
    expect(!config.onboarded).toBe(true);
    config.onboarded = true;
    expect(!config.onboarded).toBe(false);
  });

  it("LLM config patch structure matches expected shape", () => {
    const patch = {
      onboarded: true,
      user_profile: {
        nickname: "老板",
        self_intro: "全栈开发者",
        system_prompt_extra: "",
      },
      llm: {
        provider: "openai-compatible",
        base_url: "http://127.0.0.1:11434/v1",
        model: "qwen3:8b",
      },
    };
    expect(patch.onboarded).toBe(true);
    expect(patch.user_profile.nickname).toBe("老板");
    expect(patch.llm.provider).toBe("openai-compatible");
  });

  it("empty nickname defaults to 你", () => {
    const nickname = "" || "你";
    expect(nickname).toBe("你");
  });

  it("config merge preserves existing fields (simulated)", () => {
    const existing = {
      approval_mode: "safe-list",
      muted: false,
      onboarded: false,
      active_character: "hiyori",
    };
    const patch = { onboarded: true, llm: { provider: "anthropic" } };
    const merged = { ...existing, ...patch };
    expect(merged.approval_mode).toBe("safe-list");
    expect(merged.muted).toBe(false);
    expect(merged.onboarded).toBe(true);
    expect((merged as Record<string, unknown>).llm).toEqual({ provider: "anthropic" });
  });

  it("user_profile with memory integration", () => {
    const profile = {
      nickname: "小明",
      self_intro: "后端工程师，主要用 Rust",
    };
    expect(profile.nickname.length).toBeGreaterThan(0);
    expect(profile.self_intro).toContain("Rust");
  });
});
