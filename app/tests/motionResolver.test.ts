import { describe, it, expect } from "vitest";
import {
  resolveMotion,
  resolveExpression,
  clampMouthOpen,
} from "../src/live2d/motionResolver";

const GROUPS = ["idle", "tap_body", "cheer", "flick_head"];

describe("resolveMotion", () => {
  it("M-01 mapped behavior with existing group", () => {
    expect(resolveMotion("alert", { alert: "tap_body" }, GROUPS)).toEqual({
      group: "tap_body",
      degraded: false,
    });
  });

  it("M-02 array mapping picks deterministically with seeded random", () => {
    const map = { idle_pool: ["cheer", "tap_body"] };
    expect(resolveMotion("idle_pool", map, GROUPS, () => 0).group).toBe("cheer");
    expect(resolveMotion("idle_pool", map, GROUPS, () => 0.99).group).toBe("tap_body");
  });

  it("M-02b array mapping filters out missing groups", () => {
    const map = { greet: ["nonexistent", "cheer"] };
    expect(resolveMotion("greet", map, GROUPS, () => 0).group).toBe("cheer");
  });

  it("M-03 unmapped behavior falls through to same-name group", () => {
    expect(resolveMotion("cheer", undefined, GROUPS)).toEqual({
      group: "cheer",
      degraded: false,
    });
  });

  it("M-04 missing target degrades to idle", () => {
    const r = resolveMotion("alert", { alert: "nonexistent" }, GROUPS);
    expect(r).toEqual({ group: "idle", degraded: true });
  });

  it("M-04b capital Idle also accepted", () => {
    const r = resolveMotion("alert", undefined, ["Idle", "x"]);
    expect(r).toEqual({ group: "Idle", degraded: true });
  });

  it("M-05 no idle at all → null, degraded", () => {
    expect(resolveMotion("alert", undefined, ["x"])).toEqual({
      group: null,
      degraded: true,
    });
  });

  it("M-07 empty map behaves like no map", () => {
    expect(resolveMotion("cheer", {}, GROUPS).group).toBe("cheer");
  });
});

describe("resolveExpression", () => {
  const EXPS = ["happy", "sad"];
  it("mapped expression resolves", () => {
    expect(resolveExpression("worried", { worried: "sad" }, EXPS)).toBe("sad");
  });
  it("same-name fallback", () => {
    expect(resolveExpression("happy", undefined, EXPS)).toBe("happy");
  });
  it("M-06 missing expression → null, no throw", () => {
    expect(resolveExpression("angry", { angry: "rage" }, EXPS)).toBeNull();
    expect(resolveExpression("nonexistent", undefined, EXPS)).toBeNull();
  });
});

describe("clampMouthOpen", () => {
  it("R-03 clamps out-of-range and NaN", () => {
    expect(clampMouthOpen(-0.5)).toBe(0);
    expect(clampMouthOpen(1.5)).toBe(1);
    expect(clampMouthOpen(0.42)).toBe(0.42);
    expect(clampMouthOpen(NaN)).toBe(0);
  });
});
