"use client";

import { useMemo, useState } from "react";
import {
  JournalStats,
  type JournalTagDef,
  dateKeyFromDate,
} from "@/lib/journalMeta";
import { formatClock, type ScheduleEvent } from "@/lib/scheduleEvents";
import JournalHeatmap from "@/components/journal/JournalHeatmap";
import { toast } from "@/lib/toast";

type Props = {
  stats: JournalStats;
  dateKey: string;
  noteId?: string | null;
  noteTitle?: string;
  tagDefs?: JournalTagDef[];
  agenda?: ScheduleEvent[];
  wordsByDate?: Map<string, number> | Record<string, number>;
  /** agenda = 今日議程；secondary = 節奏/熱力；all = 兩者 */
  mode?: "agenda" | "secondary" | "all";
  onAskAi?: (prompt: string) => Promise<string>;
  onMeetingMode?: (ev: ScheduleEvent) => void;
  onOpenNote?: (ev: ScheduleEvent) => void;
  onJoin?: (ev: ScheduleEvent) => void;
  onSelectDay?: (dateKey: string) => void;
};

const AI_CHIPS = [
  {
    id: "summary",
    label: "今日摘要",
    prompt:
      "根據我今天的日誌內容，用繁體中文寫一段 3–5 句的今日摘要，條列重點即可，不要前言。",
  },
  {
    id: "todos",
    label: "抽出待辦",
    prompt:
      "根據我今天的日誌，抽出未完成待辦，用 Markdown 核取方塊列表（- [ ]）輸出，不要其他說明。",
  },
  {
    id: "continue",
    label: "延續昨日",
    prompt:
      "根據我最近的日誌節奏，建議今天可以延續的 3 件事（簡短條列），用繁體中文。",
  },
] as const;

export default function JournalAside({
  stats,
  dateKey,
  tagDefs = [],
  agenda = [],
  wordsByDate,
  mode = "all",
  onAskAi,
  onMeetingMode,
  onOpenNote,
  onJoin,
  onSelectDay,
}: Props) {
  const showAgenda = mode === "agenda" || mode === "all";
  const showSecondary = mode === "secondary" || mode === "all";
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiOut, setAiOut] = useState("");

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

  const runAi = async (chip: (typeof AI_CHIPS)[number]) => {
    if (!onAskAi) {
      toast("此處尚未接上 AI，請改用右側 AI 面板（⌘J）");
      return;
    }
    if (aiBusy) return;
    setAiBusy(chip.id);
    setAiOut("");
    try {
      const text = await onAskAi(chip.prompt);
      setAiOut((text || "").trim() || "（沒有回傳內容）");
    } catch (e) {
      toast(e instanceof Error ? e.message : "AI 失敗");
    } finally {
      setAiBusy(null);
    }
  };

  return (
    <aside className={`jn-aside${mode !== "all" ? ` is-${mode}` : ""}`}>
      {showSecondary && onAskAi && (
        <section className="jn-aside-block">
          <h3>今日助手</h3>
          <div className="jn-aside-ai-chips">
            {AI_CHIPS.map((c) => (
              <button
                key={c.id}
                type="button"
                className="btn btn-soft btn-sm"
                disabled={!!aiBusy}
                onClick={() => void runAi(c)}
              >
                {aiBusy === c.id ? "思考中…" : c.label}
              </button>
            ))}
          </div>
          {aiOut ? (
            <div className="jn-aside-ai-out">
              <pre>{aiOut}</pre>
            </div>
          ) : (
            <p className="jn-muted">一鍵整理今日日誌：摘要、待辦或延續方向。</p>
          )}
        </section>
      )}

      {showAgenda && (
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
            <div style={{ marginTop: "0.55rem" }}>
              <JournalHeatmap
                stats={stats}
                wordsByDate={wordsByDate}
                onSelectDay={onSelectDay}
              />
            </div>
          </section>

          {tagRows.length > 0 && (
            <section className="jn-aside-block">
              <h3>當日標記</h3>
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
        </>
      )}
    </aside>
  );
}
