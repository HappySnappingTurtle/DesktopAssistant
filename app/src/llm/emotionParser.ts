/** 解析 LLM JSON 回复 → EmotionReply，健壮降级 */

import { isEmotion, type EmotionReply } from "./emotionTypes";

const DEFAULT: EmotionReply = { text: "", emotion: "neutral", intensity: 0.3, action: "idle" };

export function parseEmotionReply(raw: string): EmotionReply {
  const trimmed = raw.trim();

  // 尝试提取 JSON（可能被 markdown 包裹）
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { ...DEFAULT, text: trimmed };

  try {
    const obj = JSON.parse(jsonMatch[0]);
    return {
      text: typeof obj.text === "string" ? obj.text : trimmed,
      emotion: isEmotion(obj.emotion) ? obj.emotion : "neutral",
      intensity: clampIntensity(obj.intensity),
      action: typeof obj.action === "string" ? obj.action : "idle",
    };
  } catch {
    return { ...DEFAULT, text: trimmed };
  }
}

function clampIntensity(v: unknown): number {
  if (typeof v !== "number" || Number.isNaN(v)) return 0.3;
  return Math.min(1, Math.max(0, v));
}
