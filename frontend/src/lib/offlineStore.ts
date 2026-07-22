/** IndexedDB outbox for offline edits (notes / canvas / board). */

export type OfflineKind = "note" | "canvas" | "board";

export type PendingWrite = {
  key: string;
  kind: OfflineKind;
  docId: string;
  /** Required for canvas / board paths under users/{uid}/… */
  uid?: string;
  /** Remote `updated_at` ms when the local draft was based on cloud */
  baseUpdatedAt: number;
  localUpdatedAt: number;
  /** Short title for conflict UI */
  label: string;
  /** Local content summary for conflict preview */
  previewLocal: string;
  /** Fields to write (note patch, or full canvas payload, or board patch) */
  payload: Record<string, unknown>;
};

const DB_NAME = "albireus_offline";
const DB_VERSION = 1;
const STORE = "pending";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
  });
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB request failed"));
  });
}

export function pendingKey(kind: OfflineKind, docId: string, uid?: string): string {
  if (kind === "note") return `note:${docId}`;
  return `${kind}:${uid || "_"}:${docId}`;
}

export async function putPending(entry: PendingWrite): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    await reqToPromise(tx.objectStore(STORE).put(entry));
  } finally {
    db.close();
  }
}

export async function getPending(key: string): Promise<PendingWrite | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const row = await reqToPromise(tx.objectStore(STORE).get(key));
    return (row as PendingWrite) || null;
  } finally {
    db.close();
  }
}

export async function deletePending(key: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    await reqToPromise(tx.objectStore(STORE).delete(key));
  } finally {
    db.close();
  }
}

export async function listPending(): Promise<PendingWrite[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const rows = await reqToPromise(tx.objectStore(STORE).getAll());
    return (rows as PendingWrite[]) || [];
  } finally {
    db.close();
  }
}

export async function countPending(): Promise<number> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    return await reqToPromise(tx.objectStore(STORE).count());
  } finally {
    db.close();
  }
}
