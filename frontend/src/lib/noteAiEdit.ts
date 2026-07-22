/** Parse / emit structured note edits from the global AI rail. */

export type NoteAiEditMode = "replace" | "append";

export type NoteAiEdit = {
  mode: NoteAiEditMode;
  bodyMd: string;
  title?: string;
};

export type NoteAiEditEventDetail = NoteAiEdit & {
  noteId: string;
  source?: string;
};

export const NOTE_AI_EDIT_EVENT = "albireus:ai-note-edit";

type LiveDraft = { noteId: string; title: string; body: string; updatedAt: number };
let liveDraft: LiveDraft | null = null;

/** Notes page publishes the in-editor draft so AI sees unsaved text. */
export function publishNoteLiveDraft(noteId: string, title: string, body: string) {
  liveDraft = { noteId, title, body, updatedAt: Date.now() };
}

export function clearNoteLiveDraft(noteId?: string) {
  if (!liveDraft) return;
  if (!noteId || liveDraft.noteId === noteId) liveDraft = null;
}

export function readNoteLiveDraft(noteId: string): { title: string; body: string } | null {
  if (!liveDraft || liveDraft.noteId !== noteId) return null;
  return { title: liveDraft.title, body: liveDraft.body };
}

const FENCE_RE =
  /```albireus-note-edit\s*\n([\s\S]*?)```/i;

/** Heuristic: user clearly asked to change the open note. */
export function userAskedToEditNote(prompt: string): boolean {
  const t = prompt.trim();
  if (!t) return false;
  return /修改筆記|改寫筆記|重寫筆記|更新筆記|寫入筆記|套用到筆記|編輯本篇|編輯筆記|幫我改|請改|改成|改寫|重寫|重構|整理這篇|整理本篇|改標題|加到筆記|加入筆記|刪掉|刪除段落|替換|插入一段|補上|擴寫本篇|改這篇|改本篇|把筆記/.test(
    t
  );
}

export function parseNoteAiEdit(raw: string): {
  edit: NoteAiEdit | null;
  displayText: string;
} {
  const m = raw.match(FENCE_RE);
  if (!m) return { edit: null, displayText: raw };

  const block = m[1].trim();
  const sep = block.indexOf("\n---\n");
  let header = "";
  let bodyMd = block;
  if (sep >= 0) {
    header = block.slice(0, sep).trim();
    bodyMd = block.slice(sep + 5).replace(/^\n/, "");
  } else {
    // Fallback: first lines as meta until blank line
    const blank = block.search(/\n\s*\n/);
    if (blank >= 0) {
      header = block.slice(0, blank).trim();
      bodyMd = block.slice(blank).trim();
    }
  }

  let mode: NoteAiEditMode = "replace";
  let title: string | undefined;
  for (const line of header.split("\n")) {
    const kv = line.match(/^([a-z_]+)\s*:\s*(.*)$/i);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const val = kv[2].trim();
    if (key === "mode") {
      if (val === "append" || val === "replace") mode = val;
    } else if (key === "title" && val && val !== "null" && val !== "-") {
      title = val.slice(0, 200);
    }
  }

  if (!bodyMd.trim() && !title) {
    return { edit: null, displayText: raw };
  }

  const displayText = raw.replace(FENCE_RE, "").trim();
  return {
    edit: {
      mode,
      bodyMd: bodyMd.trim(),
      title,
    },
    displayText:
      displayText ||
      (mode === "append" ? "已準備追加內容到筆記。" : "已準備更新筆記內容。"),
  };
}

export function applyNoteAiEditToBody(
  currentBody: string,
  edit: NoteAiEdit
): string {
  if (!edit.bodyMd.trim()) return currentBody;
  if (edit.mode === "append") {
    const base = currentBody.trim();
    return base ? `${base}\n\n${edit.bodyMd.trim()}\n` : `${edit.bodyMd.trim()}\n`;
  }
  return edit.bodyMd;
}

export function dispatchNoteAiEdit(detail: NoteAiEditEventDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NOTE_AI_EDIT_EVENT, { detail }));
}

export const NOTE_EDIT_SYSTEM_RULES = `
當使用者明確要求修改／改寫／更新／整理「目前這篇筆記」時，除了簡短說明外，必須另外輸出一個可被套用的編輯區塊（只在使用者有改筆記意圖時才輸出）：
\`\`\`albireus-note-edit
mode: replace
title: （可選，要改標題才寫；否則省略此行）
---
（完整筆記 Markdown 正文；mode 為 append 時只寫要追加的段落）
\`\`\`
規則：
- mode 用 replace（整篇替換）或 append（追加到文末）。
- replace 時正文必須是完整筆記（可保留原有音檔 HTML、引用、標題層級）。
- 使用者只是提問、總結、討論而未要求改筆記時，不要輸出編輯區塊。
- 編輯區塊以外可用繁體中文說明你改了什麼。
`.trim();
