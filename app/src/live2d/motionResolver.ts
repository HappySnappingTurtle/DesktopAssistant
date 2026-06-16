/**
 * 行为名 → 模型动作/表情解析与降级链（纯逻辑，与渲染解耦）。
 * 降级链：motionMap 映射 → 模型同名组 → idle → null（静止）。
 */
export interface ResolveResult {
  group: string | null;
  degraded: boolean;
}

export function resolveMotion(
  behavior: string,
  motionMap: Record<string, string | string[]> | undefined,
  availableGroups: string[],
  random: () => number = Math.random,
): ResolveResult {
  const available = new Set(availableGroups);
  const mapped = motionMap?.[behavior];

  if (mapped !== undefined) {
    const candidates = (Array.isArray(mapped) ? mapped : [mapped]).filter((g) =>
      available.has(g),
    );
    if (candidates.length > 0) {
      const pick = candidates[Math.floor(random() * candidates.length)];
      return { group: pick, degraded: false };
    }
  }

  if (available.has(behavior)) {
    return { group: behavior, degraded: mapped !== undefined };
  }

  const idleNames = ["idle", "Idle"];
  for (const idle of idleNames) {
    if (available.has(idle)) return { group: idle, degraded: true };
  }

  return { group: null, degraded: true };
}

export function resolveExpression(
  name: string,
  expressionMap: Record<string, string> | undefined,
  availableExpressions: string[],
): string | null {
  const available = new Set(availableExpressions);
  const mapped = expressionMap?.[name];
  if (mapped && available.has(mapped)) return mapped;
  if (available.has(name)) return name;
  return null;
}

export function clampMouthOpen(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(1, Math.max(0, v));
}
