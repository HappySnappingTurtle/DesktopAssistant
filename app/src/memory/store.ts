/** L1 记忆存储——facts CRUD、淘汰、持久化接口 */

export interface MemoryFact {
  text: string;
  source: "extracted" | "user";
  confidence: number;
  created_at: string;
  last_used_at: string;
  use_count: number;
}

export interface UserMemoryState {
  facts: MemoryFact[];
  last_interaction: string;
}

const MAX_FACTS = 30;

function daysSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

export function createMemoryStore(initial?: UserMemoryState) {
  const state: UserMemoryState = initial ?? { facts: [], last_interaction: new Date().toISOString() };

  return {
    getFacts(): readonly MemoryFact[] { return state.facts; },
    getState(): UserMemoryState { return { ...state, facts: [...state.facts] }; },

    addFact(text: string, source: "extracted" | "user" = "extracted", confidence = 0.6): boolean {
      if (isDuplicate(state.facts, text)) return false;
      state.facts.push({
        text,
        source,
        confidence: source === "user" ? 1.0 : confidence,
        created_at: new Date().toISOString(),
        last_used_at: new Date().toISOString(),
        use_count: 0,
      });
      evict(state.facts);
      return true;
    },

    removeFact(text: string): boolean {
      const idx = state.facts.findIndex((f) => f.text === text);
      if (idx < 0) return false;
      state.facts.splice(idx, 1);
      return true;
    },

    markUsed(indices: number[]) {
      const now = new Date().toISOString();
      for (const i of indices) {
        if (state.facts[i]) {
          state.facts[i].use_count++;
          state.facts[i].last_used_at = now;
        }
      }
    },

    touchInteraction() {
      state.last_interaction = new Date().toISOString();
    },

    maintain(): number {
      const before = state.facts.length;
      state.facts = state.facts.filter((f) => {
        if (f.source === "user") return true; // 用户手动添加的不淘汰
        const age = daysSince(f.created_at);
        return !(age > 30 && f.use_count < 3 && f.confidence < 0.5);
      });
      return before - state.facts.length;
    },
  };
}

function isDuplicate(facts: MemoryFact[], text: string): boolean {
  const words = new Set(text.split(/\s+/));
  return facts.some((f) => {
    const existing = new Set(f.text.split(/\s+/));
    const overlap = [...words].filter((w) => existing.has(w)).length;
    return overlap / Math.max(words.size, existing.size) > 0.5;
  });
}

function evict(facts: MemoryFact[]) {
  while (facts.length > MAX_FACTS) {
    let worstIdx = 0;
    let worstScore = Infinity;
    for (let i = 0; i < facts.length; i++) {
      if (facts[i].source === "user") continue;
      const age = daysSince(facts[i].created_at) + 1;
      const score = (facts[i].confidence * (facts[i].use_count + 1)) / Math.sqrt(age);
      if (score < worstScore) {
        worstScore = score;
        worstIdx = i;
      }
    }
    facts.splice(worstIdx, 1);
  }
}

export type MemoryStore = ReturnType<typeof createMemoryStore>;
