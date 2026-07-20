"use client";

import PageLoading from "@/components/motion/PageLoading";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import DatabaseView from "@/components/database/DatabaseView";
import { loginWithGoogle } from "@/lib/firebase";
import { useRedirectSpecialtyToNote } from "@/components/workspace/useRedirectSpecialtyToNote";

export default function DatabasePage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const { embed } = useRedirectSpecialtyToNote("database", id);

  if (loading) return <PageLoading />;
  if (!user) {
    return (
      <div style={{ padding: "2rem" }}>
        <h1 className="page-title font-display">資料庫</h1>
        <p className="page-sub">登入後管理資料庫。</p>
        <button type="button" className="btn" onClick={() => void loginWithGoogle()}>
          登入
        </button>
      </div>
    );
  }
  if (!id) return <p className="cdb-empty">無效的資料庫</p>;

  return (
    <div className={`cdb-page${embed ? " is-embed" : ""}`}>
      {!embed && (
        <div className="cdb-page-nav">
          <Link href="/db">← 全部資料庫</Link>
        </div>
      )}
      <DatabaseView databaseId={id} userId={user.uid} compact={embed} />
    </div>
  );
}
