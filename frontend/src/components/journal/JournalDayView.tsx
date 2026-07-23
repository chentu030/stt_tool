"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatClock,
  listenScheduleEvents,
  type ScheduleEvent,
} from "@/lib/scheduleEvents";
import {
  dateKeyFromDate,
  parseDateKey,
  shiftDateKey,
} from "@/lib/journalMeta";
import { toast } from "@/lib/toast";
import ScheduleEventEditDialog from "@/components/journal/ScheduleEventEditDialog";

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
const PX_PER_MIN = 1.15;
const PAD_MINS = 30;
const HOUR_START = 0;
const HOUR_END = 24;
const GRID_MINS = (HOUR_END - HOUR_START) * 60 + PAD_MINS * 2;

type Props = {
  uid: string;
  dateKey: string;
  selectedEventId?: string | null;
  overlays?: ScheduleEvent[];
  onSelectDay?: (dateKey: string) => void;
  onSelectEvent?: (ev: ScheduleEvent | null) => void;
  onMeetingMode?: (ev: ScheduleEvent) => void;
  onOpenNote?: (ev: ScheduleEvent) => void;
  onJoin?: (ev: ScheduleEvent) => void;
};

function topFor(min: number) {
  return (PAD_MINS + min) * PX_PER_MIN;
}

function heightFor(startMin: number, endMin: number) {
  return Math.max(36, (Math.min(endMin, 24 * 60) - Math.max(startMin, 0)) * PX_PER_MIN);
}

function eventStatus(ev: ScheduleEvent, nowMin: number, isToday: boolean) {
  if (!isToday || ev.allDay) return null;
  if (nowMin < ev.startMin) return "即將";
  if (nowMin < ev.endMin) return "進行中";
  return "已結束";
}

export default function JournalDayView({
  uid,
  dateKey,
  selectedEventId,
  overlays = [],
  onSelectDay,
  onSelectEvent,
  onMeetingMode,
  onOpenNote,
  onJoin,
}: Props) {
  const [localEvents, setLocalEvents] = useState<ScheduleEvent[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [editingEvent, setEditingEvent] = useState<ScheduleEvent | null>(null);
  const [createFor, setCreateFor] = useState<{
    dateKey: string;
    startMin?: number;
    endMin?: number;
    allDay?: boolean;
  } | null>(null);
  const [nowMin, setNowMin] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  const touchRef = useRef<{ x: number; y: number } | null>(null);
  const todayKey = dateKeyFromDate(new Date());
  const isToday = dateKey === todayKey;

  useEffect(() => {
    return listenScheduleEvents(uid, dateKey, setLocalEvents, (e) =>
      toast(e.message || "行程同步失敗")
    );
  }, [uid, dateKey]);

  useEffect(() => {
    const t = window.setInterval(() => {
      const d = new Date();
      setNowMin(d.getHours() * 60 + d.getMinutes());
    }, 60_000);
    return () => window.clearInterval(t);
  }, []);

  const merged = useMemo(() => {
    const map = new Map<string, ScheduleEvent>();
    for (const e of localEvents) map.set(e.id, e);
    for (const e of overlays) {
      if (e.dateKey === dateKey) map.set(e.id, e);
    }
    return [...map.values()].sort(
      (a, b) =>
        Number(Boolean(b.allDay)) - Number(Boolean(a.allDay)) ||
        a.startMin - b.startMin ||
        a.title.localeCompare(b.title)
    );
  }, [localEvents, overlays, dateKey]);

  const allDay = merged.filter((e) => e.allDay);
  const timed = merged.filter((e) => !e.allDay);

  const dayLabel = useMemo(() => {
    const d = parseDateKey(dateKey);
    if (!d) return dateKey;
    const wd = WEEKDAY_LABELS[(d.getDay() + 6) % 7];
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${wd}）`;
  }, [dateKey]);

  const hourMarks = useMemo(
    () => Array.from({ length: 25 }, (_, i) => i),
    []
  );

  const openEditor = (ev: ScheduleEvent) => {
    onSelectEvent?.(ev);
    setEditingEvent(ev);
  };

  const shift = (delta: number) => onSelectDay?.(shiftDateKey(dateKey, delta));

  const onSwipeTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY };
  };

  const onSwipeTouchEnd = (e: React.TouchEvent) => {
    if (!touchRef.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchRef.current.x;
    const dy = t.clientY - touchRef.current.y;
    touchRef.current = null;
    // Prefer vertical scroll; only change day on a clear horizontal swipe.
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    shift(dx < 0 ? 1 : -1);
  };

  const onGridPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!editMode) return;
    if ((e.target as HTMLElement).closest(".jn-day-block")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const min = Math.max(
      0,
      Math.min(24 * 60 - 30, Math.round((y / PX_PER_MIN - PAD_MINS) / 15) * 15)
    );
    setCreateFor({
      dateKey,
      startMin: min,
      endMin: Math.min(24 * 60, min + 60),
      allDay: false,
    });
  };

  return (
    <div
      className={`jn-day${editMode ? " is-editing" : ""}`}
      onTouchStart={onSwipeTouchStart}
      onTouchEnd={onSwipeTouchEnd}
    >
      <div className="jn-day-head">
        <div className="jn-day-head-left">
          <button type="button" className="jn-icon-btn" onClick={() => shift(-1)} aria-label="前一天">
            ‹
          </button>
          <h3>{dayLabel}</h3>
          <button type="button" className="jn-icon-btn" onClick={() => shift(1)} aria-label="後一天">
            ›
          </button>
        </div>
        <div className="jn-day-head-actions">
          {!isToday && (
            <button type="button" className="jn-text-btn" onClick={() => onSelectDay?.(todayKey)}>
              今天
            </button>
          )}
          <button
            type="button"
            className={`btn btn-sm${editMode ? "" : " btn-soft"}`}
            onClick={() => setEditMode((v) => !v)}
          >
            {editMode ? "完成編輯" : "編輯行程"}
          </button>
        </div>
      </div>

      <section className="jn-day-allday">
        <div className="jn-day-allday-label">全天</div>
        <div className="jn-day-allday-list">
          {allDay.length === 0 && <p className="jn-muted">無全天事項</p>}
          {allDay.map((ev) => (
            <button
              key={ev.id}
              type="button"
              className={`jn-day-chip${selectedEventId === ev.id ? " is-on" : ""}${ev.provider !== "local" ? " is-sync" : ""}`}
              onClick={() => openEditor(ev)}
            >
              <strong>{ev.title}</strong>
              {ev.description && <span>{ev.description}</span>}
            </button>
          ))}
          {editMode && (
            <button
              type="button"
              className="jn-text-btn"
              onClick={() => setCreateFor({ dateKey, allDay: true })}
            >
              ＋ 全天／重要事項
            </button>
          )}
        </div>
      </section>

      <div className="jn-day-body">
        <div className="jn-day-list">
          <div className="jn-day-list-head">
            <h4>當日細項</h4>
            {editMode && (
              <button
                type="button"
                className="btn btn-soft btn-sm"
                onClick={() => {
                  const start = Math.max(0, Math.round(nowMin / 15) * 15);
                  setCreateFor({
                    dateKey,
                    startMin: start,
                    endMin: Math.min(24 * 60, start + 60),
                  });
                }}
              >
                新增行程
              </button>
            )}
          </div>
          {timed.length === 0 ? (
            <p className="jn-muted">這天還沒有時段行程。可切到編輯後新增，或點時間軸空白處。</p>
          ) : (
            <ul className="jn-day-cards">
              {timed.map((ev) => {
                const status = eventStatus(ev, nowMin, isToday);
                return (
                  <li key={ev.id}>
                    <div
                      className={`jn-day-card${selectedEventId === ev.id ? " is-on" : ""}${ev.provider !== "local" ? " is-sync" : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        onSelectEvent?.(ev);
                        openEditor(ev);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelectEvent?.(ev);
                          openEditor(ev);
                        }
                      }}
                    >
                      <div className="jn-day-card-time">
                        <strong>
                          {formatClock(ev.startMin)}–{formatClock(ev.endMin)}
                        </strong>
                        {status && <em>{status}</em>}
                        {ev.seriesId && <em>重複</em>}
                      </div>
                      <div className="jn-day-card-main">
                        <strong>{ev.title}</strong>
                        {ev.description ? (
                          <p>{ev.description}</p>
                        ) : (
                          <p className="is-empty">尚無備註</p>
                        )}
                      </div>
                      <div className="jn-day-card-actions">
                        {onMeetingMode && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              onMeetingMode(ev);
                            }}
                          >
                            會議
                          </button>
                        )}
                        {ev.conferenceUrl && onJoin && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              onJoin(ev);
                            }}
                          >
                            加入
                          </button>
                        )}
                        {onOpenNote && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenNote(ev);
                            }}
                          >
                            筆記
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="jn-day-timeline">
          <div
            className={`jn-day-grid${editMode ? " is-edit" : ""}`}
            style={{ height: GRID_MINS * PX_PER_MIN }}
            onPointerDown={onGridPointerDown}
          >
            <div className="jn-day-hours" aria-hidden>
              {hourMarks.map((h) => (
                <div
                  key={h}
                  className={`jn-day-hour${h === 0 || h === 24 ? " is-edge" : ""}`}
                  style={{ top: topFor(h * 60) }}
                >
                  {String(h).padStart(2, "0")}
                </div>
              ))}
            </div>
            <div className="jn-day-col">
              {hourMarks.map((h) => (
                <div
                  key={h}
                  className={`jn-day-hline${h === 0 || h === 24 ? " is-edge" : ""}`}
                  style={{ top: topFor(h * 60) }}
                />
              ))}
              {isToday && <div className="jn-week-now" style={{ top: topFor(nowMin) }} />}
              {timed.map((ev) => (
                <div
                  key={ev.id}
                  className={`jn-day-block${selectedEventId === ev.id ? " is-on" : ""}${ev.provider !== "local" ? " is-sync" : ""}`}
                  style={{
                    top: topFor(ev.startMin),
                    height: heightFor(ev.startMin, ev.endMin),
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    openEditor(ev);
                  }}
                >
                  <strong>{ev.title}</strong>
                  <span>
                    {formatClock(ev.startMin)}–{formatClock(ev.endMin)}
                  </span>
                  {ev.description && <em>{ev.description}</em>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <p className="jn-tl-hint">
        {editMode
          ? "編輯中：點「新增」或時間軸空白處建立；點卡片可改備註、時間、重複。"
          : "左右滑可換日；上下滑可捲動整頁。點行程可編輯。"}
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
      {createFor && (
        <ScheduleEventEditDialog
          uid={uid}
          createInitial={createFor}
          onClose={() => setCreateFor(null)}
          onSaved={() => setCreateFor(null)}
        />
      )}
    </div>
  );
}
