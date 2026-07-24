"use client";

import type { ReactNode } from "react";
import type { DbPropType } from "@/lib/database";

/** Type glyph for property rows — shared by DB-entry and note panels. */
export function propTypeIcon(type: DbPropType | string): string {
  const map: Record<string, string> = {
    text: "≡",
    number: "#",
    checkbox: "☑",
    date: "▦",
    datetime: "▦",
    select: "▾",
    multi_select: "≡",
    status: "●",
    tags: "#",
    url: "↗",
    email: "@",
    phone: "☎",
    files: "◫",
    person: "☺",
    relation: "↗",
    rollup: "Σ",
    formula: "ƒ",
    unique_id: "ID",
    created_time: "◷",
    last_edited_time: "◷",
    created_by: "☺",
    last_edited_by: "☺",
    title: "≡",
  };
  return map[type] || "·";
}

type GridProps = {
  children: ReactNode;
  "aria-label"?: string;
  className?: string;
};

/** Responsive 1 → 2 → 3 property field grid (CSS container queries). */
export function NotePropsFieldsGrid({ children, className, "aria-label": ariaLabel }: GridProps) {
  return (
    <div
      className={`nk-props-fields${className ? ` ${className}` : ""}`}
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
}

type RowProps = {
  label: string;
  type?: DbPropType | string;
  icon?: string;
  menu?: ReactNode;
  system?: boolean;
  children: ReactNode;
};

/** Single property cell: icon + label (+ optional menu) | value. */
export function NotePropsFieldRow({ label, type, icon, menu, system, children }: RowProps) {
  const glyph = icon ?? (type ? propTypeIcon(type) : "·");
  return (
    <div className={`nk-prop-row${system ? " nk-prop-row--system" : ""}`}>
      <div className="nk-prop-row-key">
        <span className="nk-prop-icon" aria-hidden>
          {glyph}
        </span>
        <span className="nk-prop-name" title={label}>
          {label}
        </span>
        {menu}
      </div>
      <div className="nk-prop-row-val">{children}</div>
    </div>
  );
}
