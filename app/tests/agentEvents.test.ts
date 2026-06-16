import { describe, it, expect, vi, beforeEach } from "vitest";

const listenMock = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({ listen: (...a: unknown[]) => listenMock(...a) }));

import {
  subscribeAgentEvents,
  createEventLog,
  isAgentEvent,
  type AgentEvent,
} from "../src/agent/events";

function approval(i: number): AgentEvent {
  return {
    kind: "approval_needed",
    agent: "claude-code",
    session_id: "s1",
    cwd: "/tmp",
    tool: "Bash",
    prompt_text: `p${i}`,
    ts: i,
  };
}

beforeEach(() => listenMock.mockReset());

describe("agent events", () => {
  it("E-01 typed subscription delivers discriminated event", async () => {
    let handler: ((e: { payload: unknown }) => void) | null = null;
    listenMock.mockImplementation((_n: string, h: (e: { payload: unknown }) => void) => {
      handler = h;
      return Promise.resolve(() => {});
    });
    const got: AgentEvent[] = [];
    subscribeAgentEvents((e) => got.push(e));
    await Promise.resolve();
    handler!({ payload: approval(1) });
    expect(got).toHaveLength(1);
    if (got[0].kind === "approval_needed") {
      expect(got[0].tool).toBe("Bash");
    } else {
      expect.fail("wrong kind");
    }
  });

  it("E-02 ring buffer drops oldest beyond capacity", () => {
    const log = createEventLog(50);
    for (let i = 0; i < 55; i++) log.push(approval(i));
    expect(log.list()).toHaveLength(50);
    expect(log.list()[0].ts).toBe(5);
  });

  it("E-03 malformed payload ignored", async () => {
    let handler: ((e: { payload: unknown }) => void) | null = null;
    listenMock.mockImplementation((_n: string, h: (e: { payload: unknown }) => void) => {
      handler = h;
      return Promise.resolve(() => {});
    });
    const cb = vi.fn();
    subscribeAgentEvents(cb);
    await Promise.resolve();
    handler!({ payload: { no_kind: true } });
    handler!({ payload: null });
    handler!({ payload: { kind: "approval_needed" } }); // 缺 session_id
    expect(cb).not.toHaveBeenCalled();
  });

  it("isAgentEvent guards kinds", () => {
    expect(isAgentEvent(approval(1))).toBe(true);
    expect(isAgentEvent({ kind: "unknown", session_id: "x" })).toBe(false);
  });
});
