/** Local store prefs: favorites, recently viewed, restricted-mode ack, reports */

import type { PackageReport } from "@/lib/community/types";

const FAV_KEY = "albireus_community_favorites_v1";
const RECENT_KEY = "albireus_community_recent_v1";
const ACK_KEY = "albireus_community_plugins_ack_v1";
const REPORT_KEY = "albireus_community_reports_v1";

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

export function hasCommunityPluginsAck(): boolean {
  return readJson<boolean>(ACK_KEY, false) === true;
}

export function setCommunityPluginsAck() {
  writeJson(ACK_KEY, true);
}

export function getLocalReports(): Record<string, PackageReport> {
  return readJson<Record<string, PackageReport>>(REPORT_KEY, {});
}

export function saveLocalReport(report: PackageReport) {
  const map = getLocalReports();
  map[report.packageId] = report;
  writeJson(REPORT_KEY, map);
}
