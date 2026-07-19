"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import DatabaseView from "@/components/database/DatabaseView";
import { loginWithGoogle } from "@/lib/firebase";

export default function DatabasePage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useAuth();

  if (loading) return <p style={{ padding: "1.5rem", color: "var(--text-muted)" }}>載入中…</p>;
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
    <div className="cdb-page">
      <div className="cdb-page-nav">
        <Link href="/db">← 全部資料庫</Link>
      </div>
      <DatabaseView databaseId={id} userId={user.uid} />
    </div>
  );
}
