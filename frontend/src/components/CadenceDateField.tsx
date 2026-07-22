"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Mode = "date" | "datetime";

type Props = {
  value: string;
  mode?: Mode;
  onChange: (next: string) => void;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
};

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseParts(value: string): { dateKey: string; time: string } {
  const raw = (value || "").trim();
  if (!raw) return { dateKey: "", time: "00:00" };
  // Accept YYYY-MM-DD, YYYY-MM-DDTHH:mm, or Date-parseable
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}):(\d{2}))?/.exec(raw);
  if (m) {
    return {
      dateKey: m[1],
      time: m[2] != null ? `${m[2]}:${m[3]}` : "00:00",
    };
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return { dateKey: "", time: "00:00" };
  return {
    dateKey: toDateKey(d),
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
  };
}

function formatDisplay(value: string, mode: Mode): string {
  const { dateKey, time } = parseParts(value);
  if (!dateKey) return "";
  const [y, mo, da] = dateKey.split("-").map(Number);
  const label = `${y}/${pad2(mo)}/${pad2(da)}`;
  if (mode === "datetime") return `${label} ${time}`;
  return label;
}

function buildMonthCells(year: number, month: number) {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay()); // Sunday start
  const cells: { dateKey: string; day: number; inMonth: boolean; isToday: boolean }[] = [];
  const todayKey = toDateKey(new Date());
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const dateKey = toDateKey(d);
    cells.push({
      dateKey,
      day: d.getDate(),
      inMonth: d.getMonth() === month,
      isToday: dateKey === todayKey,
    });
  }
  return cells;
}

/**
 * Custom date / datetime field — replaces native browser date picker.
 */
export default function CadenceDateField({
  value,
  mode = "date",
  onChange,
  className = "",
  placeholder = "選擇日期",
  ariaLabel = "日期",
}: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; place: "bottom" | "top" } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const parts = parseParts(value);
  const selectedKey = parts.dateKey;
  const [cursor, setCursor] = useState(() => {
    if (parts.dateKey) {
      const [y, m] = parts.dateKey.split("-").map(Number);
      return { year: y, month: m - 1 };
    }
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() };
  });
  const [time, setTime] = useState(parts.time);

  useEffect(() => {
    const p = parseParts(value);
    setTime(p.time);
    if (p.dateKey) {
      const [y, m] = p.dateKey.split("-").map(Number);
      setCursor({ year: y, month: m - 1 });
    }
  }, [value]);

  const cells = useMemo(
    () => buildMonthCells(cursor.year, cursor.month),
    [cursor.year, cursor.month]
  );

  const updatePos = () => {
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const panelH = panelRef.current?.offsetHeight || 320;
    const spaceBelow = window.innerHeight - r.bottom;
    const place: "bottom" | "top" =
      spaceBelow < panelH + 12 && r.top > spaceBelow ? "top" : "bottom";
    const top = place === "top" ? Math.max(8, r.top - panelH - 6) : r.bottom + 6;
    const width = 280;
    let left = r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    setPos({ top, left, place });
  };

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    updatePos();
  }, [open, cursor.year, cursor.month, mode]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScroll = () => updatePos();
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const commit = (dateKey: string, nextTime = time) => {
    if (!dateKey) {
      onChange("");
      return;
    }
    if (mode === "datetime") onChange(`${dateKey}T${nextTime || "00:00"}`);
    else onChange(dateKey);
  };

  const display = formatDisplay(value, mode) || placeholder;

  const panel =
    open && pos
      ? createPortal(
          <div
            ref={panelRef}
            className={`cdb-date-panel${pos.place === "top" ? " is-above" : ""}`}
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              zIndex: 10050,
            }}
            role="dialog"
            aria-label="選擇日期"
          >
            <div className="cdb-date-head">
              <strong>
                {cursor.year} 年 {cursor.month + 1} 月
              </strong>
              <div className="cdb-date-nav">
                <button
                  type="button"
                  className="cdb-date-nav-btn"
                  aria-label="上個月"
                  onClick={() =>
                    setCursor((c) => {
                      const d = new Date(c.year, c.month - 1, 1);
                      return { year: d.getFullYear(), month: d.getMonth() };
                    })
                  }
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="cdb-date-nav-btn"
                  aria-label="下個月"
                  onClick={() =>
                    setCursor((c) => {
                      const d = new Date(c.year, c.month + 1, 1);
                      return { year: d.getFullYear(), month: d.getMonth() };
                    })
                  }
                >
                  ›
                </button>
              </div>
            </div>
            <div className="cdb-date-weekdays">
              {WEEKDAYS.map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
            <div className="cdb-date-grid">
              {cells.map((c) => (
                <button
                  key={c.dateKey}
                  type="button"
                  className={[
                    "cdb-date-day",
                    c.inMonth ? "" : "is-out",
                    c.isToday ? "is-today" : "",
                    c.dateKey === selectedKey ? "is-selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => {
                    commit(c.dateKey, time);
                    if (mode === "date") setOpen(false);
                    else {
                      const [y, m] = c.dateKey.split("-").map(Number);
                      setCursor({ year: y, month: m - 1 });
                    }
                  }}
                >
                  {c.day}
                </button>
              ))}
            </div>
            {mode === "datetime" && (
              <div className="cdb-date-time">
                <label>
                  時間
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => {
                      const t = e.target.value || "00:00";
                      setTime(t);
                      if (selectedKey) commit(selectedKey, t);
                    }}
                  />
                </label>
              </div>
            )}
            <div className="cdb-date-foot">
              <button
                type="button"
                className="cdb-date-link"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                清除
              </button>
              <button
                type="button"
                className="cdb-date-link"
                onClick={() => {
                  const today = toDateKey(new Date());
                  const now = new Date();
                  const t = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
                  setTime(t);
                  commit(today, t);
                  setOpen(false);
                }}
              >
                今天
              </button>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div className={`cdb-date-field ${className}`.trim()} ref={rootRef}>
      <button
        type="button"
        className={`cdb-date-trigger${!value ? " is-empty" : ""}`}
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{display}</span>
        <span className="material-symbols-outlined cdb-date-ico" aria-hidden>
          calendar_month
        </span>
      </button>
      {panel}
    </div>
  );
}
