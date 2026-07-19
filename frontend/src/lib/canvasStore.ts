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
  color: StickyColor;
  z: number;
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
  z: number;
};

export type CanvasEdge = {
  id: string;
  kind: "edge";
  from: string; // sticky | shape | note:{noteId}
  to: string;
  label?: string;
};

export type NotePin = {
  noteId: string;
  x: number;
  y: number;
  w: number;
  h: number;
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
  | "text";

export const STICKY_COLORS: { id: StickyColor; label: string; bg: string; border: string }[] = [
  { id: "yellow", label: "黃", bg: "#FEF3C7", border: "#F59E0B" },
  { id: "mint", label: "薄荷", bg: "#CCFBF1", border: "#0D9488" },
  { id: "sky", label: "天空", bg: "#E0F2FE", border: "#0284C7" },
  { id: "rose", label: "玫瑰", bg: "#FFE4E6", border: "#E11D48" },
  { id: "violet", label: "紫", bg: "#EDE9FE", border: "#7C3AED" },
  { id: "sand", label: "沙", bg: "#F5F5F4", border: "#A8A29E" },
];

export const SHAPE_COLORS = ["#0D9488", "#0369A1", "#7C3AED", "#E11D48", "#CA8A04", "#64748B"];

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
          w: 200,
          h: 120,
        }));
      }
      return doc;
    }
    const parsed = JSON.parse(raw) as CanvasDoc;
    if (!parsed.version) return emptyDoc();
    return { ...emptyDoc(), ...parsed, version: 2 };
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
  | { type: "edge"; id: string };

export function nodeCenter(
  doc: CanvasDoc,
  ref: string
): Point | null {
  if (ref.startsWith("note:")) {
    const noteId = ref.slice(5);
    const n = doc.notes.find((x) => x.noteId === noteId);
    if (!n) return null;
    return { x: n.x + n.w / 2, y: n.y + n.h / 2 };
  }
  const sticky = doc.stickies.find((s) => s.id === ref);
  if (sticky) return { x: sticky.x + sticky.w / 2, y: sticky.y + sticky.h / 2 };
  const shape = doc.shapes.find((s) => s.id === ref);
  if (shape) return { x: shape.x + shape.w / 2, y: shape.y + shape.h / 2 };
  return null;
}

export function edgePath(a: Point, b: Point): string {
  const dx = Math.abs(b.x - a.x) * 0.4;
  const c1 = { x: a.x + (b.x >= a.x ? dx : -dx), y: a.y };
  const c2 = { x: b.x - (b.x >= a.x ? dx : -dx), y: b.y };
  return `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
}

export function autoLayoutNotes(pins: NotePin[], cols = 4, gapX = 240, gapY = 170, origin: Point = { x: 40, y: 40 }): NotePin[] {
  return pins.map((p, i) => ({
    ...p,
    x: origin.x + (i % cols) * gapX,
    y: origin.y + Math.floor(i / cols) * gapY,
  }));
}

export function boundsOf(doc: CanvasDoc): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const boxes: { x: number; y: number; w: number; h: number }[] = [
    ...doc.stickies,
    ...doc.shapes,
    ...doc.notes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h })),
  ];
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
    return { ...emptyDoc(), ...parsed, version: 2 };
  } catch {
    return null;
  }
}

export const CANVAS_TIPS = [
  "空白處拖曳可平移；滾輪縮放。",
  "選取工具下可多選物件後刪除。",
  "連線工具：先點起點再點終點。",
  "便利貼雙擊可編輯文字。",
  "右側可搜尋筆記釘到畫布。",
];
