/** Note export: Markdown / PDF / DOCX / simple PPT outline */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from "docx";
import { saveAs } from "file-saver";
import { toast } from "@/lib/toast";
import {
  ALIASES_PROP,
  FRONTMATTER_PROP,
  markdownWithFrontmatter,
} from "@/lib/importMarkdownNotes";

function safeName(title: string) {
  return (title || "note").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
}

export type MarkdownExportMeta = {
  title?: string;
  tags?: string[];
  aliases?: string[];
  journalDate?: string;
  folder?: string;
  created?: string | Date;
  updated?: string | Date;
  cadenceId?: string;
  extras?: Record<string, unknown>;
  /** When true (default), wrap with YAML frontmatter for round-trip */
  includeFrontmatter?: boolean;
};

/** Build markdown text with optional YAML frontmatter (含 YAML). */
export function buildExportMarkdown(
  title: string,
  body: string,
  meta?: MarkdownExportMeta
): string {
  const includeFm = meta?.includeFrontmatter !== false;
  if (!includeFm) {
    return `# ${title}\n\n${body || ""}`;
  }
  const aliases =
    meta?.aliases ||
    (Array.isArray(meta?.extras?.[ALIASES_PROP])
      ? (meta!.extras![ALIASES_PROP] as string[])
      : undefined);
  const extras = { ...(meta?.extras || {}) };
  delete extras[ALIASES_PROP];
  delete extras[FRONTMATTER_PROP];
  const fmExtras =
    meta?.extras && typeof meta.extras[FRONTMATTER_PROP] === "object"
      ? {
          ...(meta.extras[FRONTMATTER_PROP] as Record<string, unknown>),
          ...extras,
        }
      : extras;
  return markdownWithFrontmatter(body || "", {
    title: meta?.title ?? title,
    tags: meta?.tags,
    aliases,
    journalDate: meta?.journalDate,
    folder:
      meta?.folder ||
      (typeof fmExtras.folder === "string" ? fmExtras.folder : undefined),
    created: meta?.created,
    updated: meta?.updated,
    cadenceId: meta?.cadenceId,
    extras: fmExtras,
  });
}

export function downloadMarkdown(
  title: string,
  body: string,
  meta?: MarkdownExportMeta
) {
  const text = buildExportMarkdown(title, body, meta);
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  saveAs(blob, `${safeName(title)}.md`);
}

export function downloadPdf(title: string, body: string) {
  downloadPdfViaPrint(title, body);
}

/** Browser print → PDF (best CJK support without custom fonts) */
export function downloadPdfViaPrint(title: string, body: string) {
  const html = markdownToPrintHtml(title, body);
  const w = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
  if (!w) {
    toast("請允許彈出視窗以匯出 PDF");
    return;
  }
  w.document.write(html);
  w.document.close();
  setTimeout(() => {
    w.focus();
    w.print();
  }, 350);
}

function markdownToPrintHtml(title: string, body: string) {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = (body || "").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith("|") && line.includes("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const raw = lines[i].trim();
        if (/^\|[\s-:|]+\|$/.test(raw)) {
          i++;
          continue;
        }
        rows.push(
          raw
            .replace(/^\||\|$/g, "")
            .split("|")
            .map((c) => c.trim())
        );
        i++;
      }
      if (rows.length) {
        out.push(
          `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;margin:12px 0">${rows
            .map(
              (r, ri) =>
                `<tr>${r
                  .map((c) =>
                    ri === 0 ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`
                  )
                  .join("")}</tr>`
            )
            .join("")}</table>`
        );
      }
      continue;
    }
    if (line.startsWith("### ")) out.push(`<h3>${esc(line.slice(4))}</h3>`);
    else if (line.startsWith("## ")) out.push(`<h2>${esc(line.slice(3))}</h2>`);
    else if (line.startsWith("# ")) out.push(`<h1>${esc(line.slice(2))}</h1>`);
    else if (line.startsWith("- [x] ") || line.startsWith("- [X] "))
      out.push(`<p>☑ ${esc(line.slice(6))}</p>`);
    else if (line.startsWith("- [ ] ")) out.push(`<p>☐ ${esc(line.slice(6))}</p>`);
    else if (line.startsWith("- ")) out.push(`<p>• ${esc(line.slice(2))}</p>`);
    else if (/^\d+\.\s+/.test(line))
      out.push(`<p>${esc(line)}</p>`);
    else if (line.startsWith("> ")) out.push(`<blockquote>${esc(line.slice(2))}</blockquote>`);
    else if (line.trim() === "---") out.push(`<hr/>`);
    else if (!line.trim()) out.push(`<br/>`);
    else out.push(`<p>${esc(line)}</p>`);
    i++;
  }

  return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(title)}</title>
  <style>
    @page{size:A4;margin:20mm}
    body{font-family:"Noto Sans TC","Microsoft JhengHei",sans-serif;padding:24px;line-height:1.65;color:#111;max-width:210mm;margin:0 auto}
    h1{font-size:24px} h2{font-size:18px} h3{font-size:15px}
    blockquote{border-left:3px solid #0d9488;padding-left:12px;color:#444}
    table{border-collapse:collapse;width:100%}
    th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
    th{background:#f5f5f5}
    @media print{body{padding:0;max-width:none}}
  </style></head><body>
  <h1>${esc(title || "未命名筆記")}</h1>
  ${out.join("\n")}
  </body></html>`;
}

function inlineRuns(text: string): TextRun[] {
  // very light markdown inline: **bold** *italic* `code`
  const runs: TextRun[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|[^*`]+)/g;
  let m: RegExpExecArray | null;
  const cleaned = text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "[圖片]")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[\[[^\]|]+(?:\|([^\]]+))?\]\]/g, (_a, alias) => alias || "連結")
    .replace(/\{c:[^}]+\}|{\/c\}|\{fs:[^}]+\}|{\/fs\}/g, "");
  while ((m = re.exec(cleaned))) {
    const t = m[1];
    if (t.startsWith("**") && t.endsWith("**")) {
      runs.push(new TextRun({ text: t.slice(2, -2), bold: true }));
    } else if (t.startsWith("*") && t.endsWith("*")) {
      runs.push(new TextRun({ text: t.slice(1, -1), italics: true }));
    } else if (t.startsWith("`") && t.endsWith("`")) {
      runs.push(new TextRun({ text: t.slice(1, -1), font: "Consolas" }));
    } else if (t) {
      runs.push(new TextRun(t));
    }
  }
  if (!runs.length) runs.push(new TextRun(""));
  return runs;
}

function parseAlign(line: string): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  const m = line.match(/<!--align:(left|center|right|justify)-->/);
  if (!m) return undefined;
  if (m[1] === "center") return AlignmentType.CENTER;
  if (m[1] === "right") return AlignmentType.RIGHT;
  if (m[1] === "justify") return AlignmentType.BOTH;
  return AlignmentType.LEFT;
}

function stripAlign(line: string) {
  return line.replace(/\s*<!--align:(left|center|right|justify)-->\s*$/, "").trim();
}

export async function downloadDocx(title: string, body: string) {
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      children: [new TextRun({ text: title || "未命名筆記", bold: true, size: 36 })],
      spacing: { after: 280 },
    }),
  ];

  const lines = (body || "").split("\n");
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];

    // GFM table block
    if (raw.trim().startsWith("|") && raw.includes("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const row = lines[i].trim();
        if (/^\|[\s-:|]+\|$/.test(row)) {
          i++;
          continue;
        }
        rows.push(
          row
            .replace(/^\||\|$/g, "")
            .split("|")
            .map((c) => c.trim())
        );
        i++;
      }
      if (rows.length) {
        const colCount = Math.max(...rows.map((r) => r.length));
        const tableRows = rows.map(
          (r, ri) =>
            new TableRow({
              children: Array.from({ length: colCount }, (_, ci) => {
                const text = r[ci] || "";
                return new TableCell({
                  width: { size: Math.floor(9000 / colCount), type: WidthType.DXA },
                  borders: {
                    top: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" },
                  },
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text,
                          bold: ri === 0,
                        }),
                      ],
                    }),
                  ],
                });
              }),
            })
        );
        children.push(
          new Table({
            width: { size: 9000, type: WidthType.DXA },
            rows: tableRows,
          })
        );
        children.push(new Paragraph({ text: "" }));
      }
      continue;
    }

    const align = parseAlign(raw);
    const line = stripAlign(raw);

    if (line.startsWith("### ")) {
      children.push(
        new Paragraph({
          children: inlineRuns(line.slice(4)),
          heading: HeadingLevel.HEADING_3,
          alignment: align,
        })
      );
    } else if (line.startsWith("## ")) {
      children.push(
        new Paragraph({
          children: inlineRuns(line.slice(3)),
          heading: HeadingLevel.HEADING_2,
          alignment: align,
        })
      );
    } else if (line.startsWith("# ")) {
      children.push(
        new Paragraph({
          children: inlineRuns(line.slice(2)),
          heading: HeadingLevel.HEADING_1,
          alignment: align,
        })
      );
    } else if (/^-\s+\[[xX ]\]\s+/.test(line)) {
      const checked = /^-\s+\[[xX]\]/.test(line);
      const text = line.replace(/^-\s+\[[xX ]\]\s+/, "");
      children.push(
        new Paragraph({
          children: [new TextRun(`${checked ? "☑" : "☐"} `), ...inlineRuns(text)],
          spacing: { after: 100 },
        })
      );
    } else if (line.startsWith("- ")) {
      children.push(
        new Paragraph({
          children: [new TextRun("• "), ...inlineRuns(line.slice(2))],
          spacing: { after: 100 },
        })
      );
    } else if (/^\d+\.\s+/.test(line)) {
      children.push(
        new Paragraph({
          children: inlineRuns(line),
          spacing: { after: 100 },
        })
      );
    } else if (line.startsWith("> ")) {
      children.push(
        new Paragraph({
          children: inlineRuns(line.slice(2)),
          spacing: { after: 120 },
          indent: { left: 420 },
        })
      );
    } else if (line.trim() === "---") {
      children.push(new Paragraph({ text: "————————", spacing: { before: 120, after: 120 } }));
    } else if (!line.trim()) {
      children.push(new Paragraph({ text: "" }));
    } else if (line.startsWith("<p style=\"text-align:")) {
      const m = line.match(/^<p style="text-align:(left|center|right|justify)">(.*)<\/p>$/);
      if (m) {
        const a =
          m[1] === "center"
            ? AlignmentType.CENTER
            : m[1] === "right"
              ? AlignmentType.RIGHT
              : m[1] === "justify"
                ? AlignmentType.BOTH
                : AlignmentType.LEFT;
        children.push(
          new Paragraph({
            children: inlineRuns(m[2]),
            alignment: a,
            spacing: { after: 120 },
          })
        );
      } else {
        children.push(new Paragraph({ children: inlineRuns(line), spacing: { after: 120 } }));
      }
    } else {
      children.push(
        new Paragraph({
          children: inlineRuns(line),
          alignment: align,
          spacing: { after: 120 },
        })
      );
    }
    i++;
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4
            margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
          },
        },
        children,
      },
    ],
  });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${safeName(title)}.docx`);
}

/** PPT-ish: headings become slides exported as Markdown deck */
export function downloadPptOutline(title: string, body: string) {
  const slides: string[] = [`# ${title || "簡報"}\n`];
  let current = "";
  for (const line of (body || "").split("\n")) {
    if (/^##\s+/.test(line) || /^#\s+/.test(line)) {
      if (current) slides.push(current.trim());
      current = `## ${line.replace(/^#+\s+/, "")}\n`;
    } else {
      current += `${line}\n`;
    }
  }
  if (current.trim()) slides.push(current.trim());
  if (slides.length === 1) slides.push("## 內容\n\n" + (body || "(空白)"));
  const md = slides.join("\n\n---\n\n");
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  saveAs(blob, `${safeName(title)}-slides.md`);
}

/** Split note into presentation slides by ## headings */
export function bodyToSlides(title: string, body: string): { title: string; content: string }[] {
  const slides: { title: string; content: string }[] = [];
  let cur = { title: title || "簡報", content: "" };
  let started = false;
  for (const line of (body || "").split("\n")) {
    if (/^##\s+/.test(line)) {
      if (started || cur.content.trim()) slides.push(cur);
      cur = { title: line.replace(/^##\s+/, ""), content: "" };
      started = true;
    } else if (/^#\s+/.test(line) && !started) {
      cur.title = line.replace(/^#\s+/, "");
    } else {
      cur.content += (cur.content ? "\n" : "") + line;
    }
  }
  slides.push(cur);
  if (slides.length === 1 && !slides[0].content.trim()) {
    slides[0].content = body || "（空白投影片）";
  }
  return slides;
}
