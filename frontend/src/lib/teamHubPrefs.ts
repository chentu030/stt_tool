/**
 * Local prefs for the Slack-inspired Team Hub:
 * starred teams, saved-for-later messages, last hub tab.
 */

const STARRED_KEY = "albireus.teamHub.starred.v1";
const LATER_KEY = "albireus.teamHub.later.v1";
const TAB_KEY = "albireus.teamHub.tab.v1";

export type HubTab =
  | "home"
  | "unreads"
  | "activity"
  | "dms"
  | "threads"
  | "drafts"
  | "files"
  | "later"
  | "people"
  | "canvas";

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
  /** Mark done (kept until removed) */
  done?: boolean;
  /** Unix ms — show reminder toast when due */
  remindAt?: number;
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

export function updateLaterItem(id: string, patch: Partial<LaterItem>): LaterItem[] {
  const out = getLaterItems().map((x) => (x.id === id ? { ...x, ...patch, id: x.id } : x));
  writeJson(LATER_KEY, out);
  return out;
}

export function snoozeLaterItem(id: string, msFromNow: number): LaterItem[] {
  return updateLaterItem(id, { remindAt: Date.now() + msFromNow, done: false });
}

export function completeLaterItem(id: string, done = true): LaterItem[] {
  return updateLaterItem(id, { done });
}

export function dueLaterReminders(now = Date.now()): LaterItem[] {
  return getLaterItems().filter((x) => !x.done && x.remindAt && x.remindAt <= now);
}

export function isLaterSaved(teamId: string, channelId: string, messageId: string): boolean {
  const id = `${teamId}:${channelId}:${messageId}`;
  return getLaterItems().some((x) => x.id === id);
}

export function getHubTab(): HubTab {
  const t = readJson<string>(TAB_KEY, "home");
  const ok: HubTab[] = [
    "home",
    "unreads",
    "activity",
    "dms",
    "threads",
    "drafts",
    "files",
    "later",
    "people",
    "canvas",
  ];
  if (ok.includes(t as HubTab)) return t as HubTab;
  return "home";
}

export function setHubTab(tab: HubTab) {
  writeJson(TAB_KEY, tab);
}

/* ── Custom sections (Teams-style grouping) ── */

const SECTIONS_KEY = "albireus.teamHub.sections.v1";

export type HubSection = {
  id: string;
  name: string;
  teamIds: string[];
};

export function getHubSections(): HubSection[] {
  const v = readJson<HubSection[]>(SECTIONS_KEY, []);
  if (!Array.isArray(v)) return [];
  return v
    .filter((s) => s && typeof s.id === "string" && typeof s.name === "string")
    .map((s) => ({
      id: s.id,
      name: String(s.name).slice(0, 40) || "未命名",
      teamIds: Array.isArray(s.teamIds) ? s.teamIds.filter((x) => typeof x === "string") : [],
    }));
}

export function setHubSections(sections: HubSection[]) {
  writeJson(SECTIONS_KEY, sections.slice(0, 30));
}

export function createHubSection(name: string): HubSection[] {
  const list = getHubSections();
  const id = `sec_${Date.now().toString(36)}`;
  const next = [...list, { id, name: name.trim() || "新分區", teamIds: [] }];
  setHubSections(next);
  return next;
}

export function renameHubSection(id: string, name: string): HubSection[] {
  const next = getHubSections().map((s) =>
    s.id === id ? { ...s, name: name.trim() || s.name } : s
  );
  setHubSections(next);
  return next;
}

export function deleteHubSection(id: string): HubSection[] {
  const next = getHubSections().filter((s) => s.id !== id);
  setHubSections(next);
  return next;
}

/** Move team into a section (or null = ungrouped). Removes from other sections. */
export function moveTeamToSection(teamId: string, sectionId: string | null): HubSection[] {
  const next = getHubSections().map((s) => ({
    ...s,
    teamIds: s.teamIds.filter((id) => id !== teamId),
  }));
  if (sectionId) {
    const idx = next.findIndex((s) => s.id === sectionId);
    if (idx >= 0) next[idx] = { ...next[idx], teamIds: [...next[idx].teamIds, teamId] };
  }
  setHubSections(next);
  return next;
}

export function sectionIdForTeam(teamId: string, sections = getHubSections()): string | null {
  const hit = sections.find((s) => s.teamIds.includes(teamId));
  return hit?.id || null;
}
