import { describe, it, expect } from "vitest";
import { parseManifest, validatePackage, type CharacterManifest } from "../src/character/manifest";
import { resolveVoice, DEFAULT_VOICES } from "../src/character/voice";
import { createCharacterStore, type CharacterFs } from "../src/character/store";

const VALID_YAML = `
schema_version: 1
id: march7
display_name: "三月七"
model_entry: model/march7.model3.json
gender_presentation: female
voice:
  provider: edge-tts
  voice: zh-CN-XiaoyiNeural
  pitch: "+2Hz"
  rate: "+3%"
motion_map:
  idle: [idle_01, idle_02]
  alert: flick
sounds:
  listen_start: sounds/listen.wav
`;

describe("parseManifest", () => {
  it("P-01 valid manifest parses", () => {
    const r = parseManifest(VALID_YAML);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.id).toBe("march7");
      expect(r.manifest.display_name).toBe("三月七");
      expect(r.manifest.motion_map?.idle).toEqual(["idle_01", "idle_02"]);
    }
  });

  it("P-02 missing id / model_entry reports each", () => {
    const r = parseManifest("schema_version: 1\ndisplay_name: x");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join()).toContain("id");
      expect(r.errors.join()).toContain("model_entry");
    }
  });

  it("P-03 unsupported schema_version", () => {
    const r = parseManifest(VALID_YAML.replace("schema_version: 1", "schema_version: 2"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain("schema_version");
  });

  it("P-04 unknown field → warning only", () => {
    const r = parseManifest(VALID_YAML + "\nfancy_extra: true");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.join()).toContain("fancy_extra");
  });

  it("P-05 invalid yaml does not throw", () => {
    const r = parseManifest("{{{:::not yaml");
    expect(r.ok).toBe(false);
  });

  it("P-06 motion_map mixed string/array ok, invalid value rejected", () => {
    const bad = parseManifest(VALID_YAML + "\nmotion_map2: 1");
    expect(bad.ok).toBe(true); // motion_map2 是未知字段 → warning
    const invalid = parseManifest(
      "schema_version: 1\nid: a\ndisplay_name: b\nmodel_entry: m.json\nmotion_map:\n  idle: 42",
    );
    expect(invalid.ok).toBe(false);
  });

  it("P-07 empty input", () => {
    expect(parseManifest("").ok).toBe(false);
    expect(parseManifest("   ").ok).toBe(false);
  });
});

describe("validatePackage", () => {
  const manifest = (parseManifest(VALID_YAML) as { manifest: CharacterManifest }).manifest;

  it("V-01 all files present", () => {
    const v = validatePackage(manifest, [
      "model/march7.model3.json",
      "sounds/listen.wav",
    ]);
    expect(v.missing).toEqual([]);
    expect(v.warnings).toEqual([]);
  });

  it("V-02 missing model_entry", () => {
    const v = validatePackage(manifest, ["sounds/listen.wav"]);
    expect(v.missing).toContain("model/march7.model3.json");
  });

  it("V-03 missing sound → warning not missing", () => {
    const v = validatePackage(manifest, ["model/march7.model3.json"]);
    expect(v.missing).toEqual([]);
    expect(v.warnings.join()).toContain("listen_start");
  });
});

describe("resolveVoice", () => {
  it("W-01 explicit voice kept", () => {
    const v = resolveVoice({
      voice: { provider: "edge-tts", voice: "zh-CN-Test", pitch: "+1Hz", rate: "+1%" },
    });
    expect(v).toEqual({ provider: "edge-tts", voice: "zh-CN-Test", pitch: "+1Hz", rate: "+1%" });
  });

  it("W-02 female fallback = 三月七声线", () => {
    expect(resolveVoice({ gender_presentation: "female" })).toEqual(DEFAULT_VOICES.female);
    expect(DEFAULT_VOICES.female.voice).toBe("zh-CN-XiaoyiNeural");
  });

  it("W-03 male fallback = 丹恒声线", () => {
    expect(resolveVoice({ gender_presentation: "male" })).toEqual(DEFAULT_VOICES.male);
    expect(DEFAULT_VOICES.male.voice).toBe("zh-CN-YunxiNeural");
  });

  it("W-04 no gender → female default", () => {
    expect(resolveVoice({})).toEqual(DEFAULT_VOICES.female);
  });

  it("W-05 invalid provider → system, voice kept", () => {
    const v = resolveVoice({ voice: { provider: "evil", voice: "X" } });
    expect(v.provider).toBe("system");
    expect(v.voice).toBe("X");
  });
});

describe("character store", () => {
  function memFs(packages: Record<string, string | null>): CharacterFs {
    return {
      listDirs: async () => Object.keys(packages),
      readManifest: async (d) => packages[d],
      baseUrl: (d) => `/characters/${d}`,
    };
  }

  it("S-01 lists two valid packages", async () => {
    const other = VALID_YAML.replace("march7", "danheng").replace("三月七", "丹恒");
    const store = createCharacterStore(memFs({ a: VALID_YAML, b: other }));
    const list = await store.refresh();
    expect(list.map((c) => c.displayName).sort()).toEqual(["丹恒", "三月七"].sort());
  });

  it("S-02 broken package skipped with warning", async () => {
    const store = createCharacterStore(memFs({ good: VALID_YAML, bad: "{{{", empty: null }));
    const list = await store.refresh();
    expect(list).toHaveLength(1);
    expect(store.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it("S-03 activate unknown id rejects, state unchanged", async () => {
    const store = createCharacterStore(memFs({ a: VALID_YAML }));
    await store.refresh();
    await expect(store.activate("nope")).rejects.toThrow("未知角色");
    expect(store.getActive()).toBeNull();
  });

  it("I-02 activate emits voice binding", async () => {
    const store = createCharacterStore(memFs({ a: VALID_YAML }));
    await store.refresh();
    let got: unknown = null;
    store.onChanged((e) => (got = e));
    await store.activate("march7");
    expect(got).toMatchObject({ id: "march7", voice: { voice: "zh-CN-XiaoyiNeural" } });
  });
});
