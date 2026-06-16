import type { VoiceProfile } from "../character/voice";
import type { Urgency } from "../behavior/engine";

export interface TTSRequest {
  text: string;
  urgency: Urgency;
}

export interface TTSDeps {
  synthesize: (text: string, voice: VoiceProfile) => Promise<string>; // → dataUrl
  play: (dataUrl: string) => Promise<void>;
  fallback?: (text: string) => Promise<void>;
  now?: () => number;
}

const QUEUE_LIMIT = 5;
const DEDUP_MS = 5_000;
const URGENCY_RANK: Record<Urgency, number> = { high: 2, med: 1, low: 0 };

export function createTTSManager(deps: TTSDeps, initialVoice: VoiceProfile) {
  const now = deps.now ?? (() => Date.now());
  let voice = initialVoice;
  let muted = false;
  let playing = false;
  const queue: TTSRequest[] = [];
  const recent = new Map<string, number>();

  async function pump(): Promise<void> {
    if (playing) return;
    const item = queue.shift();
    if (!item) return;
    playing = true;
    try {
      const url = await deps.synthesize(item.text, voice);
      await deps.play(url);
    } catch (e) {
      console.warn("[tts] synthesize/play failed, fallback:", e);
      try {
        await deps.fallback?.(item.text);
      } catch {
        /* fallback 也失败则放弃本条 */
      }
    } finally {
      playing = false;
      void pump();
    }
  }

  return {
    enqueue(req: TTSRequest): boolean {
      if (muted) return false;
      const t = now();
      const last = recent.get(req.text);
      if (last !== undefined && t - last < DEDUP_MS) return false;
      recent.set(req.text, t);
      for (const [k, v] of recent) if (t - v > DEDUP_MS) recent.delete(k);

      if (req.urgency === "high") {
        queue.unshift(req);
      } else {
        queue.push(req);
      }

      while (queue.length > QUEUE_LIMIT) {
        // 丢弃优先级最低的（同级丢最旧 = 靠后的最早入队项）
        let dropIdx = -1;
        let dropRank = Infinity;
        for (let i = queue.length - 1; i >= 0; i--) {
          if (URGENCY_RANK[queue[i].urgency] < dropRank) {
            dropRank = URGENCY_RANK[queue[i].urgency];
            dropIdx = i;
          }
        }
        queue.splice(dropIdx, 1);
      }

      void pump();
      return true;
    },

    setVoice(profile: VoiceProfile) {
      voice = profile;
    },
    getVoice(): VoiceProfile {
      return voice;
    },
    setMuted(m: boolean) {
      muted = m;
    },
    pending(): number {
      return queue.length;
    },
  };
}

export type TTSManager = ReturnType<typeof createTTSManager>;
