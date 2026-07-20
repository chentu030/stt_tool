"use client";

import { useCallback, useEffect, useState } from "react";
import ColorEyedropperTools from "@/components/ColorEyedropperTools";
import {
  loadColorSwatchOpen,
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
  const [open, setOpen] = useState(false);
  const [sample, setSample] = useState("#0d9488");

  useEffect(() => {
    setOpen(loadColorSwatchOpen());
  }, []);

  const toggle = useCallback(() => {
    setOpen((v) => {
      const next = !v;
      saveColorSwatchOpen(next);
      return next;
    });
  }, []);

  return (
    <div className="ced-float" data-utility="color-eyedropper">
      {open && (
        <ColorEyedropperTools
          variant="panel"
          color={sample}
          onSample={(hex) => {
            setSample(hex);
            onApply?.(hex);
          }}
        />
      )}
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
    </div>
  );
}
