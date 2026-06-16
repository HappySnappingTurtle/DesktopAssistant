import type { AgentEvent } from "../agent/events";

export type Urgency = "high" | "med" | "low";

export interface BehaviorAction {
  motion: string;
  expression?: string;
  bubble: string;
  ttsText?: string;
  urgency: Urgency;
}

export interface Rule {
  motion: string;
  expression?: string;
  urgency: Urgency;
  bubbleTemplate: string;
  ttsTemplate?: string;
}

export type RuleTable = Record<AgentEvent["kind"], Rule>;

export const DEFAULT_RULES: RuleTable = {
  approval_needed: {
    motion: "alert",
    expression: "worried",
    urgency: "high",
    bubbleTemplate: "⚠️ {agent} 在等你审批：{tool}",
    ttsTemplate: "主人，{agent}在等你审批{tool}操作",
  },
  idle_prompt: {
    motion: "greet",
    expression: "curious",
    urgency: "med",
    bubbleTemplate: "💬 {prompt}",
    ttsTemplate: "{prompt}",
  },
  task_completed: {
    motion: "cheer",
    expression: "happy",
    urgency: "low",
    bubbleTemplate: "✅ {summary}",
    ttsTemplate: "任务完成啦",
  },
  agent_error: {
    motion: "error",
    expression: "sad",
    urgency: "high",
    bubbleTemplate: "❌ {message}",
    ttsTemplate: "出错了：{message}",
  },
};

/** 按 UTF-8 字符截断到 max 字，超出加省略号 */
export function summarize(text: string, max = 60): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  return chars.slice(0, max).join("") + "…";
}

function vars(e: AgentEvent): Record<string, string> {
  const friendly: Record<string, string> = {
    "claude-code": "Claude",
    codex: "Codex",
    gemini: "Gemini",
    aider: "Aider",
  };
  const agent = friendly[e.agent] ?? e.agent;
  switch (e.kind) {
    case "approval_needed":
      return { agent, tool: e.tool, prompt: summarize(e.prompt_text) };
    case "idle_prompt":
      return { agent, prompt: summarize(e.prompt_text) };
    case "task_completed":
      return { agent, summary: summarize(e.summary) };
    case "agent_error":
      return { agent, message: summarize(e.message) };
  }
}

export function renderTemplate(tpl: string, v: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? "");
}

export function mapEvent(e: AgentEvent, overrides?: Partial<RuleTable>): BehaviorAction {
  const rule: Rule = { ...DEFAULT_RULES[e.kind], ...(overrides?.[e.kind] ?? {}) };
  const v = vars(e);
  const bubble = renderTemplate(rule.bubbleTemplate, v);
  let ttsText: string | undefined;
  if (rule.ttsTemplate) {
    const rendered = renderTemplate(rule.ttsTemplate, v).trim();
    // 空模板结果（如 idle_prompt 的空 prompt）不播报
    if (rendered && !/^[：:，,。.\s]*$/.test(rendered.replace(/^出错了[：:]/, ""))) {
      ttsText = rendered;
    }
  }
  // idle_prompt 空文本兜底文案
  const finalBubble =
    e.kind === "idle_prompt" && bubble.replace("💬", "").trim() === ""
      ? "💬 Agent 在等你输入"
      : bubble;

  return {
    motion: rule.motion,
    expression: rule.expression,
    bubble: finalBubble,
    ttsText,
    urgency: rule.urgency,
  };
}
