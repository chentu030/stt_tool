import { marked } from "marked";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

turndown.addRule("strikethrough", {
  filter: ["del", "s"] as unknown as TurndownService.Filter,
  replacement: (content) => `~~${content}~~`,
});

turndown.addRule("taskList", {
  filter: (node) =>
    node.nodeName === "LI" &&
    (node as HTMLElement).getAttribute?.("data-type") === "taskItem",
  replacement: (content, node) => {
    const checked = (node as HTMLElement).getAttribute("data-checked") === "true";
    const text = content.replace(/^\s*/, "").trim();
    return `- [${checked ? "x" : " "}] ${text}\n`;
  },
});

turndown.addRule("noteVideo", {
  filter: (node) =>
    node.nodeName === "VIDEO" && !!(node as HTMLElement).getAttribute("src"),
  replacement: (_content, node) => {
    const el = node as HTMLElement;
    const src = el.getAttribute("src") || "";
    const title = el.getAttribute("title") || "video";
    return `\n\n![video|${title}](${src})\n\n`;
  },
});

turndown.addRule("noteAudio", {
  filter: (node) =>
    node.nodeName === "AUDIO" && !!(node as HTMLElement).getAttribute("src"),
  replacement: (_content, node) => {
    const el = node as HTMLElement;
    const src = el.getAttribute("src") || "";
    const title = el.getAttribute("title") || "audio";
    return `\n\n![audio|${title}](${src})\n\n`;
  },
});

turndown.addRule("noteFile", {
  filter: (node) =>
    node.nodeName === "A" &&
    (node as HTMLElement).getAttribute("data-note-file") === "1",
  replacement: (_content, node) => {
    const el = node as HTMLElement;
    const href = el.getAttribute("href") || "";
    const name =
      el.getAttribute("data-name") ||
      el.textContent?.replace(/^📎\s*/, "").trim() ||
      "檔案";
    const size = el.getAttribute("data-size") || "";
    return `\n\n[file|${name}|${size}](${href})\n\n`;
  },
});

turndown.addRule("mathInline", {
  filter: (node) =>
    node.nodeName === "SPAN" &&
    (node as HTMLElement).getAttribute("data-math-inline") === "1",
  replacement: (_c, node) => {
    const f = (node as HTMLElement).getAttribute("data-formula") || "";
    return `$${f}$`;
  },
});

turndown.addRule("mathBlock", {
  filter: (node) =>
    node.nodeName === "DIV" &&
    (node as HTMLElement).getAttribute("data-math-block") === "1",
  replacement: (_c, node) => {
    const f = (node as HTMLElement).getAttribute("data-formula") || "";
    return `\n\n$$\n${f}\n$$\n\n`;
  },
});

turndown.addRule("noteEmbed", {
  filter: (node) =>
    node.nodeName === "DIV" &&
    (node as HTMLElement).getAttribute("data-note-embed") === "1",
  replacement: (_c, node) => {
    const el = node as HTMLElement;
    const kind = el.getAttribute("data-kind") || "web";
    const title = el.getAttribute("data-title") || "embed";
    const original = el.getAttribute("data-original") || el.getAttribute("data-src") || "";
    return `\n\n[embed|${kind}|${title}](${original})\n\n`;
  },
});

turndown.addRule("highlight", {
  filter: ["mark"],
  replacement: (content, node) => {
    const el = node as HTMLElement;
    const color =
      el.getAttribute("data-color") ||
      el.style?.backgroundColor ||
      "";
    const text = content.trim();
    if (!text) return "";
    if (color) return `==${text}=={${normalizeCssColor(color)}}`;
    return `==${text}==`;
  },
});

turndown.addRule("textColor", {
  filter: (node) => {
    if (node.nodeName !== "SPAN") return false;
    const el = node as HTMLElement;
    if (el.getAttribute("data-math-inline") === "1") return false;
    if (el.getAttribute("data-text-color")) return true;
    const color = el.style?.color;
    return !!color && color !== "inherit" && color !== "";
  },
  replacement: (content, node) => {
    const el = node as HTMLElement;
    const color = normalizeCssColor(
      el.getAttribute("data-text-color") || el.style?.color || ""
    );
    if (!color || !content.trim()) return content;
    return `{c:${color}}${content}{/c}`;
  },
});

function normalizeCssColor(c: string): string {
  const s = c.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return s.toLowerCase();
  const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) {
    const hex = (n: number) => n.toString(16).padStart(2, "0");
    return `#${hex(+m[1])}${hex(+m[2])}${hex(+m[3])}`;
  }
  return s;
}

marked.setOptions({ gfm: true, breaks: false });

function escapeAttr(s: string) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeHtml(s: string) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Convert Cadence shortcuts into HTML TipTap understands */
function enrichMarkdown(md: string): string {
  let s = md;

  // Protect code fences from math transforms
  const fences: string[] = [];
  s = s.replace(/```[\s\S]*?```/g, (block) => {
    fences.push(block);
    return `@@FENCE${fences.length - 1}@@`;
  });

  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_m, formula) => {
    const f = String(formula).trim();
    return `<div class="rich-math-block" data-math-block="1" data-formula="${escapeAttr(f)}"></div>`;
  });

  s = s.replace(/\$([^$\n]+?)\$/g, (_m, formula) => {
    const f = String(formula).trim();
    if (!f) return _m;
    return `<span class="rich-math-inline" data-math-inline="1" data-formula="${escapeAttr(f)}"></span>`;
  });

  s = s.replace(/!\[video(?:\|([^\]]*))?\]\(([^)]+)\)/g, (_m, title, src) => {
    const t = title ? ` title="${escapeAttr(title)}"` : "";
    return `<video class="rich-video" data-note-video="1" controls preload="metadata" src="${escapeAttr(src)}"${t}></video>`;
  });

  s = s.replace(/!\[audio(?:\|([^\]]*))?\]\(([^)]+)\)/g, (_m, title, src) => {
    const t = title ? ` title="${escapeAttr(title)}"` : "";
    return `<audio class="rich-audio" data-note-audio="1" controls preload="metadata" src="${escapeAttr(src)}"${t}></audio>`;
  });

  s = s.replace(/\[file\|([^\]|]+)(?:\|([^\]]*))?\]\(([^)]+)\)/g, (_m, name, size, href) => {
    const sizeAttr = size ? ` data-size="${escapeAttr(size)}"` : "";
    return `<a class="rich-file" data-note-file="1" data-name="${escapeAttr(name)}"${sizeAttr} href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">📎 ${escapeHtml(name)}${size ? ` · ${escapeHtml(size)}` : ""}</a>`;
  });

  s = s.replace(/\[embed\|([^\]|]+)\|([^\]]*)\]\(([^)]+)\)/g, (_m, kind, title, original) => {
    // src resolved at render time in TipTap from original via data; store original as both
    return `<div class="rich-embed rich-embed--${escapeAttr(kind)}" data-note-embed="1" data-kind="${escapeAttr(kind)}" data-title="${escapeAttr(title || kind)}" data-src="${escapeAttr(original)}" data-original="${escapeAttr(original)}"></div>`;
  });

  // Colored text: {c:#rrggbb}text{/c}
  s = s.replace(/\{c:([^}\n]+)\}([\s\S]*?)\{\/c\}/g, (_m, color: string, text: string) => {
    const c = escapeAttr(String(color).trim());
    return `<span style="color: ${c}" data-text-color="${c}">${escapeHtml(text)}</span>`;
  });

  s = s.replace(/@@FENCE(\d+)@@/g, (_m, i) => fences[Number(i)] || "");
  return s;
}

export function markdownToHtml(md: string): string {
  const raw = (md || "").trim();
  if (!raw) return "<p></p>";
  // Colored / plain highlights: ==text== or ==text=={#rrggbb}
  const withMarks = raw.replace(
    /==([^=\n]+?)==(?:\{([^}\n]+)\})?/g,
    (_m, text: string, color?: string) => {
      const t = escapeHtml(text);
      if (color) {
        const c = escapeAttr(color.trim());
        return `<mark data-color="${c}" style="background-color: ${c}">${t}</mark>`;
      }
      return `<mark>${t}</mark>`;
    }
  );
  const withMedia = enrichMarkdown(withMarks);
  return marked.parse(withMedia, { async: false }) as string;
}

export function htmlToMarkdown(html: string): string {
  if (!html || html === "<p></p>" || html === "<p><br></p>") return "";
  return turndown.turndown(html).trim();
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
