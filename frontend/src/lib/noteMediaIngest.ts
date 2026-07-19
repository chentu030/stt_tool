/** Start a transcription job from note-embedded media (file or YouTube). */

import {
  createJob,
  updateJobStatus,
  uploadFile,
  listenToJob,
  getResultText,
  type Job,
} from "@/lib/firebase";
import { askChoice } from "@/lib/dialogs";
import { segmentsToPlainText, parseTranscript } from "@/lib/transcript";

const API = () => process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000/api";

export type MediaIngestChoice = "embed" | "transcribe" | "transcribe_summarize";

export type TranscribableMedia =
  | { kind: "file"; file: File; label: string }
  | { kind: "youtube"; youtubeUrl: string; label: string };

export async function askMediaIngestChoice(label: string): Promise<MediaIngestChoice | null> {
  return askChoice<MediaIngestChoice>({
    title: "媒體已插入筆記",
    message: `「${label}」要一併做語音轉錄嗎？可選擇完成後自動寫入 AI 摘要。`,
    cancelLabel: "關閉",
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
}

export async function startTranscriptionJob(opts: {
  uid: string;
  getIdToken: () => Promise<string>;
  media: TranscribableMedia;
  onProgress?: (label: string, pct?: number) => void;
}): Promise<string> {
  const { uid, getIdToken, media, onProgress } = opts;

  if (media.kind === "youtube") {
    const jobId = await createJob(uid, "youtube", [media.label || "YouTube"], media.youtubeUrl);
    await updateJobStatus(jobId, { status: "queued" });
    onProgress?.("已排入轉錄佇列", 5);
    const token = await getIdToken();
    const fd = new FormData();
    fd.append("job_id", jobId);
    fd.append("youtube_url", media.youtubeUrl);
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
  });
  onProgress?.("已排入轉錄佇列", 40);
  const token = await getIdToken();
  const fd = new FormData();
  fd.append("job_id", jobId);
  void fetch(`${API()}/jobs/start`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  }).catch(() => {});
  return jobId;
}

export async function waitForJobDone(
  jobId: string,
  onProgress?: (job: Job) => void
): Promise<Job> {
  return new Promise((resolve, reject) => {
    const unsub = listenToJob(jobId, (job) => {
      onProgress?.(job);
      if (job.status === "done") {
        unsub();
        resolve(job);
      } else if (job.status === "error") {
        unsub();
        reject(new Error(job.error_message || "轉錄失敗"));
      }
    });
  });
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
  const res = await fetch("/api/ai/generate", {
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
  const parts = [
    "",
    "---",
    "",
    `## 逐字稿（${opts.label}）`,
    "",
    opts.transcript || "（無內容）",
  ];
  if (opts.summary) {
    parts.push("", "## AI 摘要", "", opts.summary);
  }
  parts.push("", `> 來源轉錄：[開啟工作](/job/${opts.jobId})`, "");
  return parts.join("\n");
}
