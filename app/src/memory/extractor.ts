/** 对话后异步提取用户偏好事实——与 LLM 和 memoryStore 均通过接口解耦 */

import type { ChatTurn } from "../conversation/manager";

export interface ExtractorDeps {
  /** 调用 LLM 提取事实（注入的异步函数） */
  llmExtract: (prompt: string) => Promise<string>;
  /** 已有事实文本列表（用于 prompt 内去重） */
  existingFacts: () => string[];
  /** 写入新事实 */
  addFact: (text: string) => void;
}

const EXTRACT_PROMPT = (existing: string, conversation: string) =>
  `从以下对话中提取用户的持久性偏好/习惯/身份信息（如喜好、工作、习惯），最多3条。
不要提取临时状态（如"今天在调bug"）。
已知事实（不要重复）：
${existing || "（无）"}

对话：
${conversation}

如果没有新信息，返回空 JSON 数组 []。
否则返回 JSON 数组：[{"text":"事实描述","confidence":0.3~0.9}]
只返回 JSON，不加其他文字。`;

export function createMemoryExtractor(deps: ExtractorDeps) {
  let running = false;

  return {
    /** 异步提取——调用后不阻塞，失败静默 */
    async extract(recentTurns: readonly ChatTurn[]): Promise<number> {
      if (running) return 0;
      if (recentTurns.length < 2) return 0;
      running = true;

      try {
        const conversation = recentTurns
          .filter((t) => t.role !== "system")
          .map((t) => `${t.role === "user" ? "用户" : "角色"}：${t.content}`)
          .join("\n");
        const existing = deps.existingFacts().join("\n");
        const raw = await deps.llmExtract(EXTRACT_PROMPT(existing, conversation));

        let added = 0;
        try {
          const arr = JSON.parse(raw.trim().match(/\[[\s\S]*\]/)?.[0] ?? "[]");
          if (Array.isArray(arr)) {
            for (const item of arr.slice(0, 3)) {
              if (typeof item.text === "string" && item.text.length > 2) {
                deps.addFact(item.text);
                added++;
              }
            }
          }
        } catch {
          // LLM 返回格式不对，静默
        }
        return added;
      } catch (e) {
        console.warn("[memory-extractor]", e);
        return 0;
      } finally {
        running = false;
      }
    },
  };
}
