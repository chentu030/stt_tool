"use client";

import PageLoading from "@/components/motion/PageLoading";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import RichNoteEditor from "@/components/RichNoteEditor";
import {
  copySharedNoteToUser,
  getNoteById,
  listenToNote,
  resolveShareToken,
  type ShareMode,
} from "@/lib/share";
import { updateNote, loginWithGoogle, type Note } from "@/lib/firebase";

export default function ShareNotePage() {
  const { token } = useParams<{ token: string }>();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<ShareMode>("view");
  const [note, setNote] = useState<Note | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [saveState, setSaveState] = useState("");
  const [copyBusy, setCopyBusy] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canEdit = mode === "edit" && !!user;

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError("");
      try {
        if (!token) throw new Error("無效連結");
        const link = await resolveShareToken(token);
        if (!link?.note_id) throw new Error("分享連結不存在或已關閉");
        if (cancelled) return;
        setMode(link.mode);
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
          setTitle(live.title);
          setBody(live.body_md);
        });
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
  }, [token]);

  const scheduleSave = (nextTitle: string, nextBody: string) => {
    if (!canEdit || !note) return;
    setSaveState("未儲存");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        setSaveState("儲存中…");
        await updateNote(note.id, { title: nextTitle, body_md: nextBody });
        setSaveState("已儲存");
      } catch (e) {
        setSaveState(e instanceof Error ? e.message : "儲存失敗");
      }
    }, 800);
  };

  const onCopy = async () => {
    if (!note) return;
    if (!user) {
      await loginWithGoogle();
      return;
    }
    setCopyBusy(true);
    try {
      const id = await copySharedNoteToUser(user.uid, {
        ...note,
        title,
        body_md: body,
      });
      router.push(`/notes/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCopyBusy(false);
    }
  };

  const modeLabel =
    mode === "edit" ? "可編輯" : mode === "copy" ? "可複製" : "僅檢視";

  return (
    <div className="share-page">
      <header className="share-page-head">
        <Link href="/" className="share-brand">
          Albireus
        </Link>
        <span className="share-pill">{modeLabel}分享</span>
        {canEdit && saveState && <span className="share-save">{saveState}</span>}
        <div className="share-page-actions">
          {(mode === "copy" || mode === "view") && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={copyBusy || !note}
              onClick={() => void onCopy()}
            >
              {!user ? "登入後複製" : copyBusy ? "複製中…" : "複製到我的知識庫"}
            </button>
          )}
          {mode === "edit" && !user && !authLoading && (
            <button type="button" className="btn btn-sm" onClick={() => void loginWithGoogle()}>
              登入以編輯
            </button>
          )}
          {user && (
            <Link href="/library" className="btn btn-sm btn-ghost">
              我的知識庫
            </Link>
          )}
        </div>
      </header>

      {busy && <PageLoading fill={false} label="載入中…" />}
      {error && <p className="share-status is-error">{error}</p>}

      {!busy && note && !error && (
        <div className="share-doc">
          {canEdit ? (
            <input
              className="share-title-input"
              value={title}
              onChange={(e) => {
                const v = e.target.value;
                setTitle(v);
                scheduleSave(v, body);
              }}
              placeholder="標題"
            />
          ) : (
            <h1 className="share-title">{title || "未命名"}</h1>
          )}
          <RichNoteEditor
            valueMd={body}
            onChangeMd={(md) => {
              setBody(md);
              scheduleSave(title, md);
            }}
            readOnly={!canEdit}
            placeholder={canEdit ? "開始編輯…" : ""}
          />
        </div>
      )}
    </div>
  );
}
