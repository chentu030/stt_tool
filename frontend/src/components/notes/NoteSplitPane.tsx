"use client";

import PageLoading from "@/components/motion/PageLoading";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getNote } from "@/lib/firebase";
import { loadPendingNoteDraft, saveNoteWithSync } from "@/lib/offlineSync";
import RichNoteEditor from "@/components/RichNoteEditor";
import PageChromeIcon from "@/components/PageChromeIcon";
import { useNoteTabsOptional } from "@/components/notes/NoteTabsProvider";
import { normalizePageIcon } from "@/lib/pageChrome";

type Props = {
  noteId: string;
  onClose: () => void;
  collapsed?: boolean;
  onExpand?: () => void;
  onCollapse?: () => void;
};

/** Compact secondary editor for side-by-side note view */
export default function NoteSplitPane({
  noteId,
  onClose,
  collapsed,
  onExpand,
  onCollapse,
}: Props) {
  const tabs = useNoteTabsOptional();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [icon, setIcon] = useState("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<"idle" | "dirty" | "saving" | "saved" | "offline">("idle");
  const dirty = useRef(false);
  const baseUpdatedAt = useRef(0);
  const titleRef = useRef(title);
  const bodyRef = useRef(body);
  titleRef.current = title;
  bodyRef.current = body;

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError("");
    dirty.current = false;
    void (async () => {
      try {
        const n = await getNote(noteId);
        if (cancelled) return;
        if (!n) {
          setError("找不到筆記");
          return;
        }
        const pending = await loadPendingNoteDraft(noteId);
        let nextTitle = n.title || "";
        let nextBody = n.body_md || "";
        if (pending?.payload) {
          if (typeof pending.payload.title === "string") nextTitle = pending.payload.title;
          if (typeof pending.payload.body_md === "string") nextBody = pending.payload.body_md;
          dirty.current = true;
          setStatus("offline");
        } else {
          setStatus("idle");
        }
        baseUpdatedAt.current = pending?.baseUpdatedAt ?? n.updated_at.getTime();
        setTitle(nextTitle);
        setBody(nextBody);
        setIcon(n.icon || "");
        setReady(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "載入失敗");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  useEffect(() => {
    const onReload = (ev: Event) => {
      const id = (ev as CustomEvent<{ noteId?: string }>).detail?.noteId;
      if (id !== noteId) return;
      void getNote(noteId).then((n) => {
        if (!n) return;
        baseUpdatedAt.current = n.updated_at.getTime();
        setTitle(n.title || "");
        setBody(n.body_md || "");
        dirty.current = false;
        setStatus("saved");
      });
    };
    const onBase = (ev: Event) => {
      const detail = (ev as CustomEvent<{ noteId?: string; updatedAt?: number }>).detail;
      if (detail?.noteId !== noteId) return;
      if (typeof detail.updatedAt === "number") baseUpdatedAt.current = detail.updatedAt;
    };
    window.addEventListener("albireus:note-reload", onReload);
    window.addEventListener("albireus:note-base", onBase);
    return () => {
      window.removeEventListener("albireus:note-reload", onReload);
      window.removeEventListener("albireus:note-base", onBase);
    };
  }, [noteId]);

  useEffect(() => {
    if (!ready || !dirty.current) return;
    setStatus("dirty");
    const t = window.setTimeout(() => {
      setStatus("saving");
      void saveNoteWithSync(
        noteId,
        {
          title: titleRef.current,
          body_md: bodyRef.current,
        },
        {
          baseUpdatedAt: baseUpdatedAt.current || Date.now(),
          label: titleRef.current,
        }
      ).then((result) => {
        if (result.status === "queued") {
          dirty.current = false;
          setStatus("offline");
          return;
        }
        if (result.status === "saved" || (result.status === "conflict_resolved" && result.kept === "local")) {
          dirty.current = false;
          baseUpdatedAt.current = result.updatedAt;
          setStatus("saved");
          return;
        }
        if (result.status === "conflict_resolved" && result.kept === "remote") {
          return;
        }
        setStatus("idle");
      });
    }, 700);
    return () => window.clearTimeout(t);
  }, [title, body, ready, noteId]);

  const markDirty = () => {
    dirty.current = true;
    setStatus("dirty");
  };

  if (collapsed) {
    return (
      <div className="note-split-pane is-collapsed">
        <button
          type="button"
          className="note-split-rail note-split-rail--right"
          title={`展開並排：${title || "未命名"}`}
          aria-label="展開右側並排"
          onClick={() => onExpand?.()}
        >
          <span>{title || "並排"}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="note-split-pane">
      <div className="note-split-head">
        <Link href={`/notes/${noteId}`} className="note-split-title" title="設為主要分頁">
          {normalizePageIcon(icon) ? (
            <PageChromeIcon icon={icon} fallback="description" className="note-split-title-icon" />
          ) : null}
          <span className="note-split-title-text">{title || "未命名"}</span>
        </Link>
        <span className="note-split-status">
          {status === "saving"
            ? "儲存中"
            : status === "saved"
              ? "已存"
              : status === "offline"
                ? "離線已存"
                : status === "dirty"
                  ? "未存"
                  : ""}
        </span>
        <button
          type="button"
          className="note-split-swap"
          title="與左側對調"
          onClick={() => tabs?.activate(noteId)}
        >
          ⇄
        </button>
        <button
          type="button"
          className="note-split-collapse"
          title="收合右側並排（仍保留並排）"
          onClick={() => onCollapse?.()}
        >
          ⟩
        </button>
        <button
          type="button"
          className="note-split-close"
          title="關閉並排"
          aria-label="關閉並排"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }}
        >
          ×
        </button>
      </div>
      {error ? (
        <p className="note-split-error">{error}</p>
      ) : !ready ? (
        <PageLoading fill={false} />
      ) : (
        <>
          <input
            className="note-split-title-input"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              markDirty();
            }}
            placeholder="標題"
          />
          <div className="note-split-editor">
            <RichNoteEditor
              key={noteId}
              valueMd={body}
              onChangeMd={(md) => {
                setBody(md);
                markDirty();
              }}
              noteId={noteId}
              placeholder="並排編輯…"
            />
          </div>
        </>
      )}
    </div>
  );
}
