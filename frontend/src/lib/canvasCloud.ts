/** Multi-canvas docs under users/{uid}/canvases/{id} */

import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  onSnapshot,
  Timestamp,
  deleteField,
  type Unsubscribe,
} from "firebase/firestore";
import { db, loadCanvasCloud } from "@/lib/firebase";
import {
  emptyDoc,
  loadDoc,
  saveDoc,
  type CanvasDoc,
} from "@/lib/canvasStore";

export type CanvasMeta = {
  id: string;
  name: string;
  updated_at: Date;
  created_at: Date;
  stickies: number;
  shapes: number;
  edges: number;
  pins: number;
  media: number;
  /** Sample sticky colors for mini-preview */
  stickyColors: string[];
  /** Flattened sticky / shape / media text for ⌘K unified search */
  searchText?: string;
  /** Soft-delete timestamp when in trash */
  trashed_at?: Date | null;
};

function canvasesCol(uid: string) {
  return collection(db, "users", uid, "canvases");
}

function docFromData(id: string, data: Record<string, unknown>): CanvasDoc & { id: string; updated_at?: Date } {
  const base = emptyDoc((data.name as string) || "白板");
  const updated = data.updated_at as { toDate?: () => Date } | Date | undefined;
  return {
    ...base,
    ...data,
    id,
    version: 2,
    name: (data.name as string) || base.name,
    pan: (data.pan as CanvasDoc["pan"]) || base.pan,
    scale: typeof data.scale === "number" ? data.scale : base.scale,
    stickies: Array.isArray(data.stickies) ? (data.stickies as CanvasDoc["stickies"]) : [],
    shapes: Array.isArray(data.shapes) ? (data.shapes as CanvasDoc["shapes"]) : [],
    edges: Array.isArray(data.edges) ? (data.edges as CanvasDoc["edges"]) : [],
    notes: Array.isArray(data.notes) ? (data.notes as CanvasDoc["notes"]) : [],
    media: Array.isArray(data.media) ? (data.media as CanvasDoc["media"]) : [],
    sections: Array.isArray(data.sections) ? (data.sections as CanvasDoc["sections"]) : [],
    grid: data.grid !== false,
    snap: data.snap !== false,
    updated_at:
      updated && typeof updated === "object" && "toDate" in updated && updated.toDate
        ? updated.toDate()
        : updated instanceof Date
          ? updated
          : undefined,
  };
}

export function listenCanvases(
  uid: string,
  cb: (list: CanvasMeta[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  return onSnapshot(
    canvasesCol(uid),
    (snap) => {
      const list = snap.docs.map((d) => {
        const data = d.data();
        const stickies = Array.isArray(data.stickies) ? data.stickies : [];
        const shapes = Array.isArray(data.shapes) ? data.shapes : [];
        const edges = Array.isArray(data.edges) ? data.edges : [];
        const pins = Array.isArray(data.notes) ? data.notes : [];
        const media = Array.isArray(data.media) ? data.media : [];
        const stickyColors = stickies
          .slice(0, 8)
          .map((s) => {
            if (s && typeof s === "object" && "color" in s) return String((s as { color?: string }).color || "");
            return "";
          })
          .filter(Boolean);
        const searchParts: string[] = [];
        for (const s of stickies) {
          if (s && typeof s === "object" && "text" in s) {
            const t = String((s as { text?: string }).text || "").trim();
            if (t) searchParts.push(t.slice(0, 400));
          }
        }
        for (const s of shapes) {
          if (s && typeof s === "object" && "label" in s) {
            const t = String((s as { label?: string }).label || "").trim();
            if (t) searchParts.push(t.slice(0, 200));
          }
        }
        for (const m of media) {
          if (!m || typeof m !== "object") continue;
          const rec = m as {
            title?: string;
            transcript?: string;
            extractedText?: string;
            description?: string;
          };
          for (const key of ["title", "description", "transcript", "extractedText"] as const) {
            const t = String(rec[key] || "").trim();
            if (t) searchParts.push(t.slice(0, key === "title" ? 200 : 800));
          }
        }
        const trashedRaw = data.trashed_at as { toDate?: () => Date } | Date | null | undefined;
        const trashed_at =
          trashedRaw == null
            ? null
            : trashedRaw && typeof trashedRaw === "object" && "toDate" in trashedRaw && trashedRaw.toDate
              ? trashedRaw.toDate()
              : trashedRaw instanceof Date
                ? trashedRaw
                : null;
        return {
          id: d.id,
          name: (data.name as string) || "未命名白板",
          created_at: data.created_at?.toDate?.() || new Date(),
          updated_at: data.updated_at?.toDate?.() || new Date(),
          stickies: stickies.length,
          shapes: shapes.length,
          edges: edges.length,
          pins: pins.length,
          media: media.length,
          stickyColors,
          searchText: searchParts.join("\n").slice(0, 12000),
          trashed_at,
        } satisfies CanvasMeta;
      }).filter((c) => !c.trashed_at);
      list.sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime());
      cb(list);
    },
    (err) => onError?.(err)
  );
}

/** Soft-deleted canvases (垃圾桶). */
export function listenTrashedCanvases(
  uid: string,
  cb: (list: CanvasMeta[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  return onSnapshot(
    canvasesCol(uid),
    (snap) => {
      const list = snap.docs
        .map((d) => {
          const data = d.data();
          const trashedRaw = data.trashed_at as { toDate?: () => Date } | Date | null | undefined;
          const trashed_at =
            trashedRaw == null
              ? null
              : trashedRaw && typeof trashedRaw === "object" && "toDate" in trashedRaw && trashedRaw.toDate
                ? trashedRaw.toDate()
                : trashedRaw instanceof Date
                  ? trashedRaw
                  : null;
          if (!trashed_at) return null;
          return {
            id: d.id,
            name: (data.name as string) || "未命名白板",
            created_at: data.created_at?.toDate?.() || new Date(),
            updated_at: data.updated_at?.toDate?.() || new Date(),
            stickies: Array.isArray(data.stickies) ? data.stickies.length : 0,
            shapes: Array.isArray(data.shapes) ? data.shapes.length : 0,
            edges: Array.isArray(data.edges) ? data.edges.length : 0,
            pins: Array.isArray(data.notes) ? data.notes.length : 0,
            media: Array.isArray(data.media) ? data.media.length : 0,
            stickyColors: [],
            trashed_at,
          } satisfies CanvasMeta;
        })
        .filter(Boolean) as CanvasMeta[];
      list.sort((a, b) => (b.trashed_at?.getTime() || 0) - (a.trashed_at?.getTime() || 0));
      cb(list);
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err)))
  );
}

export function listenCanvas(
  uid: string,
  id: string,
  cb: (doc: CanvasDoc | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, "users", uid, "canvases", id),
    (snap) => {
      if (!snap.exists()) {
        cb(null);
        return;
      }
      cb(docFromData(snap.id, snap.data() as Record<string, unknown>));
    },
    (err) => onError?.(err)
  );
}

export async function createCanvas(uid: string, name = "新白板"): Promise<string> {
  const ref = doc(canvasesCol(uid));
  const blank = emptyDoc(name);
  const now = Timestamp.now();
  await setDoc(ref, {
    ...blank,
    created_at: now,
    updated_at: now,
  });
  return ref.id;
}

export async function saveCanvas(uid: string, id: string, data: CanvasDoc) {
  await setDoc(
    doc(db, "users", uid, "canvases", id),
    {
      ...data,
      version: 2,
      updated_at: Timestamp.now(),
    },
    { merge: true }
  );
  try {
    saveDoc(uid, { ...data, name: data.name });
  } catch {
    /* local cache optional */
  }
  void maybePushCanvasVersion(uid, id, data).catch(() => {});
}

export async function renameCanvas(uid: string, id: string, name: string) {
  await updateDoc(doc(db, "users", uid, "canvases", id), {
    name,
    updated_at: Timestamp.now(),
  });
}

/** Soft-delete canvas into trash. */
export async function trashCanvas(uid: string, id: string) {
  await updateDoc(doc(db, "users", uid, "canvases", id), {
    trashed_at: Timestamp.now(),
    updated_at: Timestamp.now(),
  });
}

export async function restoreCanvas(uid: string, id: string) {
  await updateDoc(doc(db, "users", uid, "canvases", id), {
    trashed_at: deleteField(),
    updated_at: Timestamp.now(),
  });
}

/** Permanently delete canvas (+ version snapshots). */
export async function purgeCanvas(uid: string, id: string) {
  try {
    const vers = await getDocs(collection(db, "users", uid, "canvases", id, "versions"));
    await Promise.all(vers.docs.map((d) => deleteDoc(d.ref)));
  } catch {
    /* ignore */
  }
  await deleteDoc(doc(db, "users", uid, "canvases", id));
}

/** Soft-delete by default. Use purgeCanvas for permanent. */
export async function deleteCanvas(uid: string, id: string) {
  await trashCanvas(uid, id);
}

const CANVAS_VERSION_KEEP = 20;
const CANVAS_VERSION_MIN_INTERVAL_MS = 5 * 60 * 1000;
const canvasVersionCache = new Map<string, { at: number; sig: string }>();

function canvasSnapshotSig(data: CanvasDoc): string {
  return [
    data.name || "",
    data.stickies?.length || 0,
    data.shapes?.length || 0,
    data.edges?.length || 0,
    data.notes?.length || 0,
    data.media?.length || 0,
    data.sections?.length || 0,
    JSON.stringify(data.stickies || []).length,
    JSON.stringify(data.shapes || []).length,
  ].join("|");
}

export type CanvasVersion = {
  id: string;
  name: string;
  summary: string;
  created_at: Date;
  doc: CanvasDoc;
};

/** Sparse full snapshots of a whiteboard for restore. */
export async function maybePushCanvasVersion(
  uid: string,
  canvasId: string,
  data: CanvasDoc,
  opts?: { force?: boolean }
): Promise<{ written: boolean }> {
  const force = !!opts?.force;
  const cacheKey = `${uid}:${canvasId}`;
  const sig = canvasSnapshotSig(data);
  const prev = canvasVersionCache.get(cacheKey);
  const now = Date.now();
  if (!force && prev) {
    if (prev.sig === sig) return { written: false };
    if (now - prev.at < CANVAS_VERSION_MIN_INTERVAL_MS) return { written: false };
  }

  const id = `v_${now}`;
  const stickyN = data.stickies?.length || 0;
  const shapeN = data.shapes?.length || 0;
  const summary = `${stickyN} 便利貼 · ${shapeN} 圖形`;
  const payload = {
    name: data.name || "白板",
    summary,
    created_at: Timestamp.now(),
    snap: {
      name: data.name,
      pan: data.pan,
      scale: data.scale,
      stickies: data.stickies || [],
      shapes: data.shapes || [],
      edges: data.edges || [],
      notes: data.notes || [],
      media: data.media || [],
      sections: data.sections || [],
      grid: data.grid !== false,
      snap: data.snap !== false,
      version: 2,
    },
  };
  await setDoc(doc(db, "users", uid, "canvases", canvasId, "versions", id), payload);
  canvasVersionCache.set(cacheKey, { at: now, sig });

  try {
    const res = await getDocs(collection(db, "users", uid, "canvases", canvasId, "versions"));
    if (res.size > CANVAS_VERSION_KEEP) {
      const sorted = res.docs
        .map((d) => ({
          id: d.id,
          at: (d.data().created_at as { toMillis?: () => number })?.toMillis?.() || 0,
        }))
        .sort((a, b) => a.at - b.at);
      const drop = sorted.slice(0, sorted.length - CANVAS_VERSION_KEEP);
      await Promise.all(
        drop.map((v) =>
          deleteDoc(doc(db, "users", uid, "canvases", canvasId, "versions", v.id))
        )
      );
    }
  } catch {
    /* prune best-effort */
  }
  return { written: true };
}

export async function listCanvasVersions(
  uid: string,
  canvasId: string
): Promise<CanvasVersion[]> {
  const res = await getDocs(collection(db, "users", uid, "canvases", canvasId, "versions"));
  const list = res.docs.map((d) => {
    const data = d.data();
    const snap = (data.snap || {}) as Partial<CanvasDoc>;
    const created = data.created_at as { toDate?: () => Date } | undefined;
    return {
      id: d.id,
      name: String(data.name || snap.name || "白板"),
      summary: String(data.summary || "快照"),
      created_at: created?.toDate?.() || new Date(),
      doc: docFromData(canvasId, { ...snap, name: snap.name || data.name }) as CanvasDoc,
    } satisfies CanvasVersion;
  });
  list.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  return list;
}

export async function restoreCanvasVersion(
  uid: string,
  canvasId: string,
  versionId: string
): Promise<CanvasDoc> {
  const snap = await getDoc(
    doc(db, "users", uid, "canvases", canvasId, "versions", versionId)
  );
  if (!snap.exists()) throw new Error("找不到此快照");
  const data = snap.data();
  const payload = (data.snap || {}) as Partial<CanvasDoc>;
  const restored = docFromData(canvasId, {
    ...payload,
    name: payload.name || data.name,
  }) as CanvasDoc;
  await saveCanvas(uid, canvasId, restored);
  return restored;
}

/** Migrate legacy single canvas (workspace/canvas + localStorage) into canvases collection. */
export async function ensureCanvasesMigrated(uid: string): Promise<string | null> {
  const flagKey = `cadence_canvas_migrated_v1_${uid}`;
  const lastKey = lastCanvasKey(uid);

  const existing = await getDocs(canvasesCol(uid));
  if (!existing.empty) {
    const last = typeof window !== "undefined" ? localStorage.getItem(lastKey) : null;
    const pick =
      (last && existing.docs.some((d) => d.id === last) && last) || existing.docs[0].id;
    if (typeof window !== "undefined") {
      localStorage.setItem(flagKey, "1");
      localStorage.setItem(lastKey, pick);
    }
    return pick;
  }

  let seed = emptyDoc("主白板");
  try {
    const local = loadDoc(uid);
    if (local.stickies.length || local.shapes.length || local.notes.length || local.edges.length) {
      seed = local;
    }
  } catch {
    /* ignore */
  }
  try {
    const cloud = await loadCanvasCloud(uid);
    if (cloud) {
      const merged = docFromData("legacy", cloud as Record<string, unknown>);
      const { id: _drop, ...rest } = merged as CanvasDoc & { id?: string };
      seed = rest;
    }
  } catch {
    /* ignore */
  }

  const id = await createCanvas(uid, seed.name || "主白板");
  await saveCanvas(uid, id, { ...seed, name: seed.name || "主白板" });
  if (typeof window !== "undefined") {
    localStorage.setItem(flagKey, "1");
    localStorage.setItem(lastKey, id);
  }
  return id;
}

export async function getCanvasOnce(uid: string, id: string): Promise<CanvasDoc | null> {
  const snap = await getDoc(doc(db, "users", uid, "canvases", id));
  if (!snap.exists()) return null;
  return docFromData(snap.id, snap.data() as Record<string, unknown>);
}

export function lastCanvasKey(uid: string) {
  return `cadence_last_canvas_${uid}`;
}
