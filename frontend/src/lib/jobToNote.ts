import { createNote, updateNote, uploadNoteMedia } from "@/lib/firebase";
import { mediaMarkdownForFile } from "@/lib/noteMediaInsert";
import {
  parseTranscript,
  segmentsToPlainText,
  segmentsToTimestampedText,
} from "@/lib/transcript";

/** Default instruction for turning a transcript into study notes. */
export const TRANSCRIPT_STUDY_PROMPT =
  "幫我把全部內容，按照時間先後順序製作筆記，繁體中文，條列，1000字以上，文字清楚完整，重點寫到，方便之後複習";

const NOTE_SEED_PREFIX = "cadence_note_seed_v1:";

type AssistantPrefs = {
  name?: string;
  style?: string;
  model?: string;
  grounding?: boolean;
};

function safeTxtName(raw: string): string {
  const base = (raw || "逐字稿")
    .replace(/\.[^/.]+$/, "")
    .replace(/[^\w.\u4e00-\u9fff-]+/g, "_")
    .slice(0, 60);
  return `${base || "逐字稿"}.txt`;
}

/** Stash body so the note page can hydrate before Firestore round-trip / avoid empty autosave. */
export function seedNoteBody(noteId: string, bodyMd: string) {
  if (typeof window === "undefined" || !noteId || !bodyMd.trim()) return;
  try {
    sessionStorage.setItem(`${NOTE_SEED_PREFIX}${noteId}`, bodyMd);
  } catch {
    /* ignore quota */
  }
}

export function takeNoteBodySeed(noteId: string): string | null {
  if (typeof window === "undefined" || !noteId) return null;
  try {
    const key = `${NOTE_SEED_PREFIX}${noteId}`;
    const raw = sessionStorage.getItem(key);
    if (raw != null) sessionStorage.removeItem(key);
    return raw;
  } catch {
    return null;
  }
}

/**
 * AI-organise a job transcript into a note:
 * - .txt of the full transcript attached at the top of the note
 * - AI study notes (chronological bullets) below
 * - note pinned to the top of the sidebar (low sort_order)
 */
export async function createAiStudyNoteFromTranscript(opts: {
  uid: string;
  jobId: string;
  title: string;
  filename?: string;
  transcriptRaw: string;
  assistant?: AssistantPrefs;
  prompt?: string;
}): Promise<string> {
  const segs = parseTranscript(opts.transcriptRaw || "");
  const stamped = segmentsToTimestampedText(segs);
  const plain = segmentsToPlainText(segs);
  const source = stamped || plain || opts.transcriptRaw || "";
  if (!source.trim()) throw new Error("沒有可整理的逐字稿內容");

  const prompt = (opts.prompt || TRANSCRIPT_STUDY_PROMPT).trim();
  const res = await fetch("/api/ai/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "transcript_study_notes",
      title: opts.title,
      body: source.slice(0, 28000),
      prompt,
      assistant: opts.assistant,
    }),
  });
  const data = (await res.json()) as { text?: string; error?: string };
  if (!res.ok) throw new Error(data.error || "AI 整理失敗");
  const pack = String(data.text || "").trim() || "（AI 未產出內容）";

  const noteTitle = opts.title.trim() || opts.filename || "AI 整理筆記";
  // Write AI body in the same create — never leave an empty note that autosave can wipe.
  const aiBody = `## AI 整理筆記\n\n${pack}`;
  const noteId = await createNote(opts.uid, noteTitle, aiBody, opts.jobId, ["AI整理"], {
    // Negative → appears above notes that use Date.now() / positive orders
    sort_order: -Date.now(),
    icon: "edit_note",
  });

  let body_md = aiBody;
  try {
    const txtName = safeTxtName(opts.filename || noteTitle);
    const file = new File([source], txtName, { type: "text/plain;charset=utf-8" });
    const { url } = await uploadNoteMedia(opts.uid, noteId, file);
    const fileBlock = mediaMarkdownForFile(url, file).trim();
    body_md = [fileBlock, "", aiBody].join("\n");
    await updateNote(noteId, { body_md });
  } catch (e) {
    // Attachment is best-effort; AI notes are already in the note.
    console.warn("[jobToNote] transcript txt attach failed:", e);
  }

  seedNoteBody(noteId, body_md);
  return noteId;
}
