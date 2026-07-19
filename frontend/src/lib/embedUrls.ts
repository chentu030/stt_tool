/** Normalize URLs into embeddable preview sources */

import { askPrompt } from "@/lib/dialogs";

export type EmbedKind = "youtube" | "drive" | "pdf" | "ppt" | "web" | "office";

export type EmbedResolved = {
  kind: EmbedKind;
  src: string;
  title: string;
  original: string;
};

function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1).split("/")[0] || null;
    if (u.hostname.includes("youtube.com")) {
      if (u.pathname.startsWith("/embed/")) return u.pathname.split("/")[2] || null;
      if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2] || null;
      return u.searchParams.get("v");
    }
  } catch {
    return null;
  }
  return null;
}

function driveFileId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("drive.google.com") && !u.hostname.includes("docs.google.com")) {
      return null;
    }
    const m = u.pathname.match(/\/(?:file|document|presentation|spreadsheets)\/d\/([^/]+)/);
    if (m) return m[1];
    const open = u.searchParams.get("id");
    if (open) return open;
  } catch {
    return null;
  }
  return null;
}

function looksPdf(url: string, nameHint = ""): boolean {
  const s = `${url} ${nameHint}`.toLowerCase();
  return /\.pdf(\?|#|$)/i.test(s) || s.includes("application/pdf");
}

function looksPpt(url: string, nameHint = ""): boolean {
  const s = `${url} ${nameHint}`.toLowerCase();
  return /\.(ppt|pptx|odp)(\?|#|$)/i.test(s);
}

/** Office Online viewer — works for publicly reachable URLs (incl. Firebase download tokens). */
export function officeEmbedUrl(fileUrl: string): string {
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileUrl)}`;
}

/** Google Drive preview iframe */
export function drivePreviewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/preview`;
}

export function resolveEmbedUrl(raw: string, nameHint = ""): EmbedResolved | null {
  const original = (raw || "").trim();
  if (!original) return null;

  const yt = youtubeId(original);
  if (yt) {
    return {
      kind: "youtube",
      src: `https://www.youtube.com/embed/${yt}`,
      title: "YouTube",
      original,
    };
  }

  const driveId = driveFileId(original);
  if (driveId) {
    const isDocs = /docs\.google\.com\/presentation/i.test(original);
    const isPdfish = /\/file\//i.test(original) && looksPdf(original, nameHint);
    return {
      kind: isDocs ? "ppt" : isPdfish ? "pdf" : "drive",
      src: drivePreviewUrl(driveId),
      title: isDocs ? "Google 簡報" : "Google Drive",
      original,
    };
  }

  if (looksPdf(original, nameHint)) {
    return {
      kind: "pdf",
      src: original,
      title: nameHint || "PDF",
      original,
    };
  }

  if (looksPpt(original, nameHint)) {
    return {
      kind: "ppt",
      src: officeEmbedUrl(original),
      title: nameHint || "簡報",
      original,
    };
  }

  try {
    const u = new URL(original);
    if (u.protocol === "http:" || u.protocol === "https:") {
      return {
        kind: "web",
        src: original,
        title: u.hostname,
        original,
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function promptInsertUrl(label: string): Promise<string | null> {
  return askPrompt({
    title: label,
    defaultValue: "https://",
    placeholder: "https://",
  }).then((url) => {
    if (url === null) return null;
    const t = url.trim();
    return t || null;
  });
}
