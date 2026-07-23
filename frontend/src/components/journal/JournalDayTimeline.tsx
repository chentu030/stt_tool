"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createScheduleEvent,
  deleteScheduleEvent,
  formatClock,
  listenScheduleEvents,
  snapMin,
  updateScheduleEvent,
  type ScheduleEvent,
} from "@/lib/scheduleEvents";
import { askPrompt } from "@/lib/dialogs";
import { toast } from "@/lib/toast";

const HOUR_START = 6;
const HOUR_END = 22;
const PX_PER_MIN = 1.15;
const GRID_MINS = (HOUR_END - HOUR_START) * 60;

type Props = {
  uid: string;
  dateKey: string;
  selectedEventId?: string | null;
  onSelectEvent?: (ev: ScheduleEvent | null) => void;
  onMeetingMode?: (ev: ScheduleEvent) => void;
  onOpenNote?: (ev: ScheduleEvent) => void;
  onJoin?: (ev: ScheduleEvent) => void;
  overlays?: ScheduleEvent[];
};

type LaneLayout = { id: string; lane: number; laneCount: number };

function yToMin(clientY: number, gridTop: number) {
  const y = clientY - gridTop;
  return snapMin(HOUR_START * 60 + y / PX_PER_MIN);
}

/** Assign overlap lanes (greedy). */
function packLanes(events: ScheduleEvent[]): Map<string, LaneLayout> {
  const sorted = [...events].sort(
    (a, b) => a.startMin - b.startMin || a.endMin - b.endMin
  );
  const active: { id: string; end: number; lane: number }[] = [];
  const laneOf = new Map<string, number>();
  let maxLane = 0;

  for (const ev of sorted) {
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].end <= ev.startMin) active.splice(i, 1);
    }
    const used = new Set(active.map((a) => a.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    laneOf.set(ev.id, lane);
    active.push({ id: ev.id, end: ev.endMin, lane });
    maxLane = Math.max(maxLane, lane);
  }

  // Second pass: laneCount = max concurrent in cluster (approx maxLane+1 for simplicity per event's overlap group)
  const out = new Map<string, LaneLayout>();
  for (const ev of sorted) {
    const overlapping = sorted.filter(
      (o) => o.id !== ev.id && o.startMin < ev.endMin && o.endMin > ev.startMin
    );
    const laneCount = 1 + Math.max(0, ...overlapping.map((o) => laneOf.get(o.id) ?? 0), laneOf.get(ev.id) ?? 0);
    // Better: count unique lanes among self + overlapping
    const lanes = new Set<number>([laneOf.get(ev.id) ?? 0]);
    overlapping.forEach((o) => lanes.add(laneOf.get(o.id) ?? 0));
    out.set(ev.id, {
      id: ev.id,
      lane: laneOf.get(ev.id) ?? 0,
      laneCount: Math.max(lanes.size, 1),
    });
  }
  void maxLane;
  return out;
}

function eventStatus(ev: ScheduleEvent, nowMin: number, isToday: boolean) {
  if (!isToday || ev.allDay) return null;
  if (nowMin < ev.startMin) return "即將";
  if (nowMin < ev.endMin) return "進行中";
  return "已結束";
}

export default function JournalDayTimeline({
  uid,
  dateKey,
  selectedEventId,
  onSelectEvent,
  onMeetingMode,
  onOpenNote,
  onJoin,
  overlays = [],
}: Props) {
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [nowMin, setNowMin] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    mode: "create" | "move" | "resize";
    eventId?: string;
    originMin: number;
    startMin: number;
    endMin: number;
    duration?: number;
    moved: boolean;
  } | null>(null);
  const [draft, setDraft] = useState<{
    startMin: number;
    endMin: number;
    eventId?: string;
  } | null>(null);

  useEffect(() => {
    return listenScheduleEvents(uid, dateKey, setEvents, (e) =>
      toast(e.message || "無法載入行程")
    );
  }, [uid, dateKey]);

  useEffect(() => {
    const t = window.setInterval(() => {
      const d = new Date();
      setNowMin(d.getHours() * 60 + d.getMinutes());
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  const merged = useMemo(() => {
    const byKey = new Map<string, ScheduleEvent>();
    for (const e of events) byKey.set(e.id, e);
    for (const o of overlays) {
      if (!byKey.has(o.id)) byKey.set(o.id, o);
    }
    return Array.from(byKey.values()).sort((a, b) => a.startMin - b.startMin);
  }, [events, overlays]);

  const timed = merged.filter((e) => !e.allDay);
  const allDay = merged.filter((e) => e.allDay);
  const lanes = useMemo(() => packLanes(timed), [timed]);

  const todayKey = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);
  const isToday = dateKey === todayKey;
  const showNow = isToday && nowMin >= HOUR_START * 60 && nowMin <= HOUR_END * 60;

  const nextUp = useMemo(() => {
    if (!isToday) return null;
    return (
      timed.find((e) => e.endMin > nowMin) ||
      timed.find((e) => e.startMin >= nowMin) ||
      null
    );
  }, [timed, nowMin, isToday]);

  const hours = useMemo(() => {
    const rows: number[] = [];
    for (let h = HOUR_START; h <= HOUR_END; h++) rows.push(h);
    return rows;
  }, []);

  const topFor = (min: number) => (min - HOUR_START * 60) * PX_PER_MIN;
  const heightFor = (start: number, end: number) =>
    Math.max(18, (end - start) * PX_PER_MIN);

  const scrollToNow = () => {
    const grid = gridRef.current;
    if (!grid || !showNow) return;
    grid.parentElement?.scrollTo({
      top: Math.max(0, topFor(nowMin) - 80),
      behavior: "smooth",
    });
  };

  const onGridPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest(".jn-tl-event")) return;
    const grid = gridRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const startMin = yToMin(e.clientY, rect.top);
    dragRef.current = {
      mode: "create",
      originMin: startMin,
      startMin,
      endMin: Math.min(HOUR_END * 60, startMin + 30),
      moved: false,
    };
    setDraft({ startMin, endMin: startMin + 30 });
    grid.setPointerCapture(e.pointerId);
  };

  const onGridPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const grid = gridRef.current;
    if (!drag || !grid) return;
    const rect = grid.getBoundingClientRect();
    const cur = yToMin(e.clientY, rect.top);
    drag.moved = true;
    if (drag.mode === "create") {
      const a = Math.min(drag.originMin, cur);
      const b = Math.max(drag.originMin, cur + 15);
      drag.startMin = a;
      drag.endMin = Math.min(HOUR_END * 60, b);
      setDraft({ startMin: drag.startMin, endMin: drag.endMin });
    } else if (drag.mode === "move" && drag.eventId && drag.duration != null) {
      const start = Math.max(
        HOUR_START * 60,
        Math.min(HOUR_END * 60 - drag.duration, cur - (drag.originMin - drag.startMin))
      );
      // originMin stored as grab offset from start
      const grab = drag.originMin;
      const nextStart = snapMin(
        Math.max(HOUR_START * 60, Math.min(HOUR_END * 60 - drag.duration, cur - grab))
      );
      drag.startMin = nextStart;
      drag.endMin = nextStart + drag.duration;
      setDraft({
        startMin: drag.startMin,
        endMin: drag.endMin,
        eventId: drag.eventId,
      });
      void start;
    } else if (drag.mode === "resize" && drag.eventId) {
      drag.endMin = Math.max(drag.startMin + 15, Math.min(HOUR_END * 60, cur));
      setDraft({
        startMin: drag.startMin,
        endMin: drag.endMin,
        eventId: drag.eventId,
      });
    }
  };

  const finishDrag = useCallback(async () => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDraft(null);
    if (!drag) return;

    if (drag.mode === "create") {
      if (drag.endMin - drag.startMin < 10) return;
      try {
        const id = await createScheduleEvent(uid, {
          dateKey,
          startMin: drag.startMin,
          endMin: drag.endMin,
          title: "未命名",
        });
        toast("已新增行程（可點選重新命名）");
        onSelectEvent?.({
          id,
          dateKey,
          startMin: drag.startMin,
          endMin: drag.endMin,
          title: "未命名",
          provider: "local",
        });
      } catch (err) {
        toast(err instanceof Error ? err.message : "新增失敗");
      }
      return;
    }

    if (!drag.eventId || !drag.moved) return;
    try {
      await updateScheduleEvent(uid, drag.eventId, {
        startMin: drag.startMin,
        endMin: drag.endMin,
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : "更新失敗");
    }
  }, [uid, dateKey, onSelectEvent]);

  const onGridPointerUp = () => {
    void finishDrag();
  };

  const beginMove = (ev: ScheduleEvent, e: React.PointerEvent) => {
    if (ev.provider !== "local") return;
    e.stopPropagation();
    const grid = gridRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const cur = yToMin(e.clientY, rect.top);
    dragRef.current = {
      mode: "move",
      eventId: ev.id,
      originMin: cur - ev.startMin,
      startMin: ev.startMin,
      endMin: ev.endMin,
      duration: ev.endMin - ev.startMin,
      moved: false,
    };
    setDraft({ startMin: ev.startMin, endMin: ev.endMin, eventId: ev.id });
    grid.setPointerCapture(e.pointerId);
    onSelectEvent?.(ev);
  };

  const beginResize = (ev: ScheduleEvent, e: React.PointerEvent) => {
    if (ev.provider !== "local") return;
    e.stopPropagation();
    const grid = gridRef.current;
    if (!grid) return;
    dragRef.current = {
      mode: "resize",
      eventId: ev.id,
      originMin: ev.endMin,
      startMin: ev.startMin,
      endMin: ev.endMin,
      moved: false,
    };
    setDraft({ startMin: ev.startMin, endMin: ev.endMin, eventId: ev.id });
    grid.setPointerCapture(e.pointerId);
    onSelectEvent?.(ev);
  };

  const addAllDay = async () => {
    const title = await askPrompt({
      title: "新增全天行程",
      defaultValue: "全天",
    });
    if (title == null) return;
    try {
      await createScheduleEvent(uid, {
        dateKey,
        startMin: 0,
        endMin: 24 * 60,
        allDay: true,
        title: title.trim() || "全天",
      });
      toast("已新增全天行程");
    } catch (err) {
      toast(err instanceof Error ? err.message : "新增失敗");
    }
  };

  const removeEvent = async (ev: ScheduleEvent) => {
    if (ev.provider !== "local") {
      toast("同步行程請在日曆來源端刪除");
      return;
    }
    try {
      await deleteScheduleEvent(uid, ev.id);
      if (selectedEventId === ev.id) onSelectEvent?.(null);
      toast("已刪除");
    } catch (err) {
      toast(err instanceof Error ? err.message : "刪除失敗");
    }
  };

  const displayTimed = timed.map((ev) => {
    if (draft?.eventId === ev.id) {
      return { ...ev, startMin: draft.startMin, endMin: draft.endMin };
    }
    return ev;
  });

  return (
    <div className="jn-timeline">
      <div className="jn-timeline-head">
        <h3>{dateKey.slice(5).replace("-", "/")} 行程</h3>
        <div className="jn-timeline-head-actions">
          {showNow && (
            <button type="button" className="jn-text-btn" onClick={scrollToNow}>
              現在
            </button>
          )}
        </div>
      </div>

      {nextUp && (
        <div className="jn-tl-next">
          <span>
            下一個 · {nextUp.title}
            {!nextUp.allDay && (
              <>
                {" "}
                ({formatClock(nextUp.startMin)})
              </>
            )}
          </span>
          <div className="jn-tl-next-actions">
            {nextUp.conferenceUrl && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onJoin?.(nextUp)}>
                加入
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => onMeetingMode?.(nextUp)}
            >
              會議模式
            </button>
          </div>
        </div>
      )}

      <div className="jn-tl-allday">
        <div className="jn-tl-allday-label">全天</div>
        <div className="jn-tl-allday-items">
          {allDay.length === 0 && <span className="jn-muted">無</span>}
          {allDay.map((ev) => (
            <button
              key={ev.id}
              type="button"
              className={`jn-tl-chip${selectedEventId === ev.id ? " is-on" : ""}`}
              onClick={() => onSelectEvent?.(ev)}
            >
              {ev.title}
            </button>
          ))}
          <button type="button" className="jn-text-btn" onClick={() => void addAllDay()}>
            ＋
          </button>
        </div>
      </div>

      <div
        className="jn-tl-grid"
        ref={gridRef}
        onPointerDown={onGridPointerDown}
        onPointerMove={onGridPointerMove}
        onPointerUp={onGridPointerUp}
        onPointerCancel={onGridPointerUp}
        style={{ height: GRID_MINS * PX_PER_MIN }}
      >
        {hours.map((h) => (
          <div
            key={h}
            className="jn-tl-hour"
            style={{ top: (h - HOUR_START) * 60 * PX_PER_MIN }}
          >
            <span>{String(h).padStart(2, "0")}:00</span>
          </div>
        ))}

        {showNow && <div className="jn-tl-now" style={{ top: topFor(nowMin) }} />}

        {draft && !draft.eventId && (
          <div
            className="jn-tl-event is-draft"
            style={{
              top: topFor(draft.startMin),
              height: heightFor(draft.startMin, draft.endMin),
            }}
          />
        )}

        {displayTimed.map((ev) => {
          const layout = lanes.get(ev.id) || { lane: 0, laneCount: 1, id: ev.id };
          const readonly = ev.provider !== "local";
          const status = eventStatus(ev, nowMin, isToday);
          return (
            <div
              key={ev.id}
              className={`jn-tl-event${selectedEventId === ev.id ? " is-on" : ""}${readonly ? " is-sync" : ""}`}
              style={{
                top: topFor(Math.max(ev.startMin, HOUR_START * 60)),
                height: heightFor(
                  Math.max(ev.startMin, HOUR_START * 60),
                  Math.min(ev.endMin, HOUR_END * 60)
                ),
                left: `calc(2.6rem + (100% - 2.95rem) * ${layout.lane} / ${layout.laneCount})`,
                width: `calc((100% - 2.95rem) / ${layout.laneCount} - 0.2rem)`,
                right: "auto",
              }}
              onPointerDown={(e) => beginMove(ev, e)}
            >
              <strong>{ev.title}</strong>
              <span>
                {formatClock(ev.startMin)}–{formatClock(ev.endMin)}
                {status ? ` · ${status}` : ""}
                {ev.conferenceUrl ? " · 可加入" : ""}
                {readonly ? " · 同步" : ""}
              </span>
              {!readonly && (
                <i
                  className="jn-tl-resize"
                  onPointerDown={(e) => beginResize(ev, e)}
                  title="拖曳調整結束時間"
                />
              )}
            </div>
          );
        })}
      </div>

      <p className="jn-tl-hint">拖曳空白處新增；拖曳色塊移動；底邊調整長度</p>

      {selectedEventId && (
        <EventActions
          ev={merged.find((e) => e.id === selectedEventId) || null}
          onMeetingMode={onMeetingMode}
          onOpenNote={onOpenNote}
          onJoin={onJoin}
          onDelete={(ev) => void removeEvent(ev)}
          onEditTitle={async (ev) => {
            if (ev.provider !== "local") return;
            try {
              const t = await askPrompt({
                title: "重新命名",
                defaultValue: ev.title,
              });
              if (t == null) return;
              await updateScheduleEvent(uid, ev.id, { title: t });
            } catch (err) {
              toast(err instanceof Error ? err.message : "更新失敗");
            }
          }}
          onSetLink={async (ev) => {
            if (ev.provider !== "local") return;
            try {
              const t = await askPrompt({
                title: "會議連結",
                message: "貼上 https:// Meet / Teams / Zoom 連結",
                defaultValue: ev.conferenceUrl || "",
              });
              if (t == null) return;
              const url = t.trim();
              if (url && !/^https:\/\//i.test(url)) {
                toast("請使用 https:// 開頭的連結");
                return;
              }
              await updateScheduleEvent(uid, ev.id, {
                conferenceUrl: url || undefined,
              });
            } catch (err) {
              toast(err instanceof Error ? err.message : "更新失敗");
            }
          }}
        />
      )}
    </div>
  );
}

function EventActions({
  ev,
  onMeetingMode,
  onOpenNote,
  onJoin,
  onDelete,
  onEditTitle,
  onSetLink,
}: {
  ev: ScheduleEvent | null;
  onMeetingMode?: (ev: ScheduleEvent) => void;
  onOpenNote?: (ev: ScheduleEvent) => void;
  onJoin?: (ev: ScheduleEvent) => void;
  onDelete: (ev: ScheduleEvent) => void;
  onEditTitle: (ev: ScheduleEvent) => void;
  onSetLink: (ev: ScheduleEvent) => void;
}) {
  if (!ev) return null;
  return (
    <div className="jn-tl-actions">
      <div className="jn-tl-actions-title">{ev.title}</div>
      <div className="jn-tl-actions-row">
        {ev.conferenceUrl && (
          <button type="button" className="btn btn-sm" onClick={() => onJoin?.(ev)}>
            加入會議
          </button>
        )}
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => onMeetingMode?.(ev)}
          title="開啟會議筆記並可開始即時轉錄"
        >
          會議模式
        </button>
        <button type="button" className="btn btn-soft btn-sm" onClick={() => onOpenNote?.(ev)}>
          筆記
        </button>
      </div>
      {ev.provider === "local" && (
        <div className="jn-tl-actions-row">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void onEditTitle(ev)}>
            重新命名
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void onSetLink(ev)}>
            會議連結
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDelete(ev)}>
            刪除
          </button>
        </div>
      )}
    </div>
  );
}
