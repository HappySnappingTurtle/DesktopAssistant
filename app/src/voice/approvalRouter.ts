import type { AgentEvent } from "../agent/events";
import { parseIntent } from "./intent";
import { gate, type ApprovalMode, type GateResult } from "./securityGate";

const SLOT_TTL_MS = 10 * 60 * 1000;

export interface PendingApproval {
  sessionId: string;
  promptText: string;
  at: number;
}

export interface RouterDeps {
  inject: (sessionId: string, keys: string) => Promise<void>;
  /** 无待审批时的指令 → 对话通道（T11） */
  onChat: (text: string) => void;
  /** 播报/气泡反馈 */
  onFeedback: (speech: string, mood: "happy" | "worried" | "neutral") => void;
  mode: () => ApprovalMode;
  now?: () => number;
}

export function createApprovalRouter(deps: RouterDeps) {
  const now = deps.now ?? (() => Date.now());
  let pending: PendingApproval | null = null;

  return {
    onAgentEvent(e: AgentEvent) {
      if (e.kind === "approval_needed") {
        pending = { sessionId: e.session_id, promptText: e.prompt_text, at: now() };
      }
    },

    pendingApproval(): PendingApproval | null {
      if (pending && now() - pending.at > SLOT_TTL_MS) pending = null;
      return pending;
    },

    async onTranscript(text: string): Promise<GateResult | null> {
      const intent = parseIntent(text);
      const slot = this.pendingApproval();

      if (!slot) {
        if (intent.type === "instruction") deps.onChat(intent.text);
        else if (intent.type !== "noop")
          deps.onFeedback("现在没有等待审批的操作哦", "neutral");
        return null;
      }

      const result = gate({ intent, promptText: slot.promptText, mode: deps.mode() });
      if (result.allow) {
        try {
          await deps.inject(slot.sessionId, result.keys);
          pending = null;
          deps.onFeedback(
            intent.type === "deny" ? "已帮你拒绝" : "已帮你确认",
            "happy",
          );
        } catch (e) {
          deps.onFeedback("注入失败了，会话可能已结束", "worried");
          console.warn("[approval] inject failed:", e);
        }
      } else if (result.reason === "blacklisted") {
        deps.onFeedback(result.speech ?? "请亲自确认", "worried");
      } else if (result.reason === "mode") {
        deps.onFeedback("当前模式不允许语音审批", "neutral");
      }
      return result;
    },
  };
}

export type ApprovalRouter = ReturnType<typeof createApprovalRouter>;
