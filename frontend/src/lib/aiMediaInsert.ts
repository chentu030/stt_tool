/** Structured rich-media proposals from the global AI rail → note / canvas insert. */

import { isYoutubeUrl } from "@/lib/embedUrls";

export type AiMediaItemType = "youtube" | "image_url" | "image_generate";

export type AiMediaItem = {
  /** Stable id within one assistant message (for UI applied state). */
  id: string;
  type: AiMediaItemType;
  /** youtube / image_url */
  url?: string;
  title?: string;
  alt?: string;
  /** image_generate */
  prompt?: string;
  aspectRatio?: string;
};

export type AiMediaInsert = {
  items: AiMediaItem[];
};

export type AiCanvasMediaInsertDetail = {
  media: "image" | "youtube" | "link";
  url: string;
  title?: string;
};

export const AI_CANVAS_MEDIA_EVENT = "albireus:ai-canvas-media";

const FENCE_RE = /```albireus-media-insert\s*\n([\s\S]*?)```/i;

const ASPECTS = new Set([
  "1:1",
  "3:2",
  "2:3",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
]);

/** Heuristic: user wants images / video embeds in the open page. */
export function userAskedForMedia(prompt: string): boolean {
  const t = prompt.trim();
  if (!t) return false;
  return /插圖|配圖|圖片|生圖|生成圖|畫一張|畫一張圖|插入影片|嵌入影片|YouTube|Youtube|youtube|影片連結|影片網址|多媒體|圖文|科普文|部落格|圖解|示意圖|封面圖|插一張|加一張圖|加影片|找圖|配一段影片/.test(
    t
  );
}

export const MEDIA_INSERT_SYSTEM_RULES = `
當使用者要求為目前頁面「配圖／插圖／生成圖片／嵌入 YouTube 影片」時，除了簡短說明外，必須另外輸出一個可被一鍵插入的媒體區塊（僅在有此意圖時輸出）：
\`\`\`albireus-media-insert
[
  {"type":"youtube","url":"https://www.youtube.com/watch?v=…","title":"可選標題"},
  {"type":"image_url","url":"https://…","alt":"可選說明"},
  {"type":"image_generate","prompt":"英文或中文畫面描述","aspectRatio":"16:9","alt":"可選說明"}
]
\`\`\`
規則：
- type 只用 youtube｜image_url｜image_generate。
- youtube：必須是可公開播放的完整網址（youtube.com 或 youtu.be）；不要捏造不存在的影片 id。若不確定實際影片，改用 image_generate 配示意圖，並在說明中誠實告知。
- image_url：僅在使用者提供了明確圖片網址、或脈絡中已有可信 URL 時使用；不要編造圖床連結。
- image_generate：請寫清楚、具體的畫面描述（風格、主體、構圖）；aspectRatio 可選 1:1／16:9／9:16／4:3／3:4，預設 16:9。
- 一次最多 4 個項目；科普／圖文建議優先 image_generate +（若確定）youtube。
- 不要輸出尚未支援的媒體型別；不要假裝已寫入頁面——使用者會按「插入圖片／插入影片」才寫入。
- 區塊以外用繁體中文說明建議插入什麼、為什麼適合。
`.trim();

function normalizeAspect(raw: unknown): string | undefined {
  const s = String(raw || "").trim();
  if (!s) return undefined;
  return ASPECTS.has(s) ? s : undefined;
}

function coerceItem(raw: unknown, index: number): AiMediaItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const type = String(o.type || "").trim().toLowerCase();
  const id = `m${index + 1}`;

  if (type === "youtube") {
    const url = String(o.url || "").trim();
    if (!url || !isYoutubeUrl(url)) return null;
    const title = String(o.title || o.alt || "").trim().slice(0, 120) || undefined;
    return { id, type: "youtube", url, title };
  }

  if (type === "image_url" || type === "image") {
    const url = String(o.url || "").trim();
    if (!/^https?:\/\//i.test(url)) return null;
    const alt = String(o.alt || o.title || "").trim().slice(0, 160) || undefined;
    return { id, type: "image_url", url, alt };
  }

  if (type === "image_generate" || type === "generate" || type === "ai_image") {
    const prompt = String(o.prompt || o.description || "").trim();
    if (!prompt) return null;
    return {
      id,
      type: "image_generate",
      prompt: prompt.slice(0, 2000),
      aspectRatio: normalizeAspect(o.aspectRatio || o.aspect) || "16:9",
      alt: String(o.alt || o.title || "").trim().slice(0, 160) || undefined,
    };
  }

  return null;
}

export function parseAiMediaInsert(raw: string): {
  media: AiMediaInsert | null;
  displayText: string;
} {
  const m = raw.match(FENCE_RE);
  if (!m) return { media: null, displayText: raw };

  const body = m[1].trim();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    // tolerate trailing commas / single object
    try {
      const fixed = body.replace(/,\s*([\]}])/g, "$1");
      parsed = JSON.parse(fixed);
    } catch {
      return { media: null, displayText: raw };
    }
  }

  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown }).items)
      ? (parsed as { items: unknown[] }).items
      : parsed && typeof parsed === "object"
        ? [parsed]
        : [];

  const items = list
    .map((x, i) => coerceItem(x, i))
    .filter(Boolean)
    .slice(0, 4) as AiMediaItem[];

  if (!items.length) return { media: null, displayText: raw };

  const displayText = raw.replace(FENCE_RE, "").trim();
  return {
    media: { items },
    displayText:
      displayText ||
      `已準備 ${items.length} 項媒體，可一鍵插入目前頁面。`,
  };
}

export function mediaItemLabel(item: AiMediaItem): string {
  if (item.type === "youtube") return item.title ? `影片 · ${item.title}` : "YouTube 影片";
  if (item.type === "image_url") return item.alt ? `圖片 · ${item.alt}` : "網路圖片";
  return item.alt ? `AI 生圖 · ${item.alt}` : "AI 生成圖片";
}

export function mediaItemActionLabel(item: AiMediaItem): string {
  if (item.type === "youtube") return "插入影片";
  if (item.type === "image_url") return "插入圖片";
  return "生成並插入圖片";
}

/** Note markdown compatible with mdHtml / TipTap round-trip. */
export function mediaItemToNoteMarkdown(item: AiMediaItem & { url: string }): string {
  if (item.type === "youtube") {
    const title = (item.title || "YouTube").replace(/[\[\]]/g, "");
    return `\n\n[embed|youtube|${title}](${item.url})\n\n`;
  }
  const alt = (item.alt || item.title || "image").replace(/[\[\]]/g, "");
  return `\n\n![${alt}](${item.url})\n\n`;
}

/** Insert markdown at the note editor caret (RichNoteEditor listens). */
export function insertNoteMarkdownAtCursor(markdown: string): boolean {
  if (typeof window === "undefined") return false;
  const md = markdown.trim();
  if (!md) return false;
  window.dispatchEvent(new CustomEvent("cadence-insert-md", { detail: { markdown: md } }));
  return true;
}

export function requestCanvasMediaInsert(detail: AiCanvasMediaInsertDetail): boolean {
  if (typeof window === "undefined") return false;
  const url = detail.url.trim();
  if (!url) return false;
  window.dispatchEvent(new CustomEvent(AI_CANVAS_MEDIA_EVENT, { detail }));
  return true;
}
