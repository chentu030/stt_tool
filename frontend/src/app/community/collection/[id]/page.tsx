"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { loginWithGoogle } from "@/lib/firebase";
import { useCommunity } from "@/components/community/CommunityProvider";
import { getCatalog, getCollections } from "@/lib/community/builtins";
import { installCollectionSources, installFromSource } from "@/lib/community/actions";
import { PackageCard } from "@/components/community/StoreWidgets";
import { getLocalRating } from "@/lib/community/ratings";
import ScrambleText from "@/components/motion/ScrambleText";
import { toast } from "@/lib/toast";

export default function CommunityCollectionPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { extensions, templates } = useCommunity();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const collection = useMemo(
    () => getCollections().find((c) => c.id === id) || null,
    [id]
  );
  const catalog = useMemo(() => getCatalog(), []);
  const entries = useMemo(() => {
    if (!collection) return [];
    return collection.packageIds
      .map((pid) => catalog.find((c) => c.id === pid))
      .filter((c): c is NonNullable<typeof c> => Boolean(c));
  }, [collection, catalog]);

  const installed = useMemo(
    () => new Set([...extensions.map((e) => e.id), ...templates.map((t) => t.id)]),
    [extensions, templates]
  );

  const installAll = async () => {
    if (!user || !collection) return;
    setBusy(true);
    try {
      const sources = entries.map((e) => e.source);
      const r = await installCollectionSources(user.uid, sources, new Set(installed), {
        email: user.email,
      });
      toast(
        `合輯安裝：成功 ${r.ok}、略過 ${r.skipped}${r.failed.length ? `、失敗 ${r.failed.length}` : ""}`
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "安裝失敗");
    } finally {
      setBusy(false);
    }
  };

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

  if (!collection) {
    return (
      <div className="community-page">
        <p className="community-empty">找不到此合輯。</p>
        <Link className="btn" href="/community">
          返回商店
        </Link>
      </div>
    );
  }

  return (
    <div className="community-page">
      <nav className="community-crumb">
        <Link href="/community">社群商店</Link>
        <span>/</span>
        <span>合輯</span>
        <span>/</span>
        <span>{collection.name}</span>
      </nav>
      <div className="community-hero page-chrome">
        <div>
          <ScrambleText words={collection.name} as="h1" className="page-title font-display" />
          <p className="page-sub">{collection.description}</p>
        </div>
        <div className="community-hero-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => void installAll()}>
            {busy ? "安裝中…" : "一鍵安裝合輯"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              const url = window.location.href;
              void navigator.clipboard.writeText(url).then(
                () => toast("已複製合輯連結"),
                () => toast(url)
              );
            }}
          >
            分享
          </button>
        </div>
      </div>
      <div className="community-grid">
        {entries.map((entry) => (
          <PackageCard
            key={`${entry.kind}-${entry.id}`}
            entry={entry}
            installed={installed.has(entry.id)}
            href={`/community/${entry.id}?kind=${entry.kind}`}
            busy={busy}
            viewerEmail={user?.email}
            userRating={getLocalRating(entry.id)}
            onInstall={() =>
              void (async () => {
                setBusy(true);
                try {
                  await installFromSource(user.uid, entry.source, { email: user.email });
                  toast("安裝完成");
                } catch (e) {
                  toast(e instanceof Error ? e.message : "安裝失敗");
                } finally {
                  setBusy(false);
                }
              })()
            }
            onOpen={() => {
              if (entry.kind === "extension") router.push(`/ext/${entry.id}`);
              else router.push(`/community/${entry.id}?kind=template`);
            }}
          />
        ))}
      </div>
    </div>
  );
}
