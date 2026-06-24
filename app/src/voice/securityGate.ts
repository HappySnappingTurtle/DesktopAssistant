import type { Intent } from "./intent";
import type { ApprovalLevel } from "./approvalQueue";

export type ApprovalMode = "auto" | "safe-list" | "parrot";

export interface ApprovalRules {
  auto: string[];
  notify: string[];
  confirm: string[];
  block_patterns: string[];
}

export const DEFAULT_RULES: ApprovalRules = {
  auto: ["Read", "Grep", "Glob", "LS", "ListDir", "SearchDir"],
  notify: ["Write", "Edit", "NotebookEdit", "CreateFile"],
  confirm: ["Bash", "WebFetch", "WebSearch", "BrowserAction"],
  block_patterns: [
    "rm\\s+(-[a-z]*[rf][a-z]*\\s+)+",
    "\\bsudo\\s",
    "chmod\\s+777",
    "git\\s+push\\b[^\\n]*--force",
    "\\bcurl\\b[^|\\n]*\\|\\s*(ba|z)?sh",
    "\\bwget\\b[^|\\n]*\\|\\s*(ba|z)?sh",
    ">\\s*/etc/",
    "gh\\s+repo\\s+delete",
    "drop\\s+(table|database)",
    "\\bmkfs\\b",
    "\\bdd\\s+if=",
  ],
};

export interface GateInput {
  intent: Intent;
  tool: string;
  promptText: string;
  mode: ApprovalMode;
  rules: ApprovalRules;
}

export type GateResult =
  | { allow: true; keys: string; level: ApprovalLevel }
  | { allow: false; reason: "blacklisted" | "mode" | "noop"; level: ApprovalLevel; speech?: string };

export function normalizeForScan(text: string): string {
  return text
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, " ")
    .replace(/[ \t]+/g, " ");
}

export function resolveLevel(tool: string, promptText: string, rules: ApprovalRules): ApprovalLevel {
  const scanned = normalizeForScan(promptText);
  if (rules.block_patterns.some((p) => new RegExp(p, "i").test(scanned))) {
    return "block";
  }
  if (rules.auto.includes(tool)) return "auto";
  if (rules.notify.includes(tool)) return "notify";
  if (rules.confirm.includes(tool)) return "confirm";
  return "confirm";
}

export function isBlacklisted(promptText: string, rules: ApprovalRules): boolean {
  return resolveLevel("", promptText, rules) === "block";
}

export function gate(input: GateInput): GateResult {
  const { intent, tool, promptText, mode, rules } = input;
  const level = resolveLevel(tool, promptText, rules);

  if (intent.type === "noop") return { allow: false, reason: "noop", level };

  if (level === "block") {
    return {
      allow: false,
      reason: "blacklisted",
      level,
      speech: "这个操作有风险，请你亲自在终端确认",
    };
  }

  if (level === "auto") {
    return { allow: true, keys: "y\r", level };
  }

  if (level === "notify") {
    return { allow: true, keys: "y\r", level };
  }

  // confirm level — need voice confirmation
  if (mode === "auto" || mode === "parrot") {
    return { allow: false, reason: "mode", level };
  }

  switch (intent.type) {
    case "approve":
      return { allow: true, keys: "y\r", level };
    case "deny":
      return { allow: true, keys: "n\r", level };
    case "instruction":
      return { allow: true, keys: intent.text + "\r", level };
  }
}
