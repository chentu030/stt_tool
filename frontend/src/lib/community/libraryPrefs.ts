/** Local store prefs: favorites, recent, safe mode, update checks, reports */

import type { PackageReport } from "@/lib/community/types";

const FAV_KEY = "albireus_community_favorites_v1";
const RECENT_KEY = "albireus_community_recent_v1";
const REPORT_KEY = "albireus_community_reports_v1";
const SAFE_KEY = "albireus_community_safe_mode_v1";
const UPDATE_CHECK_KEY = "albireus_community_last_update_check_v1";

export const REPORT_REASONS = [
  { id: "malware", label: "疑似惡意／不安全" },
  { id: "misleading", label: "誤導或描述不符" },
  { id: "broken", label: "無法使用／連結失效" },
  { id: "spam", label: "垃圾／低品質" },
  { id: "ip", label: "侵權疑慮" },
  { id: "other", label: "其他" },
] as const;

export type ReportReasonId = (typeof REPORT_REASONS)[number]["id"];

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
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function getFavoriteIds(): string[] {
  return readJson<string[]>(FAV_KEY, []);
}

export function isFavorite(id: string): boolean {
  return getFavoriteIds().includes(id);
}

export function toggleFavorite(id: string): boolean {
  const list = getFavoriteIds().filter((x) => x !== id);
  const nextOn = !getFavoriteIds().includes(id);
  if (nextOn) list.unshift(id);
  writeJson(FAV_KEY, list.slice(0, 100));
  return nextOn;
}

export function getRecentPackageIds(): string[] {
  return readJson<string[]>(RECENT_KEY, []);
}

export function touchRecentPackage(id: string) {
  const list = [id, ...getRecentPackageIds().filter((x) => x !== id)];
  writeJson(RECENT_KEY, list.slice(0, 24));
}

/** When safe mode is on, community extensions are hidden from sidebar / not loaded in notes. */
export function isCommunitySafeMode(): boolean {
  return readJson<boolean>(SAFE_KEY, false) === true;
}

export function setCommunitySafeMode(on: boolean) {
  writeJson(SAFE_KEY, on);
}

export function getLastUpdateCheckAt(): number {
  return readJson<number>(UPDATE_CHECK_KEY, 0);
}

export function setLastUpdateCheckAt(ts = Date.now()) {
  writeJson(UPDATE_CHECK_KEY, ts);
}

/** True if we should quietly re-check (default: every 24h). */
export function shouldAutoCheckUpdates(maxAgeMs = 24 * 60 * 60 * 1000): boolean {
  const last = getLastUpdateCheckAt();
  return !last || Date.now() - last > maxAgeMs;
}

export function getLocalReports(): Record<string, PackageReport> {
  return readJson<Record<string, PackageReport>>(REPORT_KEY, {});
}

export function saveLocalReport(report: PackageReport) {
  const map = getLocalReports();
  map[report.packageId] = report;
  writeJson(REPORT_KEY, map);
}
