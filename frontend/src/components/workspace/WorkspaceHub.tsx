"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import PageChromeIcon from "@/components/PageChromeIcon";
import type { HubTemplate } from "@/lib/workspaceHubTemplates";

export function HubPreview({ kind }: { kind: "board" | "canvas" | "graph" | "database" }) {
  if (kind === "board") {
    return (
      <div className="ws-hub-preview ws-hub-preview--board" aria-hidden>
        {[0, 1, 2].map((col) => (
          <div key={col} className="ws-hub-preview-col">
            <i />
            <span />
            <span />
            {col < 2 ? <span /> : null}
          </div>
        ))}
      </div>
    );
  }
  if (kind === "canvas") {
    return (
      <div className="ws-hub-preview ws-hub-preview--canvas" aria-hidden>
        <span className="ws-hub-preview-sticky" style={{ left: "12%", top: "18%" }} />
        <span className="ws-hub-preview-sticky is-alt" style={{ left: "48%", top: "28%" }} />
        <span className="ws-hub-preview-sticky" style={{ left: "28%", top: "58%" }} />
        <svg viewBox="0 0 120 72" className="ws-hub-preview-lines">
          <path d="M28 28 L58 36" />
          <path d="M58 36 L42 52" />
        </svg>
      </div>
    );
  }
  if (kind === "graph") {
    return (
      <div className="ws-hub-preview ws-hub-preview--graph" aria-hidden>
        <svg viewBox="0 0 120 72">
          <line x1="28" y1="36" x2="60" y2="22" />
          <line x1="60" y1="22" x2="92" y2="38" />
          <line x1="28" y1="36" x2="58" y2="52" />
          <line x1="58" y1="52" x2="92" y2="38" />
          <circle cx="28" cy="36" r="7" className="is-a" />
          <circle cx="60" cy="22" r="6" className="is-b" />
          <circle cx="92" cy="38" r="7" className="is-a" />
          <circle cx="58" cy="52" r="5" className="is-c" />
        </svg>
      </div>
    );
  }
  return (
    <div className="ws-hub-preview ws-hub-preview--database" aria-hidden>
      <div className="ws-hub-preview-table">
        <b />
        <b />
        <b />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
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
  children,
}: HubShellProps) {
  return (
    <div className="db-hub ws-hub">
      <header className="db-hub-hero page-chrome">
        <div>
          <h1 className="page-title font-display">{title}</h1>
          <p className="page-sub">{subtitle}</p>
          <div className="db-hub-stats" aria-label="統計">
            {stats.map((s) => (
              <span key={s.label}>
                <strong>{s.value}</strong> {s.label}
              </span>
            ))}
          </div>
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
      <div className="db-hub-templates">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            className="db-hub-template-card ws-hub-template"
            disabled={busy}
            onClick={() => onPick(t.id)}
          >
            <HubPreview kind={t.preview} />
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
    <div className="db-hub-toolbar">
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
