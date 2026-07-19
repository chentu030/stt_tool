/** Normalize URLs into embeddable preview sources */

import { askPrompt } from "@/lib/dialogs";

export type EmbedKind =
  | "youtube"
  | "vimeo"
  | "figma"
  | "loom"
  | "drive"
  | "pdf"
  | "ppt"
  | "web"
  | "office"
  | "link";

export type EmbedResolved = {
  kind: EmbedKind;
  /** iframe src when frameable; otherwise same as original for display */
  src: string;
  title: string;
  original: string;
  /** false → show link card (site blocks iframe / no embed URL) */
  frameable: boolean;
};

function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1).split("/")[0] || null;
    if (u.hostname.includes("youtube.com") || u.hostname.includes("youtube-nocookie.com")) {
      if (u.pathname.startsWith("/embed/")) return u.pathname.split("/")[2] || null;
      if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2] || null;
      if (u.pathname.startsWith("/live/")) return u.pathname.split("/")[2] || null;
      return u.searchParams.get("v");
    }
  } catch {
    return null;
  }
  return null;
}

function vimeoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("vimeo.com")) return null;
    if (u.hostname.includes("player.vimeo.com")) {
      return u.pathname.split("/").filter(Boolean)[1] || null;
    }
    const m = u.pathname.match(/\/(?:video\/)?(\d+)/);
    return m?.[1] || null;
  } catch {
    return null;
  }
}

function loomId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("loom.com")) return null;
    const m = u.pathname.match(/\/(?:share|embed)\/([a-zA-Z0-9]+)/);
    return m?.[1] || null;
  } catch {
    return null;
  }
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

function googleWorkspaceEmbed(original: string, fileId: string): EmbedResolved | null {
  const lower = original.toLowerCase();
  if (lower.includes("docs.google.com/document")) {
    return {
      kind: "drive",
      src: `https://docs.google.com/document/d/${fileId}/preview`,
      title: "Google 文件",
      original,
      frameable: true,
    };
  }
  if (lower.includes("docs.google.com/spreadsheets") || lower.includes("docs.google.com/spreadsheet")) {
    return {
      kind: "drive",
      src: `https://docs.google.com/spreadsheets/d/${fileId}/preview`,
      title: "Google 試算表",
      original,
      frameable: true,
    };
  }
  if (lower.includes("docs.google.com/presentation") || lower.includes("/presentation/")) {
    return {
      kind: "ppt",
      src: `https://docs.google.com/presentation/d/${fileId}/embed?start=false&loop=false&delayms=3000`,
      title: "Google 簡報",
      original,
      frameable: true,
    };
  }
  return null;
}

/** Hosts / paths that almost always refuse iframe embedding */
function isKnownNonFrameable(hostname: string, pathname = ""): boolean {
  const h = hostname.toLowerCase();
  const p = pathname.toLowerCase();
  const blockedExact = [
    "docs.cloud.google.com",
    "cloud.google.com",
    "console.cloud.google.com",
    "github.com",
    "gitlab.com",
    "notion.so",
    "www.notion.so",
    "medium.com",
    "www.medium.com",
    "linkedin.com",
    "www.linkedin.com",
    "facebook.com",
    "www.facebook.com",
    "instagram.com",
    "www.instagram.com",
    "twitter.com",
    "x.com",
    "www.x.com",
    "chatgpt.com",
    "chat.openai.com",
    "openai.com",
    "www.openai.com",
    "stackoverflow.com",
    "www.stackoverflow.com",
    "reddit.com",
    "www.reddit.com",
    "news.ycombinator.com",
    "vercel.com",
    "www.vercel.com",
    "ai.google.dev",
    "developers.google.com",
    "firebase.google.com",
  ];
  if (blockedExact.includes(h)) return true;
  if (h.endsWith(".notion.site")) return true;
  if (h === "www.google.com" && p.startsWith("/search")) return true;
  // Generic Google product docs / console (not Drive / Docs workspace embeds)
  if (h.endsWith(".google.com") && !h.includes("drive.") && !h.includes("docs.") && !h.includes("maps.")) {
    if (
      h.startsWith("docs.") ||
      h.includes("cloud") ||
      h.includes("developers") ||
      h.includes("support") ||
      h.includes("workspace")
    ) {
      return true;
    }
  }
  return false;
}

function linkCard(original: string, title?: string): EmbedResolved {
  let host = title || "網頁";
  try {
    host = new URL(original).hostname;
  } catch {
    /* keep */
  }
  return {
    kind: "link",
    src: original,
    title: title || host,
    original,
    frameable: false,
  };
}

export function faviconUrl(pageUrl: string): string {
  try {
    const host = new URL(pageUrl).hostname;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  } catch {
    return "";
  }
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
      frameable: true,
    };
  }

  const vimeo = vimeoId(original);
  if (vimeo) {
    return {
      kind: "vimeo",
      src: `https://player.vimeo.com/video/${vimeo}`,
      title: "Vimeo",
      original,
      frameable: true,
    };
  }

  const loom = loomId(original);
  if (loom) {
    return {
      kind: "loom",
      src: `https://www.loom.com/embed/${loom}`,
      title: "Loom",
      original,
      frameable: true,
    };
  }

  try {
    const u = new URL(original);
    // Figma
    if (u.hostname.includes("figma.com") && (u.pathname.includes("/file/") || u.pathname.includes("/design/") || u.pathname.includes("/proto/"))) {
      return {
        kind: "figma",
        src: `https://www.figma.com/embed?embed_host=cadence&url=${encodeURIComponent(original)}`,
        title: "Figma",
        original,
        frameable: true,
      };
    }
    // CodeSandbox
    if (u.hostname.includes("codesandbox.io")) {
      const id = u.pathname.match(/\/(?:s|p|embed)\/([^/?]+)/)?.[1];
      if (id) {
        return {
          kind: "web",
          src: `https://codesandbox.io/embed/${id}?fontsize=14&hidenavigation=1&theme=dark`,
          title: "CodeSandbox",
          original,
          frameable: true,
        };
      }
    }
    // CodePen
    if (u.hostname.includes("codepen.io")) {
      const m = u.pathname.match(/\/([^/]+)\/(?:pen|full|details)\/([^/?]+)/);
      if (m) {
        return {
          kind: "web",
          src: `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result`,
          title: "CodePen",
          original,
          frameable: true,
        };
      }
    }
  } catch {
    /* fall through */
  }

  const driveId = driveFileId(original);
  if (driveId) {
    const workspace = googleWorkspaceEmbed(original, driveId);
    if (workspace) return workspace;
    const isPdfish = /\/file\//i.test(original) && looksPdf(original, nameHint);
    return {
      kind: isPdfish ? "pdf" : "drive",
      src: drivePreviewUrl(driveId),
      title: "Google Drive",
      original,
      frameable: true,
    };
  }

  if (looksPdf(original, nameHint)) {
    return {
      kind: "pdf",
      src: original,
      title: nameHint || "PDF",
      original,
      frameable: true,
    };
  }

  if (looksPpt(original, nameHint)) {
    return {
      kind: "ppt",
      src: officeEmbedUrl(original),
      title: nameHint || "簡報",
      original,
      frameable: true,
    };
  }

  try {
    const u = new URL(original);
    if (u.protocol === "http:" || u.protocol === "https:") {
      // Sites that refuse framing → link card (avoids「拒絕連線」)
      if (isKnownNonFrameable(u.hostname, u.pathname)) {
        return linkCard(original, u.hostname);
      }
      // Generic websites: prefer link card. Browsers cannot bypass X-Frame-Options;
      // iframe-ing random pages usually shows "refused to connect".
      return linkCard(original, u.hostname);
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
