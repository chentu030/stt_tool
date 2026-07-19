"use client";

import { useEffect, useState } from "react";
import {
  disableNoteShare,
  enableNoteShare,
  setNoteShareMode,
  shareUrl,
  type NoteShare,
  type ShareMode,
} from "@/lib/share";

type Props = {
  open: boolean;
  onClose: () => void;
  noteId: string;
  ownerId: string;
  share: NoteShare | null | undefined;
  onUpdated: (share: NoteShare | null) => void;
};

const MODES: { id: ShareMode; label: string; hint: string }[] = [
  { id: "view", label: "僅檢視", hint: "任何人持連結可唯讀開啟" },
  { id: "edit", label: "可編輯", hint: "登入者可共同編輯內容（不可改擁有權）" },
  { id: "copy", label: "可複製", hint: "可開啟並複製成自己的筆記" },
];

export default function ShareDialog({
  open,
  onClose,
  noteId,
  ownerId,
  share,
  onUpdated,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<ShareMode>(share?.mode || "view");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setMode(share?.mode || "view");
      setError("");
      setCopied(false);
    }
  }, [open, share]);

  if (!open) return null;

  const enabled = !!share?.enabled && !!share.token;
  const url = enabled ? shareUrl(share!.token) : "";

  const enable = async () => {
    setBusy(true);
    setError("");
    try {
      const next = await enableNoteShare(noteId, ownerId, mode, share?.token);
      onUpdated(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const changeMode = async (m: ShareMode) => {
    setMode(m);
    if (!enabled || !share?.token) return;
    setBusy(true);
    setError("");
    try {
      const next = await setNoteShareMode(noteId, ownerId, m, share.token);
      onUpdated(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError("");
    try {
      await disableNoteShare(noteId, share?.token);
      onUpdated(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("無法複製連結");
    }
  };

  return (
    <div
      className="cadence-dialog-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cadence-dialog share-dialog" role="dialog" aria-modal="true">
        <h2 className="cadence-dialog-title">分享筆記</h2>
        <p className="cadence-dialog-msg">產生連結，讓其他人檢視、編輯或複製這則筆記。</p>

        <div className="share-mode-list" role="radiogroup" aria-label="分享權限">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`share-mode-item${mode === m.id ? " is-on" : ""}`}
              disabled={busy}
              onClick={() => void changeMode(m.id)}
            >
              <strong>{m.label}</strong>
              <span>{m.hint}</span>
            </button>
          ))}
        </div>

        {enabled ? (
          <div className="share-link-row">
            <input className="input" readOnly value={url} onFocus={(e) => e.target.select()} />
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void copyLink()}>
              {copied ? "已複製" : "複製連結"}
            </button>
          </div>
        ) : (
          <p className="share-off-hint">尚未開啟分享。選擇權限後按「開啟分享」。</p>
        )}

        {error && <p className="cadence-dialog-msg" style={{ color: "var(--danger)" }}>{error}</p>}

        <div className="cadence-dialog-actions">
          {enabled && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void disable()}>
              停止分享
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            關閉
          </button>
          {!enabled && (
            <button type="button" className="btn" disabled={busy} onClick={() => void enable()}>
              {busy ? "…" : "開啟分享"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
