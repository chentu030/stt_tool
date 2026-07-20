"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

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
  variant?: "pill" | "soft" | "ghost" | "toolbar";
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** Optional prefix shown before the current label (e.g. 行距) */
  prefix?: ReactNode;
  /** Open menu upward (useful near bottom of viewport) */
  placement?: "bottom" | "top";
};

export default function MenuSelect<T extends string>({
  value,
  options,
  onChange,
  variant = "pill",
  size = "md",
  className = "",
  ariaLabel = "選擇",
  disabled = false,
  prefix,
  placement = "bottom",
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
      className={`menu-select menu-select--${variant} menu-select--${size}${open ? " is-open" : ""}${
        disabled ? " is-disabled" : ""
      } ${className}`.trim()}
      ref={rootRef}
    >
      <button
        type="button"
        className="menu-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
      >
        {prefix != null && prefix !== "" && (
          <span className="menu-select-prefix">{prefix}</span>
        )}
        {current?.color && (
          <span className="menu-select-dot" style={{ background: current.color }} />
        )}
        <span className="menu-select-label">{current?.label ?? value}</span>
        <span className="menu-select-caret" aria-hidden>
          ▾
        </span>
      </button>

      {open && !disabled && (
        <ul
          id={listId}
          className={`menu-select-menu menu-select-menu--${placement}`}
          role="listbox"
          aria-label={ariaLabel}
        >
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <li key={opt.value} role="option" aria-selected={active}>
                <button
                  type="button"
                  className={`menu-select-option${active ? " is-active" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
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
