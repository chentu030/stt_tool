"use client";

import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { loginWithGoogle, logout } from "@/lib/firebase";
import ThemeToggle from "@/components/ThemeToggle";

export default function SettingsPage() {
  const { user, loading } = useAuth();

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 className="page-title font-display">設定</h1>
      <p className="page-sub">帳號、外觀與路線圖。</p>

      <section className="card" style={{ padding: "1.2rem", marginBottom: "1rem" }}>
        <h2 className="font-display" style={{ fontSize: "1.05rem", marginBottom: "0.7rem" }}>外觀</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "0.7rem" }}>
          <span style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>深淺色切換</span>
          <ThemeToggle />
        </div>
      </section>

      <section className="card" style={{ padding: "1.2rem", marginBottom: "1rem" }}>
        <h2 className="font-display" style={{ fontSize: "1.05rem", marginBottom: "0.7rem" }}>帳號</h2>
        {loading ? (
          <p style={{ color: "var(--text-muted)" }}>載入中…</p>
        ) : user ? (
          <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
            <img src={user.photoURL || ""} alt="" width={40} height={40} style={{ borderRadius: "50%" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{user.displayName}</div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{user.email}</div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => logout()}>登出</button>
          </div>
        ) : (
          <button className="btn" onClick={() => loginWithGoogle()}>使用 Google 登入</button>
        )}
      </section>

      <section className="card" style={{ padding: "1.2rem", marginBottom: "1rem" }}>
        <h2 className="font-display" style={{ fontSize: "1.05rem", marginBottom: "0.7rem" }}>YouTube 本機擷取器</h2>
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "0.7rem" }}>
          用你自己的 IP 下載公開影片音訊，避開伺服器被封鎖。
        </p>
        <a className="btn btn-soft btn-sm" href="/youtube-extractor.zip" download>下載擴充</a>
      </section>

      <section className="card" style={{ padding: "1.2rem" }}>
        <h2 className="font-display" style={{ fontSize: "1.05rem", marginBottom: "0.7rem" }}>路線圖</h2>
        <ul style={{ color: "var(--text-muted)", fontSize: "0.9rem", lineHeight: 1.8, paddingLeft: "1.1rem" }}>
          <li>已完成：知識庫、逐字稿編輯、筆記、捕捉、藍綠黑白分版</li>
          <li>Phase A：區塊編輯、/ 指令、拖曳、樣式列、圖片、自動儲存、匯出 MD</li>
          <li>下一階段：PDF／DOCX 匯出；再來 [[wikilink]]、標籤、範本</li>
          <li>之後：白板、簡報、協作／AI；Capacitor iOS／Android</li>
        </ul>
        <p style={{ marginTop: "0.6rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>
          完整清單見 repo 根目錄 <code>ROADMAP.md</code>
        </p>
        <p style={{ marginTop: "0.8rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>
          舊版歷史頁仍可用：<Link href="/history" style={{ color: "var(--accent-2)" }}>/history</Link>
        </p>
      </section>
    </div>
  );
}
