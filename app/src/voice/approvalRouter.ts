import type { AgentEvent } from "../agent/events";
import { parseIntent } from "./intent";
import { gate, resolveLevel, type ApprovalMode, type ApprovalRules, type GateResult, DEFAULT_RULES } from "./securityGate";
import { createApprovalQueue, type ApprovalLevel } from "./approvalQueue";

export interface RouterDeps {
  inject: (sessionId: string, keys: string) => Promise<void>;
  onChat: (text: string) => void;
  onForwardToAgent: (sessionId: string, text: string) => Promise<void>;
  onFeedback: (speech: string, mood: "happy" | "worried" | "neutral") => void;
  mode: () => ApprovalMode;
  rules: () => ApprovalRules;
  now?: () => number;
}

export type RouteMode = "chat" | "agent";

export function createApprovalRouter(deps: RouterDeps) {
  const now = deps.now ?? (() => Date.now());
  const queue = createApprovalQueue(deps.now);
  let routeMode: RouteMode = "chat";
  let selectedSessionId: string | null = null;

  return {
    get routeMode() { return routeMode; },
    get selectedSessionId() { return selectedSessionId; },

    setMode(mode: RouteMode, sessionId: string | null) {
      routeMode = mode;
      selectedSessionId = sessionId;
    },

    onAgentEvent(e: AgentEvent) {
      if (e.kind !== "approval_needed") return;

      const rules = deps.rules();
      const level = resolveLevel(e.tool, e.prompt_text, rules);

      if (level === "auto") {
        void deps.inject(e.session_id, "y\r").catch(() => {});
        return;
      }

      if (level === "notify") {
        void deps.inject(e.session_id, "y\r")
          .then(() => deps.onFeedback(`已批准 ${e.tool}`, "neutral"))
          .catch(() => deps.onFeedback("自动批准失败", "worried"));
        return;
      }

      queue.push({
        sessionId: e.session_id,
        agent: e.agent,
        tool: e.tool,
        promptText: e.prompt_text,
        at: now(),
        level,
      });
    },

    pendingConfirm() {
      return queue.peekConfirm();
    },

    queueSize() {
      return queue.size();
    },

    async onTranscript(text: string): Promise<GateResult | null> {
      const intent = parseIntent(text);
      const slot = queue.peekConfirm() ?? queue.pending().find((i) => i.level === "block") ?? null;

      if (slot) {
        if (slot.level === "block") {
          deps.onFeedback("这个操作必须在终端键盘确认", "worried");
          return { allow: false, reason: "blacklisted", level: "block" };
        }

        const result = gate({
          intent,
          tool: slot.tool,
          promptText: slot.promptText,
          mode: deps.mode(),
          rules: deps.rules(),
        });

        if (result.allow) {
          try {
            await deps.inject(slot.sessionId, result.keys);
            queue.shiftConfirm();
            deps.onFeedback(
              intent.type === "deny" ? "已帮你拒绝" : "已帮你确认",
              "happy",
            );
          } catch {
            deps.onFeedback("注入失败了，会话可能已结束", "worried");
          }
        } else if (result.reason === "blacklisted") {
          deps.onFeedback(result.speech ?? "请亲自确认", "worried");
        } else if (result.reason === "mode") {
          deps.onFeedback("当前模式不允许语音审批", "neutral");
        }
        return result;
      }

      // No pending confirm — route by mode
      if (intent.type === "noop") return null;

      if (routeMode === "agent" && selectedSessionId) {
        const fullText = intent.type === "instruction" ? intent.text : text;
        try {
          await deps.onForwardToAgent(selectedSessionId, fullText);
        } catch {
          deps.onFeedback("转发失败，Agent 会话可能已断开", "worried");
        }
      } else {
        if (intent.type === "instruction") deps.onChat(intent.text);
        else deps.onChat(text);
      }
      return null;
    },
  };
}

export type ApprovalRouter = ReturnType<typeof createApprovalRouter>;
