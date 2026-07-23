"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createScheduleEvent,
  formatClock,
  listenScheduleEventsForDates,
  type ScheduleEvent,
} from "@/lib/scheduleEvents";
import {
  dateKeyFromDate,
  monthDateKeys,
  parseDateKey,
} from "@/lib/journalMeta";
import { askPrompt } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import ScheduleEventEditDialog from "@/components/journal/ScheduleEventEditDialog";

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

type Props = {
  uid: string;
  dateKey: string;
  selectedEventId?: string | null;
  overlays?: ScheduleEvent[];
  onSelectDay?: (dateKey: string) => void;
  onSelectEvent?: (ev: ScheduleEvent | null) => void;
};

function buildMonthCells(dateKey: string) {
  const d = parseDateKey(dateKey);
  if (!d) return [] as { dateKey: string; inMonth: boolean }[];
  const y = d.getFullYear();
  const m = d.getMonth();
  const first = new Date(y, m, 1);
  const startPad = (first.getDay() + 6) % 7; // Mon=0
  const start = new Date(y, m, 1 - startPad);
  return Array.from({ length: 42 }, (_, i) => {
    const x = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = dateKeyFromDate(x);
    return { dateKey: key, inMonth: x.getMonth() === m };
  });
}

export default function JournalMonthBoard({
  uid,
  dateKey,
  selectedEventId,
  overlays = [],
  onSelectDay,
  onSelectEvent,
}: Props) {
  const monthKeys = useMemo(() => monthDateKeys(dateKey), [dateKey]);
  const listenKeys = useMemo(() => {
    const cells = buildMonthCells(dateKey);
    return [...new Set(cells.map((c) => c.dateKey))];
  }, [dateKey]);
  const [localEvents, setLocalEvents] = useState<ScheduleEvent[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [editingEvent, setEditingEvent] = useState<ScheduleEvent | null>(null);
  const todayKey = dateKeyFromDate(new Date());
  const monthLabel = useMemo(() => {
    const d = parseDateKey(dateKey);
    if (!d) return dateKey;
    return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
  }, [dateKey]);

  useEffect(() => {
    return listenScheduleEventsForDates(uid, listenKeys, setLocalEvents, (e) =>
      toast(e.message || "行程同步失敗")
    );
  }, [uid, listenKeys]);

  const merged = useMemo(() => {
    const map = new Map<string, ScheduleEvent>();
    for (const e of localEvents) map.set(e.id, e);
    for (const e of overlays) map.set(e.id, e);
    return [...map.values()];
  }, [localEvents, overlays]);

  const byDay = useMemo(() => {
    const m = new Map<string, ScheduleEvent[]>();
    for (const e of merged) {
      const list = m.get(e.dateKey) || [];
      list.push(e);
      m.set(e.dateKey, list);
    }
    for (const list of m.values()) {
      list.sort(
        (a, b) =>
          Number(Boolean(b.allDay)) - Number(Boolean(a.allDay)) ||
          a.startMin - b.startMin ||
          a.title.localeCompare(b.title)
      );
    }
    return m;
  }, [merged]);

  const cells = useMemo(() => buildMonthCells(dateKey), [dateKey]);

  const shiftMonth = (delta: number) => {
    const d = parseDateKey(dateKey);
    if (!d) return;
    const next = new Date(d.getFullYear(), d.getMonth() + delta, 1);
    onSelectDay?.(dateKeyFromDate(next));
  };

  const addImportant = async (dk: string) => {
    if (!editMode) return;
    try {
      const t = await askPrompt({
        title: "重要事項",
        defaultValue: "",
        placeholder: "例如：交報告、家人聚餐…",
      });
      if (t == null) return;
      const id = await createScheduleEvent(uid, {
        dateKey: dk,
        startMin: 0,
        endMin: 24 * 60,
        allDay: true,
        title: t.trim() || "重要事項",
      });
      onSelectDay?.(dk);
      onSelectEvent?.({
        id,
        dateKey: dk,
        startMin: 0,
        endMin: 24 * 60,
        allDay: true,
        title: t.trim() || "重要事項",
        provider: "local",
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : "新增失敗");
    }
  };

  return (
    <div className={`jn-month${editMode ? " is-editing" : ""}`}>
      <div className="jn-month-head">
        <div className="jn-month-head-left">
          <button type="button" className="jn-icon-btn" onClick={() => shiftMonth(-1)} aria-label="上一月">
            ‹
          </button>
          <h3>{monthLabel} · 重要事項</h3>
          <button type="button" className="jn-icon-btn" onClick={() => shiftMonth(1)} aria-label="下一月">
            ›
          </button>
        </div>
        <div className="jn-month-head-actions">
          {!monthKeys.includes(todayKey) && (
            <button type="button" className="jn-text-btn" onClick={() => onSelectDay?.(todayKey)}>
              本月今天
            </button>
          )}
          <button
            type="button"
            className={`btn btn-sm${editMode ? "" : " btn-soft"}`}
            onClick={() => setEditMode((v) => !v)}
          >
            {editMode ? "完成編輯" : "編輯事項"}
          </button>
        </div>
      </div>

      <div className="jn-month-weekdays">
        {WEEKDAY_LABELS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      <div className="jn-month-grid">
        {cells.map((cell) => {
          const events = byDay.get(cell.dateKey) || [];
          const important = events.filter((e) => e.allDay);
          const timed = events.filter((e) => !e.allDay);
          const isToday = cell.dateKey === todayKey;
          const isSel = cell.dateKey === dateKey;
          const dayNum = parseDateKey(cell.dateKey)?.getDate() ?? cell.dateKey.slice(8);
          return (
            <div
              key={cell.dateKey}
              className={`jn-month-cell${cell.inMonth ? "" : " is-out"}${isToday ? " is-today" : ""}${isSel ? " is-sel" : ""}`}
              onClick={() => onSelectDay?.(cell.dateKey)}
              onDoubleClick={() => {
                if (editMode && cell.inMonth) void addImportant(cell.dateKey);
              }}
            >
              <div className="jn-month-cell-top">
                <strong>{dayNum}</strong>
                {editMode && cell.inMonth && (
                  <button
                    type="button"
                    className="jn-text-btn"
                    title="新增重要事項"
                    onClick={(e) => {
                      e.stopPropagation();
                      void addImportant(cell.dateKey);
                    }}
                  >
                    ＋
                  </button>
                )}
              </div>
              <div className="jn-month-cell-items">
                {important.map((ev) => (
                  <button
                    key={ev.id}
                    type="button"
                    className={`jn-month-chip is-important${selectedEventId === ev.id ? " is-on" : ""}${ev.provider !== "local" ? " is-sync" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectDay?.(cell.dateKey);
                      onSelectEvent?.(ev);
                      setEditingEvent(ev);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onSelectDay?.(cell.dateKey);
                      onSelectEvent?.(ev);
                      setEditingEvent(ev);
                    }}
                  >
                    {ev.title}
                  </button>
                ))}
                {timed.slice(0, 3).map((ev) => (
                  <button
                    key={ev.id}
                    type="button"
                    className={`jn-month-chip${selectedEventId === ev.id ? " is-on" : ""}${ev.provider !== "local" ? " is-sync" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectDay?.(cell.dateKey);
                      onSelectEvent?.(ev);
                      setEditingEvent(ev);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setEditingEvent(ev);
                    }}
                    title={`${formatClock(ev.startMin)} ${ev.title}`}
                  >
                    <em>{formatClock(ev.startMin)}</em> {ev.title}
                  </button>
                ))}
                {timed.length > 3 && (
                  <span className="jn-month-more">+{timed.length - 3}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="jn-tl-hint">
        {editMode
          ? "編輯中：點格子 ＋ 或雙擊新增重要事項（與週時間軸同步）。"
          : "點日期會同步週視圖；右鍵／點事項可編輯。按「編輯事項」後可新增。"}
      </p>

      {editingEvent && (
        <ScheduleEventEditDialog
          uid={uid}
          event={editingEvent}
          onClose={() => setEditingEvent(null)}
          onSaved={() => setEditingEvent(null)}
          onDeleted={() => {
            if (selectedEventId === editingEvent.id) onSelectEvent?.(null);
            setEditingEvent(null);
          }}
        />
      )}
    </div>
  );
}
