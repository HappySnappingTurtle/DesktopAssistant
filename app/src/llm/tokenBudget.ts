/** Token 预算管理——按模型上下文窗口分配各段预算，紧急压缩策略 */

export interface TokenBudget {
  identity: number;
  format: number;
  userProfile: number;
  relationship: number;
  context: number;
  history: number;
  userCustom: number;
  userInput: number;
  reply: number;
}

export function allocateBudget(modelContextSize: number): TokenBudget {
  if (modelContextSize >= 32768) {
    return { identity: 200, format: 150, userProfile: 300, relationship: 50, context: 100, history: 6000, userCustom: 200, userInput: 300, reply: 1000 };
  }
  if (modelContextSize >= 8192) {
    return { identity: 200, format: 150, userProfile: 200, relationship: 50, context: 100, history: 2000, userCustom: 200, userInput: 200, reply: 500 };
  }
  // 4K 模型
  return { identity: 200, format: 150, userProfile: 200, relationship: 50, context: 100, history: 800, userCustom: 200, userInput: 200, reply: 500 };
}

/** 粗略估算 token 数（中文约 1.5 tokens/字，英文约 1.3 tokens/word） */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = text.match(/[一-鿿぀-ヿ가-힯]/g)?.length ?? 0;
  const rest = text.length - cjk;
  return Math.ceil(cjk * 1.5 + rest * 0.35);
}

export interface PromptSection {
  key: string;
  text: string;
  tokens: number;
  priority: number; // 越高越不可压缩。identity=100, history=10
}

/** 紧急压缩：按优先级从低到高砍，直到总量在预算内 */
export function emergencyCompress(
  sections: PromptSection[],
  maxTokens: number,
): PromptSection[] {
  let total = sections.reduce((s, sec) => s + sec.tokens, 0);
  if (total <= maxTokens) return sections;

  const sorted = [...sections].sort((a, b) => a.priority - b.priority);
  for (const sec of sorted) {
    if (total <= maxTokens) break;
    if (sec.priority >= 90) continue; // 不砍身份锚和格式约束
    const cut = Math.ceil(sec.text.length * 0.5);
    const newText = sec.text.slice(-cut); // 保留后半（更新的内容）
    const saved = sec.tokens - estimateTokens(newText);
    sec.text = newText;
    sec.tokens = estimateTokens(newText);
    total -= saved;
  }
  return sections;
}
