"use client";

import { useState } from "react";
import JournalWeekTimeline from "@/components/journal/JournalWeekTimeline";
import JournalMonthBoard from "@/components/journal/JournalMonthBoard";
import type { ScheduleEvent } from "@/lib/scheduleEvents";

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
  const [mode, setMode] = useState<"week" | "month">("week");

  return (
    <div className="jn-schedule-panel">
      <div className="jn-schedule-tabs" role="tablist" aria-label="行程檢視">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "week"}
          className={`jn-schedule-tab${mode === "week" ? " is-on" : ""}`}
          onClick={() => setMode("week")}
        >
          週時間軸
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "month"}
          className={`jn-schedule-tab${mode === "month" ? " is-on" : ""}`}
          onClick={() => setMode("month")}
        >
          月重要事項
        </button>
      </div>

      {mode === "week" ? (
        <JournalWeekTimeline
          uid={uid}
          dateKey={dateKey}
          selectedEventId={selectedEventId}
          overlays={weekOverlays}
          onSelectDay={onSelectDay}
          onSelectEvent={onSelectEvent}
          onMeetingMode={onMeetingMode}
          onOpenNote={onOpenNote}
          onJoin={onJoin}
        />
      ) : (
        <JournalMonthBoard
          uid={uid}
          dateKey={dateKey}
          selectedEventId={selectedEventId}
          overlays={monthOverlays}
          onSelectDay={onSelectDay}
          onSelectEvent={onSelectEvent}
        />
      )}
    </div>
  );
}
