import { aiFetch } from "@/lib/aiFetch";
/** Note media → transcription → optional summary (resumable). */

import {
  createJob,
  updateJobStatus,
  uploadFile,
  listenToJob,
  getResultText,
  getNote,
  updateNote,
  fetchYoutubeTitle,
  type Job,
} from "@/lib/firebase";
import { askChoice } from "@/lib/dialogs";
import { segmentsToPlainText, parseTranscript } from "@/lib/transcript";
import type { MediaIngestDefault } from "@/lib/userPrefs";
import { loadPrefs } from "@/lib/userPrefs";

const API = () => {
  const raw = (process.env.NEXT_PUBLIC_API_BASE || "").trim();
  if (raw) return raw.replace(/^http:\/\//i, "https://");
  return "http://localhost:8000/api";
};
const PENDING_KEY = "cadence_media_ingest_pending_v1";

export type MediaIngestChoice = "embed" | "transcribe" | "transcribe_summarize";

export type TranscribableMedia =
  | { kind: "file"; file: File; label: string }
  | { kind: "youtube"; youtubeUrl: string; label: string };

export type PendingIngest = {
  noteId: string;
  jobId: string;
  choice: Exclude<MediaIngestChoice, "embed">;
  label: string;
  title?: string;
  createdAt: number;
};

export async function resolveMediaIngestChoice(opts: {
  label: string;
  count?: number;
  defaultPref?: MediaIngestDefault;
}): Promise<{ choice: MediaIngestChoice; remember: boolean } | null> {
  const pref = opts.defaultPref || "ask";
  if (pref !== "ask") {
    return { choice: pref, remember: false };
  }

  const count = opts.count && opts.count > 1 ? opts.count : 0;
  const result = await askChoice<MediaIngestChoice>({
    title: count ? `已插入 ${count} 個媒體` : "媒體已插入筆記",
    message: count
      ? `要對這 ${count} 個音訊／影片／YouTube 一併轉錄嗎？可離開本頁，完成後會自動寫回。`
      : `「${opts.label}」要一併做語音轉錄嗎？可離開本頁，完成後會自動寫回。`,
    cancelLabel: "僅嵌入",
    rememberLabel: "記住此選擇（可在設定更改）",
    options: [
      {
        id: "embed",
        label: "僅嵌入",
        description: "只保留媒體，稍後可再轉錄",
      },
      {
        id: "transcribe",
        label: "轉錄成逐字稿",
        description: "背景處理，完成後寫回本篇",
        primary: true,
      },
      {
        id: "transcribe_summarize",
        label: "轉錄 + AI 摘要",
        description: "逐字稿寫回後再產生摘要",
      },
    ],
  });
  if (!result) return { choice: "embed", remember: false };
  return result;
}

export async function startTranscriptionJob(opts: {
  uid: string;
  getIdToken: () => Promise<string>;
  media: TranscribableMedia;
  onProgress?: (label: string, pct?: number) => void;
  language?: string;
}): Promise<string> {
  const { uid, getIdToken, media, onProgress } = opts;
  const language = opts.language || loadPrefs().captureLanguage || "auto";

  if (media.kind === "youtube") {
    const ytTitle =
      (await fetchYoutubeTitle(media.youtubeUrl)) ||
      (media.label && !/^https?:\/\//i.test(media.label) ? media.label : "") ||
      "YouTube";
    const jobId = await createJob(uid, "youtube", [ytTitle], media.youtubeUrl, ytTitle);
    await updateJobStatus(jobId, { status: "queued", language, title: ytTitle, filenames: [ytTitle] });
    onProgress?.("已排入轉錄佇列", 5);
    const token = await getIdToken();
    const fd = new FormData();
    fd.append("job_id", jobId);
    fd.append("youtube_url", media.youtubeUrl);
    fd.append("language", language);
    void fetch(`${API()}/jobs/start`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    }).catch(() => {});
    return jobId;
  }

  const filename = media.file.name || `audio-${Date.now()}.webm`;
  const jobId = await createJob(uid, "upload", [filename], "");
  onProgress?.(`上傳 ${filename}…`, 10);
  const path = `uploads/${uid}/${jobId}/${filename}`;
  await uploadFile(path, media.file, (pct) => onProgress?.(`上傳 ${filename}`, pct));
  await updateJobStatus(jobId, {
    status: "queued",
    storage_paths: [path],
    total_files: 1,
    language,
  });
  onProgress?.("已排入轉錄佇列", 40);
  const token = await getIdToken();
  const fd = new FormData();
  fd.append("job_id", jobId);
  fd.append("language", language);
  void fetch(`${API()}/jobs/start`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  }).catch(() => {});
  return jobId;
}

export function ingestMarker(jobId: string) {
  return `<!-- cadence-ingest:${jobId} -->`;
}

export function bodyHasIngestResult(body: string, jobId: string) {
  return (
    body.includes(`[開啟工作](/job/${jobId})`) ||
    body.includes(`](/job/${jobId})`)
  );
}

export function replaceIngestMarker(body: string, jobId: string, block: string): string {
  const marker = ingestMarker(jobId);
  if (body.includes(marker)) {
    return body.replace(marker, block.trim());
  }
  if (body.includes(`/job/${jobId}`)) return body;
  const trimmed = body.trimEnd();
  return `${trimmed}${trimmed ? "\n\n" : ""}${block.trim()}\n`;
}

export function loadPendingIngests(noteId?: string): PendingIngest[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as PendingIngest[];
    if (!Array.isArray(list)) return [];
    const fresh = list.filter((p) => Date.now() - p.createdAt < 1000 * 60 * 60 * 12);
    if (fresh.length !== list.length) savePendingIngests(fresh);
    return noteId ? fresh.filter((p) => p.noteId === noteId) : fresh;
  } catch {
    return [];
  }
}

function savePendingIngests(list: PendingIngest[]) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-20)));
  } catch {
    /* ignore */
  }
}

export function upsertPendingIngest(pending: PendingIngest) {
  const list = loadPendingIngests().filter((p) => p.jobId !== pending.jobId);
  list.push(pending);
  savePendingIngests(list);
}

export function removePendingIngest(jobId: string) {
  savePendingIngests(loadPendingIngests().filter((p) => p.jobId !== jobId));
}

export function watchJob(
  jobId: string,
  onProgress?: (job: Job) => void
): { promise: Promise<Job>; cancel: () => void } {
  let unsub: (() => void) | null = null;
  let settled = false;
  const promise = new Promise<Job>((resolve, reject) => {
    unsub = listenToJob(jobId, (job) => {
      onProgress?.(job);
      if (settled) return;
      if (job.status === "done") {
        settled = true;
        unsub?.();
        resolve(job);
      } else if (job.status === "error") {
        settled = true;
        unsub?.();
        reject(new Error(job.error_message || "轉錄失敗"));
      }
    });
  });
  return {
    promise,
    cancel: () => {
      settled = true;
      unsub?.();
    },
  };
}

/** @deprecated use watchJob */
export async function waitForJobDone(
  jobId: string,
  onProgress?: (job: Job) => void
): Promise<Job> {
  return watchJob(jobId, onProgress).promise;
}

export async function loadJobPlainTranscript(job: Job): Promise<string> {
  let results = job.transcripts || [];
  if (results.length === 0 && job.result_paths?.length) {
    results = await Promise.all(
      job.result_paths.map(async (p) => ({
        filename: p.split("/").pop()?.replace(/\.txt$/, "") || "transcript",
        text: await getResultText(p),
      }))
    );
  }
  const chunks = results
    .map((r) => {
      const plain = segmentsToPlainText(parseTranscript(r.text || ""));
      return plain.trim() || (r.text || "").trim();
    })
    .filter(Boolean);
  return chunks.join("\n\n").trim();
}

export async function summarizeTranscript(opts: {
  title: string;
  transcript: string;
  assistant?: {
    name?: string;
    style?: string;
    model?: string;
    grounding?: boolean;
  };
}): Promise<string> {
  const res = await aiFetch("/api/ai/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "summarize",
      title: opts.title,
      body: opts.transcript.slice(0, 14000),
      assistant: opts.assistant,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "摘要失敗");
  return String(data.text || "").trim();
}

export function formatIngestBlock(opts: {
  label: string;
  transcript: string;
  summary?: string;
  jobId: string;
}): string {
  const body = (opts.transcript || "（無內容）").trim();
  const parts = [
    `:::toggle 逐字稿（${opts.label}）`,
    body,
    `:::`,
  ];
  if (opts.summary) {
    parts.push("", `:::toggle AI 摘要`, opts.summary.trim(), `:::`);
  }
  parts.push("", `> 來源轉錄：[開啟工作](/job/${opts.jobId})`, "");
  return parts.join("\n");
}

export async function finalizePendingIngest(
  pending: PendingIngest,
  opts?: {
    assistant?: {
      name?: string;
      style?: string;
      model?: string;
      grounding?: boolean;
    };
    onProgress?: (label: string) => void;
  }
): Promise<{ body: string; summary?: string } | null> {
  const note = await getNote(pending.noteId);
  if (!note) {
    removePendingIngest(pending.jobId);
    return null;
  }
  if (bodyHasIngestResult(note.body_md, pending.jobId)) {
    removePendingIngest(pending.jobId);
    return null;
  }

  opts?.onProgress?.("等待轉錄完成…");
  const job = await watchJob(pending.jobId, (j) => {
    if (j.status === "processing") {
      opts?.onProgress?.(`轉錄中 ${j.progress || 0}%`);
    } else if (j.status === "queued") {
      opts?.onProgress?.("排隊中…");
    }
  }).promise;
  const transcript = await loadJobPlainTranscript(job);
  let summary = "";
  if (pending.choice === "transcribe_summarize" && transcript) {
    opts?.onProgress?.("產生 AI 摘要…");
    summary = await summarizeTranscript({
      title: pending.title || pending.label,
      transcript,
      assistant: opts?.assistant,
    });
  }

  const block = formatIngestBlock({
    label: pending.label,
    transcript: transcript || "（無內容）",
    summary: summary || undefined,
    jobId: pending.jobId,
  });
  const nextBody = replaceIngestMarker(note.body_md, pending.jobId, block);
  await updateNote(pending.noteId, {
    body_md: nextBody,
    source_job_id: pending.jobId,
  });
  removePendingIngest(pending.jobId);
  return { body: nextBody, summary: summary || undefined };
}
