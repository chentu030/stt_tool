"use client";

import PageLoading from "@/components/motion/PageLoading";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { getNote, loginWithGoogle, updateNote, type Note } from "@/lib/firebase";
import WebPageView from "@/components/workspace/WebPageView";

/** Full-screen browser tab for workspace "網頁" pages (slash embeds stay in-note). */
export default function WebWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const embed = searchParams.get("embed") === "1";
  const { user, loading } = useAuth();
  const [note, setNote] = useState<Note | null>(null);
  const [title, setTitle] = useState("");
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (embed) {
      document.documentElement.classList.add("is-note-app-embed");
      return () => document.documentElement.classList.remove("is-note-app-embed");
    }
    return;
  }, [embed]);

  useEffect(() => {
    if (!id || !user) return;
    let cancelled = false;
    void getNote(id).then((n) => {
      if (cancelled) return;
      if (!n || (n.app_link?.type && n.app_link.type !== "web")) {
        setMissing(true);
        setNote(null);
        return;
      }
      setMissing(false);
      setNote(n);
      setTitle(n.title || "");
    });
    return () => {
      cancelled = true;
    };
  }, [id, user]);

  if (loading) return <PageLoading />;
  if (!user) {
    return (
      <div className="web-full-page web-full-guest">
        <h1 className="page-title font-display">網頁</h1>
        <p className="page-sub">登入後以全螢幕分頁瀏覽網頁。</p>
        <button type="button" className="btn" onClick={() => void loginWithGoogle()}>
          登入
        </button>
      </div>
    );
  }
  if (!id || missing) {
    return (
      <div className="web-full-page web-full-guest">
        <p className="cdb-empty">找不到此網頁分頁</p>
        <Link href="/library" className="btn btn-sm">
          回知識庫
        </Link>
      </div>
    );
  }
  if (!note) return <PageLoading label="載入網頁中…" />;

  return (
    <div className={`web-full-page${embed ? " is-embed" : ""}`}>
      {!embed && (
        <div className="web-full-top">
          <input
            className="web-full-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              const next = title.trim();
              if (!next || next === note.title) return;
              void updateNote(note.id, { title: next });
              setNote((n) => (n ? { ...n, title: next } : n));
            }}
            placeholder="網頁標題"
            aria-label="頁面標題"
          />
          <Link href="/library" className="web-full-lib">
            知識庫
          </Link>
        </div>
      )}
      <WebPageView
        note={{ ...note, title }}
        compact={embed}
        onTitleHint={(t) => {
          setTitle(t);
          setNote((n) => (n ? { ...n, title: t } : n));
        }}
      />
    </div>
  );
}
