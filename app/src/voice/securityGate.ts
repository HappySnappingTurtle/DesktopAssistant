import type { Intent } from "./intent";

export type ApprovalMode = "auto" | "safe-list" | "parrot";

export interface GateInput {
  intent: Intent;
  promptText: string;
  mode: ApprovalMode;
}

export type GateResult =
  | { allow: true; keys: string }
  | { allow: false; reason: "blacklisted" | "mode" | "noop"; speech?: string };

/**
 * 高危操作黑名单（TODOList D9 / T10 安全验收门槛）。
 * 命中 → 永不通过语音注入任何按键（包括 deny），要求物理键确认。
 */
const BLACKLIST: RegExp[] = [
  /rm\s+(-[a-z]*[rf][a-z]*\s+)+/i,        // rm -rf / -fr / -r -f 链
  /\bsudo\s/i,
  /chmod\s+777/i,
  /git\s+push\b[^\n]*--force/i,
  /\bcurl\b[^|\n]*\|\s*(ba|z)?sh/i,
  /\bwget\b[^|\n]*\|\s*(ba|z)?sh/i,
  />\s*\/etc\//i,
  /gh\s+repo\s+delete/i,
  /drop\s+(table|database)/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
];

/** 还原常见转义后再扫描（防 \n 字面量 / 多空格绕过） */
export function normalizeForScan(text: string): string {
  return text
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, " ")
    .replace(/[ \t]+/g, " ");
}

export function isBlacklisted(promptText: string): boolean {
  const scanned = normalizeForScan(promptText);
  return BLACKLIST.some((re) => re.test(scanned));
}

export function gate(input: GateInput): GateResult {
  const { intent, promptText, mode } = input;

  if (intent.type === "noop") return { allow: false, reason: "noop" };

  if (isBlacklisted(promptText)) {
    return {
      allow: false,
      reason: "blacklisted",
      speech: "这个操作有风险，请你亲自在终端确认",
    };
  }

  if (mode === "auto" || mode === "parrot") {
    return { allow: false, reason: "mode" };
  }

  // safe-list 模式
  switch (intent.type) {
    case "approve":
      return { allow: true, keys: "y\r" };
    case "deny":
      return { allow: true, keys: "n\r" };
    case "instruction":
      return { allow: true, keys: intent.text + "\r" };
  }
}
