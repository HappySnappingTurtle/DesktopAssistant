import * as PIXI from "pixi.js";
import { Live2DModel, MotionPriority } from "pixi-live2d-display-lipsyncpatch";
import {
  resolveMotion,
  resolveExpression,
  clampMouthOpen,
} from "./motionResolver";

export interface ModelDescriptor {
  source: string;
  motionMap?: Record<string, string | string[]>;
  expressionMap?: Record<string, string>;
  scale?: number;
  anchor?: { x: number; y: number };
}

export interface RendererHandle {
  playMotion(name: string): Promise<boolean>;
  setExpression(name: string): boolean;
  setMouthOpen(v: number): void;
  speak(audioUrl: string): Promise<void>;
  setScale(factor: number): void;
  /** 直接设置模型参数（情绪表演用，不存在的参数静默跳过） */
  setParameter(id: string, value: number): void;
  /** 屏幕坐标是否命中角色（用于点穿/点击判断） */
  hitTest(x: number, y: number): boolean;
  /** 返回命中的区域名："head" | "body" | null */
  hitArea(x: number, y: number): string | null;
  onTap(cb: (area: string) => void): void;
  destroy(): void;
}

export function listMotionGroups(model: {
  internalModel: { motionManager: { definitions: Record<string, unknown> } };
}): string[] {
  return Object.keys(model.internalModel.motionManager.definitions ?? {});
}

export function listExpressions(model: {
  internalModel: {
    motionManager: {
      expressionManager?: { definitions: Array<{ name?: string; Name?: string }> } | null;
    };
  };
}): string[] {
  const defs = model.internalModel.motionManager.expressionManager?.definitions ?? [];
  return defs
    .map((d) => d.name ?? d.Name ?? "")
    .filter((n): n is string => n.length > 0);
}

let sharedApp: PIXI.Application | null = null;

export async function createRenderer(
  canvas: HTMLCanvasElement,
  desc: ModelDescriptor,
): Promise<RendererHandle> {
  if (!sharedApp || sharedApp.view !== canvas) {
    sharedApp?.destroy(false);
    sharedApp = new PIXI.Application({
      view: canvas,
      backgroundAlpha: 0,
      resizeTo: canvas.parentElement ?? undefined,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });
  }
  const app = sharedApp;

  while (app.stage.children.length > 0) {
    app.stage.removeChildAt(0);
  }

  const model = await Live2DModel.from(desc.source, { autoInteract: false });
  const anchor = desc.anchor ?? { x: 0.5, y: 0.5 };
  model.anchor.set(anchor.x, anchor.y);
  const baseScale =
    desc.scale ??
    Math.min(
      (app.screen.width * 0.9) / model.internalModel.width,
      (app.screen.height * 0.9) / model.internalModel.height,
    );
  let currentScale = baseScale;
  model.scale.set(baseScale);
  const cx = app.screen.width / 2;
  const cy = app.screen.height / 2;
  model.position.set(cx, cy);
  app.stage.addChild(model as unknown as PIXI.DisplayObject);

  const motionGroups = listMotionGroups(model);
  const expressions = listExpressions(model);
  let destroyed = false;
  const tapCallbacks: Array<(area: string) => void> = [];

  console.log("[live2d] groups:", motionGroups, "expressions:", expressions);

  model.on("hit", (areas: string[]) => {
    for (const area of areas) for (const cb of tapCallbacks) cb(area);
  });

  /**
   * 通用碰撞检测：优先用模型 HitAreas，没有则用手动计算的屏幕包围盒。
   * 解决 HitAreas 为空的模型（如三月七）点击/右键全部失效的问题。
   */
  function getScreenBounds(): { left: number; top: number; right: number; bottom: number } {
    const w = model.internalModel.width * currentScale;
    const h = model.internalModel.height * currentScale;
    const px = model.position.x;
    const py = model.position.y;
    return {
      left: px - w * anchor.x,
      top: py - h * anchor.y,
      right: px + w * (1 - anchor.x),
      bottom: py + h * (1 - anchor.y),
    };
  }

  function boundsHit(x: number, y: number): boolean {
    const b = getScreenBounds();
    return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
  }

  return {
    async playMotion(name: string): Promise<boolean> {
      if (destroyed) return false;
      const { group, degraded } = resolveMotion(name, desc.motionMap, motionGroups);
      if (degraded) console.warn(`[live2d] motion "${name}" degraded → ${group}`);
      if (group === null) return false;
      try {
        await model.motion(group, undefined, MotionPriority.FORCE);
        return !degraded;
      } catch (e) {
        console.warn(`[live2d] motion "${group}" failed:`, e);
        return false;
      }
    },

    setExpression(name: string): boolean {
      if (destroyed) return false;
      const resolved = resolveExpression(name, desc.expressionMap, expressions);
      if (resolved === null) {
        console.warn(`[live2d] expression "${name}" unavailable`);
        return false;
      }
      void model.expression(resolved);
      return true;
    },

    setMouthOpen(v: number): void {
      if (destroyed) return;
      const core = model.internalModel.coreModel as {
        setParameterValueById?: (id: string, v: number) => void;
        setParamFloat?: (id: string, v: number) => void;
      };
      const value = clampMouthOpen(v);
      if (core.setParameterValueById) core.setParameterValueById("ParamMouthOpenY", value);
      else core.setParamFloat?.("PARAM_MOUTH_OPEN_Y", value);
    },

    setScale(factor: number): void {
      if (destroyed) return;
      currentScale = baseScale * factor;
      model.scale.set(currentScale);
    },

    setParameter(id: string, value: number): void {
      if (destroyed) return;
      try {
        const core = model.internalModel.coreModel as {
          setParameterValueById?: (id: string, v: number) => void;
          setParamFloat?: (id: string, v: number) => void;
        };
        if (core.setParameterValueById) core.setParameterValueById(id, value);
        else core.setParamFloat?.(id, value);
      } catch {
        // 参数不存在——静默跳过（不同模型参数集不同）
      }
    },

    speak(audioUrl: string): Promise<void> {
      if (destroyed) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const m = model as unknown as {
          speak: (
            url: string,
            opts: { onFinish?: () => void; onError?: (e: Error) => void },
          ) => void;
        };
        try {
          m.speak(audioUrl, { onFinish: resolve, onError: reject });
        } catch (e) {
          reject(e as Error);
        }
      });
    },

    hitTest(x: number, y: number): boolean {
      if (destroyed) return false;
      // 1. 模型自带 HitAreas（如 Hiyori 有 Head/Body）
      try {
        const hits = model.hitTest(x, y);
        if (hits.length > 0) return true;
      } catch {
        /* 无 hitAreas */
      }
      // 2. 手动包围盒降级（三月七等 HitAreas 为空的模型）
      return boundsHit(x, y);
    },

    hitArea(x: number, y: number): string | null {
      if (destroyed) return null;
      // 1. 精确区域（如 Hiyori 的 "Head" / "Body"）
      try {
        const hits = model.hitTest(x, y);
        if (hits.length > 0) return hits[0].toLowerCase();
      } catch {
        /* 无 hitAreas */
      }
      // 2. 无 HitAreas → 按屏幕位置推断：上 40% 为 head，下 60% 为 body
      if (!boundsHit(x, y)) return null;
      const b = getScreenBounds();
      const ratio = (y - b.top) / (b.bottom - b.top);
      return ratio < 0.4 ? "head" : "body";
    },

    onTap(cb: (area: string) => void): void {
      tapCallbacks.push(cb);
    },

    destroy(): void {
      destroyed = true;
      if (model.parent) model.parent.removeChild(model);
      model.destroy();
    },
  };
}
