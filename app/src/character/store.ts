import { parseManifest, type CharacterManifest } from "./manifest";
import { resolveVoice, type VoiceProfile } from "./voice";

export interface CharacterSummary {
  id: string;
  displayName: string;
  manifest: CharacterManifest;
  voice: VoiceProfile;
  /** 角色包根（URL 或 fs 路径），model_entry 相对于它解析 */
  baseUrl: string;
}

/** 文件访问抽象：单测注入内存实现，运行时注入 Tauri fs / fetch */
export interface CharacterFs {
  /** 列出 characters 根目录下的子目录名 */
  listDirs(): Promise<string[]>;
  /** 读角色目录内的 manifest 文本；不存在返回 null */
  readManifest(dir: string): Promise<string | null>;
  /** 角色目录的资源基址（前端可加载的 URL/路径前缀） */
  baseUrl(dir: string): string;
}

export interface CharacterChangedEvent {
  id: string;
  voice: VoiceProfile;
  manifest: CharacterManifest;
}

export function createCharacterStore(fs: CharacterFs) {
  let characters: CharacterSummary[] = [];
  let activeId: string | null = null;
  const listeners: Array<(e: CharacterChangedEvent) => void> = [];
  const warnings: string[] = [];

  return {
    warnings,

    async refresh(): Promise<CharacterSummary[]> {
      characters = [];
      for (const dir of await fs.listDirs()) {
        const text = await fs.readManifest(dir);
        if (text === null) {
          warnings.push(`目录无 manifest，跳过: ${dir}`);
          continue;
        }
        const parsed = parseManifest(text);
        if (!parsed.ok) {
          warnings.push(`角色包损坏，跳过 ${dir}: ${parsed.errors.join("; ")}`);
          continue;
        }
        characters.push({
          id: parsed.manifest.id,
          displayName: parsed.manifest.display_name,
          manifest: parsed.manifest,
          voice: resolveVoice(parsed.manifest),
          baseUrl: fs.baseUrl(dir),
        });
      }
      return characters;
    },

    list(): CharacterSummary[] {
      return characters;
    },

    getActive(): CharacterSummary | null {
      return characters.find((c) => c.id === activeId) ?? null;
    },

    async activate(id: string): Promise<CharacterSummary> {
      const target = characters.find((c) => c.id === id);
      if (!target) throw new Error(`未知角色: ${id}`);
      activeId = id;
      const event: CharacterChangedEvent = {
        id,
        voice: target.voice,
        manifest: target.manifest,
      };
      for (const cb of listeners) cb(event);
      return target;
    },

    onChanged(cb: (e: CharacterChangedEvent) => void): () => void {
      listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
  };
}

export type CharacterStore = ReturnType<typeof createCharacterStore>;
