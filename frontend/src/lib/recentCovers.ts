/** Per-user recent note cover image URLs (localStorage). */

const MAX_RECENT = 16;
const KEY_PREFIX = "cadence_recent_covers_";

function storageKey(userId: string) {
  return `${KEY_PREFIX}${userId || "anon"}`;
}

export function listRecentCovers(userId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u.trim()))
      .map((u) => u.trim())
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

/** Push URL to the front of the recent list (deduped). Empty / non-http ignored. */
export function pushRecentCover(userId: string, url: string): string[] {
  const trimmed = (url || "").trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return listRecentCovers(userId);
  const next = [trimmed, ...listRecentCovers(userId).filter((u) => u !== trimmed)].slice(
    0,
    MAX_RECENT
  );
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
  return next;
}

export function removeRecentCover(userId: string, url: string): string[] {
  const next = listRecentCovers(userId).filter((u) => u !== url);
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}
