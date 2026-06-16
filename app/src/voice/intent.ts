export type Intent =
  | { type: "approve" }
  | { type: "deny" }
  | { type: "instruction"; text: string }
  | { type: "noop" };

const APPROVE_WORDS = [
  "是", "好", "好的", "好啊", "可以", "同意", "确认", "確認", "批准", "允许", "允許",
  "嗯", "行", "没问题", "沒問題", "yes", "ok", "okay", "y", "yeah", "yep", "sure",
];
const DENY_WORDS = [
  "否", "不", "不行", "不要", "不可以", "拒绝", "拒絕", "取消", "别", "別",
  "no", "n", "nope", "cancel", "stop",
];

/** 去标点/空白并小写化 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s。，、．,.!！?？:：;；~～"'「」『』()（）\-]/gu, "");
}

export function parseIntent(raw: string): Intent {
  const norm = normalize(raw);
  if (norm === "") return { type: "noop" };

  // 短句（≤6 字符）做关键词判定；长句直接视为指令
  if ([...norm].length <= 6) {
    if (APPROVE_WORDS.includes(norm)) return { type: "approve" };
    if (DENY_WORDS.includes(norm)) return { type: "deny" };
    // 短句内含强关键词（如 "嗯可以" / "no way" 不算——需谨慎，仅全等匹配通过）
  }
  return { type: "instruction", text: raw.trim() };
}
