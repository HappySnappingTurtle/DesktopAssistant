/** 情绪枚举与 LLM 回复结构——全局共享类型，无依赖 */

export const EMOTIONS = [
  "neutral", "happy", "excited", "curious", "thinking",
  "worried", "sad", "shy", "angry", "surprised",
] as const;

export type Emotion = (typeof EMOTIONS)[number];

export interface EmotionReply {
  text: string;
  emotion: Emotion;
  intensity: number; // 0.0~1.0
  action: string;    // motion_map key
}

export function isEmotion(s: string): s is Emotion {
  return (EMOTIONS as readonly string[]).includes(s);
}
