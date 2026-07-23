"use client";

import { useState } from "react";
import {
  JournalStats,
  heatWeeks,
  type JournalTagDef,
} from "@/lib/journalMeta";
import { NoteHandoffLinks } from "@/components/shell/ContinueChips";

type Props = {
  stats: JournalStats;
  dateKey: string;
  noteId?: string | null;
  noteTitle?: string;
  tagDefs?: JournalTagDef[];
  onAskAi: (prompt: string) => Promise<string>;
};

export default function JournalAside({
  stats,
  dateKey,
  noteId,
  noteTitle,
  tagDefs = [],
  onAskAi,
}: Props) {
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const heat = heatWeeks(stats.filledDays, 14);

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

  const tagRows = (() => {
    const counts = stats.tagCounts || {};
    const rows = tagDefs
      .map((t) => ({ ...t, count: counts[t.id] || 0 }))
      .filter((t) => t.count > 0);
    // Include orphan tags from entries that were deleted from prefs
    for (const [id, count] of Object.entries(counts)) {
      if (!tagDefs.some((t) => t.id === id) && count > 0) {
        rows.push({ id, label: id, color: "#94A3B8", count });
      }
    }
    return rows.sort((a, b) => b.count - a.count).slice(0, 12);
  })();

  return (
    <aside className="jn-aside">
      {noteId && (
        <section className="jn-aside-block">
          <h3>今日筆記</h3>
          <p className="jn-muted" style={{ marginBottom: "0.4rem" }}>
            {noteTitle || dateKey}
          </p>
          <NoteHandoffLinks noteId={noteId} title={noteTitle || dateKey} />
        </section>
      )}

      <section className="jn-aside-block">
        <h3>節奏</h3>
        <div className="jn-stat-grid">
          <div><strong>{stats.streak}</strong><span>連續天</span></div>
          <div><strong>{stats.longestStreak}</strong><span>最長連續</span></div>
          <div><strong>{stats.thisWeek}</strong><span>本週</span></div>
          <div><strong>{stats.thisMonth}</strong><span>本月</span></div>
          <div><strong>{stats.total}</strong><span>總篇數</span></div>
          <div><strong>{stats.avgWords}</strong><span>平均字數</span></div>
        </div>
      </section>

      <section className="jn-aside-block">
        <h3>近 14 週熱力</h3>
        <div className="jn-heat" title="有寫的日子會亮起">
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
      </section>

      {tagRows.length > 0 && (
        <section className="jn-aside-block">
          <h3>標籤分布</h3>
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
          <button type="button" className="btn btn-soft btn-sm" disabled={aiBusy} onClick={() => void run(`請用繁體中文，為 ${dateKey} 這天寫一段溫和的日誌開場白（3-5 句），不要說教。`)}>
            開場白
          </button>
          <button type="button" className="btn btn-soft btn-sm" disabled={aiBusy} onClick={() => void run(`用繁體中文給我 5 個適合在 ${dateKey} 寫的反思問題。`)}>
            反思問題
          </button>
          <button type="button" className="btn btn-soft btn-sm" disabled={aiBusy} onClick={() => void run(`我本週寫了 ${stats.thisWeek} 篇日誌、連續 ${stats.streak} 天。用繁體中文給我一段鼓勵與下週建議（簡短）。`)}>
            本週鼓勵
          </button>
        </div>
        {aiBusy && <p className="jn-muted">產生中…</p>}
        {aiError && <p className="jn-error">{aiError}</p>}
        {aiText && <div className="jn-ai-out">{aiText}</div>}
      </section>
    </aside>
  );
}
