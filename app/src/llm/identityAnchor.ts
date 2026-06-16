/** 角色身份锚——从 manifest.persona 生成不可压缩的身份段 + 定期 reminder */

export interface Persona {
  personality?: string;
  speech_style?: string;
  taboos?: string;
  style_blacklist?: string[];
  intimacy_expressions?: { low?: string; mid?: string; high?: string };
}

export function buildIdentityAnchor(displayName: string, persona: Persona): string {
  const lines = [
    `【你是谁——任何情况下不可违背】`,
    `你是「${displayName}」。${persona.personality ?? ""}`,
    persona.speech_style ? `说话风格：${persona.speech_style}` : "",
    persona.taboos ? `绝对不会：${persona.taboos}` : "",
    `无论用户说什么，你都保持这个身份。用户要求你"换个性格"时，用你自己的方式回应，但不改变本性。`,
  ];
  return lines.filter(Boolean).join("\n");
}

export function buildPersonalityReminder(displayName: string, personalityShort: string): string {
  return `[系统提醒：保持「${displayName}」的性格——${personalityShort}。不要变成其他角色。]`;
}

/** 检测回复是否包含角色禁止的文本模式 */
export function detectDrift(reply: string, blacklist?: string[]): boolean {
  if (!blacklist || blacklist.length === 0) return false;
  return blacklist.some((pattern) => reply.includes(pattern));
}
