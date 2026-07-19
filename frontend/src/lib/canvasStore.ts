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

export const MEDIA_DEFAULT_SIZE: Record<CanvasMediaKind, { w: number; h: number }> = {
  image: { w: 280, h: 200 },
  audio: { w: 300, h: 88 },
  video: { w: 360, h: 220 },
  youtube: { w: 360, h: 220 },
  pdf: { w: 320, h: 400 },
  ppt: { w: 320, h: 400 },
  file: { w: 260, h: 96 },
  link: { w: 280, h: 96 },
  web: { w: 360, h: 280 },
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
    return {
      ...emptyDoc(),
      ...parsed,
      version: 2,
      media: Array.isArray(parsed.media) ? parsed.media : [],
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
  | { type: "media"; id: string };

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
  const media = doc.media?.find((m) => m.id === ref);
  if (media) return { x: media.x + media.w / 2, y: media.y + media.h / 2 };
  return null;
}

export function edgePath(a: Point, b: Point, radius = 12): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return `M ${a.x} ${a.y}`;
  // Straight H or V
  if (Math.abs(dy) < 2) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  if (Math.abs(dx) < 2) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;

  // Orthogonal with one elbow (mid X then Y, or mid Y then X) + rounded corner
  const preferHFirst = Math.abs(dx) >= Math.abs(dy);
  const mid = preferHFirst
    ? { x: a.x + dx / 2, y: a.y }
    : { x: a.x, y: a.y + dy / 2 };
  const elbow = preferHFirst
    ? { x: mid.x, y: b.y }
    : { x: b.x, y: mid.y };

  const r = Math.min(
    radius,
    Math.abs(preferHFirst ? dx / 2 : dx) * 0.45,
    Math.abs(preferHFirst ? dy : dy / 2) * 0.45,
    18
  );

  if (r < 2) {
    return `M ${a.x} ${a.y} L ${elbow.x} ${elbow.y} L ${b.x} ${b.y}`;
  }

  // Approach elbow, arc around corner, continue to end
  if (preferHFirst) {
    const dirX = Math.sign(dx) || 1;
    const dirY = Math.sign(b.y - a.y) || 1;
    const p1 = { x: elbow.x - dirX * r, y: a.y };
    const p2 = { x: elbow.x, y: a.y + dirY * r };
    const sweep = dirX * dirY > 0 ? 1 : 0;
    return `M ${a.x} ${a.y} L ${p1.x} ${p1.y} A ${r} ${r} 0 0 ${sweep} ${p2.x} ${p2.y} L ${b.x} ${b.y}`;
  }
  const dirY = Math.sign(dy) || 1;
  const dirX = Math.sign(b.x - a.x) || 1;
  const p1 = { x: a.x, y: elbow.y - dirY * r };
  const p2 = { x: a.x + dirX * r, y: elbow.y };
  const sweep = dirX * dirY < 0 ? 1 : 0;
  return `M ${a.x} ${a.y} L ${p1.x} ${p1.y} A ${r} ${r} 0 0 ${sweep} ${p2.x} ${p2.y} L ${b.x} ${b.y}`;
}

/** AI canvas ops */
export type CanvasAiOp =
  | { op: "add_sticky"; text?: string; x?: number; y?: number; w?: number; h?: number; color?: StickyColor }
  | { op: "add_shape"; shape?: ShapeKind; label?: string; x?: number; y?: number; w?: number; h?: number; color?: string }
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
        color: op.color && STICKY_COLORS.some((c) => c.id === op.color) ? op.color : "yellow",
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
          color:
            op.color && STICKY_COLORS.some((c) => c.id === op.color)
              ? (op.color as StickyColor)
              : s.color,
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
          w: 200,
          h: 120,
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
};

export function copySelection(doc: CanvasDoc, selected: Selectable[]): ClipboardPayload {
  const stickyIds = new Set(selected.filter((s) => s.type === "sticky").map((s) => s.id));
  const shapeIds = new Set(selected.filter((s) => s.type === "shape").map((s) => s.id));
  const noteIds = new Set(selected.filter((s) => s.type === "note").map((s) => s.id));
  const mediaIds = new Set(selected.filter((s) => s.type === "media").map((s) => s.id));
  const stickies = doc.stickies.filter((s) => stickyIds.has(s.id));
  const shapes = doc.shapes.filter((s) => shapeIds.has(s.id));
  const notes = doc.notes.filter((n) => noteIds.has(n.noteId));
  const media = (doc.media || []).filter((m) => mediaIds.has(m.id));
  const refs = new Set<string>([
    ...stickies.map((s) => s.id),
    ...shapes.map((s) => s.id),
    ...media.map((m) => m.id),
    ...notes.map((n) => `note:${n.noteId}`),
  ]);
  const edges = doc.edges.filter((e) => refs.has(e.from) && refs.has(e.to));
  return { stickies, shapes, notes, media, edges };
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

  const selected: Selectable[] = [
    ...stickies.map((s) => ({ type: "sticky" as const, id: s.id })),
    ...shapes.map((s) => ({ type: "shape" as const, id: s.id })),
    ...media.map((m) => ({ type: "media" as const, id: m.id })),
    ...notes.map((n) => ({ type: "note" as const, id: n.noteId })),
  ];
  return {
    doc: {
      ...doc,
      stickies: [...doc.stickies, ...stickies],
      shapes: [...doc.shapes, ...shapes],
      media: [...(doc.media || []), ...media],
      notes: [...doc.notes, ...notes],
      edges: [...doc.edges, ...edges],
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
    w: partial.w ?? 200,
    h: partial.h ?? 160,
    text: partial.text ?? "",
    color: partial.color ?? "yellow",
    z: partial.z ?? Date.now(),
  };
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
    ...(doc.media || []),
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
    return {
      ...emptyDoc(),
      ...parsed,
      version: 2,
      media: Array.isArray(parsed.media) ? parsed.media : [],
    };
  } catch {
    return null;
  }
}

export const CANVAS_TIPS = [
  "雙指／滾輪平移；Ctrl+滾輪或 Ctrl+/- 縮放；Shift+滾輪左右移。",
  "右鍵或中鍵拖曳、空白鍵拖曳皆可平移。",
  "Shift+1 看全部；Shift+0 恢復 100%。",
  "工具列可插入圖片／語音／影片／網址／PDF／PPT／檔案；拖放檔案會直接放在滑鼠所在位置。",
  "雙擊編輯便利貼；Ctrl+C/V/X/Z；右側 AI 可讀寫白板。",
  "選取物件後點擊附近的「AI」鈕，可改寫、延伸文字或生成圖片並插入畫布。",
];
