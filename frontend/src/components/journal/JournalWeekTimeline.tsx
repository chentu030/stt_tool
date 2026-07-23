"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatClock,
  listenScheduleEventsForDates,
  snapMin,
  updateScheduleEvent,
  type ScheduleEvent,
} from "@/lib/scheduleEvents";
import {
  dateKeyFromDate,
  daysBetween,
  parseDateKey,
  rollingDateKeys,
  shiftDateKey,
  weekDateKeys,
} from "@/lib/journalMeta";
import { toast } from "@/lib/toast";
import ScheduleEventEditDialog from "@/components/journal/ScheduleEventEditDialog";

const HOUR_START = 0;
const HOUR_END = 24;
const PX_PER_MIN = 0.55;
/** Extra mins above 00:00 / below 24:00 so the day reads continuous. */
const PAD_MINS = 40;
const GRID_MINS = (HOUR_END - HOUR_START) * 60 + PAD_MINS * 2;
const HOUR_PX = 60 * PX_PER_MIN;
const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
const SLIDER_SPAN = 90;
const LONG_PRESS_MS = 380;
const MIN_EVENT_MINS = 15;

type EventGestureMode = "move" | "resize-start" | "resize-end";

type EventGesture = {
  mode: EventGestureMode;
  id: string;
  dateKey: string;
  originStart: number;
  originEnd: number;
  startMin: number;
  endMin: number;
  startClientY: number;
  colTop: number;
  armed: boolean;
  moved: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

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
  return (PAD_MINS + (min - HOUR_START * 60)) * PX_PER_MIN;
}

function heightFor(startMin: number, endMin: number) {
  return Math.max(
    18,
    (Math.min(endMin, HOUR_END * 60) - Math.max(startMin, HOUR_START * 60)) * PX_PER_MIN
  );
}

function yToMin(clientY: number, gridTop: number) {
  return snapMin(HOUR_START * 60 + (clientY - gridTop) / PX_PER_MIN - PAD_MINS);
}

function eventStatus(ev: ScheduleEvent, nowMin: number, isToday: boolean) {
  if (!isToday || ev.allDay) return null;
  if (nowMin < ev.startMin) return "即將";
  if (nowMin < ev.endMin) return "進行中";
  return "已結束";
}

export default function JournalWeekTimeline({
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
  const [compact, setCompact] = useState(false);
  /** Stable start of the 4-day window on mobile — not forced to the selected day. */
  const [rangeStart, setRangeStart] = useState(dateKey);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 900px)");
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!compact) return;
    const end = shiftDateKey(rangeStart, 3);
    if (dateKey < rangeStart || dateKey > end) {
      setRangeStart(dateKey);
    }
  }, [compact, dateKey, rangeStart]);

  const dayKeys = useMemo(
    () => (compact ? rollingDateKeys(rangeStart, 4) : weekDateKeys(dateKey)),
    [compact, rangeStart, dateKey]
  );
  const [localEvents, setLocalEvents] = useState<ScheduleEvent[]>([]);
  const [nowMin, setNowMin] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  const todayKey = dateKeyFromDate(new Date());
  const bodyRef = useRef<HTMLDivElement>(null);
  const touchRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{
    dateKey: string;
    originMin: number;
    startMin: number;
    endMin: number;
    moved: boolean;
    startClientY: number;
  } | null>(null);
  const eventGestureRef = useRef<EventGesture | null>(null);
  const [draft, setDraft] = useState<{
    dateKey: string;
    startMin: number;
    endMin: number;
  } | null>(null);
  /** Live preview while moving / resizing an existing event. */
  const [eventPreview, setEventPreview] = useState<{
    id: string;
    startMin: number;
    endMin: number;
  } | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editingEvent, setEditingEvent] = useState<ScheduleEvent | null>(null);
  const [createFor, setCreateFor] = useState<{
    dateKey: string;
    startMin?: number;
    endMin?: number;
    allDay?: boolean;
    title?: string;
  } | null>(null);
  const editModeRef = useRef(editMode);
  editModeRef.current = editMode;

  const clearEventGesture = (opts?: { keepPreview?: boolean }) => {
    const g = eventGestureRef.current;
    if (g?.timer) clearTimeout(g.timer);
    eventGestureRef.current = null;
    if (!opts?.keepPreview) setEventPreview(null);
  };

  const clampRange = (startMin: number, endMin: number) => {
    let s = snapMin(startMin);
    let e = snapMin(endMin);
    if (e - s < MIN_EVENT_MINS) e = s + MIN_EVENT_MINS;
    if (s < HOUR_START * 60) {
      e += HOUR_START * 60 - s;
      s = HOUR_START * 60;
    }
    if (e > HOUR_END * 60) {
      s -= e - HOUR_END * 60;
      e = HOUR_END * 60;
    }
    s = Math.max(HOUR_START * 60, Math.min(s, HOUR_END * 60 - MIN_EVENT_MINS));
    e = Math.max(s + MIN_EVENT_MINS, Math.min(e, HOUR_END * 60));
    return { startMin: s, endMin: e };
  };

  useEffect(() => {
    return listenScheduleEventsForDates(uid, dayKeys, setLocalEvents, (e) =>
      toast(e.message || "行程同步失敗")
    );
  }, [uid, dayKeys]);

  useEffect(() => {
    const t = window.setInterval(() => {
      const d = new Date();
      setNowMin(d.getHours() * 60 + d.getMinutes());
    }, 60_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    // Only scroll to the now-line once when today enters the view — not on every day change.
    // Use container scrollTop (not scrollIntoView) so the page/rail does not jump on mobile.
    if (!dayKeys.includes(todayKey)) return;
    const sc = bodyRef.current;
    if (!sc || sc.dataset.scrolledNow === "1") return;
    const el = sc.querySelector(".jn-week-now") as HTMLElement | null;
    if (!el) return;
    const top = el.offsetTop - sc.clientHeight / 2 + el.offsetHeight / 2;
    sc.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    sc.dataset.scrolledNow = "1";
  }, [dayKeys, todayKey]);

  useEffect(() => {
    const sc = bodyRef.current;
    if (!sc) return;
    const onScroll = () => {
      const g = eventGestureRef.current;
      if (g && !g.armed) clearEventGesture();
    };
    sc.addEventListener("scroll", onScroll, { passive: true });
    return () => sc.removeEventListener("scroll", onScroll);
  }, [dayKeys]);

  const merged = useMemo(() => {
    const map = new Map<string, ScheduleEvent>();
    for (const e of localEvents) map.set(e.id, e);
    for (const e of overlays) {
      if (dayKeys.includes(e.dateKey)) map.set(e.id, e);
    }
    return [...map.values()];
  }, [localEvents, overlays, dayKeys]);

  const byDay = useMemo(() => {
    const m = new Map<string, ScheduleEvent[]>();
    for (const k of dayKeys) m.set(k, []);
    for (const e of merged) {
      const list = m.get(e.dateKey);
      if (list) list.push(e);
    }
    for (const list of m.values()) {
      list.sort((a, b) => a.startMin - b.startMin || a.title.localeCompare(b.title));
    }
    return m;
  }, [merged, dayKeys]);

  const rangeLabel = useMemo(() => {
    const a = dayKeys[0]?.slice(5).replace("-", "/") || "";
    const b = dayKeys[dayKeys.length - 1]?.slice(5).replace("-", "/") || "";
    return `${a} – ${b}`;
  }, [dayKeys]);

  const selectedLabel = useMemo(() => {
    const d = parseDateKey(dateKey);
    if (!d) return dateKey;
    const wd = WEEKDAY_LABELS[(d.getDay() + 6) % 7];
    return `${d.getMonth() + 1}/${d.getDate()}（${wd}）`;
  }, [dateKey]);

  /** Hour marks 0–24 (line + label at each full hour). */
  const hourMarks = useMemo(
    () => Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i),
    []
  );

  const sliderOffset = daysBetween(todayKey, dateKey);
  const sliderClamped = Math.max(-SLIDER_SPAN, Math.min(SLIDER_SPAN, sliderOffset));

  const shiftDay = (delta: number) => {
    const next = shiftDateKey(dateKey, delta);
    if (compact) {
      // Slide the 4-day window by the same step so ◀▶ moves one day like desktop.
      setRangeStart((s) => shiftDateKey(s, delta));
    }
    onSelectDay?.(next);
  };

  const goToday = () => {
    onSelectDay?.(todayKey);
  };

  const onSwipeTouchStart = (e: React.TouchEvent) => {
    if (!compact) return;
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY };
  };

  const onSwipeTouchEnd = (e: React.TouchEvent) => {
    if (!compact || !touchRef.current) return;
    if (editModeRef.current && (dragRef.current?.moved || eventGestureRef.current?.moved)) {
      touchRef.current = null;
      return;
    }
    const t = e.changedTouches[0];
    const dx = t.clientX - touchRef.current.x;
    const dy = t.clientY - touchRef.current.y;
    touchRef.current = null;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    // Swipe left → later day; swipe right → earlier day (1 day, same as ◀▶).
    shiftDay(dx < 0 ? 1 : -1);
  };

  const applyEventGestureAtY = (g: EventGesture, clientY: number) => {
    if (g.mode === "move") {
      const dur = g.originEnd - g.originStart;
      const dMin = snapMin((clientY - g.startClientY) / PX_PER_MIN);
      return clampRange(g.originStart + dMin, g.originStart + dMin + dur);
    }
    const cur = yToMin(clientY, g.colTop);
    if (g.mode === "resize-start") {
      return clampRange(Math.min(cur, g.originEnd - MIN_EVENT_MINS), g.originEnd);
    }
    return clampRange(g.originStart, Math.max(cur, g.originStart + MIN_EVENT_MINS));
  };

  const armEventGesture = (g: EventGesture) => {
    g.armed = true;
    if (g.timer) {
      clearTimeout(g.timer);
      g.timer = null;
    }
    setEventPreview({ id: g.id, startMin: g.startMin, endMin: g.endMin });
    try {
      navigator.vibrate?.(12);
    } catch {
      /* ignore */
    }
  };

  const onEventPointerDown = (
    ev: ScheduleEvent,
    dk: string,
    mode: EventGestureMode,
    e: React.PointerEvent<HTMLElement>
  ) => {
    e.stopPropagation();
    onSelectDay?.(dk);
    onSelectEvent?.(ev);
    if (!editModeRef.current || ev.provider !== "local") return;
    if (ev.allDay) return;

    const col = (e.currentTarget as HTMLElement).closest(".jn-week-col") as HTMLElement | null;
    const colTop = col?.getBoundingClientRect().top ?? 0;
    clearEventGesture();
    dragRef.current = null;
    setDraft(null);

    const gesture: EventGesture = {
      mode,
      id: ev.id,
      dateKey: dk,
      originStart: ev.startMin,
      originEnd: ev.endMin,
      startMin: ev.startMin,
      endMin: ev.endMin,
      startClientY: e.clientY,
      colTop,
      armed: mode !== "move",
      moved: false,
      timer: null,
    };
    eventGestureRef.current = gesture;

    // Resize handles arm immediately; move needs long-press.
    if (mode === "move") {
      gesture.timer = setTimeout(() => {
        if (eventGestureRef.current === gesture) armEventGesture(gesture);
      }, LONG_PRESS_MS);
    } else {
      armEventGesture(gesture);
    }

    try {
      const card =
        (e.currentTarget as HTMLElement).closest(".jn-week-event") ||
        (e.currentTarget as HTMLElement);
      card.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onEventPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const g = eventGestureRef.current;
    if (!g) return;
    const dy = Math.abs(e.clientY - g.startClientY);
    if (!g.armed) {
      if (dy > 10) {
        // Cancel long-press if finger slips before arming.
        clearEventGesture();
      }
      return;
    }
    if (!g.moved && dy < 4) return;
    g.moved = true;
    // Refresh col top in case of scroll mid-drag.
    const col = (e.currentTarget as HTMLElement).closest(".jn-week-col") as HTMLElement | null;
    if (col) g.colTop = col.getBoundingClientRect().top;
    const next = applyEventGestureAtY(g, e.clientY);
    g.startMin = next.startMin;
    g.endMin = next.endMin;
    setEventPreview({ id: g.id, startMin: next.startMin, endMin: next.endMin });
  };

  const finishEventGesture = async () => {
    const g = eventGestureRef.current;
    if (!g) return;
    const snapshot = {
      id: g.id,
      dateKey: g.dateKey,
      startMin: g.startMin,
      endMin: g.endMin,
      originStart: g.originStart,
      originEnd: g.originEnd,
      armed: g.armed,
      moved: g.moved,
    };
    const shouldSave =
      snapshot.armed &&
      snapshot.moved &&
      (snapshot.startMin !== snapshot.originStart || snapshot.endMin !== snapshot.originEnd);
    clearEventGesture({ keepPreview: shouldSave });
    if (!shouldSave) {
      setEventPreview(null);
      return;
    }
    const prev = merged.find((x) => x.id === snapshot.id);
    try {
      await updateScheduleEvent(uid, snapshot.id, {
        startMin: snapshot.startMin,
        endMin: snapshot.endMin,
      });
      if (prev) {
        onSelectEvent?.({
          ...prev,
          startMin: snapshot.startMin,
          endMin: snapshot.endMin,
        });
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "更新失敗");
    } finally {
      setEventPreview(null);
    }
  };

  const finishCreate = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!editModeRef.current || !drag || !drag.moved) {
      setDraft(null);
      return;
    }
    const startMin = Math.min(drag.startMin, drag.endMin);
    let endMin = Math.max(drag.startMin, drag.endMin);
    if (endMin - startMin < 15) endMin = Math.min(HOUR_END * 60, startMin + 30);
    setDraft(null);
    onSelectDay?.(drag.dateKey);
    setCreateFor({
      dateKey: drag.dateKey,
      startMin,
      endMin,
      allDay: false,
      title: "",
    });
  };

  const onColPointerDown = (dk: string, e: React.PointerEvent<HTMLDivElement>) => {
    if (!editModeRef.current) {
      if (!(e.target as HTMLElement).closest(".jn-week-event")) {
        onSelectDay?.(dk);
      }
      return;
    }
    if ((e.target as HTMLElement).closest(".jn-week-event")) return;
    const col = e.currentTarget;
    const rect = col.getBoundingClientRect();
    const startMin = Math.max(
      HOUR_START * 60,
      Math.min(HOUR_END * 60 - 30, yToMin(e.clientY, rect.top))
    );
    dragRef.current = {
      dateKey: dk,
      originMin: startMin,
      startMin,
      endMin: startMin + 30,
      moved: false,
      startClientY: e.clientY,
    };
    setDraft({ dateKey: dk, startMin, endMin: startMin + 30 });
    col.setPointerCapture(e.pointerId);
    onSelectDay?.(dk);
  };

  const onColPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!editModeRef.current) return;
    const drag = dragRef.current;
    if (!drag) return;
    const dy = Math.abs(e.clientY - drag.startClientY);
    if (!drag.moved && dy < 5) return;
    drag.moved = true;
    const rect = e.currentTarget.getBoundingClientRect();
    const cur = Math.max(
      HOUR_START * 60,
      Math.min(HOUR_END * 60, yToMin(e.clientY, rect.top))
    );
    const startMin = Math.min(drag.originMin, cur);
    const endMin = Math.max(drag.originMin, cur);
    drag.startMin = startMin;
    drag.endMin = endMin;
    setDraft({ dateKey: drag.dateKey, startMin, endMin });
  };

  const openEventEditor = (ev: ScheduleEvent) => {
    onSelectEvent?.(ev);
    setEditingEvent(ev);
  };

  const selected = merged.find((e) => e.id === selectedEventId) || null;

  return (
    <div
      className={`jn-week${editMode ? " is-editing" : ""}${compact ? " is-compact" : ""}`}
      onTouchStart={onSwipeTouchStart}
      onTouchEnd={onSwipeTouchEnd}
    >
      <div className="jn-week-head">
        <div className="jn-week-head-left">
          <button
            type="button"
            className="jn-icon-btn"
            onClick={() => shiftDay(-1)}
            aria-label="前一天"
          >
            ‹
          </button>
          <h3>
            {selectedLabel}
            <span className="jn-week-range"> · {rangeLabel}</span>
          </h3>
          <button
            type="button"
            className="jn-icon-btn"
            onClick={() => shiftDay(1)}
            aria-label="後一天"
          >
            ›
          </button>
        </div>
        <div className="jn-week-head-actions">
          {dateKey !== todayKey && (
            <button type="button" className="jn-text-btn" onClick={goToday}>
              今天
            </button>
          )}
          <button
            type="button"
            className={`btn btn-sm${editMode ? "" : " btn-soft"}`}
            onClick={() => {
              setEditMode((v) => !v);
              if (editMode) {
                dragRef.current = null;
                setDraft(null);
                clearEventGesture();
              }
            }}
            title={
              editMode
                ? "關閉拖曳編輯，避免誤觸"
                : "開啟後可拖曳新增；長按行程可移動，拖上下緣可拉長"
            }
          >
            {editMode ? "完成編輯" : "編輯行程"}
          </button>
        </div>
      </div>

      <div className="jn-week-dayheads">
        <div className="jn-week-dayheads-gutter" aria-hidden />
        <div className="jn-week-dayheads-cols">
          {dayKeys.map((dk) => {
            const d = parseDateKey(dk);
            const isToday = dk === todayKey;
            const isSel = dk === dateKey;
            const wd = d ? WEEKDAY_LABELS[(d.getDay() + 6) % 7] : "";
            return (
              <button
                key={dk}
                type="button"
                className={`jn-week-dayhead${isToday ? " is-today" : ""}${isSel ? " is-sel" : ""}`}
                onClick={() => onSelectDay?.(dk)}
              >
                <span>{wd}</span>
                <strong>{d ? d.getDate() : dk.slice(8)}</strong>
              </button>
            );
          })}
        </div>
      </div>

      <div className="jn-week-allday">
        <div className="jn-week-allday-label">全天</div>
        <div className="jn-week-allday-cols">
          {dayKeys.map((dk) => {
            const allDay = (byDay.get(dk) || []).filter((e) => e.allDay);
            return (
              <div key={dk} className={`jn-week-allday-col${dk === dateKey ? " is-sel" : ""}`}>
                {allDay.map((ev) => (
                  <button
                    key={ev.id}
                    type="button"
                    className={`jn-tl-chip${selectedEventId === ev.id ? " is-on" : ""}`}
                    onClick={() => {
                      onSelectDay?.(dk);
                      onSelectEvent?.(ev);
                      openEventEditor(ev);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onSelectDay?.(dk);
                      openEventEditor(ev);
                    }}
                  >
                    {ev.title}
                  </button>
                ))}
                {editMode && (
                  <button
                    type="button"
                    className="jn-text-btn"
                    title={`新增 ${dk} 全天／重要事項`}
                    onClick={() => {
                      onSelectDay?.(dk);
                      setCreateFor({
                        dateKey: dk,
                        allDay: true,
                        title: "",
                      });
                    }}
                  >
                    ＋
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="jn-week-scroll" ref={bodyRef}>
        <div
          className="jn-week-grid"
          style={{
            height: GRID_MINS * PX_PER_MIN,
            ["--jn-hour-h" as string]: `${HOUR_PX}px`,
            ["--jn-pad-h" as string]: `${PAD_MINS * PX_PER_MIN}px`,
          }}
        >
          <div className="jn-week-hours">
            {hourMarks.map((h) => (
              <div
                key={h}
                className={`jn-week-hour${h === 0 || h === 24 ? " is-edge" : ""}`}
                style={{ top: topFor(h * 60) }}
              >
                {String(h).padStart(2, "0")}
              </div>
            ))}
          </div>

          <div className="jn-week-cols">
            <div className="jn-week-hlines" aria-hidden>
              <div className="jn-week-hline is-pad" style={{ top: 0 }} />
              {hourMarks.map((h) => (
                <div
                  key={h}
                  className={`jn-week-hline${h === 0 || h === 24 ? " is-edge" : ""}`}
                  style={{ top: topFor(h * 60) }}
                />
              ))}
              <div className="jn-week-hline is-pad" style={{ top: GRID_MINS * PX_PER_MIN - 1 }} />
            </div>
            {dayKeys.map((dk) => {
              const dayEvents = (byDay.get(dk) || []).filter((e) => !e.allDay);
              const isToday = dk === todayKey;
              const isSel = dk === dateKey;
              return (
                <div
                  key={dk}
                  className={`jn-week-col${isToday ? " is-today" : ""}${isSel ? " is-sel" : ""}${editMode ? " is-edit" : ""}`}
                  onPointerDown={(e) => onColPointerDown(dk, e)}
                  onPointerMove={onColPointerMove}
                  onPointerUp={() => finishCreate()}
                  onPointerCancel={() => {
                    dragRef.current = null;
                    setDraft(null);
                  }}
                >
                  {isToday && (
                    <div className="jn-week-now" style={{ top: topFor(nowMin) }} />
                  )}

                  {editMode && draft?.dateKey === dk && (
                    <div
                      className="jn-week-event is-draft"
                      style={{
                        top: topFor(draft.startMin),
                        height: heightFor(draft.startMin, draft.endMin),
                      }}
                    />
                  )}

                  {dayEvents.map((ev) => {
                    const readonly = ev.provider !== "local";
                    const status = eventStatus(ev, nowMin, isToday);
                    const preview =
                      eventPreview?.id === ev.id ? eventPreview : null;
                    const startMin = preview?.startMin ?? ev.startMin;
                    const endMin = preview?.endMin ?? ev.endMin;
                    const gesturing = eventPreview?.id === ev.id;
                    return (
                      <div
                        key={ev.id}
                        className={`jn-week-event${selectedEventId === ev.id ? " is-on" : ""}${readonly ? " is-sync" : ""}${gesturing ? " is-gesture" : ""}${editMode && !readonly ? " is-editable" : ""}`}
                        style={{
                          top: topFor(Math.max(startMin, HOUR_START * 60)),
                          height: heightFor(startMin, endMin),
                        }}
                        onPointerDown={(e) => onEventPointerDown(ev, dk, "move", e)}
                        onPointerMove={onEventPointerMove}
                        onPointerUp={() => void finishEventGesture()}
                        onPointerCancel={() => clearEventGesture()}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (eventGestureRef.current?.armed) return;
                          onSelectDay?.(dk);
                          openEventEditor(ev);
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          openEventEditor(ev);
                        }}
                      >
                        {editMode && !readonly && (
                          <>
                            <span
                              className="jn-week-event-handle is-start"
                              title="拖曳調整開始時間"
                              onPointerDown={(e) =>
                                onEventPointerDown(ev, dk, "resize-start", e)
                              }
                            />
                            <span
                              className="jn-week-event-handle is-end"
                              title="拖曳調整結束時間"
                              onPointerDown={(e) =>
                                onEventPointerDown(ev, dk, "resize-end", e)
                              }
                            />
                          </>
                        )}
                        <strong>{ev.title}</strong>
                        <span>
                          {formatClock(startMin)}
                          {!preview && status ? ` · ${status}` : ""}
                          {preview ? `–${formatClock(endMin)}` : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="jn-week-slider">
        <span className="jn-week-slider-label">
          {shiftDateKey(todayKey, -SLIDER_SPAN).slice(5).replace("-", "/")}
        </span>
        <input
          type="range"
          className="jn-week-slider-input"
          min={-SLIDER_SPAN}
          max={SLIDER_SPAN}
          step={1}
          value={sliderClamped}
          aria-label="快速移動日子"
          onChange={(e) => {
            const off = Number(e.target.value);
            const next = shiftDateKey(todayKey, off);
            if (next === dateKey) return;
            onSelectDay?.(next);
          }}
        />
        <span className="jn-week-slider-label">
          {shiftDateKey(todayKey, SLIDER_SPAN).slice(5).replace("-", "/")}
        </span>
      </div>
      <p className="jn-week-slider-hint">
        滑桿快速跳日 · 目前 {dateKey}
        {sliderOffset !== sliderClamped ? "（已超出滑桿範圍，可點左右繼續）" : ""}
      </p>

      <p className="jn-tl-hint">
        {compact
          ? editMode
            ? "編輯中：拖空白新增後可設重複／提醒；長按移動；拖上下緣拉長。左右滑或 ‹ › 一次一天。"
            : "手機一次顯示四天；‹ › 與左右滑一次移動一天。"
          : editMode
            ? "編輯中：拖空白新增後可設重複／提醒；長按移動；拖上下緣拉長。點行程開啟編輯／刪除。"
            : "左右切換一次移動一天。點「編輯行程」後才能拖曳新增或調整。"}
      </p>

      {selected && (
        <div className="jn-tl-actions">
          <div className="jn-tl-actions-title">
            {selected.dateKey.slice(5).replace("-", "/")} · {selected.title}
            {!selected.allDay && (
              <>
                {" "}
                · {formatClock(selected.startMin)}–{formatClock(selected.endMin)}
              </>
            )}
          </div>
          <div className="jn-tl-actions-row">
            <button type="button" className="btn btn-sm" onClick={() => onMeetingMode?.(selected)}>
              會議模式
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpenNote?.(selected)}>
              筆記
            </button>
            {selected.conferenceUrl && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onJoin?.(selected)}>
                加入
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => openEventEditor(selected)}
            >
              詳細設定
            </button>
          </div>
        </div>
      )}

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
          onSaved={(id) => {
            onSelectEvent?.({
              id,
              dateKey: createFor.dateKey,
              startMin: createFor.startMin ?? 0,
              endMin: createFor.endMin ?? 24 * 60,
              allDay: Boolean(createFor.allDay),
              title: createFor.title || (createFor.allDay ? "重要事項" : "未命名"),
              provider: "local",
            });
            setCreateFor(null);
          }}
        />
      )}
    </div>
  );
}
