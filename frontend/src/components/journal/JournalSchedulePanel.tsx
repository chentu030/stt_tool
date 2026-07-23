"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
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
  const [focusOpen, setFocusOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const titleId = useId();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!selectedEventId) {
      setSelected(null);
      return;
    }
    setSelected((prev) => (prev && prev.id !== selectedEventId ? null : prev));
  }, [selectedEventId]);

  useEffect(() => {
    if (!focusOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocusOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [focusOpen]);

  const handleSelectEvent = (ev: ScheduleEvent | null) => {
    setSelected(ev);
    onSelectEvent?.(ev);
  };

  const renderTabs = (keyPrefix: string) => (
    <div className="jn-schedule-tabs" role="tablist" aria-label="行程檢視" key={keyPrefix}>
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
  );

  const renderSelectedChrome = () =>
    selected && selectedEventId === selected.id ? (
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
            onClick={() => setEditingEvent(selected)}
          >
            詳細設定
          </button>
        </div>
      </div>
    ) : null;

  const scheduleBody =
    mode === "day" ? (
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
    );

  const focusPortal =
    mounted &&
    focusOpen &&
    createPortal(
      <div
        className="jn-schedule-focus-backdrop"
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) setFocusOpen(false);
        }}
      >
        <div
          className="jn-schedule-focus"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <div className="jn-schedule-focus-chrome">
            <div className="jn-schedule-focus-left">
              <h2 id={titleId} className="jn-schedule-focus-title">
                全局查看
              </h2>
              {renderTabs("focus")}
            </div>
            <div className="jn-schedule-focus-right">
              {renderSelectedChrome()}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setFocusOpen(false)}
              >
                關閉
              </button>
            </div>
          </div>
          <div className="jn-schedule-focus-body">{scheduleBody}</div>
        </div>
      </div>,
      document.body
    );

  return (
    <div className={`jn-schedule-panel${focusOpen ? " is-focus-open" : ""}`}>
      <div className="jn-schedule-chrome">
        <div className="jn-schedule-chrome-left">
          {renderTabs("panel")}
          <button
            type="button"
            className="btn btn-ghost btn-sm jn-schedule-focus-btn"
            onClick={() => setFocusOpen(true)}
            title="接近全螢幕查看日／週／月"
          >
            全局查看
          </button>
        </div>
        {!focusOpen && renderSelectedChrome()}
      </div>

      {focusOpen ? (
        <div className="jn-schedule-focus-placeholder" aria-hidden>
          <span>全局查看中</span>
          <button type="button" className="btn btn-soft btn-sm" onClick={() => setFocusOpen(false)}>
            回到面板
          </button>
        </div>
      ) : (
        scheduleBody
      )}

      {focusPortal}

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
