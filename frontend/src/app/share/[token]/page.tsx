"use client";

import PageLoading from "@/components/motion/PageLoading";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import RichNoteEditor from "@/components/RichNoteEditor";
import CanvasShareViewer from "@/components/canvas/CanvasShareViewer";
import {
  copySharedNoteToUser,
  getNoteById,
  listenToNote,
  listenToShareToken,
  noteFromShareToken,
  resolveShareToken,
  type ShareMode,
} from "@/lib/share";
import {
  canvasDocFromShareToken,
  copySharedCanvasToUser,
  listenCanvasShareToken,
  resolveCanvasShareToken,
  type CanvasShareMode,
  type CanvasShareTokenDoc,
} from "@/lib/canvasShare";
import type { CanvasDoc } from "@/lib/canvasStore";
import { loginWithGoogle, type Note } from "@/lib/firebase";
import { useNoteCollab } from "@/hooks/useNoteCollab";
import NotePresence from "@/components/notes/NotePresence";
import {
  fetchAccessRequest,
  isAllowlistedEmail,
  listenAccessRequest,
  resolveAccess,
  type AccessRequest,
} from "@/lib/accessGate";
import { toast } from "@/lib/toast";

type ShareKind = "note" | "canvas" | null;

export default function ShareNotePage() {
  const { token } = useParams<{ token: string }>();
  const { user, loading: authLoading, displayName } = useAuth();
  const router = useRouter();
  const [kind, setKind] = useState<ShareKind>(null);
  const [mode, setMode] = useState<ShareMode | CanvasShareMode>("view");
  const [note, setNote] = useState<Note | null>(null);
  const [canvasDoc, setCanvasDoc] = useState<CanvasDoc | null>(null);
  const [canvasLink, setCanvasLink] = useState<CanvasShareTokenDoc | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [copyBusy, setCopyBusy] = useState(false);
  const [accessReq, setAccessReq] = useState<AccessRequest | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const bodyRef = useRef(body);
  bodyRef.current = body;

  const accessStatus = resolveAccess(user, accessReq);
  const accessApproved =
    !!user && (isAllowlistedEmail(user.email) || accessStatus === "approved");
  const accessPending = !!user && accessStatus === "pending";
  // Edit / copy into library require closed-beta approval — view-only stays open.
  const canEdit = kind === "note" && mode === "edit" && accessApproved;
  const collabEnabled = !!note && kind === "note" && mode === "edit" && accessApproved;

  const collab = useNoteCollab({
    noteId: note?.id,
    uid: user?.uid,
    displayName,
    enabled: collabEnabled,
    canWrite: canEdit,
    seedMarkdown: body,
    seedTitle: title,
    getBodyMd: () => bodyRef.current,
    onTitleRemote: (t) => setTitle(t),
  });
  const collabReady = collab.ready && !!collab.provider;

  useEffect(() => {
    if (!user) {
      setAccessReq(null);
      setAccessLoading(false);
      return;
    }
    if (isAllowlistedEmail(user.email)) {
      setAccessReq(null);
      setAccessLoading(false);
      return;
    }
    let cancelled = false;
    setAccessLoading(true);
    void fetchAccessRequest(user.uid).then((req) => {
      if (cancelled) return;
      setAccessReq(req);
      setAccessLoading(false);
    });
    const unsub = listenAccessRequest(user.uid, (req) => {
      if (cancelled) return;
      setAccessReq(req);
      setAccessLoading(false);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [user]);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError("");
      setKind(null);
      setNote(null);
      setCanvasDoc(null);
      setCanvasLink(null);
      try {
        if (!token) throw new Error("無效連結");

        const canvas = await resolveCanvasShareToken(token);
        if (canvas) {
          if (cancelled) return;
          setKind("canvas");
          setMode(canvas.mode);
          setCanvasLink(canvas);
          setTitle(canvas.name);
          setCanvasDoc(canvasDocFromShareToken(canvas));
          unsub = listenCanvasShareToken(token, (live) => {
            if (!live) {
              setError("白板已刪除或分享已關閉");
              setCanvasDoc(null);
              setCanvasLink(null);
              return;
            }
            setCanvasLink(live);
            setMode(live.mode);
            setTitle(live.name);
            setCanvasDoc(canvasDocFromShareToken(live));
          });
          return;
        }

        const link = await resolveShareToken(token);
        if (!link?.note_id) throw new Error("分享連結不存在或已關閉");
        if (cancelled) return;
        setKind("note");
        setMode(link.mode);

        // Edit mode (signed in): live note + collab. View/copy: public token snapshot only.
        const useLiveNote = link.mode === "edit" && accessApproved;
        if (useLiveNote) {
          const n = await getNoteById(link.note_id);
          if (!n) throw new Error("筆記不存在或無法讀取");
          if (cancelled) return;
          setNote(n);
          setTitle(n.title);
          setBody(n.body_md);
          unsub = listenToNote(link.note_id, (live) => {
            if (!live) {
              setError("筆記已刪除或分享已關閉");
              setNote(null);
              return;
            }
            if (!live.share?.enabled) {
              setError("擁有者已停止分享");
              return;
            }
            setNote(live);
            if (collabReadyRef.current) return;
            setTitle(live.title);
            setBody(live.body_md);
          });
        } else {
          const snapNote = noteFromShareToken(token, link);
          if (!snapNote.title && !snapNote.body_md) {
            throw new Error("此分享連結需擁有者重新開啟一次分享後才能檢視");
          }
          if (cancelled) return;
          setNote(snapNote);
          setTitle(snapNote.title);
          setBody(snapNote.body_md);
          unsub = listenToShareToken(token, (live) => {
            if (!live) {
              setError("筆記已刪除或分享已關閉");
              setNote(null);
              return;
            }
            const next = noteFromShareToken(token, live);
            setNote(next);
            setTitle(next.title);
            setBody(next.body_md);
          });
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [token, user?.uid, accessApproved]);

  const collabReadyRef = useRef(false);
  collabReadyRef.current = collabReady;

  const onCopyNote = async () => {
    if (!user) {
      await loginWithGoogle();
      return;
    }
    if (!accessApproved) {
      if (accessPending) {
        toast("申請審核中，通過後即可複製到知識庫");
      } else {
        toast("請先完成使用申請，並等待後台核准");
        router.push("/");
      }
      return;
    }
    if (!note) return;
    setCopyBusy(true);
    setError("");
    try {
      const id = await copySharedNoteToUser(user.uid, {
        ...note,
        title,
        body_md: bodyRef.current || body,
      });
      router.push(`/notes/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCopyBusy(false);
    }
  };

  const onCopyCanvas = async () => {
    if (!user) {
      await loginWithGoogle();
      return;
    }
    if (!accessApproved) {
      if (accessPending) {
        toast("申請審核中，通過後即可複製到我的白板");
      } else {
        toast("請先完成使用申請，並等待後台核准");
        router.push("/");
      }
      return;
    }
    if (!canvasLink) return;
    setCopyBusy(true);
    setError("");
    try {
      const id = await copySharedCanvasToUser(user.uid, canvasLink);
      router.push(`/canvas/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCopyBusy(false);
    }
  };

  const modeLabel =
    mode === "edit" ? "可編輯" : mode === "copy" ? "可複製" : "僅檢視";

  const syncLabel =
    !canEdit ? ""
    : collab.status === "saving" ? "同步中…"
    : collab.status === "synced" ? "即時共編"
    : collab.status === "connecting" ? "連線中…"
    : collab.status === "offline" ? "離線"
    : collab.status === "error" ? "同步異常"
    : "";

  const showCopy =
    (mode === "copy" || mode === "view") &&
    (kind === "note" ? !!note : kind === "canvas" ? !!canvasDoc : false);

  return (
    <div className={`share-page${kind === "canvas" ? " share-page--canvas" : ""}`}>
      <header className="share-page-head">
        <Link href="/" className="share-brand">
          Albireus
        </Link>
        <span className="share-pill">{modeLabel}分享</span>
        {kind === "canvas" && title ? <span className="share-save">{title}</span> : null}
        {canEdit && syncLabel && <span className="share-save">{syncLabel}</span>}
        {kind === "note" && note && user ? <NotePresence noteId={note.id} /> : null}
        <div className="share-page-actions">
          {showCopy && kind === "note" && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={copyBusy || !note}
              onClick={() => void onCopyNote()}
            >
              {!user ? "登入後複製" : copyBusy ? "複製中…" : "複製到我的知識庫"}
            </button>
          )}
          {showCopy && kind === "canvas" && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={copyBusy || !canvasLink}
              onClick={() => void onCopyCanvas()}
              title="複製一份到你的白板"
            >
              {!user ? "登入後複製" : copyBusy ? "複製中…" : "複製到我的白板"}
            </button>
          )}
          {kind === "note" && mode === "edit" && !user && !authLoading && (
            <button type="button" className="btn btn-sm" onClick={() => void loginWithGoogle()}>
              登入以編輯
            </button>
          )}
          {kind === "note" && mode === "edit" && user && !accessLoading && !accessApproved && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => router.push("/")}
            >
              {accessPending ? "審核中 — 查看申請狀態" : "申請使用後即可編輯"}
            </button>
          )}
          {user && (
            <Link href={kind === "canvas" ? "/canvas" : "/library"} className="btn btn-sm btn-ghost">
              {kind === "canvas" ? "我的白板" : "我的知識庫"}
            </Link>
          )}
        </div>
      </header>

      {busy && <PageLoading fill={false} label="載入中…" />}
      {error && <p className="share-status is-error">{error}</p>}

      {!busy && kind === "note" && note && !error && mode === "edit" && user && !accessLoading && !accessApproved && (
        <p className="share-status">
          {accessPending
            ? "你的使用申請審核中。通過後即可編輯此分享文件；目前為唯讀。"
            : "編輯分享文件需先完成使用申請並經後台核准。目前為唯讀。"}
        </p>
      )}

      {!busy && kind === "note" && note && !error && (
        <div className="share-doc">
          {canEdit ? (
            <input
              className="share-title-input"
              value={title}
              onChange={(e) => {
                const v = e.target.value;
                setTitle(v);
                if (collabReady) collab.setTitle(v);
              }}
              placeholder="標題"
            />
          ) : (
            <h1 className="share-title">{title || "未命名"}</h1>
          )}
          {canEdit && !collabReady && collab.status !== "error" ? (
            <PageLoading fill={false} label="共編連線中…" />
          ) : (
            <RichNoteEditor
              key={collabReady ? `share-collab-${note.id}` : `share-${note.id}-${collab.status}`}
              valueMd={body}
              onChangeMd={(md) => {
                setBody(md);
                bodyRef.current = md;
              }}
              readOnly={!canEdit}
              placeholder={canEdit ? "開始編輯…" : ""}
              userId={user?.uid}
              noteId={note.id}
              collab={collabReady && collab.provider ? { provider: collab.provider } : undefined}
            />
          )}
        </div>
      )}

      {!busy && kind === "canvas" && canvasDoc && !error && (
        <CanvasShareViewer doc={canvasDoc} />
      )}
    </div>
  );
}
