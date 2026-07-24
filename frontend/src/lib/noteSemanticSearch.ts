/**
 * Semantic note retrieval — Vertex embeddings + Firestore vectors.
 *
 * Primary: Cloud Run `findNearest` (Admin SDK) when NEXT_PUBLIC_API_BASE is up.
 * Fallback: Next.js `/api/ai/embeddings/embed` + client-side cosine over
 * `users/{uid}/note_embeddings` (works before Cloud Run redeploy; still uses
 * the same 768-d vectors / index-ready collection).
 *
 * Never stuffs unrelated notes below score threshold — empty means 無相關筆記.
 */

import {
  auth,
  db,
} from "@/lib/firebase";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
  vector,
} from "firebase/firestore";
import { aiFetch } from "@/lib/aiFetch";

const EMBED_DIM = 768;
const DEFAULT_THRESHOLD = 0.55; // cosine distance
const MAX_EMBED_CHARS = 6000;

const API = () => {
  const raw = (process.env.NEXT_PUBLIC_API_BASE || "").trim();
  if (raw) return raw.replace(/^http:\/\//i, "https://").replace(/\/$/, "");
  return "http://localhost:8000/api";
};

export type SemanticHit = {
  id: string;
  title?: string;
  folder?: string;
  tags?: string[];
  database_id?: string;
  distance: number;
  score: number;
};

export type NoteEmbedInput = {
  id: string;
  title?: string;
  body_md?: string;
  folder?: string;
  tags?: string[];
  database_id?: string;
};

function buildEmbedText(n: NoteEmbedInput): string {
  const parts = [`標題：${(n.title || "未命名").trim()}`];
  if (n.folder?.trim()) parts.push(`資料夾：${n.folder.trim()}`);
  const tags = (n.tags || []).filter(Boolean);
  if (tags.length) parts.push("標籤：" + tags.slice(0, 24).map((t) => `#${t}`).join(" "));
  const body = (n.body_md || "").replace(/\s+/g, " ").trim();
  if (body) parts.push(body.slice(0, MAX_EMBED_CHARS));
  return parts.join("\n").trim() || "（空白筆記）";
}

async function sha40(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 40);
}

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 1;
  const sim = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return Math.max(0, Math.min(2, 1 - sim));
}

async function embedViaNext(
  texts: string[],
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"
): Promise<number[][]> {
  const res = await aiFetch("/api/ai/embeddings/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts, taskType }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `embedding 失敗（${res.status}）`);
  }
  const embeddings = data.embeddings as number[][];
  if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
    throw new Error("embedding 回應筆數異常");
  }
  return embeddings;
}

async function authHeader(): Promise<HeadersInit> {
  const user = auth.currentUser;
  if (!user) throw new Error("請先登入");
  const token = await user.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

/** Upsert via Cloud Run Admin when available; else Next embed + client Firestore write. */
export async function upsertNoteEmbeddings(
  notes: NoteEmbedInput[],
  opts?: { force?: boolean }
): Promise<{ results: Array<{ id: string; skipped?: boolean }>; errors: Array<{ id: string; error: string }> }> {
  if (!notes.length) return { results: [], errors: [] };

  // Prefer Cloud Run (writes Vector via Admin + skips by content_hash).
  try {
    const headers = await authHeader();
    const res = await fetch(`${API()}/notes/embeddings/upsert`, {
      method: "POST",
      headers,
      body: JSON.stringify({ notes, force: !!opts?.force }),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return {
        results: data.results || [],
        errors: data.errors || [],
      };
    }
  } catch {
    /* fall through to client path */
  }

  const user = auth.currentUser;
  if (!user) throw new Error("請先登入");

  const results: Array<{ id: string; skipped?: boolean }> = [];
  const errors: Array<{ id: string; error: string }> = [];

  for (let i = 0; i < notes.length; i += 5) {
    const chunk = notes.slice(i, i + 5);
    const texts = chunk.map(buildEmbedText);
    try {
      const vectors = await embedViaNext(texts, "RETRIEVAL_DOCUMENT");
      for (let j = 0; j < chunk.length; j++) {
        const n = chunk[j];
        try {
          const ch = await sha40(`${(n.title || "").trim()}\n${(n.body_md || "").trim()}`);
          const ref = doc(db, "users", user.uid, "note_embeddings", n.id);
          await setDoc(
            ref,
            {
              note_id: n.id,
              user_id: user.uid,
              title: (n.title || "未命名").slice(0, 200),
              folder: (n.folder || "").slice(0, 200),
              tags: (n.tags || []).slice(0, 40),
              database_id: (n.database_id || "").slice(0, 120),
              content_hash: ch,
              model: "text-multilingual-embedding-002",
              dim: EMBED_DIM,
              embedding: vector(vectors[j]),
              updated_at: Date.now(),
            },
            { merge: true }
          );
          results.push({ id: n.id, skipped: false });
        } catch (e) {
          errors.push({ id: n.id, error: e instanceof Error ? e.message : String(e) });
        }
      }
    } catch (e) {
      for (const n of chunk) {
        errors.push({ id: n.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  return { results, errors };
}

function filterHitMeta(
  hit: SemanticHit & { tags?: string[]; folder?: string; database_id?: string },
  opts?: {
    folder?: string;
    database_id?: string;
    scopeIds?: string[];
    tags?: string[];
  }
): boolean {
  if (opts?.scopeIds?.length && !opts.scopeIds.includes(hit.id)) return false;
  if (opts?.database_id && (hit.database_id || "") !== opts.database_id) return false;
  if (opts?.folder) {
    const f = opts.folder.trim().replace(/\\/g, "/");
    const nf = (hit.folder || "").trim().replace(/\\/g, "/");
    if (nf !== f && !nf.startsWith(`${f}/`)) return false;
  }
  if (opts?.tags?.length) {
    const set = new Set(hit.tags || []);
    if (!opts.tags.some((t) => set.has(t))) return false;
  }
  return true;
}

async function searchLocalCosine(
  query: string,
  opts?: {
    limit?: number;
    threshold?: number;
    folder?: string;
    database_id?: string;
    scopeIds?: string[];
    tags?: string[];
  }
): Promise<SemanticHit[]> {
  const user = auth.currentUser;
  if (!user) throw new Error("請先登入");
  const limit = Math.max(1, Math.min(opts?.limit ?? 12, 40));
  const threshold = opts?.threshold ?? DEFAULT_THRESHOLD;

  const [qVec] = await embedViaNext([query.slice(0, MAX_EMBED_CHARS)], "RETRIEVAL_QUERY");
  const snap = await getDocs(collection(db, "users", user.uid, "note_embeddings"));
  const scored: SemanticHit[] = [];

  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    const embField = data.embedding as { toArray?: () => number[] } | number[] | undefined;
    let values: number[] | null = null;
    if (embField && typeof embField === "object" && "toArray" in embField && typeof embField.toArray === "function") {
      values = embField.toArray();
    } else if (Array.isArray(embField)) {
      values = embField.map(Number);
    }
    if (!values || values.length !== EMBED_DIM) continue;

    const hit: SemanticHit = {
      id: String(data.note_id || d.id),
      title: String(data.title || ""),
      folder: String(data.folder || ""),
      tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
      database_id: String(data.database_id || ""),
      distance: 0,
      score: 0,
    };
    if (!filterHitMeta(hit, opts)) continue;

    const distance = cosineDistance(qVec, values);
    if (distance > threshold) continue;
    hit.distance = Math.round(distance * 10000) / 10000;
    hit.score = Math.round(Math.max(0, 1 - distance / 2) * 10000) / 10000;
    scored.push(hit);
  }

  scored.sort((a, b) => a.distance - b.distance);
  return scored.slice(0, limit);
}

/** Semantic nearest-neighbor search. Empty hits = 無相關筆記. */
export async function searchNotesSemantic(
  query: string,
  opts?: {
    limit?: number;
    threshold?: number;
    folder?: string;
    database_id?: string;
    scopeIds?: string[];
    tags?: string[];
  }
): Promise<{ hits: SemanticHit[]; message: string | null }> {
  const q = query.trim();
  if (!q) return { hits: [], message: "無相關筆記" };

  // Prefer Cloud Run findNearest.
  try {
    const headers = await authHeader();
    const res = await fetch(`${API()}/notes/embeddings/search`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: q,
        limit: opts?.limit ?? 12,
        threshold: opts?.threshold,
        folder: opts?.folder,
        database_id: opts?.database_id,
        scopeIds: opts?.scopeIds,
        tags: opts?.tags,
      }),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const hits = Array.isArray(data.hits) ? (data.hits as SemanticHit[]) : [];
      return {
        hits,
        message: hits.length ? null : data.message || "無相關筆記",
      };
    }
  } catch {
    /* local fallback */
  }

  try {
    const hits = await searchLocalCosine(q, opts);
    return {
      hits,
      message: hits.length ? null : "無相關筆記",
    };
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
}

export async function deleteNoteEmbeddings(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const user = auth.currentUser;
  if (!user) return;

  try {
    const headers = await authHeader();
    await fetch(`${API()}/notes/embeddings/delete`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ids }),
    });
  } catch {
    /* client delete below */
  }

  await Promise.all(
    ids.map((id) =>
      deleteDoc(doc(db, "users", user.uid, "note_embeddings", id)).catch(() => undefined)
    )
  );
}

/** Debounced per-note reindex queue (title/body changes). */
const pending = new Map<string, NoteEmbedInput>();
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

export function scheduleNoteEmbedding(note: NoteEmbedInput) {
  if (!note?.id || typeof window === "undefined") return;
  if (!auth.currentUser) return;
  pending.set(note.id, {
    id: note.id,
    title: note.title || "",
    body_md: note.body_md || "",
    folder: note.folder || "",
    tags: note.tags || [],
    database_id: note.database_id || "",
  });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    void flushNoteEmbeddingQueue();
  }, 1800);
}

export async function flushNoteEmbeddingQueue(): Promise<void> {
  if (flushing || !pending.size) return;
  flushing = true;
  const batch = Array.from(pending.values()).slice(0, 20);
  for (const n of batch) pending.delete(n.id);
  try {
    await upsertNoteEmbeddings(batch);
  } catch {
    for (const n of batch) {
      if (!pending.has(n.id)) pending.set(n.id, n);
    }
  } finally {
    flushing = false;
    if (pending.size) {
      timer = setTimeout(() => {
        void flushNoteEmbeddingQueue();
      }, 2500);
    }
  }
}

export async function backfillNoteEmbeddings(
  notes: NoteEmbedInput[],
  opts?: { maxNotes?: number; onProgress?: (done: number, total: number) => void }
): Promise<{ upserted: number; errors: number }> {
  const max = opts?.maxNotes ?? 80;
  const slice = notes.filter((n) => n.id).slice(0, max);
  let upserted = 0;
  let errors = 0;
  for (let i = 0; i < slice.length; i += 16) {
    const chunk = slice.slice(i, i + 16);
    try {
      const r = await upsertNoteEmbeddings(chunk);
      upserted += (r.results || []).filter((x) => !x.skipped).length;
      errors += (r.errors || []).length;
    } catch {
      errors += chunk.length;
    }
    opts?.onProgress?.(Math.min(i + chunk.length, slice.length), slice.length);
  }
  return { upserted, errors };
}

export async function resolveSemanticNoteIds(
  query: string,
  opts?: {
    limit?: number;
    folder?: string;
    database_id?: string;
    scopeIds?: string[];
    tags?: string[];
    softFail?: boolean;
  }
): Promise<string[]> {
  try {
    const { hits } = await searchNotesSemantic(query, {
      limit: opts?.limit ?? 12,
      folder: opts?.folder,
      database_id: opts?.database_id,
      scopeIds: opts?.scopeIds,
      tags: opts?.tags,
    });
    return hits.map((h) => h.id);
  } catch (e) {
    if (opts?.softFail !== false) return [];
    throw e;
  }
}

export async function ensureIndexedThenSearch(
  notes: NoteEmbedInput[],
  query: string,
  opts?: {
    limit?: number;
    database_id?: string;
    scopeIds?: string[];
    backfillMax?: number;
  }
): Promise<SemanticHit[]> {
  if (notes.length && query.trim()) {
    const pool = opts?.scopeIds?.length
      ? notes.filter((n) => opts.scopeIds!.includes(n.id))
      : notes;
    await backfillNoteEmbeddings(pool.slice(0, opts?.backfillMax ?? 48)).catch(() => undefined);
  }
  const { hits } = await searchNotesSemantic(query, {
    limit: opts?.limit ?? 28,
    database_id: opts?.database_id,
    scopeIds: opts?.scopeIds,
  });
  return hits;
}
