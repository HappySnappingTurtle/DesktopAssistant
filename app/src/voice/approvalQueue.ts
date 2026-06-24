export type ApprovalLevel = "auto" | "notify" | "confirm" | "block";

export interface QueuedApproval {
  sessionId: string;
  agent: string;
  tool: string;
  promptText: string;
  at: number;
  level: ApprovalLevel;
}

const MAX_SIZE = 10;
const TTL_MS = 10 * 60 * 1000;

export function createApprovalQueue(nowFn?: () => number) {
  const now = nowFn ?? (() => Date.now());
  const items: QueuedApproval[] = [];

  function gc() {
    const t = now();
    while (items.length > 0 && t - items[0].at > TTL_MS) items.shift();
  }

  return {
    push(item: QueuedApproval) {
      gc();
      items.push(item);
      while (items.length > MAX_SIZE) {
        const dropIdx = items.findIndex((i) => i.level === "confirm");
        items.splice(dropIdx >= 0 ? dropIdx : 0, 1);
      }
    },

    peekConfirm(): QueuedApproval | null {
      gc();
      return items.find((i) => i.level === "confirm") ?? null;
    },

    shiftConfirm(): QueuedApproval | null {
      gc();
      const idx = items.findIndex((i) => i.level === "confirm");
      if (idx < 0) return null;
      return items.splice(idx, 1)[0];
    },

    size(): number {
      gc();
      return items.length;
    },

    pending(): readonly QueuedApproval[] {
      gc();
      return items;
    },

    clear() {
      items.length = 0;
    },
  };
}

export type ApprovalQueue = ReturnType<typeof createApprovalQueue>;
