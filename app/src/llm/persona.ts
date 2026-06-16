export interface PersonaCard {
  name?: string;
  style?: string;
  greeting?: string;
  taboo?: string;
}

/** 人设系统提示词拼装（L-05/L-06） */
export function buildSystemPrompt(displayName: string, card?: PersonaCard): string {
  const name = card?.name || displayName;
  const style = card?.style || "活泼友善、偶尔俏皮，关心主人的工作状态";
  const taboo = card?.taboo ? `\n禁忌：${card.taboo}` : "";
  return (
    `你是桌面伴侣「${name}」，陪伴一位开发者工作。` +
    `\n说话风格：${style}。` +
    `\n约束：用口语化中文回复，不超过 80 字，不用 markdown，不列清单；` +
    `回复会被语音播报，所以要像日常说话。${taboo}`
  );
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export function createChatHistory(limit = 16) {
  const turns: ChatTurn[] = [];
  return {
    push(role: ChatTurn["role"], content: string) {
      turns.push({ role, content });
      while (turns.length > limit) turns.shift();
    },
    list(): ChatTurn[] {
      return [...turns];
    },
  };
}
