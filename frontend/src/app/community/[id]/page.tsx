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
  PackageDetailBody,
  StarRow,
  TemplatePreviewModal,
  TrustScorecard,
} from "@/components/community/StoreWidgets";
import { getLocalRating, saveUserRating, saveUserReport } from "@/lib/community/ratings";
import {
  isFavorite,
  toggleFavorite,
  touchRecentPackage,
} from "@/lib/community/libraryPrefs";
import { askPrompt } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import { touchRecentId } from "@/lib/userPrefs";
import { usePrefs } from "@/components/PrefsProvider";

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
  const [previewTpl, setPreviewTpl] = useState<InstalledTemplate | null>(null);
  const [fav, setFav] = useState(false);

  const catalog = useMemo(() => getCatalog(), []);

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
      extensions.find((x) => x.id === id)?.source ||
      templates.find((t) => t.id === id)?.source;
    if (!source) {
      setErr("找不到此套件");
      return;
    }
    let cancelled = false;
    setBusy(true);
    void resolveAnySource(source)
      .then((p) => {
        if (!cancelled) setPack(p);
      })
      .catch((ex) => {
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
    if (r) setStars(r.stars);
    else if (entry?.rating) setStars(Math.round(entry.rating));
  }, [id, entry]);

  const installedExt = extensions.find((e) => e.id === id);
  const installedTpl = templates.find((t) => t.id === id);
  const installed = Boolean(installedExt || installedTpl);

  const copyShare = async () => {
    const url = typeof window !== "undefined" ? window.location.href : `/community/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("已複製分享連結");
    } catch {
      toast(url);
    }
  };

  const report = async () => {
    if (!user) return;
    const reason = await askPrompt({
      title: "回報套件",
      message: "簡述問題（惡意、誤導、失效、侵權等）",
      placeholder: "例如：入口網址失效",
    });
    if (!reason?.trim()) return;
    try {
      await saveUserReport(user.uid, {
        packageId: id,
        reason: reason.trim().slice(0, 200),
        updatedAt: Date.now(),
      });
      toast("已送出回報（僅你的帳號可見，供後續審核）");
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
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void (async () => {
                      setBusy(true);
                      try {
                        await installFromSource(user.uid, entry?.source || pack.source);
                        toast("安裝完成");
                      } catch (e) {
                        toast(e instanceof Error ? e.message : "安裝失敗");
                      } finally {
                        setBusy(false);
                      }
                    })()
                  }
                >
                  安裝
                </button>
              ) : pack.manifest.kind === "extension" ? (
                <Link className="btn" href={`/ext/${id}`}>
                  開啟
                </Link>
              ) : (
                <button
                  type="button"
                  className="btn"
                  onClick={() => installedTpl && setPreviewTpl(installedTpl)}
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
              <button type="button" className="btn btn-ghost" onClick={() => void report()}>
                回報
              </button>
              <Link className="btn btn-ghost" href="/community">
                返回
              </Link>
            </div>
          </header>

          <TrustScorecard manifest={pack.manifest} />

          <div className="community-rate-box">
            <span>為這個套件評分</span>
            <StarRow
              value={stars}
              onChange={(n) => {
                setStars(n);
                void saveUserRating(user.uid, {
                  packageId: id,
                  stars: n,
                  updatedAt: Date.now(),
                }).then(() => toast("已儲存評分"));
              }}
            />
          </div>

          <PackageDetailBody pack={pack} entry={entry} />
        </>
      )}

      {previewTpl && (
        <TemplatePreviewModal
          tpl={previewTpl}
          open
          busy={busy}
          onClose={() => setPreviewTpl(null)}
          onApply={(folder) =>
            void (async () => {
              setBusy(true);
              try {
                const { firstId } = await applyInstalledTemplate(user.uid, previewTpl, { folder });
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
        />
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
