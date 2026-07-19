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
  query,
  serverTimestamp,
  limit,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";

type Signal = {
  id: string;
  from_uid: string;
  to_uid: string | null;
  type: "join" | "offer" | "answer" | "ice" | "leave";
  payload?: string;
};

const ICE: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

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
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [peers, setPeers] = useState<string[]>([]);

  const localStreamRef = useRef<MediaStream | null>(null);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const audioHostRef = useRef<HTMLDivElement>(null);
  const processedRef = useRef<Set<string>>(new Set());

  const signalsCol = () => collection(db, "huddles", huddleId, "signals");

  const postSignal = useCallback(
    async (partial: Omit<Signal, "id">) => {
      if (!user || !huddleId) return;
      await addDoc(signalsCol(), {
        ...partial,
        created_at: serverTimestamp(),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [huddleId, user]
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
        if (!ev.candidate || !user) return;
        void postSignal({
          from_uid: user.uid,
          to_uid: remoteUid,
          type: "ice",
          payload: JSON.stringify(ev.candidate),
        });
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
    [postSignal, user]
  );

  const leave = useCallback(async () => {
    if (user) {
      try {
        await postSignal({ from_uid: user.uid, to_uid: null, type: "leave" });
      } catch {
        /* ignore */
      }
    }
    pcsRef.current.forEach((pc) => pc.close());
    pcsRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    if (audioHostRef.current) audioHostRef.current.innerHTML = "";
    setPeers([]);
    setJoined(false);
    setMuted(false);
  }, [postSignal, user]);

  const join = useCallback(async () => {
    if (!user || joined) return;
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      setJoined(true);
      setOpen(true);
      await postSignal({ from_uid: user.uid, to_uid: null, type: "join" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "無法取得麥克風");
    }
  }, [joined, postSignal, user]);

  useEffect(() => {
    if (!joined || !user) return;
    const q = query(signalsCol(), limit(300));
    const unsub = onSnapshot(q, (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type !== "added") return;
        const id = change.doc.id;
        if (processedRef.current.has(id)) return;
        processedRef.current.add(id);
        const d = change.doc.data() as Omit<Signal, "id">;
        if (d.from_uid === user.uid) return;
        if (d.to_uid && d.to_uid !== user.uid) return;

        void (async () => {
          try {
            if (d.type === "join") {
              const pc = ensurePc(d.from_uid);
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              await postSignal({
                from_uid: user.uid,
                to_uid: d.from_uid,
                type: "offer",
                payload: JSON.stringify(offer),
              });
            } else if (d.type === "offer" && d.payload) {
              const pc = ensurePc(d.from_uid);
              await pc.setRemoteDescription(JSON.parse(d.payload));
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              await postSignal({
                from_uid: user.uid,
                to_uid: d.from_uid,
                type: "answer",
                payload: JSON.stringify(answer),
              });
            } else if (d.type === "answer" && d.payload) {
              const pc = pcsRef.current.get(d.from_uid) || ensurePc(d.from_uid);
              await pc.setRemoteDescription(JSON.parse(d.payload));
            } else if (d.type === "ice" && d.payload) {
              const pc = pcsRef.current.get(d.from_uid);
              if (pc) await pc.addIceCandidate(JSON.parse(d.payload));
            } else if (d.type === "leave") {
              const pc = pcsRef.current.get(d.from_uid);
              pc?.close();
              pcsRef.current.delete(d.from_uid);
              setPeers((p) => p.filter((x) => x !== d.from_uid));
              audioHostRef.current?.querySelector(`audio[data-uid="${d.from_uid}"]`)?.remove();
            }
          } catch (err) {
            console.warn("huddle signal", err);
          }
        })();
      });
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, user, huddleId, ensurePc, postSignal]);

  useEffect(() => {
    return () => {
      void leave();
    };
  }, [leave]);

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
        onClick={() => (joined ? setOpen((v) => !v) : void join())}
        title="語音通話"
      >
        {joined ? `🎙 通話中${peers.length ? ` · ${peers.length + 1}` : ""}` : label}
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
          {error && <p className="sel-ai-error">{error}</p>}
          <div className="note-huddle-controls">
            {!joined ? (
              <button type="button" className="btn btn-sm" onClick={() => void join()}>
                加入通話
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
