import { parse as parseYaml } from "yaml";

export interface VoiceConfig {
  provider?: string;
  voice?: string;
  pitch?: string;
  rate?: string;
}

export interface PersonaConfig {
  personality?: string;
  speech_style?: string;
  greeting?: string;
  taboos?: string;
  style_blacklist?: string[];
  intimacy_expressions?: { low?: string; mid?: string; high?: string };
}

export interface CharacterManifest {
  schema_version: number;
  id: string;
  display_name: string;
  model_entry: string;
  gender_presentation?: "female" | "male" | string;
  voice?: VoiceConfig;
  persona?: PersonaConfig;
  motion_map?: Record<string, string | string[]>;
  expression_map?: Record<string, string>;
  triggers?: Record<string, { motion?: string; tts?: string }>;
  sounds?: Record<string, string>;
  scale?: number;
  emotion_param_overrides?: Record<string, Record<string, number>>;
  gpt_sovits?: {
    ref_audio?: string;
    ref_text?: string;
    ref_lang?: string;
  };
  cosyvoice3?: {
    ref_audio?: string;
    ref_text?: string;
  };
}

export interface ParseOk {
  ok: true;
  manifest: CharacterManifest;
  warnings: string[];
}
export interface ParseErr {
  ok: false;
  errors: string[];
}

const REQUIRED = ["schema_version", "id", "display_name", "model_entry"] as const;
const KNOWN = new Set<string>([
  ...REQUIRED,
  "gender_presentation",
  "voice",
  "persona",
  "motion_map",
  "expression_map",
  "triggers",
  "sounds",
  "scale",
  "emotion_param_overrides",
  "gpt_sovits",
  "cosyvoice3",
  "default_name_cn",
  "default_name_en",
  "persona_card",
  "constraints",
]);

export function parseManifest(yamlText: string): ParseOk | ParseErr {
  if (!yamlText || yamlText.trim() === "") {
    return { ok: false, errors: ["manifest 内容为空"] };
  }
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (e) {
    return { ok: false, errors: [`YAML 解析失败: ${(e as Error).message}`] };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["manifest 顶层必须是对象"] };
  }
  const obj = raw as Record<string, unknown>;
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const key of REQUIRED) {
    if (obj[key] === undefined || obj[key] === null || obj[key] === "") {
      errors.push(`缺少必需字段: ${key}`);
    }
  }
  if (obj.schema_version !== undefined && obj.schema_version !== 1) {
    errors.push(`不支持的 schema_version: ${String(obj.schema_version)}（当前仅支持 1）`);
  }
  if (obj.motion_map !== undefined) {
    const mm = obj.motion_map;
    if (typeof mm !== "object" || mm === null || Array.isArray(mm)) {
      errors.push("motion_map 必须是对象");
    } else {
      for (const [k, v] of Object.entries(mm as Record<string, unknown>)) {
        const valid =
          typeof v === "string" ||
          (Array.isArray(v) && v.every((x) => typeof x === "string"));
        if (!valid) errors.push(`motion_map.${k} 必须是字符串或字符串数组`);
      }
    }
  }
  for (const key of Object.keys(obj)) {
    if (!KNOWN.has(key)) warnings.push(`未知字段将被忽略: ${key}`);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, manifest: obj as unknown as CharacterManifest, warnings };
}

export interface PackageValidation {
  missing: string[];
  warnings: string[];
}

/** files: 包内相对路径列表（POSIX 风格） */
export function validatePackage(
  m: CharacterManifest,
  files: string[],
): PackageValidation {
  const set = new Set(files.map((f) => f.replace(/\\/g, "/")));
  const missing: string[] = [];
  const warnings: string[] = [];

  if (!set.has(m.model_entry)) missing.push(m.model_entry);

  for (const [event, rel] of Object.entries(m.sounds ?? {})) {
    if (!set.has(rel)) warnings.push(`音效缺失（将降级为静默）: ${event} → ${rel}`);
  }
  return { missing, warnings };
}
