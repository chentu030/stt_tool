"use client";

import { useState } from "react";
import {
  BoardStats,
  PRIORITIES,
  BOARD_COLUMNS,
} from "@/lib/boardMeta";

type Props = {
  stats: BoardStats;
  onAiTriage: () => void;
  onAiScaffold: (description: string) => void;
  aiBusy: boolean;
  aiText: string;
  aiError: string;
};

export default function BoardAside({
  stats,
  onAiTriage,
  onAiScaffold,
  aiBusy,
  aiText,
  aiError,
}: Props) {
  const [scaffold, setScaffold] = useState("");
  return (
    <aside className="bd-aside">
      <section className="bd-aside-block">
        <h3>進度</h3>
        <div className="bd-stat-grid">
          <div><strong>{stats.total}</strong><span>卡片</span></div>
          <div><strong>{stats.doneRate}%</strong><span>完成率</span></div>
          <div><strong>{stats.backlog}</strong><span>待辦</span></div>
          <div><strong className={!stats.wipOk ? "is-warn" : ""}>{stats.doing}</strong><span>進行中</span></div>
          <div><strong>{stats.done}</strong><span>完成</span></div>
          <div><strong className={stats.overdue ? "is-warn" : ""}>{stats.overdue}</strong><span>逾期</span></div>
          <div><strong>{stats.stale}</strong><span>過期未動</span></div>
          <div><strong>{stats.wipOk ? "OK" : "!"}</strong><span>WIP</span></div>
        </div>
        <div className="bd-progress">
          <div style={{ width: `${stats.doneRate}%` }} />
        </div>
      </section>

      <section className="bd-aside-block">
        <h3>優先級</h3>
        <ul className="bd-pri-list">
          {PRIORITIES.map((p) => (
            <li key={p.id}>
              <i style={{ background: p.color }} />
              <span>{p.label}</span>
              <em>{stats.byPriority[p.id]}</em>
            </li>
          ))}
        </ul>
      </section>

      <section className="bd-aside-block">
        <h3>資料夾</h3>
        {stats.byFolder.length === 0 ? (
          <p className="bd-muted">尚無資料夾分類</p>
        ) : (
          <ul className="bd-folder-list">
            {stats.byFolder.slice(0, 10).map((f) => (
              <li key={f.name}>
                <span>{f.name}</span>
                <em>{f.count}</em>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bd-aside-block">
        <h3>欄位提示</h3>
        <ul className="bd-tips">
          {BOARD_COLUMNS.map((c) => (
            <li key={c.id}>
              <strong>{c.label}</strong> — {c.hint}
              {c.wipLimit ? `（建議 ≤ ${c.wipLimit}）` : ""}
            </li>
          ))}
        </ul>
      </section>

      <section className="bd-aside-block">
        <h3>AI 分派</h3>
        <button type="button" className="btn btn-soft btn-sm" disabled={aiBusy} onClick={onAiTriage}>
          {aiBusy ? "分析中…" : "建議待辦怎麼排"}
        </button>
        <form
          className="bd-ai-scaffold"
          onSubmit={(e) => {
            e.preventDefault();
            if (!scaffold.trim()) return;
            onAiScaffold(scaffold.trim());
            setScaffold("");
          }}
        >
          <textarea
            className="input"
            rows={2}
            placeholder="描述專案，AI 幫你生看板卡片…"
            value={scaffold}
            disabled={aiBusy}
            onChange={(e) => setScaffold(e.target.value)}
          />
          <button type="submit" className="btn btn-sm" disabled={aiBusy || !scaffold.trim()}>
            AI 建立卡片
          </button>
        </form>
        {aiError && <p className="bd-error">{aiError}</p>}
        {aiText && <div className="bd-ai-out">{aiText}</div>}
      </section>
    </aside>
  );
}
