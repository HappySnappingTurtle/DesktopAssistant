/** 根据当前输入选择最相关的 facts 注入 prompt */

import type { MemoryFact } from "./store";

/** 简单分词（中文按字，英文按空格） */
function segment(text: string): string[] {
  const words: string[] = [];
  for (const match of text.matchAll(/[a-zA-Z]+|[一-鿿]/g)) {
    words.push(match[0].toLowerCase());
  }
  return words;
}

export function selectRelevantFacts(
  facts: readonly MemoryFact[],
  currentInput: string,
  maxCount = 8,
): { selected: MemoryFact[]; indices: number[] } {
  const inputWords = new Set(segment(currentInput));

  const scored = facts.map((f, i) => {
    const fWords = segment(f.text);
    const relevance = fWords.filter((w) => inputWords.has(w)).length;
    const isCore = f.confidence >= 0.8;
    return { fact: f, index: i, relevance, isCore };
  });

  // 核心事实（高置信度）始终入选
  const core = scored.filter((s) => s.isCore);
  // 话题相关事实按相关性排序
  const topical = scored
    .filter((s) => !s.isCore && s.fact.confidence >= 0.3)
    .sort((a, b) => b.relevance - a.relevance);

  const merged = [...core, ...topical].slice(0, maxCount);
  return {
    selected: merged.map((m) => m.fact),
    indices: merged.map((m) => m.index),
  };
}
