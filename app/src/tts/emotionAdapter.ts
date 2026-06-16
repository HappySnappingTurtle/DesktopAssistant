/** 情绪→TTS 语调偏移（纯逻辑，与 TTS 引擎解耦） */

import type { Emotion } from "../llm/emotionTypes";

interface TtsShift { pitchHz: number; ratePercent: number }

const SHIFTS: Record<Emotion, TtsShift> = {
  neutral:   { pitchHz: 0,  ratePercent: 0 },
  happy:     { pitchHz: 3,  ratePercent: 5 },
  excited:   { pitchHz: 5,  ratePercent: 10 },
  curious:   { pitchHz: 2,  ratePercent: 3 },
  thinking:  { pitchHz: -1, ratePercent: -3 },
  worried:   { pitchHz: 2,  ratePercent: 3 },
  sad:       { pitchHz: -3, ratePercent: -8 },
  shy:       { pitchHz: -1, ratePercent: -5 },
  angry:     { pitchHz: 4,  ratePercent: 5 },
  surprised: { pitchHz: 3,  ratePercent: 5 },
};

/** 计算最终 pitch/rate：基准 + 情绪偏移 × intensity */
export function emotionTtsShift(
  basePitch: string,
  baseRate: string,
  emotion: Emotion,
  intensity: number,
): { pitch: string; rate: string } {
  const shift = SHIFTS[emotion] ?? SHIFTS.neutral;
  const bpHz = parseNum(basePitch);
  const brPct = parseNum(baseRate);
  const pHz = Math.round(bpHz + shift.pitchHz * intensity);
  const rPct = Math.round(brPct + shift.ratePercent * intensity);
  return {
    pitch: `${pHz >= 0 ? "+" : ""}${pHz}Hz`,
    rate: `${rPct >= 0 ? "+" : ""}${rPct}%`,
  };
}

function parseNum(s: string): number {
  const n = parseInt(s.replace(/[^0-9\-+]/g, ""), 10);
  return Number.isNaN(n) ? 0 : n;
}
