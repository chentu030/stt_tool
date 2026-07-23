/**
 * App-level quick-voice job queue — survives leaving /journal while STT + AI run.
 * Jobs are also persisted to IndexedDB so a refresh mid-queue can resume.
 */

import { createNote, updateNote, uploadNoteMedia } from "@/lib/firebase";
import { organizeQuickVoice, transcribeWithGoogle } from "@/lib/googleStt";
import { journalTitle } from "@/lib/templates";
import { toast } from "@/lib/toast";
import {
  deleteQuickVoiceJob,
  listQuickVoiceJobs,
  newQuickVoiceId,
  saveQuickVoiceJob,
  type PersistedQuickVoiceJob,
} from "@/lib/quickVoicePersist";

export type QuickVoiceCallbacks = {
  onAppendJournal?: (md: string) => void;
  onCreatedNote?: (noteId: string) => void;
};

type Job = {
  id?: string;
  uid: string;
  blob: Blob;
  ext: string;
  language: string;
  callbacks: QuickVoiceCallbacks;
};

let chain: Promise<void> = Promise.resolve();
let pending = 0;
let resumeStarted = false;
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

function enqueueInternal(job: Job, opts?: { persist?: boolean }) {
  const id = job.id || newQuickVoiceId("job");
  const full: Job = { ...job, id };
  pending += 1;
  emit();

  if (opts?.persist !== false) {
    void saveQuickVoiceJob({
      id,
      uid: full.uid,
      blob: full.blob,
      ext: full.ext,
      language: full.language,
      createdAt: Date.now(),
    });
  }

  chain = chain
    .then(async () => {
      try {
        await runJob(full);
        if (id) await deleteQuickVoiceJob(id);
      } catch (e) {
        toast(e instanceof Error ? e.message : "快速錄音紀錄失敗");
        // Keep persisted job for next resume attempt.
      } finally {
        pending = Math.max(0, pending - 1);
        emit();
      }
    })
    .catch(() => {
      /* isolated */
    });
}

/** Queue a clip; returns immediately. Processing continues even if UI unmounts. */
export function enqueueQuickVoiceJob(job: Job) {
  enqueueInternal(job, { persist: true });
}

/**
 * Re-queue jobs left in IndexedDB after a crash / refresh.
 * Safe to call multiple times; only runs once per page load.
 */
export function resumePersistedQuickVoiceJobs(defaultCallbacks: QuickVoiceCallbacks = {}) {
  if (resumeStarted || typeof window === "undefined") return;
  resumeStarted = true;
  void (async () => {
    const rows: PersistedQuickVoiceJob[] = await listQuickVoiceJobs();
    if (!rows.length) return;
    toast(`恢復 ${rows.length} 段未完成的快速錄音整理…`);
    for (const row of rows) {
      enqueueInternal(
        {
          id: row.id,
          uid: row.uid,
          blob: row.blob,
          ext: row.ext,
          language: row.language,
          callbacks: defaultCallbacks,
        },
        { persist: false }
      );
    }
  })();
}
