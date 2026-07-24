/** Note cover focal point + zoom helpers. */

export type CoverPosition = { x: number; y: number };

export const DEFAULT_COVER_POSITION: CoverPosition = { x: 50, y: 50 };
export const DEFAULT_COVER_ZOOM = 1;
export const MIN_COVER_ZOOM = 1;
export const MAX_COVER_ZOOM = 3;

export function clampCoverCoord(n: number): number {
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(0, n));
}

export function normalizeCoverPosition(raw: unknown): CoverPosition {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_COVER_POSITION };
  const o = raw as Record<string, unknown>;
  return {
    x: clampCoverCoord(typeof o.x === "number" ? o.x : Number(o.x)),
    y: clampCoverCoord(typeof o.y === "number" ? o.y : Number(o.y)),
  };
}

export function clampCoverZoom(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_COVER_ZOOM;
  return Math.min(MAX_COVER_ZOOM, Math.max(MIN_COVER_ZOOM, Math.round(n * 100) / 100));
}

export function normalizeCoverZoom(raw: unknown): number {
  if (raw == null || raw === "") return DEFAULT_COVER_ZOOM;
  const n = typeof raw === "number" ? raw : Number(raw);
  return clampCoverZoom(n);
}

export function coverPositionsEqual(a: CoverPosition, b: CoverPosition): boolean {
  return a.x === b.x && a.y === b.y;
}
