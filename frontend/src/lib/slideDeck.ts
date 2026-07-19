/** Canva-lite slide deck: 16:9 layouts, blocks, generate from markdown */

export type SlideThemeId = "teal" | "ink" | "sand" | "night";
export type SlideLayoutId = "title" | "bullets" | "two-col" | "quote" | "section" | "blank";
export type BlockAlign = "left" | "center" | "right";
export type BlockRole = "title" | "subtitle" | "body" | "caption";

export type SlideBlock = {
  id: string;
  type: "text" | "image";
  /** percent of stage (0–100) */
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  /** relative size: 1 = body, ~2.2 = title */
  scale?: number;
  align?: BlockAlign;
  role?: BlockRole;
  src?: string;
  bold?: boolean;
};

export type Slide = {
  id: string;
  layout: SlideLayoutId;
  blocks: SlideBlock[];
};

export type SlideDeck = {
  version: 1;
  aspect: "16:9";
  theme: SlideThemeId;
  slides: Slide[];
  updatedAt?: number;
  /** hash of note title+body when deck was last generated/synced */
  sourceHash?: string;
};

export type ThemeTokens = {
  id: SlideThemeId;
  label: string;
  bg: string;
  fg: string;
  muted: string;
  accent: string;
  card: string;
};

export const SLIDE_THEMES: ThemeTokens[] = [
  {
    id: "teal",
    label: "青綠",
    bg: "#F7FBFA",
    fg: "#134E4A",
    muted: "#5B7C78",
    accent: "#0D9488",
    card: "#FFFFFF",
  },
  {
    id: "ink",
    label: "墨色",
    bg: "#FAFAF9",
    fg: "#1C1917",
    muted: "#78716C",
    accent: "#292524",
    card: "#FFFFFF",
  },
  {
    id: "sand",
    label: "暖沙",
    bg: "#FFF8F1",
    fg: "#44403C",
    muted: "#A8A29E",
    accent: "#D97706",
    card: "#FFFCFA",
  },
  {
    id: "night",
    label: "夜幕",
    bg: "#0F172A",
    fg: "#F8FAFC",
    muted: "#94A3B8",
    accent: "#38BDF8",
    card: "#1E293B",
  },
];

export const SLIDE_LAYOUTS: { id: SlideLayoutId; label: string; hint: string }[] = [
  { id: "title", label: "標題頁", hint: "大標題＋副標" },
  { id: "bullets", label: "重點清單", hint: "標題＋條列" },
  { id: "two-col", label: "雙欄", hint: "左右對照" },
  { id: "quote", label: "引言", hint: "金句／摘錄" },
  { id: "section", label: "章節", hint: "分隔大標" },
  { id: "blank", label: "空白", hint: "自由排版" },
];

export function uid(prefix = "b") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function emptyDeck(theme: SlideThemeId = "teal"): SlideDeck {
  return {
    version: 1,
    aspect: "16:9",
    theme,
    slides: [buildLayoutSlide("title", "未命名簡報", "")],
    updatedAt: Date.now(),
    sourceHash: hashNoteSource("未命名簡報", ""),
  };
}

export function getTheme(id: SlideThemeId): ThemeTokens {
  return SLIDE_THEMES.find((t) => t.id === id) || SLIDE_THEMES[0];
}

function textBlock(
  partial: Omit<SlideBlock, "id" | "type"> & { text: string }
): SlideBlock {
  return { id: uid("tb"), type: "text", scale: 1, align: "left", ...partial };
}

/** Build blocks for a layout from title + body markdown-ish text */
export function buildLayoutSlide(
  layout: SlideLayoutId,
  title: string,
  content: string
): Slide {
  const t = (title || "").trim() || "未命名";
  const body = (content || "").trim();
  const bullets = body
    .split("\n")
    .map((l) => l.replace(/^[-*•]\s+/, "").replace(/^\d+\.\s+/, "").trim())
    .filter(Boolean);
  const bulletText = bullets.length
    ? bullets
        .slice(0, 8)
        .map((l) => `• ${l}`)
        .join("\n")
    : body;

  let blocks: SlideBlock[] = [];

  switch (layout) {
    case "title":
      blocks = [
        textBlock({
          x: 8,
          y: 32,
          w: 84,
          h: 22,
          text: t,
          role: "title",
          scale: 2.4,
          align: "center",
          bold: true,
        }),
        textBlock({
          x: 12,
          y: 58,
          w: 76,
          h: 16,
          text: body.split("\n").filter(Boolean)[0] || "Cadence 簡報",
          role: "subtitle",
          scale: 1.15,
          align: "center",
        }),
      ];
      break;
    case "section":
      blocks = [
        textBlock({
          x: 10,
          y: 38,
          w: 80,
          h: 24,
          text: t,
          role: "title",
          scale: 2.6,
          align: "center",
          bold: true,
        }),
      ];
      break;
    case "quote": {
      const quote =
        body
          .split("\n")
          .map((l) => l.replace(/^>\s?/, "").trim())
          .filter(Boolean)
          .join("\n") || body || t;
      blocks = [
        textBlock({
          x: 12,
          y: 28,
          w: 76,
          h: 36,
          text: `「${quote}」`,
          role: "body",
          scale: 1.45,
          align: "center",
        }),
        textBlock({
          x: 20,
          y: 72,
          w: 60,
          h: 10,
          text: t,
          role: "caption",
          scale: 0.95,
          align: "center",
        }),
      ];
      break;
    }
    case "two-col": {
      const mid = Math.ceil(bullets.length / 2) || 1;
      const left = bullets.slice(0, mid);
      const right = bullets.slice(mid);
      blocks = [
        textBlock({
          x: 6,
          y: 8,
          w: 88,
          h: 14,
          text: t,
          role: "title",
          scale: 1.7,
          bold: true,
        }),
        textBlock({
          x: 6,
          y: 28,
          w: 42,
          h: 62,
          text: (left.length ? left : ["（左欄）"]).map((l) => `• ${l}`).join("\n"),
          role: "body",
          scale: 1.05,
        }),
        textBlock({
          x: 52,
          y: 28,
          w: 42,
          h: 62,
          text: (right.length ? right : ["（右欄）"]).map((l) => `• ${l}`).join("\n"),
          role: "body",
          scale: 1.05,
        }),
      ];
      break;
    }
    case "blank":
      blocks = [
        textBlock({
          x: 10,
          y: 20,
          w: 80,
          h: 20,
          text: t,
          role: "title",
          scale: 1.8,
          bold: true,
        }),
      ];
      break;
    case "bullets":
    default:
      blocks = [
        textBlock({
          x: 6,
          y: 8,
          w: 88,
          h: 14,
          text: t,
          role: "title",
          scale: 1.75,
          bold: true,
        }),
        textBlock({
          x: 6,
          y: 28,
          w: 88,
          h: 62,
          text: bulletText || "• 在此編輯重點",
          role: "body",
          scale: 1.1,
        }),
      ];
      break;
  }

  return { id: uid("sl"), layout, blocks };
}

/** Heuristic: pick layout from heading + content */
export function pickLayout(title: string, content: string, index: number, total: number): SlideLayoutId {
  if (index === 0) return "title";
  if (index === total - 1 && total > 2) return "section";
  const c = content.trim();
  if (/^>/.test(c) || c.length < 80 && !c.includes("\n")) return "quote";
  const lines = c.split("\n").filter((l) => l.trim());
  if (lines.length >= 6) return "two-col";
  if (/^##\s*章|第.+[章節]|Part\s*\d/i.test(title)) return "section";
  return "bullets";
}

export function deckFromMarkdown(noteTitle: string, body: string, theme: SlideThemeId = "teal"): SlideDeck {
  const sections = splitMarkdownSections(noteTitle, body);
  const slides = sections.map((s, i) =>
    buildLayoutSlide(pickLayout(s.title, s.content, i, sections.length), s.title, s.content)
  );
  return {
    version: 1,
    aspect: "16:9",
    theme,
    slides: slides.length ? slides : [buildLayoutSlide("title", noteTitle || "簡報", "")],
    updatedAt: Date.now(),
    sourceHash: hashNoteSource(noteTitle, body),
  };
}

/** Fast non-crypto hash for stale-deck detection */
export function hashNoteSource(title: string, body: string): string {
  const s = `${title || ""}\n---\n${body || ""}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function isDeckStale(deck: SlideDeck | null | undefined, title: string, body: string): boolean {
  if (!deck?.slides?.length) return true;
  if (!deck.sourceHash) return true;
  return deck.sourceHash !== hashNoteSource(title, body);
}

export function splitMarkdownSections(
  noteTitle: string,
  body: string
): { title: string; content: string }[] {
  const lines = (body || "").split("\n");
  const sections: { title: string; content: string }[] = [];
  let cur = { title: noteTitle || "簡報", content: "" };
  let started = false;

  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (started || cur.content.trim()) sections.push(cur);
      cur = { title: line.replace(/^##\s+/, "").trim(), content: "" };
      started = true;
    } else if (/^#\s+/.test(line) && !started) {
      cur.title = line.replace(/^#\s+/, "").trim();
    } else {
      cur.content += (cur.content ? "\n" : "") + line;
    }
  }
  sections.push(cur);

  if (sections.length === 1 && !sections[0].content.trim() && !body.trim()) {
    return [{ title: noteTitle || "簡報", content: "" }];
  }

  // Drop empty leading title-only if we have real ## sections
  if (sections.length > 1 && !sections[0].content.trim() && sections[0].title === noteTitle) {
    // keep as cover
  }
  return sections;
}

export function applyLayoutToSlide(slide: Slide, layout: SlideLayoutId): Slide {
  const title =
    slide.blocks.find((b) => b.role === "title")?.text ||
    slide.blocks.find((b) => b.type === "text")?.text ||
    "未命名";
  const body = slide.blocks
    .filter((b) => b.role !== "title" && b.type === "text")
    .map((b) => b.text || "")
    .join("\n");
  const next = buildLayoutSlide(layout, title, body);
  return { ...next, id: slide.id };
}

export function clampBlock(b: SlideBlock): SlideBlock {
  const w = Math.min(100, Math.max(8, b.w));
  const h = Math.min(100, Math.max(6, b.h));
  const x = Math.min(100 - w, Math.max(0, b.x));
  const y = Math.min(100 - h, Math.max(0, b.y));
  return { ...b, x, y, w, h };
}

const LS_PREFIX = "cadence_deck_";

export function loadDeckLocal(noteId: string): SlideDeck | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + noteId);
    if (!raw) return null;
    const d = JSON.parse(raw) as SlideDeck;
    if (d?.version === 1 && Array.isArray(d.slides)) return d;
  } catch {
    /* ignore */
  }
  return null;
}

export function saveDeckLocal(noteId: string, deck: SlideDeck) {
  try {
    localStorage.setItem(LS_PREFIX + noteId, JSON.stringify({ ...deck, updatedAt: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function normalizeDeck(raw: unknown): SlideDeck | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as SlideDeck;
  if (d.version !== 1 || !Array.isArray(d.slides)) return null;
  return {
    version: 1,
    aspect: "16:9",
    theme: d.theme || "teal",
    slides: d.slides,
    updatedAt: d.updatedAt,
    sourceHash: d.sourceHash,
  };
}
