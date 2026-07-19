"use client";

import {
  CalCell,
  MoodId,
  MOODS,
  monthLabel,
  weekdayLabels,
} from "@/lib/journalMeta";

type Props = {
  year: number;
  month: number;
  cells: CalCell[];
  selected: string;
  onSelect: (dateKey: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
};

export default function JournalCalendar({
  year,
  month,
  cells,
  selected,
  onSelect,
  onPrev,
  onNext,
  onToday,
}: Props) {
  return (
    <div className="jn-cal">
      <div className="jn-cal-head">
        <button type="button" className="jn-icon-btn" onClick={onPrev} aria-label="上個月">‹</button>
        <div className="jn-cal-title">
          <strong>{monthLabel(year, month)}</strong>
          <button type="button" className="jn-text-btn" onClick={onToday}>今天</button>
        </div>
        <button type="button" className="jn-icon-btn" onClick={onNext} aria-label="下個月">›</button>
      </div>
      <div className="jn-cal-weekdays">
        {weekdayLabels().map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="jn-cal-grid">
        {cells.map((c) => {
          const moodColor = c.mood
            ? MOODS.find((m) => m.id === (c.mood as MoodId))?.color
            : undefined;
          return (
            <button
              key={c.dateKey}
              type="button"
              className={[
                "jn-cal-day",
                c.inMonth ? "" : "is-out",
                c.isToday ? "is-today" : "",
                c.dateKey === selected ? "is-selected" : "",
                c.hasEntry ? "has-entry" : "",
              ].filter(Boolean).join(" ")}
              onClick={() => onSelect(c.dateKey)}
            >
              <span>{c.day}</span>
              {c.hasEntry && (
                <i style={moodColor ? { background: moodColor } : undefined} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
