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

export async function appendToTodayJournal(
  userId: string,
  notes: Note[],
  snippet: string
): Promise<{ noteId: string; dateKey: string; created: boolean }> {
  const dateKey = journalTitle();
  const block = snippet.trim();
  if (!block) throw new Error("內容是空的");
  const existing = findTodayJournalNote(notes, dateKey);
  if (existing) {
    const next = `${(existing.body_md || "").trim()}\n\n${block}\n`;
    await updateNote(existing.id, {
      body_md: next,
      journal_date: dateKey,
      tags: Array.from(new Set([...(existing.tags || []), "journal"])),
      folder: existing.folder || "日誌",
    });
    return { noteId: existing.id, dateKey, created: false };
  }
  const body = `${block}\n`;
  const noteId = await createNote(userId, dateKey, body, undefined, ["journal"], {
    journal_date: dateKey,
    folder: "日誌",
  });
  return { noteId, dateKey, created: true };
}
