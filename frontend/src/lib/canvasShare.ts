/** Whiteboard public share links (view / copy only — no live co-edit yet). */

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { emptyDoc, type CanvasDoc } from "@/lib/canvasStore";
import { saveCanvas, createCanvas } from "@/lib/canvasCloud";
import { shareUrl } from "@/lib/share";

export type CanvasShareMode = "view" | "copy";

export type CanvasShare = {
  enabled: boolean;
  token: string;
  mode: CanvasShareMode;
};

export type CanvasShareTokenDoc = {
  kind: "canvas";
  canvas_id: string;
  owner_id: string;
  mode: CanvasShareMode;
  enabled: boolean;
  name: string;
  /** Serialized canvas snapshot for public viewers */
  canvas_json: string;
  created_at: Date;
};

function randomToken(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function parseCanvasShare(raw: unknown): CanvasShare | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (!s.enabled || typeof s.token !== "string" || !s.token) return null;
  const mode = s.mode === "copy" ? "copy" : "view";
  return { enabled: true, token: s.token, mode };
}

function canvasRef(uid: string, canvasId: string) {
  return doc(db, "users", uid, "canvases", canvasId);
}

function snapshotJson(data: CanvasDoc): string {
  return JSON.stringify({
    version: 2,
    name: data.name,
    pan: { x: 0, y: 0 },
    scale: 1,
    stickies: data.stickies || [],
    shapes: data.shapes || [],
    edges: data.edges || [],
    notes: data.notes || [],
    media: data.media || [],
    sections: data.sections || [],
    grid: data.grid !== false,
    snap: data.snap !== false,
  });
}

export async function enableCanvasShare(
  uid: string,
  canvasId: string,
  mode: CanvasShareMode,
  existingToken?: string,
  docData?: CanvasDoc | null
): Promise<CanvasShare> {
  const ref = canvasRef(uid, canvasId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("找不到白板");
  const data = (docData || (snap.data() as unknown as CanvasDoc)) as CanvasDoc;
  const token = existingToken || randomToken();
  const share: CanvasShare = { enabled: true, token, mode };
  await setDoc(
    doc(db, "share_tokens", token),
    {
      kind: "canvas",
      canvas_id: canvasId,
      owner_id: uid,
      mode,
      enabled: true,
      name: data.name || "未命名白板",
      canvas_json: snapshotJson(data),
      created_at: Timestamp.now(),
      updated_at: Timestamp.now(),
    },
    { merge: true }
  );
  await updateDoc(ref, { share });
  return share;
}

export async function setCanvasShareMode(
  uid: string,
  canvasId: string,
  mode: CanvasShareMode,
  token: string,
  docData?: CanvasDoc | null
): Promise<CanvasShare> {
  return enableCanvasShare(uid, canvasId, mode, token, docData);
}

export async function disableCanvasShare(
  uid: string,
  canvasId: string,
  token?: string
): Promise<void> {
  const ref = canvasRef(uid, canvasId);
  if (token) {
    try {
      await deleteDoc(doc(db, "share_tokens", token));
    } catch {
      /* ignore */
    }
  }
  await updateDoc(ref, {
    share: { enabled: false, token: "", mode: "view" },
  });
}

export async function syncCanvasShareSnapshot(
  uid: string,
  canvasId: string,
  data: CanvasDoc,
  share?: CanvasShare | null
): Promise<void> {
  const s = share || parseCanvasShare((data as unknown as { share?: unknown }).share);
  if (!s?.enabled || !s.token) return;
  await setDoc(
    doc(db, "share_tokens", s.token),
    {
      kind: "canvas",
      canvas_id: canvasId,
      owner_id: uid,
      mode: s.mode,
      enabled: true,
      name: data.name || "未命名白板",
      canvas_json: snapshotJson(data),
      updated_at: Timestamp.now(),
    },
    { merge: true }
  );
}

function mapCanvasShareTokenData(data: Record<string, unknown>): CanvasShareTokenDoc | null {
  if (data.kind !== "canvas") return null;
  if (data.enabled === false) return null;
  return {
    kind: "canvas",
    canvas_id: String(data.canvas_id || ""),
    owner_id: String(data.owner_id || ""),
    mode: data.mode === "copy" ? "copy" : "view",
    enabled: true,
    name: String(data.name || "未命名白板"),
    canvas_json: String(data.canvas_json || ""),
    created_at: (data.created_at as { toDate?: () => Date })?.toDate?.() || new Date(),
  };
}

export async function resolveCanvasShareToken(
  token: string
): Promise<CanvasShareTokenDoc | null> {
  const snap = await getDoc(doc(db, "share_tokens", token));
  if (!snap.exists()) return null;
  return mapCanvasShareTokenData((snap.data() || {}) as Record<string, unknown>);
}

export function listenCanvasShareToken(
  token: string,
  callback: (link: CanvasShareTokenDoc | null) => void
): Unsubscribe {
  return onSnapshot(doc(db, "share_tokens", token), (snap) => {
    if (!snap.exists()) {
      callback(null);
      return;
    }
    callback(mapCanvasShareTokenData((snap.data() || {}) as Record<string, unknown>));
  });
}

export function canvasDocFromShareToken(link: CanvasShareTokenDoc): CanvasDoc {
  try {
    const parsed = JSON.parse(link.canvas_json || "{}") as CanvasDoc;
    const base = emptyDoc(link.name);
    return {
      ...base,
      ...parsed,
      version: 2,
      name: parsed.name || link.name || base.name,
      stickies: Array.isArray(parsed.stickies) ? parsed.stickies : [],
      shapes: Array.isArray(parsed.shapes) ? parsed.shapes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      media: Array.isArray(parsed.media) ? parsed.media : [],
      sections: Array.isArray(parsed.sections) ? parsed.sections : [],
      grid: parsed.grid !== false,
      snap: parsed.snap !== false,
      pan: parsed.pan || { x: 0, y: 0 },
      scale: typeof parsed.scale === "number" ? parsed.scale : 1,
    };
  } catch {
    return emptyDoc(link.name);
  }
}

export async function copySharedCanvasToUser(
  uid: string,
  link: CanvasShareTokenDoc
): Promise<string> {
  const src = canvasDocFromShareToken(link);
  const id = await createCanvas(uid, `${src.name || "白板"}（副本）`);
  await saveCanvas(uid, id, {
    ...src,
    name: `${src.name || "白板"}（副本）`,
  });
  return id;
}

export { shareUrl };
