/** Client helpers for speech transcription (Google batch when available, Whisper fallback). */

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

function mapCaptureLangToWhisper(lang?: string): string {
  const s = (lang || "zh-TW").trim();
  if (!s || s === "auto") return "None";
  if (s === "zh-TW" || s === "zh-CN" || s.startsWith("zh")) return "zh";
  if (s === "en" || s.startsWith("en")) return "en";
  if (s === "ja" || s.startsWith("ja")) return "ja";
  return s;
}

function detailMessage(data: unknown, status: number): string {
  if (data && typeof data === "object" && "detail" in data) {
    const d = (data as { detail?: unknown }).detail;
    if (typeof d === "string" && d.trim()) {
      if (d === "Not Found" || status === 404) {
        return "後端尚未部署 Google STT 路由（404）。改用現有 Whisper 通道。";
      }
      return d;
    }
    if (Array.isArray(d)) {
      return d.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join("; ");
    }
  }
  return `STT 失敗（${status}）`;
}

async function transcribeViaGoogleBatch(
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
    throw new Error(detailMessage(data, res.status));
  }
  const text = (data.text || "").trim();
  if (!text) throw new Error("未辨識到語音");
  return text;
}

/** Production Cloud Run already has this — Replicate Whisper, returns segments. */
async function transcribeViaWhisperFallback(
  blob: Blob,
  opts?: { language?: string; filename?: string }
): Promise<string> {
  const fd = new FormData();
  const name = opts?.filename || `clip-${Date.now()}.webm`;
  fd.append("file", blob, name);
  fd.append("language", mapCaptureLangToWhisper(opts?.language));
  const res = await fetch(`${apiBase()}/beidanzi/upload`, { method: "POST", body: fd });
  const data = (await res.json().catch(() => ({}))) as {
    segments?: Array<{ text?: string }>;
    detail?: string;
  };
  if (!res.ok) {
    throw new Error(detailMessage(data, res.status));
  }
  const text = (data.segments || [])
    .map((s) => (s.text || "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!text) throw new Error("未辨識到語音");
  return text;
}

/**
 * Prefer Google V2 dynamic batch (`/stt/google`).
 * If that route is missing (404 / Not Found) — common before Cloud Run redeploy —
 * fall back to existing Whisper (`/beidanzi/upload`) so live capture still works.
 */
export async function transcribeWithGoogle(
  blob: Blob,
  opts?: { language?: string; filename?: string }
): Promise<string> {
  try {
    return await transcribeViaGoogleBatch(blob, opts);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const shouldFallback =
      /404|Not Found|尚未部署 Google STT/i.test(msg) ||
      /找不到|UNAVAILABLE|503/i.test(msg);
    if (!shouldFallback) throw e;
    return transcribeViaWhisperFallback(blob, opts);
  }
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
