"use client";

import type { DragEvent, ReactNode } from "react";
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

export type PropReorderHandlers = {
  reorderId: string;
  dragging: boolean;
  dragOver: boolean;
  onDragStart: (id: string, e: DragEvent) => void;
  onDragOver: (id: string, e: DragEvent) => void;
  onDrop: (id: string, e: DragEvent) => void;
  onDragEnd: () => void;
};

type RowProps = {
  label: string;
  type?: DbPropType | string;
  /** Material Symbols ligature; overrides type mapping when set */
  icon?: string;
  menu?: ReactNode;
  system?: boolean;
  children: ReactNode;
  /** When set, row is drag-reorderable via the grip handle. */
  reorder?: PropReorderHandlers | null;
};

/** Single property cell: icon + label (+ optional menu) | value. */
export function NotePropsFieldRow({
  label,
  type,
  icon,
  menu,
  system,
  children,
  reorder,
}: RowProps) {
  const glyph = icon ?? (type ? propTypeIcon(type) : "label");
  const canReorder = !!reorder;
  return (
    <div
      className={`nk-prop-row${system ? " nk-prop-row--system" : ""}${
        canReorder && reorder.dragging ? " is-dragging" : ""
      }${canReorder && reorder.dragOver ? " is-drag-over" : ""}`}
      data-prop-id={canReorder ? reorder.reorderId : undefined}
      onDragOver={
        canReorder
          ? (e) => {
              e.preventDefault();
              reorder.onDragOver(reorder.reorderId, e);
            }
          : undefined
      }
      onDrop={
        canReorder
          ? (e) => {
              e.preventDefault();
              reorder.onDrop(reorder.reorderId, e);
            }
          : undefined
      }
    >
      <div className="nk-prop-row-key">
        {/* Always reserve drag-handle width so icons align across meta + movable rows */}
        <div className="nk-prop-drag-slot">
          {canReorder ? (
            <button
              type="button"
              className="nk-prop-drag-handle"
              draggable
              title="拖曳調整順序"
              aria-label={`拖曳調整「${label}」順序`}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", reorder.reorderId);
                e.dataTransfer.effectAllowed = "move";
                reorder.onDragStart(reorder.reorderId, e);
              }}
              onDragEnd={() => reorder.onDragEnd()}
            >
              <span className="material-symbols-outlined" aria-hidden>
                drag_indicator
              </span>
            </button>
          ) : null}
        </div>
        <span className="material-symbols-outlined nk-prop-icon" aria-hidden>
          {glyph}
        </span>
        <span className="nk-prop-name" title={label}>
          {label}
        </span>
        {/* Always reserve menu slot so icons/labels share one vertical axis */}
        <div className="nk-prop-menu-slot">{menu || null}</div>
      </div>
      <div className="nk-prop-row-val">{children}</div>
    </div>
  );
}
