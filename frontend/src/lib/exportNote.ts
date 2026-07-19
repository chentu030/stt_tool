/** Note export: Markdown / PDF / DOCX / simple PPT outline */

import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { saveAs } from "file-saver";

function safeName(title: string) {
  return (title || "note").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
}

export function downloadMarkdown(title: string, body: string) {
  const blob = new Blob([`# ${title}\n\n${body}`], { type: "text/markdown;charset=utf-8" });
  saveAs(blob, `${safeName(title)}.md`);
}

export function downloadPdf(title: string, body: string) {
  // Prefer print dialog for CJK fidelity (no custom font bundle)
  downloadPdfViaPrint(title, body);
}

/** Browser print → PDF (best CJK support without custom fonts) */
export function downloadPdfViaPrint(title: string, body: string) {
  const html = markdownToPrintHtml(title, body);
  const w = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
  if (!w) {
    alert("請允許彈出視窗以匯出 PDF");
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
  const blocks = (body || "").split("\n").map((line) => {
    if (line.startsWith("### ")) return `<h3>${esc(line.slice(4))}</h3>`;
    if (line.startsWith("## ")) return `<h2>${esc(line.slice(3))}</h2>`;
    if (line.startsWith("# ")) return `<h1>${esc(line.slice(2))}</h1>`;
    if (line.startsWith("- [x] ") || line.startsWith("- [X] ")) return `<p>☐ <s>${esc(line.slice(6))}</s></p>`.replace("☐", "☑");
    if (line.startsWith("- [ ] ")) return `<p>☐ ${esc(line.slice(6))}</p>`;
    if (line.startsWith("- ")) return `<p>• ${esc(line.slice(2))}</p>`;
    if (line.startsWith("> ")) return `<blockquote>${esc(line.slice(2))}</blockquote>`;
    if (line.trim() === "---") return `<hr/>`;
    if (!line.trim()) return `<br/>`;
    return `<p>${esc(line)}</p>`;
  }).join("\n");

  return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(title)}</title>
  <style>
    body{font-family:"Noto Sans TC","Microsoft JhengHei",sans-serif;padding:48px;line-height:1.65;color:#111}
    h1{font-size:24px} h2{font-size:18px} h3{font-size:15px}
    blockquote{border-left:3px solid #0d9488;padding-left:12px;color:#444}
    @media print{body{padding:0}}
  </style></head><body>
  <h1>${esc(title || "未命名筆記")}</h1>
  ${blocks}
  </body></html>`;
}

export async function downloadDocx(title: string, body: string) {
  const children: Paragraph[] = [
    new Paragraph({
      text: title || "未命名筆記",
      heading: HeadingLevel.TITLE,
    }),
  ];

  for (const raw of (body || "").split("\n")) {
    if (raw.startsWith("### ")) {
      children.push(new Paragraph({ text: raw.slice(4), heading: HeadingLevel.HEADING_3 }));
    } else if (raw.startsWith("## ")) {
      children.push(new Paragraph({ text: raw.slice(3), heading: HeadingLevel.HEADING_2 }));
    } else if (raw.startsWith("# ")) {
      children.push(new Paragraph({ text: raw.slice(2), heading: HeadingLevel.HEADING_1 }));
    } else if (raw.startsWith("- ")) {
      children.push(new Paragraph({ text: raw.replace(/^-\s+(\[[xX ]\]\s+)?/, "• "), spacing: { after: 120 } }));
    } else if (raw.trim() === "---") {
      children.push(new Paragraph({ text: "————————" }));
    } else if (!raw.trim()) {
      children.push(new Paragraph({ text: "" }));
    } else {
      children.push(new Paragraph({
        children: [new TextRun(raw.replace(/!\[[^\]]*\]\([^)]*\)/g, "[圖片]").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"))],
        spacing: { after: 120 },
      }));
    }
  }

  const doc = new Document({ sections: [{ children }] });
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
