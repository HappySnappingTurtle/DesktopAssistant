import type { CharacterManifest } from "./manifest";

export interface VoiceProfile {
  provider: "edge-tts" | "system";
  voice: string;
  pitch: string;
  rate: string;
}

/** 与 TODOList D6 对齐：女=三月七声线，男=丹恒声线 */
export const DEFAULT_VOICES: { female: VoiceProfile; male: VoiceProfile } = {
  female: { provider: "edge-tts", voice: "zh-CN-XiaoyiNeural", pitch: "+2Hz", rate: "+3%" },
  male: { provider: "edge-tts", voice: "zh-CN-YunxiNeural", pitch: "+0Hz", rate: "+0%" },
};

const VALID_PROVIDERS = new Set(["edge-tts", "system"]);

export interface VoiceOverride {
  enabled?: boolean;
  voice?: string;
  pitch?: string;
  rate?: string;
}

/** 设置页「覆盖角色默认声线」：enabled 时覆盖 manifest 声线，字段缺省回落原 profile */
export function applyVoiceOverride(profile: VoiceProfile, override?: VoiceOverride): VoiceProfile {
  if (!override?.enabled) return profile;
  return {
    provider: "edge-tts",
    voice: override.voice || profile.voice,
    pitch: override.pitch || profile.pitch,
    rate: override.rate || profile.rate,
  };
}

/**
 * 形象-声音强绑定：无论 manifest 怎么写，返回值永远是可用的 VoiceProfile。
 * 缺 voice → 按 gender_presentation 回落；非法 provider → system。
 */
export function resolveVoice(m: Partial<CharacterManifest>): VoiceProfile {
  const fallback =
    m.gender_presentation === "male" ? DEFAULT_VOICES.male : DEFAULT_VOICES.female;

  const v = m.voice;
  if (!v || !v.voice) return { ...fallback };

  const provider = VALID_PROVIDERS.has(v.provider ?? "")
    ? (v.provider as VoiceProfile["provider"])
    : "system";

  return {
    provider,
    voice: v.voice,
    pitch: v.pitch ?? fallback.pitch,
    rate: v.rate ?? fallback.rate,
  };
}
