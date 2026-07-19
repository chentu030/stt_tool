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
};

function canvasesCol(uid: string) {
  return collection(db, "users", uid, "canvases");
}

function docFromData(id: string, data: Record<string, unknown>): CanvasDoc & { id: string } {
  const base = emptyDoc((data.name as string) || "白板");
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
    grid: data.grid !== false,
    snap: data.snap !== false,
  };
}

export function listenCanvases(uid: string, cb: (list: CanvasMeta[]) => void): Unsubscribe {
  return onSnapshot(canvasesCol(uid), (snap) => {
    const list = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: (data.name as string) || "未命名白板",
        created_at: data.created_at?.toDate?.() || new Date(),
        updated_at: data.updated_at?.toDate?.() || new Date(),
      };
    });
    list.sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime());
    cb(list);
  });
}

export function listenCanvas(
  uid: string,
  id: string,
  cb: (doc: CanvasDoc | null) => void
): Unsubscribe {
  return onSnapshot(doc(db, "users", uid, "canvases", id), (snap) => {
    if (!snap.exists()) {
      cb(null);
      return;
    }
    cb(docFromData(snap.id, snap.data() as Record<string, unknown>));
  });
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
}

export async function renameCanvas(uid: string, id: string, name: string) {
  await updateDoc(doc(db, "users", uid, "canvases", id), {
    name,
    updated_at: Timestamp.now(),
  });
}

export async function deleteCanvas(uid: string, id: string) {
  await deleteDoc(doc(db, "users", uid, "canvases", id));
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
