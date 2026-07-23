"use client";

import { useState } from "react";
import {
  enableCanvasShare,
  setCanvasShareMode,
  disableCanvasShare,
  shareUrl,
  type CanvasShare,
  type CanvasShareMode,
} from "@/lib/canvasShare";
import type { CanvasDoc } from "@/lib/canvasStore";
import { toast } from "@/lib/toast";

type Props = {
  open: boolean;
  onClose: () => void;
  uid: string;
  canvasId: string;
  doc: CanvasDoc;
  share: CanvasShare | null;
  onShareChange: (share: CanvasShare | null) => void;
};

export default function CanvasShareDialog({
  open,
  onClose,
  uid,
  canvasId,
  doc,
  share,
  onShareChange,
}: Props) {
  const [busy, setBusy] = useState(false);
  if (!open) return null;

  const enabled = Boolean(share?.enabled && share.token);
  const mode: CanvasShareMode = share?.mode === "copy" ? "copy" : "view";
  const url = enabled && share ? shareUrl(share.token) : "";

  const turnOn = async (nextMode: CanvasShareMode) => {
    setBusy(true);
    try {
      const next = await enableCanvasShare(uid, canvasId, nextMode, share?.token, doc);
      onShareChange(next);
      toast("已開啟分享連結");
    } catch (e) {
      toast(e instanceof Error ? e.message : "無法開啟分享");
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      await disableCanvasShare(uid, canvasId, share?.token);
      onShareChange(null);
      toast("已關閉分享");
    } catch (e) {
      toast(e instanceof Error ? e.message : "無法關閉分享");
    } finally {
      setBusy(false);
    }
  };

  const changeMode = async (nextMode: CanvasShareMode) => {
    if (!share?.token) {
      await turnOn(nextMode);
      return;
    }
    setBusy(true);
    try {
      const next = await setCanvasShareMode(uid, canvasId, nextMode, share.token, doc);
      onShareChange(next);
    } catch (e) {
      toast(e instanceof Error ? e.message : "無法更新分享");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cadence-dialog-backdrop" role="presentation" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className="cadence-dialog" role="dialog" aria-modal="true" aria-label="分享白板">
        <h2 className="cadence-dialog-title">分享白板</h2>
        <p className="cadence-dialog-msg">
          目前支援「僅檢視」與「可複製」。多人同時編輯會在下一波共編完成後開放。
        </p>

        <div className="cadence-dialog-form">
          <label className="cadence-dialog-remember">
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy}
              onChange={(e) => {
                if (e.target.checked) void turnOn(mode);
                else void turnOff();
              }}
            />
            公開連結
          </label>

          <div className="jn-schedule-tabs" role="tablist" aria-label="分享模式">
            <button
              type="button"
              className={`jn-schedule-tab${mode === "view" ? " is-on" : ""}`}
              disabled={busy || !enabled}
              onClick={() => void changeMode("view")}
            >
              僅檢視
            </button>
            <button
              type="button"
              className={`jn-schedule-tab${mode === "copy" ? " is-on" : ""}`}
              disabled={busy || !enabled}
              onClick={() => void changeMode("copy")}
            >
              可複製
            </button>
          </div>

          {enabled && url && (
            <div className="cadence-dialog-input" style={{ display: "flex", gap: "0.35rem" }}>
              <input className="input" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  void navigator.clipboard.writeText(url).then(
                    () => toast("已複製連結"),
                    () => toast("無法複製")
                  );
                }}
              >
                複製
              </button>
            </div>
          )}
        </div>

        <div className="cadence-dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
