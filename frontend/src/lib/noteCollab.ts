/**
 * TipTap + Yjs realtime collaboration over Firestore.
 * Local edits apply instantly; remote peers see batched updates (~150–400ms warm).
 */

import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  deleteDoc,
  Timestamp,
  type Unsubscribe,
  writeBatch,
} from "firebase/firestore";
import { db, updateNote, maybePushNoteVersion } from "@/lib/firebase";
import { colorForUid } from "@/lib/presence";

const FRAGMENT_FIELD = "default";
const UPDATE_FLUSH_MS = 80;
const AWARENESS_FLUSH_MS = 80;
const STATE_COMPACT_MS = 45_000;
const BODY_SNAPSHOT_MS = 5_000;
const MAX_UPDATES_BEFORE_COMPACT = 40;

export type CollabUserInfo = {
  uid: string;
  name: string;
  color: string;
};

export type CollabSyncStatus = "connecting" | "synced" | "saving" | "offline" | "error";

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function updatesCol(noteId: string) {
  return collection(db, "notes", noteId, "ydoc_updates");
}

function awarenessCol(noteId: string) {
  return collection(db, "notes", noteId, "awareness");
}

function stateDoc(noteId: string) {
  return doc(db, "notes", noteId, "ydoc", "state");
}

export function collabUserFromAuth(
  uid: string,
  name?: string | null
): CollabUserInfo {
  return {
    uid,
    name: (name || "訪客").trim() || "訪客",
    color: colorForUid(uid),
  };
}

type ProviderOpts = {
  noteId: string;
  user: CollabUserInfo;
  /** When Y doc has no cloud state, editor should seed once from this markdown. */
  seedMarkdown?: string;
  canWrite: boolean;
  onStatus?: (s: CollabSyncStatus) => void;
  onTitleRemote?: (title: string) => void;
  /** Called after remote/local ydoc changes settle — parent may export HTML→md. */
  onDocChanged?: () => void;
};

/**
 * Minimal provider shape expected by @tiptap/extension-collaboration-caret
 * (`provider.awareness`).
 */
export class FirestoreYjsProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  readonly noteId: string;
  readonly user: CollabUserInfo;
  readonly canWrite: boolean;
  /** True until first cloud state applied (or confirmed empty). */
  synced = false;
  /** Editor should call setContent once if fragment empty after sync. */
  needsSeed = false;
  seedMarkdown = "";

  private meta: Y.Map<unknown>;
  private unsubs: Unsubscribe[] = [];
  private destroyed = false;
  private applyingRemote = false;
  private pendingUpdate: Uint8Array | null = null;
  private updateTimer: ReturnType<typeof setTimeout> | null = null;
  private awarenessTimer: ReturnType<typeof setTimeout> | null = null;
  private compactTimer: ReturnType<typeof setInterval> | null = null;
  private updateCount = 0;
  private seenUpdateIds = new Set<string>();
  private localUpdateIds = new Set<string>();
  private onStatus?: (s: CollabSyncStatus) => void;
  private onTitleRemote?: (title: string) => void;
  private onDocChanged?: () => void;
  private titleApplying = false;
  private status: CollabSyncStatus = "connecting";

  constructor(opts: ProviderOpts) {
    this.noteId = opts.noteId;
    this.user = opts.user;
    this.canWrite = opts.canWrite;
    this.seedMarkdown = opts.seedMarkdown || "";
    this.onStatus = opts.onStatus;
    this.onTitleRemote = opts.onTitleRemote;
    this.onDocChanged = opts.onDocChanged;
    this.doc = new Y.Doc();
    this.awareness = new Awareness(this.doc);
    this.meta = this.doc.getMap("meta");
    this.awareness.setLocalStateField("user", {
      name: this.user.name,
      color: this.user.color,
      uid: this.user.uid,
    });
  }

  private setStatus(s: CollabSyncStatus) {
    this.status = s;
    this.onStatus?.(s);
  }

  async connect(): Promise<void> {
    this.setStatus("connecting");
    try {
      await this.loadInitialState();
      this.bindLocalDoc();
      this.bindRemoteUpdates();
      this.bindAwareness();
      this.bindTitle();
      if (this.canWrite) {
        this.compactTimer = setInterval(() => {
          void this.compactState();
        }, STATE_COMPACT_MS);
      }
      this.synced = true;
      this.setStatus(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "synced");
    } catch (e) {
      console.error("[FirestoreYjsProvider] connect", e);
      this.setStatus("error");
      throw e;
    }
  }

  private async loadInitialState() {
    const snap = await getDoc(stateDoc(this.noteId));
    if (snap.exists()) {
      const bin = String(snap.data()?.bin || "");
      if (bin) {
        this.applyingRemote = true;
        try {
          Y.applyUpdate(this.doc, base64ToBytes(bin), "firestore-state");
        } finally {
          this.applyingRemote = false;
        }
      }
    }

    const updatesSnap = await getDocs(updatesCol(this.noteId));
    const rows = updatesSnap.docs
      .map((d) => ({
        id: d.id,
        bin: String(d.data().bin || ""),
        created: d.data().created_at?.toMillis?.() ?? 0,
      }))
      .filter((r) => r.bin)
      .sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));

    this.applyingRemote = true;
    try {
      for (const r of rows) {
        this.seenUpdateIds.add(r.id);
        Y.applyUpdate(this.doc, base64ToBytes(r.bin), "firestore-catchup");
      }
    } finally {
      this.applyingRemote = false;
    }

    const frag = this.doc.getXmlFragment(FRAGMENT_FIELD);
    this.needsSeed = frag.length === 0 && !!this.seedMarkdown;
  }

  private bindLocalDoc() {
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (this.destroyed || this.applyingRemote) return;
      if (origin === "firestore-state" || origin === "firestore-catchup" || origin === "firestore-live") {
        return;
      }
      if (!this.canWrite) return;
      this.pendingUpdate = this.pendingUpdate
        ? Y.mergeUpdates([this.pendingUpdate, update])
        : update;
      if (this.updateTimer) clearTimeout(this.updateTimer);
      this.updateTimer = setTimeout(() => void this.flushUpdates(), UPDATE_FLUSH_MS);
      this.onDocChanged?.();
    };
    this.doc.on("update", onUpdate);
    this.unsubs.push(() => this.doc.off("update", onUpdate));
  }

  private bindRemoteUpdates() {
    const unsub = onSnapshot(
      updatesCol(this.noteId),
      (snap) => {
        snap.docChanges().forEach((change) => {
          if (change.type !== "added") return;
          const id = change.doc.id;
          if (this.seenUpdateIds.has(id) || this.localUpdateIds.has(id)) {
            this.seenUpdateIds.add(id);
            return;
          }
          const bin = String(change.doc.data().bin || "");
          if (!bin) return;
          this.seenUpdateIds.add(id);
          this.applyingRemote = true;
          try {
            Y.applyUpdate(this.doc, base64ToBytes(bin), "firestore-live");
          } finally {
            this.applyingRemote = false;
          }
          this.onDocChanged?.();
        });
      },
      (err) => console.error("[FirestoreYjsProvider] updates", err)
    );
    this.unsubs.push(unsub);
  }

  private async flushUpdates() {
    if (this.destroyed || !this.canWrite || !this.pendingUpdate) return;
    const update = this.pendingUpdate;
    this.pendingUpdate = null;
    const id = `${Date.now().toString(36)}_${this.doc.clientID}_${Math.random().toString(36).slice(2, 8)}`;
    this.localUpdateIds.add(id);
    this.seenUpdateIds.add(id);
    this.setStatus("saving");
    try {
      await setDoc(doc(updatesCol(this.noteId), id), {
        bin: bytesToBase64(update),
        client: this.doc.clientID,
        uid: this.user.uid,
        created_at: Timestamp.now(),
      });
      this.updateCount += 1;
      if (this.updateCount >= MAX_UPDATES_BEFORE_COMPACT) {
        this.updateCount = 0;
        void this.compactState();
      }
      this.setStatus("synced");
    } catch (e) {
      console.error("[FirestoreYjsProvider] flush", e);
      this.pendingUpdate = this.pendingUpdate
        ? Y.mergeUpdates([update, this.pendingUpdate])
        : update;
      this.setStatus(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error");
    }
  }

  private bindAwareness() {
    const onAwareness = (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown
    ) => {
      if (this.destroyed || origin === "firestore") return;
      if (!this.canWrite && origin !== "local") {
        /* viewers still publish presence caret as read-only? skip writes */
      }
      if (!this.canWrite) return;
      const changed = added.concat(updated, removed);
      if (!changed.length) return;
      if (this.awarenessTimer) clearTimeout(this.awarenessTimer);
      this.awarenessTimer = setTimeout(() => void this.flushAwareness(changed), AWARENESS_FLUSH_MS);
    };
    this.awareness.on("update", onAwareness);
    this.unsubs.push(() => this.awareness.off("update", onAwareness));

    const unsub = onSnapshot(
      awarenessCol(this.noteId),
      (snap) => {
        snap.docChanges().forEach((change) => {
          if (change.doc.id === this.user.uid) return;
          if (change.type === "removed") {
            const clients = change.doc.data()?.clients;
            if (Array.isArray(clients)) {
              removeAwarenessStates(this.awareness, clients as number[], "firestore");
            }
            return;
          }
          const bin = String(change.doc.data()?.bin || "");
          if (!bin) return;
          applyAwarenessUpdate(this.awareness, base64ToBytes(bin), "firestore");
        });
      },
      (err) => console.error("[FirestoreYjsProvider] awareness", err)
    );
    this.unsubs.push(unsub);

    // Heartbeat local awareness so others see us
    void this.flushAwareness([this.doc.clientID]);
  }

  private async flushAwareness(changedClients: number[]) {
    if (this.destroyed || !this.canWrite) return;
    try {
      const clients = changedClients.length ? changedClients : [this.doc.clientID];
      const update = encodeAwarenessUpdate(this.awareness, clients);
      await setDoc(
        doc(awarenessCol(this.noteId), this.user.uid),
        {
          bin: bytesToBase64(update),
          clients: [this.doc.clientID],
          name: this.user.name,
          color: this.user.color,
          updated_at: Timestamp.now(),
        },
        { merge: true }
      );
    } catch (e) {
      console.warn("[FirestoreYjsProvider] awareness flush", e);
    }
  }

  private bindTitle() {
    const onMeta = () => {
      if (this.titleApplying) return;
      const t = this.meta.get("title");
      if (typeof t === "string") this.onTitleRemote?.(t);
    };
    this.meta.observe(onMeta);
    this.unsubs.push(() => this.meta.unobserve(onMeta));
  }

  setTitleLocal(title: string) {
    if (!this.canWrite) return;
    const cur = this.meta.get("title");
    if (cur === title) return;
    this.titleApplying = true;
    this.doc.transact(() => {
      this.meta.set("title", title);
    }, "local-title");
    this.titleApplying = false;
  }

  markSeeded() {
    this.needsSeed = false;
  }

  private async compactState() {
    if (this.destroyed || !this.canWrite) return;
    try {
      const bin = bytesToBase64(Y.encodeStateAsUpdate(this.doc));
      await setDoc(stateDoc(this.noteId), {
        bin,
        updated_at: Timestamp.now(),
        uid: this.user.uid,
      });
      const updatesSnap = await getDocs(updatesCol(this.noteId));
      if (updatesSnap.size <= 8) return;
      // Keep newest ~8; delete the rest in batches of 400
      const sorted = [...updatesSnap.docs].sort((a, b) => {
        const ta = a.data().created_at?.toMillis?.() ?? 0;
        const tb = b.data().created_at?.toMillis?.() ?? 0;
        return tb - ta;
      });
      const drop = sorted.slice(8);
      for (let i = 0; i < drop.length; i += 400) {
        const batch = writeBatch(db);
        drop.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    } catch (e) {
      console.warn("[FirestoreYjsProvider] compact", e);
    }
  }

  async destroy() {
    this.destroyed = true;
    if (this.updateTimer) clearTimeout(this.updateTimer);
    if (this.awarenessTimer) clearTimeout(this.awarenessTimer);
    if (this.compactTimer) clearInterval(this.compactTimer);
    await this.flushUpdates();
    if (this.canWrite) {
      try {
        await this.compactState();
        await deleteDoc(doc(awarenessCol(this.noteId), this.user.uid));
      } catch {
        /* ignore */
      }
    }
    removeAwarenessStates(this.awareness, [this.doc.clientID], "local");
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.awareness.destroy();
    this.doc.destroy();
  }
}

export type UseNoteCollabExport = {
  provider: FirestoreYjsProvider | null;
  status: CollabSyncStatus;
  ready: boolean;
};

/** Persist derived body_md (+ optional version) without fighting Yjs as source of truth. */
export async function snapshotCollabBody(opts: {
  noteId: string;
  title: string;
  bodyMd: string;
  previousBody?: string;
  previousTitle?: string;
  lastVersionAt?: number;
}): Promise<{ writtenVersion: boolean; at?: number }> {
  await updateNote(
    opts.noteId,
    { title: opts.title, body_md: opts.bodyMd },
    { silent: false }
  );
  try {
    const v = await maybePushNoteVersion(opts.noteId, opts.title, opts.bodyMd, {
      previousBody: opts.previousBody,
      previousTitle: opts.previousTitle,
      lastVersionAt: opts.lastVersionAt,
    });
    return { writtenVersion: v.written, at: v.at };
  } catch {
    return { writtenVersion: false };
  }
}

export { FRAGMENT_FIELD, BODY_SNAPSHOT_MS };
