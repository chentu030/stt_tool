"use client";

import { useCallback, useEffect, useState } from "react";
import ColorEyedropperTools from "@/components/ColorEyedropperTools";
import {
  isHostUtilityEnabled,
  loadColorSwatchHidden,
  loadColorSwatchOpen,
  saveColorSwatchHidden,
  saveColorSwatchOpen,
  setHostUtilityEnabled,
} from "@/lib/hostUtilities";

type Props = {
  /** Optional: apply sampled hex into a host color field */
  onApply?: (hex: string) => void;
};

/**
 * Floating 色票工具 on note pages — host built-in utility（擴充功能）.
 */
export default function ColorSwatchUtility({ onApply }: Props) {
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [sample, setSample] = useState("#0d9488");

  useEffect(() => {
    const sync = () => {
      setEnabled(isHostUtilityEnabled("color-eyedropper"));
      setOpen(loadColorSwatchOpen());
      setHidden(loadColorSwatchHidden());
      setReady(true);
    };
    sync();
    const onUtil = (ev: Event) => {
      const detail = (ev as CustomEvent<{ id?: string }>).detail;
      if (!detail?.id || detail.id === "color-eyedropper") sync();
    };
    window.addEventListener("albireus:utility-enabled", onUtil as EventListener);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("albireus:utility-enabled", onUtil as EventListener);
      window.removeEventListener("storage", sync);
    };
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
    /* Match dismiss hint: re-enable from 社群商店 → 擴充功能 */
    setHostUtilityEnabled("color-eyedropper", false);
    setEnabled(false);
  }, [setOpenPref]);

  /* Hidden = fully gone (no corner restore chip — that sat on the AI send button).
   * Re-show from 社群商店 → 擴充功能. */
  if (!ready || !enabled || hidden) return null;

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
          title="隱藏色票（可在社群商店 → 擴充功能 重新啟用）"
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
