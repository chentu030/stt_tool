"use client";

import PageLoading from "@/components/motion/PageLoading";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { loginWithGoogle } from "@/lib/firebase";
import { useCommunity } from "@/components/community/CommunityProvider";
import { getCatalog } from "@/lib/community/builtins";
import {
  applyInstalledTemplate,
  installFromFile,
  installFromSource,
  resolveAnySource,
} from "@/lib/community/actions";
import {
  setExtensionEnabled,
  setTemplateEnabled,
  uninstallExtension,
  uninstallTemplate,
} from "@/lib/community/store";
import type { CatalogEntry, ResolvedPackage } from "@/lib/community/types";
import PageChromeIcon from "@/components/PageChromeIcon";
import ScrambleText from "@/components/motion/ScrambleText";
import { askPrompt } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import { touchRecentId } from "@/lib/userPrefs";
import { usePrefs } from "@/components/PrefsProvider";

type Tab = "extensions" | "templates" | "installed";

export default function CommunityStorePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const prefsCtx = usePrefs();
  const { extensions, templates, enabledExtensions, ready } = useCommunity();
  const [tab, setTab] = useState<Tab>("extensions");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<ResolvedPackage | null>(null);
  const [detailEntry, setDetailEntry] = useState<CatalogEntry | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const catalog = useMemo(() => getCatalog(), []);

  const installedExtIds = useMemo(() => new Set(extensions.map((e) => e.id)), [extensions]);
  const installedTplIds = useMemo(() => new Set(templates.map((t) => t.id)), [templates]);

  const filteredCatalog = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return catalog.filter((c) => {
      if (tab === "extensions" && c.kind !== "extension") return false;
      if (tab === "templates" && c.kind !== "template") return false;
      if (!qq) return true;
      return (
        c.name.toLowerCase().includes(qq) ||
        c.description.toLowerCase().includes(qq) ||
        c.author.toLowerCase().includes(qq) ||
        (c.tags || []).some((t) => t.toLowerCase().includes(qq))
      );
    });
  }, [catalog, q, tab]);

  const openDetail = async (entry: CatalogEntry) => {
    setBusy(true);
    setDetailEntry(entry);
    try {
      const pack = await resolveAnySource(entry.source);
      setDetail(pack);
    } catch (e) {
      toast(e instanceof Error ? e.message : "無法載入套件詳情");
      setDetail(null);
    } finally {
      setBusy(false);
    }
  };

  const doInstall = async (source: string) => {
    if (!user) return;
    setBusy(true);
    try {
      const result = await installFromSource(user.uid, source);
      toast(result.kind === "extension" ? "已安裝擴充功能" : "已安裝模板");
      setDetail(null);
      setDetailEntry(null);
      if (result.kind === "extension") setTab("installed");
    } catch (e) {
      toast(e instanceof Error ? e.message : "安裝失敗");
    } finally {
      setBusy(false);
    }
  };

  const doImportFile = async (file: File) => {
    if (!user) return;
    setBusy(true);
    try {
      const result = await installFromFile(user.uid, file);
      toast(result.kind === "extension" ? "已匯入擴充功能" : "已匯入模板");
      setTab("installed");
    } catch (e) {
      toast(e instanceof Error ? e.message : "匯入失敗");
    } finally {
      setBusy(false);
    }
  };

  const doGithub = async () => {
    if (!user) return;
    const raw = await askPrompt({
      title: "從 GitHub 安裝",
      message: "輸入 owner/repo、GitHub 網址，或 albireus.json／.zip 的 https 連結",
      placeholder: "owner/repo",
    });
    if (!raw?.trim()) return;
    await doInstall(raw.trim());
  };

  const applyTpl = async (id: string) => {
    if (!user) return;
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    setBusy(true);
    try {
      const { firstId } = await applyInstalledTemplate(user.uid, tpl);
      prefsCtx.setPrefs((p) => touchRecentId(p, firstId));
      toast("已套用模板");
      router.push(`/notes/${firstId}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "套用失敗");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <PageLoading />;
  if (!user) {
    return (
      <div className="community-page">
        <ScrambleText words="社群" as="h1" className="page-title font-display" />
        <p className="page-sub">登入後瀏覽擴充功能與模板商店。</p>
        <button type="button" className="btn" onClick={() => void loginWithGoogle()}>
          登入
        </button>
      </div>
    );
  }

  return (
    <div className="community-page">
      <div className="community-hero page-chrome">
        <div>
          <ScrambleText words="社群商店" as="h1" className="page-title font-display" />
          <p className="page-sub">
            擴充功能像 Chrome 商店／Obsidian 外掛；模板像 Notion 模板庫。可從精選目錄、GitHub 或本機檔案安裝。
            範例檔：
            <a href="/samples/albireus-extension-sample.json" download>
              擴充 JSON
            </a>
            、
            <a href="/samples/albireus-template-sample.json" download>
              模板 JSON
            </a>
            。
          </p>
        </div>
        <div className="community-hero-actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void doGithub()}>
            從 GitHub 安裝
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            匯入檔案
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,.json,application/zip,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void doImportFile(f);
            }}
          />
        </div>
      </div>

      <div className="community-toolbar">
        <div className="community-tabs" role="tablist">
          {(
            [
              ["extensions", "擴充功能"],
              ["templates", "模板"],
              ["installed", "已安裝"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              className={tab === id ? "is-on" : ""}
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
              {id === "installed" && (
                <span className="community-tab-count">{extensions.length + templates.length}</span>
              )}
            </button>
          ))}
        </div>
        {tab !== "installed" && (
          <input
            className="community-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜尋名稱、作者、標籤…"
            aria-label="搜尋"
          />
        )}
      </div>

      {tab === "installed" ? (
        <div className="community-installed">
          <section>
            <h2>擴充功能（{extensions.length}）</h2>
            {extensions.length === 0 ? (
              <p className="community-empty">尚未安裝擴充。到「擴充功能」分頁安裝後，會出現在側欄「頁面」。</p>
            ) : (
              <div className="community-grid">
                {extensions.map((ext) => (
                  <article key={ext.id} className="community-card">
                    <div className="community-card-top">
                      <PageChromeIcon icon={ext.manifest.icon} fallback="extension" />
                      <div>
                        <strong>{ext.manifest.name}</strong>
                        <span>{ext.manifest.author} · v{ext.manifest.version}</span>
                      </div>
                    </div>
                    <p>{ext.manifest.description}</p>
                    <div className="community-card-actions">
                      <Link className="btn btn-ghost" href={`/ext/${ext.id}`}>
                        開啟
                      </Link>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busy}
                        onClick={() =>
                          void setExtensionEnabled(user.uid, ext.id, !ext.enabled).then(() =>
                            toast(ext.enabled ? "已停用" : "已啟用")
                          )
                        }
                      >
                        {ext.enabled ? "停用" : "啟用"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busy}
                        onClick={() =>
                          void uninstallExtension(user.uid, ext.id).then(() => toast("已解除安裝"))
                        }
                      >
                        解除安裝
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
          <section>
            <h2>模板（{templates.length}）</h2>
            {templates.length === 0 ? (
              <p className="community-empty">尚未安裝模板。</p>
            ) : (
              <div className="community-grid">
                {templates.map((tpl) => (
                  <article key={tpl.id} className="community-card">
                    <div className="community-card-top">
                      <PageChromeIcon icon={tpl.manifest.icon} fallback="description" />
                      <div>
                        <strong>{tpl.manifest.name}</strong>
                        <span>
                          {tpl.manifest.author} · {tpl.manifest.pages.length} 頁
                        </span>
                      </div>
                    </div>
                    <p>{tpl.manifest.description}</p>
                    <div className="community-card-actions">
                      <button
                        type="button"
                        className="btn"
                        disabled={busy || !tpl.enabled}
                        onClick={() => void applyTpl(tpl.id)}
                      >
                        套用
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busy}
                        onClick={() =>
                          void setTemplateEnabled(user.uid, tpl.id, !tpl.enabled).then(() =>
                            toast(tpl.enabled ? "已停用" : "已啟用")
                          )
                        }
                      >
                        {tpl.enabled ? "停用" : "啟用"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busy}
                        onClick={() =>
                          void uninstallTemplate(user.uid, tpl.id).then(() => toast("已解除安裝"))
                        }
                      >
                        解除安裝
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="community-grid">
          {filteredCatalog.map((entry) => {
            const installed =
              entry.kind === "extension"
                ? installedExtIds.has(entry.id)
                : installedTplIds.has(entry.id);
            return (
              <article key={`${entry.kind}:${entry.id}`} className="community-card">
                <div className="community-card-top">
                  <PageChromeIcon
                    icon={entry.icon}
                    fallback={entry.kind === "extension" ? "extension" : "description"}
                  />
                  <div>
                    <strong>{entry.name}</strong>
                    <span>
                      {entry.author}
                      {entry.featured ? " · 精選" : ""}
                    </span>
                  </div>
                </div>
                <p>{entry.description}</p>
                {entry.tags && entry.tags.length > 0 && (
                  <div className="community-tags">
                    {entry.tags.map((t) => (
                      <span key={t}>{t}</span>
                    ))}
                  </div>
                )}
                <div className="community-card-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => void openDetail(entry)}
                  >
                    詳情
                  </button>
                  {installed ? (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || entry.kind !== "template"}
                      onClick={() => {
                        if (entry.kind === "template") void applyTpl(entry.id);
                        else router.push(`/ext/${entry.id}`);
                      }}
                    >
                      {entry.kind === "template" ? "套用" : "已安裝"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => void doInstall(entry.source)}
                    >
                      安裝
                    </button>
                  )}
                </div>
              </article>
            );
          })}
          {filteredCatalog.length === 0 && (
            <p className="community-empty">沒有符合的項目。試試從 GitHub 安裝或匯入檔案。</p>
          )}
        </div>
      )}

      {detail && (
        <div className="community-detail-backdrop" onClick={() => setDetail(null)}>
          <div
            className="community-detail"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <PageChromeIcon
                icon={detail.manifest.icon}
                fallback={detail.manifest.kind === "extension" ? "extension" : "description"}
              />
              <div>
                <h2>{detail.manifest.name}</h2>
                <p>
                  {detail.manifest.author} · v{detail.manifest.version} ·{" "}
                  {detail.manifest.kind === "extension" ? "擴充功能" : "模板"}
                </p>
              </div>
              <button type="button" className="community-detail-close" onClick={() => setDetail(null)}>
                ×
              </button>
            </header>
            <p className="community-detail-desc">{detail.manifest.description}</p>
            {detail.manifest.kind === "extension" && (
              <p className="community-detail-meta">
                入口：<code>{detail.manifest.pageType.entry}</code>
                <br />
                安裝後會出現在側欄「頁面」格線。
              </p>
            )}
            {detail.manifest.kind === "template" && (
              <ul className="community-detail-pages">
                {detail.manifest.pages.map((p) => (
                  <li key={p.title}>
                    {p.title}
                    {p.folder ? ` · ${p.folder}` : ""}
                  </li>
                ))}
              </ul>
            )}
            {detail.readme && (
              <pre className="community-readme">{detail.readme.slice(0, 4000)}</pre>
            )}
            <div className="community-card-actions">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void doInstall(detailEntry?.source || detail.source)}
              >
                安裝此套件
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setDetail(null)}>
                關閉
              </button>
            </div>
          </div>
        </div>
      )}

      {!ready && <p className="community-empty">同步安裝狀態…</p>}
      {enabledExtensions.length > 0 && tab === "extensions" && (
        <p className="community-footnote">
          目前已啟用 {enabledExtensions.length} 個擴充，它們會顯示在左側「頁面」區域。
        </p>
      )}
    </div>
  );
}
