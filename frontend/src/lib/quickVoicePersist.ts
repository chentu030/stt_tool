/**
 * IndexedDB persistence for quick-voice drafts (mid-record) and STT jobs (post-stop).
 * Survives tab refresh / soft kills better than in-memory-only queues.
 */

const DB_NAME = "cadence-quick-voice-v1";
const DB_VERSION = 1;
const STORE_DRAFTS = "drafts";
const STORE_JOBS = "jobs";

export type PersistedQuickVoiceJob = {
  id: string;
  uid: string;
  blob: Blob;
  ext: string;
  language: string;
  createdAt: number;
};

export type PersistedQuickVoiceDraft = {
  id: string;
  uid: string;
  ext: string;
  mimeType: string;
  chunks: Blob[];
  updatedAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("no indexedDB"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error || new Error("idb open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DRAFTS)) {
        db.createObjectStore(STORE_DRAFTS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_JOBS)) {
        db.createObjectStore(STORE_JOBS, { keyPath: "id" });
      }
    };
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("idb request failed"));
  });
}

export async function saveQuickVoiceDraft(draft: PersistedQuickVoiceDraft): Promise<void> {
  try {
    const db = await openDb();
    await idbReq(db.transaction(STORE_DRAFTS, "readwrite").objectStore(STORE_DRAFTS).put(draft));
    db.close();
  } catch {
    /* best-effort */
  }
}

export async function clearQuickVoiceDraft(id: string): Promise<void> {
  try {
    const db = await openDb();
    await idbReq(db.transaction(STORE_DRAFTS, "readwrite").objectStore(STORE_DRAFTS).delete(id));
    db.close();
  } catch {
    /* ignore */
  }
}

export async function listQuickVoiceDrafts(): Promise<PersistedQuickVoiceDraft[]> {
  try {
    const db = await openDb();
    const rows = await idbReq(
      db.transaction(STORE_DRAFTS, "readonly").objectStore(STORE_DRAFTS).getAll()
    );
    db.close();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export async function saveQuickVoiceJob(job: PersistedQuickVoiceJob): Promise<void> {
  try {
    const db = await openDb();
    await idbReq(db.transaction(STORE_JOBS, "readwrite").objectStore(STORE_JOBS).put(job));
    db.close();
  } catch {
    /* best-effort */
  }
}

export async function deleteQuickVoiceJob(id: string): Promise<void> {
  try {
    const db = await openDb();
    await idbReq(db.transaction(STORE_JOBS, "readwrite").objectStore(STORE_JOBS).delete(id));
    db.close();
  } catch {
    /* ignore */
  }
}

export async function listQuickVoiceJobs(): Promise<PersistedQuickVoiceJob[]> {
  try {
    const db = await openDb();
    const rows = await idbReq(
      db.transaction(STORE_JOBS, "readonly").objectStore(STORE_JOBS).getAll()
    );
    db.close();
    return (Array.isArray(rows) ? rows : []).sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

export function newQuickVoiceId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
