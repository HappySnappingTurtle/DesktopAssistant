/** 对话摘要压缩——将旧对话轮次压缩为简短摘要，通过注入的 LLM 函数实现 */

import type { ChatTurn } from "./manager";

export interface CompressorDeps {
  llmSummarize: (prompt: string) => Promise<string>;
}

const COMPRESS_PROMPT = (conversation: string) =>
  `把以下对话摘要为3~5句话。保留：关键事实、情绪转变、未完成的话题。不保留：寒暄、重复内容。只返回摘要文本。

${conversation}`;

export function createCompressor(deps: CompressorDeps) {
  return async (turns: ChatTurn[]): Promise<string> => {
    const conversation = turns
      .filter((t) => t.role !== "system")
      .map((t) => `${t.role === "user" ? "用户" : "角色"}：${t.content}`)
      .join("\n");

    if (conversation.length < 20) return conversation;

    try {
      const summary = await deps.llmSummarize(COMPRESS_PROMPT(conversation));
      return summary.trim() || conversation.slice(0, 200);
    } catch {
      return conversation.slice(0, 200) + "…";
    }
  };
}
