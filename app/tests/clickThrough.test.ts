import { describe, it, expect, vi } from "vitest";
import { createClickThroughController } from "../src/window/clickThrough";

function makeClock() {
  let t = 0;
  const timers: Array<{ at: number; fn: () => void }> = [];
  return {
    now: () => t,
    schedule: (fn: () => void, ms: number) => timers.push({ at: t + ms, fn }),
    advance(ms: number) {
      t += ms;
      for (const timer of [...timers]) {
        if (timer.at <= t) {
          timers.splice(timers.indexOf(timer), 1);
          timer.fn();
        }
      }
    },
  };
}

const inBox = (x: number) => x >= 0 && x <= 100;

describe("clickThrough controller", () => {
  it("F-05 rapid flips within throttle window send at most 2 IPC calls, final state correct", () => {
    const clock = makeClock();
    const setter = vi.fn();
    const ctl = createClickThroughController((x) => inBox(x), setter, 60, clock.now, clock.schedule);

    ctl.onPointerMove(50, 0); // hit → immediate send(clickThrough=false)
    ctl.onPointerMove(200, 0); // miss within window → pending
    ctl.onPointerMove(50, 0); // hit again → pending overwritten
    ctl.onPointerMove(200, 0); // miss → pending overwritten
    expect(setter).toHaveBeenCalledTimes(1);
    expect(setter).toHaveBeenNthCalledWith(1, false);

    clock.advance(60); // trailing flush
    expect(setter).toHaveBeenCalledTimes(2);
    expect(setter).toHaveBeenNthCalledWith(2, true); // final = miss → click-through on
  });

  it("F-06 no IPC call when hit state unchanged", () => {
    const clock = makeClock();
    const setter = vi.fn();
    const ctl = createClickThroughController((x) => inBox(x), setter, 60, clock.now, clock.schedule);

    ctl.onPointerMove(10, 0);
    clock.advance(100);
    ctl.onPointerMove(20, 0);
    ctl.onPointerMove(30, 0);
    expect(setter).toHaveBeenCalledTimes(1); // 仅首次进入触发
  });

  it("sends immediately when outside throttle window", () => {
    const clock = makeClock();
    const setter = vi.fn();
    const ctl = createClickThroughController((x) => inBox(x), setter, 60, clock.now, clock.schedule);

    ctl.onPointerMove(50, 0);
    clock.advance(61);
    ctl.onPointerMove(200, 0);
    expect(setter).toHaveBeenCalledTimes(2);
    expect(setter).toHaveBeenLastCalledWith(true);
  });
});
