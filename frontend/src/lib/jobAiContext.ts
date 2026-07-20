/** Bridge: job transcript page → Global AI dock context */

import { segmentsToPlainText, parseTranscript } from "@/lib/transcript";

export type JobAiContext = {
  jobId: string;
  title: string;
  filename?: string;
  transcript: string;
};

type Listener = (ctx: JobAiContext | null) => void;

let current: JobAiContext | null = null;
const listeners = new Set<Listener>();

export function setJobAiContext(ctx: JobAiContext | null) {
  current = ctx;
  listeners.forEach((cb) => cb(current));
}

export function getJobAiContext() {
  return current;
}

export function subscribeJobAiContext(cb: Listener): () => void {
  listeners.add(cb);
  cb(current);
  return () => {
    listeners.delete(cb);
  };
}

/** Pack transcript for AI prompts (same idea as former TranscriptChat). */
export function packTranscriptForAi(raw: string, maxChars = 12000): string {
  const plain =
    segmentsToPlainText(parseTranscript(raw || "")).trim() || (raw || "").trim();
  if (plain.length <= maxChars) return plain;
  return `${plain.slice(0, maxChars)}\n\n…（後續省略）`;
}

export const JOB_AI_SUGGESTIONS = [
  { label: "三點摘要", prompt: "用三點摘要這段逐字稿的核心內容" },
  { label: "筆記大綱", prompt: "把逐字稿整理成適合寫筆記的 Markdown 大綱" },
  { label: "金句重點", prompt: "抽出金句與關鍵論點，條列說明" },
  { label: "行動項目", prompt: "從內容抽出可執行的待辦清單（- [ ]）" },
  { label: "名詞解釋", prompt: "列出出現的專有名詞並用白話解釋" },
];
