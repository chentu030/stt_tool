/** Concepts-like brush helpers: smooth, variable width, ribbon path, erase. */

import type { BrushId, CanvasStroke, Point } from "@/lib/canvasStore";

export const BRUSH_DEFS: {
  id: BrushId;
  label: string;
  icon: string;
  /** How strongly speed thins the stroke (0–1). */
  velocity: number;
  /** How strongly pointer pressure thickens (0–1). */
  pressure: number;
  /** End taper strength (0–1). */
  taper: number;
  /** Soft look: lower default opacity multiplier. */
  soft: number;
}[] = [
  { id: "pen", label: "鋼筆", icon: "edit", velocity: 0.35, pressure: 0.55, taper: 0.45, soft: 1 },
  { id: "fountain", label: "鋼筆尖", icon: "ink_pen", velocity: 0.55, pressure: 0.85, taper: 0.7, soft: 1 },
  { id: "pencil", label: "鉛筆", icon: "stylus_note", velocity: 0.4, pressure: 0.35, taper: 0.35, soft: 0.88 },
  { id: "marker", label: "馬克筆", icon: "ink_highlighter", velocity: 0.12, pressure: 0.2, taper: 0.15, soft: 0.72 },
  { id: "airbrush", label: "噴槍", icon: "blur_on", velocity: 0.2, pressure: 0.5, taper: 0.25, soft: 0.45 },
];

export function brushDef(id: BrushId | undefined) {
  return BRUSH_DEFS.find((b) => b.id === id) || BRUSH_DEFS[0];
}

/** Chaikin-ish iterative smooth; amount 0–100. */
export function smoothPoints(points: Point[], amount: number): Point[] {
  if (points.length < 3 || amount <= 0) return points;
  const passes = Math.max(1, Math.min(4, Math.round(amount / 28)));
  const mix = Math.min(0.42, 0.12 + amount / 280);
  let pts = points;
  for (let p = 0; p < passes; p++) {
    if (pts.length < 3) break;
    const next: Point[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      next.push({
        x: a.x * (1 - mix) + b.x * mix,
        y: a.y * (1 - mix) + b.y * mix,
      });
      next.push({
        x: a.x * mix + b.x * (1 - mix),
        y: a.y * mix + b.y * (1 - mix),
      });
    }
    next.push(pts[pts.length - 1]);
    // Decimate slightly so passes don't explode point count
    if (next.length > pts.length * 1.6) {
      const slim: Point[] = [next[0]];
      for (let i = 1; i < next.length - 1; i += 2) slim.push(next[i]);
      slim.push(next[next.length - 1]);
      pts = slim;
    } else {
      pts = next;
    }
  }
  return pts;
}

/** Mid-point quadratic path with optional pre-smooth. */
export function strokeToPath(points: Point[], smooth = 0): string {
  const pts = smooth > 0 ? smoothPoints(points, smooth) : points;
  if (!pts.length) return "";
  if (pts.length === 1) {
    const p = pts[0];
    return `M ${p.x} ${p.y} L ${p.x + 0.01} ${p.y}`;
  }
  if (pts.length === 2) {
    return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  }
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q ${pts[i].x} ${pts[i].y} ${mx} ${my}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

export function sampleWidth(opts: {
  brush: BrushId;
  baseWidth: number;
  pressure: number;
  speed: number;
}): number {
  const def = brushDef(opts.brush);
  const p = Number.isFinite(opts.pressure) && opts.pressure > 0 ? opts.pressure : 0.5;
  const pressureMul = 1 - def.pressure * 0.55 + def.pressure * p;
  // speed in world-px / ms — higher → thinner
  const speedNorm = Math.min(1, opts.speed / 1.8);
  const velocityMul = 1 - def.velocity * speedNorm * 0.65;
  const w = opts.baseWidth * pressureMul * velocityMul;
  return Math.max(0.4, Math.min(opts.baseWidth * 2.4, w));
}

/** Apply start/end taper to a width series. */
export function applyTaper(widths: number[], brush: BrushId): number[] {
  const def = brushDef(brush);
  if (widths.length < 3 || def.taper <= 0) return widths;
  const n = widths.length;
  const tip = Math.max(2, Math.floor(n * 0.12 * def.taper * 2));
  return widths.map((w, i) => {
    let mul = 1;
    if (i < tip) mul = 0.15 + 0.85 * (i / tip);
    else if (i >= n - tip) mul = 0.15 + 0.85 * ((n - 1 - i) / tip);
    return Math.max(0.35, w * (1 - def.taper * (1 - mul)));
  });
}

/** Filled ribbon for variable-width ink. */
export function ribbonPath(points: Point[], widths: number[]): string {
  if (points.length < 2) return strokeToPath(points);
  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[i - 1] || points[i];
    const next = points[i + 1] || points[i];
    let dx = next.x - prev.x;
    let dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const nx = -dy;
    const ny = dx;
    const half = (widths[i] ?? widths[widths.length - 1] ?? 2) / 2;
    left.push({ x: points[i].x + nx * half, y: points[i].y + ny * half });
    right.push({ x: points[i].x - nx * half, y: points[i].y - ny * half });
  }
  let d = `M ${left[0].x} ${left[0].y}`;
  for (let i = 1; i < left.length; i++) d += ` L ${left[i].x} ${left[i].y}`;
  for (let i = right.length - 1; i >= 0; i--) d += ` L ${right[i].x} ${right[i].y}`;
  d += " Z";
  return d;
}

export function strokeRenderProps(
  stroke: CanvasStroke,
  liveSmooth = 0
): { d: string; filled: boolean; strokeWidth: number } {
  const smooth = typeof stroke.smooth === "number" ? stroke.smooth : liveSmooth;
  const pts = smooth > 0 ? smoothPoints(stroke.points, smooth) : stroke.points;
  const widths = stroke.widths;
  if (widths && widths.length >= 2 && pts.length >= 2) {
    // Align widths to smoothed point count if needed
    let w = widths;
    if (w.length !== pts.length) {
      w = pts.map((_, i) => {
        const t = pts.length === 1 ? 0 : i / (pts.length - 1);
        const idx = t * (widths.length - 1);
        const lo = Math.floor(idx);
        const hi = Math.min(widths.length - 1, lo + 1);
        const f = idx - lo;
        return widths[lo] * (1 - f) + widths[hi] * f;
      });
    }
    return { d: ribbonPath(pts, w), filled: true, strokeWidth: 0 };
  }
  return { d: strokeToPath(pts, 0), filled: false, strokeWidth: stroke.width };
}

/** Delete strokes that intersect an eraser circle. */
export function eraseStrokesAt(
  strokes: CanvasStroke[],
  world: Point,
  radius: number
): CanvasStroke[] {
  const r = Math.max(2, radius);
  return strokes.filter((sk) => {
    // Reuse simple point-segment distance with pad = radius
    const pad = r;
    const pts = sk.points;
    if (!pts.length) return false;
    if (pts.length === 1) {
      const dx = pts[0].x - world.x;
      const dy = pts[0].y - world.y;
      return dx * dx + dy * dy > (sk.width / 2 + pad) ** 2;
    }
    const thresh = sk.width / 2 + pad;
    const thresh2 = thresh * thresh;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const len2 = abx * abx + aby * aby;
      let t = len2 < 1e-6 ? 0 : ((world.x - a.x) * abx + (world.y - a.y) * aby) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + abx * t - world.x;
      const py = a.y + aby * t - world.y;
      if (px * px + py * py <= thresh2) return false;
    }
    // Also check variable widths roughly
    if (sk.widths?.length) {
      for (let i = 0; i < pts.length; i++) {
        const half = (sk.widths[i] ?? sk.width) / 2 + pad;
        const dx = pts[i].x - world.x;
        const dy = pts[i].y - world.y;
        if (dx * dx + dy * dy <= half * half) return false;
      }
    }
    return true;
  });
}

export function pushRecentColor(recent: string[], hex: string, max = 8): string[] {
  const h = hex.toLowerCase();
  return [h, ...recent.filter((c) => c.toLowerCase() !== h)].slice(0, max);
}
