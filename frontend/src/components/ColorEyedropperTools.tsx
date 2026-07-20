"use client";

import { useCallback, useState } from "react";
import {
  copyText,
  formatRgbCss,
  hexToRgb,
  isEyeDropperSupported,
  normalizeHexColor,
  pickScreenColor,
  type SampledColor,
  toSampledColor,
} from "@/lib/colorPick";
import { toast } from "@/lib/toast";

type Props = {
  /** Current color to display (hex). Falls back to last sample. */
  color?: string;
  /** Called when a color is sampled (or user wants to apply sample). */
  onSample?: (hex: string) => void;
  /** compact = picker toolbar; panel = floating 色票工具 */
  variant?: "compact" | "panel";
  className?: string;
};

export default function ColorEyedropperTools({
  color,
  onSample,
  variant = "compact",
  className = "",
}: Props) {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<SampledColor | null>(null);
  const supported = isEyeDropperSupported();

  const display =
    toSampledColor(color || "") ||
    last ||
    toSampledColor("#64748b")!;

  const sample = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    const result = await pickScreenColor();
    setBusy(false);
    if (!result.ok) {
      if (result.reason !== "aborted") toast(result.message);
      return;
    }
    setLast(result.color);
    onSample?.(result.color.hex);
    toast("已吸取顏色");
  }, [busy, onSample]);

  const copyValue = useCallback(async (label: string, value: string) => {
    const ok = await copyText(value);
    toast(ok ? `已複製 ${label}` : "複製失敗");
  }, []);

  if (variant === "panel") {
    const rgb = display.rgb;
    return (
      <div className={`ced-panel ${className}`.trim()} role="region" aria-label="色票工具">
        <div className="ced-panel-head">
          <span className="material-symbols-outlined ced-icon" aria-hidden>
            colorize
          </span>
          <div>
            <p className="ced-title">色票工具</p>
            <p className="ced-sub">一般擴充功能 · 吸取螢幕顏色</p>
          </div>
        </div>
        <div className="ced-swatch-row">
          <span
            className="ced-swatch ced-swatch--lg"
            style={{ background: display.hex }}
            title={display.hex}
          />
          <div className="ced-values">
            <code className="ced-code">{formatRgbCss(rgb)}</code>
            <code className="ced-code">{display.hex.toUpperCase()}</code>
          </div>
        </div>
        <div className="ced-actions">
          <button
            type="button"
            className="btn btn-sm btn-soft"
            disabled={busy}
            title={supported ? "吸取螢幕上的顏色" : "此瀏覽器不支援 EyeDropper"}
            onClick={() => void sample()}
          >
            <span className="material-symbols-outlined" aria-hidden>
              colorize
            </span>
            {busy ? "吸取中…" : "吸取顏色"}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => void copyValue("RGB", formatRgbCss(rgb))}
          >
            複製 RGB
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => void copyValue("Hex", display.hex.toUpperCase())}
          >
            複製 Hex
          </button>
        </div>
        {!supported && (
          <p className="ced-warn">
            此瀏覽器無法吸取螢幕像素。請改用 Chrome 或 Edge，或手動輸入 Hex／RGB。
          </p>
        )}
      </div>
    );
  }

  const rgb = color ? hexToRgb(normalizeHexColor(color) || color) : display.rgb;
  const hex = normalizeHexColor(color || display.hex) || display.hex;

  return (
    <div className={`ced-bar ${className}`.trim()}>
      <button
        type="button"
        className="btn btn-sm btn-soft ced-pick"
        disabled={busy}
        title={supported ? "吸取螢幕上的顏色" : "此瀏覽器不支援 EyeDropper"}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => void sample()}
      >
        <span className="material-symbols-outlined" aria-hidden>
          colorize
        </span>
        {busy ? "吸取中…" : "吸取顏色"}
      </button>
      <span className="ced-swatch" style={{ background: hex }} title={hex} />
      <button
        type="button"
        className="ced-copy"
        title="複製 RGB"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => void copyValue("RGB", formatRgbCss(rgb))}
      >
        {formatRgbCss(rgb)}
      </button>
      <button
        type="button"
        className="ced-copy"
        title="複製 Hex"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => void copyValue("Hex", hex.toUpperCase())}
      >
        {hex.toUpperCase()}
      </button>
    </div>
  );
}
