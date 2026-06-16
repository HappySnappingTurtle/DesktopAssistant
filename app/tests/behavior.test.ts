import { describe, it, expect } from "vitest";
import { mapEvent, summarize } from "../src/behavior/engine";
import type { AgentEvent } from "../src/agent/events";

const approval: AgentEvent = {
  kind: "approval_needed",
  agent: "claude-code",
  session_id: "s1",
  cwd: "/p",
  tool: "Bash",
  prompt_text: "Claude needs your permission to use Bash",
  ts: 1,
};

describe("mapEvent", () => {
  it("BE-01 approval → alert/worried/high with agent+tool in tts", () => {
    const a = mapEvent(approval);
    expect(a.motion).toBe("alert");
    expect(a.expression).toBe("worried");
    expect(a.urgency).toBe("high");
    expect(a.ttsText).toContain("Claude");
    expect(a.ttsText).toContain("Bash");
    expect(a.bubble).toContain("Bash");
  });

  it("BE-02 task_completed → cheer/happy/low", () => {
    const a = mapEvent({
      kind: "task_completed",
      agent: "codex",
      session_id: "s",
      cwd: "",
      summary: "done",
      ts: 1,
    });
    expect(a.motion).toBe("cheer");
    expect(a.urgency).toBe("low");
    expect(a.ttsText).toBe("任务完成啦");
  });

  it("BE-03 error message truncated to 60 chars", () => {
    const long = "е".repeat(100);
    const a = mapEvent({
      kind: "agent_error",
      agent: "aider",
      session_id: "s",
      message: long,
      ts: 1,
    });
    expect(a.motion).toBe("error");
    expect([...a.bubble.replace("❌ ", "")].length).toBeLessThanOrEqual(61); // 60 + 省略号
  });

  it("BE-04 empty idle prompt → default bubble, no tts", () => {
    const a = mapEvent({
      kind: "idle_prompt",
      agent: "claude-code",
      session_id: "s",
      cwd: "",
      prompt_text: "",
      ts: 1,
    });
    expect(a.bubble).toContain("等你输入");
    expect(a.ttsText).toBeUndefined();
  });

  it("BE-05 user override merges", () => {
    const a = mapEvent(approval, { approval_needed: { ...mapEvent(approval), motion: "cheer", expression: "happy", urgency: "high", bubbleTemplate: "x", ttsTemplate: undefined } as never });
    expect(a.motion).toBe("cheer");
  });

  it("BE-06 summarize respects utf-8 boundaries", () => {
    const s = "你".repeat(70);
    const out = summarize(s);
    expect([...out].length).toBe(61);
    expect(out.endsWith("…")).toBe(true);
    expect(summarize("short")).toBe("short");
  });
});
