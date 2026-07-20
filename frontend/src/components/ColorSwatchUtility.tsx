"use client";

import { useCallback, useEffect, useState } from "react";
import ColorEyedropperTools from "@/components/ColorEyedropperTools";
import {
  loadColorSwatchHidden,
  loadColorSwatchOpen,
  saveColorSwatchHidden,
  saveColorSwatchOpen,
} from "@/lib/hostUtilities";

type Props = {
  /** Optional: apply sampled hex into a host color field */
  onApply?: (hex: string) => void;
};

/**
 * Floating 色票工具 on note pages — host built-in utility (not an iframe extension).
 */
export default function ColorSwatchUtility({ onApply }: Props) {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [sample, setSample] = useState("#0d9488");

  useEffect(() => {
    setOpen(loadColorSwatchOpen());
    setHidden(loadColorSwatchHidden());
    setReady(true);
  }, []);

  const setOpenPref = useCallback((next: boolean) => {
    setOpen(next);
    saveColorSwatchOpen(next);
  }, []);

  const toggle = useCallback(() => {
    setOpenPref(!open);
  }, [open, setOpenPref]);

  const dismissPanel = useCallback(() => {
    setOpenPref(false);
  }, [setOpenPref]);

  const dismissChip = useCallback(() => {
    setOpenPref(false);
    setHidden(true);
    saveColorSwatchHidden(true);
  }, [setOpenPref]);

  const restoreChip = useCallback(() => {
    setHidden(false);
    saveColorSwatchHidden(false);
    setOpenPref(true);
  }, [setOpenPref]);

  if (!ready) return null;

  if (hidden) {
    return (
      <div className="ced-float ced-float--hidden" data-utility="color-eyedropper">
        <button
          type="button"
          className="ced-float-restore"
          title="重新顯示色票工具"
          aria-label="重新顯示色票工具"
          onClick={restoreChip}
        >
          <span className="material-symbols-outlined" aria-hidden>
            palette
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="ced-float" data-utility="color-eyedropper">
      {open && (
        <ColorEyedropperTools
          variant="panel"
          color={sample}
          onClose={dismissPanel}
          onSample={(hex) => {
            setSample(hex);
            onApply?.(hex);
          }}
        />
      )}
      <div className="ced-float-actions">
        <button
          type="button"
          className={`ced-float-toggle${open ? " is-on" : ""}`}
          title={open ? "收起色票工具" : "開啟色票工具"}
          aria-expanded={open}
          aria-label="色票工具"
          onClick={toggle}
        >
          <span className="material-symbols-outlined" aria-hidden>
            palette
          </span>
          <span className="ced-float-label">色票</span>
        </button>
        <button
          type="button"
          className="ced-float-dismiss"
          title="隱藏色票按鈕（可稍後從角落小圖示還原）"
          aria-label="隱藏色票"
          onClick={dismissChip}
        >
          <span className="material-symbols-outlined" aria-hidden>
            close
          </span>
        </button>
      </div>
    </div>
  );
}
