/** 会话历史管理——滑窗 + 摘要触发 + 跨会话持久化 */

export interface ChatTurn {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface Summary {
  text: string;
  turn_range: [number, number];
  created_at: string;
}

export interface ConversationState {
  summaries: Summary[];
  total_turns: number;
}

const RECENT_WINDOW = 6;  // 保留最近 6 轮（12 条消息）
const MAX_SUMMARIES = 5;
const COMPRESS_THRESHOLD = 10; // 溢出 10 轮触发压缩

export function createConversationManager(
  initial?: ConversationState,
  compressFn?: (turns: ChatTurn[]) => Promise<string>,
) {
  const state: ConversationState = initial ?? { summaries: [], total_turns: 0 };
  const recent: ChatTurn[] = [];
  const pendingCompress: ChatTurn[] = [];

  return {
    getRecent(): readonly ChatTurn[] { return recent; },
    getSummaries(): readonly Summary[] { return state.summaries; },
    getState(): ConversationState { return { ...state, summaries: [...state.summaries] }; },
    totalTurns(): number { return state.total_turns; },

    push(turn: ChatTurn) {
      recent.push(turn);
      if (turn.role !== "system") state.total_turns++;

      // 超出窗口的旧对话进入压缩队列
      while (recent.length > RECENT_WINDOW * 2) {
        pendingCompress.push(recent.shift()!);
      }
    },

    /** 需要压缩吗？（外部轮询调用，不自动触发——保持低耦合） */
    needsCompression(): boolean {
      return pendingCompress.length >= COMPRESS_THRESHOLD * 2;
    },

    /** 执行压缩——调用注入的 compressFn */
    async compress(): Promise<boolean> {
      if (pendingCompress.length < 4 || !compressFn) return false;
      const toCompress = pendingCompress.splice(0);
      const summaryText = await compressFn(toCompress);
      const turnStart = state.total_turns - recent.length - toCompress.length;
      state.summaries.push({
        text: summaryText,
        turn_range: [turnStart, turnStart + toCompress.length / 2],
        created_at: new Date().toISOString(),
      });
      // 摘要栈溢出：最旧 2 个合并
      while (state.summaries.length > MAX_SUMMARIES) {
        const [a, b] = state.summaries.splice(0, 2);
        state.summaries.unshift({
          text: a.text + " " + b.text,
          turn_range: [a.turn_range[0], b.turn_range[1]],
          created_at: new Date().toISOString(),
        });
      }
      return true;
    },

    /** 构建注入 prompt 的历史消息 */
    buildHistory(): ChatTurn[] {
      const turns: ChatTurn[] = [];
      if (state.summaries.length > 0) {
        turns.push({
          role: "system",
          content: `【之前的对话摘要】\n${state.summaries.map((s) => s.text).join("\n")}`,
        });
      }
      turns.push(...recent);
      return turns;
    },

    /** 应用关闭前：recent 压缩为摘要并持久化 */
    async persistBeforeClose(): Promise<ConversationState> {
      if (recent.length > 0 && compressFn) {
        const all = [...pendingCompress.splice(0), ...recent.splice(0)];
        if (all.length >= 4) {
          const text = await compressFn(all);
          state.summaries.push({
            text,
            turn_range: [state.total_turns - all.length / 2, state.total_turns],
            created_at: new Date().toISOString(),
          });
          while (state.summaries.length > MAX_SUMMARIES) {
            const [a, b] = state.summaries.splice(0, 2);
            state.summaries.unshift({
              text: a.text + " " + b.text,
              turn_range: [a.turn_range[0], b.turn_range[1]],
              created_at: new Date().toISOString(),
            });
          }
        }
      }
      return { ...state, summaries: [...state.summaries] };
    },
  };
}

export type ConversationManager = ReturnType<typeof createConversationManager>;
