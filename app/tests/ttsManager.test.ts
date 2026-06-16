import { describe, it, expect, vi } from "vitest";
import { createTTSManager } from "../src/tts/manager";
import type { VoiceProfile } from "../src/character/voice";

const VOICE_F: VoiceProfile = { provider: "edge-tts", voice: "zh-CN-XiaoyiNeural", pitch: "+2Hz", rate: "+3%" };
const VOICE_M: VoiceProfile = { provider: "edge-tts", voice: "zh-CN-YunxiNeural", pitch: "+0Hz", rate: "+0%" };

/** 受控的播放器：手动 resolve 每次 play */
function harness(t0 = 0) {
  let t = t0;
  const played: string[] = [];
  const synthCalls: Array<{ text: string; voice: string }> = [];
  let release: (() => void) | null = null;
  const deps = {
    synthesize: vi.fn(async (text: string, v: VoiceProfile) => {
      synthCalls.push({ text, voice: v.voice });
      return `url:${text}`;
    }),
    play: vi.fn(
      (url: string) =>
        new Promise<void>((res) => {
          played.push(url);
          release = res;
        }),
    ),
    fallback: vi.fn(async () => {}),
    now: () => t,
  };
  return {
    deps,
    played,
    synthCalls,
    advance: (ms: number) => (t += ms),
    releaseCurrent: () => {
      release?.();
      release = null;
    },
    flush: () => new Promise((r) => setTimeout(r, 0)),
  };
}

describe("TTSManager", () => {
  it("TQ-01 sequential playback", async () => {
    const h = harness();
    const m = createTTSManager(h.deps, VOICE_F);
    m.enqueue({ text: "一", urgency: "low" });
    m.enqueue({ text: "二", urgency: "low" });
    await h.flush();
    expect(h.played).toEqual(["url:一"]);
    h.releaseCurrent();
    await h.flush();
    await h.flush();
    expect(h.played).toEqual(["url:一", "url:二"]);
  });

  it("TQ-02 high jumps queue", async () => {
    const h = harness();
    const m = createTTSManager(h.deps, VOICE_F);
    m.enqueue({ text: "a", urgency: "low" });
    await h.flush(); // a 开始播
    m.enqueue({ text: "b", urgency: "low" });
    m.enqueue({ text: "急", urgency: "high" });
    h.releaseCurrent();
    await h.flush();
    await h.flush();
    expect(h.played[1]).toBe("url:急");
  });

  it("TQ-03 dedup within 5s", async () => {
    const h = harness();
    const m = createTTSManager(h.deps, VOICE_F);
    expect(m.enqueue({ text: "同", urgency: "low" })).toBe(true);
    expect(m.enqueue({ text: "同", urgency: "low" })).toBe(false);
    h.advance(6000);
    expect(m.enqueue({ text: "同", urgency: "low" })).toBe(true);
  });

  it("TQ-04 overflow drops lowest priority", async () => {
    const h = harness();
    const m = createTTSManager(h.deps, VOICE_F);
    m.enqueue({ text: "p0", urgency: "med" });
    await h.flush(); // p0 playing，队列空
    for (let i = 1; i <= 5; i++) m.enqueue({ text: `m${i}`, urgency: "med" });
    m.enqueue({ text: "L", urgency: "low" }); // 队列 6 → 丢 low 自己? 丢最低=L
    expect(m.pending()).toBe(5);
    m.enqueue({ text: "H", urgency: "high" }); // 插队 → 6 → 丢一条 med（最旧的靠后扫描）
    expect(m.pending()).toBe(5);
    h.releaseCurrent();
    await h.flush();
    await h.flush();
    expect(h.played[1]).toBe("url:H");
  });

  it("TQ-05 synth failure → fallback, queue continues", async () => {
    const h = harness();
    h.deps.synthesize.mockRejectedValueOnce(new Error("offline"));
    const m = createTTSManager(h.deps, VOICE_F);
    m.enqueue({ text: "坏", urgency: "low" });
    m.enqueue({ text: "好", urgency: "low" });
    await h.flush();
    await h.flush();
    expect(h.deps.fallback).toHaveBeenCalledWith("坏");
    expect(h.played).toEqual(["url:好"]);
  });

  it("TQ-06 setVoice switches profile（形象-声音绑定）", async () => {
    const h = harness();
    const m = createTTSManager(h.deps, VOICE_F);
    m.enqueue({ text: "女声", urgency: "low" });
    await h.flush();
    h.releaseCurrent();
    m.setVoice(VOICE_M);
    m.enqueue({ text: "男声", urgency: "low" });
    await h.flush();
    await h.flush();
    expect(h.synthCalls).toEqual([
      { text: "女声", voice: "zh-CN-XiaoyiNeural" },
      { text: "男声", voice: "zh-CN-YunxiNeural" },
    ]);
  });

  it("TQ-07 muted drops requests", async () => {
    const h = harness();
    const m = createTTSManager(h.deps, VOICE_F);
    m.setMuted(true);
    expect(m.enqueue({ text: "静", urgency: "high" })).toBe(false);
    await h.flush();
    expect(h.played).toEqual([]);
  });

  it("TQ-08 play failure continues queue", async () => {
    const h = harness();
    h.deps.play.mockRejectedValueOnce(new Error("audio busted"));
    const m = createTTSManager(h.deps, VOICE_F);
    m.enqueue({ text: "x", urgency: "low" });
    m.enqueue({ text: "y", urgency: "low" });
    await h.flush();
    await h.flush();
    await h.flush();
    expect(h.played).toContain("url:y");
  });
});
