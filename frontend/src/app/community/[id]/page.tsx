"use client";

import PageLoading from "@/components/motion/PageLoading";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { loginWithGoogle } from "@/lib/firebase";
import { useCommunity } from "@/components/community/CommunityProvider";
import { getCatalog } from "@/lib/community/builtins";
import {
  applyInstalledTemplate,
  installFromSource,
  resolveAnySource,
} from "@/lib/community/actions";
import type { CatalogEntry, InstalledTemplate, ResolvedPackage } from "@/lib/community/types";
import PageChromeIcon from "@/components/PageChromeIcon";
import {
  InstallConfirmModal,
  PackageDetailBody,
  RelatedPackages,
  StarRow,
  TemplatePreviewModal,
  TrustScorecard,
} from "@/components/community/StoreWidgets";
import { getLocalRating, saveUserRating, saveUserReport } from "@/lib/community/ratings";
import {
  isFavorite,
  REPORT_REASONS,
  toggleFavorite,
  touchRecentPackage,
  type ReportReasonId,
} from "@/lib/community/libraryPrefs";
import { relatedByPackageId } from "@/lib/community/related";
import { toast } from "@/lib/toast";
import { touchRecentId } from "@/lib/userPrefs";
import { usePrefs } from "@/components/PrefsProvider";
import { askConfirm } from "@/lib/dialogs";

function CommunityPackageDetailInner() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const kindHint = search.get("kind");
  const { user, loading } = useAuth();
  const router = useRouter();
  const prefsCtx = usePrefs();
  const { extensions, templates } = useCommunity();
  const [pack, setPack] = useState<ResolvedPackage | null>(null);
  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [previewTpl, setPreviewTpl] = useState<InstalledTemplate | ResolvedPackage | null>(null);
  const [previewMode, setPreviewMode] = useState<"apply" | "preview">("apply");
  const [confirmPack, setConfirmPack] = useState<ResolvedPackage | null>(null);
  const [fav, setFav] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReasonId>("broken");
  const [reportDetail, setReportDetail] = useState("");
  const [publishedExtra, setPublishedExtra] = useState<CatalogEntry[]>([]);
  const [isAuthor, setIsAuthor] = useState(false);

  const catalog = useMemo(() => {
    const base = getCatalog();
    const seen = new Set(base.map((c) => c.id));
    const merged = [...base];
    for (const e of publishedExtra) {
      if (seen.has(e.id)) {
        const i = merged.findIndex((x) => x.id === e.id);
        if (i >= 0) merged[i] = { ...merged[i], ...e };
      } else {
        merged.push(e);
        seen.add(e.id);
      }
    }
    return merged;
  }, [publishedExtra]);
  const related = useMemo(() => relatedByPackageId(id, kindHint || undefined), [id, kindHint]);
  const installedIds = useMemo(
    () => new Set([...extensions.map((e) => e.id), ...templates.map((t) => t.id)]),
    [extensions, templates]
  );

  useEffect(() => {
    let unsub: (() => void) | undefined;
    void import("@/lib/community/publish").then(({ listenPublishedPackages, publishedToCatalogEntry }) => {
      unsub = listenPublishedPackages((items) => {
        setPublishedExtra(items.map(publishedToCatalogEntry));
        const mine = items.find((x) => x.id === id);
        setIsAuthor(Boolean(user && mine && mine.authorUid === user.uid));
      });
    });
    return () => unsub?.();
  }, [id, user]);

  useEffect(() => {
    touchRecentPackage(id);
    setFav(isFavorite(id));
  }, [id]);

  useEffect(() => {
    const e =
      catalog.find((c) => c.id === id && (!kindHint || c.kind === kindHint)) ||
      catalog.find((c) => c.id === id) ||
      null;
    setEntry(e);
    const source =
      e?.source ||
      (id ? `hosted:${id}` : "") ||
      extensions.find((x) => x.id === id)?.source ||
      templates.find((t) => t.id === id)?.source;
    if (!source) {
      setErr("找不到此套件");
      return;
    }
    let cancelled = false;
    setBusy(true);
    setErr("");
    void resolveAnySource(source)
      .then((p) => {
        if (!cancelled) {
          setPack(p);
          if (!e) {
            setEntry({
              id: p.manifest.id,
              kind: p.manifest.kind,
              name: p.manifest.name,
              description: p.manifest.description,
              author: p.manifest.author,
              icon: p.manifest.icon,
              cover: p.manifest.cover,
              screenshots: p.manifest.screenshots,
              category: p.manifest.category,
              source: p.source,
            });
          }
        }
      })
      .catch(async (ex) => {
        // Fallback: try hosted:{id} if catalog miss
        if (source !== `hosted:${id}`) {
          try {
            const p = await resolveAnySource(`hosted:${id}`);
            if (!cancelled) {
              setPack(p);
              setErr("");
              return;
            }
          } catch {
            /* keep original */
          }
        }
        if (!cancelled) setErr(ex instanceof Error ? ex.message : "載入失敗");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, kindHint, catalog, extensions, templates]);

  useEffect(() => {
    const r = getLocalRating(id);
    if (r) {
      setStars(r.stars);
      setComment(r.comment || "");
    } else if (entry?.rating) setStars(Math.round(entry.rating));
  }, [id, entry]);

  const installedExt = extensions.find((e) => e.id === id);
  const installedTpl = templates.find((t) => t.id === id);
  const installed = Boolean(installedExt || installedTpl);

  const doInstall = async (source: string) => {
    if (!user) return;
    setBusy(true);
    try {
      await installFromSource(user.uid, source);
      toast("安裝完成");
      setConfirmPack(null);
      setPreviewTpl(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : "安裝失敗");
    } finally {
      setBusy(false);
    }
  };

  const copyShare = async () => {
    const url = typeof window !== "undefined" ? window.location.href : `/community/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("已複製分享連結");
    } catch {
      toast(url);
    }
  };

  const submitReport = async () => {
    if (!user) return;
    const label = REPORT_REASONS.find((r) => r.id === reportReason)?.label || reportReason;
    try {
      await saveUserReport(user.uid, {
        packageId: id,
        reason: label,
        detail: reportDetail.trim().slice(0, 500),
        updatedAt: Date.now(),
      });
      toast("已送出回報");
      setReportOpen(false);
      setReportDetail("");
    } catch (e) {
      toast(e instanceof Error ? e.message : "回報失敗");
    }
  };

  if (loading) return <PageLoading />;
  if (!user) {
    return (
      <div className="community-page">
        <p className="page-sub">請先登入。</p>
        <button type="button" className="btn" onClick={() => void loginWithGoogle()}>
          登入
        </button>
      </div>
    );
  }

  return (
    <div className="community-page community-detail-page">
      <nav className="community-crumb">
        <Link href="/community">社群商店</Link>
        <span>/</span>
        <span>{pack?.manifest.name || id}</span>
      </nav>

      {err && <p className="community-empty">{err}</p>}
      {busy && !pack && <p className="community-empty">載入中…</p>}

      {pack && (
        <>
          <header className="community-detail-head">
            <PageChromeIcon
              icon={pack.manifest.icon}
              fallback={pack.manifest.kind === "extension" ? "extension" : "description"}
            />
            <div>
              <h1 className="page-title font-display">{pack.manifest.name}</h1>
              <p className="page-sub">
                <Link href={`/community/author/${encodeURIComponent(pack.manifest.author)}`}>
                  {pack.manifest.author}
                </Link>
                {" · "}v{pack.manifest.version}
                {installed ? " · 已安裝" : ""}
                {fav ? " · 已收藏" : ""}
              </p>
            </div>
            <div className="community-detail-head-actions">
              {!installed ? (
                <>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => setConfirmPack(pack)}
                  >
                    安裝
                  </button>
                  {pack.manifest.kind === "template" && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busy}
                      onClick={() => {
                        setPreviewMode("preview");
                        setPreviewTpl(pack);
                      }}
                    >
                      預覽
                    </button>
                  )}
                </>
              ) : pack.manifest.kind === "extension" ? (
                <Link className="btn" href={`/ext/${id}`}>
                  開啟／設定
                </Link>
              ) : (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setPreviewMode("apply");
                    if (installedTpl) setPreviewTpl(installedTpl);
                  }}
                >
                  預覽並套用
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  const on = toggleFavorite(id);
                  setFav(on);
                  toast(on ? "已加入收藏" : "已取消收藏");
                }}
              >
                {fav ? "取消收藏" : "收藏"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => void copyShare()}>
                分享
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setReportOpen(true)}>
                回報
              </button>
              {isAuthor ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => {
                    void (async () => {
                      if (!user) return;
                      if (!(await askConfirm({ title: "下架此套件？", message: "商店將不再顯示，已安裝者仍可使用本機副本。", danger: true, confirmLabel: "下架" }))) return;
                      setBusy(true);
                      try {
                        const { unpublishCommunityPackage } = await import("@/lib/community/publish");
                        await unpublishCommunityPackage(user.uid, id);
                        toast("已下架");
                        router.push("/community");
                      } catch (e) {
                        toast(e instanceof Error ? e.message : "下架失敗");
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }}
                >
                  下架
                </button>
              ) : null}
              <Link className="btn btn-ghost" href="/community">
                返回
              </Link>
            </div>
          </header>

          <TrustScorecard manifest={pack.manifest} />

          <div className="community-rate-box community-rate-box--review">
            <div className="community-rate-row">
              <span>評分與短評</span>
              <StarRow
                value={stars}
                onChange={(n) => {
                  setStars(n);
                }}
              />
            </div>
            <textarea
              className="community-review-ta"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="寫下使用心得（選填，僅存於你的帳號）"
              rows={3}
              maxLength={500}
            />
            <button
              type="button"
              className="btn"
              disabled={!stars}
              onClick={() =>
                void saveUserRating(user.uid, {
                  packageId: id,
                  stars,
                  comment: comment.trim(),
                  updatedAt: Date.now(),
                }).then(() => toast("已儲存評分"))
              }
            >
              儲存評分
            </button>
          </div>

          <PackageDetailBody pack={pack} entry={entry} />

          <RelatedPackages
            entries={related}
            installedIds={installedIds}
            busy={busy}
            onInstall={(e) =>
              void resolveAnySource(e.source).then((p) => setConfirmPack(p))
            }
          />
        </>
      )}

      {previewTpl && (
        <TemplatePreviewModal
          tpl={previewTpl}
          open
          mode={previewMode}
          busy={busy}
          onClose={() => setPreviewTpl(null)}
          onApply={(folder) =>
            void (async () => {
              if (!installedTpl) return;
              setBusy(true);
              try {
                const { firstId } = await applyInstalledTemplate(user.uid, installedTpl, { folder });
                prefsCtx.setPrefs((p) => touchRecentId(p, firstId));
                toast("已套用模板");
                router.push(`/notes/${firstId}`);
              } catch (e) {
                toast(e instanceof Error ? e.message : "套用失敗");
              } finally {
                setBusy(false);
              }
            })()
          }
          onInstall={() => {
            if (pack) setConfirmPack(pack);
            setPreviewTpl(null);
          }}
        />
      )}

      {confirmPack && (
        <InstallConfirmModal
          pack={confirmPack}
          open
          busy={busy}
          onClose={() => setConfirmPack(null)}
          onConfirm={() => void doInstall(confirmPack.source)}
        />
      )}

      {reportOpen && (
        <div className="community-detail-backdrop" onClick={() => setReportOpen(false)}>
          <div className="community-detail" onClick={(e) => e.stopPropagation()}>
            <header>
              <div>
                <h2>回報套件</h2>
                <p>選擇原因，協助後續審核</p>
              </div>
              <button type="button" className="community-detail-close" onClick={() => setReportOpen(false)}>
                ×
              </button>
            </header>
            <div className="community-chips">
              {REPORT_REASONS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={reportReason === r.id ? "is-on" : ""}
                  onClick={() => setReportReason(r.id)}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <textarea
              className="community-review-ta"
              value={reportDetail}
              onChange={(e) => setReportDetail(e.target.value)}
              placeholder="補充說明（選填）"
              rows={3}
            />
            <div className="community-card-actions">
              <button type="button" className="btn" onClick={() => void submitReport()}>
                送出
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setReportOpen(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CommunityPackageDetailPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <CommunityPackageDetailInner />
    </Suspense>
  );
}
