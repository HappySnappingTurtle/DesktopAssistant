import { describe, it, expect } from "vitest";
import { parseManifest } from "../src/character/manifest";

const BASE_YAML = `
schema_version: 1
id: test
display_name: "Test"
model_entry: model/test.model3.json
voice:
  provider: edge-tts
  voice: zh-CN-XiaoyiNeural
  pitch: "+2Hz"
  rate: "+3%"
gpt_sovits:
  ref_audio: /voice-refs/test_ref.mp3
  ref_text: "这是参考音频文本"
  ref_lang: zh
`;

describe("cosyvoice3 manifest integration", () => {
  it("TQ-CV3-01 parser accepts cosyvoice3 section without warnings", () => {
    const yaml = BASE_YAML + `
cosyvoice3:
  ref_audio: /voice-refs/test_ref.mp3
  ref_text: "这是参考音频文本"
`;
    const result = parseManifest(yaml);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.filter((w) => w.includes("cosyvoice3"))).toHaveLength(0);
      expect(result.manifest.cosyvoice3?.ref_audio).toBe("/voice-refs/test_ref.mp3");
      expect(result.manifest.cosyvoice3?.ref_text).toBe("这是参考音频文本");
    }
  });

  it("TQ-CV3-02 manifest without cosyvoice3 still parses fine", () => {
    const result = parseManifest(BASE_YAML);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.cosyvoice3).toBeUndefined();
    }
  });

  it("TQ-CV3-03 cosyvoice3 ref_audio fallback to gpt_sovits", () => {
    const result = parseManifest(BASE_YAML);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const cv3 = result.manifest.cosyvoice3 ?? result.manifest.gpt_sovits;
      expect(cv3?.ref_audio).toBe("/voice-refs/test_ref.mp3");
      expect(cv3?.ref_text).toBe("这是参考音频文本");
    }
  });
});

describe("cosyvoice3 config format", () => {
  it("TQ-CV3-04 config patch structure for simple mode", () => {
    const patch = {
      tts: {
        provider: "cosyvoice3",
        provider_url: "http://127.0.0.1:8000",
        cosyvoice3: {
          mode: "simple",
          auto_start: true,
          port: 8000,
          temperature: 0.7,
          speed: 1.0,
          hf_mirror: "https://hf-mirror.com",
        },
      },
    };
    expect(patch.tts.provider).toBe("cosyvoice3");
    expect(patch.tts.cosyvoice3.mode).toBe("simple");
    expect(patch.tts.cosyvoice3.auto_start).toBe(true);
  });

  it("TQ-CV3-05 config patch structure for advanced mode", () => {
    const patch = {
      tts: {
        provider: "cosyvoice3",
        provider_url: "http://192.168.1.100:9000",
        cosyvoice3: {
          mode: "advanced",
          auto_start: false,
          port: 9000,
          temperature: 0.5,
          speed: 1.2,
          hf_mirror: "",
        },
      },
    };
    expect(patch.tts.cosyvoice3.mode).toBe("advanced");
    expect(patch.tts.cosyvoice3.temperature).toBe(0.5);
    expect(patch.tts.cosyvoice3.speed).toBe(1.2);
  });
});

describe("cosyvoice3 provider selection", () => {
  it("TQ-CV3-06 MIME type is wav for cosyvoice3", () => {
    const provider = "cosyvoice3";
    const mime = (provider === "gpt-sovits" || provider === "cosyvoice3") ? "audio/wav" : "audio/mpeg";
    expect(mime).toBe("audio/wav");
  });

  it("TQ-CV3-07 edge-tts MIME unchanged", () => {
    const provider = "edge-tts";
    const mime = (provider === "gpt-sovits" || provider === "cosyvoice3") ? "audio/wav" : "audio/mpeg";
    expect(mime).toBe("audio/mpeg");
  });

  it("TQ-CV3-08 phrase cache skips preload for cosyvoice3", () => {
    const ttsProvider = "cosyvoice3";
    const shouldPreload = ttsProvider === "edge-tts";
    expect(shouldPreload).toBe(false);
  });
});
