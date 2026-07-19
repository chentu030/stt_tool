"use client";

import { useEffect, useId, useRef, useState } from "react";

export type MenuOption<T extends string = string> = {
  value: T;
  label: string;
  hint?: string;
  /** CSS color for the status dot */
  color?: string;
};

type Props<T extends string> = {
  value: T;
  options: MenuOption<T>[];
  onChange: (value: T) => void;
  /** Visual tone */
  variant?: "pill" | "soft" | "ghost";
  className?: string;
  ariaLabel?: string;
};

export default function MenuSelect<T extends string>({
  value,
  options,
  onChange,
  variant = "pill",
  className = "",
  ariaLabel = "選擇",
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value) || options[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      className={`menu-select menu-select--${variant}${open ? " is-open" : ""} ${className}`.trim()}
      ref={rootRef}
    >
      <button
        type="button"
        className="menu-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        {current?.color && (
          <span className="menu-select-dot" style={{ background: current.color }} />
        )}
        <span className="menu-select-label">{current?.label ?? value}</span>
        <span className="menu-select-caret" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <ul id={listId} className="menu-select-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <li key={opt.value} role="option" aria-selected={active}>
                <button
                  type="button"
                  className={`menu-select-option${active ? " is-active" : ""}`}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  {opt.color && (
                    <span className="menu-select-dot" style={{ background: opt.color }} />
                  )}
                  <span className="menu-select-option-text">
                    <strong>{opt.label}</strong>
                    {opt.hint && <em>{opt.hint}</em>}
                  </span>
                  {active && <span className="menu-select-check">✓</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export const NOTE_STATUS_OPTIONS: MenuOption<"backlog" | "doing" | "done">[] = [
  { value: "backlog", label: "待辦", hint: "還沒開始", color: "#94A3B8" },
  { value: "doing", label: "進行中", hint: "正在處理", color: "#0D9488" },
  { value: "done", label: "完成", hint: "已收尾", color: "#34D399" },
];

export function noteStatusLabel(status?: string | null) {
  if (status === "doing") return "進行中";
  if (status === "done") return "完成";
  if (status === "backlog" || !status) return "待辦";
  return status;
}
