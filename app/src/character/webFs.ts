import type { CharacterFs } from "./store";

/**
 * 内置角色包的 CharacterFs：从应用静态资源（public/characters/）读取。
 * 用户导入的角色包走 Tauri fs 实现（T12 接入应用数据目录）。
 */
export function createWebCharacterFs(builtinIds: string[]): CharacterFs {
  return {
    async listDirs() {
      return builtinIds;
    },
    async readManifest(dir: string) {
      try {
        const res = await fetch(`/characters/${dir}/character.manifest.yaml`);
        if (!res.ok) return null;
        return await res.text();
      } catch {
        return null;
      }
    },
    baseUrl(dir: string) {
      return `/characters/${dir}`;
    },
  };
}
