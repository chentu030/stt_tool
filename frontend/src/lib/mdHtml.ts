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

turndown.addRule("wikiLink", {
  filter: (node) =>
    node.nodeName === "A" && !!(node as HTMLElement).getAttribute("data-wiki"),
  replacement: (_content, node) => {
    const el = node as HTMLElement;
    const title = (el.getAttribute("data-wiki") || "").trim();
    const label = (el.textContent || title).trim();
    if (!title) return label;
    if (label && label !== title) return `[[${title}|${label}]]`;
    return `[[${title}]]`;
  },
});

turndown.addRule("fontSize", {
  filter: (node) =>
    node.nodeName === "SPAN" &&
    !!(node as HTMLElement).style?.fontSize &&
    !(node as HTMLElement).getAttribute("data-math-inline") &&
    !(node as HTMLElement).getAttribute("data-text-color"),
  replacement: (content, node) => {
    const size = (node as HTMLElement).style.fontSize;
    if (!size || !content.trim()) return content;
    return `{fs:${size}}${content}{/fs}`;
  },
});

turndown.addRule("alignedParagraph", {
  filter: (node) => {
    if (node.nodeName !== "P" && !/^H[1-6]$/.test(node.nodeName)) return false;
    const align = (node as HTMLElement).style?.textAlign;
    return !!align && align !== "start" && align !== "left";
  },
  replacement: (content, node) => {
    const el = node as HTMLElement;
    const align = el.style.textAlign;
    const tag = node.nodeName.toLowerCase();
    const inner = content.trim();
    if (tag.startsWith("h")) {
      const level = tag[1];
      const hashes = "#".repeat(Number(level));
      return `\n\n${hashes} ${inner} <!--align:${align}-->\n\n`;
    }
    return `\n\n<p style="text-align:${align}">${inner}</p>\n\n`;
  },
});

turndown.addRule("table", {
  filter: "table",
  replacement: (_content, node) => {
    const table = node as HTMLTableElement;
    const rows = Array.from(table.querySelectorAll("tr"));
    if (!rows.length) return "";
    const lines: string[] = [];
    rows.forEach((tr, i) => {
      const cells = Array.from(tr.querySelectorAll("th,td")).map((c) =>
        (c.textContent || "").replace(/\|/g, "\\|").trim()
      );
      lines.push(`| ${cells.join(" | ")} |`);
      if (i === 0) {
        lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
      }
    });
    return `\n\n${lines.join("\n")}\n\n`;
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

export type WikiResolver = (title: string) => string | null;

/** Convert Cadence shortcuts into HTML TipTap understands */
function enrichMarkdown(md: string, resolveWiki?: WikiResolver): string {
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
    return `<div class="rich-embed rich-embed--${escapeAttr(kind)}" data-note-embed="1" data-kind="${escapeAttr(kind)}" data-title="${escapeAttr(title || kind)}" data-src="${escapeAttr(original)}" data-original="${escapeAttr(original)}"></div>`;
  });

  // Colored text: {c:#rrggbb}text{/c}
  s = s.replace(/\{c:([^}\n]+)\}([\s\S]*?)\{\/c\}/g, (_m, color: string, text: string) => {
    const c = escapeAttr(String(color).trim());
    return `<span style="color: ${c}" data-text-color="${c}">${escapeHtml(text)}</span>`;
  });

  // Font size: {fs:18px}text{/fs}
  s = s.replace(/\{fs:([^}\n]+)\}([\s\S]*?)\{\/fs\}/g, (_m, size: string, text: string) => {
    const fs = escapeAttr(String(size).trim());
    return `<span style="font-size: ${fs}">${escapeHtml(text)}</span>`;
  });

  // Heading align markers: ## Title <!--align:center-->
  s = s.replace(/^(#{1,3})\s+(.+?)\s*<!--align:(left|center|right|justify)-->\s*$/gm, (_m, hashes, title, align) => {
    const level = String(hashes).length;
    return `<h${level} style="text-align:${align}">${title}</h${level}>`;
  });

  // Wiki links [[Title]] or [[Title|alias]]
  s = s.replace(/\[\[([^\]|#\n]+)(?:\|([^\]\n]+))?\]\]/g, (_m, title: string, alias?: string) => {
    const t = String(title).trim();
    const label = escapeHtml((alias || title).trim());
    const id = resolveWiki?.(t) || null;
    if (id) {
      return `<a class="rich-wiki" data-wiki="${escapeAttr(t)}" href="/notes/${escapeAttr(id)}">${label}</a>`;
    }
    return `<a class="rich-wiki is-missing" data-wiki="${escapeAttr(t)}" href="#">${label}</a>`;
  });

  s = s.replace(/@@FENCE(\d+)@@/g, (_m, i) => fences[Number(i)] || "");
  return s;
}

export function markdownToHtml(md: string, resolveWiki?: WikiResolver): string {
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
  const withMedia = enrichMarkdown(withMarks, resolveWiki);
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
