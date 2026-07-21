/**
 * Shared draft / later / star / notif prefs for Team Hub + room.
 */

const STARRED_CHANNELS_KEY = "albireus.teamHub.starredChannels.v1";
const NOTIF_PREFS_KEY = "albireus.teamHub.notifPrefs.v1";
const DRAFT_PREFIX = "cadence:tm:";

export type NotifPrefs = {
  desktop: boolean;
  sound: boolean;
  /** all = any channel activity toast when focused; mentions = only @/DM; off = none */
  mode: "all" | "mentions" | "off";
};

export const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  desktop: true,
  sound: true,
  mode: "mentions",
};

export type DraftItem = {
  key: string;
  teamId: string;
  channelId: string;
  text: string;
  updatedAt: number;
};

export function channelStarKey(teamId: string, channelId: string) {
  return `${teamId}:${channelId}`;
}

export function getStarredChannelKeys(): string[] {
  try {
    const raw = localStorage.getItem(STARRED_CHANNELS_KEY);
    const v = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function setStarredChannelKeys(keys: string[]) {
  try {
    localStorage.setItem(STARRED_CHANNELS_KEY, JSON.stringify(keys.slice(0, 200)));
  } catch {
    /* quota */
  }
}

export function toggleStarredChannel(teamId: string, channelId: string): string[] {
  const key = channelStarKey(teamId, channelId);
  const cur = getStarredChannelKeys();
  const next = cur.includes(key) ? cur.filter((k) => k !== key) : [key, ...cur];
  setStarredChannelKeys(next);
  return next;
}

export function isChannelStarred(teamId: string, channelId: string): boolean {
  return getStarredChannelKeys().includes(channelStarKey(teamId, channelId));
}

export function getNotifPrefs(): NotifPrefs {
  try {
    const raw = localStorage.getItem(NOTIF_PREFS_KEY);
    if (!raw) return { ...DEFAULT_NOTIF_PREFS };
    const v = JSON.parse(raw) as Partial<NotifPrefs>;
    return {
      desktop: v.desktop !== false,
      sound: v.sound !== false,
      mode: v.mode === "all" || v.mode === "off" || v.mode === "mentions" ? v.mode : "mentions",
    };
  } catch {
    return { ...DEFAULT_NOTIF_PREFS };
  }
}

export function setNotifPrefs(patch: Partial<NotifPrefs>): NotifPrefs {
  const next = { ...getNotifPrefs(), ...patch };
  try {
    localStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function listLocalDrafts(): DraftItem[] {
  if (typeof window === "undefined") return [];
  const out: DraftItem[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(DRAFT_PREFIX)) continue;
      const m = key.match(/^cadence:tm:([^:]+):ch:([^:]+):draft$/);
      if (!m) continue;
      const text = localStorage.getItem(key) || "";
      if (!text.trim()) continue;
      out.push({
        key,
        teamId: m[1],
        channelId: m[2],
        text: text.slice(0, 200),
        updatedAt: Date.now(),
      });
    }
  } catch {
    /* ignore */
  }
  return out.sort((a, b) => b.text.length - a.text.length);
}

export function clearLocalDraft(teamId: string, channelId: string) {
  try {
    localStorage.removeItem(`cadence:tm:${teamId}:ch:${channelId}:draft`);
  } catch {
    /* ignore */
  }
}

/** Beep for soft in-app alert (no asset file). */
export function playNotifSound() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.value = 0.04;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.12);
    setTimeout(() => void ctx.close(), 300);
  } catch {
    /* ignore */
  }
}

export async function ensureDesktopNotifPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const r = await Notification.requestPermission();
  return r === "granted";
}

export function showDesktopNotification(title: string, body: string, onClick?: () => void) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body: body.slice(0, 140), silent: true });
    if (onClick) {
      n.onclick = () => {
        window.focus();
        onClick();
        n.close();
      };
    }
    setTimeout(() => n.close(), 8000);
  } catch {
    /* ignore */
  }
}

/* ── Followed threads (Slack-style) ── */

const FOLLOWED_KEY = "albireus.teamHub.followedThreads.v1";

export type FollowedThread = {
  id: string;
  teamId: string;
  teamName: string;
  channelId: string;
  channelName: string;
  messageId: string;
  preview: string;
  authorName: string;
  followedAt: number;
};

export function getFollowedThreads(): FollowedThread[] {
  try {
    const raw = localStorage.getItem(FOLLOWED_KEY);
    const v = raw ? (JSON.parse(raw) as FollowedThread[]) : [];
    if (!Array.isArray(v)) return [];
    return v
      .filter((x) => x && typeof x.id === "string")
      .sort((a, b) => (b.followedAt || 0) - (a.followedAt || 0));
  } catch {
    return [];
  }
}

export function setFollowedThreads(items: FollowedThread[]) {
  try {
    localStorage.setItem(FOLLOWED_KEY, JSON.stringify(items.slice(0, 80)));
  } catch {
    /* ignore */
  }
}

export function followThread(item: Omit<FollowedThread, "id" | "followedAt"> & { followedAt?: number }): FollowedThread[] {
  const id = `${item.teamId}:${item.channelId}:${item.messageId}`;
  const list = getFollowedThreads().filter((x) => x.id !== id);
  const next: FollowedThread = { ...item, id, followedAt: item.followedAt ?? Date.now() };
  const out = [next, ...list];
  setFollowedThreads(out);
  return out;
}

export function unfollowThread(id: string): FollowedThread[] {
  const out = getFollowedThreads().filter((x) => x.id !== id);
  setFollowedThreads(out);
  return out;
}

export function isThreadFollowed(teamId: string, channelId: string, messageId: string): boolean {
  const id = `${teamId}:${channelId}:${messageId}`;
  return getFollowedThreads().some((x) => x.id === id);
}
