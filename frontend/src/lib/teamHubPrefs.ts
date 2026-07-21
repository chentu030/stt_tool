/**
 * Local prefs for the Slack-inspired Team Hub:
 * starred teams, saved-for-later messages, last hub tab.
 */

const STARRED_KEY = "albireus.teamHub.starred.v1";
const LATER_KEY = "albireus.teamHub.later.v1";
const TAB_KEY = "albireus.teamHub.tab.v1";

export type HubTab = "home" | "activity" | "dms" | "later" | "people";

export type LaterItem = {
  id: string;
  teamId: string;
  teamName: string;
  channelId: string;
  channelName: string;
  messageId: string;
  text: string;
  authorName: string;
  savedAt: number;
};

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota */
  }
}

export function getStarredTeamIds(): string[] {
  const v = readJson<string[]>(STARRED_KEY, []);
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}

export function setStarredTeamIds(ids: string[]) {
  writeJson(STARRED_KEY, ids);
}

export function toggleStarredTeam(teamId: string): string[] {
  const cur = getStarredTeamIds();
  const next = cur.includes(teamId) ? cur.filter((id) => id !== teamId) : [teamId, ...cur];
  setStarredTeamIds(next);
  return next;
}

export function getLaterItems(): LaterItem[] {
  const v = readJson<LaterItem[]>(LATER_KEY, []);
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => x && typeof x.id === "string" && typeof x.teamId === "string")
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

export function addLaterItem(item: Omit<LaterItem, "id" | "savedAt"> & { savedAt?: number }): LaterItem[] {
  const list = getLaterItems();
  const id = `${item.teamId}:${item.channelId}:${item.messageId}`;
  const next: LaterItem = {
    ...item,
    id,
    savedAt: item.savedAt ?? Date.now(),
  };
  const filtered = list.filter((x) => x.id !== id);
  const out = [next, ...filtered].slice(0, 100);
  writeJson(LATER_KEY, out);
  return out;
}

export function removeLaterItem(id: string): LaterItem[] {
  const out = getLaterItems().filter((x) => x.id !== id);
  writeJson(LATER_KEY, out);
  return out;
}

export function isLaterSaved(teamId: string, channelId: string, messageId: string): boolean {
  const id = `${teamId}:${channelId}:${messageId}`;
  return getLaterItems().some((x) => x.id === id);
}

export function getHubTab(): HubTab {
  const t = readJson<string>(TAB_KEY, "home");
  if (t === "activity" || t === "dms" || t === "later" || t === "people" || t === "home") return t;
  return "home";
}

export function setHubTab(tab: HubTab) {
  writeJson(TAB_KEY, tab);
}
