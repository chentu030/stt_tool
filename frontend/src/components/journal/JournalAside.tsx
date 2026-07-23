"use client";

import { useMemo, useState } from "react";
import {
  JournalStats,
  heatWeeks,
  type JournalTagDef,
  dateKeyFromDate,
} from "@/lib/journalMeta";
import { NoteHandoffLinks } from "@/components/shell/ContinueChips";
import { formatClock, type ScheduleEvent } from "@/lib/scheduleEvents";

type Props = {
  stats: JournalStats;
  dateKey: string;
  noteId?: string | null;
  noteTitle?: string;
  tagDefs?: JournalTagDef[];
  agenda?: ScheduleEvent[];
  /** agenda = 今日議程+筆記；secondary = 節奏/熱力/AI；all = 兩者 */
  mode?: "agenda" | "secondary" | "all";
  onAskAi: (prompt: string) => Promise<string>;
  onMeetingMode?: (ev: ScheduleEvent) => void;
  onOpenNote?: (ev: ScheduleEvent) => void;
  onJoin?: (ev: ScheduleEvent) => void;
};

export default function JournalAside({
  stats,
  dateKey,
  noteId,
  noteTitle,
  tagDefs = [],
  agenda = [],
  mode = "all",
  onAskAi,
  onMeetingMode,
  onOpenNote,
  onJoin,
}: Props) {
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [showHeat, setShowHeat] = useState(false);
  const heat = heatWeeks(stats.filledDays, 14);
  const showAgenda = mode === "agenda" || mode === "all";
  const showSecondary = mode === "secondary" || mode === "all";

  const run = async (prompt: string) => {
    setAiBusy(true);
    setAiError("");
    try {
      const text = await onAskAi(prompt);
      setAiText(text);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  };

  const sortedAgenda = useMemo(
    () =>
      [...agenda].sort(
        (a, b) =>
          Number(Boolean(b.allDay)) - Number(Boolean(a.allDay)) ||
          a.startMin - b.startMin ||
          a.title.localeCompare(b.title)
      ),
    [agenda]
  );

  const nowMin = useMemo(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }, [dateKey, agenda.length]);

  const tagRows = (() => {
    const counts = stats.tagCounts || {};
    const rows = tagDefs
      .map((t) => ({ ...t, count: counts[t.id] || 0 }))
      .filter((t) => t.count > 0);
    for (const [id, count] of Object.entries(counts)) {
      if (!tagDefs.some((t) => t.id === id) && count > 0) {
        rows.push({ id, label: id, color: "#94A3B8", count });
      }
    }
    return rows.sort((a, b) => b.count - a.count).slice(0, 8);
  })();

  return (
    <aside className={`jn-aside${mode !== "all" ? ` is-${mode}` : ""}`}>
      {showAgenda && (
        <>
          <section className="jn-aside-block">
            <h3>今日議程</h3>
            {sortedAgenda.length === 0 ? (
              <p className="jn-muted">這天還沒有行程。可在中間週視圖拖曳新增。</p>
            ) : (
              <ul className="jn-agenda-list">
                {sortedAgenda.map((ev) => {
                  const isToday = dateKey === dateKeyFromDate(new Date());
                  const upcoming =
                    isToday &&
                    !ev.allDay &&
                    ev.startMin > nowMin &&
                    ev.startMin - nowMin <= 60;
                  const live =
                    isToday && !ev.allDay && ev.startMin <= nowMin && nowMin < ev.endMin;
                  return (
                    <li
                      key={ev.id}
                      className={`jn-agenda-item${live ? " is-live" : ""}${upcoming ? " is-soon" : ""}`}
                    >
                      <div className="jn-agenda-meta">
                        <span className="jn-agenda-time">
                          {ev.allDay
                            ? "全天"
                            : `${formatClock(ev.startMin)}–${formatClock(ev.endMin)}`}
                        </span>
                        {ev.provider === "google" && (
                          <span className="jn-agenda-src">Google</span>
                        )}
                        {live && <span className="jn-agenda-badge">進行中</span>}
                        {upcoming && !live && (
                          <span className="jn-agenda-badge">即將</span>
                        )}
                      </div>
                      <strong className="jn-agenda-title">{ev.title}</strong>
                      <div className="jn-agenda-actions">
                        <button
                          type="button"
                          className="btn btn-soft btn-sm"
                          onClick={() => onMeetingMode?.(ev)}
                        >
                          會議模式
                        </button>
                        {ev.conferenceUrl && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => onJoin?.(ev)}
                          >
                            加入
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => onOpenNote?.(ev)}
                        >
                          筆記
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {noteId && (
            <section className="jn-aside-block">
              <h3>今日筆記</h3>
              <p className="jn-muted" style={{ marginBottom: "0.4rem" }}>
                {noteTitle || dateKey}
              </p>
              <NoteHandoffLinks noteId={noteId} title={noteTitle || dateKey} />
            </section>
          )}
        </>
      )}

      {showSecondary && (
        <>
          <section className="jn-aside-block">
            <h3>節奏</h3>
            <div className="jn-stat-grid jn-stat-grid-compact">
              <div>
                <strong>{stats.streak}</strong>
                <span>連續天</span>
              </div>
              <div>
                <strong>{stats.thisWeek}</strong>
                <span>本週</span>
              </div>
              <div>
                <strong>{stats.thisMonth}</strong>
                <span>本月</span>
              </div>
            </div>
            <button
              type="button"
              className="jn-text-btn"
              style={{ marginTop: "0.45rem" }}
              onClick={() => setShowHeat((v) => !v)}
            >
              {showHeat ? "收合熱力" : "近 14 週熱力"}
            </button>
            {showHeat && (
              <div className="jn-heat" title="有寫的日子會亮起" style={{ marginTop: "0.5rem" }}>
                {heat.map((col, i) => (
                  <div key={i} className="jn-heat-col">
                    {col.map((c) => (
                      <span
                        key={c.dateKey}
                        className={`jn-heat-cell${c.level ? " is-on" : ""}`}
                        title={c.dateKey}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>

          {tagRows.length > 0 && (
            <section className="jn-aside-block">
              <h3>標籤</h3>
              <ul className="jn-mood-stats">
                {tagRows.map((m) => (
                  <li key={m.id}>
                    <i style={{ background: m.color }} />
                    <span>{m.label}</span>
                    <em>{m.count}</em>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="jn-aside-block">
            <h3>AI 回顧</h3>
            <div className="jn-ai-actions">
              <button
                type="button"
                className="btn btn-soft btn-sm"
                disabled={aiBusy}
                onClick={() =>
                  void run(
                    `請用繁體中文，為 ${dateKey} 這天寫一段溫和的日誌開場白（3-5 句），不要說教。`
                  )
                }
              >
                開場白
              </button>
              <button
                type="button"
                className="btn btn-soft btn-sm"
                disabled={aiBusy}
                onClick={() =>
                  void run(`用繁體中文給我 5 個適合在 ${dateKey} 寫的反思問題。`)
                }
              >
                反思問題
              </button>
            </div>
            {aiBusy && <p className="jn-muted">產生中…</p>}
            {aiError && <p className="jn-error">{aiError}</p>}
            {aiText && <div className="jn-ai-out">{aiText}</div>}
          </section>
        </>
      )}
    </aside>
  );
}
