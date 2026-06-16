/** 情绪→参数映射引擎。纯数学，不含性格文本。 */

import type { Emotion } from "../llm/emotionTypes";

type ParamMap = Partial<Record<string, number>>;

const DEFAULT_EMOTION_PARAMS: Record<Emotion, ParamMap> = {
  neutral:   {},
  happy:     { ParamAngleY: 3, ParamMouthForm: 0.6, ParamEyeLOpen: 1, ParamEyeROpen: 1 },
  excited:   { ParamAngleY: 8, ParamBodyAngleX: 5, ParamMouthForm: 0.8, ParamEyeLOpen: 1.2 },
  curious:   { ParamAngleZ: 8, ParamAngleX: 5, ParamEyeBallY: 3 },
  thinking:  { ParamAngleY: -3, ParamEyeBallY: 5, ParamAngleX: -3 },
  worried:   { ParamBrowLY: -5, ParamBrowRY: -5, ParamAngleY: -2 },
  sad:       { ParamAngleY: -8, ParamEyeLOpen: 0.6, ParamEyeROpen: 0.6, ParamMouthForm: -0.3 },
  shy:       { ParamAngleZ: -6, ParamCheek: 0.5, ParamEyeBallY: -3, ParamBodyAngleX: -3 },
  angry:     { ParamBrowLY: -8, ParamBrowRY: -8, ParamMouthForm: -0.5, ParamAngleY: 2 },
  surprised: { ParamEyeLOpen: 1.3, ParamEyeROpen: 1.3, ParamBrowLY: 5, ParamBrowRY: 5, ParamAngleY: 3 },
};

/** 合并角色覆盖 → 乘以 intensity → 最终参数目标值 */
export function resolveEmotionParams(
  emotion: Emotion,
  intensity: number,
  overrides?: Record<string, ParamMap>,
): Record<string, number> {
  const base = DEFAULT_EMOTION_PARAMS[emotion] ?? {};
  const merged = { ...base, ...(overrides?.[emotion] ?? {}) };
  const result: Record<string, number> = {};
  for (const [k, v] of Object.entries(merged)) {
    if (typeof v === "number") result[k] = v * intensity;
  }
  return result;
}
