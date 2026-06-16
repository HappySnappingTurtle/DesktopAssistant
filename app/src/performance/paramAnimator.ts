/** 参数过渡动画器——每帧 lerp 驱动模型参数，挂 PIXI.Ticker */

export interface ParamSetter {
  setParameter(id: string, value: number): void;
}

const TRANSITION_MS = 300;

export function createParamAnimator(setter: ParamSetter) {
  const current: Record<string, number> = {};
  const target: Record<string, number> = {};
  let transitionStart = 0;
  let transitioning = false;

  return {
    /** 设置新的目标参数组（触发过渡动画） */
    setTarget(params: Record<string, number>) {
      Object.assign(target, params);
      // 未出现在新 target 中的旧 target 回归 0
      for (const k of Object.keys(current)) {
        if (!(k in params)) target[k] = 0;
      }
      transitionStart = performance.now();
      transitioning = true;
    },

    /** 每帧调用（挂到 PIXI.Ticker 或 requestAnimationFrame） */
    tick() {
      if (!transitioning) return;
      const elapsed = performance.now() - transitionStart;
      const t = Math.min(1, elapsed / TRANSITION_MS);

      for (const [k, targetVal] of Object.entries(target)) {
        const from = current[k] ?? 0;
        const val = from + (targetVal - from) * t;
        current[k] = val;
        setter.setParameter(k, val);
      }

      if (t >= 1) {
        transitioning = false;
        // 清理回归 0 的参数
        for (const k of Object.keys(current)) {
          if (Math.abs(current[k]) < 0.01) {
            delete current[k];
            delete target[k];
          }
        }
      }
    },

    isTransitioning(): boolean { return transitioning; },
    getCurrentParams(): Readonly<Record<string, number>> { return { ...current }; },
  };
}

export type ParamAnimator = ReturnType<typeof createParamAnimator>;
