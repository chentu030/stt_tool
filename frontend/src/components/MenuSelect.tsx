"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

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

type MenuPos = { top: number; left: number; minWidth: number; placement: "bottom" | "top" };

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
  const [pos, setPos] = useState<MenuPos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value) || options[0];

  const updatePos = () => {
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const menuH = menuRef.current?.offsetHeight || Math.min(280, options.length * 44 + 16);
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    let place = placement;
    if (placement === "bottom" && spaceBelow < menuH + 12 && spaceAbove > spaceBelow) {
      place = "top";
    } else if (placement === "top" && spaceAbove < menuH + 12 && spaceBelow > spaceAbove) {
      place = "bottom";
    }
    const top = place === "top" ? r.top - 6 : r.bottom + 6;
    const minWidth = Math.max(r.width, 168);
    let left = r.left;
    const maxLeft = window.innerWidth - minWidth - 8;
    left = Math.max(8, Math.min(left, maxLeft));
    setPos({ top, left, minWidth, placement: place });
  };

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    updatePos();
  }, [open, options.length, placement]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onReposition = () => updatePos();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, options.length, placement]);

  const menu =
    open && !disabled && pos && typeof document !== "undefined"
      ? createPortal(
          <ul
            id={listId}
            ref={menuRef}
            className={`menu-select-menu menu-select-menu--portal menu-select-menu--${pos.placement}`}
            role="listbox"
            aria-label={ariaLabel}
            style={{
              position: "fixed",
              top: pos.placement === "top" ? undefined : pos.top,
              bottom: pos.placement === "top" ? window.innerHeight - pos.top : undefined,
              left: pos.left,
              minWidth: pos.minWidth,
              zIndex: 11000,
            }}
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
          </ul>,
          document.body
        )
      : null;

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
      {menu}
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
