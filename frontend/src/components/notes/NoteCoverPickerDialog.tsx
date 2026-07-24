"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { uploadNoteMedia } from "@/lib/firebase";
import { listRecentCovers, pushRecentCover } from "@/lib/recentCovers";
import { toast } from "@/lib/toast";

type Props = {
  open: boolean;
  title?: string;
  currentCover?: string;
  userId?: string;
  noteId?: string;
  onClose: () => void;
  /** Apply cover URL (empty string removes). Caller should persist. */
  onApply: (url: string) => void;
};

export default function NoteCoverPickerDialog({
  open,
  title = "封面",
  currentCover = "",
  userId,
  noteId,
  onClose,
  onApply,
}: Props) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(currentCover || "");
  const [recents, setRecents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUrl(currentCover || "");
    setRecents(listRecentCovers(userId || ""));
    const t = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (!busy) onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, currentCover, userId, onClose, busy]);

  if (!open || typeof document === "undefined") return null;

  const rememberAndApply = (next: string) => {
    const trimmed = next.trim();
    if (trimmed && userId) setRecents(pushRecentCover(userId, trimmed));
    onApply(trimmed);
    onClose();
  };

  const submitUrl = (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || trimmed === "https://" || trimmed === "http://") {
      toast("請輸入有效的圖片網址");
      return;
    }
    rememberAndApply(trimmed);
  };

  const upload = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast("請選擇圖片檔");
      return;
    }
    if (!userId || !noteId) {
      toast("無法上傳：尚未登入");
      return;
    }
    setBusy(true);
    try {
      const { url: uploaded } = await uploadNoteMedia(userId, noteId, file);
      rememberAndApply(uploaded);
    } catch (err) {
      toast(err instanceof Error ? err.message : "上傳失敗");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="cadence-dialog-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="cadence-dialog cadence-dialog--cover"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="cadence-dialog-title">
          {title}
        </h2>
        <p className="cadence-dialog-msg">貼上網址、上傳圖片，或從最近使用的封面選取。</p>

        <form className="cadence-dialog-form" onSubmit={submitUrl}>
          <label className="cadence-dialog-field">
            <span>圖片網址</span>
            <input
              ref={inputRef}
              className="input cadence-dialog-input"
              type="url"
              inputMode="url"
              value={url}
              placeholder="https://"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>

          <div className="nk-cover-picker-upload">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy || !userId || !noteId}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? "上傳中…" : "上傳本機圖片"}
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                e.target.value = "";
                void upload(f);
              }}
            />
          </div>

          {recents.length > 0 ? (
            <div className="nk-cover-picker-recents">
              <span className="nk-cover-picker-recents-label">最近使用</span>
              <div className="nk-cover-picker-grid" role="list">
                {recents.map((u) => (
                  <button
                    key={u}
                    type="button"
                    role="listitem"
                    className={`nk-cover-picker-thumb${u === currentCover ? " is-current" : ""}`}
                    title="套用此封面"
                    disabled={busy}
                    style={{ backgroundImage: `url(${u})` }}
                    onClick={() => rememberAndApply(u)}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div className="cadence-dialog-actions">
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>
              取消
            </button>
            {currentCover ? (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => {
                  onApply("");
                  onClose();
                }}
              >
                移除封面
              </button>
            ) : null}
            <button type="submit" className="btn" disabled={busy}>
              套用網址
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
