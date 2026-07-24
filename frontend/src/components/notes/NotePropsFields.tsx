"use client";

import type { ReactNode } from "react";
import type { DbPropType } from "@/lib/database";

/** Material Symbols name for a property type — shared by DB-entry and note panels. */
export function propTypeIcon(type: DbPropType | string): string {
  const map: Record<string, string> = {
    text: "notes",
    number: "tag",
    checkbox: "check_box",
    date: "event",
    datetime: "schedule",
    select: "arrow_drop_down_circle",
    multi_select: "list",
    status: "flag",
    tags: "sell",
    url: "link",
    email: "mail",
    phone: "call",
    files: "attach_file",
    person: "person",
    relation: "hub",
    rollup: "functions",
    formula: "calculate",
    unique_id: "pin",
    created_time: "schedule",
    last_edited_time: "update",
    created_by: "person",
    last_edited_by: "person",
    title: "title",
  };
  return map[type] || "label";
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
  /** Material Symbols ligature; overrides type mapping when set */
  icon?: string;
  menu?: ReactNode;
  system?: boolean;
  children: ReactNode;
};

/** Single property cell: icon + label (+ optional menu) | value. */
export function NotePropsFieldRow({ label, type, icon, menu, system, children }: RowProps) {
  const glyph = icon ?? (type ? propTypeIcon(type) : "label");
  return (
    <div className={`nk-prop-row${system ? " nk-prop-row--system" : ""}`}>
      <div className="nk-prop-row-key">
        <span className="material-symbols-outlined nk-prop-icon" aria-hidden>
          {glyph}
        </span>
        <span className="nk-prop-name" title={label}>
          {label}
        </span>
        {menu ? <div className="nk-prop-menu-slot">{menu}</div> : null}
      </div>
      <div className="nk-prop-row-val">{children}</div>
    </div>
  );
}
