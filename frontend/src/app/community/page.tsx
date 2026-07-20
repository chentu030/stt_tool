"use client";

import PageLoading from "@/components/motion/PageLoading";

import { useEffect, useMemo, useRef, useState } from "react";
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
  updateInstalledPackage,
} from "@/lib/community/actions";
import {
  setExtensionEnabled,
  setTemplateEnabled,
  uninstallExtension,
  uninstallTemplate,
} from "@/lib/community/store";
import { getLocalRating } from "@/lib/community/ratings";
import { isNewerVersion } from "@/lib/community/semver";
import type { CatalogEntry, InstalledTemplate } from "@/lib/community/types";
import PageChromeIcon from "@/components/PageChromeIcon";
import ScrambleText from "@/components/motion/ScrambleText";
import { askConfirm, askPrompt } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import { touchRecentId } from "@/lib/userPrefs";
import { usePrefs } from "@/components/PrefsProvider";
import {
  PackageCard,
  TemplatePreviewModal,
} from "@/components/community/StoreWidgets";
import { resolveBuiltinSource } from "@/lib/community/builtins";

type Tab = "extensions" | "templates" | "installed";
type SortKey = "featured" | "rating" | "name" | "downloads";

export default function CommunityStorePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const prefsCtx = usePrefs();
  const { extensions, templates, enabledExtensions, ready } = useCommunity();
  const [tab, setTab] = useState<Tab>("extensions");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<SortKey>("featured");
  const [busy, setBusy] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateMap, setUpdateMap] = useState<Record<string, string>>({});
  const [previewTpl, setPreviewTpl] = useState<InstalledTemplate | null>(null);
  const [installedQ, setInstalledQ] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const catalog = useMemo(() => getCatalog(), []);

  const installedExtIds = useMemo(() => new Set(extensions.map((e) => e.id)), [extensions]);
  const installedTplIds = useMemo(() => new Set(templates.map((t) => t.id)), [templates]);

  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const c of catalog) {
      if (tab === "extensions" && c.kind !== "extension") continue;
      if (tab === "templates" && c.kind !== "template") continue;
      if (c.category) s.add(c.category);
      (c.tags || []).forEach((t) => s.add(t));
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [catalog, tab]);

  const filteredCatalog = useMemo(() => {
    const qq = q.trim().toLowerCase();
    let list = catalog.filter((c) => {
      if (tab === "extensions" && c.kind !== "extension") return false;
      if (tab === "templates" && c.kind !== "template") return false;
      if (category) {
        const hit =
          c.category === category || (c.tags || []).includes(category);
        if (!hit) return false;
      }
      if (!qq) return true;
      return (
        c.name.toLowerCase().includes(qq) ||
        c.description.toLowerCase().includes(qq) ||
        c.author.toLowerCase().includes(qq) ||
        (c.tags || []).some((t) => t.toLowerCase().includes(qq))
      );
    });
    list = [...list].sort((a, b) => {
      if (sort === "featured") {
        const af = a.featured ? 1 : 0;
        const bf = b.featured ? 1 : 0;
        if (af !== bf) return bf - af;
        return (b.rating || 0) - (a.rating || 0);
      }
      if (sort === "rating") return (b.rating || 0) - (a.rating || 0);
      if (sort === "downloads") return (b.downloads || 0) - (a.downloads || 0);
      return a.name.localeCompare(b.name, "zh-Hant");
    });
    return list;
  }, [catalog, q, tab, category, sort]);

  const featured = useMemo(
    () => filteredCatalog.filter((c) => c.featured).slice(0, 6),
    [filteredCatalog]
  );

  const doInstall = async (source: string) => {
    if (!user) return;
    setBusy(true);
    try {
      const result = await installFromSource(user.uid, source);
      toast(result.kind === "extension" ? "已安裝擴充功能" : "已安裝模板");
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

  const applyTpl = async (tpl: InstalledTemplate, folder?: string) => {
    if (!user) return;
    setBusy(true);
    try {
      const { firstId, noteIds } = await applyInstalledTemplate(user.uid, tpl, { folder });
      prefsCtx.setPrefs((p) => touchRecentId(p, firstId));
      toast(`已套用模板（${noteIds.length} 頁）`);
      setPreviewTpl(null);
      router.push(`/notes/${firstId}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "套用失敗");
    } finally {
      setBusy(false);
    }
  };

  const checkUpdates = async () => {
    setCheckingUpdates(true);
    const next: Record<string, string> = {};
    try {
      const { resolveAnySource } = await import("@/lib/community/actions");
      for (const ext of extensions) {
        try {
          const pack = resolveBuiltinSource(ext.source) ?? (await resolveAnySource(ext.source));
          if (
            pack.manifest.kind === "extension" &&
            isNewerVersion(pack.manifest.version, ext.manifest.version)
          ) {
            next[`ext:${ext.id}`] = pack.manifest.version;
          }
        } catch {
          /* skip */
        }
      }
      for (const tpl of templates) {
        try {
          const pack = resolveBuiltinSource(tpl.source) ?? (await resolveAnySource(tpl.source));
          if (
            pack.manifest.kind === "template" &&
            isNewerVersion(pack.manifest.version, tpl.manifest.version)
          ) {
            next[`tpl:${tpl.id}`] = pack.manifest.version;
          }
        } catch {
          /* skip */
        }
      }
      setUpdateMap(next);
      toast(
        Object.keys(next).length
          ? `發現 ${Object.keys(next).length} 個可更新項目`
          : "已是最新版本"
      );
    } finally {
      setCheckingUpdates(false);
    }
  };

  const doUpdate = async (kind: "extension" | "template", id: string) => {
    if (!user) return;
    const current =
      kind === "extension"
        ? extensions.find((e) => e.id === id)
        : templates.find((t) => t.id === id);
    if (!current) return;
    setBusy(true);
    try {
      const r = await updateInstalledPackage(uidSafe(user.uid), kind, id, current);
      if (r.updated) {
        toast(`已更新至 v${r.version}`);
        setUpdateMap((m) => {
          const copy = { ...m };
          delete copy[`${kind === "extension" ? "ext" : "tpl"}:${id}`];
          return copy;
        });
      } else toast("已是最新");
    } catch (e) {
      toast(e instanceof Error ? e.message : "更新失敗");
    } finally {
      setBusy(false);
    }
  };

  const installedFiltered = useMemo(() => {
    const qq = installedQ.trim().toLowerCase();
    const ex = extensions.filter(
      (e) =>
        !qq ||
        e.manifest.name.toLowerCase().includes(qq) ||
        e.manifest.author.toLowerCase().includes(qq)
    );
    const tp = templates.filter(
      (t) =>
        !qq ||
        t.manifest.name.toLowerCase().includes(qq) ||
        t.manifest.author.toLowerCase().includes(qq)
    );
    return { ex, tp };
  }, [extensions, templates, installedQ]);

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
            探索擴充功能與模板：瀏覽、預覽、安裝與更新。支援 GitHub 與本機檔案匯入。
          </p>
          <div className="community-hero-links">
            <Link href="/community/docs">開發文件</Link>
            <Link href="/community/submit">驗證並發佈</Link>
            <a href="/samples/albireus-extension-sample.json" download>
              擴充範例
            </a>
            <a href="/samples/albireus-template-sample.json" download>
              模板範例
            </a>
          </div>
        </div>
        <div className="community-hero-actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void doGithub()}>
            從 GitHub 安裝
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
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
        <div className="community-toolbar-right">
          {tab !== "installed" ? (
            <>
              <select
                className="community-select"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                aria-label="排序"
              >
                <option value="featured">精選優先</option>
                <option value="rating">評分</option>
                <option value="downloads">熱門</option>
                <option value="name">名稱</option>
              </select>
              <input
                className="community-search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜尋名稱、作者、標籤…"
                aria-label="搜尋"
              />
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={checkingUpdates || busy}
                onClick={() => void checkUpdates()}
              >
                {checkingUpdates ? "檢查中…" : "檢查更新"}
              </button>
              <input
                className="community-search"
                value={installedQ}
                onChange={(e) => setInstalledQ(e.target.value)}
                placeholder="搜尋已安裝…"
              />
            </>
          )}
        </div>
      </div>

      {tab !== "installed" && categories.length > 0 && (
        <div className="community-chips">
          <button
            type="button"
            className={!category ? "is-on" : ""}
            onClick={() => setCategory("")}
          >
            全部
          </button>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              className={category === c ? "is-on" : ""}
              onClick={() => setCategory(c === category ? "" : c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {!ready && tab !== "installed" && (
        <div className="community-skeleton-grid" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="community-skeleton-card" />
          ))}
        </div>
      )}

      {tab === "installed" ? (
        <div className="community-installed">
          <section>
            <h2>擴充功能（{installedFiltered.ex.length}）</h2>
            {installedFiltered.ex.length === 0 ? (
              <p className="community-empty">尚未安裝擴充。到「擴充功能」分頁安裝後，會出現在側欄「頁面」。</p>
            ) : (
              <div className="community-grid">
                {installedFiltered.ex.map((ext) => (
                  <article key={ext.id} className="community-card">
                    <div className="community-card-top">
                      <PageChromeIcon icon={ext.manifest.icon} fallback="extension" />
                      <div>
                        <strong>{ext.manifest.name}</strong>
                        <span>
                          {ext.manifest.author} · v{ext.manifest.version}
                          {updateMap[`ext:${ext.id}`] ? ` → v${updateMap[`ext:${ext.id}`]}` : ""}
                        </span>
                      </div>
                    </div>
                    <p>{ext.manifest.description}</p>
                    <div className="community-card-actions">
                      <Link className="btn btn-ghost" href={`/ext/${ext.id}`}>
                        開啟
                      </Link>
                      <Link className="btn btn-ghost" href={`/community/${ext.id}?kind=extension`}>
                        詳情
                      </Link>
                      {updateMap[`ext:${ext.id}`] && (
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => void doUpdate("extension", ext.id)}
                        >
                          更新
                        </button>
                      )}
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
                          void (async () => {
                            const ok = await askConfirm("解除安裝此擴充？");
                            if (!ok) return;
                            await uninstallExtension(user.uid, ext.id);
                            toast("已解除安裝");
                          })()
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
            <h2>模板（{installedFiltered.tp.length}）</h2>
            {installedFiltered.tp.length === 0 ? (
              <p className="community-empty">尚未安裝模板。</p>
            ) : (
              <div className="community-grid">
                {installedFiltered.tp.map((tpl) => (
                  <article key={tpl.id} className="community-card">
                    <div className="community-card-top">
                      <PageChromeIcon icon={tpl.manifest.icon} fallback="description" />
                      <div>
                        <strong>{tpl.manifest.name}</strong>
                        <span>
                          {tpl.manifest.author} · {tpl.manifest.pages.length} 頁 · v
                          {tpl.manifest.version}
                          {updateMap[`tpl:${tpl.id}`] ? ` → v${updateMap[`tpl:${tpl.id}`]}` : ""}
                        </span>
                      </div>
                    </div>
                    <p>{tpl.manifest.description}</p>
                    <div className="community-card-actions">
                      <button
                        type="button"
                        className="btn"
                        disabled={busy || !tpl.enabled}
                        onClick={() => setPreviewTpl(tpl)}
                      >
                        預覽並套用
                      </button>
                      {updateMap[`tpl:${tpl.id}`] && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={busy}
                          onClick={() => void doUpdate("template", tpl.id)}
                        >
                          更新
                        </button>
                      )}
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
                          void (async () => {
                            const ok = await askConfirm("解除安裝此模板？");
                            if (!ok) return;
                            await uninstallTemplate(user.uid, tpl.id);
                            toast("已解除安裝");
                          })()
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
        <>
          {featured.length > 0 && !q && !category && (
            <section className="community-featured">
              <h2>精選</h2>
              <div className="community-grid">
                {featured.map((entry) => (
                  <CatalogCard
                    key={`f-${entry.kind}-${entry.id}`}
                    entry={entry}
                    installed={
                      entry.kind === "extension"
                        ? installedExtIds.has(entry.id)
                        : installedTplIds.has(entry.id)
                    }
                    busy={busy}
                    onInstall={() => void doInstall(entry.source)}
                    onOpen={() => {
                      if (entry.kind === "template") {
                        const tpl = templates.find((t) => t.id === entry.id);
                        if (tpl) setPreviewTpl(tpl);
                      } else router.push(`/ext/${entry.id}`);
                    }}
                  />
                ))}
              </div>
            </section>
          )}
          <section>
            {(featured.length === 0 || q || category) && <h2 className="community-section-title">全部</h2>}
            <div className="community-grid">
              {filteredCatalog.map((entry) => (
                <CatalogCard
                  key={`${entry.kind}:${entry.id}`}
                  entry={entry}
                  installed={
                    entry.kind === "extension"
                      ? installedExtIds.has(entry.id)
                      : installedTplIds.has(entry.id)
                  }
                  busy={busy}
                  onInstall={() => void doInstall(entry.source)}
                  onOpen={() => {
                    if (entry.kind === "template") {
                      const tpl = templates.find((t) => t.id === entry.id);
                      if (tpl) setPreviewTpl(tpl);
                    } else router.push(`/ext/${entry.id}`);
                  }}
                />
              ))}
            </div>
            {filteredCatalog.length === 0 && (
              <p className="community-empty">沒有符合的項目。試試從 GitHub 安裝或匯入檔案。</p>
            )}
          </section>
        </>
      )}

      {previewTpl && (
        <TemplatePreviewModal
          tpl={previewTpl}
          open
          busy={busy}
          onClose={() => setPreviewTpl(null)}
          onApply={(folder) => void applyTpl(previewTpl, folder)}
        />
      )}

      {enabledExtensions.length > 0 && tab === "extensions" && (
        <p className="community-footnote">
          目前已啟用 {enabledExtensions.length} 個擴充，它們會顯示在左側「頁面」區域。
        </p>
      )}
    </div>
  );
}

function uidSafe(uid: string) {
  return uid;
}

function CatalogCard({
  entry,
  installed,
  busy,
  onInstall,
  onOpen,
}: {
  entry: CatalogEntry;
  installed: boolean;
  busy?: boolean;
  onInstall: () => void;
  onOpen: () => void;
}) {
  const userRating = typeof window !== "undefined" ? getLocalRating(entry.id) : null;
  return (
    <PackageCard
      entry={entry}
      installed={installed}
      href={`/community/${entry.id}?kind=${entry.kind}`}
      busy={busy}
      onInstall={onInstall}
      onOpen={onOpen}
      userRating={userRating}
    />
  );
}
