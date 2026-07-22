"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import PageChromeIcon from "@/components/PageChromeIcon";
import AiMarkdown from "@/components/AiMarkdown";
import type {
  CatalogEntry,
  CommunityManifest,
  InstalledTemplate,
  ResolvedPackage,
} from "@/lib/community/types";
import { displayRating, getLocalRating } from "@/lib/community/ratings";
import type { PackageRating } from "@/lib/community/types";
import {
  effectivePermissions,
  PERMISSION_META,
  trustScore,
} from "@/lib/community/permissions";
import { isFavorite } from "@/lib/community/libraryPrefs";
import {
  canBypassPaidLocks,
  isPaidListing,
} from "@/lib/community/communityPaid";

export function StarRow({
  value,
  onChange,
  size = "md",
}: {
  value: number;
  onChange?: (n: number) => void;
  size?: "sm" | "md";
}) {
  const cls = size === "sm" ? "community-stars is-sm" : "community-stars";
  const interactive = Boolean(onChange);
  const clamped = Math.max(0, Math.min(5, Number.isFinite(value) ? value : 0));
  return (
    <div
      className={cls}
      role={interactive ? "radiogroup" : "img"}
      aria-label={`${clamped.toFixed(1)} 星`}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = interactive
          ? n <= Math.round(clamped)
            ? 1
            : 0
          : Math.max(0, Math.min(1, clamped - (n - 1)));
        return (
          <button
            key={n}
            type="button"
            className={fill >= 0.999 ? "is-on" : fill > 0 ? "is-partial" : ""}
            style={{ ["--star-fill" as string]: `${Math.round(fill * 100)}%` }}
            disabled={!interactive}
            onClick={() => onChange?.(n)}
            aria-label={`${n} 星`}
            aria-checked={interactive ? n === Math.round(clamped) : undefined}
          >
            <span className="community-star-base" aria-hidden>
              ★
            </span>
            <span className="community-star-fill" aria-hidden>
              ★
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function TrustScorecard({ manifest }: { manifest: CommunityManifest }) {
  const trust = trustScore(manifest);
  const perms = effectivePermissions(manifest);
  return (
    <div className={`community-trust is-${trust.level}`}>
      <div className="community-trust-head">
        <strong>{trust.label}</strong>
        <span>{trust.summary}</span>
      </div>
      <ul className="community-perm-list">
        {perms.map((p) => (
          <li key={p} data-risk={PERMISSION_META[p].risk}>
            <strong>{PERMISSION_META[p].label}</strong>
            <span>{PERMISSION_META[p].hint}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PackageCard({
  entry,
  installed,
  href,
  onInstall,
  onOpen,
  busy,
  userRating,
  favorited,
  viewerEmail,
}: {
  entry: CatalogEntry;
  installed: boolean;
  href: string;
  onInstall: () => void;
  onOpen?: () => void;
  busy?: boolean;
  userRating?: PackageRating | null;
  favorited?: boolean;
  /** Used to unlock paid install for allowlisted emails */
  viewerEmail?: string | null;
}) {
  const rating = displayRating(entry.rating, userRating || null);
  const fav = favorited ?? (typeof window !== "undefined" ? isFavorite(entry.id) : false);
  const paid = isPaidListing({ paid: entry.paid });
  const installLocked = paid && !installed && !canBypassPaidLocks(viewerEmail);
  return (
    <article className={`community-card${paid ? " is-paid" : ""}`}>
      {entry.cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="community-card-cover"
          src={entry.cover}
          alt=""
          loading="lazy"
          onError={(e) => {
            const el = e.currentTarget as HTMLImageElement;
            el.style.display = "none";
            const fallback = el.nextElementSibling as HTMLElement | null;
            if (fallback?.classList.contains("community-card-cover-fallback")) {
              fallback.hidden = false;
            }
          }}
        />
      ) : null}
      <div
        className="community-card-cover community-card-cover-fallback"
        hidden={Boolean(entry.cover)}
        aria-hidden={Boolean(entry.cover)}
      >
        <PageChromeIcon
          icon={entry.icon}
          fallback={entry.kind === "extension" ? "extension" : entry.kind === "utility" ? "build" : "description"}
        />
        <span>{entry.name}</span>
      </div>
      {paid ? <span className="community-paid-badge">收費</span> : null}
      <div className="community-card-top">
        <PageChromeIcon
          icon={entry.icon}
          fallback={entry.kind === "extension" ? "extension" : entry.kind === "utility" ? "build" : "description"}
        />
        <div>
          <strong>
            <Link href={href}>{entry.name}</Link>
            {fav ? <span className="community-fav-mark" title="已收藏"> ★</span> : null}
          </strong>
          <span>
            <Link href={`/community/author/${encodeURIComponent(entry.author)}`}>{entry.author}</Link>
            {entry.featured ? " · 精選" : ""}
            {entry.category ? ` · ${entry.category}` : ""}
            {paid ? " · 收費" : " · 免費"}
            {installed ? " · 已安裝" : ""}
            {` · ${entry.kind === "extension" ? "擴充頁面" : entry.kind === "template" ? "模板" : "擴充功能"}`}
          </span>
        </div>
      </div>
      <p>{entry.description}</p>
      <div className="community-card-meta">
        <StarRow value={rating.value} size="sm" />
        <span>{rating.label}</span>
        {typeof entry.downloads === "number" ? (
          <span>
            ·{" "}
            {entry.downloads > 0
              ? `${entry.downloads.toLocaleString()} 次下載`
              : "尚無下載"}
          </span>
        ) : null}
      </div>
      {entry.tags && entry.tags.length > 0 && (
        <div className="community-tags">
          {entry.tags.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      )}
      <div className="community-card-actions">
        <Link className="btn btn-ghost" href={href}>
          詳情
        </Link>
        {installed ? (
          <button type="button" className="btn" disabled={busy} onClick={onOpen}>
            {entry.kind === "template" ? "套用" : "開啟"}
          </button>
        ) : (
          <button
            type="button"
            className="btn"
            disabled={busy || installLocked}
            title={installLocked ? "收費套件：目前尚未開放購買" : undefined}
            onClick={onInstall}
          >
            {installLocked ? "即將開放購買" : "安裝"}
          </button>
        )}
      </div>
    </article>
  );
}

export function TemplatePreviewModal({
  tpl,
  open,
  onClose,
  onApply,
  onInstall,
  busy,
  mode = "apply",
}: {
  tpl: InstalledTemplate | ResolvedPackage;
  open: boolean;
  onClose: () => void;
  onApply?: (folder?: string) => void;
  onInstall?: () => void;
  busy?: boolean;
  mode?: "apply" | "preview";
}) {
  const pages = useMemo(() => {
    if (tpl.manifest.kind !== "template") return [];
    const files = "files" in tpl ? tpl.files : {};
    return tpl.manifest.pages.map((page) => {
      const key = page.file || `inline-${page.title}.md`;
      const body =
        (page.file && files[page.file]) || files[key] || page.body || "";
      return { title: page.title, body, folder: page.folder };
    });
  }, [tpl]);
  const [idx, setIdx] = useState(0);
  const [folder, setFolder] = useState(pages[0]?.folder || "");
  if (!open || tpl.manifest.kind !== "template") return null;
  const cur = pages[idx] || pages[0];
  return (
    <div className="community-detail-backdrop" onClick={onClose}>
      <div className="community-detail community-preview" onClick={(e) => e.stopPropagation()}>
        <header>
          <PageChromeIcon icon={tpl.manifest.icon} fallback="description" />
          <div>
            <h2>預覽：{tpl.manifest.name}</h2>
            <p>
              {pages.length} 頁 · {mode === "preview" ? "安裝後可套用到知識庫" : "套用後會建立到知識庫"}
            </p>
          </div>
          <button type="button" className="community-detail-close" onClick={onClose}>
            ×
          </button>
        </header>
        <TrustScorecard manifest={tpl.manifest} />
        <div className="community-preview-tabs">
          {pages.map((p, i) => (
            <button
              key={p.title}
              type="button"
              className={i === idx ? "is-on" : ""}
              onClick={() => setIdx(i)}
            >
              {p.title}
            </button>
          ))}
        </div>
        <div className="community-preview-body">
          <AiMarkdown text={cur?.body || "_（空白頁）_"} />
        </div>
        {mode === "apply" && (
          <label className="community-folder-field">
            目標資料夾（可空白）
            <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="例如：會議" />
          </label>
        )}
        <div className="community-card-actions">
          {mode === "apply" ? (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => onApply?.(folder.trim() || undefined)}
            >
              確認套用
            </button>
          ) : (
            <button type="button" className="btn" disabled={busy} onClick={() => onInstall?.()}>
              安裝此模板
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

export function InstallConfirmModal({
  pack,
  open,
  busy,
  onClose,
  onConfirm,
  viewerEmail,
}: {
  pack: ResolvedPackage;
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
  viewerEmail?: string | null;
}) {
  if (!open) return null;
  const paid = isPaidListing({ paid: pack.paid, manifestPaid: pack.manifest.paid });
  const installLocked = paid && !canBypassPaidLocks(viewerEmail);
  return (
    <div className="community-detail-backdrop" onClick={onClose}>
      <div className="community-detail" onClick={(e) => e.stopPropagation()}>
        <header>
          <PageChromeIcon
            icon={pack.manifest.icon}
            fallback={pack.manifest.kind === "extension" ? "extension" : "description"}
          />
          <div>
            <h2>確認安裝</h2>
            <p>
              {pack.manifest.name} · v{pack.manifest.version}
              {paid ? " · 收費" : ""}
            </p>
          </div>
          <button type="button" className="community-detail-close" onClick={onClose}>
            ×
          </button>
        </header>
        <TrustScorecard manifest={pack.manifest} />
        <p className="community-detail-desc">
          {installLocked
            ? "此為收費套件：目前尚未開放購買，無法直接安裝／下載。"
            : "請確認權限與來源可信後再安裝。擴充以沙箱 iframe 執行；模板會寫入知識庫。"}
        </p>
        <div className="community-card-actions">
          <button
            type="button"
            className="btn"
            disabled={busy || installLocked}
            onClick={onConfirm}
          >
            {busy ? "安裝中…" : installLocked ? "即將開放購買" : "確認安裝"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

export function RelatedPackages({
  entries,
  installedIds,
  busy,
  onInstall,
  viewerEmail,
}: {
  entries: CatalogEntry[];
  installedIds: Set<string>;
  busy?: boolean;
  onInstall: (entry: CatalogEntry) => void;
  viewerEmail?: string | null;
}) {
  if (!entries.length) return null;
  return (
    <section className="community-related">
      <h3>相關推薦</h3>
      <div className="community-grid">
        {entries.map((entry) => (
          <PackageCard
            key={`${entry.kind}-${entry.id}`}
            entry={entry}
            installed={installedIds.has(entry.id)}
            href={`/community/${entry.id}?kind=${entry.kind}`}
            busy={busy}
            viewerEmail={viewerEmail}
            userRating={getLocalRating(entry.id)}
            onInstall={() => onInstall(entry)}
            onOpen={() => {
              window.location.href =
                entry.kind === "extension"
                  ? `/ext/${entry.id}`
                  : `/community/${entry.id}?kind=template`;
            }}
          />
        ))}
      </div>
    </section>
  );
}


export function PackageDetailBody({
  pack,
  entry,
}: {
  pack: ResolvedPackage;
  entry?: CatalogEntry | null;
}) {
  const [tab, setTab] = useState<"overview" | "readme" | "perms" | "changelog">("overview");
  const shots = pack.manifest.screenshots || entry?.screenshots || [];
  const cover = pack.manifest.cover || entry?.cover;
  const changelog = pack.manifest.changelog || [];
  const readme = pack.readme || "";

  return (
    <div className="community-detail-body">
      {cover ? (
        <div className="community-detail-hero">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="community-detail-cover" src={cover} alt="" />
        </div>
      ) : null}
      {shots.length > 0 && (
        <div className="community-shots">
          {shots.map((s) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={s} src={s} alt="" loading="lazy" />
          ))}
        </div>
      )}

      <nav className="community-detail-tabs" aria-label="套件詳情">
        {(
          [
            { id: "overview" as const, label: "總覽" },
            { id: "readme" as const, label: "說明" },
            { id: "perms" as const, label: "權限" },
            { id: "changelog" as const, label: "更新紀錄" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? "is-on" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="community-detail-tabpanel">
          <p className="community-detail-desc">{pack.manifest.description}</p>
          <dl className="community-detail-dl">
            <div>
              <dt>版本</dt>
              <dd>v{pack.manifest.version}</dd>
            </div>
            <div>
              <dt>作者</dt>
              <dd>
                <Link href={`/community/author/${encodeURIComponent(pack.manifest.author)}`}>
                  {pack.manifest.author}
                </Link>
                {pack.manifest.authorUrl ? (
                  <>
                    {" · "}
                    <a href={pack.manifest.authorUrl} target="_blank" rel="noreferrer">
                      網站
                    </a>
                  </>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>類型</dt>
              <dd>{pack.manifest.kind === "extension" ? "擴充頁面" : "模板"}</dd>
            </div>
            {(pack.manifest.category || entry?.category) && (
              <div>
                <dt>分類</dt>
                <dd>{pack.manifest.category || entry?.category}</dd>
              </div>
            )}
            {pack.manifest.license && (
              <div>
                <dt>授權</dt>
                <dd>{pack.manifest.license}</dd>
              </div>
            )}
            {pack.manifest.minAppVersion && (
              <div>
                <dt>最低版本</dt>
                <dd>≥ {pack.manifest.minAppVersion}</dd>
              </div>
            )}
          </dl>
          <div className="community-ext-links">
            {pack.manifest.homepage && (
              <a href={pack.manifest.homepage} target="_blank" rel="noreferrer">
                首頁
              </a>
            )}
            {pack.manifest.repository && (
              <a href={pack.manifest.repository} target="_blank" rel="noreferrer">
                原始碼
              </a>
            )}
            {pack.manifest.changelogUrl && (
              <a href={pack.manifest.changelogUrl} target="_blank" rel="noreferrer">
                更新日誌網址
              </a>
            )}
          </div>
          {pack.manifest.kind === "extension" && (pack.manifest.settings?.length || 0) > 0 && (
            <div className="community-settings-preview">
              <h3>可調設定</h3>
              <ul>
                {pack.manifest.settings!.map((s) => (
                  <li key={s.key}>
                    <strong>{s.label}</strong>
                    <span>
                      {s.type}
                      {s.default !== undefined ? ` · 預設 ${String(s.default)}` : ""}
                    </span>
                    {s.description ? <em>{s.description}</em> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {pack.manifest.kind === "extension" && (
            <p className="community-detail-meta">
              入口：<code>{pack.manifest.pageType.entry}</code>
              <br />
              以沙箱 iframe 載入（不會執行套件腳本於主程式）。
            </p>
          )}
          {pack.manifest.kind === "template" && (
            <ul className="community-detail-pages">
              {pack.manifest.pages.map((p) => (
                <li key={p.title}>
                  {p.title}
                  {p.folder ? ` · ${p.folder}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "readme" && (
        <div className="community-detail-tabpanel community-readme-md">
          {readme.trim() ? (
            <AiMarkdown text={readme} />
          ) : (
            <p className="community-empty">作者尚未撰寫說明。</p>
          )}
        </div>
      )}

      {tab === "perms" && (
        <div className="community-detail-tabpanel">
          <TrustScorecard manifest={pack.manifest} />
        </div>
      )}

      {tab === "changelog" && (
        <div className="community-detail-tabpanel community-changelog">
          {changelog.length > 0 ? (
            <ol>
              {changelog.map((c) => (
                <li key={`${c.version}-${c.notes}`}>
                  <strong>v{c.version}</strong>
                  {c.date ? <span> · {c.date}</span> : null}
                  <p>{c.notes}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="community-empty">尚無更新紀錄。</p>
          )}
        </div>
      )}
    </div>
  );
}
