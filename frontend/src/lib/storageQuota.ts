/** Per-user Cloud Storage quota (client-enforced counter). */

import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import {
  deleteObject,
  getMetadata,
  listAll,
  ref,
  type StorageReference,
} from "firebase/storage";
import { db, storage } from "@/lib/firebase";

/** Soft cap per account during beta. */
export const USER_STORAGE_LIMIT_BYTES = 500 * 1024 * 1024; // 500 MB

export type StorageQuota = {
  usedBytes: number;
  limitBytes: number;
  updatedAt: number;
};

export type UserStorageFile = {
  path: string;
  name: string;
  size: number;
  updated: number | null;
  category: string;
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

function categoryForUploadPath(path: string, uid: string): string {
  const rest = path.replace(`uploads/${uid}/`, "");
  const top = rest.split("/")[0] || "";
  if (top === "notes") return "筆記附件";
  if (top === "canvases") return "白板";
  if (top === "community") return "社群擴充";
  if (top === "profile") return "個人資料";
  return "語音任務";
}

async function collectStorageItems(folder: StorageReference): Promise<StorageReference[]> {
  const out: StorageReference[] = [];
  const res = await listAll(folder);
  out.push(...res.items);
  for (const prefix of res.prefixes) {
    out.push(...(await collectStorageItems(prefix)));
  }
  return out;
}

/** List every object under `uploads/{uid}/` with size metadata. */
export async function listUserUploadFiles(uid: string): Promise<UserStorageFile[]> {
  if (!uid) return [];
  let items: StorageReference[] = [];
  try {
    items = await collectStorageItems(ref(storage, `uploads/${uid}`));
  } catch {
    return [];
  }
  const files = await Promise.all(
    items.map(async (item) => {
      try {
        const meta = await getMetadata(item);
        return {
          path: item.fullPath,
          name: item.name,
          size: Math.max(0, Number(meta.size) || 0),
          updated: meta.updated ? Date.parse(meta.updated) : null,
          category: categoryForUploadPath(item.fullPath, uid),
        } satisfies UserStorageFile;
      } catch {
        return {
          path: item.fullPath,
          name: item.name,
          size: 0,
          updated: null,
          category: categoryForUploadPath(item.fullPath, uid),
        } satisfies UserStorageFile;
      }
    })
  );
  files.sort((a, b) => b.size - a.size || a.name.localeCompare(b.name, "zh-Hant"));
  return files;
}

/** Align the Firestore counter with the actual listed total. */
export async function syncStorageQuotaFromFiles(
  uid: string,
  files: Pick<UserStorageFile, "size">[]
): Promise<number> {
  const used = files.reduce((sum, f) => sum + Math.max(0, Number(f.size) || 0), 0);
  if (!uid) return used;
  try {
    await setDoc(
      quotaRef(uid),
      { used_bytes: used, updated_at: Date.now() },
      { merge: true }
    );
  } catch (e) {
    console.warn("[storageQuota] sync failed", e);
  }
  return used;
}

/** Delete one object owned by the user and release quota. */
export async function deleteUserUploadFile(
  uid: string,
  path: string,
  sizeHint?: number
): Promise<number> {
  if (!uid || !path.startsWith(`uploads/${uid}/`)) {
    throw new Error("無權限刪除此檔案");
  }
  const storageRef = ref(storage, path);
  let size = Math.max(0, Math.floor(sizeHint || 0));
  if (!size) {
    try {
      const meta = await getMetadata(storageRef);
      size = Math.max(0, Number(meta.size) || 0);
    } catch {
      /* missing metadata — still try delete */
    }
  }
  await deleteObject(storageRef);
  await releaseStorageUsage(uid, size);
  return size;
}
