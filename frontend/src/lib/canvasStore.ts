import { hexToRgb, normalizeHexColor, rgbToHex } from "@/lib/colorPick";
import { isYoutubeUrl, resolveEmbedUrl } from "@/lib/embedUrls";

/** Spatial canvas document model + local persistence */

export type Point = { x: number; y: number };

export type StickyColor = "yellow" | "mint" | "sky" | "rose" | "violet" | "sand";

export type CanvasSticky = {
  id: string;
  kind: "sticky";
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  /** Preset id (StickyColor) or custom #rrggbb (fill for sticky; font for text variant) */
  color: string;
  /** Optional font color for sticky cards (preset/hex). */
  textColor?: string;
  /** Fill opacity 0–1 (default 1). */
  opacity?: number;
  z: number;
  /** Plain canvas text (no sticky chrome). */
  variant?: "sticky" | "text";
};

export type ShapeKind = "rect" | "ellipse" | "frame";

export type CanvasShape = {
  id: string;
  kind: "shape";
  shape: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  color: string;
  /** Stroke/fill opacity 0–1 (default 1). */
  opacity?: number;
  z: number;
};

export type CanvasEdge = {
  id: string;
  kind: "edge";
  from: string; // sticky | shape | note:{noteId} | media id
  to: string;
  /** Preferred attachment on the from/to box (8 compass ports). */
  fromPort?: EdgePort;
  toPort?: EdgePort;
  label?: string;
};

/** Eight ports around a node box (same positions as resize handles). */
export type EdgePort = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const EDGE_PORTS: EdgePort[] = ["nw", "n", "ne", "w", "e", "sw", "s", "se"];

export type NotePin = {
  noteId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Stacking order (optional for older docs). */
  z?: number;
};

/** Embedded / uploaded media on the canvas */
export type CanvasMediaKind =
  | "image"
  | "audio"
  | "video"
  | "youtube"
  | "pdf"
  | "ppt"
  | "file"
  | "link"
  | "web";

export type CanvasMediaTranscriptStatus =
  | "idle"
  | "queued"
  | "running"
  | "done"
  | "error";

export type CanvasMedia = {
  id: string;
  kind: "media";
  media: CanvasMediaKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Display / play / iframe URL */
  url: string;
  originalUrl?: string;
  title: string;
  mime?: string;
  storagePath?: string;
  /** false → show link card instead of iframe */
  frameable?: boolean;
  z: number;
  /** In-card transcript (YouTube / audio / video) */
  transcript?: string;
  transcriptStatus?: CanvasMediaTranscriptStatus;
  jobId?: string;
  transcriptError?: string;
  /** Scraped / unfurled body text for AI */
  extractedText?: string;
  /** Open Graph / preview image */
  previewImage?: string;
  /** Short description from unfurl */
  description?: string;
  /** How transcript was obtained: manual/auto CC or whisper */
  transcriptSource?: "manual" | "auto" | "whisper" | string;
  /** Live progress text while fetching CC / Whisper (shown on card) */
  transcriptProgress?: string;
};

/** Soft grouping region on the canvas (moves contained items with it). */
export type CanvasSection = {
  id: string;
  kind: "section";
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  color: string;
  opacity?: number;
  z: number;
};

/** Freehand ink stroke (world coordinates). */
export type BrushId = "pen" | "fountain" | "pencil" | "marker" | "airbrush";

export type CanvasStroke = {
  id: string;
  kind: "stroke";
  points: Point[];
  color: string;
  width: number;
  opacity?: number;
  /** Brush preset used when drawing. */
  brush?: BrushId;
  /** Per-point widths (pressure / velocity / taper). */
  widths?: number[];
  /** Smooth amount 0–100 baked at commit (optional). */
  smooth?: number;
  z: number;
};

export type CanvasDoc = {
  version: 2;
  name: string;
  pan: Point;
  scale: number;
  stickies: CanvasSticky[];
  shapes: CanvasShape[];
  edges: CanvasEdge[];
  notes: NotePin[];
  media: CanvasMedia[];
  sections: CanvasSection[];
  strokes: CanvasStroke[];
  grid: boolean;
  snap: boolean;
};

export type ToolId =
  | "select"
  | "pan"
  | "sticky"
  | "rect"
  | "ellipse"
  | "frame"
  | "connect"
  | "text"
  | "pen"
  | "eraser";

/** World-pixel defaults sized for ~100% zoom readability (avoid CSS upscale blur). */
export const MEDIA_DEFAULT_SIZE: Record<CanvasMediaKind, { w: number; h: number }> = {
  image: { w: 520, h: 360 },
  audio: { w: 360, h: 100 },
  video: { w: 560, h: 315 },
  youtube: { w: 560, h: 315 },
  pdf: { w: 480, h: 640 },
  ppt: { w: 560, h: 360 },
  file: { w: 300, h: 110 },
  link: { w: 380, h: 240 },
  web: { w: 560, h: 400 },
};

export const STICKY_COLORS: { id: StickyColor; label: string; bg: string; border: string }[] = [
  { id: "yellow", label: "黃", bg: "#FEF3C7", border: "#F59E0B" },
  { id: "mint", label: "薄荷", bg: "#CCFBF1", border: "#0D9488" },
  { id: "sky", label: "天空", bg: "#E0F2FE", border: "#0284C7" },
  { id: "rose", label: "玫瑰", bg: "#FFE4E6", border: "#E11D48" },
  { id: "violet", label: "紫", bg: "#EDE9FE", border: "#7C3AED" },
  { id: "sand", label: "沙", bg: "#F5F5F4", border: "#A8A29E" },
];

export const SHAPE_COLORS = ["#0D9488", "#0369A1", "#7C3AED", "#E11D48", "#CA8A04", "#64748B"];

/** Mix hex toward white for a pastel sticky fill. */
function lightenHex(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return rgbToHex(mix(r), mix(g), mix(b));
}

export function clampOpacity(n: number | undefined | null, fallback = 1): number {
  if (typeof n !== "number" || Number.isNaN(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

export function hexToRgba(hex: string, alpha: number): string {
  const n = normalizeHexColor(hex);
  if (!n) return `rgba(15,23,42,${clampOpacity(alpha)})`;
  const { r, g, b } = hexToRgb(n);
  return `rgba(${r},${g},${b},${clampOpacity(alpha)})`;
}

/** Resolve sticky display colors from preset id or custom hex. */
export function resolveStickyStyle(
  color: string,
  opacity = 1
): { bg: string; border: string } {
  const preset = STICKY_COLORS.find((c) => c.id === color);
  const a = clampOpacity(opacity);
  if (preset) {
    if (a >= 0.999) return { bg: preset.bg, border: preset.border };
    return { bg: hexToRgba(preset.bg, a), border: hexToRgba(preset.border, Math.min(1, a + 0.12)) };
  }
  const hex = normalizeHexColor(color);
  if (hex) {
    const bg = lightenHex(hex, 0.72);
    if (a >= 0.999) return { bg, border: hex };
    return { bg: hexToRgba(bg, a), border: hexToRgba(hex, Math.min(1, a + 0.12)) };
  }
  return { bg: STICKY_COLORS[0].bg, border: STICKY_COLORS[0].border };
}

/** Map toolbar color (preset or hex) → shape stroke/fill hex. */
export function colorToShapeHex(color: string): string {
  const preset = STICKY_COLORS.find((c) => c.id === color);
  if (preset) return preset.border;
  return normalizeHexColor(color) || SHAPE_COLORS[0];
}

export function isCanvasColorValue(color: string | undefined | null): color is string {
  if (!color) return false;
  if (STICKY_COLORS.some((c) => c.id === color)) return true;
  return !!normalizeHexColor(color);
}

const KEY_PREFIX = "cadence_canvas_v2_";

export function storageKey(uid: string) {
  return `${KEY_PREFIX}${uid}`;
}

export function emptyDoc(name = "主白板"): CanvasDoc {
  return {
    version: 2,
    name,
    pan: { x: 48, y: 48 },
    scale: 1,
    stickies: [],
    shapes: [],
    edges: [],
    notes: [],
    media: [],
    sections: [],
    strokes: [],
    grid: true,
    snap: true,
  };
}

export function loadDoc(uid: string): CanvasDoc {
  try {
    const raw = localStorage.getItem(storageKey(uid));
    if (!raw) {
      // migrate v1 positions if present
      const v1 = localStorage.getItem("cadence_canvas_positions_v1");
      const doc = emptyDoc();
      if (v1) {
        const map = JSON.parse(v1) as Record<string, Point>;
        doc.notes = Object.entries(map).map(([noteId, p]) => ({
          noteId,
          x: p.x,
          y: p.y,
          w: 280,
          h: 160,
        }));
      }
      return doc;
    }
    const parsed = JSON.parse(raw) as CanvasDoc;
    if (!parsed.version) return emptyDoc();
    return {
      ...emptyDoc(),
      ...parsed,
      version: 2,
      media: Array.isArray(parsed.media) ? parsed.media : [],
      sections: Array.isArray(parsed.sections) ? parsed.sections : [],
      strokes: Array.isArray((parsed as CanvasDoc).strokes) ? (parsed as CanvasDoc).strokes : [],
    };
  } catch {
    return emptyDoc();
  }
}

export function saveDoc(uid: string, doc: CanvasDoc) {
  localStorage.setItem(storageKey(uid), JSON.stringify(doc));
}

export function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function snapVal(n: number, grid = 22, enabled = true) {
  if (!enabled) return n;
  return Math.round(n / grid) * grid;
}

export function clampScale(s: number) {
  return Math.min(2.2, Math.max(0.35, s));
}

export type Selectable =
  | { type: "sticky"; id: string }
  | { type: "shape"; id: string }
  | { type: "note"; id: string }
  | { type: "edge"; id: string }
  | { type: "media"; id: string }
  | { type: "section"; id: string }
  | { type: "stroke"; id: string };

export function nodeBox(
  doc: CanvasDoc,
  ref: string
): { x: number; y: number; w: number; h: number } | null {
  if (ref.startsWith("note:")) {
    const noteId = ref.slice(5);
    const n = doc.notes.find((x) => x.noteId === noteId);
    return n ? { x: n.x, y: n.y, w: n.w, h: n.h } : null;
  }
  const sticky = doc.stickies.find((s) => s.id === ref);
  if (sticky) return { x: sticky.x, y: sticky.y, w: sticky.w, h: sticky.h };
  const shape = doc.shapes.find((s) => s.id === ref);
  if (shape) return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  const media = doc.media?.find((m) => m.id === ref);
  if (media) return { x: media.x, y: media.y, w: media.w, h: media.h };
  const section = doc.sections?.find((s) => s.id === ref);
  if (section) return { x: section.x, y: section.y, w: section.w, h: section.h };
  return null;
}

export function nodeCenter(
  doc: CanvasDoc,
  ref: string
): Point | null {
  const box = nodeBox(doc, ref);
  if (!box) return null;
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/** Border attachment point facing another point (so lines meet the card edge). */
export function nodeAnchor(doc: CanvasDoc, ref: string, toward: Point): Point | null {
  const box = nodeBox(doc, ref);
  if (!box) return null;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return { x: cx, y: cy };

  // Ray from center toward `toward` vs rectangle border.
  const hw = box.w / 2;
  const hh = box.h / 2;
  const sx = dx === 0 ? Infinity : hw / Math.abs(dx);
  const sy = dy === 0 ? Infinity : hh / Math.abs(dy);
  const t = Math.min(sx, sy);
  return { x: cx + dx * t, y: cy + dy * t };
}

/** Exact port position on a node (n/s/e/w + corners). */
export function nodePortPoint(doc: CanvasDoc, ref: string, port: EdgePort): Point | null {
  const box = nodeBox(doc, ref);
  if (!box) return null;
  const { x, y, w, h } = box;
  const mx = x + w / 2;
  const my = y + h / 2;
  switch (port) {
    case "n":
      return { x: mx, y };
    case "s":
      return { x: mx, y: y + h };
    case "w":
      return { x, y: my };
    case "e":
      return { x: x + w, y: my };
    case "nw":
      return { x, y };
    case "ne":
      return { x: x + w, y };
    case "sw":
      return { x, y: y + h };
    case "se":
      return { x: x + w, y: y + h };
  }
}

/** Closest of the 8 ports to a world point. */
export function nearestPort(doc: CanvasDoc, ref: string, point: Point): EdgePort {
  let best: EdgePort = "e";
  let bestD = Infinity;
  for (const p of EDGE_PORTS) {
    const pt = nodePortPoint(doc, ref, p);
    if (!pt) continue;
    const d = (pt.x - point.x) ** 2 + (pt.y - point.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** Resolve edge endpoint: fixed port if set, else dynamic border toward the other end. */
export function edgeEndpoint(
  doc: CanvasDoc,
  ref: string,
  port: EdgePort | undefined,
  toward: Point
): Point | null {
  if (port) return nodePortPoint(doc, ref, port) ?? nodeAnchor(doc, ref, toward);
  return nodeAnchor(doc, ref, toward);
}

export function edgePath(a: Point, b: Point, _radius = 12): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return `M ${a.x} ${a.y}`;

  // Nearly collinear → straight
  if (Math.abs(dy) < 1.5) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  if (Math.abs(dx) < 1.5) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;

  // Smooth cubic — control points stay outside the boxes for a clean attach.
  if (Math.abs(dx) >= Math.abs(dy)) {
    const cx = a.x + dx / 2;
    return `M ${a.x} ${a.y} C ${cx} ${a.y}, ${cx} ${b.y}, ${b.x} ${b.y}`;
  }
  const cy = a.y + dy / 2;
  return `M ${a.x} ${a.y} C ${a.x} ${cy}, ${b.x} ${cy}, ${b.x} ${b.y}`;
}

/** AI canvas ops */
export type CanvasAiOp =
  | { op: "add_sticky"; text?: string; x?: number; y?: number; w?: number; h?: number; color?: string }
  | { op: "add_shape"; shape?: ShapeKind; label?: string; x?: number; y?: number; w?: number; h?: number; color?: string }
  | {
      op: "add_media";
      media?: "image" | "youtube" | "link" | "web";
      url: string;
      title?: string;
      x?: number;
      y?: number;
      w?: number;
      h?: number;
    }
  | { op: "update"; id: string; text?: string; label?: string; x?: number; y?: number; w?: number; h?: number; color?: string }
  | { op: "delete"; id: string }
  | { op: "connect"; from: string; to: string; label?: string }
  | { op: "pin_note"; noteId: string; x?: number; y?: number }
  | { op: "layout_hint"; group?: string };

export type CanvasAiResponse = {
  message: string;
  ops: CanvasAiOp[];
};

export function serializeCanvasForAi(
  doc: CanvasDoc,
  notes: { id: string; title: string }[],
  selectedIds: string[] = []
): string {
  const noteMap = new Map(notes.map((n) => [n.id, n.title]));
  const items = [
    ...doc.stickies.map((s) => ({
      id: s.id,
      type: "sticky",
      text: s.text.slice(0, 200),
      x: Math.round(s.x),
      y: Math.round(s.y),
      w: s.w,
      h: s.h,
      color: s.color,
    })),
    ...doc.shapes.map((s) => ({
      id: s.id,
      type: "shape",
      shape: s.shape,
      label: s.label.slice(0, 80),
      x: Math.round(s.x),
      y: Math.round(s.y),
      w: s.w,
      h: s.h,
    })),
    ...doc.notes.map((p) => ({
      id: `note:${p.noteId}`,
      type: "note",
      title: noteMap.get(p.noteId) || p.noteId,
      x: Math.round(p.x),
      y: Math.round(p.y),
    })),
    ...(doc.media || []).map((m) => ({
      id: m.id,
      type: "media",
      media: m.media,
      title: m.title.slice(0, 80),
      x: Math.round(m.x),
      y: Math.round(m.y),
    })),
  ];
  const edges = doc.edges.map((e) => ({ id: e.id, from: e.from, to: e.to, label: e.label || "" }));
  const catalog = notes.slice(0, 80).map((n) => ({ id: n.id, title: n.title || "未命名" }));
  return JSON.stringify(
    {
      name: doc.name,
      selectedIds,
      items,
      edges,
      noteCatalog: catalog,
    },
    null,
    0
  );
}

export function parseCanvasAiResponse(raw: string): CanvasAiResponse {
  const trimmed = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const body = fence ? fence[1].trim() : trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(body.slice(start, end + 1)) as CanvasAiResponse;
      return {
        message: typeof parsed.message === "string" ? parsed.message : trimmed,
        ops: Array.isArray(parsed.ops) ? parsed.ops : [],
      };
    } catch {
      /* fall through */
    }
  }
  return { message: trimmed, ops: [] };
}

export function applyCanvasOps(
  doc: CanvasDoc,
  ops: CanvasAiOp[],
  validNoteIds: Set<string>
): CanvasDoc {
  let next: CanvasDoc = {
    ...doc,
    stickies: [...doc.stickies],
    shapes: [...doc.shapes],
    edges: [...doc.edges],
    notes: [...doc.notes],
    media: [...(doc.media || [])],
    sections: [...(doc.sections || [])],
  };
  let z = Date.now();
  for (const op of ops) {
    if (op.op === "add_sticky") {
      const s: CanvasSticky = {
        id: uid("st"),
        kind: "sticky",
        x: op.x ?? 80 + Math.random() * 120,
        y: op.y ?? 80 + Math.random() * 80,
        w: op.w ?? 180,
        h: op.h ?? 140,
        text: op.text || "",
        color: isCanvasColorValue(op.color) ? op.color : "yellow",
        z: z++,
      };
      next.stickies.push(s);
    } else if (op.op === "add_shape") {
      const sh: CanvasShape = {
        id: uid("sh"),
        kind: "shape",
        shape: op.shape === "ellipse" || op.shape === "frame" ? op.shape : "rect",
        x: op.x ?? 60,
        y: op.y ?? 60,
        w: op.w ?? 200,
        h: op.h ?? 140,
        label: op.label || "",
        color: op.color || SHAPE_COLORS[0],
        z: z++,
      };
      next.shapes.push(sh);
    } else if (op.op === "add_media" && op.url?.trim()) {
      const rawUrl = op.url.trim();
      const resolved = resolveEmbedUrl(rawUrl, op.title);
      let kind: CanvasMediaKind =
        op.media === "image" || op.media === "youtube" || op.media === "web" || op.media === "link"
          ? op.media
          : "link";
      if (!op.media && isYoutubeUrl(rawUrl)) kind = "youtube";
      if (!op.media && resolved?.kind === "youtube") kind = "youtube";
      if (kind === "youtube" && resolved?.kind === "youtube") {
        // keep youtube
      } else if (op.media === "image") {
        kind = "image";
      } else if (resolved?.kind === "youtube") {
        kind = "youtube";
      } else if (resolved?.kind === "web" || resolved?.kind === "link") {
        kind = resolved.kind === "web" ? "web" : "link";
      }
      const size = MEDIA_DEFAULT_SIZE[kind] || MEDIA_DEFAULT_SIZE.link;
      const displayUrl =
        kind === "youtube" && resolved?.src
          ? resolved.src
          : kind === "image"
            ? rawUrl
            : resolved?.src || rawUrl;
      const originalUrl = resolved?.original || rawUrl;
      const m: CanvasMedia = createMediaItem({
        media: kind,
        x: op.x ?? 80 + Math.random() * 80,
        y: op.y ?? 80 + Math.random() * 60,
        w: op.w ?? size.w,
        h: op.h ?? size.h,
        url: displayUrl,
        originalUrl,
        title: (
          op.title ||
          resolved?.title ||
          (kind === "youtube" ? "YouTube" : kind === "image" ? "圖片" : "連結")
        ).slice(0, 120),
        frameable: kind === "image" || kind === "youtube" || kind === "web",
        z: z++,
      });
      next.media.push(m);
    } else if (op.op === "update" && op.id) {
      next.stickies = next.stickies.map((s) => {
        if (s.id !== op.id) return s;
        return {
          ...s,
          text: op.text !== undefined ? op.text : s.text,
          x: op.x ?? s.x,
          y: op.y ?? s.y,
          w: op.w ?? s.w,
          h: op.h ?? s.h,
          color: isCanvasColorValue(op.color) ? op.color : s.color,
        };
      });
      next.shapes = next.shapes.map((s) => {
        if (s.id !== op.id) return s;
        return {
          ...s,
          label: op.label !== undefined ? op.label : s.label,
          x: op.x ?? s.x,
          y: op.y ?? s.y,
          w: op.w ?? s.w,
          h: op.h ?? s.h,
          color: op.color || s.color,
        };
      });
    } else if (op.op === "delete" && op.id) {
      const id = op.id.startsWith("note:") ? op.id.slice(5) : op.id;
      next.stickies = next.stickies.filter((s) => s.id !== op.id);
      next.shapes = next.shapes.filter((s) => s.id !== op.id);
      next.media = (next.media || []).filter((m) => m.id !== op.id);
      next.notes = next.notes.filter((n) => n.noteId !== id);
      next.edges = next.edges.filter((e) => e.id !== op.id && e.from !== op.id && e.to !== op.id && e.from !== `note:${id}` && e.to !== `note:${id}`);
    } else if (op.op === "connect" && op.from && op.to && op.from !== op.to) {
      next.edges.push({
        id: uid("e"),
        kind: "edge",
        from: op.from,
        to: op.to,
        label: op.label,
      });
    } else if (op.op === "pin_note" && op.noteId && validNoteIds.has(op.noteId)) {
      if (!next.notes.some((n) => n.noteId === op.noteId)) {
        next.notes.push({
          noteId: op.noteId,
          x: op.x ?? 100 + next.notes.length * 40,
          y: op.y ?? 100 + next.notes.length * 30,
          w: 280,
          h: 160,
        });
      }
    }
  }
  return next;
}

export type ClipboardPayload = {
  stickies: CanvasSticky[];
  shapes: CanvasShape[];
  notes: NotePin[];
  media: CanvasMedia[];
  edges: CanvasEdge[];
  strokes: CanvasStroke[];
};

export function copySelection(doc: CanvasDoc, selected: Selectable[]): ClipboardPayload {
  const stickyIds = new Set(selected.filter((s) => s.type === "sticky").map((s) => s.id));
  const shapeIds = new Set(selected.filter((s) => s.type === "shape").map((s) => s.id));
  const noteIds = new Set(selected.filter((s) => s.type === "note").map((s) => s.id));
  const mediaIds = new Set(selected.filter((s) => s.type === "media").map((s) => s.id));
  const strokeIds = new Set(selected.filter((s) => s.type === "stroke").map((s) => s.id));
  const stickies = doc.stickies.filter((s) => stickyIds.has(s.id));
  const shapes = doc.shapes.filter((s) => shapeIds.has(s.id));
  const notes = doc.notes.filter((n) => noteIds.has(n.noteId));
  const media = (doc.media || []).filter((m) => mediaIds.has(m.id));
  const strokes = (doc.strokes || []).filter((s) => strokeIds.has(s.id));
  const refs = new Set<string>([
    ...stickies.map((s) => s.id),
    ...shapes.map((s) => s.id),
    ...media.map((m) => m.id),
    ...notes.map((n) => `note:${n.noteId}`),
  ]);
  const edges = doc.edges.filter((e) => refs.has(e.from) && refs.has(e.to));
  return { stickies, shapes, notes, media, edges, strokes };
}

export function pasteClipboard(doc: CanvasDoc, clip: ClipboardPayload, offset = 28): { doc: CanvasDoc; selected: Selectable[] } {
  const idMap = new Map<string, string>();
  const stickies = clip.stickies.map((s) => {
    const id = uid("st");
    idMap.set(s.id, id);
    return { ...s, id, x: s.x + offset, y: s.y + offset, z: Date.now() };
  });
  const shapes = clip.shapes.map((s) => {
    const id = uid("sh");
    idMap.set(s.id, id);
    return { ...s, id, x: s.x + offset, y: s.y + offset, z: Date.now() };
  });
  const media = (clip.media || []).map((m) => {
    const id = uid("md");
    idMap.set(m.id, id);
    return { ...m, id, x: m.x + offset, y: m.y + offset, z: Date.now() };
  });
  const notes = clip.notes
    .filter((n) => !doc.notes.some((d) => d.noteId === n.noteId))
    .map((n) => {
      idMap.set(`note:${n.noteId}`, `note:${n.noteId}`);
      return { ...n, x: n.x + offset, y: n.y + offset };
    });
  for (const n of clip.notes) {
    if (!idMap.has(`note:${n.noteId}`)) idMap.set(`note:${n.noteId}`, `note:${n.noteId}`);
  }
  const edges = clip.edges
    .map((e) => {
      const from = idMap.get(e.from);
      const to = idMap.get(e.to);
      if (!from || !to) return null;
      return { ...e, id: uid("e"), from, to };
    })
    .filter(Boolean) as CanvasEdge[];

  const strokes = (clip.strokes || []).map((s) => {
    const id = uid("sk");
    idMap.set(s.id, id);
    return {
      ...s,
      id,
      z: Date.now(),
      points: s.points.map((p) => ({ x: p.x + offset, y: p.y + offset })),
    };
  });

  const selected: Selectable[] = [
    ...stickies.map((s) => ({ type: "sticky" as const, id: s.id })),
    ...shapes.map((s) => ({ type: "shape" as const, id: s.id })),
    ...media.map((m) => ({ type: "media" as const, id: m.id })),
    ...notes.map((n) => ({ type: "note" as const, id: n.noteId })),
    ...strokes.map((s) => ({ type: "stroke" as const, id: s.id })),
  ];
  return {
    doc: {
      ...doc,
      stickies: [...doc.stickies, ...stickies],
      shapes: [...doc.shapes, ...shapes],
      media: [...(doc.media || []), ...media],
      notes: [...doc.notes, ...notes],
      edges: [...doc.edges, ...edges],
      strokes: [...(doc.strokes || []), ...strokes],
    },
    selected,
  };
}

export function mediaKindFromFile(file: File): CanvasMediaKind {
  const t = file.type || "";
  const name = file.name.toLowerCase();
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("audio/")) return "audio";
  if (t.startsWith("video/")) return "video";
  if (t === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (/\.(ppt|pptx)$/i.test(name) || t.includes("powerpoint") || t.includes("presentation")) return "ppt";
  return "file";
}

export function createMediaItem(
  partial: Omit<CanvasMedia, "id" | "kind" | "z"> & { z?: number }
): CanvasMedia {
  return {
    id: uid("md"),
    kind: "media",
    z: partial.z ?? Date.now(),
    frameable: partial.frameable,
    ...partial,
  };
}

export function createSticky(
  partial: Partial<Omit<CanvasSticky, "id" | "kind">> & { x: number; y: number }
): CanvasSticky {
  return {
    id: uid("st"),
    kind: "sticky",
    x: partial.x,
    y: partial.y,
    w: partial.w ?? (partial.variant === "text" ? 320 : 260),
    h: partial.h ?? (partial.variant === "text" ? 56 : 200),
    text: partial.text ?? "",
    color: partial.color ?? "yellow",
    textColor: partial.textColor,
    opacity: partial.opacity,
    z: partial.z ?? Date.now(),
    variant: partial.variant ?? "sticky",
  };
}

export function createStroke(
  partial: Partial<Omit<CanvasStroke, "id" | "kind">> & { points: Point[] }
): CanvasStroke {
  return {
    id: uid("sk"),
    kind: "stroke",
    points: partial.points,
    color: partial.color ?? "#1f2937",
    width: partial.width ?? 3,
    opacity: partial.opacity,
    brush: partial.brush,
    widths: partial.widths,
    smooth: partial.smooth,
    z: partial.z ?? Date.now(),
  };
}

export function strokeBounds(stroke: CanvasStroke): { x: number; y: number; w: number; h: number } | null {
  if (!stroke.points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of stroke.points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const pad = Math.max(4, stroke.width);
  return {
    x: minX - pad,
    y: minY - pad,
    w: Math.max(1, maxX - minX + pad * 2),
    h: Math.max(1, maxY - minY + pad * 2),
  };
}

export function strokeToPath(points: Point[], smooth = 0): string {
  // Keep mid-point quadratic as default; optional Chaikin via canvasBrush.smoothPoints
  // when callers pass smooth > 0 (imported lazily to avoid circular deps at module init).
  let pts = points;
  if (smooth > 0 && points.length >= 3) {
    // Lightweight inline smooth (one Chaikin-ish pass scaled by amount)
    const mix = Math.min(0.4, 0.1 + smooth / 300);
    const next: Point[] = [points[0]];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      next.push({ x: a.x * (1 - mix) + b.x * mix, y: a.y * (1 - mix) + b.y * mix });
      next.push({ x: a.x * mix + b.x * (1 - mix), y: a.y * mix + b.y * (1 - mix) });
    }
    next.push(points[points.length - 1]);
    pts = next;
  }
  if (!pts.length) return "";
  if (pts.length === 1) {
    const p = pts[0];
    return `M ${p.x} ${p.y} L ${p.x + 0.01} ${p.y}`;
  }
  if (pts.length === 2) {
    return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  }
  // Mid-point quadratic smoothing (Concept-like continuous ink, not jagged polylines).
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

/** Point-to-segment distance for stroke hit-testing. */
export function hitTestStroke(stroke: CanvasStroke, world: Point, pad = 6): boolean {
  const pts = stroke.points;
  if (pts.length < 2) {
    if (!pts.length) return false;
    const dx = pts[0].x - world.x;
    const dy = pts[0].y - world.y;
    return dx * dx + dy * dy <= (stroke.width + pad) ** 2;
  }
  const thresh = stroke.width / 2 + pad;
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
    if (px * px + py * py <= thresh2) return true;
  }
  return false;
}

export function autoLayoutNotes(pins: NotePin[], cols = 4, gapX = 240, gapY = 170, origin: Point = { x: 40, y: 40 }): NotePin[] {
  return pins.map((p, i) => ({
    ...p,
    x: origin.x + (i % cols) * gapX,
    y: origin.y + Math.floor(i / cols) * gapY,
  }));
}

export function createSection(
  partial: Partial<Omit<CanvasSection, "id" | "kind">> & { x: number; y: number }
): CanvasSection {
  return {
    id: uid("sec"),
    kind: "section",
    x: partial.x,
    y: partial.y,
    w: partial.w ?? 720,
    h: partial.h ?? 480,
    title: partial.title ?? "分區",
    color: partial.color ?? "#0D9488",
    z: partial.z ?? 0,
  };
}

export type AlignMode =
  | "left"
  | "centerX"
  | "right"
  | "top"
  | "centerY"
  | "bottom"
  | "distributeX"
  | "distributeY"
  | "sameWidth"
  | "sameHeight";

type BoxItem = { id: string; x: number; y: number; w: number; h: number };

/** Minimum clear gap between boxes when using 橫距／直距 (or when they currently overlap). */
export const DISTRIBUTE_MIN_GAP = 28;

/** Default width / gap for AI-landed stickies (mind map, summary cards). */
export const AI_STICKY_W = 280;
export const AI_STICKY_GAP = 28;

export function stickyHeightForText(text: string, w = AI_STICKY_W): number {
  const cols = Math.max(24, Math.floor(w / 8));
  return Math.min(340, 100 + Math.ceil(text.length / cols) * 24);
}

/**
 * Pack boxes along an axis with equal gaps.
 * If the current outer span is too tight (overlap / tiny spacing), expand past the
 * original bounds using at least `minGap`. If there is spare room, keep the outer
 * extent and equalize gaps.
 */
function packAlongAxis(
  items: BoxItem[],
  axis: "x" | "y",
  minGap: number
): Map<string, { x: number; y: number; w: number; h: number }> {
  const out = new Map<string, { x: number; y: number; w: number; h: number }>();
  const sorted = [...items].sort((a, b) => (axis === "x" ? a.x - b.x : a.y - b.y));
  if (sorted.length < 2) return out;
  const sizeOf = (it: BoxItem) => (axis === "x" ? it.w : it.h);
  const posOf = (it: BoxItem) => (axis === "x" ? it.x : it.y);
  const totalSize = sorted.reduce((s, it) => s + sizeOf(it), 0);
  const gaps = sorted.length - 1;
  const firstPos = posOf(sorted[0]);
  const last = sorted[sorted.length - 1];
  const available = posOf(last) + sizeOf(last) - firstPos;
  const minNeeded = totalSize + minGap * gaps;
  const gap = available > minNeeded ? (available - totalSize) / gaps : minGap;
  let cursor = firstPos;
  for (const it of sorted) {
    if (axis === "x") {
      out.set(it.id, { x: cursor, y: it.y, w: it.w, h: it.h });
    } else {
      out.set(it.id, { x: it.x, y: cursor, w: it.w, h: it.h });
    }
    cursor += sizeOf(it) + gap;
  }
  return out;
}

/** Align / distribute selected boxes relative to the selection bounding box. */
export function alignBoxes(items: BoxItem[], mode: AlignMode): Map<string, { x: number; y: number; w: number; h: number }> {
  const out = new Map<string, { x: number; y: number; w: number; h: number }>();
  if (items.length < 2 && mode.startsWith("distribute")) return out;
  if (!items.length) return out;
  const minX = Math.min(...items.map((i) => i.x));
  const maxX = Math.max(...items.map((i) => i.x + i.w));
  const minY = Math.min(...items.map((i) => i.y));
  const maxY = Math.max(...items.map((i) => i.y + i.h));
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  if (mode === "distributeX") return packAlongAxis(items, "x", DISTRIBUTE_MIN_GAP);
  if (mode === "distributeY") return packAlongAxis(items, "y", DISTRIBUTE_MIN_GAP);

  const baseW = items[0].w;
  const baseH = items[0].h;
  for (const it of items) {
    let x = it.x;
    let y = it.y;
    let w = it.w;
    let h = it.h;
    if (mode === "left") x = minX;
    if (mode === "right") x = maxX - it.w;
    if (mode === "centerX") x = midX - it.w / 2;
    if (mode === "top") y = minY;
    if (mode === "bottom") y = maxY - it.h;
    if (mode === "centerY") y = midY - it.h / 2;
    if (mode === "sameWidth") w = baseW;
    if (mode === "sameHeight") h = baseH;
    out.set(it.id, { x, y, w, h });
  }
  return out;
}

/** Items whose center lies inside a section rect. */
export function itemsInsideSection(
  doc: CanvasDoc,
  section: { x: number; y: number; w: number; h: number }
): { stickies: string[]; shapes: string[]; media: string[]; notes: string[] } {
  const contains = (x: number, y: number, w: number, h: number) => {
    const cx = x + w / 2;
    const cy = y + h / 2;
    return cx >= section.x && cx <= section.x + section.w && cy >= section.y && cy <= section.y + section.h;
  };
  return {
    stickies: doc.stickies.filter((s) => contains(s.x, s.y, s.w, s.h)).map((s) => s.id),
    shapes: doc.shapes.filter((s) => contains(s.x, s.y, s.w, s.h)).map((s) => s.id),
    media: (doc.media || []).filter((m) => contains(m.x, m.y, m.w, m.h)).map((m) => m.id),
    notes: doc.notes.filter((n) => contains(n.x, n.y, n.w, n.h)).map((n) => n.noteId),
  };
}

export function boundsOf(doc: CanvasDoc): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const boxes: { x: number; y: number; w: number; h: number }[] = [
    ...doc.stickies,
    ...doc.shapes,
    ...(doc.media || []),
    ...(doc.sections || []),
    ...doc.notes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h })),
  ];
  for (const sk of doc.strokes || []) {
    const b = strokeBounds(sk);
    if (b) boxes.push(b);
  }
  if (!boxes.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { minX, minY, maxX, maxY };
}

export function fitView(
  doc: CanvasDoc,
  viewport: { w: number; h: number },
  padding = 80
): { pan: Point; scale: number } {
  const b = boundsOf(doc);
  if (!b) return { pan: { x: 48, y: 48 }, scale: 1 };
  const bw = Math.max(200, b.maxX - b.minX);
  const bh = Math.max(200, b.maxY - b.minY);
  const scale = clampScale(
    Math.min((viewport.w - padding * 2) / bw, (viewport.h - padding * 2) / bh)
  );
  const pan = {
    x: padding - b.minX * scale + (viewport.w - padding * 2 - bw * scale) / 2,
    y: padding - b.minY * scale + (viewport.h - padding * 2 - bh * scale) / 2,
  };
  return { pan, scale };
}

export function exportCanvasJson(doc: CanvasDoc): string {
  return JSON.stringify(doc, null, 2);
}

export function importCanvasJson(raw: string): CanvasDoc | null {
  try {
    const parsed = JSON.parse(raw) as CanvasDoc;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      ...emptyDoc(),
      ...parsed,
      version: 2,
      media: Array.isArray(parsed.media) ? parsed.media : [],
      sections: Array.isArray(parsed.sections) ? parsed.sections : [],
      strokes: Array.isArray(parsed.strokes) ? parsed.strokes : [],
    };
  } catch {
    return null;
  }
}

export type ZOrderOp = "front" | "back" | "forward" | "backward";

type LayerEntry = {
  type: "sticky" | "shape" | "media" | "section" | "stroke" | "note";
  id: string;
  z: number;
};

function layerKey(e: Pick<LayerEntry, "type" | "id">) {
  return `${e.type}:${e.id}`;
}

function collectLayerEntries(doc: CanvasDoc): LayerEntry[] {
  const out: LayerEntry[] = [];
  for (const s of doc.stickies) out.push({ type: "sticky", id: s.id, z: s.z });
  for (const s of doc.shapes) out.push({ type: "shape", id: s.id, z: s.z });
  for (const m of doc.media || []) out.push({ type: "media", id: m.id, z: m.z });
  for (const s of doc.sections || []) out.push({ type: "section", id: s.id, z: s.z || 0 });
  for (const sk of doc.strokes || []) out.push({ type: "stroke", id: sk.id, z: sk.z });
  for (const n of doc.notes) out.push({ type: "note", id: n.noteId, z: n.z ?? 0 });
  return out;
}

function writeLayerZs(doc: CanvasDoc, entries: LayerEntry[]): CanvasDoc {
  const map = new Map(entries.map((e) => [layerKey(e), e.z]));
  return {
    ...doc,
    stickies: doc.stickies.map((s) => {
      const z = map.get(layerKey({ type: "sticky", id: s.id }));
      return z === undefined ? s : { ...s, z };
    }),
    shapes: doc.shapes.map((s) => {
      const z = map.get(layerKey({ type: "shape", id: s.id }));
      return z === undefined ? s : { ...s, z };
    }),
    media: (doc.media || []).map((m) => {
      const z = map.get(layerKey({ type: "media", id: m.id }));
      return z === undefined ? m : { ...m, z };
    }),
    sections: (doc.sections || []).map((s) => {
      const z = map.get(layerKey({ type: "section", id: s.id }));
      return z === undefined ? s : { ...s, z };
    }),
    strokes: (doc.strokes || []).map((s) => {
      const z = map.get(layerKey({ type: "stroke", id: s.id }));
      return z === undefined ? s : { ...s, z };
    }),
    notes: doc.notes.map((n) => {
      const z = map.get(layerKey({ type: "note", id: n.noteId }));
      return z === undefined ? n : { ...n, z };
    }),
  };
}

/** True when selection includes at least one stackable object (not edge-only). */
export function selectionHasZOrder(selected: Selectable[]): boolean {
  return selected.some((s) => s.type !== "edge");
}

/** Bring / send / nudge selected objects in the shared z stack. */
export function applyZOrder(doc: CanvasDoc, selected: Selectable[], op: ZOrderOp): CanvasDoc {
  const selKeys = new Set(
    selected
      .filter((s) => s.type !== "edge")
      .map((s) => layerKey({ type: s.type, id: s.id }))
  );
  if (!selKeys.size) return doc;

  const layers = collectLayerEntries(doc).sort(
    (a, b) => a.z - b.z || layerKey(a).localeCompare(layerKey(b))
  );
  // Normalize to unique increasing ranks so swaps always change visual order
  layers.forEach((e, i) => {
    e.z = i + 1;
  });

  const selectedEntries = layers.filter((e) => selKeys.has(layerKey(e)));
  if (!selectedEntries.length) return doc;

  if (op === "front") {
    const maxZ = layers.length;
    selectedEntries
      .slice()
      .sort((a, b) => a.z - b.z)
      .forEach((e, i) => {
        e.z = maxZ + 1 + i;
      });
  } else if (op === "back") {
    selectedEntries
      .slice()
      .sort((a, b) => b.z - a.z)
      .forEach((e, i) => {
        e.z = -1 - i;
      });
  } else if (op === "forward") {
    for (let i = layers.length - 1; i >= 0; i--) {
      if (!selKeys.has(layerKey(layers[i]))) continue;
      if (i >= layers.length - 1) continue;
      if (selKeys.has(layerKey(layers[i + 1]))) continue;
      const za = layers[i].z;
      layers[i].z = layers[i + 1].z;
      layers[i + 1].z = za;
      const tmp = layers[i];
      layers[i] = layers[i + 1];
      layers[i + 1] = tmp;
    }
  } else if (op === "backward") {
    for (let i = 0; i < layers.length; i++) {
      if (!selKeys.has(layerKey(layers[i]))) continue;
      if (i <= 0) continue;
      if (selKeys.has(layerKey(layers[i - 1]))) continue;
      const za = layers[i].z;
      layers[i].z = layers[i - 1].z;
      layers[i - 1].z = za;
      const tmp = layers[i];
      layers[i] = layers[i - 1];
      layers[i - 1] = tmp;
    }
  }

  return writeLayerZs(doc, layers);
}

export const CANVAS_TIPS = [
  "雙指／滾輪平移；Ctrl+滾輪或 Ctrl+/- 縮放；Shift+滾輪左右移。",
  "右鍵或中鍵拖曳、空白鍵拖曳皆可平移。",
  "Shift+1 看全部；Shift+0 恢復 100%。",
  "工具列可插入圖片／語音／影片／網址／PDF／PPT／檔案；拖放檔案會直接放在滑鼠所在位置。",
  "畫筆（P）可在白板上書寫；顏色面板可調色盤、RGB 與透明度。",
  "雙擊編輯便利貼；Ctrl+C/V/X/Z；右側 AI 可讀寫白板。",
  "選取物件後點擊附近的「AI」鈕，可改寫、延伸文字或生成圖片並插入畫布。",
  "右鍵選單可調整圖層：顯示在最上面／最下面，或上移／下移一層。",
];
