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
  /** Base width multiplier vs slider. */
  widthMul: number;
  /** Width noise / grain (pencil). */
  noise: number;
  /** Soft edge blur 0–1 (airbrush). */
  blur: number;
  /** Flatter / more constant width (marker). */
  flat: number;
}[] = [
  {
    id: "pen",
    label: "鋼筆",
    icon: "edit",
    velocity: 0.42,
    pressure: 0.62,
    taper: 0.55,
    soft: 1,
    widthMul: 1,
    noise: 0,
    blur: 0,
    flat: 0,
  },
  {
    id: "fountain",
    label: "鋼筆尖",
    icon: "ink_pen",
    velocity: 0.92,
    pressure: 1,
    taper: 0.98,
    soft: 1,
    widthMul: 0.92,
    noise: 0,
    blur: 0,
    flat: 0,
  },
  {
    id: "pencil",
    label: "鉛筆",
    icon: "stylus_note",
    velocity: 0.58,
    pressure: 0.28,
    taper: 0.42,
    soft: 0.68,
    widthMul: 0.88,
    noise: 0.72,
    blur: 0,
    flat: 0.1,
  },
  {
    id: "marker",
    label: "馬克筆",
    icon: "ink_highlighter",
    velocity: 0.06,
    pressure: 0.12,
    taper: 0.06,
    soft: 0.52,
    widthMul: 2.05,
    noise: 0,
    blur: 0,
    flat: 0.85,
  },
  {
    id: "airbrush",
    label: "噴槍",
    icon: "blur_on",
    velocity: 0.18,
    pressure: 0.75,
    taper: 0.22,
    soft: 0.26,
    widthMul: 2.35,
    noise: 0.2,
    blur: 0.78,
    flat: 0.15,
  },
];

export function brushDef(id: BrushId | undefined) {
  return BRUSH_DEFS.find((b) => b.id === id) || BRUSH_DEFS[0];
}

/** Deterministic -1..1 noise from index (stable across frames). */
function hashNoise(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/** Moving-average pass — makes low/mid smooth amounts already feel softer. */
function movingAveragePoints(points: Point[], radius: number): Point[] {
  if (points.length < 3 || radius < 1) return points;
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const lo = Math.max(0, i - radius);
    const hi = Math.min(points.length - 1, i + radius);
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let j = lo; j <= hi; j++) {
      sx += points[j].x;
      sy += points[j].y;
      n++;
    }
    out.push({ x: sx / n, y: sy / n });
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Chaikin-ish iterative smooth; amount 0–100 — clearly graded across the range. */
export function smoothPoints(points: Point[], amount: number): Point[] {
  if (points.length < 3 || amount <= 0) return points;
  const t = Math.max(0, Math.min(100, amount)) / 100;
  // 0 → almost raw; 100 → heavy MA + many Chaikin passes
  const maRadius = Math.round(1 + t * 5);
  let pts = t > 0.02 ? movingAveragePoints(points, maRadius) : points;

  const passes = Math.max(1, Math.min(8, Math.round(1 + t * 7)));
  const mix = Math.min(0.5, 0.22 + t * 0.28);
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
    if (next.length > pts.length * 1.55) {
      const slim: Point[] = [next[0]];
      for (let i = 1; i < next.length - 1; i += 2) slim.push(next[i]);
      slim.push(next[next.length - 1]);
      pts = slim;
    } else {
      pts = next;
    }
  }
  // Extra endpoint-preserving MA at high smooth so corners really melt
  if (t > 0.55) {
    pts = movingAveragePoints(pts, Math.round(1 + (t - 0.55) * 6));
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
  // Non-linear pressure: fountain nearly vanishes when light, marker barely changes
  const pCurve = Math.pow(Math.min(1, Math.max(0.02, p)), 0.55 + def.pressure * 0.35);
  const pressureMul =
    1 - def.pressure * 0.82 + def.pressure * pCurve * (1.15 + def.pressure * 0.55);
  // Flat brushes damp velocity / pressure swings
  const flatDamp = 1 - def.flat * 0.85;
  // speed in world-px / ms — higher → thinner (more sensitive than before)
  const speedNorm = Math.min(1, opts.speed / 1.25);
  const velocityMul = 1 - def.velocity * flatDamp * Math.pow(speedNorm, 0.75) * 0.92;
  const pressAdj = 1 + (pressureMul - 1) * flatDamp;
  const w = opts.baseWidth * def.widthMul * pressAdj * velocityMul;
  const maxW = opts.baseWidth * def.widthMul * (2.2 + def.pressure * 0.9);
  return Math.max(0.35, Math.min(maxW, w));
}

/** Apply start/end taper to a width series. */
export function applyTaper(widths: number[], brush: BrushId): number[] {
  const def = brushDef(brush);
  const taper = def.taper * (1 - def.flat * 0.9);
  if (widths.length < 3 || taper <= 0) return widths;
  const n = widths.length;
  // Fountain: long sharp tips; marker: almost none
  const tip = Math.max(2, Math.floor(n * (0.08 + taper * 0.28)));
  const tipFloor = 0.04 + (1 - taper) * 0.2;
  return widths.map((w, i) => {
    let mul = 1;
    if (i < tip) mul = tipFloor + (1 - tipFloor) * (i / tip);
    else if (i >= n - tip) mul = tipFloor + (1 - tipFloor) * ((n - 1 - i) / tip);
    return Math.max(0.25, w * (1 - taper * (1 - mul)));
  });
}

/** Filled ribbon for variable-width ink. */
export function ribbonPath(points: Point[], widths: number[], flat = 0): string {
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
    // Marker: slightly square off by blending normal with a fixed chisel bias
    const chisel = flat * 0.35;
    const bx = nx * (1 - chisel) + (-0.35) * chisel;
    const by = ny * (1 - chisel) + 0.92 * chisel;
    const bLen = Math.hypot(bx, by) || 1;
    const half = (widths[i] ?? widths[widths.length - 1] ?? 2) / 2;
    left.push({ x: points[i].x + (bx / bLen) * half, y: points[i].y + (by / bLen) * half });
    right.push({ x: points[i].x - (bx / bLen) * half, y: points[i].y - (by / bLen) * half });
  }
  let d = `M ${left[0].x} ${left[0].y}`;
  for (let i = 1; i < left.length; i++) d += ` L ${left[i].x} ${left[i].y}`;
  for (let i = right.length - 1; i >= 0; i--) d += ` L ${right[i].x} ${right[i].y}`;
  d += " Z";
  return d;
}

function resampleWidths(widths: number[], count: number): number[] {
  if (widths.length === count) return widths;
  if (count <= 1) return [widths[0] ?? 2];
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    const idx = t * (widths.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(widths.length - 1, lo + 1);
    const f = idx - lo;
    return widths[lo] * (1 - f) + widths[hi] * f;
  });
}

export type StrokeRenderProps = {
  d: string;
  filled: boolean;
  strokeWidth: number;
  /** Optional SVG filter id (without url()). */
  filterId?: string;
  /** Extra class for brush look. */
  brushClass?: string;
};

export function strokeRenderProps(
  stroke: CanvasStroke,
  liveSmooth = 0,
  opts?: { applyTaperLive?: boolean }
): StrokeRenderProps {
  const def = brushDef(stroke.brush);
  const smooth = typeof stroke.smooth === "number" ? stroke.smooth : liveSmooth;
  let pts = smooth > 0 ? smoothPoints(stroke.points, smooth) : stroke.points;
  let widths = stroke.widths;

  if (opts?.applyTaperLive && widths && widths.length >= 2) {
    widths = applyTaper(widths, stroke.brush || "pen");
  }

  if (def.noise > 0 && pts.length >= 2) {
    const amp = def.noise * Math.max(0.6, stroke.width * 0.22);
    pts = pts.map((p, i) => ({
      x: p.x + hashNoise(i, 1) * amp * 0.55,
      y: p.y + hashNoise(i, 2) * amp * 0.55,
    }));
  }

  if (widths && widths.length >= 2 && pts.length >= 2) {
    let w = resampleWidths(widths, pts.length);
    if (def.noise > 0) {
      w = w.map((ww, i) =>
        Math.max(0.3, ww * (1 + hashNoise(i, 3) * def.noise * 0.32))
      );
    }
    // Flat marker: lift thin samples toward median so stroke stays chunky
    if (def.flat > 0.4) {
      const mid = w.reduce((a, b) => a + b, 0) / w.length;
      w = w.map((ww) => ww * (1 - def.flat * 0.55) + mid * def.flat * 0.55);
    }
    return {
      d: ribbonPath(pts, w, def.flat),
      filled: true,
      strokeWidth: 0,
      filterId: def.blur > 0.05 ? "cv-ink-airbrush" : def.noise > 0.4 ? "cv-ink-pencil" : undefined,
      brushClass: `cv-ink--${def.id}`,
    };
  }
  return {
    d: strokeToPath(pts, 0),
    filled: false,
    strokeWidth: stroke.width * def.widthMul,
    filterId: def.blur > 0.05 ? "cv-ink-airbrush" : undefined,
    brushClass: `cv-ink--${def.id}`,
  };
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
