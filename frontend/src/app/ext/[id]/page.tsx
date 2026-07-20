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
import ExtensionSettingsPanel from "@/components/community/ExtensionSettingsPanel";
import { toast } from "@/lib/toast";
import { touchRecentId } from "@/lib/userPrefs";
import { usePrefs } from "@/components/PrefsProvider";

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
      notes.filter(
        (n) =>
          n.app_link?.type === "extension" &&
          (n.app_link.id === id || n.props?.extension_id === id)
      ),
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
      <div>
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

  return (
    <div className="cdb-index">
      <div className="cdb-index-head page-chrome">
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
          <PageChromeIcon icon={ext.manifest.icon} fallback="extension" />
          <div>
            <ScrambleText
              words={ext.manifest.nav?.label || ext.manifest.name}
              as="h1"
              className="page-title font-display"
            />
            <p className="page-sub">{ext.manifest.description}</p>
          </div>
        </div>
        <button type="button" className="btn" disabled={busy || !ext.enabled} onClick={() => void create()}>
          {busy ? "…" : ext.manifest.pageType.createLabel || "新建頁面"}
        </button>
      </div>
      {!ext.enabled && (
        <p className="cdb-empty">此擴充已停用。到<a href="/community">社群商店</a>重新啟用。</p>
      )}
      <ExtensionSettingsPanel uid={user.uid} ext={ext} />
      <div className="cdb-index-actions">
        <Link className="btn btn-ghost" href={`/community/${ext.id}?kind=extension`}>
          套件詳情
        </Link>
      </div>
      {pages.length === 0 ? (
        <div className="cdb-empty cdb-empty--cta">
          <p>尚未用此擴充建立頁面。</p>
          <button type="button" className="btn" disabled={busy || !ext.enabled} onClick={() => void create()}>
            建立第一頁
          </button>
        </div>
      ) : (
        <div className="cdb-index-grid">
          {pages.map((n) => (
            <Link key={n.id} href={noteOpenHref(n)} className="cdb-index-card">
              <PageChromeIcon icon={n.icon || ext.manifest.icon} fallback="extension" />
              <strong>{n.title || "未命名"}</strong>
              <span>擴充頁面</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
