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

function mediaPublicUrl(m: CanvasMedia): string {
  const orig = (m.originalUrl || "").trim();
  if (orig) return orig;
  const u = (m.url || "").trim();
  if (!u) return "";
  if (u.includes("/api/web/embed-proxy")) {
    try {
      const q = new URL(u, "https://local.invalid").searchParams.get("url");
      if (q) return q;
    } catch {
      /* keep */
    }
  }
  return u;
}

function packOneMedia(m: CanvasMedia): { label: string; block: string; ref: CanvasAiMediaRef | null } {
  const url = mediaPublicUrl(m);
  const title = (m.title || "").trim() || m.media;
  const parts: string[] = [`【媒體卡 · ${m.media}】`];
  if (url) parts.push(`網址：${url}`);
  if (title && title !== url) parts.push(`標題：${title}`);
  if (m.description?.trim()) parts.push(`說明：${m.description.trim()}`);
  if (m.extractedText?.trim()) {
    parts.push(`內文擷取：\n${m.extractedText.trim().slice(0, 12000)}`);
  }
  if (m.transcript?.trim()) {
    parts.push(`逐字稿：\n${m.transcript.trim().slice(0, 14000)}`);
  }
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
    // UI snippet must show the full URL (truncation was cutting ".pdf")
    label: url || title,
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
      const publicUrl = mediaPublicUrl(m);
      blocks.push(packed.block);
      selectionChunks.push(
        [
          publicUrl ? `網址：${publicUrl}` : "",
          m.extractedText?.trim() || m.transcript?.trim() || "",
          m.title && m.title !== publicUrl ? m.title : "",
        ]
          .filter(Boolean)
          .join("\n") || packed.label
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
  const labelJoined = labels.filter(Boolean).join(" · ");
  // Never mid-truncate a single URL (was cutting ".pdf"); only cap multi-select labels.
  const label =
    labels.length === 1
      ? labelJoined
      : labelJoined.length > 240
        ? `${labelJoined.slice(0, 240)}…`
        : labelJoined || "選取內容";
  return {
    label,
    selection: selectionChunks.filter(Boolean).join("\n\n").slice(0, 16000) || labels.join(" · "),
    context: blocks.join("\n\n---\n\n").slice(0, 20000),
    mediaRefs,
  };
}

/** First http(s) URL in clipboard / paste text. */
export function extractFirstHttpUrl(text: string): string | null {
  const m = String(text || "").match(/https?:\/\/[^\s<>"']+/i);
  if (!m) return null;
  // Strip trailing sentence punctuation — but never eat ".pdf" / ".pptx" etc.
  let url = m[0].replace(/[),;\]]+$/g, "");
  if (/\.$/.test(url) && !/\.[a-z0-9]{2,4}\.$/i.test(url)) {
    url = url.slice(0, -1);
  }
  // If paste ended with "file.pdf." keep the extension
  url = url.replace(/(\.[a-z0-9]{2,4})\.$/i, "$1");
  return url;
}
