"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { HexColorPicker } from "react-colorful";
import {
  FOLDER_ICONS,
  PAGE_COLOR_HEX_PRESETS,
  PAGE_ICONS,
  normalizeHexColor,
  normalizePageColor,
  normalizePageIcon,
  pageColorMeta,
} from "@/lib/pageChrome";
import PageChromeIcon from "@/components/PageChromeIcon";
import ColorEyedropperTools from "@/components/ColorEyedropperTools";

type Props = {
  mode: "note" | "folder";
  icon: string;
  /** Preset id or #rrggbb */
  color: string;
  onChange: (next: { icon: string; color: string }) => void;
  onClose: () => void;
  /** fixed position (context menu); omit for inline popover */
  x?: number;
  y?: number;
  className?: string;
};

const CUSTOMS_KEY = "cadence_page_color_customs";

function loadCustoms(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CUSTOMS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => (typeof x === "string" ? normalizeHexColor(x) : null))
      .filter((x): x is string => !!x)
      .filter((c, i, arr) => arr.indexOf(c) === i)
      .slice(0, 16);
  } catch {
    return [];
  }
}

function saveCustoms(list: string[]) {
  try {
    localStorage.setItem(CUSTOMS_KEY, JSON.stringify(list.slice(0, 16)));
  } catch {
    /* ignore */
  }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = normalizeHexColor(hex) || "#64748b";
  return {
    r: parseInt(n.slice(1, 3), 16),
    g: parseInt(n.slice(3, 5), 16),
    b: parseInt(n.slice(5, 7), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.min(255, Math.max(0, n | 0)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Resolve stored preset id / hex → display hex for the wheel. */
function storedToHex(stored: string): string {
  if (!stored) return "#64748b";
  const hex = normalizeHexColor(stored);
  if (hex) return hex;
  const fg = pageColorMeta(stored).fg;
  return normalizeHexColor(fg) || "#64748b";
}

export default function IconColorPicker({
  mode,
  icon,
  color,
  onChange,
  onClose,
  x,
  y,
  className = "",
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const icons = mode === "folder" ? FOLDER_ICONS : PAGE_ICONS;
  const fixed = typeof x === "number" && typeof y === "number";
  const current = normalizePageIcon(icon);
  const stored = normalizePageColor(color);
  const activeHex = storedToHex(stored);
  const storedHex = normalizeHexColor(stored) || (stored ? activeHex : "");

  const [draft, setDraft] = useState(activeHex);
  const [customs, setCustoms] = useState<string[]>(() => loadCustoms());

  useEffect(() => {
    setDraft(activeHex);
  }, [activeHex]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const rgb = useMemo(() => hexToRgb(draft), [draft]);
  const normalizedDraft = normalizeHexColor(draft) || draft;
  const canAdd =
    !!normalizeHexColor(draft) &&
    !PAGE_COLOR_HEX_PRESETS.includes(normalizeHexColor(draft)!) &&
    !customs.includes(normalizeHexColor(draft)!);

  const pickColor = (next: string) => {
    const c = normalizePageColor(next);
    onChange({ icon: current, color: c });
  };

  const applyDraft = () => {
    const hex = normalizeHexColor(draft);
    if (hex) pickColor(hex);
  };

  const addCustom = () => {
    const hex = normalizeHexColor(draft);
    if (!hex || !canAdd) return;
    const next = [hex, ...customs.filter((c) => c !== hex)].slice(0, 16);
    setCustoms(next);
    saveCustoms(next);
    pickColor(hex);
  };

  const removeCustom = (c: string) => {
    const next = customs.filter((x) => x !== c);
    setCustoms(next);
    saveCustoms(next);
  };

  const tint = stored ? pageColorMeta(stored).fg : "var(--text-main)";

  return (
    <div
      ref={ref}
      className={`ic-picker ic-picker--rich${fixed ? " ic-picker--fixed" : ""} ${className}`.trim()}
      style={fixed ? { left: x, top: y } : undefined}
      role="dialog"
      aria-label="選擇圖示與顏色"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <p className="ic-picker-label">圖示</p>
      <div className="ic-picker-icons">
        <button
          type="button"
          className={!current ? "is-on" : undefined}
          title="無圖示"
          onClick={() => onChange({ icon: "", color: stored })}
        >
          <span className="ic-picker-none">無</span>
        </button>
        {icons.map((ic) => (
          <button
            key={ic}
            type="button"
            className={current === ic ? "is-on" : undefined}
            title={ic}
            style={{ color: tint }}
            onClick={() => onChange({ icon: ic, color: stored })}
          >
            <PageChromeIcon icon={ic} color={stored || undefined} />
          </button>
        ))}
      </div>

      <div className="hl-section ic-picker-custom">
        <p className="hl-section-label">預設</p>
        <div className="hl-presets">
          {PAGE_COLOR_HEX_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              className={`hl-preset${storedHex === c ? " is-on" : ""}`}
              style={{ background: c }}
              title={c}
              onClick={() => {
                setDraft(c);
                pickColor(c);
              }}
            />
          ))}
        </div>
      </div>

      <div className="hl-section">
        <div className="hl-section-head">
          <p className="hl-section-label">我的顏色</p>
          <button
            type="button"
            className="hl-add-btn"
            disabled={!canAdd}
            title={canAdd ? "把目前顏色加入常用" : "已在色盤中"}
            onClick={addCustom}
          >
            + 新增
          </button>
        </div>
        {customs.length === 0 ? (
          <p className="hl-empty">用下方色盤調色後按「+ 新增」</p>
        ) : (
          <div className="hl-presets hl-presets--custom">
            {customs.map((c) => (
              <div key={c} className="hl-custom-slot">
                <button
                  type="button"
                  className={`hl-preset${storedHex === c ? " is-on" : ""}`}
                  style={{ background: c }}
                  title={c}
                  onClick={() => {
                    setDraft(c);
                    pickColor(c);
                  }}
                />
                <button
                  type="button"
                  className="hl-remove"
                  title="移除"
                  onClick={() => removeCustom(c)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="hl-section">
        <p className="hl-section-label">色盤</p>
        <HexColorPicker
          color={normalizeHexColor(draft) || "#64748b"}
          onChange={(c) => {
            setDraft(c);
            pickColor(c);
          }}
          className="hl-wheel"
        />
      </div>

      <div className="hl-section">
        <p className="hl-section-label">吸取顏色</p>
        <ColorEyedropperTools
          color={normalizeHexColor(draft) || draft}
          onSample={(hex) => {
            setDraft(hex);
            pickColor(hex);
          }}
        />
      </div>

      <div className="hl-rgb">
        {(["r", "g", "b"] as const).map((ch) => (
          <label key={ch}>
            <span>{ch.toUpperCase()}</span>
            <input
              type="number"
              min={0}
              max={255}
              value={rgb[ch]}
              onChange={(e) => {
                const n = Math.min(255, Math.max(0, Number(e.target.value) || 0));
                const next = { ...rgb, [ch]: n };
                const hex = rgbToHex(next.r, next.g, next.b);
                setDraft(hex);
                pickColor(hex);
              }}
            />
          </label>
        ))}
      </div>
      <div className="hl-hex-row">
        <span>HEX</span>
        <input
          className="input"
          value={normalizedDraft}
          onChange={(e) => {
            const v = e.target.value.trim();
            setDraft(v);
            const hex = normalizeHexColor(v);
            if (hex) pickColor(hex);
          }}
        />
        <button type="button" className="btn btn-sm btn-soft" onClick={applyDraft}>
          套用
        </button>
      </div>
      <button
        type="button"
        className="btn btn-sm btn-ghost hl-clear"
        onClick={() => {
          setDraft("#64748b");
          pickColor("");
        }}
      >
        清除顏色
      </button>
      {current && (
        <p className="ic-picker-hint">顏色會套用到圖示與側欄標題</p>
      )}
    </div>
  );
}
