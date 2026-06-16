/**
 * 拖拽/点击判别（参考桌宠惯例）：
 * 命中角色按下后，位移 ≥ 阈值 → onDragStart（原生窗口拖拽，只触发一次）；
 * 抬起且未拖拽 → onTap。
 */
export interface DragTapDeps {
  hitTest: (x: number, y: number) => boolean;
  onDragStart: () => void;
  onTap: (x: number, y: number) => void;
  threshold?: number;
}

export function createDragTapController(deps: DragTapDeps) {
  const threshold = deps.threshold ?? 4;
  let downAt: { x: number; y: number } | null = null;
  let dragging = false;

  return {
    onPointerDown(x: number, y: number, button = 0) {
      if (button !== 0) return;
      if (!deps.hitTest(x, y)) return;
      downAt = { x, y };
      dragging = false;
    },
    onPointerMove(x: number, y: number) {
      if (!downAt || dragging) return;
      const dx = x - downAt.x;
      const dy = y - downAt.y;
      if (dx * dx + dy * dy >= threshold * threshold) {
        dragging = true;
        deps.onDragStart();
      }
    },
    onPointerUp(x: number, y: number) {
      if (downAt && !dragging) deps.onTap(x, y);
      downAt = null;
      dragging = false;
    },
  };
}
