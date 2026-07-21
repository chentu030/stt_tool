/** Local + Firestore package ratings / reports */

import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { PackageRating, PackageReport } from "@/lib/community/types";
import { saveLocalReport } from "@/lib/community/libraryPrefs";

const LS_KEY = "albireus_community_ratings_v1";

function readLocal(): Record<string, PackageRating> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as Record<string, PackageRating>;
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

function writeLocal(map: Record<string, PackageRating>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function getLocalRating(packageId: string): PackageRating | null {
  if (typeof window === "undefined") return null;
  return readLocal()[packageId] || null;
}

export function setLocalRating(rating: PackageRating) {
  const map = readLocal();
  map[rating.packageId] = rating;
  writeLocal(map);
}

export async function getUserRating(uid: string, packageId: string): Promise<PackageRating | null> {
  const local = getLocalRating(packageId);
  try {
    const snap = await getDoc(doc(db, "users", uid, "community_ratings", packageId));
    if (snap.exists()) {
      return snap.data() as PackageRating;
    }
  } catch {
    /* fall through */
  }
  return local;
}

export async function saveUserRating(uid: string, rating: PackageRating) {
  setLocalRating(rating);
  await setDoc(doc(db, "users", uid, "community_ratings", rating.packageId), {
    packageId: rating.packageId,
    stars: rating.stars,
    comment: rating.comment || "",
    updatedAt: rating.updatedAt,
  });
}

export async function saveUserReport(uid: string, report: PackageReport) {
  saveLocalReport(report);
  await setDoc(doc(db, "users", uid, "community_reports", report.packageId), {
    packageId: report.packageId,
    reason: report.reason,
    detail: report.detail || "",
    updatedAt: report.updatedAt,
  });
}

/** Blend catalog seed rating with user rating for display */
export function displayRating(seed: number | undefined, user: PackageRating | null): {
  value: number;
  label: string;
} {
  if (user?.stars) {
    const v = Math.max(1, Math.min(5, user.stars));
    return { value: v, label: `你的評分 ${v}` };
  }
  if (typeof seed === "number" && seed > 0) {
    const v = Math.max(0, Math.min(5, seed));
    return { value: v, label: v.toFixed(1) };
  }
  return { value: 0, label: "尚無評分" };
}
