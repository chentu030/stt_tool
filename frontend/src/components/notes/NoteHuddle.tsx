"use client";

/**
 * Note-page Huddle — mesh WebRTC voice via Firestore signaling.
 * Works best for 2–4 people; not a production SFU.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  limit,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";

type Signal = {
  id: string;
  from_uid: string;
  to_uid: string | null;
  type: "join" | "offer" | "answer" | "ice" | "leave";
  payload?: string;
  created_at?: { toMillis?: () => number } | null;
};

const ICE: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

/** Ignore stale signaling docs older than this (previous sessions). */
const SIGNAL_MAX_AGE_MS = 30 * 60 * 1000;

function huddleErrorMessage(e: unknown): string {
  const code =
    e && typeof e === "object" && "code" in e ? String((e as { code?: string }).code || "") : "";
  const msg = e instanceof Error ? e.message : String(e || "");
  if (
    code === "permission-denied" ||
    /insufficient permissions|permission-denied|Missing or insufficient/i.test(msg)
  ) {
    return "無法連線通話信令（Firestore 權限不足）。請用專案擁有者帳號部署最新 firestore.rules。";
  }
  if (
    code === "NotAllowedError" ||
    /NotAllowedError|Permission denied by user|getUserMedia|麥克風/i.test(msg)
  ) {
    return "無法使用麥克風，請在瀏覽器允許麥克風權限後重試。";
  }
  if (/NotFoundError|DevicesNotFound/i.test(msg) || code === "NotFoundError") {
    return "找不到麥克風裝置。";
  }
  return msg || "加入通話失敗";
}

export default function NoteHuddle({
  noteId,
  roomId,
  label = "加入通話",
}: {
  noteId?: string;
  /** Generic huddle room key (e.g. team channel). Falls back to noteId. */
  roomId?: string;
  label?: string;
}) {
  const huddleId = roomId || noteId || "";
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [peers, setPeers] = useState<string[]>([]);

  const localStreamRef = useRef<MediaStream | null>(null);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const audioHostRef = useRef<HTMLDivElement>(null);
  const processedRef = useRef<Set<string>>(new Set());
  const joinedRef = useRef(false);
  const userRef = useRef(user);
  userRef.current = user;
  const joinStartedAtRef = useRef(0);
  const signalsUnsubRef = useRef<Unsubscribe | null>(null);

  const signalsCol = useCallback(
    () => collection(db, "huddles", huddleId, "signals"),
    [huddleId]
  );

  const postSignal = useCallback(
    async (partial: Omit<Signal, "id" | "created_at">) => {
      const u = userRef.current;
      if (!u || !huddleId) return;
      await addDoc(signalsCol(), {
        ...partial,
        created_at: serverTimestamp(),
      });
    },
    [huddleId, signalsCol]
  );

  const attachRemote = (uid: string, stream: MediaStream) => {
    const host = audioHostRef.current;
    if (!host) return;
    let el = host.querySelector(`audio[data-uid="${uid}"]`) as HTMLAudioElement | null;
    if (!el) {
      el = document.createElement("audio");
      el.dataset.uid = uid;
      el.autoplay = true;
      el.setAttribute("playsinline", "true");
      host.appendChild(el);
    }
    el.srcObject = stream;
    void el.play().catch(() => {
      /* autoplay may need a prior user gesture — join click counts */
    });
  };

  const ensurePc = useCallback(
    (remoteUid: string) => {
      let pc = pcsRef.current.get(remoteUid);
      if (pc) return pc;
      pc = new RTCPeerConnection(ICE);
      pcsRef.current.set(remoteUid, pc);
      setPeers((p) => (p.includes(remoteUid) ? p : [...p, remoteUid]));

      const local = localStreamRef.current;
      local?.getTracks().forEach((t) => pc!.addTrack(t, local));

      pc.onicecandidate = (ev) => {
        const u = userRef.current;
        if (!ev.candidate || !u) return;
        void postSignal({
          from_uid: u.uid,
          to_uid: remoteUid,
          type: "ice",
          payload: JSON.stringify(ev.candidate.toJSON()),
        }).catch((err) => console.warn("huddle ice signal", err));
      };
      pc.ontrack = (ev) => {
        const stream = ev.streams[0] || new MediaStream([ev.track]);
        attachRemote(remoteUid, stream);
      };
      pc.onconnectionstatechange = () => {
        if (pc!.connectionState === "failed" || pc!.connectionState === "closed") {
          pcsRef.current.delete(remoteUid);
          setPeers((p) => p.filter((x) => x !== remoteUid));
        }
      };
      return pc;
    },
    [postSignal]
  );

  const cleanupLocal = useCallback(() => {
    signalsUnsubRef.current?.();
    signalsUnsubRef.current = null;
    pcsRef.current.forEach((pc) => pc.close());
    pcsRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    if (audioHostRef.current) audioHostRef.current.innerHTML = "";
    processedRef.current.clear();
    joinedRef.current = false;
    joinStartedAtRef.current = 0;
    setPeers([]);
    setJoined(false);
    setJoining(false);
    setMuted(false);
  }, []);

  const leave = useCallback(async () => {
    const u = userRef.current;
    const wasJoined = joinedRef.current;
    if (u && wasJoined) {
      try {
        await postSignal({ from_uid: u.uid, to_uid: null, type: "leave" });
      } catch {
        /* ignore */
      }
    }
    cleanupLocal();
  }, [cleanupLocal, postSignal]);

  const handleSignal = useCallback(
    async (d: Omit<Signal, "id">, createdMs = 0) => {
      const u = userRef.current;
      if (!u || !joinedRef.current) return;

      if (d.type === "join") {
        // Ignore people who were already in the room before this session —
        // they will see our join and offer to us.
        if (createdMs && createdMs < joinStartedAtRef.current - 500) return;

        // Already here when they joined → always offer.
        // Near-simultaneous joins → higher uid offers (avoids glare).
        const theyJoinedAfterMe = createdMs >= joinStartedAtRef.current + 80;
        if (!theyJoinedAfterMe && u.uid < d.from_uid) {
          ensurePc(d.from_uid);
          return;
        }
        const pc = ensurePc(d.from_uid);
        if (pc.signalingState !== "stable") return;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await postSignal({
          from_uid: u.uid,
          to_uid: d.from_uid,
          type: "offer",
          payload: JSON.stringify(offer),
        });
      } else if (d.type === "offer" && d.payload) {
        const pc = ensurePc(d.from_uid);
        if (pc.signalingState !== "stable") return;
        await pc.setRemoteDescription(JSON.parse(d.payload));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await postSignal({
          from_uid: u.uid,
          to_uid: d.from_uid,
          type: "answer",
          payload: JSON.stringify(answer),
        });
      } else if (d.type === "answer" && d.payload) {
        const pc = pcsRef.current.get(d.from_uid) || ensurePc(d.from_uid);
        if (pc.signalingState !== "have-local-offer") return;
        await pc.setRemoteDescription(JSON.parse(d.payload));
      } else if (d.type === "ice" && d.payload) {
        const pc = pcsRef.current.get(d.from_uid);
        if (pc) {
          try {
            await pc.addIceCandidate(JSON.parse(d.payload));
          } catch {
            /* candidate may arrive before remote description */
          }
        }
      } else if (d.type === "leave") {
        const pc = pcsRef.current.get(d.from_uid);
        pc?.close();
        pcsRef.current.delete(d.from_uid);
        setPeers((p) => p.filter((x) => x !== d.from_uid));
        audioHostRef.current?.querySelector(`audio[data-uid="${d.from_uid}"]`)?.remove();
      }
    },
    [ensurePc, postSignal]
  );

  const join = useCallback(async () => {
    const u = userRef.current;
    if (!u || joinedRef.current || joining) return;
    setError("");
    setOpen(true);
    setJoining(true);
    let stream: MediaStream | null = null;
    try {
      if (!window.isSecureContext && location.hostname !== "localhost") {
        throw new Error("語音通話需要 HTTPS 環境。");
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      joinStartedAtRef.current = Date.now();
      // Allow signal handler before React state commits (snapshot can fire immediately).
      joinedRef.current = true;

      const q = query(signalsCol(), orderBy("created_at", "desc"), limit(120));
      signalsUnsubRef.current?.();
      signalsUnsubRef.current = onSnapshot(
        q,
        (snap) => {
          const now = Date.now();
          // Process oldest → newest so offer/answer order is sane.
          const changes = snap
            .docChanges()
            .filter((c) => c.type === "added")
            .reverse();
          for (const change of changes) {
            const id = change.doc.id;
            if (processedRef.current.has(id)) continue;
            processedRef.current.add(id);
            const d = change.doc.data() as Omit<Signal, "id">;
            if (d.from_uid === u.uid) continue;
            if (d.to_uid && d.to_uid !== u.uid) continue;

            const created = d.created_at?.toMillis?.() ?? 0;
            if (created && now - created > SIGNAL_MAX_AGE_MS) continue;
            // Drop stale session noise; join handler also gates on joinStartedAt.
            if (created && created < joinStartedAtRef.current - 500 && d.type !== "join") {
              continue;
            }

            void handleSignal(d, created).catch((err) => console.warn("huddle signal", err));
          }
        },
        (err) => {
          setError(huddleErrorMessage(err));
          cleanupLocal();
        }
      );

      await postSignal({ from_uid: u.uid, to_uid: null, type: "join" });
      setJoined(true);
      setJoining(false);
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      signalsUnsubRef.current?.();
      signalsUnsubRef.current = null;
      joinedRef.current = false;
      setJoined(false);
      setJoining(false);
      setError(huddleErrorMessage(e));
    }
  }, [cleanupLocal, handleSignal, joining, postSignal, signalsCol]);

  // Unmount only — do NOT depend on `leave` / `joined` or join will self-cancel.
  useEffect(() => {
    return () => {
      void (async () => {
        const u = userRef.current;
        if (u && joinedRef.current) {
          try {
            await addDoc(collection(db, "huddles", huddleId, "signals"), {
              from_uid: u.uid,
              to_uid: null,
              type: "leave",
              created_at: serverTimestamp(),
            });
          } catch {
            /* ignore */
          }
        }
        signalsUnsubRef.current?.();
        pcsRef.current.forEach((pc) => pc.close());
        pcsRef.current.clear();
        localStreamRef.current?.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      })();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [huddleId]);

  useEffect(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    stream.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
  }, [muted]);

  if (!user || !huddleId) return null;

  return (
    <div className="note-huddle tm-noise">
      <button
        type="button"
        className={`doc-cmd${joined ? " is-on" : ""}`}
        onClick={() => {
          if (joined) {
            setOpen((v) => !v);
            return;
          }
          setOpen(true);
          void join();
        }}
        title="語音通話"
        disabled={joining}
      >
        {joining
          ? "連線中…"
          : joined
            ? `🎙 通話中${peers.length ? ` · ${peers.length + 1} 人` : ""}`
            : label}
      </button>

      {open && (
        <div className="note-huddle-panel">
          <div className="note-huddle-head">
            <strong>Huddle 語音</strong>
            <button type="button" className="doc-cmd" onClick={() => setOpen(false)}>
              關閉
            </button>
          </div>
          <p className="note-huddle-hint">
            邊看筆記邊語音。請允許麥克風；另一位成員開啟同一篇筆記並加入即可互通。
          </p>
          {joining && <p className="note-huddle-status">正在請求麥克風與連線…</p>}
          {joined && !joining && (
            <p className="note-huddle-status">
              {peers.length
                ? `已連線 ${peers.length} 位成員`
                : "已加入，等待其他人進入同一篇筆記並加入通話"}
            </p>
          )}
          {error && <p className="sel-ai-error">{error}</p>}
          <div className="note-huddle-controls">
            {!joined ? (
              <button
                type="button"
                className="btn btn-sm"
                disabled={joining}
                onClick={() => void join()}
              >
                {joining ? "連線中…" : "加入通話"}
              </button>
            ) : (
              <>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMuted((v) => !v)}>
                  {muted ? "🔇 已靜音" : "🎤 麥克風開啟"}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => void leave()}>
                  離開通話
                </button>
              </>
            )}
          </div>
          <div ref={audioHostRef} className="note-huddle-audio" hidden />
        </div>
      )}
    </div>
  );
}
