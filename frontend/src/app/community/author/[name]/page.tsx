"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getCatalog } from "@/lib/community/builtins";
import { PackageCard } from "@/components/community/StoreWidgets";
import { useCommunity } from "@/components/community/CommunityProvider";
import { useAuth } from "@/components/AuthProvider";
import { loginWithGoogle } from "@/lib/firebase";
import { installFromSource } from "@/lib/community/actions";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "@/lib/toast";
import ScrambleText from "@/components/motion/ScrambleText";
import { getLocalRating } from "@/lib/community/ratings";

export default function CommunityAuthorPage() {
  const { name } = useParams<{ name: string }>();
  const author = decodeURIComponent(name || "");
  const catalog = useMemo(() => getCatalog(), []);
  const { user } = useAuth();
  const { extensions, templates } = useCommunity();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const entries = useMemo(
    () =>
      catalog.filter((c) => c.author.toLowerCase() === author.toLowerCase()),
    [catalog, author]
  );

  const installed = useMemo(() => {
    const s = new Set([...extensions.map((e) => e.id), ...templates.map((t) => t.id)]);
    return s;
  }, [extensions, templates]);

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
    <div className="community-page">
      <nav className="community-crumb">
        <Link href="/community">社群商店</Link>
        <span>/</span>
        <span>作者</span>
        <span>/</span>
        <span>{author}</span>
      </nav>
      <ScrambleText words={author || "作者"} as="h1" className="page-title font-display" />
      <p className="page-sub">{entries.length} 個套件</p>
      {entries.length === 0 ? (
        <p className="community-empty">找不到此作者的精選目錄項目。</p>
      ) : (
        <div className="community-grid">
          {entries.map((entry) => (
            <PackageCard
              key={`${entry.kind}-${entry.id}`}
              entry={entry}
              installed={installed.has(entry.id)}
              href={`/community/${entry.id}?kind=${entry.kind}`}
              busy={busy}
              userRating={getLocalRating(entry.id)}
              onInstall={() =>
                void (async () => {
                  setBusy(true);
                  try {
                    await installFromSource(user.uid, entry.source);
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
      )}
    </div>
  );
}
