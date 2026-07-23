"use client";

import { useEffect, useState } from "react";
import JournalDayView from "@/components/journal/JournalDayView";
import JournalWeekTimeline from "@/components/journal/JournalWeekTimeline";
import JournalMonthBoard from "@/components/journal/JournalMonthBoard";
import ScheduleEventEditDialog from "@/components/journal/ScheduleEventEditDialog";
import { formatClock, type ScheduleEvent } from "@/lib/scheduleEvents";

type Props = {
  uid: string;
  dateKey: string;
  selectedEventId?: string | null;
  weekOverlays?: ScheduleEvent[];
  monthOverlays?: ScheduleEvent[];
  onSelectDay?: (dateKey: string) => void;
  onSelectEvent?: (ev: ScheduleEvent | null) => void;
  onMeetingMode?: (ev: ScheduleEvent) => void;
  onOpenNote?: (ev: ScheduleEvent) => void;
  onJoin?: (ev: ScheduleEvent) => void;
};

type Mode = "day" | "week" | "month";

export default function JournalSchedulePanel({
  uid,
  dateKey,
  selectedEventId,
  weekOverlays = [],
  monthOverlays = [],
  onSelectDay,
  onSelectEvent,
  onMeetingMode,
  onOpenNote,
  onJoin,
}: Props) {
  const [mode, setMode] = useState<Mode>("week");
  const [selected, setSelected] = useState<ScheduleEvent | null>(null);
  const [editingEvent, setEditingEvent] = useState<ScheduleEvent | null>(null);

  useEffect(() => {
    if (!selectedEventId) {
      setSelected(null);
      return;
    }
    setSelected((prev) => (prev && prev.id !== selectedEventId ? null : prev));
  }, [selectedEventId]);

  const handleSelectEvent = (ev: ScheduleEvent | null) => {
    setSelected(ev);
    onSelectEvent?.(ev);
  };

  return (
    <div className="jn-schedule-panel">
      <div className="jn-schedule-chrome">
        <div className="jn-schedule-tabs" role="tablist" aria-label="行程檢視">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "day"}
            className={`jn-schedule-tab${mode === "day" ? " is-on" : ""}`}
            onClick={() => setMode("day")}
          >
            日
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "week"}
            className={`jn-schedule-tab${mode === "week" ? " is-on" : ""}`}
            onClick={() => setMode("week")}
          >
            週
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "month"}
            className={`jn-schedule-tab${mode === "month" ? " is-on" : ""}`}
            onClick={() => setMode("month")}
          >
            月
          </button>
        </div>

        {selected && selectedEventId === selected.id && (
          <div className="jn-schedule-selected">
            <div className="jn-schedule-selected-title" title={selected.title}>
              {selected.dateKey.slice(5).replace("-", "/")} · {selected.title}
              {!selected.allDay && (
                <>
                  {" "}
                  · {formatClock(selected.startMin)}–{formatClock(selected.endMin)}
                </>
              )}
            </div>
            <div className="jn-schedule-selected-actions">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => onMeetingMode?.(selected)}
              >
                會議模式
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onOpenNote?.(selected)}
              >
                筆記
              </button>
              {selected.conferenceUrl && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onJoin?.(selected)}
                >
                  加入
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setEditingEvent(selected)}
              >
                詳細設定
              </button>
            </div>
          </div>
        )}
      </div>

      {mode === "day" ? (
        <JournalDayView
          uid={uid}
          dateKey={dateKey}
          selectedEventId={selectedEventId}
          overlays={weekOverlays}
          onSelectDay={onSelectDay}
          onSelectEvent={handleSelectEvent}
          onMeetingMode={onMeetingMode}
          onOpenNote={onOpenNote}
          onJoin={onJoin}
        />
      ) : mode === "week" ? (
        <JournalWeekTimeline
          uid={uid}
          dateKey={dateKey}
          selectedEventId={selectedEventId}
          overlays={weekOverlays}
          onSelectDay={onSelectDay}
          onSelectEvent={handleSelectEvent}
        />
      ) : (
        <JournalMonthBoard
          uid={uid}
          dateKey={dateKey}
          selectedEventId={selectedEventId}
          overlays={monthOverlays}
          onSelectDay={onSelectDay}
          onSelectEvent={handleSelectEvent}
        />
      )}

      {editingEvent && (
        <ScheduleEventEditDialog
          uid={uid}
          event={editingEvent}
          onClose={() => setEditingEvent(null)}
          onSaved={() => setEditingEvent(null)}
          onDeleted={() => {
            if (selectedEventId === editingEvent.id) handleSelectEvent(null);
            setEditingEvent(null);
          }}
        />
      )}
    </div>
  );
}
