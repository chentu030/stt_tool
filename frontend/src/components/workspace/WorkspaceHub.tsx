"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import PageChromeIcon from "@/components/PageChromeIcon";
import type { HubTemplate } from "@/lib/workspaceHubTemplates";

export type BoardPreviewMetrics = {
  backlog: number;
  doing: number;
  done: number;
  overdue?: number;
};

export type CanvasPreviewMetrics = {
  stickies: number;
  shapes: number;
  edges: number;
  pins: number;
  media: number;
  colors?: string[];
};

export type GraphPreviewMetrics = {
  nodes: number;
  edges: number;
  hubs: number;
  orphans?: number;
};

export type DatabasePreviewMetrics = {
  rows: number;
  segments?: { label: string; count: number; color?: string }[];
};

function cardsForCount(n: number, max = 4): number {
  if (n <= 0) return 1;
  return Math.min(max, Math.max(1, Math.ceil(n / Math.max(1, Math.ceil(n / max)))));
}

export function HubPreview({
  kind,
  board,
  canvas,
  graph,
  database,
  large,
}: {
  kind: "board" | "canvas" | "graph" | "database";
  board?: BoardPreviewMetrics;
  canvas?: CanvasPreviewMetrics;
  graph?: GraphPreviewMetrics;
  database?: DatabasePreviewMetrics;
  large?: boolean;
}) {
  if (kind === "board") {
    const cols = [
      { key: "backlog", n: board?.backlog ?? 2, color: "#94A3B8" },
      { key: "doing", n: board?.doing ?? 2, color: "#0D9488" },
      { key: "done", n: board?.done ?? 1, color: "#34D399" },
    ];
    return (
      <div className={`ws-hub-preview ws-hub-preview--board${large ? " is-large" : ""}`} aria-hidden>
        {cols.map((col) => (
          <div key={col.key} className="ws-hub-preview-col">
            <i style={{ background: col.color }} />
            {Array.from({ length: cardsForCount(col.n) }).map((_, i) => (
              <span key={i} style={{ borderTop: `2px solid ${col.color}` }} />
            ))}
            <em>{col.n}</em>
          </div>
        ))}
      </div>
    );
  }

  if (kind === "canvas") {
    const colors = canvas?.colors?.length
      ? canvas.colors
      : ["#0D9488", "#0369A1", "#B45309", "#7C3AED"];
    const count = Math.max(3, Math.min(7, (canvas?.stickies || 3) + (canvas?.shapes ? 1 : 0)));
    const positions = [
      { left: "10%", top: "14%", w: 38, h: 28 },
      { left: "42%", top: "22%", w: 44, h: 30 },
      { left: "22%", top: "52%", w: 36, h: 26 },
      { left: "58%", top: "48%", w: 40, h: 28 },
      { left: "72%", top: "16%", w: 32, h: 24 },
      { left: "8%", top: "68%", w: 34, h: 22 },
      { left: "48%", top: "70%", w: 30, h: 20 },
    ];
    return (
      <div className={`ws-hub-preview ws-hub-preview--canvas${large ? " is-large" : ""}`} aria-hidden>
        {positions.slice(0, count).map((p, i) => (
          <span
            key={i}
            className="ws-hub-preview-sticky"
            style={{
              left: p.left,
              top: p.top,
              width: p.w,
              height: p.h,
              background: `color-mix(in srgb, ${colors[i % colors.length]} 28%, var(--bg-card))`,
              borderColor: `color-mix(in srgb, ${colors[i % colors.length]} 40%, var(--border))`,
            }}
          />
        ))}
        {(canvas?.edges ?? 1) > 0 && (
          <svg viewBox="0 0 120 72" className="ws-hub-preview-lines">
            <path d="M28 28 L58 36" />
            <path d="M58 36 L42 52" />
            <path d="M70 30 L88 24" />
          </svg>
        )}
        <div className="ws-hub-preview-badge">
          {(canvas?.stickies || 0) + (canvas?.shapes || 0) + (canvas?.pins || 0) || "空白"} 物件
        </div>
      </div>
    );
  }

  if (kind === "graph") {
    const n = Math.max(4, Math.min(8, graph?.nodes || 4));
    const pts = [
      [28, 36],
      [60, 22],
      [92, 38],
      [58, 52],
      [40, 18],
      [78, 58],
      [18, 54],
      [100, 22],
    ].slice(0, n);
    return (
      <div className={`ws-hub-preview ws-hub-preview--graph${large ? " is-large" : ""}`} aria-hidden>
        <svg viewBox="0 0 120 72">
          {pts.map((a, i) =>
            pts.slice(i + 1).map((b, j) =>
              (i + j) % 2 === 0 ? (
                <line key={`${i}-${j}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />
              ) : null
            )
          )}
          {pts.map((p, i) => (
            <circle
              key={i}
              cx={p[0]}
              cy={p[1]}
              r={i < (graph?.hubs || 1) ? 7 : 5}
              className={i % 3 === 0 ? "is-a" : i % 3 === 1 ? "is-b" : "is-c"}
            />
          ))}
        </svg>
        <div className="ws-hub-preview-badge">
          {graph?.nodes ?? 0} 節點 · {graph?.edges ?? 0} 邊
        </div>
      </div>
    );
  }

  const segs = database?.segments?.length
    ? database.segments
    : [
        { label: "A", count: 3, color: "#0D9488" },
        { label: "B", count: 2, color: "#0369A1" },
        { label: "C", count: 1, color: "#B45309" },
      ];
  const total = segs.reduce((a, s) => a + s.count, 0) || 1;
  return (
    <div className={`ws-hub-preview ws-hub-preview--database${large ? " is-large" : ""}`} aria-hidden>
      <div className="ws-hub-preview-table">
        <b />
        <b />
        <b />
        {Array.from({ length: 6 }).map((_, i) => (
          <i key={i} />
        ))}
      </div>
      <div className="ws-hub-preview-bars">
        {segs.slice(0, 5).map((s) => (
          <span
            key={s.label}
            title={`${s.label} ${s.count}`}
            style={{
              flex: Math.max(0.08, s.count / total),
              background: s.color || "var(--accent)",
            }}
          />
        ))}
      </div>
      <div className="ws-hub-preview-badge">{database?.rows ?? 0} 列</div>
    </div>
  );
}

export function HubMetricRow({ items }: { items: { label: string; value: string | number; warn?: boolean }[] }) {
  return (
    <div className="ws-hub-metrics">
      {items.map((it) => (
        <span key={it.label} className={it.warn ? "is-warn" : ""}>
          <strong>{it.value}</strong>
          {it.label}
        </span>
      ))}
    </div>
  );
}

type HubShellProps = {
  title: string;
  subtitle: string;
  stats: { label: string; value: string | number }[];
  primaryLabel: string;
  primaryBusy?: boolean;
  onPrimary: () => void;
  secondaryHref?: string;
  secondaryLabel?: string;
  toolbar?: ReactNode;
  featured?: ReactNode;
  children: ReactNode;
};

export function HubShell({
  title,
  subtitle,
  stats,
  primaryLabel,
  primaryBusy,
  onPrimary,
  secondaryHref,
  secondaryLabel,
  toolbar,
  featured,
  children,
}: HubShellProps) {
  return (
    <div className="db-hub ws-hub ws-hub--dense">
      <header className="db-hub-hero ws-hub-hero page-chrome">
        <div className="ws-hub-hero-copy">
          <h1 className="page-title font-display">{title}</h1>
          <p className="page-sub">{subtitle}</p>
          <div className="db-hub-stats ws-hub-stat-pills" aria-label="統計">
            {stats.map((s) => (
              <span key={s.label} className="ws-hub-stat-pill">
                <strong>{s.value}</strong>
                <em>{s.label}</em>
              </span>
            ))}
          </div>
          <div className="db-hub-hero-actions">
            <button type="button" className="btn" disabled={primaryBusy} onClick={onPrimary}>
              {primaryBusy ? "…" : primaryLabel}
            </button>
            {secondaryHref && secondaryLabel ? (
              <Link className="btn btn-ghost" href={secondaryHref}>
                {secondaryLabel}
              </Link>
            ) : null}
          </div>
        </div>
        {featured ? <div className="ws-hub-hero-featured">{featured}</div> : null}
      </header>
      {toolbar}
      {children}
    </div>
  );
}

export function HubTemplateWall({
  title,
  hint,
  templates,
  busy,
  onPick,
}: {
  title: string;
  hint: string;
  templates: HubTemplate[];
  busy?: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <section className="db-hub-empty">
      <h2>{title}</h2>
      <p>選一個起點，之後仍可自由調整。</p>
      <div className="db-hub-templates ws-hub-templates">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            className="db-hub-template-card ws-hub-template"
            disabled={busy}
            onClick={() => onPick(t.id)}
          >
            <HubPreview kind={t.preview} large />
            <div className="ws-hub-template-meta">
              <PageChromeIcon icon={t.icon} fallback="widgets" />
              <strong>{t.name}</strong>
              <span>{t.description}</span>
              <div className="db-hub-chips">
                {t.chips.map((c) => (
                  <em key={c}>{c}</em>
                ))}
              </div>
            </div>
          </button>
        ))}
      </div>
      <p className="db-hub-hint">{hint}</p>
    </section>
  );
}

export function HubToolbar({
  q,
  onQ,
  sort,
  onSort,
  sortOptions,
  layout,
  onLayout,
  searchPlaceholder,
}: {
  q: string;
  onQ: (v: string) => void;
  sort: string;
  onSort: (v: string) => void;
  sortOptions: { value: string; label: string }[];
  layout: "grid" | "list";
  onLayout: (v: "grid" | "list") => void;
  searchPlaceholder: string;
}) {
  return (
    <div className="db-hub-toolbar ws-hub-toolbar">
      <input
        className="db-hub-search"
        value={q}
        onChange={(e) => onQ(e.target.value)}
        placeholder={searchPlaceholder}
        aria-label="搜尋"
      />
      <select
        className="db-hub-select"
        value={sort}
        onChange={(e) => onSort(e.target.value)}
        aria-label="排序"
      >
        {sortOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <div className="db-hub-layout" role="group" aria-label="版面">
        <button type="button" className={layout === "grid" ? "is-on" : ""} onClick={() => onLayout("grid")}>
          網格
        </button>
        <button type="button" className={layout === "list" ? "is-on" : ""} onClick={() => onLayout("list")}>
          列表
        </button>
      </div>
    </div>
  );
}
