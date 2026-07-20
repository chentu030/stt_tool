"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import PageChromeIcon from "@/components/PageChromeIcon";
import AiMarkdown from "@/components/AiMarkdown";
import type { CatalogEntry, CommunityManifest, InstalledTemplate, ResolvedPackage } from "@/lib/community/types";
import { displayRating } from "@/lib/community/ratings";
import type { PackageRating } from "@/lib/community/types";
import {
  effectivePermissions,
  PERMISSION_META,
  trustScore,
} from "@/lib/community/permissions";
import { isFavorite } from "@/lib/community/libraryPrefs";

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
  return (
    <div className={cls} role={onChange ? "radiogroup" : "img"} aria-label={`${value} 星`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={n <= Math.round(value) ? "is-on" : ""}
          disabled={!onChange}
          onClick={() => onChange?.(n)}
          aria-label={`${n} 星`}
        >
          ★
        </button>
      ))}
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
}: {
  entry: CatalogEntry;
  installed: boolean;
  href: string;
  onInstall: () => void;
  onOpen?: () => void;
  busy?: boolean;
  userRating?: PackageRating | null;
  favorited?: boolean;
}) {
  const rating = displayRating(entry.rating, userRating || null);
  const fav = favorited ?? (typeof window !== "undefined" ? isFavorite(entry.id) : false);
  return (
    <article className="community-card">
      {entry.cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="community-card-cover" src={entry.cover} alt="" loading="lazy" />
      ) : null}
      <div className="community-card-top">
        <PageChromeIcon
          icon={entry.icon}
          fallback={entry.kind === "extension" ? "extension" : "description"}
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
            {installed ? " · 已安裝" : ""}
          </span>
        </div>
      </div>
      <p>{entry.description}</p>
      <div className="community-card-meta">
        <StarRow value={rating.value} size="sm" />
        <span>{rating.label}</span>
        {typeof entry.downloads === "number" && (
          <span>· {entry.downloads.toLocaleString()} 次</span>
        )}
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
          <button type="button" className="btn" disabled={busy} onClick={onInstall}>
            安裝
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
  busy,
}: {
  tpl: InstalledTemplate;
  open: boolean;
  onClose: () => void;
  onApply: (folder?: string) => void;
  busy?: boolean;
}) {
  const pages = useMemo(() => {
    return tpl.manifest.pages.map((page) => {
      const key = page.file || `inline-${page.title}.md`;
      const body =
        (page.file && tpl.files[page.file]) || tpl.files[key] || page.body || "";
      return { title: page.title, body, folder: page.folder };
    });
  }, [tpl]);
  const [idx, setIdx] = useState(0);
  const [folder, setFolder] = useState(pages[0]?.folder || "");
  if (!open) return null;
  const cur = pages[idx] || pages[0];
  return (
    <div className="community-detail-backdrop" onClick={onClose}>
      <div className="community-detail community-preview" onClick={(e) => e.stopPropagation()}>
        <header>
          <PageChromeIcon icon={tpl.manifest.icon} fallback="description" />
          <div>
            <h2>預覽：{tpl.manifest.name}</h2>
            <p>
              {pages.length} 頁 · 套用後會建立到知識庫
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
        <label className="community-folder-field">
          目標資料夾（可空白）
          <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="例如：會議" />
        </label>
        <div className="community-card-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => onApply(folder.trim() || undefined)}>
            確認套用
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

export function PackageDetailBody({
  pack,
  entry,
}: {
  pack: ResolvedPackage;
  entry?: CatalogEntry | null;
}) {
  const shots = pack.manifest.screenshots || entry?.screenshots || [];
  const cover = pack.manifest.cover || entry?.cover;
  const changelog = pack.manifest.changelog || [];
  return (
    <div className="community-detail-body">
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="community-detail-cover" src={cover} alt="" />
      ) : null}
      {shots.length > 0 && (
        <div className="community-shots">
          {shots.map((s) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={s} src={s} alt="" loading="lazy" />
          ))}
        </div>
      )}
      <p className="community-detail-desc">{pack.manifest.description}</p>
      <TrustScorecard manifest={pack.manifest} />
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
          <dd>{pack.manifest.kind === "extension" ? "擴充功能" : "模板"}</dd>
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
      {pack.manifest.kind === "extension" && (
        <p className="community-detail-meta">
          入口：<code>{pack.manifest.pageType.entry}</code>
          <br />
          以沙箱 iframe 載入（不會執行套件內任意腳本於主程式）。
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
      {changelog.length > 0 && (
        <div className="community-changelog">
          <h3>更新日誌</h3>
          <ol>
            {changelog.map((c) => (
              <li key={`${c.version}-${c.notes}`}>
                <strong>v{c.version}</strong>
                {c.date ? <span> · {c.date}</span> : null}
                <p>{c.notes}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
      {pack.readme && (
        <div className="community-readme-md">
          <h3>說明</h3>
          <AiMarkdown text={pack.readme} />
        </div>
      )}
    </div>
  );
}
