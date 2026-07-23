/** Pack canvas selection into text + media refs for AI. */

import type { CanvasDoc, CanvasMedia, Selectable } from "@/lib/canvasStore";

export type CanvasAiMediaRef = {
  kind: "youtube" | "pdf" | "web" | "link" | "video" | "audio" | "image" | "other";
  url: string;
  mimeType?: string;
  title?: string;
};

export type PackedCanvasSelection = {
  /** Short label for UI snippet */
  label: string;
  /** Primary selection text (transcript / extracted / sticky body) */
  selection: string;
  /** Richer context for the model */
  context: string;
  mediaRefs: CanvasAiMediaRef[];
};

function mediaKindForAi(m: CanvasMedia): CanvasAiMediaRef["kind"] {
  if (m.media === "youtube") return "youtube";
  if (m.media === "pdf") return "pdf";
  if (m.media === "web" || m.media === "link") return m.media === "web" ? "web" : "link";
  if (m.media === "video") return "video";
  if (m.media === "audio") return "audio";
  if (m.media === "image") return "image";
  return "other";
}

function packOneMedia(m: CanvasMedia): { label: string; block: string; ref: CanvasAiMediaRef | null } {
  const url = (m.originalUrl || m.url || "").trim();
  const title = (m.title || "").trim() || m.media;
  const parts: string[] = [`【媒體卡 · ${m.media}】`, `標題：${title}`];
  if (url) parts.push(`網址：${url}`);
  if (m.description?.trim()) parts.push(`說明：${m.description.trim()}`);
  if (m.extractedText?.trim()) {
    parts.push(`內文擷取：\n${m.extractedText.trim().slice(0, 12000)}`);
  }
  if (m.transcript?.trim()) {
    parts.push(`逐字稿：\n${m.transcript.trim().slice(0, 14000)}`);
  }
  const body =
    m.extractedText?.trim() ||
    m.transcript?.trim() ||
    [title !== "YouTube" && title !== "PDF" ? title : "", url].filter(Boolean).join("\n") ||
    title;
  const ref: CanvasAiMediaRef | null = url
    ? {
        kind: mediaKindForAi(m),
        url,
        mimeType:
          m.media === "youtube"
            ? "video/mp4"
            : m.media === "pdf"
              ? "application/pdf"
              : m.mime,
        title,
      }
    : null;
  return {
    label: url ? `${title} · ${url.replace(/^https?:\/\//, "").slice(0, 48)}` : title,
    block: parts.join("\n"),
    ref,
  };
}

/** Build AI payload from current canvas selection. */
export function packCanvasSelectionForAi(
  doc: CanvasDoc,
  selected: Selectable[],
  noteTitleById?: Map<string, string>
): PackedCanvasSelection | null {
  if (!selected.length) return null;
  const blocks: string[] = [];
  const labels: string[] = [];
  const selectionChunks: string[] = [];
  const mediaRefs: CanvasAiMediaRef[] = [];

  for (const s of selected) {
    if (s.type === "sticky") {
      const st = doc.stickies.find((x) => x.id === s.id);
      const t = st?.text?.trim();
      if (t) {
        blocks.push(`【便利貼】\n${t}`);
        selectionChunks.push(t);
        labels.push(t.slice(0, 40));
      }
    } else if (s.type === "shape") {
      const sh = doc.shapes.find((x) => x.id === s.id);
      const t = sh?.label?.trim();
      if (t) {
        blocks.push(`【形狀】\n${t}`);
        selectionChunks.push(t);
        labels.push(t.slice(0, 40));
      }
    } else if (s.type === "note") {
      const title = noteTitleById?.get(s.id)?.trim() || s.id;
      blocks.push(`【釘上筆記】\n${title}`);
      selectionChunks.push(title);
      labels.push(title.slice(0, 40));
    } else if (s.type === "media") {
      const m = (doc.media || []).find((x) => x.id === s.id);
      if (!m) continue;
      const packed = packOneMedia(m);
      blocks.push(packed.block);
      selectionChunks.push(
        m.extractedText?.trim() ||
          m.transcript?.trim() ||
          [m.title, m.originalUrl || m.url].filter(Boolean).join("\n")
      );
      labels.push(packed.label);
      if (packed.ref) mediaRefs.push(packed.ref);
    } else if (s.type === "section") {
      const sec = (doc.sections || []).find((x) => x.id === s.id);
      const t = sec?.title?.trim();
      if (t) {
        blocks.push(`【分區】\n${t}`);
        selectionChunks.push(t);
        labels.push(t);
      }
    }
  }

  if (!blocks.length && !mediaRefs.length) return null;
  return {
    label: labels.filter(Boolean).join(" · ").slice(0, 120) || "選取內容",
    selection: selectionChunks.filter(Boolean).join("\n\n").slice(0, 16000) || labels.join(" · "),
    context: blocks.join("\n\n---\n\n").slice(0, 20000),
    mediaRefs,
  };
}

/** First http(s) URL in clipboard / paste text. */
export function extractFirstHttpUrl(text: string): string | null {
  const m = String(text || "").match(/https?:\/\/[^\s<>"']+/i);
  if (!m) return null;
  return m[0].replace(/[),.;]+$/g, "");
}
