"use client";

import PageLoading from "@/components/motion/PageLoading";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { loginWithGoogle } from "@/lib/firebase";
import { useCommunity } from "@/components/community/CommunityProvider";
import { getCatalog, getCollections, resolveBuiltinSource } from "@/lib/community/builtins";
import {
  applyInstalledTemplate,
  installFromFile,
  installFromSource,
  resolveAnySource,
  updateInstalledPackageWithNotes,
} from "@/lib/community/actions";
import {
  setExtensionEnabled,
  setTemplateEnabled,
  uninstallExtension,
  uninstallTemplate,
} from "@/lib/community/store";
import { getLocalRating } from "@/lib/community/ratings";
import { isNewerVersion } from "@/lib/community/semver";
import {
  isHostUtilityEnabled,
  setHostUtilityEnabled,
  uninstallHostUtility,
  HOST_UTILITIES,
} from "@/lib/hostUtilities";
import { communityKindLabel, type CatalogEntry, type InstalledTemplate } from "@/lib/community/types";
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
import {
  hasCommunityPluginsAck,
  setCommunityPluginsAck,
  getFavoriteIds,
  getRecentPackageIds,
  setCommunitySafeMode,
  shouldAutoCheckUpdates,
  setLastUpdateCheckAt,
} from "@/lib/community/libraryPrefs";
import {
  buildLibraryBackup,
  downloadLibraryBackup,
  parseLibraryBackup,
  restoreLibraryBackup,
} from "@/lib/community/libraryBackup";

type Tab = "pages" | "utilities" | "templates" | "installed";
type SortKey = "featured" | "rating" | "name" | "downloads";
type ScopeFilter = "" | "installed" | "not_installed" | "favorites" | "recent" | "free" | "paid";

export default function CommunityStorePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const prefsCtx = usePrefs();
  const { extensions, templates, enabledExtensions, ready, safeMode, refreshSafeMode } =
    useCommunity();
  const [tab, setTab] = useState<Tab>("pages");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [scope, setScope] = useState<ScopeFilter>("");
  const [sort, setSort] = useState<SortKey>("featured");
  const [busy, setBusy] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateMap, setUpdateMap] = useState<Record<string, string>>({});
  const [previewTpl, setPreviewTpl] = useState<InstalledTemplate | null>(null);
  const [installedQ, setInstalledQ] = useState("");
  const [ack, setAck] = useState(false);
  const [favTick, setFavTick] = useState(0);
  const [utilTick, setUtilTick] = useState(0);
  const [publishedExtra, setPublishedExtra] = useState<CatalogEntry[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const libraryBackupRef = useRef<HTMLInputElement>(null);
  const autoUpdateCheckedRef = useRef(false);
  const catalog = useMemo(() => {
    const base = getCatalog();
    const seen = new Set(base.map((c) => c.id));
    const merged = [...base];
    for (const e of publishedExtra) {
      if (seen.has(e.id)) {
        const i = merged.findIndex((x) => x.id === e.id);
        if (i >= 0) merged[i] = { ...merged[i], ...e, featured: merged[i].featured };
      } else {
        merged.push(e);
        seen.add(e.id);
      }
    }
    return merged;
  }, [publishedExtra]);
  const collections = useMemo(() => getCollections(), []);

  useEffect(() => {
    setAck(hasCommunityPluginsAck());
  }, []);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    void import("@/lib/community/publish").then(({ listenPublishedPackages, publishedToCatalogEntry }) => {
      unsub = listenPublishedPackages((items) => {
        setPublishedExtra(items.map(publishedToCatalogEntry));
      });
    });
    return () => unsub?.();
  }, []);

  const installedExtIds = useMemo(() => new Set(extensions.map((e) => e.id)), [extensions]);
  const installedTplIds = useMemo(() => new Set(templates.map((t) => t.id)), [templates]);

  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const c of catalog) {
      if (tab === "pages" && c.kind !== "extension") continue;
      if (tab === "utilities" && c.kind !== "utility") continue;
      if (tab === "templates" && c.kind !== "template") continue;
      if (c.category) s.add(c.category);
      (c.tags || []).forEach((t) => s.add(t));
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [catalog, tab]);

  const filteredCatalog = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const favIds = new Set(getFavoriteIds());
    const recentIds = getRecentPackageIds();
    const recentSet = new Set(recentIds);
    let list = catalog.filter((c) => {
      if (tab === "pages" && c.kind !== "extension") return false;
      if (tab === "utilities" && c.kind !== "utility") return false;
      if (tab === "templates" && c.kind !== "template") return false;
      if (scope === "paid" && !c.paid) return false;
      if (scope === "free" && c.paid) return false;
      if (category) {
        const hit =
          c.category === category || (c.tags || []).includes(category);
        if (!hit) return false;
      }
      const isInstalled =
        c.kind === "extension"
          ? installedExtIds.has(c.id)
          : c.kind === "template"
            ? installedTplIds.has(c.id)
            : isHostUtilityEnabled(c.id);
      if (scope === "installed" && !isInstalled) return false;
      if (scope === "not_installed" && isInstalled) return false;
      if (scope === "favorites" && !favIds.has(c.id)) return false;
      if (scope === "recent" && !recentSet.has(c.id)) return false;
      if (!qq) return true;
      return (
        c.name.toLowerCase().includes(qq) ||
        c.description.toLowerCase().includes(qq) ||
        c.author.toLowerCase().includes(qq) ||
        (c.tags || []).some((t) => t.toLowerCase().includes(qq))
      );
    });
    if (scope === "recent") {
      list = [...list].sort(
        (a, b) => recentIds.indexOf(a.id) - recentIds.indexOf(b.id)
      );
    } else {
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
    }
    return list;
  }, [
    catalog,
    q,
    tab,
    category,
    scope,
    sort,
    installedExtIds,
    installedTplIds,
    favTick,
    utilTick,
  ]);

  const featured = useMemo(
    () => filteredCatalog.filter((c) => c.featured).slice(0, 6),
    [filteredCatalog]
  );

  const doInstall = async (source: string) => {
    if (!user) return;
    setBusy(true);
    try {
      const result = await installFromSource(user.uid, source, { email: user.email });
      toast(result.kind === "extension" ? "已安裝擴充頁面" : "已安裝模板");
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
      const result = await installFromFile(user.uid, file, { email: user.email });
      toast(result.kind === "extension" ? "已匯入擴充頁面" : "已匯入模板");
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

  const checkUpdates = async (opts?: {
    quiet?: boolean;
  }): Promise<Record<string, string>> => {
    setCheckingUpdates(true);
    const next: Record<string, string> = {};
    try {
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
      const count = Object.keys(next).length;
      if (opts?.quiet) {
        if (count > 0) toast(`發現 ${count} 個可更新項目`);
      } else {
        toast(count ? `發現 ${count} 個可更新項目` : "已是最新版本");
      }
      return next;
    } finally {
      setLastUpdateCheckAt();
      setCheckingUpdates(false);
    }
  };

  useEffect(() => {
    if (!user || !ready || autoUpdateCheckedRef.current) return;
    if (!shouldAutoCheckUpdates()) return;
    autoUpdateCheckedRef.current = true;
    void checkUpdates({ quiet: true });
    // Intentionally run once when store is ready
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, ready, extensions, templates]);

  const doUpdate = async (kind: "extension" | "template", id: string) => {
    if (!user) return;
    const current =
      kind === "extension"
        ? extensions.find((e) => e.id === id)
        : templates.find((t) => t.id === id);
    if (!current) return;
    setBusy(true);
    try {
      const r = await updateInstalledPackageWithNotes(uidSafe(user.uid), kind, id, current);
      if (r.updated) {
        toast(r.notes ? `已更新至 v${r.version}：${r.notes}` : `已更新至 v${r.version}`);
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

  const exportLibrary = () => {
    const backup = buildLibraryBackup(extensions, templates);
    downloadLibraryBackup(backup);
    toast("已匯出函式庫備份");
  };

  const importLibrary = async (file: File) => {
    if (!user) return;
    setBusy(true);
    try {
      const text = await file.text();
      const backup = parseLibraryBackup(text);
      const result = await restoreLibraryBackup(user.uid, backup, {
        existingExtIds: installedExtIds,
        existingTplIds: installedTplIds,
        email: user.email,
      });
      const parts = [`已安裝 ${result.installed}`];
      if (result.skipped) parts.push(`略過 ${result.skipped}`);
      if (result.failed.length) parts.push(`失敗 ${result.failed.length}`);
      toast(parts.join(" · "));
      setTab("installed");
    } catch (e) {
      toast(e instanceof Error ? e.message : "匯入函式庫失敗");
    } finally {
      setBusy(false);
    }
  };

  const updateAll = async () => {
    let map = updateMap;
    if (Object.keys(map).length === 0) {
      map = await checkUpdates();
    }
    const keys = Object.keys(map);
    if (keys.length === 0) return;
    for (const key of keys) {
      const [prefix, id] = key.split(":");
      if (!id) continue;
      if (prefix === "ext") await doUpdate("extension", id);
      else if (prefix === "tpl") await doUpdate("template", id);
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
        <p className="page-sub">登入後瀏覽擴充頁面、擴充功能與模板。</p>
        <button type="button" className="btn" onClick={() => void loginWithGoogle()}>
          登入
        </button>
      </div>
    );
  }

  const showCollections =
    (tab === "pages" || tab === "templates") && !q && !category && !scope;

  return (
    <div className="community-page">
      <div className="community-hero page-chrome">
        <div>
          <ScrambleText words="社群商店" as="h1" className="page-title font-display" />
          <p className="page-sub">
            擴充頁面（獨立頁）、擴充功能（如色票工具）、模板（筆記結構）— 皆含免費與收費。可從筆記頁分享自己的模板到社群。
          </p>
          <div className="community-hero-links">
            <Link href="/community/docs">開發文件</Link>
            <a href="/community/ai.md" target="_blank" rel="noreferrer">
              AI 開發指南
            </a>
            <Link href="/community/submit">上傳並分享</Link>
            <a href="/samples/albireus-extension-sample.json" download>
              擴充範例
            </a>
            <a href="/samples/albireus-template-sample.json" download>
              模板範例
            </a>
          </div>
        </div>
        <div className="community-hero-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              const next = !safeMode;
              setCommunitySafeMode(next);
              refreshSafeMode();
              toast(next ? "已開啟安全模式" : "已關閉安全模式");
            }}
          >
            安全模式：{safeMode ? "開" : "關"}
          </button>
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

      {safeMode && (
        <div className="community-ack-banner doc-banner-ingest" role="status">
          <div className="doc-banner-ingest-main">
            <strong>安全模式已開啟</strong>
            <p>擴充頁面已從側欄隱藏，且不會載入到筆記頁面。</p>
          </div>
        </div>
      )}

      {!ack && (
        <div className="community-ack-banner doc-banner-ingest">
          <div className="doc-banner-ingest-main">
            <strong>啟用社群套件</strong>
            <p>
              社群擴充頁面以沙箱 iframe 載入；擴充功能由主程式提供；模板會寫入知識庫。請只安裝你信任的來源。
            </p>
            <div className="doc-banner-ingest-actions">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setCommunityPluginsAck();
                  setAck(true);
                }}
              >
                啟用
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="community-toolbar">
        <div className="community-tabs" role="tablist">
          {(
            [
              ["pages", "擴充頁面"],
              ["utilities", "擴充功能"],
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
                <span className="community-tab-count">
                  {extensions.length + templates.length + HOST_UTILITIES.filter((u) => isHostUtilityEnabled(u.id)).length}
                </span>
              )}
              {id === "utilities" && (
                <span className="community-tab-count">{catalog.filter((c) => c.kind === "utility").length}</span>
              )}
              {id === "pages" && (
                <span className="community-tab-count">{catalog.filter((c) => c.kind === "extension").length}</span>
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
                onClick={() => void updateAll()}
              >
                全部更新
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={checkingUpdates || busy}
                onClick={() => void checkUpdates()}
              >
                {checkingUpdates ? "檢查中…" : "檢查更新"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => exportLibrary()}
              >
                匯出函式庫
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => libraryBackupRef.current?.click()}
              >
                匯入函式庫
              </button>
              <input
                ref={libraryBackupRef}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void importLibrary(f);
                }}
              />
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

      {tab !== "installed" && (
        <>
          <div className="community-chips" aria-label="範圍篩選">
            {(
              [
                ["", "全部"],
                ["free", "免費"],
                ["paid", "收費"],
                ["installed", "已啟用／已安裝"],
                ["not_installed", "未啟用／未安裝"],
                ["favorites", "收藏"],
                ["recent", "最近瀏覽"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={`scope-${id || "all"}`}
                type="button"
                className={scope === id ? "is-on" : ""}
                onClick={() => setScope(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {categories.length > 0 && (
            <div className="community-chips" aria-label="分類篩選">
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
        </>
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
            <h2>擴充頁面（{installedFiltered.ex.length}）</h2>
            {installedFiltered.ex.length === 0 ? (
              <p className="community-empty">尚未安裝擴充頁面。到「擴充頁面」分頁安裝後，會出現在側欄「頁面」。</p>
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
                            const ok = await askConfirm(
                              "解除安裝此擴充？相關設定也會一併移除。"
                            );
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
            <h2>擴充功能（{HOST_UTILITIES.length}）</h2>
            <div className="community-grid">
              {HOST_UTILITIES.map((u) => {
                const on = isHostUtilityEnabled(u.id);
                return (
                  <article key={u.id} className="community-card">
                    <div className="community-card-top">
                      <PageChromeIcon icon={u.icon} fallback="build" />
                      <div>
                        <strong>{u.name}</strong>
                        <span>
                          Albireus · 內建擴充功能
                          {u.paid ? " · 收費" : " · 免費"}
                          {on ? " · 已啟用" : " · 已移除"}
                        </span>
                      </div>
                    </div>
                    <p>{u.description}</p>
                    <div className="community-card-actions">
                      {on ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => {
                              setHostUtilityEnabled(u.id, false);
                              setUtilTick((t) => t + 1);
                              toast("已停用");
                            }}
                          >
                            停用
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() =>
                              void (async () => {
                                const ok = await askConfirm({
                                  title: `移除「${u.name}」？`,
                                  message: "可之後在「擴充功能」分頁重新啟用。",
                                  danger: true,
                                  confirmLabel: "移除",
                                });
                                if (!ok) return;
                                uninstallHostUtility(u.id);
                                setUtilTick((t) => t + 1);
                                toast("已移除");
                              })()
                            }
                          >
                            移除
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => {
                            setHostUtilityEnabled(u.id, true);
                            setUtilTick((t) => t + 1);
                            toast("已啟用");
                          }}
                        >
                          重新啟用
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
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
          {showCollections &&
            collections.map((col) => {
              const packs = col.packageIds
                .map((id) => catalog.find((c) => c.id === id))
                .filter((c): c is CatalogEntry => {
                  if (!c) return false;
                  if (tab === "pages") return c.kind === "extension";
                  return c.kind === "template";
                });
              if (packs.length === 0) return null;
              return (
                <section key={col.id} className="community-featured">
                  <h2>
                    <Link href={`/community/collection/${col.id}`}>{col.name}</Link>
                  </h2>
                  <p className="page-sub">
                    {col.description}{" "}
                    <Link href={`/community/collection/${col.id}`}>查看合輯</Link>
                  </p>
                  <div className="community-grid">
                    {packs.map((entry) => (
                      <CatalogCard
                        key={`col-${col.id}-${entry.kind}-${entry.id}`}
                        entry={entry}
                        installed={catalogInstalled(entry, installedExtIds, installedTplIds)}
                        busy={busy}
                        viewerEmail={user?.email}
                        utilTick={utilTick}
                        onUtilChange={() => setUtilTick((t) => t + 1)}
                        onInstall={() => void doInstall(entry.source)}
                        onOpen={() => openCatalogEntry(entry, templates, setPreviewTpl, router)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          {featured.length > 0 && !q && !category && !scope && (
            <section className="community-featured">
              <h2>精選</h2>
              <div className="community-grid">
                {featured.map((entry) => (
                  <CatalogCard
                    key={`f-${entry.kind}-${entry.id}`}
                    entry={entry}
                    installed={catalogInstalled(entry, installedExtIds, installedTplIds)}
                    busy={busy}
                    viewerEmail={user?.email}
                    utilTick={utilTick}
                    onUtilChange={() => setUtilTick((t) => t + 1)}
                    onInstall={() => void doInstall(entry.source)}
                    onOpen={() => openCatalogEntry(entry, templates, setPreviewTpl, router)}
                  />
                ))}
              </div>
            </section>
          )}
          <section>
            {(featured.length === 0 || q || category || scope) && (
              <h2 className="community-section-title">全部</h2>
            )}
            <div className="community-grid">
              {filteredCatalog.map((entry) => (
                <CatalogCard
                  key={`${entry.kind}:${entry.id}`}
                  entry={entry}
                  installed={catalogInstalled(entry, installedExtIds, installedTplIds)}
                  busy={busy}
                  viewerEmail={user?.email}
                  utilTick={utilTick}
                  onUtilChange={() => setUtilTick((t) => t + 1)}
                  onInstall={() => void doInstall(entry.source)}
                  onOpen={() => openCatalogEntry(entry, templates, setPreviewTpl, router)}
                />
              ))}
            </div>
            {filteredCatalog.length === 0 && (
              <p className="community-empty">
                {tab === "utilities"
                  ? "沒有符合的擴充功能。"
                  : "沒有符合的項目。試試從 GitHub 安裝或匯入檔案。"}
              </p>
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

      {enabledExtensions.length > 0 && tab === "pages" && (
        <p className="community-footnote">
          目前已啟用 {enabledExtensions.length} 個擴充頁面，它們會顯示在左側「頁面」區域。
        </p>
      )}
    </div>
  );
}

function catalogInstalled(
  entry: CatalogEntry,
  extIds: Set<string>,
  tplIds: Set<string>
): boolean {
  if (entry.kind === "extension") return extIds.has(entry.id);
  if (entry.kind === "template") return tplIds.has(entry.id);
  return isHostUtilityEnabled(entry.id);
}

function openCatalogEntry(
  entry: CatalogEntry,
  templates: InstalledTemplate[],
  setPreviewTpl: (t: InstalledTemplate) => void,
  router: { push: (href: string) => void }
) {
  if (entry.kind === "template") {
    const tpl = templates.find((t) => t.id === entry.id);
    if (tpl) setPreviewTpl(tpl);
    return;
  }
  if (entry.kind === "extension") {
    router.push(`/ext/${entry.id}`);
  }
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
  viewerEmail,
  utilTick,
  onUtilChange,
}: {
  entry: CatalogEntry;
  installed: boolean;
  busy?: boolean;
  onInstall: () => void;
  onOpen: () => void;
  viewerEmail?: string | null;
  utilTick?: number;
  onUtilChange?: () => void;
}) {
  void utilTick;
  if (entry.kind === "utility") {
    const on = isHostUtilityEnabled(entry.id);
    return (
      <article className={`community-card${entry.paid ? " is-paid" : ""}`}>
        <div
          className="community-card-cover community-card-cover-fallback"
          aria-hidden
        >
          <PageChromeIcon icon={entry.icon} fallback="build" />
          <span>{entry.name}</span>
        </div>
        {entry.paid ? <span className="community-paid-badge">收費</span> : null}
        <div className="community-card-top">
          <PageChromeIcon icon={entry.icon} fallback="build" />
          <div>
            <strong>{entry.name}</strong>
            <span>
              {entry.author}
              {entry.featured ? " · 精選" : ""}
              {entry.category ? ` · ${entry.category}` : ""}
              {entry.paid ? " · 收費" : " · 免費"}
              {on ? " · 已啟用" : " · 已移除"}
              {" · "}
              {communityKindLabel("utility")}
            </span>
          </div>
        </div>
        <p>{entry.description}</p>
        <div className="community-card-actions">
          {on ? (
            <>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setHostUtilityEnabled(entry.id, false);
                  onUtilChange?.();
                  toast("已停用");
                }}
              >
                停用
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  void (async () => {
                    const ok = await askConfirm({
                      title: `移除「${entry.name}」？`,
                      message: "可之後在此重新啟用。",
                      danger: true,
                      confirmLabel: "移除",
                    });
                    if (!ok) return;
                    uninstallHostUtility(entry.id);
                    onUtilChange?.();
                    toast("已移除");
                  })()
                }
              >
                移除
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setHostUtilityEnabled(entry.id, true);
                onUtilChange?.();
                toast("已啟用");
              }}
            >
              啟用
            </button>
          )}
        </div>
      </article>
    );
  }

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
      viewerEmail={viewerEmail}
    />
  );
}
