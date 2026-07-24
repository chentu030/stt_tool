/** Symmetric handoff: note/journal selection ↔ whiteboard cards. */

import {
  createCanvas,
  ensureCanvasesMigrated,
  getCanvasOnce,
  lastCanvasKey,
  saveCanvas,
} from "@/lib/canvasCloud";
import {
  AI_STICKY_GAP,
  AI_STICKY_W,
  createSection,
  createSticky,
  stickyHeightForText,
  type CanvasDoc,
  type Selectable,
} from "@/lib/canvasStore";
import { packCanvasSelectionForAi } from "@/lib/canvasAiContext";
import { createNote } from "@/lib/firebase";

/** Split selected prose into sticky-sized cards (paragraphs / short lines). */
export function splitSelectionIntoCards(text: string, maxCards = 12): string[] {
  const raw = (text || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return [];
  const paras = raw
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n+/g, " ").trim())
    .filter(Boolean);
  const chunks: string[] = [];
  for (const p of paras) {
    if (p.length <= 280) {
      chunks.push(p);
      continue;
    }
    const lines = p.split(/(?<=[。！？.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    let buf = "";
    for (const line of lines) {
      if (!buf) {
        buf = line;
        continue;
      }
      if ((buf + " " + line).length <= 280) buf = `${buf} ${line}`;
      else {
        chunks.push(buf);
        buf = line;
      }
    }
    if (buf) chunks.push(buf);
  }
  if (!chunks.length) chunks.push(raw.slice(0, 400));
  return chunks.slice(0, maxCards);
}

export function resolveLastCanvasId(uid: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(lastCanvasKey(uid));
  } catch {
    return null;
  }
}

/** Land selection as a title frame + sticky cards on the user's last (or new) canvas. */
export async function landSelectionOnCanvas(opts: {
  uid: string;
  text: string;
  title?: string;
}): Promise<{ canvasId: string; cardCount: number }> {
  const cards = splitSelectionIntoCards(opts.text);
  if (!cards.length) throw new Error("沒有可攤到白板的文字");

  let canvasId =
    resolveLastCanvasId(opts.uid) || (await ensureCanvasesMigrated(opts.uid));
  if (!canvasId) {
    canvasId = await createCanvas(opts.uid, opts.title?.trim() || "白板");
  }

  let doc = await getCanvasOnce(opts.uid, canvasId);
  if (!doc) {
    canvasId = await createCanvas(opts.uid, opts.title?.trim() || "白板");
    doc = await getCanvasOnce(opts.uid, canvasId);
    if (!doc) throw new Error("無法建立白板");
  }

  const originX = Math.max(
    40,
    ...doc.stickies.map((s) => s.x + s.w),
    ...(doc.sections || []).map((s) => s.x + s.w),
    ...doc.shapes.map((s) => s.x + s.w)
  ) + 48;
  const originY = 80;
  const frameTitle = (opts.title || "").trim() || cards[0].slice(0, 40);
  const heights = cards.map((t) => stickyHeightForText(t, AI_STICKY_W));
  const totalH =
    heights.reduce((a, h) => a + h, 0) + AI_STICKY_GAP * Math.max(0, cards.length - 1);
  const framePad = 36;
  const frameW = AI_STICKY_W + framePad * 2;
  const frameH = Math.max(160, totalH + 72);

  const next: CanvasDoc = {
    ...doc,
    stickies: [...doc.stickies],
    sections: [...(doc.sections || [])],
  };

  const section = createSection({
    x: originX,
    y: originY,
    w: frameW,
    h: frameH,
    title: frameTitle,
  });
  next.sections.push(section);

  let cursorY = originY + 48;
  for (let i = 0; i < cards.length; i++) {
    const h = heights[i];
    next.stickies.push(
      createSticky({
        x: originX + framePad,
        y: cursorY,
        w: AI_STICKY_W,
        h,
        text: cards[i],
        color: "yellow",
      })
    );
    cursorY += h + AI_STICKY_GAP;
  }

  await saveCanvas(opts.uid, canvasId, next);
  try {
    localStorage.setItem(lastCanvasKey(opts.uid), canvasId);
  } catch {
    /* ignore */
  }
  return { canvasId, cardCount: cards.length };
}

/** Build structured markdown from multi-select canvas items. */
export function harvestCanvasSelectionMarkdown(
  doc: CanvasDoc,
  selected: Selectable[],
  noteTitles?: Map<string, string>
): { title: string; body: string } | null {
  const packed = packCanvasSelectionForAi(doc, selected, noteTitles);
  if (!packed) return null;

  const lines: string[] = [];
  const sectionTitles: string[] = [];
  const bullets: string[] = [];

  for (const s of selected) {
    if (s.type === "section") {
      const sec = (doc.sections || []).find((x) => x.id === s.id);
      const t = sec?.title?.trim();
      if (t) sectionTitles.push(t);
    } else if (s.type === "sticky") {
      const st = doc.stickies.find((x) => x.id === s.id);
      const t = st?.text?.trim();
      if (t) {
        const parts = t.split(/\n+/).map((x) => x.trim()).filter(Boolean);
        if (parts.length > 1) {
          bullets.push(`- ${parts[0]}`);
          for (const p of parts.slice(1)) bullets.push(`  - ${p}`);
        } else {
          bullets.push(`- ${t}`);
        }
      }
    } else if (s.type === "shape") {
      const sh = doc.shapes.find((x) => x.id === s.id);
      const t = sh?.label?.trim();
      if (t) bullets.push(`- ${t}`);
    } else if (s.type === "note") {
      const title = noteTitles?.get(s.id)?.trim() || s.id;
      bullets.push(`- [[${title}]]`);
    } else if (s.type === "media") {
      const m = (doc.media || []).find((x) => x.id === s.id);
      if (!m) continue;
      const title = (m.title || m.media || "媒體").trim();
      bullets.push(`- ${title}`);
      const excerpt = (m.extractedText || m.transcript || "").trim().slice(0, 600);
      if (excerpt) {
        for (const para of excerpt.split(/\n+/).filter(Boolean).slice(0, 6)) {
          bullets.push(`  - ${para.slice(0, 160)}`);
        }
      }
    }
  }

  const title =
    sectionTitles[0] ||
    packed.label.slice(0, 48) ||
    "白板收成";

  if (sectionTitles.length) {
    for (const h of sectionTitles) {
      lines.push(`## ${h}`, "");
    }
  } else {
    lines.push("## 重點", "");
  }

  if (bullets.length) {
    lines.push(...bullets, "");
  } else {
    // Fallback: use packed context as paragraphs
    for (const block of packed.selection.split(/\n{2,}/).filter(Boolean)) {
      lines.push(block.trim(), "");
    }
  }

  lines.push("---", "", `_收成自白板 · ${new Date().toLocaleString("zh-TW")}_`, "");
  return { title, body: lines.join("\n").trim() + "\n" };
}

export async function createNoteFromCanvasHarvest(opts: {
  uid: string;
  doc: CanvasDoc;
  selected: Selectable[];
  noteTitles?: Map<string, string>;
}): Promise<{ noteId: string; title: string }> {
  const harvested = harvestCanvasSelectionMarkdown(opts.doc, opts.selected, opts.noteTitles);
  if (!harvested) throw new Error("選取內容無法收成筆記");
  const noteId = await createNote(
    opts.uid,
    harvested.title,
    harvested.body,
    undefined,
    ["白板收成"],
    { icon: "edit_note" }
  );
  return { noteId, title: harvested.title };
}
