"use client";

import PageLoading from "@/components/motion/PageLoading";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { listenToUserNotes, loginWithGoogle, type Note } from "@/lib/firebase";
import { useCommunity } from "@/components/community/CommunityProvider";
import {
  createExtensionWorkspacePage,
  noteOpenHref,
} from "@/lib/workspacePages";
import PageChromeIcon from "@/components/PageChromeIcon";
import ScrambleText from "@/components/motion/ScrambleText";
import ExtensionSettingsPanel, {
  hasExtensionSettings,
} from "@/components/community/ExtensionSettingsPanel";
import { toast } from "@/lib/toast";
import { touchRecentId } from "@/lib/userPrefs";
import { usePrefs } from "@/components/PrefsProvider";

function formatRelative(d: Date | undefined) {
  if (!d) return "";
  const ms = Date.now() - d.getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "剛剛";
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} 小時前`;
  return d.toLocaleDateString("zh-TW");
}

export default function ExtensionHubPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const router = useRouter();
  const prefsCtx = usePrefs();
  const { extensions, ready } = useCommunity();
  const [notes, setNotes] = useState<Note[]>([]);
  const [busy, setBusy] = useState(false);

  const ext = extensions.find((e) => e.id === id);

  useEffect(() => {
    if (!user) return;
    return listenToUserNotes(user.uid, setNotes);
  }, [user]);

  const pages = useMemo(
    () =>
      notes
        .filter(
          (n) =>
            n.app_link?.type === "extension" &&
            (n.app_link.id === id || n.props?.extension_id === id)
        )
        .sort((a, b) => (b.updated_at?.getTime() || 0) - (a.updated_at?.getTime() || 0)),
    [notes, id]
  );

  const create = async () => {
    if (!user || !ext) return;
    setBusy(true);
    try {
      const { noteId, href } = await createExtensionWorkspacePage(user.uid, ext.manifest);
      prefsCtx.setPrefs((p) => touchRecentId(p, noteId));
      router.push(href);
    } catch (e) {
      toast(e instanceof Error ? e.message : "建立失敗");
    } finally {
      setBusy(false);
    }
  };

  if (loading || !ready) return <PageLoading />;
  if (!user) {
    return (
      <div className="cdb-index">
        <h1 className="page-title font-display">擴充頁面</h1>
        <button type="button" className="btn" onClick={() => void loginWithGoogle()}>
          登入
        </button>
      </div>
    );
  }
  if (!ext) {
    return (
      <div className="cdb-index">
        <ScrambleText words="找不到擴充" as="h1" className="page-title font-display" />
        <p className="page-sub">此擴充尚未安裝或已解除安裝。</p>
        <Link href="/community" className="btn">
          前往社群商店
        </Link>
      </div>
    );
  }

  const title = ext.manifest.nav?.label || ext.manifest.name;
  const hasSettings = hasExtensionSettings(ext.manifest);

  return (
    <div className="cdb-index ext-hub">
      <header className="ext-hub-hero page-chrome">
        <div className="ext-hub-hero-main">
          <div className="ext-hub-badge" aria-hidden>
            <PageChromeIcon icon={ext.manifest.icon} fallback="extension" />
          </div>
          <div className="ext-hub-hero-copy">
            <div className="ext-hub-kicker">
              <span>{ext.manifest.category || "擴充"}</span>
              <span>v{ext.manifest.version}</span>
              {!ext.enabled ? <span className="is-warn">已停用</span> : null}
            </div>
            <ScrambleText words={title} as="h1" className="page-title font-display" />
            <p className="page-sub">{ext.manifest.description}</p>
            <div className="ext-hub-stats" aria-label="概況">
              <span>
                <strong>{pages.length}</strong>
                <em>個頁面</em>
              </span>
              <span>
                <strong>{(ext.manifest.settings || []).length}</strong>
                <em>項設定</em>
              </span>
              <span>
                <strong>{ext.manifest.author}</strong>
                <em>作者</em>
              </span>
            </div>
          </div>
        </div>
        <div className="ext-hub-hero-actions">
          <button
            type="button"
            className="btn"
            disabled={busy || !ext.enabled}
            onClick={() => void create()}
          >
            {busy ? "…" : ext.manifest.pageType.createLabel || "新建頁面"}
          </button>
          <Link className="btn btn-ghost" href={`/community/${ext.id}?kind=extension`}>
            套件詳情
          </Link>
        </div>
      </header>

      {!ext.enabled && (
        <p className="cdb-empty">
          此擴充已停用。到 <Link href="/community">社群商店</Link> 重新啟用。
        </p>
      )}

      <div className={`ext-hub-body${hasSettings ? " has-settings" : ""}`}>
        {hasSettings ? (
          <ExtensionSettingsPanel uid={user.uid} ext={ext} />
        ) : null}

        <section className="ext-hub-pages">
          <div className="ext-hub-pages-head">
            <h2>我的頁面</h2>
            <span>{pages.length} 個</span>
          </div>
          {pages.length === 0 ? (
            <div className="ext-hub-empty">
              <p>還沒有用此擴充建立頁面。</p>
              <button
                type="button"
                className="btn"
                disabled={busy || !ext.enabled}
                onClick={() => void create()}
              >
                建立第一頁
              </button>
            </div>
          ) : (
            <div className="ext-hub-page-grid">
              {pages.map((n) => (
                <Link key={n.id} href={noteOpenHref(n)} className="ext-hub-page-card">
                  <span className="ext-hub-page-icon">
                    <PageChromeIcon
                      icon={n.icon || ext.manifest.icon}
                      color={n.color}
                      fallback="extension"
                    />
                  </span>
                  <span className="ext-hub-page-meta">
                    <strong>{n.title || "未命名"}</strong>
                    <em>{formatRelative(n.updated_at) || "擴充頁面"}</em>
                  </span>
                  <span className="ext-hub-page-go" aria-hidden>
                    →
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
