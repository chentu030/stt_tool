/**
 * App-level quick-voice job queue — survives leaving /journal while STT + AI run.
 */

import { createNote, updateNote, uploadNoteMedia } from "@/lib/firebase";
import { organizeQuickVoice, transcribeWithGoogle } from "@/lib/googleStt";
import { journalTitle } from "@/lib/templates";
import { toast } from "@/lib/toast";

export type QuickVoiceCallbacks = {
  onAppendJournal?: (md: string) => void;
  onCreatedNote?: (noteId: string) => void;
};

type Job = {
  uid: string;
  blob: Blob;
  ext: string;
  language: string;
  callbacks: QuickVoiceCallbacks;
};

let chain: Promise<void> = Promise.resolve();
let pending = 0;
const listeners = new Set<(n: number) => void>();

function emit() {
  listeners.forEach((cb) => cb(pending));
}

export function getQuickVoicePending() {
  return pending;
}

export function subscribeQuickVoicePending(cb: (n: number) => void): () => void {
  listeners.add(cb);
  cb(pending);
  return () => {
    listeners.delete(cb);
  };
}

async function runJob(job: Job) {
  const { uid, blob, ext, language, callbacks } = job;
  const transcript = await transcribeWithGoogle(blob, {
    language,
    filename: `quick-${Date.now()}.${ext}`,
  });
  let title = "快速錄音紀錄";
  let body = transcript;
  try {
    const org = await organizeQuickVoice(transcript);
    title = org.title || title;
    body = org.body || transcript;
  } catch {
    /* keep raw transcript */
  }
  const dateKey = journalTitle();
  const noteId = await createNote(uid, title, "", undefined, ["quick-voice", "journal"], {
    folder: "日誌/快速錄音",
    journal_date: dateKey,
    icon: "mic",
  });
  const file = new File([blob], `quick-${Date.now()}.${ext}`, {
    type: blob.type || "audio/webm",
  });
  const up = await uploadNoteMedia(uid, noteId, file);
  const md = [
    body,
    ``,
    `<audio class="rich-audio" data-note-audio="1" controls preload="metadata" src="${up.url}" title="${file.name}"></audio>`,
    ``,
    `> 原始口述：${transcript}`,
  ].join("\n");
  await updateNote(noteId, { body_md: md });

  const journalBlock = [
    ``,
    `### ${title} · 快速錄音紀錄`,
    ``,
    body,
    ``,
    `<audio class="rich-audio" data-note-audio="1" controls preload="metadata" src="${up.url}"></audio>`,
    ``,
  ].join("\n");
  try {
    callbacks.onAppendJournal?.(journalBlock);
  } catch {
    /* page may have unmounted; note still saved */
  }
  try {
    callbacks.onCreatedNote?.(noteId);
  } catch {
    /* ignore */
  }
  toast(`已儲存「${title}」`);
}

/** Queue a clip; returns immediately. Processing continues even if UI unmounts. */
export function enqueueQuickVoiceJob(job: Job) {
  pending += 1;
  emit();
  chain = chain
    .then(async () => {
      try {
        await runJob(job);
      } catch (e) {
        toast(e instanceof Error ? e.message : "快速錄音紀錄失敗");
      } finally {
        pending = Math.max(0, pending - 1);
        emit();
      }
    })
    .catch(() => {
      /* isolated */
    });
}
