"use client";

import Link from "next/link";
import {
  GRAPH_TIPS,
  GraphNode,
  GraphStats,
  suggestMissingLinks,
  GraphBundle,
  neighborsOf,
} from "@/lib/graphModel";

type Props = {
  stats: GraphStats;
  bundle: GraphBundle;
  selectedId: string | null;
  hubs: GraphNode[];
  orphans: GraphNode[];
  ghosts: GraphNode[];
  folders: { name: string; count: number }[];
  tags: { name: string; count: number }[];
  pathInfo: string;
  onSelect: (id: string) => void;
  onEgo: (id: string | null) => void;
  egoId: string;
  onAskAi: () => void;
  aiBusy: boolean;
  aiText: string;
  aiError: string;
  onCreateGhost?: (title: string) => void;
};

export default function GraphAside({
  stats,
  bundle,
  selectedId,
  hubs,
  orphans,
  ghosts,
  folders,
  tags,
  pathInfo,
  onSelect,
  onEgo,
  egoId,
  onAskAi,
  aiBusy,
  aiText,
  aiError,
  onCreateGhost,
}: Props) {
  const selected = selectedId ? bundle.byId.get(selectedId) : null;
  const neigh = selected ? neighborsOf(bundle, selected.id) : null;
  const suggestions =
    selected && selected.kind === "note" ? suggestMissingLinks(bundle, selected.id, 6) : [];

  return (
    <aside className="gp-aside">
      <section className="gp-aside-block">
        <h3>圖譜概況</h3>
        <div className="gp-stat-grid">
          <div><strong>{stats.notes}</strong><span>筆記</span></div>
          <div><strong>{stats.wikiEdges}</strong><span>Wiki 邊</span></div>
          <div><strong>{stats.linkedNotes}</strong><span>已連結</span></div>
          <div><strong>{stats.orphans}</strong><span>孤兒</span></div>
          <div><strong>{stats.ghosts}</strong><span>幽靈</span></div>
          <div><strong>{stats.hubs}</strong><span>樞紐</span></div>
          <div><strong>{stats.components}</strong><span>分量</span></div>
          <div><strong>{stats.avgDegree}</strong><span>平均度</span></div>
          <div><strong>{stats.density}</strong><span>密度</span></div>
          <div><strong>{stats.maxDegree}</strong><span>最大度</span></div>
        </div>
      </section>

      {pathInfo && (
        <section className="gp-aside-block">
          <h3>路徑</h3>
          <p className="gp-path-info">{pathInfo}</p>
        </section>
      )}

      {selected && (
        <section className="gp-aside-block">
          <h3>選中節點</h3>
          <div className="gp-selected">
            <strong>{selected.title}</strong>
            <span className="gp-kind">{selected.kind}</span>
            {selected.folder ? <span className="gp-meta">📁 {selected.folder}</span> : null}
            {selected.tags.length > 0 && (
              <div className="gp-tags">
                {selected.tags.slice(0, 8).map((t) => (
                  <em key={t}>#{t}</em>
                ))}
              </div>
            )}
            <p className="gp-meta">
              出鏈 {selected.outDegree} · 入鏈 {selected.inDegree} · 字數 {selected.words}
            </p>
            <div className="gp-selected-actions">
              {selected.noteId && (
                <Link href={`/notes/${selected.noteId}`} className="btn btn-soft btn-sm">
                  開啟筆記
                </Link>
              )}
              {selected.kind === "ghost" && onCreateGhost && (
                <button
                  type="button"
                  className="btn btn-soft btn-sm"
                  onClick={() => onCreateGhost(selected.title)}
                >
                  建立此筆記
                </button>
              )}
              <button
                type="button"
                className="btn btn-soft btn-sm"
                onClick={() => onEgo(egoId === selected.id ? null : selected.id)}
              >
                {egoId === selected.id ? "取消焦點" : "焦點鄰居"}
              </button>
            </div>
          </div>

          {neigh && (
            <>
              {neigh.outbound.length > 0 && (
                <div className="gp-neigh">
                  <h4>出鏈</h4>
                  <ul>
                    {neigh.outbound.slice(0, 10).map((n) => (
                      <li key={n.id}>
                        <button type="button" onClick={() => onSelect(n.id)}>{n.title}</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {neigh.inbound.length > 0 && (
                <div className="gp-neigh">
                  <h4>入鏈</h4>
                  <ul>
                    {neigh.inbound.slice(0, 10).map((n) => (
                      <li key={n.id}>
                        <button type="button" onClick={() => onSelect(n.id)}>{n.title}</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {suggestions.length > 0 && (
                <div className="gp-neigh">
                  <h4>建議補連</h4>
                  <ul>
                    {suggestions.map((n) => (
                      <li key={n.id}>
                        <button type="button" onClick={() => onSelect(n.id)}>{n.title}</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      )}

      <section className="gp-aside-block">
        <h3>樞紐節點</h3>
        {hubs.length === 0 ? (
          <p className="gp-muted">尚無明顯樞紐（多寫 [[連結]]）</p>
        ) : (
          <ul className="gp-rank">
            {hubs.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => onSelect(n.id)}>
                  <strong>{n.title}</strong>
                  <em>{n.outDegree}→ / ←{n.inDegree}</em>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="gp-aside-block">
        <h3>幽靈連結</h3>
        {ghosts.length === 0 ? (
          <p className="gp-muted">沒有未建立的標題</p>
        ) : (
          <ul className="gp-rank">
            {ghosts.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => onSelect(n.id)}>
                  <strong>[[{n.title}]]</strong>
                  <em>×{n.inDegree}</em>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="gp-aside-block">
        <h3>孤兒筆記</h3>
        {orphans.length === 0 ? (
          <p className="gp-muted">全部都有連線</p>
        ) : (
          <ul className="gp-rank">
            {orphans.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => onSelect(n.id)}>
                  <strong>{n.title}</strong>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="gp-aside-block">
        <h3>資料夾</h3>
        <ul className="gp-bucket">
          {folders.slice(0, 10).map((f) => (
            <li key={f.name}>
              <span>{f.name}</span>
              <em>{f.count}</em>
            </li>
          ))}
        </ul>
      </section>

      <section className="gp-aside-block">
        <h3>熱門標籤</h3>
        <ul className="gp-bucket">
          {tags.slice(0, 12).map((t) => (
            <li key={t.name}>
              <span>#{t.name}</span>
              <em>{t.count}</em>
            </li>
          ))}
          {tags.length === 0 && <li className="gp-muted">尚無標籤</li>}
        </ul>
      </section>

      <section className="gp-aside-block">
        <h3>AI 圖譜洞察</h3>
        <button type="button" className="btn btn-soft btn-sm" disabled={aiBusy} onClick={onAskAi}>
          {aiBusy ? "分析中…" : "分析知識結構"}
        </button>
        {aiError && <p className="gp-error">{aiError}</p>}
        {aiText && <div className="gp-ai-out">{aiText}</div>}
      </section>

      <section className="gp-aside-block">
        <h3>提示</h3>
        <ul className="gp-tips">
          {GRAPH_TIPS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
