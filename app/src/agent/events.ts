import { listen } from "@tauri-apps/api/event";

interface BaseEvent {
  agent: string;
  session_id: string;
  ts: number;
}
export type AgentEvent =
  | (BaseEvent & { kind: "approval_needed"; cwd: string; tool: string; prompt_text: string })
  | (BaseEvent & { kind: "idle_prompt"; cwd: string; prompt_text: string })
  | (BaseEvent & { kind: "task_completed"; cwd: string; summary: string })
  | (BaseEvent & { kind: "agent_error"; message: string });

const KINDS = new Set(["approval_needed", "idle_prompt", "task_completed", "agent_error"]);

export function isAgentEvent(p: unknown): p is AgentEvent {
  return (
    typeof p === "object" &&
    p !== null &&
    KINDS.has((p as { kind?: string }).kind ?? "") &&
    typeof (p as { session_id?: unknown }).session_id === "string"
  );
}

export const EVENT_LOG_CAPACITY = 50;

export function createEventLog(capacity = EVENT_LOG_CAPACITY) {
  const buf: AgentEvent[] = [];
  return {
    push(e: AgentEvent) {
      buf.push(e);
      if (buf.length > capacity) buf.shift();
    },
    list(): readonly AgentEvent[] {
      return buf;
    },
  };
}

export const eventLog = createEventLog();

/** 类型化订阅；畸形 payload 忽略并 warn。返回取消函数。 */
export function subscribeAgentEvents(cb: (e: AgentEvent) => void): () => void {
  let unlisten: (() => void) | null = null;
  let cancelled = false;
  listen("agent://event", (raw) => {
    if (!isAgentEvent(raw.payload)) {
      console.warn("[agent] malformed event ignored:", raw.payload);
      return;
    }
    eventLog.push(raw.payload);
    cb(raw.payload);
  }).then((fn) => {
    if (cancelled) fn();
    else unlisten = fn;
  });
  return () => {
    cancelled = true;
    unlisten?.();
  };
}
