/** Append a capture snippet into today's journal note (create if missing). */

import { createNote, updateNote, type Note } from "@/lib/firebase";
import { journalTitle } from "@/lib/templates";

export function findTodayJournalNote(notes: Note[], dateKey = journalTitle()): Note | undefined {
  return notes.find(
    (n) =>
      n.journal_date === dateKey ||
      ((n.tags || []).includes("journal") && n.title === dateKey && !n.journal_date)
  );
}

/** `- HH:mm text` bullet for inbox-style capture. */
export function formatCaptureBullet(text: string): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const line = String(text || "").trim();
  if (!line) return "";
  const stripped = line.replace(/^[-*•]\s+/, "");
  return `- ${hh}:${mm} ${stripped}`;
}

type UndoPayload = { noteId: string; previousBody: string; dateKey: string };

let lastUndo: UndoPayload | null = null;

export function peekJournalCaptureUndo(): UndoPayload | null {
  return lastUndo;
}

export async function undoLastJournalCapture(): Promise<boolean> {
  if (!lastUndo) return false;
  const u = lastUndo;
  lastUndo = null;
  await updateNote(u.noteId, { body_md: u.previousBody });
  return true;
}

export async function appendToTodayJournal(
  userId: string,
  notes: Note[],
  snippet: string,
  opts?: { stamp?: boolean }
): Promise<{ noteId: string; dateKey: string; created: boolean; previousBody: string }> {
  const dateKey = journalTitle();
  let block = String(snippet || "").trim();
  if (!block) throw new Error("內容是空的");
  if (opts?.stamp !== false) {
    // Multi-line: stamp first line only if it doesn't look like a heading/section
    if (!block.startsWith("#") && !block.startsWith("###") && !block.startsWith("<")) {
      const lines = block.split("\n");
      lines[0] = formatCaptureBullet(lines[0]);
      block = lines.join("\n");
    }
  }
  const existing = findTodayJournalNote(notes, dateKey);
  if (existing) {
    const previousBody = existing.body_md || "";
    const next = `${previousBody.trim()}\n\n${block}\n`;
    await updateNote(existing.id, {
      body_md: next,
      journal_date: dateKey,
      tags: Array.from(new Set([...(existing.tags || []), "journal"])),
      folder: existing.folder || "日誌",
    });
    lastUndo = { noteId: existing.id, previousBody, dateKey };
    return { noteId: existing.id, dateKey, created: false, previousBody };
  }
  const previousBody = "";
  const body = `${block}\n`;
  const noteId = await createNote(userId, dateKey, body, undefined, ["journal"], {
    journal_date: dateKey,
    folder: "日誌",
  });
  lastUndo = { noteId, previousBody, dateKey };
  return { noteId, dateKey, created: true, previousBody };
}
