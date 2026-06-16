/** 角色关系状态追踪——亲密度、心情基线 */

import type { Emotion } from "../llm/emotionTypes";

export interface RelationshipState {
  intimacy: number;       // 0~100
  mood_baseline: Emotion;
  mood_decay_at: string;  // ISO timestamp
}

export function defaultRelationship(): RelationshipState {
  return { intimacy: 10, mood_baseline: "neutral", mood_decay_at: new Date().toISOString() };
}

export function adjustIntimacy(state: RelationshipState, delta: number): RelationshipState {
  return { ...state, intimacy: Math.min(100, Math.max(0, state.intimacy + delta)) };
}

export function setMoodBaseline(state: RelationshipState, mood: Emotion, durationMs = 30 * 60 * 1000): RelationshipState {
  return { ...state, mood_baseline: mood, mood_decay_at: new Date(Date.now() + durationMs).toISOString() };
}

/** 获取当前有效心情（过期则回 neutral） */
export function currentMood(state: RelationshipState): Emotion {
  if (new Date(state.mood_decay_at).getTime() < Date.now()) return "neutral";
  return state.mood_baseline;
}

/** 亲密度分级（注入 prompt 用） */
export function intimacyLevel(intimacy: number): "low" | "mid" | "high" {
  if (intimacy >= 60) return "high";
  if (intimacy >= 25) return "mid";
  return "low";
}

/** 按无互动时间衰减亲密度（每小时 -2，下限 0） */
export function decayIntimacy(state: RelationshipState, lastInteraction: string): RelationshipState {
  const hours = (Date.now() - new Date(lastInteraction).getTime()) / (1000 * 60 * 60);
  if (hours < 1) return state;
  const loss = Math.floor(hours) * 2;
  return adjustIntimacy(state, -loss);
}
