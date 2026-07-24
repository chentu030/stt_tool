import { marked } from "marked";
import TurndownService from "turndown";
import katex from "katex";
import { resolveEmbedUrl } from "@/lib/embedUrls";
import {
  formatEmbedToken,
  formatImageToken,
  layoutDataAttrString,
  parseEmbedMid,
  parseImageMid,
  readLayoutFromElement,
  DEFAULT_MEDIA_LAYOUT,
} from "@/lib/mediaLayout";
import DOMPurify from "isomorphic-dompurify";
import {
  decodeFormulaAttr,
  encodeFormulaAttr,
  normalizeLatexFormula,
} from "@/lib/latexNormalize";

/** Turndown skips "blank" nodes via blankReplacement — empty atom shells must be serialized here. */
function serializeBlankAtom(node: HTMLElement): string | null {
  if (node.nodeName === "SPAN") {
    if (
      node.getAttribute("data-math-inline") != null ||
      node.classList?.contains("rich-math-inline") === true
    ) {
      const f = normalizeLatexFormula(
        decodeFormulaAttr(node.getAttribute("data-formula") || "")
      );
      return f ? `$${f}$` : "";
    }
  }
  if (node.nodeName === "DIV") {
    if (
      node.getAttribute("data-math-block") != null ||
      node.classList?.contains("rich-math-block") === true
    ) {
      const f = normalizeLatexFormula(
        decodeFormulaAttr(node.getAttribute("data-formula") || "")
      );
      return f ? `\n\n$$\n${f}\n$$\n\n` : "";
    }
    if (
      node.getAttribute("data-note-embed") != null ||
      node.classList?.contains("rich-embed")
    ) {
      const kind = node.getAttribute("data-kind") || "web";
      const title = node.getAttribute("data-title") || "embed";
      const original =
        node.getAttribute("data-original") || node.getAttribute("data-src") || "";
      const layout = readLayoutFromElement(node);
      return `\n\n${formatEmbedToken(kind, title, original, layout)}\n\n`;
    }
    if (node.getAttribute("data-cadence-web") === "1") {
      const url = node.getAttribute("data-url") || "";
      const title = node.getAttribute("data-title") || "";
      return `\n\n[web|${title}](${url})\n\n`;
    }
    if (node.getAttribute("data-cadence-database") === "1") {
      const id = node.getAttribute("data-database-id") || "";
      const viewId = node.getAttribute("data-view-id") || "v_table";
      return id ? `\n\n[database|${viewId}](${id})\n\n` : "";
    }
    if (node.getAttribute("data-cadence-board") === "1") {
      const id = node.getAttribute("data-board-id") || "";
      return id ? `\n\n[board](${id})\n\n` : "";
    }
    if (node.getAttribute("data-cadence-canvas") === "1") {
      const id = node.getAttribute("data-canvas-id") || "";
      return id ? `\n\n[canvas](${id})\n\n` : "";
    }
    if (node.getAttribute("data-cadence-graph") === "1") {
      const id = node.getAttribute("data-graph-id") || "";
      return id ? `\n\n[graph](${id})\n\n` : "";
    }
    if (node.getAttribute("data-note-bookmark") === "1") {
      const href = node.getAttribute("data-href") || "";
      const title = node.getAttribute("data-title") || href || "書籤";
      return `\n\n[bookmark|${title}](${href})\n\n`;
    }
    if (node.getAttribute("data-note-toc") === "1") {
      return "\n\n<!-- toc -->\n\n";
    }
  }
  return null;
}

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  blankReplacement: (content, node) => {
    const atom = serializeBlankAtom(node as HTMLElement);
    if (atom != null) return atom;
    return (node as { isBlock?: boolean }).isBlock ? "\n\n" : "";
  },
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
    const text = content
      .replace(/\[[\sxX]?\]/g, "")
      .replace(/^\s+/, "")
      .replace(/\n+/g, " ")
      .trim();
    return `- [${checked ? "x" : " "}] ${text}\n`;
  },
});

turndown.addRule("noteVideo", {
  filter: (node) =>
    node.nodeName === "VIDEO" && !!(node as HTMLElement).getAttribute("src"),
  replacement: (_content, node) => {
    const el = node as HTMLElement;
    if (el.closest("[data-note-video-wrap]")) return "";
    const src = el.getAttribute("src") || "";
    const title = el.getAttribute("title") || "video";
    const loopOff = el.getAttribute("data-loop") === "0";
    const mid = loopOff ? `${title}|noloop` : title;
    return `\n![video|${mid}](${src})\n`;
  },
});

turndown.addRule("noteVideoWrap", {
  filter: (node) =>
    node.nodeName === "DIV" &&
    (node as HTMLElement).getAttribute("data-note-video-wrap") === "1",
  replacement: (_content, node) => {
    const wrap = node as HTMLElement;
    const video = wrap.querySelector("video[src]") as HTMLVideoElement | null;
    if (!video?.getAttribute("src")) return "";
    const src = video.getAttribute("src") || "";
    const title = video.getAttribute("title") || "video";
    const loopOff =
      wrap.getAttribute("data-loop") === "0" || video.getAttribute("data-loop") === "0";
    const mid = loopOff ? `${title}|noloop` : title;
    return `\n![video|${mid}](${src})\n`;
  },
});

turndown.addRule("noteAudioWrap", {
  filter: (node) =>
    node.nodeName === "DIV" &&
    (node as HTMLElement).getAttribute("data-note-audio-wrap") === "1",
  replacement: (_content, node) => {
    const wrap = node as HTMLElement;
    const audio = wrap.querySelector("audio[src]") as HTMLAudioElement | null;
    if (!audio?.getAttribute("src")) return "";
    const src = audio.getAttribute("src") || "";
    const title = audio.getAttribute("title") || "audio";
    return `\n![audio|${title}](${src})\n`;
  },
});

turndown.addRule("noteAudio", {
  filter: (node) =>
    node.nodeName === "AUDIO" && !!(node as HTMLElement).getAttribute("src"),
  replacement: (_content, node) => {
    const el = node as HTMLElement;
    // Prefer wrap rule when present
    if (el.closest("[data-note-audio-wrap]")) return "";
    const src = el.getAttribute("src") || "";
    const title = el.getAttribute("title") || "audio";
    return `\n![audio|${title}](${src})\n`;
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
  filter: (node) => {
    if (node.nodeName !== "SPAN") return false;
    const el = node as HTMLElement;
    return (
      el.getAttribute("data-math-inline") != null ||
      el.classList?.contains("rich-math-inline") === true
    );
  },
  replacement: (_c, node) => {
    const el = node as HTMLElement;
    const f = normalizeLatexFormula(
      decodeFormulaAttr(el.getAttribute("data-formula") || "") || (_c || "").replace(/^\$|\$$/g, "").trim()
    );
    if (!f) return "";
    return `$${f}$`;
  },
});

turndown.addRule("mathBlock", {
  filter: (node) => {
    if (node.nodeName !== "DIV") return false;
    const el = node as HTMLElement;
    return (
      el.getAttribute("data-math-block") != null ||
      el.classList?.contains("rich-math-block") === true
    );
  },
  replacement: (_c, node) => {
    const el = node as HTMLElement;
    const f = normalizeLatexFormula(
      decodeFormulaAttr(el.getAttribute("data-formula") || "") ||
        (_c || "").replace(/^\$\$|\$\$$/g, "").trim()
    );
    if (!f) return "";
    return `\n\n$$\n${f}\n$$\n\n`;
  },
});

turndown.addRule("cadenceDatabase", {
  filter: (node) =>
    node.nodeName === "DIV" &&
    (node as HTMLElement).getAttribute("data-cadence-database") === "1",
  replacement: (_c, node) => {
    const el = node as HTMLElement;
    const id = el.getAttribute("data-database-id") || "";
    const viewId = el.getAttribute("data-view-id") || "v_table";
    return `\n\n[database|${viewId}](${id})\n\n`;
  },
});

turndown.addRule("cadenceBoard", {
  filter: (node) =>
    node.nodeName === "DIV" &&
    (node as HTMLElement).getAttribute("data-cadence-board") === "1",
  replacement: (_c, node) => {
    const id = (node as HTMLElement).getAttribute("data-board-id") || "";
    return id ? `\n\n[board](${id})\n\n` : "";
  },
});

turndown.addRule("cadenceCanvas", {
  filter: (node) =>
    node.nodeName === "DIV" &&
    (node as HTMLElement).getAttribute("data-cadence-canvas") === "1",
  replacement: (_c, node) => {
    const id = (node as HTMLElement).getAttribute("data-canvas-id") || "";
    return id ? `\n\n[canvas](${id})\n\n` : "";
  },
});

turndown.addRule("cadenceGraph", {
  filter: (node) =>
    node.nodeName === "DIV" &&
    (node as HTMLElement).getAttribute("data-cadence-graph") === "1",
  replacement: (_c, node) => {
    const id = (node as HTMLElement).getAttribute("data-graph-id") || "";
    return id ? `\n\n[graph](${id})\n\n` : "";
  },
});

turndown.addRule("cadenceWeb", {
  filter: (node) =>
    node.nodeName === "DIV" &&
    (node as HTMLElement).getAttribute("data-cadence-web") === "1",
  replacement: (_c, node) => {
    const el = node as HTMLElement;
    const url = el.getAttribute("data-url") || "";
    const title = el.getAttribute("data-title") || "";
    return `\n\n[web|${title}](${url})\n\n`;
  },
});

turndown.addRule("noteEmbed", {
  filter: (node) => {
    if (node.nodeName !== "DIV") return false;
    const el = node as HTMLElement;
    return (
      el.getAttribute("data-note-embed") != null ||
      el.classList?.contains("rich-embed") === true
    );
  },
  replacement: (_c, node) => {
    const el = node as HTMLElement;
    // Prefer outer media frame if present
    const frame =
      (el.classList.contains("rich-media-frame") && el.getAttribute("data-note-embed") != null
        ? el
        : (el.closest(".rich-media-frame[data-note-embed]") as HTMLElement | null)) || el;
    const kind = frame.getAttribute("data-kind") || el.getAttribute("data-kind") || "web";
    const title = frame.getAttribute("data-title") || el.getAttribute("data-title") || "embed";
    const original =
      frame.getAttribute("data-original") ||
      el.getAttribute("data-original") ||
      frame.getAttribute("data-src") ||
      el.getAttribute("data-src") ||
      "";
    const layout = readLayoutFromElement(frame);
    return `\n\n${formatEmbedToken(kind, title, original, layout)}\n\n`;
  },
});

turndown.addRule("richImageLayout", {
  filter: (node) => {
    if (node.nodeName !== "DIV") return false;
    const el = node as HTMLElement;
    return (
      el.classList?.contains("rich-image-shell") === true ||
      (el.classList?.contains("rich-media-frame") === true && !!el.querySelector("img.rich-image"))
    );
  },
  replacement: (_c, node) => {
    const el = node as HTMLElement;
    const img = el.querySelector("img") as HTMLImageElement | null;
    if (!img?.getAttribute("src")) return "";
    const frame =
      (el.classList.contains("rich-media-frame")
        ? el
        : (el.querySelector(".rich-media-frame") as HTMLElement | null)) || el;
    const layout = readLayoutFromElement(frame);
    const src = img.getAttribute("src") || "";
    const alt = img.getAttribute("alt") || "";
    return `\n\n${formatImageToken(src, alt, layout, { hideUrlBar: true })}\n\n`;
  },
});

turndown.addRule("richImageBare", {
  filter: (node) => {
    if (node.nodeName !== "IMG") return false;
    const el = node as HTMLElement;
    if (el.closest(".rich-image-shell, .rich-media-frame, [data-note-embed]")) return false;
    return el.classList?.contains("rich-image") === true || el.hasAttribute("data-width-pct");
  },
  replacement: (_c, node) => {
    const img = node as HTMLImageElement;
    const layout = readLayoutFromElement(img);
    const src = img.getAttribute("src") || "";
    if (!src) return "";
    const alt = img.getAttribute("alt") || "";
    return `\n\n${formatImageToken(src, alt, layout, { hideUrlBar: true })}\n\n`;
  },
});

turndown.addRule("callout", {
  filter: (node) =>
    node.nodeName === "ASIDE" &&
    (node as HTMLElement).getAttribute("data-note-callout") === "1",
  replacement: (content, node) => {
    const tone = (node as HTMLElement).getAttribute("data-tone") || "info";
    const body = content.replace(/^\s+|\s+$/g, "").replace(/\n+/g, "\n> ");
    // Multi-block 素材: prefer fence so paragraphs survive round-trip
    if (tone === "source" && body.includes("\n> ")) {
      const plain = content.replace(/^\s+|\s+$/g, "");
      return `\n\n:::source\n${plain}\n:::\n\n`;
    }
    return `\n\n> [!${tone}] ${body}\n\n`;
  },
});

turndown.addRule("sourceFence", {
  filter: (node) =>
    node.nodeName === "ASIDE" &&
    (node as HTMLElement).getAttribute("data-note-source") === "1",
  replacement: (content) => {
    const body = content.replace(/^\s+|\s+$/g, "");
    return `\n\n:::source\n${body}\n:::\n\n`;
  },
});

turndown.addRule("toggleBlock", {
  filter: (node) =>
    node.nodeName === "DIV" &&
    (node as HTMLElement).getAttribute("data-note-toggle") === "1",
  replacement: (content, node) => {
    const el = node as HTMLElement;
    const title = el.getAttribute("data-title") || "詳細內容";
    const open = el.getAttribute("data-open") !== "0" ? " open" : "";
    const body = content.trim();
    // No trailing blank line — keeps audio/video flush under the toggle after reload.
    return `\n\n:::toggle${open} ${title}\n${body}\n:::`;
  },
});

turndown.addRule("toggleHeading", {
  filter: (node) =>
    node.nodeName === "DIV" &&
    (node as HTMLElement).getAttribute("data-note-toggle-heading") === "1",
  replacement: (content, node) => {
    const el = node as HTMLElement;
    const title = el.getAttribute("data-title") || "摺疊標題";
    const level = el.getAttribute("data-level") || "1";
    const open = el.getAttribute("data-open") !== "0" ? " open" : "";
    const body = content.trim();
    return `\n\n:::toggle-h${level}${open} ${title}\n${body}\n:::`;
  },
});

turndown.addRule("columns", {
  filter: (node) =>
    node.nodeName === "DIV" &&
    (node as HTMLElement).getAttribute("data-note-columns") === "1",
  replacement: (content, node) => {
    const count = (node as HTMLElement).getAttribute("data-count") || "2";
    // Outer fence uses 4 colons so nested :::column closers are not ambiguous.
    return `\n\n::::columns ${count}\n${content.trim()}\n::::\n\n`;
  },
});

turndown.addRule("column", {
  filter: (node) =>
    node.nodeName === "DIV" &&
    (node as HTMLElement).getAttribute("data-note-column") === "1",
  replacement: (content) => `\n:::column\n${content.trim()}\n:::\n`,
});

turndown.addRule("tocBlock", {
  filter: (node) =>
    (node.nodeName === "NAV" || node.nodeName === "DIV") &&
    (node as HTMLElement).getAttribute("data-note-toc") === "1",
  replacement: () => `\n\n<!--toc-->\n\n`,
});

turndown.addRule("bookmark", {
  filter: (node) => {
    if (node.nodeName !== "A" && node.nodeName !== "DIV") return false;
    return (node as HTMLElement).getAttribute("data-note-bookmark") === "1";
  },
  replacement: (_c, node) => {
    const el = node as HTMLElement;
    const href = el.getAttribute("data-href") || el.getAttribute("href") || "";
    const title =
      el.getAttribute("data-title") ||
      el.querySelector(".rich-bookmark-title")?.textContent ||
      href ||
      "書籤";
    return `\n\n[bookmark|${title}](${href})\n\n`;
  },
});

turndown.addRule("appCard", {
  filter: (node) =>
    node.nodeName === "A" &&
    (node as HTMLElement).getAttribute("data-note-app") === "1",
  replacement: (_c, node) => {
    const el = node as HTMLElement;
    const href = el.getAttribute("href") || "/";
    const kind = el.getAttribute("data-kind") || "app";
    const title = el.getAttribute("data-title") || "應用";
    const hint = el.getAttribute("data-hint") || "";
    return `\n\n[app|${kind}|${title}|${hint}](${href})\n\n`;
  },
});

turndown.addRule("templateBtn", {
  filter: (node) =>
    node.nodeName === "BUTTON" &&
    (node as HTMLElement).getAttribute("data-note-template-btn") === "1",
  replacement: (_c, node) => {
    const el = node as HTMLElement;
    const id = el.getAttribute("data-template") || "meeting";
    const label = (el.textContent || "插入範本").trim();
    return `\n\n[template|${id}|${label}](#)\n\n`;
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
    // Prefer HTML so TipTap colgroup / colwidth survives refresh.
    // (GFM pipes drop column widths.)
    const table = node as HTMLTableElement;
    return `\n\n${serializeRichTableHtml(table)}\n\n`;
  },
});

/** Keep TipTap column widths (colgroup / colwidth) in markdown HTML. */
function serializeRichTableHtml(table: HTMLTableElement): string {
  const clone = table.cloneNode(true) as HTMLTableElement;
  clone.classList.add("rich-table");

  const readPx = (el: Element | null): number | null => {
    if (!el) return null;
    const attr = el.getAttribute("width") || el.getAttribute("colwidth");
    if (attr) {
      const n = parseInt(attr.split(",")[0], 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
    const style = el.getAttribute("style") || "";
    const m = style.match(/(?:^|;)\s*width:\s*(\d+(?:\.\d+)?)px/i);
    if (m) {
      const n = Math.round(parseFloat(m[1]));
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  };

  // TipTap renderHTML writes <col style="width:Npx"> but parseHTML only reads
  // the width / colwidth attributes — normalize so refresh keeps sizes.
  const cols = Array.from(clone.querySelectorAll("colgroup > col"));
  cols.forEach((col) => {
    const w = readPx(col);
    if (w != null) {
      col.setAttribute("width", String(w));
      const style = (col.getAttribute("style") || "").replace(/(?:^|;)\s*width:\s*[^;]+;?/gi, "").trim();
      col.setAttribute("style", style ? `${style}; width: ${w}px` : `width: ${w}px`);
    }
  });

  const firstRow = clone.querySelector("tr");
  if (firstRow) {
    Array.from(firstRow.children).forEach((cell, i) => {
      if (!(cell instanceof HTMLElement)) return;
      if (cell.tagName !== "TH" && cell.tagName !== "TD") return;
      const w = readPx(cols[i] || null) || readPx(cell);
      if (w != null) {
        cell.setAttribute("colwidth", String(w));
      }
    });
  }

  // No colgroup yet — build one from first-row colwidth / width styles
  if (!clone.querySelector("colgroup") && firstRow) {
    const widths = Array.from(firstRow.children).map((cell) =>
      cell instanceof HTMLElement ? readPx(cell) : null
    );
    if (widths.some((w) => w != null && w > 0)) {
      const cg = clone.ownerDocument!.createElement("colgroup");
      widths.forEach((w) => {
        const col = clone.ownerDocument!.createElement("col");
        if (w != null && w > 0) {
          col.setAttribute("width", String(w));
          col.setAttribute("style", `width: ${w}px`);
        }
        cg.appendChild(col);
      });
      const tbody = clone.querySelector("tbody");
      clone.insertBefore(cg, tbody || clone.firstChild);
      const total = widths.reduce<number>((s, w) => s + (w || 0), 0);
      if (total > 0) clone.style.width = `${total}px`;
    }
  }

  return clone.outerHTML;
}

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

function decodeBasicEntities(s: string): string {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function colorFromHtmlAttrs(attrs: string): string {
  const data = attrs.match(/\bdata-(?:color|text-color)\s*=\s*["']([^"']+)["']/i);
  if (data?.[1]) return normalizeCssColor(data[1]);
  const bg = attrs.match(/\bbackground-color\s*:\s*([^;"']+)/i);
  if (bg?.[1]) return normalizeCssColor(bg[1].trim());
  const fg = attrs.match(/(?:^|[;\s])color\s*:\s*([^;"']+)/i);
  if (fg?.[1] && !/inherit/i.test(fg[1])) return normalizeCssColor(fg[1].trim());
  return "";
}

/** Peel one &amp;lt;/&amp;gt; layer when it wraps mark/span (nested escapeHtml cycles). */
function peelEncodedMarkEntities(s: string): string {
  let out = s;
  for (let i = 0; i < 4; i++) {
    if (!/&amp;lt;\/?(?:mark|span)\b/i.test(out)) break;
    out = out
      .replace(/&amp;lt;/gi, "&lt;")
      .replace(/&amp;gt;/gi, "&gt;")
      .replace(/&amp;quot;/gi, "&quot;")
      .replace(/&amp;#39;/gi, "&#39;");
  }
  return out;
}

/**
 * Recover highlighter / text-color that were saved as literal HTML (or &lt;mark&gt; text).
 * Those round-trips otherwise show raw tags after refresh.
 */
export function healHighlightArtifacts(md: string): string {
  if (!md) return md;
  let s = peelEncodedMarkEntities(md);

  // Entity-encoded marks: &lt;mark ...&gt;text&lt;/mark&gt;
  // Allow &quot; / &#39; inside attrs (common after escapeHtml → re-escape cycles).
  s = s.replace(
    /&lt;mark\b((?:[^&]|&(?!lt;|gt;))*?)&gt;([\s\S]*?)&lt;\/mark&gt;/gi,
    (_m, attrs: string, text: string) => {
      const color = colorFromHtmlAttrs(decodeBasicEntities(attrs));
      const t = decodeBasicEntities(text).replace(/<[^>]+>/g, "").replace(/\n+/g, " ").trim();
      if (!t) return "";
      return color ? `==${t}=={${color}}` : `==${t}==`;
    }
  );

  // Entity-encoded colored spans
  s = s.replace(
    /&lt;span\b((?:[^&]|&(?!lt;|gt;))*?(?:data-text-color|style\s*=\s*(?:&quot;|&#39;|["'])[^&]*?color\s:)(?:[^&]|&(?!lt;|gt;))*?)&gt;([\s\S]*?)&lt;\/span&gt;/gi,
    (_m, attrs: string, text: string) => {
      const color = colorFromHtmlAttrs(decodeBasicEntities(attrs));
      const t = decodeBasicEntities(text).replace(/<[^>]+>/g, "").replace(/\n+/g, " ").trim();
      if (!t) return "";
      if (!color) return t;
      return `{c:${color}}${t}{/c}`;
    }
  );

  // Raw <mark>…</mark> anywhere (toggle/column lines, mid-paragraph, or whole body)
  s = s.replace(/<mark\b([^>]*)>([\s\S]*?)<\/mark>/gi, (_m, attrs: string, text: string) => {
    const color = colorFromHtmlAttrs(attrs);
    const t = text.replace(/<[^>]+>/g, "").replace(/\n+/g, " ").trim();
    if (!t) return "";
    return color ? `==${t}=={${color}}` : `==${t}==`;
  });

  // Colored <span style="color:…"> / data-text-color
  s = s.replace(
    /<span\b([^>]*(?:data-text-color|style\s*=\s*["'][^"']*color\s:)[^>]*)>([\s\S]*?)<\/span>/gi,
    (_m, attrs: string, text: string) => {
      const color = colorFromHtmlAttrs(attrs);
      const t = text.replace(/<[^>]+>/g, "").replace(/\n+/g, " ").trim();
      if (!t) return "";
      if (!color) return t;
      return `{c:${color}}${t}{/c}`;
    }
  );

  return s;
}

/** ==text== / ==text=={#rrggbb} → <mark> (run after toggle/column escapeHtml). */
function applyHighlightMarkdown(md: string): string {
  return md.replace(
    /==([^=\n]+?)==(?:\{([^}\n]+)\})?/g,
    (_m, text: string, color?: string) => {
      const t = escapeHtml(text);
      if (color) {
        const c = escapeAttr(color.trim());
        // Match TipTap Highlight multicolor renderHTML (color: inherit).
        return `<mark data-color="${c}" style="background-color: ${c}; color: inherit">${t}</mark>`;
      }
      return `<mark>${t}</mark>`;
    }
  );
}

/**
 * Last-chance repair: if escapeHtml / marked left &lt;mark&gt; in the HTML string,
 * turn those entities back into real <mark> elements TipTap can parse.
 */
function healEscapedMarksInHtml(html: string): string {
  if (!html || !/&lt;mark\b/i.test(html)) return html;
  let s = peelEncodedMarkEntities(html);
  return s.replace(
    /&lt;mark\b((?:[^&]|&(?!lt;|gt;))*?)&gt;([\s\S]*?)&lt;\/mark&gt;/gi,
    (_m, attrs: string, text: string) => {
      const color = colorFromHtmlAttrs(decodeBasicEntities(attrs));
      const t = decodeBasicEntities(text).replace(/<[^>]+>/g, "").replace(/\n+/g, " ").trim();
      if (!t) return "";
      if (color) {
        const c = escapeAttr(color);
        return `<mark data-color="${c}" style="background-color: ${c}; color: inherit">${escapeHtml(t)}</mark>`;
      }
      return `<mark>${escapeHtml(t)}</mark>`;
    }
  );
}

/**
 * Repair math shells that were escapeHtml'd inside toggles (visible raw
 * `&lt;span class="rich-math-inline" …&gt;` instead of TipTap math nodes).
 */
function healEscapedMathInHtml(html: string): string {
  // Allow &quot; etc. between tag name and data-math-* (marked encodes attribute quotes).
  if (
    !html ||
    !/&lt;(?:span|div)\b(?:[^&]|&(?!lt;|gt;))*?data-math-(?:inline|block)/i.test(html)
  ) {
    return html;
  }
  let s = html;
  s = s.replace(
    /&lt;span\b((?:[^&]|&(?!lt;|gt;))*?data-math-inline(?:[^&]|&(?!lt;|gt;))*?)&gt;(?:&lt;\/span&gt;)?/gi,
    (_m, attrs: string) => {
      const decoded = decodeBasicEntities(attrs);
      const fm = decoded.match(/data-formula\s*=\s*["']([^"']*)["']/i);
      const formula = normalizeLatexFormula(decodeFormulaAttr(fm?.[1] || ""));
      if (!formula) return _m;
      return `<span class="rich-math-inline" data-math-inline="1" data-formula="${encodeFormulaAttr(formula)}"></span>`;
    }
  );
  s = s.replace(
    /&lt;div\b((?:[^&]|&(?!lt;|gt;))*?data-math-block(?:[^&]|&(?!lt;|gt;))*?)&gt;(?:&lt;\/div&gt;)?/gi,
    (_m, attrs: string) => {
      const decoded = decodeBasicEntities(attrs);
      const fm = decoded.match(/data-formula\s*=\s*["']([^"']*)["']/i);
      const formula = normalizeLatexFormula(decodeFormulaAttr(fm?.[1] || ""));
      if (!formula) return _m;
      return `<div class="rich-math-block" data-math-block="1" data-formula="${encodeFormulaAttr(formula)}"></div>`;
    }
  );
  return s;
}

/**
 * Toggle / column bodies: parse nested markdown (headings, lists, emphasis)
 * instead of escapeHtml line-wrapping. Body may already contain math/embed HTML
 * from earlier enrichMarkdown steps — marked leaves those tags intact.
 * `breaks: true` keeps transcript lines visible without requiring blank lines.
 */
function renderNestedMarkdownHtml(body: string): string {
  const trimmed = String(body || "").trim();
  if (!trimmed) return "<p></p>";
  const html = marked.parse(trimmed, { async: false, breaks: true }) as string;
  return String(html || "").trim() || "<p></p>";
}

marked.setOptions({ gfm: true, breaks: false });

function escapeAttr(s: string) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeHtml(s: string) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type WikiResolver = (title: string) => string | null;

/** Heal tokens Turndown escaped when old htmlToMarkdown parked raw `[…](…)` as text. */
function healEscapedEmbedTokens(md: string): string {
  const unescapeMd = (s: string) => s.replace(/\\([\\`*_{}[\]()#+.!|-])/g, "$1");
  let out = md;
  out = out.replace(
    /\\\[((?:database|board|canvas|graph|web|embed|file|bookmark|app|template)[^\]]*)\\\]\(([^)]*)\)/g,
    (_m, label, href) => `[${unescapeMd(label)}](${unescapeMd(href)})`
  );
  out = out.replace(
    /!\\\[((?:video|audio)[^\]]*)\\\]\(([^)]*)\)/g,
    (_m, label, src) => `![${unescapeMd(label)}](${unescapeMd(src)})`
  );
  // Already re-saved as fake math: $$ file|name|size $$ (url)
  out = out.replace(
    /\$\$\s*((?:file|bookmark|embed|web|database)\|[^$]+?)\s*\$\$\s*\n*\((https?:[^)]+)\)/g,
    (_m, label, href) => `[${String(label).trim().replace(/\n+/g, "")}](${href})`
  );
  return out;
}

function looksLikeEscapedEmbedFormula(formula: string): boolean {
  const f = formula.trim();
  return /^(?:database|board|canvas|graph|web|embed|file|bookmark|app)(?:\||$)/.test(f);
}

/** Convert Cadence shortcuts into HTML TipTap understands */
function enrichMarkdown(md: string, resolveWiki?: WikiResolver): string {
  let s = healEscapedEmbedTokens(md);

  // Protect code fences / inline code from math transforms
  const fences: string[] = [];
  s = s.replace(/```[\s\S]*?```/g, (block) => {
    fences.push(block);
    return `@@FENCE${fences.length - 1}@@`;
  });
  const inlines: string[] = [];
  s = s.replace(/`[^`\n]+`/g, (block) => {
    inlines.push(block);
    return `@@INLINE${inlines.length - 1}@@`;
  });

  // Park embed tokens so `\[…\]` / `$…$` math never swallows them (e.g. file names with _)
  const embPark: string[] = [];
  const parkEmb = (token: string) => {
    embPark.push(token);
    return `@@EMB${embPark.length - 1}@@`;
  };
  s = s.replace(
    /\[(?:database|board|canvas|graph|web|embed|file|bookmark|app|template)[^\]]*\]\([^)]*\)/g,
    (m) => parkEmb(m)
  );
  s = s.replace(/!\[(?:video|audio|image)[^\]]*\]\([^)]*\)/g, (m) => parkEmb(m));

  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (full, formula) => {
    const raw = String(formula).trim();
    if (looksLikeEscapedEmbedFormula(raw) || /^(?:file|bookmark|embed|web|database)\|/.test(raw)) {
      return full;
    }
    const f = normalizeLatexFormula(raw);
    return `<div class="rich-math-block" data-math-block="1" data-formula="${encodeFormulaAttr(f)}"></div>`;
  });
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (full, formula) => {
    const raw = String(formula).trim();
    if (looksLikeEscapedEmbedFormula(raw)) return full;
    const f = normalizeLatexFormula(raw);
    return `<div class="rich-math-block" data-math-block="1" data-formula="${encodeFormulaAttr(f)}"></div>`;
  });

  s = s.replace(/\$([^$\n]+?)\$/g, (_m, formula) => {
    const f = normalizeLatexFormula(String(formula).trim());
    if (!f) return _m;
    return `<span class="rich-math-inline" data-math-inline="1" data-formula="${encodeFormulaAttr(f)}"></span>`;
  });
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_m, formula) => {
    const f = normalizeLatexFormula(String(formula).trim());
    if (!f) return _m;
    return `<span class="rich-math-inline" data-math-inline="1" data-formula="${encodeFormulaAttr(f)}"></span>`;
  });

  s = s.replace(/@@EMB(\d+)@@/g, (_m, i) => embPark[Number(i)] || "");

  s = s.replace(/!\[video(?:\|([^\]]*))?\]\(([^)]+)\)/g, (_m, mid, src) => {
    const parts = String(mid || "")
      .split("|")
      .map((p) => p.trim())
      .filter(Boolean);
    let loop = true;
    const titleParts: string[] = [];
    for (const p of parts) {
      if (/^(noloop|once|loop=0)$/i.test(p)) {
        loop = false;
        continue;
      }
      if (/^(loop|loop=1)$/i.test(p)) {
        loop = true;
        continue;
      }
      titleParts.push(p);
    }
    const title = titleParts.join("|") || "video";
    const t = ` title="${escapeAttr(title)}"`;
    const loopAttr = loop ? ` loop data-loop="1"` : ` data-loop="0"`;
    return `<video class="rich-video" data-note-video="1" controls playsinline preload="metadata" src="${escapeAttr(src)}"${t}${loopAttr}></video>`;
  });

  s = s.replace(/!\[audio(?:\|([^\]]*))?\]\(([^)]+)\)/g, (_m, title, src) => {
    const t = title ? ` title="${escapeAttr(title)}"` : "";
    return `<audio class="rich-audio" data-note-audio="1" controls preload="metadata" src="${escapeAttr(src)}"${t}></audio>`;
  });

  s = s.replace(/!\[image(?:\|([^\]]*))?\]\(([^)]+)\)/g, (_m, mid, src) => {
    const parsed = parseImageMid(String(mid || ""));
    const layout = { ...DEFAULT_MEDIA_LAYOUT, ...parsed.layout };
    const data = layoutDataAttrString(layout);
    const alt = parsed.alt || "";
    const hideAttr = parsed.hideUrlBar ? ` data-hide-url-bar="1"` : "";
    return `<div class="rich-image-shell rich-media-frame" ${data}${hideAttr}><img class="rich-image" src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" ${data}${hideAttr} /></div>`;
  });

  s = s.replace(/\[file\|([^\]|]+)(?:\|([^\]]*))?\]\(([^)]+)\)/g, (_m, name, size, href) => {
    const sizeAttr = size ? ` data-size="${escapeAttr(size)}"` : "";
    return `<a class="rich-file" data-note-file="1" data-name="${escapeAttr(name)}"${sizeAttr} href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">📎 ${escapeHtml(name)}${size ? ` · ${escapeHtml(size)}` : ""}</a>`;
  });

  s = s.replace(/\[database\|([^\]]*)\]\(([^)]+)\)/g, (_m, viewId, databaseId) => {
    return `<div class="cdb-embed-shell" data-cadence-database="1" data-database-id="${escapeAttr(databaseId)}" data-view-id="${escapeAttr(viewId || "v_table")}"></div>`;
  });

  s = s.replace(/\[board\]\(([^)]+)\)/g, (_m, boardId) => {
    return `<div class="ws-board-embed-shell" data-cadence-board="1" data-board-id="${escapeAttr(boardId)}"></div>`;
  });

  s = s.replace(/\[canvas\]\(([^)]+)\)/g, (_m, canvasId) => {
    return `<div class="ws-canvas-embed-shell" data-cadence-canvas="1" data-canvas-id="${escapeAttr(canvasId)}"></div>`;
  });

  s = s.replace(/\[graph\]\(([^)]+)\)/g, (_m, graphId) => {
    return `<div class="ws-graph-embed-shell" data-cadence-graph="1" data-graph-id="${escapeAttr(graphId)}"></div>`;
  });

  s = s.replace(/\[web\|([^\]]*)\]\(([^)]*)\)/g, (_m, title, url) => {
    return `<div class="ws-web-embed-shell" data-cadence-web="1" data-url="${escapeAttr(url || "")}" data-title="${escapeAttr(title || "")}"></div>`;
  });

  s = s.replace(/\[embed\|([^\]]+)\]\(([^)]*)\)/g, (_m, mid, original) => {
    const raw = String(original || "").trim();
    const parsed = parseEmbedMid(String(mid || ""));
    const k = parsed.kind || "web";
    const t = parsed.title || k;
    const layoutMerged = {
      widthPct: parsed.layout.widthPct ?? 100,
      align: (parsed.layout.align ?? "center") as "left" | "center" | "right",
      wrap: (parsed.layout.wrap ?? "inline") as
        | "inline"
        | "floatLeft"
        | "floatRight"
        | "break"
        | "front"
        | "behind",
      offsetX: parsed.layout.offsetX ?? 8,
      offsetY: parsed.layout.offsetY ?? 8,
    };
    const data = layoutDataAttrString(layoutMerged);
    if (!raw) {
      const token = formatEmbedToken(k, t, "", layoutMerged);
      return `<div class="rich-embed rich-embed--${escapeAttr(k)} is-empty rich-media-frame" data-note-embed="1" data-kind="${escapeAttr(k)}" data-title="${escapeAttr(t)}" data-src="" data-original="" data-frameable="1" ${data}>${escapeHtml(token)}</div>`;
    }
    const emb = resolveEmbedUrl(raw, String(t || ""));
    const kind = emb?.kind || k;
    const src = emb?.src || raw;
    const title = t || emb?.title || kind;
    const frameable = emb ? emb.frameable : kind !== "link" && kind !== "web";
    const cardClass = frameable ? "" : " rich-embed--card";
    const token = formatEmbedToken(kind, title, raw, layoutMerged);
    return `<div class="rich-embed rich-embed--${escapeAttr(kind)}${cardClass} rich-media-frame" data-note-embed="1" data-kind="${escapeAttr(kind)}" data-title="${escapeAttr(title)}" data-src="${escapeAttr(src)}" data-original="${escapeAttr(raw)}" data-frameable="${frameable ? "1" : "0"}" ${data}>${escapeHtml(token)}</div>`;
  });

  s = s.replace(/\[bookmark\|([^\]]*)\]\(([^)]*)\)/g, (_m, title, href) => {
    const h = String(href || "").trim();
    const t = String(title || h || "書籤").trim() || "書籤";
    return `<div class="rich-bookmark${h ? "" : " is-empty"}" data-note-bookmark="1" data-title="${escapeAttr(t)}" data-href="${escapeAttr(h)}"><span class="rich-bookmark-label">書籤</span><span class="rich-bookmark-title">${escapeHtml(t)}</span><span class="rich-bookmark-url">${escapeHtml(h)}</span></div>`;
  });

  s = s.replace(/\[app\|([^\]|]+)\|([^\]|]*)\|([^\]]*)\]\(([^)]+)\)/g, (_m, kind, title, hint, href) => {
    return `<a class="rich-app-card rich-app-card--${escapeAttr(kind)}" data-note-app="1" data-kind="${escapeAttr(kind)}" data-title="${escapeAttr(title || kind)}" data-hint="${escapeAttr(hint || "")}" href="${escapeAttr(href)}"><strong>${escapeHtml(title || kind)}</strong><span>${escapeHtml(hint || href)}</span></a>`;
  });

  s = s.replace(/\[template\|([^\]|]+)\|([^\]]*)\]\(#\)/g, (_m, id, label) => {
    return `<button class="rich-template-btn" type="button" data-note-template-btn="1" data-template="${escapeAttr(id)}">${escapeHtml(label || "插入範本")}</button>`;
  });

  s = s.replace(/<!--\s*toc\s*-->/gi, () => {
    return `<nav class="rich-toc" data-note-toc="1"><p class="rich-toc-label">目錄</p></nav>`;
  });

  // Toggle heading first (before plain :::toggle)
  s = s.replace(
    /:::toggle-h([1-4])(\s+open)?\s+([^\n]+)\n([\s\S]*?):::/g,
    (_m, level, openFlag, title, body) => {
      const open = openFlag ? "1" : "0";
      const inner = renderNestedMarkdownHtml(String(body));
      return `<div class="rich-toggle-heading rich-toggle-heading--h${level}" data-note-toggle-heading="1" data-level="${level}" data-title="${escapeAttr(String(title).trim())}" data-open="${open}">${inner}</div>`;
    }
  );

  // Toggle fence: :::toggle open Title\n...\n:::
  // Without `open` → collapsed. Parse body as nested markdown (not escapeHtml lines)
  // so AI 摘要 / headings / lists / math render like the main editor.
  s = s.replace(/:::toggle(?!-h)(\s+open)?\s+([^\n]+)\n([\s\S]*?):::/g, (_m, openFlag, title, body) => {
    const open = openFlag ? "1" : "0";
    const inner = renderNestedMarkdownHtml(String(body));
    return `<div class="rich-toggle" data-note-toggle="1" data-title="${escapeAttr(String(title).trim())}" data-open="${open}">${inner}</div>`;
  });

  // Columns: ::::columns 2 … :::: (4-colon outer so :::column closers don't truncate)
  s = s.replace(/::::columns\s+([2-5])\n([\s\S]*?)::::/g, (_m, count, inner) => {
    const cols = String(inner).match(/:::column\n([\s\S]*?):::/g) || [];
    const htmlCols = cols
      .map((c) => {
        const body = c.replace(/^:::column\n/, "").replace(/:::$/, "").trim();
        return `<div class="rich-column" data-note-column="1"><p>${escapeHtml(body)}</p></div>`;
      })
      .join("");
    return `<div class="rich-columns rich-columns--${count}" data-note-columns="1" data-count="${count}">${htmlCols}</div>`;
  });
  // Legacy :::columns … ::: — recover all :::column chunks even if outer fence was truncated
  s = s.replace(/:::columns\s+([2-5])\n([\s\S]*?)(?=\n::::|\n:::toggle|\n#|\n\[|\n```|$)/g, (_m, count, inner) => {
    const cols = String(inner).match(/:::column\n([\s\S]*?):::/g) || [];
    if (!cols.length) return _m;
    const htmlCols = cols
      .map((c) => {
        const body = c.replace(/^:::column\n/, "").replace(/:::$/, "").trim();
        return `<div class="rich-column" data-note-column="1"><p>${escapeHtml(body)}</p></div>`;
      })
      .join("");
    return `<div class="rich-columns rich-columns--${count}" data-note-columns="1" data-count="${count}">${htmlCols}</div>`;
  });

  // Source material fence: :::source … :::
  s = s.replace(/:::source(?:\s+[^\n]*)?\n([\s\S]*?):::/gi, (_m, body) => {
    const inner = String(body || "").trim() || "素材";
    const paras = inner
      .split(/\n\n+/)
      .map((p) => `<p>${escapeHtml(p.replace(/\n/g, " ").trim())}</p>`)
      .join("");
    return `<aside class="rich-callout rich-callout--source" data-note-callout="1" data-tone="source">${paras}</aside>`;
  });

  // Callout: > [!tone] text  (single line; multiline becomes blockquote after marked — also catch raw)
  s = s.replace(/^>\s*\[!(\w+|素材)\]\s*(.*)$/gm, (_m, tone, text) => {
    const t = tone === "素材" ? "source" : String(tone);
    return `<aside class="rich-callout rich-callout--${escapeAttr(t)}" data-note-callout="1" data-tone="${escapeAttr(t)}"><p>${escapeHtml(String(text).trim() || (t === "source" ? "素材" : "提示"))}</p></aside>`;
  });

  // Highlights: ==text== / ==text=={#rrggbb}
  // After toggle/column HTML conversion so ==…== inside nested bodies still matches.
  s = applyHighlightMarkdown(s);

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
  s = s.replace(/^(#{1,4})\s+(.+?)\s*<!--align:(left|center|right|justify)-->\s*$/gm, (_m, hashes, title, align) => {
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

  s = s.replace(/@@INLINE(\d+)@@/g, (_m, i) => inlines[Number(i)] || "");
  s = s.replace(/@@FENCE(\d+)@@/g, (_m, i) => fences[Number(i)] || "");
  return s;
}

export function markdownToHtml(md: string, resolveWiki?: WikiResolver): string {
  const raw = tightenMediaAdjacencyMd(healHighlightArtifacts((md || "").trim()));
  if (!raw) return "<p></p>";
  // ==highlight== is applied inside enrichMarkdown (after toggle/column conversion).
  const withMedia = enrichMarkdown(raw, resolveWiki);
  const html = marked.parse(withMedia, { async: false }) as string;
  const normalized = wrapBareTablesHtml(
    normalizeTableColWidths(normalizeTaskListHtml(normalizeBlockMediaHtml(html)))
  );
  // If toggle escapeHtml historically left &lt;mark&gt; / &lt;span data-math-…&gt;, restore nodes.
  return sanitizeNoteHtml(healEscapedMathInHtml(healEscapedMarksInHtml(normalized)));
}

/** Strip XSS vectors while keeping TipTap / media data-* attributes. */
function sanitizeNoteHtml(html: string): string {
  if (!html) return html;
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_TAGS: ["iframe", "video", "audio", "source", "colgroup", "col", "mark"],
    ADD_ATTR: [
      "target",
      "allow",
      "allowfullscreen",
      "frameborder",
      "referrerpolicy",
      "loading",
      "controls",
      "colwidth",
      "width",
      "height",
      "srcset",
      "sizes",
      "poster",
      "playsinline",
      "type",
      "style",
      "class",
      "id",
      "role",
      "aria-label",
      "aria-hidden",
      "tabindex",
      "contenteditable",
      "draggable",
      "spellcheck",
    ],
    ALLOW_DATA_ATTR: true,
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
}

/** TipTap parseColwidth reads col[width] / td[colwidth], not style="width:…px". */
function normalizeTableColWidths(html: string): string {
  if (!html || !/<table\b/i.test(html) || typeof DOMParser === "undefined") return html;
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("table").forEach((table) => {
      const cols = Array.from(table.querySelectorAll("colgroup > col"));
      cols.forEach((col) => {
        if (col.getAttribute("width")) return;
        const m = (col.getAttribute("style") || "").match(/width:\s*(\d+(?:\.\d+)?)px/i);
        if (m) col.setAttribute("width", String(Math.round(parseFloat(m[1]))));
      });
      const firstRow = table.querySelector("tr");
      if (!firstRow) return;
      Array.from(firstRow.children).forEach((cell, i) => {
        if (!(cell instanceof HTMLElement)) return;
        if (cell.tagName !== "TH" && cell.tagName !== "TD") return;
        if (cell.getAttribute("colwidth")) return;
        const colW = cols[i]?.getAttribute("width");
        if (colW) cell.setAttribute("colwidth", colW);
      });
    });
    return doc.body.innerHTML;
  } catch {
    return html;
  }
}

/** Ensure GFM tables get a horizontal scroll shell (TipTap also uses .tableWrapper). */
function wrapBareTablesHtml(html: string): string {
  if (!html || !/<table\b/i.test(html)) return html;
  if (typeof DOMParser === "undefined") {
    return html.replace(/<table\b[\s\S]*?<\/table>/gi, (table) => {
      return `<div class="tableWrapper">${table}</div>`;
    });
  }
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("table").forEach((table) => {
      const parent = table.parentElement;
      if (parent?.classList.contains("tableWrapper")) return;
      const wrap = doc.createElement("div");
      wrap.className = "tableWrapper";
      parent?.insertBefore(wrap, table);
      wrap.appendChild(table);
    });
    return doc.body.innerHTML;
  } catch {
    return html;
  }
}

/** Markdown → HTML with KaTeX already rendered (for AI chat / read-only views). */
export function markdownToDisplayHtml(md: string, resolveWiki?: WikiResolver): string {
  const html = markdownToHtml(md, resolveWiki);
  if (!html || typeof DOMParser === "undefined") return html;
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const fill = (el: Element, displayMode: boolean) => {
      const f = normalizeLatexFormula(
        decodeFormulaAttr(el.getAttribute("data-formula") || "")
      );
      if (!f) return;
      try {
        el.innerHTML = katex.renderToString(f, {
          throwOnError: false,
          displayMode,
          strict: "ignore",
        });
      } catch {
        el.textContent = displayMode ? `$$${f}$$` : `$${f}$`;
      }
    };
    doc.querySelectorAll("[data-math-inline], .rich-math-inline").forEach((el) => fill(el, false));
    doc.querySelectorAll("[data-math-block], .rich-math-block").forEach((el) => fill(el, true));
    return doc.body.innerHTML;
  } catch {
    return html;
  }
}

/**
 * marked emits GFM checkboxes as disabled <input> inside plain <ul>/<li>.
 * TipTap TaskList only accepts ul[data-type=taskList] + li[data-type=taskItem].
 */
function normalizeTaskListHtml(html: string): string {
  if (!/<input[^>]*type=["']?checkbox/i.test(html)) return html;
  return html.replace(/<ul>([\s\S]*?)<\/ul>/gi, (full, inner: string) => {
    if (!/<input[^>]*type=["']?checkbox/i.test(inner)) return full;
    const items: string[] = [];
    const liRe = /<li>([\s\S]*?)<\/li>/gi;
    let m: RegExpExecArray | null;
    while ((m = liRe.exec(inner))) {
      const li = m[1];
      const checked = /\bchecked\b/i.test(li);
      let body = li.replace(/<input[^>]*>/gi, "").trim();
      if (!body) body = "<p></p>";
      else if (!/^<(p|h[1-6]|div|ul|ol|blockquote)\b/i.test(body)) {
        body = `<p>${body}</p>`;
      }
      items.push(
        `<li data-type="taskItem" data-checked="${checked ? "true" : "false"}">` +
          `<label contenteditable="false"><input type="checkbox"${checked ? " checked" : ""}><span></span></label>` +
          `<div>${body}</div></li>`
      );
    }
    if (!items.length) return full;
    return `<ul data-type="taskList">${items.join("")}</ul>`;
  });
}

/** True when clipboard text has LaTeX delimiters worth converting on paste. */
export function clipboardHasLatex(text: string): boolean {
  const s = text || "";
  if (!s.includes("$") && !s.includes("\\(") && !s.includes("\\[")) return false;
  if (/\$\$[\s\S]+?\$\$/.test(s)) return true;
  if (/\\\[[\s\S]+?\\\]/.test(s)) return true;
  if (/\\\([\s\S]+?\\\)/.test(s)) return true;
  // Inline $...$ — accept letter/command formulas; skip bare currency like $5
  const inline = /\$([^$\n]{1,400})\$/g;
  let m: RegExpExecArray | null;
  while ((m = inline.exec(s))) {
    const f = m[1].trim();
    if (!f) continue;
    if (/^[\d.,]+$/.test(f)) continue;
    if (/[a-zA-Z\\_^{}=]/.test(f)) return true;
  }
  return false;
}

/**
 * TipTap atom shells are often empty attribute-only tags. Turndown drops blank
 * nodes, so we expand them before conversion. Injecting raw `[…](…)` as text
 * gets escaped (`\[database|v\_table\](id)`), which then fails to rehydrate —
 * use opaque placeholders through Turndown, then restore real tokens.
 */
export function htmlToMarkdown(html: string): string {
  if (!html || html === "<p></p>" || html === "<p><br></p>") return "";
  let input = html;
  const atoms: string[] = [];
  const park = (token: string) => {
    atoms.push(token);
    return `@@ATOM${atoms.length - 1}@@`;
  };
  if (typeof DOMParser !== "undefined") {
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      doc.querySelectorAll("[data-math-inline], .rich-math-inline").forEach((el) => {
        const f = normalizeLatexFormula(
          decodeFormulaAttr(el.getAttribute("data-formula") || "")
        );
        if (!f) {
          el.remove();
          return;
        }
        el.replaceWith(doc.createTextNode(park(`$${f}$`)));
      });
      doc.querySelectorAll("[data-math-block], .rich-math-block").forEach((el) => {
        const f = normalizeLatexFormula(
          decodeFormulaAttr(el.getAttribute("data-formula") || "")
        );
        if (!f) {
          el.remove();
          return;
        }
        // Recover file/embed mistaken for math (URL often left in the next node)
        if (looksLikeEscapedEmbedFormula(f) || /^(?:file|bookmark|embed|web|database)\|/.test(f)) {
          let href = "";
          let n: ChildNode | null = el.nextSibling;
          while (n && n.nodeType === 3 && !String(n.textContent || "").trim()) {
            n = n.nextSibling;
          }
          const takeUrl = (text: string) => {
            const m = text.match(/^\s*\((https?:[^)]+)\)\s*$/);
            return m ? m[1] : "";
          };
          if (n && n.nodeType === 3) {
            const t = String(n.textContent || "");
            const m = t.match(/^\s*\((https?:[^)]+)\)/);
            if (m) {
              href = m[1];
              n.textContent = t.replace(/^\s*\((https?:[^)]+)\)/, "");
            }
          } else if (n && (n as HTMLElement).nodeName === "P") {
            href = takeUrl(String((n as HTMLElement).textContent || ""));
            if (href) (n as HTMLElement).remove();
          }
          if (href) {
            el.replaceWith(doc.createTextNode(park(`\n\n[${f.trim()}](${href})\n\n`)));
            return;
          }
        }
        el.replaceWith(doc.createTextNode(park(`\n\n$$\n${f}\n$$\n\n`)));
      });
      doc.querySelectorAll("[data-note-embed], .rich-embed").forEach((el) => {
        if (el.closest(".rich-media-frame-body") && !el.classList.contains("rich-media-frame")) {
          // Inner content host — prefer outer frame if present
          const outer = el.closest(".rich-media-frame[data-note-embed]");
          if (outer && outer !== el) return;
        }
        const frame =
          (el.classList.contains("rich-media-frame")
            ? el
            : el.closest(".rich-media-frame[data-note-embed]")) || el;
        const kind = frame.getAttribute("data-kind") || "web";
        const title = frame.getAttribute("data-title") || "embed";
        const original =
          frame.getAttribute("data-original") || frame.getAttribute("data-src") || "";
        const layout = readLayoutFromElement(frame);
        const p = doc.createElement("p");
        p.textContent = park(`\n\n${formatEmbedToken(kind, title, original, layout)}\n\n`);
        (el.classList.contains("rich-media-frame") ? el : frame).replaceWith(p);
      });
      doc.querySelectorAll("[data-cadence-database]").forEach((el) => {
        const id = el.getAttribute("data-database-id") || "";
        const viewId = el.getAttribute("data-view-id") || "v_table";
        if (!id) {
          el.remove();
          return;
        }
        el.replaceWith(doc.createTextNode(park(`\n\n[database|${viewId}](${id})\n\n`)));
      });
      doc.querySelectorAll("[data-cadence-board]").forEach((el) => {
        const id = el.getAttribute("data-board-id") || "";
        if (!id) {
          el.remove();
          return;
        }
        el.replaceWith(doc.createTextNode(park(`\n\n[board](${id})\n\n`)));
      });
      doc.querySelectorAll("[data-cadence-canvas]").forEach((el) => {
        const id = el.getAttribute("data-canvas-id") || "";
        if (!id) {
          el.remove();
          return;
        }
        el.replaceWith(doc.createTextNode(park(`\n\n[canvas](${id})\n\n`)));
      });
      doc.querySelectorAll("[data-cadence-graph]").forEach((el) => {
        const id = el.getAttribute("data-graph-id") || "";
        if (!id) {
          el.remove();
          return;
        }
        el.replaceWith(doc.createTextNode(park(`\n\n[graph](${id})\n\n`)));
      });
      doc.querySelectorAll("[data-cadence-web]").forEach((el) => {
        const url = el.getAttribute("data-url") || "";
        const title = el.getAttribute("data-title") || "";
        el.replaceWith(doc.createTextNode(park(`\n\n[web|${title}](${url})\n\n`)));
      });
      doc.querySelectorAll("[data-note-video-wrap]").forEach((el) => {
        const video = el.querySelector("video[src]");
        const src = video?.getAttribute("src") || "";
        const title = video?.getAttribute("title") || "video";
        if (!src) {
          el.remove();
          return;
        }
        const loopOff =
          el.getAttribute("data-loop") === "0" || video?.getAttribute("data-loop") === "0";
        const mid = loopOff ? `${title}|noloop` : title;
        el.replaceWith(doc.createTextNode(park(`\n![video|${mid}](${src})\n`)));
      });
      doc.querySelectorAll("[data-note-video]").forEach((el) => {
        if (el.closest("[data-note-video-wrap]")) return;
        const src = el.getAttribute("src") || "";
        const title = el.getAttribute("title") || "video";
        if (!src) {
          el.remove();
          return;
        }
        const loopOff = el.getAttribute("data-loop") === "0";
        const mid = loopOff ? `${title}|noloop` : title;
        el.replaceWith(doc.createTextNode(park(`\n![video|${mid}](${src})\n`)));
      });
      doc.querySelectorAll("[data-note-audio-wrap]").forEach((el) => {
        const audio = el.querySelector("audio[src]");
        const src = audio?.getAttribute("src") || "";
        const title = audio?.getAttribute("title") || "audio";
        if (!src) {
          el.remove();
          return;
        }
        el.replaceWith(doc.createTextNode(park(`\n![audio|${title}](${src})\n`)));
      });
      doc.querySelectorAll("[data-note-audio]").forEach((el) => {
        if (el.closest("[data-note-audio-wrap]")) return;
        const src = el.getAttribute("src") || "";
        const title = el.getAttribute("title") || "audio";
        if (!src) {
          el.remove();
          return;
        }
        el.replaceWith(doc.createTextNode(park(`\n![audio|${title}](${src})\n`)));
      });
      // Park tables as HTML so TipTap colgroup / colwidth survive refresh
      // (GFM pipe tables cannot store column widths).
      doc.querySelectorAll("table").forEach((el) => {
        const table = el as HTMLTableElement;
        // Skip empty shells
        if (!table.querySelector("tr")) {
          table.remove();
          return;
        }
        const html = serializeRichTableHtml(table);
        table.replaceWith(doc.createTextNode(park(`\n\n${html}\n\n`)));
      });
      // Park images before Turndown (Firebase URLs with & break raw HTML round-trips)
      const parkImageEl = (el: Element) => {
        const host = el as HTMLElement;
        const img =
          host.nodeName === "IMG"
            ? (host as HTMLImageElement)
            : (host.querySelector("img.rich-image, img[src]") as HTMLImageElement | null);
        if (!img?.getAttribute("src")) {
          host.remove();
          return;
        }
        if (img.closest("[data-note-embed]")) return;
        const frame =
          (host.classList.contains("rich-media-frame")
            ? host
            : (host.querySelector(".rich-media-frame") as HTMLElement | null)) ||
          (img.closest(".rich-media-frame, .rich-image-shell") as HTMLElement | null) ||
          host;
        const layout = readLayoutFromElement(frame);
        const token = formatImageToken(
          img.getAttribute("src") || "",
          img.getAttribute("alt") || "",
          layout,
          { hideUrlBar: true }
        );
        const target =
          (host.closest(".rich-image-shell") as HTMLElement | null) ||
          (host.classList.contains("rich-media-frame") && host.querySelector("img.rich-image")
            ? host
            : null) ||
          host;
        target.replaceWith(doc.createTextNode(park(`\n\n${token}\n\n`)));
      };
      doc.querySelectorAll(".rich-image-shell").forEach(parkImageEl);
      doc.querySelectorAll(".rich-media-frame > img.rich-image, img.rich-image").forEach((el) => {
        if ((el as HTMLElement).closest(".rich-image-shell")) return;
        if ((el as HTMLElement).closest("[data-note-embed]")) return;
        parkImageEl(el);
      });
      doc.querySelectorAll("a[data-note-file]").forEach((el) => {
        const href = el.getAttribute("href") || "";
        const name = el.getAttribute("data-name") || "檔案";
        const size = el.getAttribute("data-size") || "";
        if (!href) {
          el.remove();
          return;
        }
        el.replaceWith(
          doc.createTextNode(park(`\n\n[file|${name}${size ? `|${size}` : ""}](${href})\n\n`))
        );
      });
      doc.querySelectorAll("[data-note-bookmark]").forEach((el) => {
        const href = el.getAttribute("data-href") || el.getAttribute("href") || "";
        const title = el.getAttribute("data-title") || href || "書籤";
        el.replaceWith(doc.createTextNode(park(`\n\n[bookmark|${title}](${href})\n\n`)));
      });
      doc.querySelectorAll("a[data-note-app]").forEach((el) => {
        const href = el.getAttribute("href") || "/";
        const kind = el.getAttribute("data-kind") || "app";
        const title = el.getAttribute("data-title") || "應用";
        const hint = el.getAttribute("data-hint") || "";
        el.replaceWith(
          doc.createTextNode(park(`\n\n[app|${kind}|${title}|${hint}](${href})\n\n`))
        );
      });
      doc.querySelectorAll("button[data-note-template-btn]").forEach((el) => {
        const id = el.getAttribute("data-template") || "meeting";
        const label = (el.textContent || "插入範本").trim();
        el.replaceWith(doc.createTextNode(park(`\n\n[template|${id}|${label}](#)\n\n`)));
      });

      // Park real <mark> before Turndown so save never leaks raw HTML tags into body_md.
      // Inner HTML goes through turndown so nested bold/italic survive (==**x**==).
      doc.querySelectorAll("mark").forEach((el) => {
        const color = normalizeCssColor(
          el.getAttribute("data-color") ||
            (el as HTMLElement).style?.backgroundColor ||
            ""
        );
        const inner = turndown.turndown((el as HTMLElement).innerHTML || "").trim();
        if (!inner) {
          el.remove();
          return;
        }
        el.replaceWith(
          doc.createTextNode(park(color ? `==${inner}=={${color}}` : `==${inner}==`))
        );
      });

      // Heal text nodes that already contain leaked mark/span HTML (corrupted docs).
      // Park the recovered == / {c:} tokens so Turndown cannot escape them.
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      const textNodes: Text[] = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
      for (const tn of textNodes) {
        const raw = tn.nodeValue || "";
        if (!/<\/?(?:mark|span)\b/i.test(raw) && !/&lt;(?:mark|span)\b/i.test(raw)) continue;
        const healed = healHighlightArtifacts(raw);
        if (healed === raw) continue;
        tn.replaceWith(doc.createTextNode(park(healed)));
      }

      input = doc.body.innerHTML;
    } catch {
      input = html;
    }
  }
  let md = turndown.turndown(input).trim();
  md = md.replace(/@@ATOM(\d+)@@/g, (_m, i) => atoms[Number(i)] ?? "");
  return tightenMediaAdjacencyMd(healHighlightArtifacts(md.trim()));
}

/** Keep toggle / heading flush against following audio|video (no blank line). */
function tightenMediaAdjacencyMd(md: string): string {
  return md
    .replace(/:::\n{2,}(?=!\[(?:audio|video))/g, ":::\n")
    .replace(/(^#{1,6}[^\n]*)\n{2,}(?=!\[(?:audio|video))/gm, "$1\n");
}

/**
 * marked wraps lone <audio>/<video> in <p> when preceded by a blank line, and TipTap
 * then lifts the atom out leaving an empty paragraph — which reappears on every reload.
 */
function normalizeBlockMediaHtml(html: string): string {
  if (!html || typeof DOMParser === "undefined") {
    return html
      .replace(
        /<p>\s*((?:<audio\b[\s\S]*?<\/audio>|<video\b[\s\S]*?<\/video>|<div\b[^>]*data-note-audio-wrap[\s\S]*?<\/div>))\s*<\/p>/gi,
        "$1"
      )
      .replace(
        /((?:<\/div>|<\/audio>|<\/video>))\s*(?:<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>\s*)+(?=(?:<div\b[^>]*(?:data-note-toggle|data-note-audio-wrap|rich-toggle)|<audio\b|<video\b|<hr\b))/gi,
        "$1"
      );
  }
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const isMedia = (el: Element | null) =>
      !!el &&
      (el.matches(
        "audio, video, hr, div[data-note-toggle], div[data-note-toggle-heading], div[data-note-audio-wrap], div[data-note-video-wrap], .rich-toggle, .rich-audio-wrap, .rich-video-wrap"
      ) ||
        el.tagName === "AUDIO" ||
        el.tagName === "VIDEO");

    // Unwrap block media from <p>
    Array.from(doc.querySelectorAll("p")).forEach((p) => {
      const kids = Array.from(p.childNodes).filter(
        (n) => !(n.nodeType === 3 && !String(n.textContent || "").trim())
      );
      if (kids.length !== 1 || kids[0].nodeType !== 1) return;
      const only = kids[0] as HTMLElement;
      if (
        only.tagName === "AUDIO" ||
        only.tagName === "VIDEO" ||
        only.getAttribute("data-note-audio-wrap") === "1"
      ) {
        p.replaceWith(only);
      }
    });

    // Drop empty paragraphs sandwiched between block widgets (toggle ↔ audio).
    Array.from(doc.querySelectorAll("p")).forEach((p) => {
      const text = (p.textContent || "").replace(/\u00a0/g, " ").trim();
      const hasMedia = !!p.querySelector("img, audio, video, iframe, object, table");
      if (text || hasMedia) return;
      const prev = p.previousElementSibling;
      const next = p.nextElementSibling;
      if (isMedia(prev) && isMedia(next)) {
        p.remove();
        return;
      }
      // Empty p directly under a heading before media
      if (
        prev &&
        /^H[1-6]$/.test(prev.tagName) &&
        isMedia(next)
      ) {
        p.remove();
      }
    });

    return doc.body.innerHTML;
  } catch {
    return html;
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
