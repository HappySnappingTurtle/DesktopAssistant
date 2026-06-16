/**
 * 常用短语预合成缓存——启动时和切换角色时异步预合成点击台词，
 * 点击时直接播放缓存音频（零延迟 + 正确声线）。
 */
import type { VoiceProfile } from "../character/voice";

export interface PhraseCacheDeps {
  synthesize: (text: string, voice: VoiceProfile) => Promise<string>; // → dataUrl
}

export function createPhraseCache(deps: PhraseCacheDeps) {
  const cache = new Map<string, string>(); // text → dataUrl
  let currentVoice: VoiceProfile | null = null;
  let preloadQueue: string[] = [];
  let preloading = false;

  async function preloadNext() {
    if (preloading || preloadQueue.length === 0 || !currentVoice) return;
    preloading = true;
    const text = preloadQueue.shift()!;
    if (!cache.has(text)) {
      try {
        const url = await deps.synthesize(text, currentVoice);
        cache.set(text, url);
      } catch {
        // 合成失败不阻塞——播放时降级系统 TTS
      }
    }
    preloading = false;
    if (preloadQueue.length > 0) setTimeout(preloadNext, 200);
  }

  return {
    /** 切换声线时清缓存并重新预合成 */
    setVoice(voice: VoiceProfile, phrases: string[]) {
      currentVoice = voice;
      cache.clear();
      preloadQueue = [...phrases];
      setTimeout(preloadNext, 1000); // 启动 1s 后开始预合成，不抢首屏
    },

    /** 获取缓存音频，未命中返回 null（调用方降级） */
    get(text: string): string | null {
      return cache.get(text) ?? null;
    },

    /** 手动预合成一条（如用户自定义了 triggers） */
    preload(text: string) {
      if (!cache.has(text)) {
        preloadQueue.push(text);
        void preloadNext();
      }
    },
  };
}

export type PhraseCache = ReturnType<typeof createPhraseCache>;
