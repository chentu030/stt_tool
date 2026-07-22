/** Per-user Cloud Storage quota (client-enforced counter). */

import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

/** Soft cap per account during beta. */
export const USER_STORAGE_LIMIT_BYTES = 500 * 1024 * 1024; // 500 MB

export type StorageQuota = {
  usedBytes: number;
  limitBytes: number;
  updatedAt: number;
};

function quotaRef(uid: string) {
  return doc(db, "users", uid, "workspace", "storage_quota");
}

export function formatBytes(bytes: number): string {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) {
    const mb = n / (1024 * 1024);
    return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
  }
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function storageUsageRatio(used: number, limit = USER_STORAGE_LIMIT_BYTES): number {
  if (limit <= 0) return 0;
  return Math.min(1, Math.max(0, used / limit));
}

export async function getStorageQuota(uid: string): Promise<StorageQuota> {
  try {
    const snap = await getDoc(quotaRef(uid));
    if (!snap.exists()) {
      return { usedBytes: 0, limitBytes: USER_STORAGE_LIMIT_BYTES, updatedAt: 0 };
    }
    const d = snap.data() as Record<string, unknown>;
    return {
      usedBytes: Math.max(0, Number(d.used_bytes) || 0),
      limitBytes: USER_STORAGE_LIMIT_BYTES,
      updatedAt: Number(d.updated_at) || 0,
    };
  } catch {
    return { usedBytes: 0, limitBytes: USER_STORAGE_LIMIT_BYTES, updatedAt: 0 };
  }
}

export function listenStorageQuota(
  uid: string,
  cb: (q: StorageQuota) => void
): Unsubscribe {
  return onSnapshot(
    quotaRef(uid),
    (snap) => {
      if (!snap.exists()) {
        cb({ usedBytes: 0, limitBytes: USER_STORAGE_LIMIT_BYTES, updatedAt: 0 });
        return;
      }
      const d = snap.data() as Record<string, unknown>;
      cb({
        usedBytes: Math.max(0, Number(d.used_bytes) || 0),
        limitBytes: USER_STORAGE_LIMIT_BYTES,
        updatedAt: Number(d.updated_at) || 0,
      });
    },
    () => cb({ usedBytes: 0, limitBytes: USER_STORAGE_LIMIT_BYTES, updatedAt: 0 })
  );
}

export async function assertCanUpload(uid: string, addBytes: number): Promise<void> {
  const q = await getStorageQuota(uid);
  const next = q.usedBytes + Math.max(0, addBytes);
  if (next > q.limitBytes) {
    const left = Math.max(0, q.limitBytes - q.usedBytes);
    throw new Error(
      `已達儲存上限（${formatBytes(q.limitBytes)}）。目前已用 ${formatBytes(q.usedBytes)}，剩餘約 ${formatBytes(left)}。請刪除部分檔案後再試。`
    );
  }
}

/** Increment usage after a successful upload. Best-effort; never blocks callers hard. */
export async function addStorageUsage(uid: string, addBytes: number): Promise<void> {
  const delta = Math.max(0, Math.floor(addBytes));
  if (!uid || !delta) return;
  try {
    const cur = await getStorageQuota(uid);
    await setDoc(
      quotaRef(uid),
      {
        used_bytes: cur.usedBytes + delta,
        updated_at: Date.now(),
      },
      { merge: true }
    );
  } catch (e) {
    console.warn("[storageQuota] add failed", e);
  }
}

/** Best-effort decrement when files are deleted. */
export async function releaseStorageUsage(uid: string, removeBytes: number): Promise<void> {
  const delta = Math.max(0, Math.floor(removeBytes));
  if (!uid || !delta) return;
  try {
    const cur = await getStorageQuota(uid);
    await setDoc(
      quotaRef(uid),
      {
        used_bytes: Math.max(0, cur.usedBytes - delta),
        updated_at: Date.now(),
      },
      { merge: true }
    );
  } catch (e) {
    console.warn("[storageQuota] release failed", e);
  }
}

/** Parse `uploads/{uid}/…` paths used across the app. */
export function uidFromUploadPath(path: string): string | null {
  const m = /^uploads\/([^/]+)\//.exec(path || "");
  return m?.[1] || null;
}
