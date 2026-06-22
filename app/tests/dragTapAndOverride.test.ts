import { describe, it, expect, vi } from "vitest";
import { createDragTapController } from "../src/window/dragTap";
import { applyVoiceOverride, DEFAULT_VOICES } from "../src/character/voice";

describe("dragTap controller", () => {
  function make(hit = () => true) {
    const onDragStart = vi.fn();
    const onTap = vi.fn();
    const c = createDragTapController({ hitTest: hit, onDragStart, onTap });
    return { c, onDragStart, onTap };
  }

  it("D1 small movement → tap", () => {
    const { c, onDragStart, onTap } = make();
    c.onPointerDown(100, 100);
    c.onPointerMove(102, 101);
    c.onPointerUp(102, 101);
    expect(onDragStart).not.toHaveBeenCalled();
    expect(onTap).toHaveBeenCalledWith(102, 101);
  });

  it("D2 movement ≥4px → drag-start exactly once", () => {
    const { c, onDragStart, onTap } = make();
    c.onPointerDown(100, 100);
    c.onPointerMove(105, 100);
    c.onPointerMove(140, 130);
    expect(onDragStart).toHaveBeenCalledTimes(1);
    c.onPointerUp(140, 130);
    expect(onTap).not.toHaveBeenCalled();
  });

  it("D3 up after drag does not tap; next press works", () => {
    const { c, onDragStart, onTap } = make();
    c.onPointerDown(0, 0);
    c.onPointerMove(10, 0);
    c.onPointerUp(10, 0);
    c.onPointerDown(10, 0);
    c.onPointerUp(10, 0);
    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("D4 miss on character → ignored", () => {
    const { c, onDragStart, onTap } = make(() => false);
    c.onPointerDown(5, 5);
    c.onPointerMove(50, 50);
    c.onPointerUp(50, 50);
    expect(onDragStart).not.toHaveBeenCalled();
    expect(onTap).not.toHaveBeenCalled();
  });

  it("right button ignored", () => {
    const { c, onTap } = make();
    c.onPointerDown(1, 1, 2);
    c.onPointerUp(1, 1);
    expect(onTap).not.toHaveBeenCalled();
  });
});

describe("applyVoiceOverride", () => {
  const base = DEFAULT_VOICES.female;

  it("disabled → manifest profile", () => {
    expect(applyVoiceOverride(base, { enabled: false, voice: "X" })).toEqual(base);
    expect(applyVoiceOverride(base, undefined)).toEqual(base);
  });

  it("enabled → overrides voice (edge-tts)", () => {
    const v = applyVoiceOverride(base, { enabled: true, voice: "zh-CN-YunjianNeural" });
    expect(v.voice).toBe("zh-CN-YunjianNeural");
    expect(v.pitch).toBe(base.pitch);
  });

  it("enabled with all fields preserves profile provider", () => {
    const v = applyVoiceOverride(base, { enabled: true, voice: "V", pitch: "-1Hz", rate: "+9%" });
    expect(v).toEqual({ provider: base.provider, voice: "V", pitch: "-1Hz", rate: "+9%" });
  });

  it("enabled but gpt-sovits provider → skip override, return manifest", () => {
    const v = applyVoiceOverride(base, { enabled: true, voice: "X", pitch: "+0Hz", rate: "+0%" }, "gpt-sovits");
    expect(v).toEqual(base);
  });

  it("enabled but cosyvoice provider → skip override, return manifest", () => {
    const v = applyVoiceOverride(base, { enabled: true, voice: "X" }, "cosyvoice");
    expect(v).toEqual(base);
  });

  it("enabled with edge-tts provider → override applies", () => {
    const v = applyVoiceOverride(base, { enabled: true, voice: "Y" }, "edge-tts");
    expect(v.voice).toBe("Y");
  });

  it("no ttsProvider arg → override applies (backwards compat)", () => {
    const v = applyVoiceOverride(base, { enabled: true, voice: "Z" });
    expect(v.voice).toBe("Z");
  });
});
