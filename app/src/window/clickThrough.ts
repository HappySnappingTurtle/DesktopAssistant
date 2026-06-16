/**
 * 命中检测 → 点穿切换。
 * 角色区域内：窗口接收鼠标事件（可拖拽/点击）；区域外：点穿到桌面。
 * 状态翻转才调用 IPC，且按 throttleMs 节流（拖尾触发，保证最终状态正确）。
 */
export type HitTester = (x: number, y: number) => boolean;
export type ClickThroughSetter = (enable: boolean) => Promise<void> | void;

export function createClickThroughController(
  hitTest: HitTester,
  setClickThrough: ClickThroughSetter,
  throttleMs = 60,
  now: () => number = () => performance.now(),
  schedule: (fn: () => void, ms: number) => unknown = setTimeout,
) {
  let lastHit: boolean | null = null;
  let lastSentAt = -Infinity;
  let pending: boolean | null = null;
  let timerArmed = false;

  function send(hit: boolean) {
    lastSentAt = now();
    void setClickThrough(!hit);
  }

  function flush() {
    timerArmed = false;
    if (pending !== null) {
      const v = pending;
      pending = null;
      send(v);
    }
  }

  return {
    onPointerMove(x: number, y: number) {
      const hit = hitTest(x, y);
      if (hit === lastHit) return;
      lastHit = hit;
      const elapsed = now() - lastSentAt;
      if (elapsed >= throttleMs) {
        send(hit);
      } else {
        pending = hit;
        if (!timerArmed) {
          timerArmed = true;
          schedule(flush, throttleMs - elapsed);
        }
      }
    },
  };
}
