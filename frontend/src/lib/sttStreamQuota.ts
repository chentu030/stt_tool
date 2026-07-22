/** Client-side soft quota for Google realtime streaming STT (minutes). */

const STORAGE_KEY = "cadence_stt_stream_used_secs_v1";

/** Product soft cap while streaming is in early access. */
export const STREAM_QUOTA_MAX_SECS = 5 * 60 * 60; // 300 minutes
export const STREAM_QUOTA_MAX_MINS = STREAM_QUOTA_MAX_SECS / 60;

export function getStreamUsedSecs(): number {
  if (typeof window === "undefined") return 0;
  try {
    const n = Number(localStorage.getItem(STORAGE_KEY) || "0");
    return Number.isFinite(n) ? Math.max(0, Math.min(STREAM_QUOTA_MAX_SECS, Math.floor(n))) : 0;
  } catch {
    return 0;
  }
}

export function setStreamUsedSecs(secs: number): number {
  const next = Math.max(0, Math.min(STREAM_QUOTA_MAX_SECS, Math.floor(secs)));
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      /* ignore */
    }
  }
  return next;
}

/** Add seconds of streaming usage; returns new total. */
export function addStreamUsedSecs(delta: number): number {
  return setStreamUsedSecs(getStreamUsedSecs() + Math.max(0, delta));
}

export function streamRemainingSecs(): number {
  return Math.max(0, STREAM_QUOTA_MAX_SECS - getStreamUsedSecs());
}

export function formatStreamQuota(usedSecs: number): string {
  const used = Math.min(STREAM_QUOTA_MAX_MINS, Math.floor(usedSecs / 60));
  return `${used}/${STREAM_QUOTA_MAX_MINS} 分鐘`;
}
