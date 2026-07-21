"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as REPointerEvent } from "react";
import {
  loadNoteSplitLayout,
  pctFromPointer,
  saveNoteSplitLayout,
  type NoteSplitLayout,
  type SplitCollapse,
} from "@/lib/noteSplitLayout";

type Props = {
  layout: NoteSplitLayout;
  onChange: (next: NoteSplitLayout) => void;
};

/** Drag handle between primary note and split pane; edge-drag collapses a side. */
export default function NoteSplitResizer({ layout, onChange }: Props) {
  const dragging = useRef(false);
  const stackRef = useRef<HTMLElement | null>(null);

  const bindStack = useCallback((el: HTMLDivElement | null) => {
    stackRef.current = el?.closest(".doc-main-stack") as HTMLElement | null;
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      const stack = stackRef.current;
      if (!stack) return;
      const rect = stack.getBoundingClientRect();
      onChange(pctFromPointer(e.clientX, rect));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.classList.remove("is-split-resizing");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [onChange]);

  const onPointerDown = (e: REPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragging.current = true;
    document.body.classList.add("is-split-resizing");
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const stack = (e.currentTarget.closest(".doc-main-stack") as HTMLElement) || stackRef.current;
    stackRef.current = stack;
    if (stack) onChange(pctFromPointer(e.clientX, stack.getBoundingClientRect()));
  };

  const expand = (side: SplitCollapse) => {
    if (layout.collapse !== side) return;
    onChange({ ...layout, collapse: "none" });
  };

  const reset = () => onChange({ leftPct: 50, collapse: "none" });

  return (
    <div
      ref={bindStack}
      className={`note-split-resizer${layout.collapse !== "none" ? ` is-collapse-${layout.collapse}` : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="調整並排寬度（拖到邊緣可暫時收合）"
      aria-valuenow={Math.round(layout.leftPct)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={reset}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          if (layout.collapse === "right") onChange({ ...layout, collapse: "none" });
          else if (layout.leftPct <= 16) onChange({ ...layout, collapse: "left" });
          else onChange({ ...layout, leftPct: Math.max(12, layout.leftPct - 4), collapse: "none" });
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          if (layout.collapse === "left") onChange({ ...layout, collapse: "none" });
          else if (layout.leftPct >= 84) onChange({ ...layout, collapse: "right" });
          else onChange({ ...layout, leftPct: Math.min(88, layout.leftPct + 4), collapse: "none" });
        } else if (e.key === "Home") {
          e.preventDefault();
          reset();
        }
      }}
    >
      {layout.collapse === "left" && (
        <button
          type="button"
          className="note-split-rail-btn"
          title="展開左側"
          aria-label="展開左側"
          onClick={(e) => {
            e.stopPropagation();
            expand("left");
          }}
        >
          ›
        </button>
      )}
      {layout.collapse === "right" && (
        <button
          type="button"
          className="note-split-rail-btn"
          title="展開右側"
          aria-label="展開右側"
          onClick={(e) => {
            e.stopPropagation();
            expand("right");
          }}
        >
          ‹
        </button>
      )}
    </div>
  );
}

export function useNoteSplitLayout() {
  const [layout, setLayout] = useState<NoteSplitLayout>(() => loadNoteSplitLayout());

  const setAndSave = useCallback((next: NoteSplitLayout | ((prev: NoteSplitLayout) => NoteSplitLayout)) => {
    setLayout((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      saveNoteSplitLayout(resolved);
      return resolved;
    });
  }, []);

  return [layout, setAndSave] as const;
}
