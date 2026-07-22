/** Client helpers for Google Cloud STT via backend `/api/stt/google`. */

function apiBase(): string {
  const raw = (process.env.NEXT_PUBLIC_API_BASE || "").trim();
  if (raw) return raw.replace(/^http:\/\//i, "https://").replace(/\/$/, "");
  return "http://localhost:8000/api";
}

export function mapCaptureLangToGoogle(lang?: string): string {
  const s = (lang || "zh-TW").trim();
  if (!s || s === "auto") return "zh-TW";
  if (s === "zh-TW" || s === "zh-CN") return s;
  if (s === "en") return "en-US";
  if (s === "ja") return "ja-JP";
  return s;
}

export async function transcribeWithGoogle(
  blob: Blob,
  opts?: { language?: string; filename?: string }
): Promise<string> {
  const fd = new FormData();
  const name = opts?.filename || `clip-${Date.now()}.webm`;
  fd.append("file", blob, name);
  fd.append("language", mapCaptureLangToGoogle(opts?.language));
  const res = await fetch(`${apiBase()}/stt/google`, { method: "POST", body: fd });
  const data = (await res.json().catch(() => ({}))) as { text?: string; detail?: string };
  if (!res.ok) {
    throw new Error(typeof data.detail === "string" ? data.detail : `STT 失敗（${res.status}）`);
  }
  const text = (data.text || "").trim();
  if (!text) throw new Error("未辨識到語音");
  return text;
}

export async function organizeLiveSegment(transcript: string): Promise<string> {
  const res = await fetch("/api/ai/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "custom",
      title: "即時轉錄段落",
      prompt: `你是會議／課堂紀錄助手。根據下面逐字稿，用繁體中文輸出精簡整理（條列重點、待辦若有）。不要重複廢話，不要加前言。\n\n逐字稿：\n${transcript.slice(0, 8000)}`,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok) throw new Error(data.error || "整理失敗");
  return (data.text || "").trim();
}

export async function organizeQuickVoice(transcript: string): Promise<{ title: string; body: string }> {
  const res = await fetch("/api/ai/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "custom",
      title: "快速錄音想法",
      prompt: `你是想法整理助手。使用者剛用語音記下飛過腦中的點子。請用繁體中文：
1) 第一行只輸出短標題（不超過 20 字，不要標點裝飾）
2) 空一行後輸出整理後的筆記（可條列）

逐字稿：
${transcript.slice(0, 6000)}`,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok) throw new Error(data.error || "整理失敗");
  const raw = (data.text || "").trim();
  const lines = raw.split(/\r?\n/);
  const title = (lines[0] || "快速想法").replace(/^#+\s*/, "").trim() || "快速想法";
  const body = lines.slice(1).join("\n").trim() || transcript;
  return { title, body };
}
