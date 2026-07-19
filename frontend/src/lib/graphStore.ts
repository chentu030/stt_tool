/** Multi-graph configs under users/{uid}/graphs/{id} */

import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  DEFAULT_FILTERS,
  type GraphFilters,
  type LayoutMode,
} from "@/lib/graphModel";

export type GraphConfig = {
  id: string;
  name: string;
  filters: GraphFilters;
  layout: LayoutMode;
  positions: Record<string, { x: number; y: number }>;
  created_at: Date;
  updated_at: Date;
};

function graphsCol(uid: string) {
  return collection(db, "users", uid, "graphs");
}

function parseFilters(raw: unknown): GraphFilters {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_FILTERS };
  return { ...DEFAULT_FILTERS, ...(raw as GraphFilters) };
}

export function listenGraphs(uid: string, cb: (list: GraphConfig[]) => void): Unsubscribe {
  return onSnapshot(graphsCol(uid), (snap) => {
    const list = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: (data.name as string) || "未命名圖譜",
        filters: parseFilters(data.filters),
        layout: (data.layout as LayoutMode) || "force",
        positions: (data.positions as Record<string, { x: number; y: number }>) || {},
        created_at: data.created_at?.toDate?.() || new Date(),
        updated_at: data.updated_at?.toDate?.() || new Date(),
      } satisfies GraphConfig;
    });
    list.sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime());
    cb(list);
  });
}

export function listenGraph(
  uid: string,
  id: string,
  cb: (g: GraphConfig | null) => void
): Unsubscribe {
  return onSnapshot(doc(db, "users", uid, "graphs", id), (snap) => {
    if (!snap.exists()) {
      cb(null);
      return;
    }
    const data = snap.data();
    cb({
      id: snap.id,
      name: (data.name as string) || "未命名圖譜",
      filters: parseFilters(data.filters),
      layout: (data.layout as LayoutMode) || "force",
      positions: (data.positions as Record<string, { x: number; y: number }>) || {},
      created_at: data.created_at?.toDate?.() || new Date(),
      updated_at: data.updated_at?.toDate?.() || new Date(),
    });
  });
}

export async function createGraph(uid: string, name = "新圖譜"): Promise<string> {
  const ref = doc(graphsCol(uid));
  const now = Timestamp.now();
  await setDoc(ref, {
    name,
    filters: { ...DEFAULT_FILTERS },
    layout: "force",
    positions: {},
    created_at: now,
    updated_at: now,
  });
  return ref.id;
}

export async function updateGraph(
  uid: string,
  id: string,
  patch: Partial<Pick<GraphConfig, "name" | "filters" | "layout" | "positions">>
) {
  await updateDoc(doc(db, "users", uid, "graphs", id), {
    ...patch,
    updated_at: Timestamp.now(),
  });
}

export async function deleteGraph(uid: string, id: string) {
  await deleteDoc(doc(db, "users", uid, "graphs", id));
}

export async function ensureDefaultGraph(uid: string): Promise<string> {
  const existing = await getDocs(graphsCol(uid));
  if (!existing.empty) {
    const last =
      typeof window !== "undefined" ? localStorage.getItem(lastGraphKey(uid)) : null;
    const pick =
      (last && existing.docs.some((d) => d.id === last) && last) || existing.docs[0].id;
    if (typeof window !== "undefined") {
      localStorage.setItem(`cadence_graph_seeded_v1_${uid}`, "1");
      localStorage.setItem(lastGraphKey(uid), pick);
    }
    return pick;
  }
  const id = await createGraph(uid, "主圖譜");
  if (typeof window !== "undefined") {
    localStorage.setItem(`cadence_graph_seeded_v1_${uid}`, "1");
    localStorage.setItem(lastGraphKey(uid), id);
  }
  return id;
}

export function lastGraphKey(uid: string) {
  return `cadence_last_graph_${uid}`;
}
