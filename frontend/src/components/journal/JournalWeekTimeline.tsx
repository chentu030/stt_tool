"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createScheduleEvent,
  formatClock,
  listenScheduleEventsForDates,
  snapMin,
  updateScheduleEvent,
  type ScheduleEvent,
} from "@/lib/scheduleEvents";
import {
  dateKeyFromDate,
  parseDateKey,
  shiftDateKey,
  weekDateKeys,
} from "@/lib/journalMeta";
import { askPrompt } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import ScheduleEventEditDialog from "@/components/journal/ScheduleEventEditDialog";

const HOUR_START = 6;
const HOUR_END = 22;
const PX_PER_MIN = 0.72;
const GRID_MINS = (HOUR_END - HOUR_START) * 60;
const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

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
  return Math.max(0, (min - HOUR_START * 60) * PX_PER_MIN);
}

function heightFor(startMin: number, endMin: number) {
  return Math.max(18, (endMin - startMin) * PX_PER_MIN);
}

function yToMin(clientY: number, gridTop: number) {
  return snapMin(HOUR_START * 60 + (clientY - gridTop) / PX_PER_MIN);
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
  const weekKeys = useMemo(() => weekDateKeys(dateKey), [dateKey]);
  const [localEvents, setLocalEvents] = useState<ScheduleEvent[]>([]);
  const [nowMin, setNowMin] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  const todayKey = dateKeyFromDate(new Date());
  const bodyRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    dateKey: string;
    originMin: number;
    startMin: number;
    endMin: number;
    moved: boolean;
    startClientY: number;
  } | null>(null);
  const [draft, setDraft] = useState<{
    dateKey: string;
    startMin: number;
    endMin: number;
  } | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editingEvent, setEditingEvent] = useState<ScheduleEvent | null>(null);
  const editModeRef = useRef(editMode);
  editModeRef.current = editMode;

  useEffect(() => {
    return listenScheduleEventsForDates(uid, weekKeys, setLocalEvents, (e) =>
      toast(e.message || "行程同步失敗")
    );
  }, [uid, weekKeys]);

  useEffect(() => {
    const t = window.setInterval(() => {
      const d = new Date();
      setNowMin(d.getHours() * 60 + d.getMinutes());
    }, 60_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!weekKeys.includes(todayKey)) return;
    const el = bodyRef.current?.querySelector(".jn-week-now");
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [weekKeys, todayKey]);

  const merged = useMemo(() => {
    const map = new Map<string, ScheduleEvent>();
    for (const e of localEvents) map.set(e.id, e);
    for (const e of overlays) {
      if (weekKeys.includes(e.dateKey)) map.set(e.id, e);
    }
    return [...map.values()];
  }, [localEvents, overlays, weekKeys]);

  const byDay = useMemo(() => {
    const m = new Map<string, ScheduleEvent[]>();
    for (const k of weekKeys) m.set(k, []);
    for (const e of merged) {
      const list = m.get(e.dateKey);
      if (list) list.push(e);
    }
    for (const list of m.values()) {
      list.sort((a, b) => a.startMin - b.startMin || a.title.localeCompare(b.title));
    }
    return m;
  }, [merged, weekKeys]);

  const rangeLabel = useMemo(() => {
    const a = weekKeys[0]?.slice(5).replace("-", "/") || "";
    const b = weekKeys[6]?.slice(5).replace("-", "/") || "";
    return `${a} – ${b}`;
  }, [weekKeys]);

  const hours = useMemo(
    () => Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i),
    []
  );

  const shiftWeek = (delta: number) => {
    onSelectDay?.(shiftDateKey(dateKey, delta * 7));
  };

  const goThisWeek = () => {
    onSelectDay?.(todayKey);
  };

  const finishCreate = async () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!editModeRef.current || !drag || !drag.moved) {
      setDraft(null);
      return;
    }
    const startMin = Math.min(drag.startMin, drag.endMin);
    let endMin = Math.max(drag.startMin, drag.endMin);
    if (endMin - startMin < 15) endMin = startMin + 30;
    setDraft(null);
    try {
      const id = await createScheduleEvent(uid, {
        dateKey: drag.dateKey,
        startMin,
        endMin,
        title: "未命名",
      });
      onSelectDay?.(drag.dateKey);
      onSelectEvent?.({
        id,
        dateKey: drag.dateKey,
        startMin,
        endMin,
        title: "未命名",
        provider: "local",
      });
      const t = await askPrompt({
        title: "行程名稱",
        defaultValue: "未命名",
      });
      if (t != null && t.trim() && t.trim() !== "未命名") {
        await updateScheduleEvent(uid, id, { title: t.trim() });
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "新增失敗");
    }
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
    <div className={`jn-week${editMode ? " is-editing" : ""}`}>
      <div className="jn-week-head">
        <div className="jn-week-head-left">
          <button type="button" className="jn-icon-btn" onClick={() => shiftWeek(-1)} aria-label="上一週">
            ‹
          </button>
          <h3>本週行程 · {rangeLabel}</h3>
          <button type="button" className="jn-icon-btn" onClick={() => shiftWeek(1)} aria-label="下一週">
            ›
          </button>
        </div>
        <div className="jn-week-head-actions">
          {!weekKeys.includes(todayKey) && (
            <button type="button" className="jn-text-btn" onClick={goThisWeek}>
              回到本週
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
              }
            }}
            title={editMode ? "關閉拖曳編輯，避免誤觸" : "開啟後可拖曳新增行程"}
          >
            {editMode ? "完成編輯" : "編輯行程"}
          </button>
        </div>
      </div>

      <div className="jn-week-allday">
        <div className="jn-week-allday-label">全天</div>
        <div className="jn-week-allday-cols">
          {weekKeys.map((dk, i) => {
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
                    title={`新增 ${dk} 全天`}
                    onClick={() => {
                      void (async () => {
                        try {
                          await createScheduleEvent(uid, {
                            dateKey: dk,
                            startMin: 0,
                            endMin: 24 * 60,
                            allDay: true,
                            title: "全天",
                          });
                          onSelectDay?.(dk);
                        } catch (err) {
                          toast(err instanceof Error ? err.message : "新增失敗");
                        }
                      })();
                    }}
                  >
                    ＋
                  </button>
                )}
                <span className="jn-week-allday-wd">{WEEKDAY_LABELS[i]}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="jn-week-scroll" ref={bodyRef}>
        <div className="jn-week-grid" style={{ height: GRID_MINS * PX_PER_MIN }}>
          <div className="jn-week-hours">
            {hours.map((h) => (
              <div
                key={h}
                className="jn-week-hour"
                style={{ top: (h - HOUR_START) * 60 * PX_PER_MIN }}
              >
                {String(h).padStart(2, "0")}
              </div>
            ))}
          </div>

          <div className="jn-week-cols">
            {weekKeys.map((dk, i) => {
              const dayEvents = (byDay.get(dk) || []).filter((e) => !e.allDay);
              const isToday = dk === todayKey;
              const isSel = dk === dateKey;
              const d = parseDateKey(dk);
              return (
                <div
                  key={dk}
                  className={`jn-week-col${isToday ? " is-today" : ""}${isSel ? " is-sel" : ""}${editMode ? " is-edit" : ""}`}
                  onPointerDown={(e) => onColPointerDown(dk, e)}
                  onPointerMove={onColPointerMove}
                  onPointerUp={() => void finishCreate()}
                  onPointerCancel={() => {
                    dragRef.current = null;
                    setDraft(null);
                  }}
                >
                  <button
                    type="button"
                    className="jn-week-col-head"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectDay?.(dk);
                    }}
                  >
                    <span>{WEEKDAY_LABELS[i]}</span>
                    <strong>{d ? d.getDate() : dk.slice(8)}</strong>
                  </button>

                  {isToday && nowMin >= HOUR_START * 60 && nowMin <= HOUR_END * 60 && (
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
                    return (
                      <div
                        key={ev.id}
                        className={`jn-week-event${selectedEventId === ev.id ? " is-on" : ""}${readonly ? " is-sync" : ""}`}
                        style={{
                          top: topFor(Math.max(ev.startMin, HOUR_START * 60)),
                          height: heightFor(
                            Math.max(ev.startMin, HOUR_START * 60),
                            Math.min(ev.endMin, HOUR_END * 60)
                          ),
                        }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          onSelectDay?.(dk);
                          onSelectEvent?.(ev);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onSelectDay?.(dk);
                          openEventEditor(ev);
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          openEventEditor(ev);
                        }}
                      >
                        <strong>{ev.title}</strong>
                        <span>
                          {formatClock(ev.startMin)}
                          {status ? ` · ${status}` : ""}
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

      <p className="jn-tl-hint">
        {editMode
          ? "編輯中：拖曳空白處新增行程。右鍵或雙擊行程可詳細設定。"
          : "點「編輯行程」後才能拖曳新增。右鍵／雙擊行程可改名稱與時間。"}
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
    </div>
  );
}
