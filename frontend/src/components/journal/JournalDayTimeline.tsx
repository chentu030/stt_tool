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
const PX_PER_MIN = 1.1;
const GRID_MINS = (HOUR_END - HOUR_START) * 60;

type Props = {
  uid: string;
  dateKey: string;
  selectedEventId?: string | null;
  onSelectEvent?: (ev: ScheduleEvent | null) => void;
  onMeetingMode?: (ev: ScheduleEvent) => void;
  onOpenNote?: (ev: ScheduleEvent) => void;
  onJoin?: (ev: ScheduleEvent) => void;
  /** Extra readonly overlays (e.g. Google) merged in UI only */
  overlays?: ScheduleEvent[];
};

function yToMin(clientY: number, gridTop: number) {
  const y = clientY - gridTop;
  return snapMin(HOUR_START * 60 + y / PX_PER_MIN);
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
  } | null>(null);
  const [draft, setDraft] = useState<{ startMin: number; endMin: number } | null>(null);

  useEffect(() => {
    return listenScheduleEvents(
      uid,
      dateKey,
      setEvents,
      (e) => toast(e.message || "無法載入行程")
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

  const hours = useMemo(() => {
    const rows: number[] = [];
    for (let h = HOUR_START; h <= HOUR_END; h++) rows.push(h);
    return rows;
  }, []);

  const topFor = (min: number) => (min - HOUR_START * 60) * PX_PER_MIN;
  const heightFor = (start: number, end: number) =>
    Math.max(18, (end - start) * PX_PER_MIN);

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
    };
    setDraft({ startMin, endMin: startMin + 30 });
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onGridPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const grid = gridRef.current;
    if (!drag || !grid) return;
    const rect = grid.getBoundingClientRect();
    const cur = yToMin(e.clientY, rect.top);
    if (drag.mode === "create") {
      const a = Math.min(drag.originMin, cur);
      const b = Math.max(drag.originMin, cur + 15);
      drag.startMin = a;
      drag.endMin = Math.min(HOUR_END * 60, b);
      setDraft({ startMin: drag.startMin, endMin: drag.endMin });
    }
  };

  const finishCreate = useCallback(async () => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDraft(null);
    if (!drag || drag.mode !== "create") return;
    if (drag.endMin - drag.startMin < 10) return;
    const title = await askPrompt({
      title: "新增行程",
      message: `${formatClock(drag.startMin)}–${formatClock(drag.endMin)}`,
      defaultValue: "專注時段",
    });
    if (title == null) return;
    try {
      const id = await createScheduleEvent(uid, {
        dateKey,
        startMin: drag.startMin,
        endMin: drag.endMin,
        title: title.trim() || "專注時段",
      });
      toast("已新增行程");
      onSelectEvent?.(
        {
          id,
          dateKey,
          startMin: drag.startMin,
          endMin: drag.endMin,
          title: title.trim() || "專注時段",
          provider: "local",
        }
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : "新增失敗");
    }
  }, [uid, dateKey, onSelectEvent]);

  const onGridPointerUp = () => {
    if (dragRef.current?.mode === "create") void finishCreate();
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

  const todayKey = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);
  const showNow = dateKey === todayKey && nowMin >= HOUR_START * 60 && nowMin <= HOUR_END * 60;

  return (
    <div className="jn-timeline">
      <div className="jn-timeline-head">
        <h3>今日行程</h3>
        <span className="jn-muted">{dateKey}</span>
      </div>

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

        {showNow && (
          <div className="jn-tl-now" style={{ top: topFor(nowMin) }} />
        )}

        {draft && (
          <div
            className="jn-tl-event is-draft"
            style={{
              top: topFor(draft.startMin),
              height: heightFor(draft.startMin, draft.endMin),
            }}
          />
        )}

        {timed.map((ev) => {
          const readonly = ev.provider !== "local";
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
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelectEvent?.(ev);
              }}
            >
              <strong>{ev.title}</strong>
              <span>
                {formatClock(ev.startMin)}–{formatClock(ev.endMin)}
                {ev.conferenceUrl ? " · 可加入" : ""}
              </span>
            </div>
          );
        })}
      </div>

      <p className="jn-tl-hint">在空白處拖曳可新增時段</p>

      {selectedEventId && (
        <EventActions
          ev={merged.find((e) => e.id === selectedEventId) || null}
          onMeetingMode={onMeetingMode}
          onOpenNote={onOpenNote}
          onJoin={onJoin}
          onDelete={(ev) => void removeEvent(ev)}
          onEditTitle={async (ev) => {
            if (ev.provider !== "local") return;
            const t = await askPrompt({
              title: "重新命名",
              defaultValue: ev.title,
            });
            if (t == null) return;
            await updateScheduleEvent(uid, ev.id, { title: t });
          }}
          onSetLink={async (ev) => {
            if (ev.provider !== "local") return;
            const t = await askPrompt({
              title: "會議連結",
              message: "貼上 Meet / Teams / Zoom 連結",
              defaultValue: ev.conferenceUrl || "",
            });
            if (t == null) return;
            await updateScheduleEvent(uid, ev.id, {
              conferenceUrl: t.trim() || undefined,
            });
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
