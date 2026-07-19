"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { useAuth } from "@/components/AuthProvider";
import { listenToUserJobs, listenToUserNotes, loginWithGoogle, Job, Note } from "@/lib/firebase";
import LineRippleBackground from "@/components/motion/LineRippleBackground";
import TypeWriter from "@/components/motion/TypeWriter";
import ScrambleText from "@/components/motion/ScrambleText";
import ShinyPill from "@/components/motion/ShinyPill";

export default function HomePage() {
  const { user, loading } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    if (!user) return;
    const u1 = listenToUserJobs(user.uid, setJobs);
    const u2 = listenToUserNotes(user.uid, setNotes);
    return () => { u1(); u2(); };
  }, [user]);

  if (loading) {
    return <p style={{ color: "var(--text-muted)" }}>載入中…</p>;
  }

  if (!user) {
    return (
      <section
        style={{
          position: "relative",
          maxWidth: 760,
          margin: "1rem auto 2rem",
          textAlign: "center",
          padding: "3.5rem 1.25rem 3rem",
          borderRadius: "var(--radius-xl)",
          overflow: "hidden",
          border: "1px solid var(--border)",
          background: "linear-gradient(180deg, var(--bg-elevated), var(--bg-primary))",
        }}
      >
        <LineRippleBackground
          count={52}
          movement={20}
          strokeColor="rgba(13, 148, 136, 0.28)"
          force={4}
        />
        <div style={{ position: "relative", zIndex: 1 }}>
          <p className="badge" style={{ marginBottom: "1rem" }}>語音驅動的知識工作區</p>
          <ScrambleText
            words="Cadence"
            as="h1"
            className="font-display"
            style={{ fontSize: "clamp(2.6rem, 7vw, 4rem)", lineHeight: 1.05, marginBottom: "0.55rem" }}
            color="var(--text-main)"
            speed={24}
          />
          <h2 className="font-display" style={{ fontSize: "clamp(1.35rem, 3.5vw, 1.85rem)", marginBottom: "0.9rem", fontWeight: 600 }}>
            把說話寫成{" "}
            <TypeWriter
              texts={["知識", "筆記", "簡報大綱", "課堂重點"]}
              typedColor="var(--accent-2)"
              cursorColor="var(--accent-2)"
            />
          </h2>
          <p style={{ color: "var(--text-muted)", fontSize: "1.02rem", marginBottom: "1.7rem", maxWidth: 480, marginInline: "auto" }}>
            轉錄、校對、區塊筆記一氣呵成——靈感來自 Notion × Obsidian，動畫體驗借鏡{" "}
            <a href="https://www.originkit.dev/" target="_blank" rel="noreferrer" style={{ color: "var(--accent-2)" }}>
              OriginKit
            </a>
            。
          </p>
          <div style={{ display: "flex", gap: "0.65rem", justifyContent: "center", flexWrap: "wrap" }}>
            <ShinyPill onClick={() => loginWithGoogle()}>開始使用</ShinyPill>
            <Link href="/capture" className="btn btn-ghost">先看看捕捉頁</Link>
          </div>
        </div>
      </section>
    );
  }

  const recentJobs = jobs.slice(0, 5);
  const recentNotes = notes.slice(0, 5);
  const active = jobs.filter((j) => ["uploading", "queued", "processing"].includes(j.status));

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="page-title font-display">總覽</h1>
        <p className="page-sub">
          歡迎回來。{" "}
          <TypeWriter
            prefix=""
            texts={["從捕捉一段聲音開始", "打開知識庫繼續寫", "把逐字稿整理成筆記"]}
            typedColor="var(--text-muted)"
            cursorColor="var(--accent-2)"
            typeMs={40}
            holdMs={2200}
          />
        </p>
      </motion.div>

      <div className="grid-3" style={{ marginBottom: "1.25rem" }}>
        {[
          { href: "/capture", badge: "快捷", title: "捕捉語音", sub: "上傳、YouTube 或錄音" },
          { href: null, badge: "進行中", title: String(active.length), sub: "正在處理的轉錄" },
          { href: "/library", badge: "筆記", title: String(notes.length), sub: "知識庫篇數" },
        ].map((card, i) => {
          const inner = (
            <motion.div
              className="card"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * i }}
              whileHover={{ y: -3, borderColor: "rgba(20,184,166,0.35)" }}
              style={{ padding: "1.25rem", display: "block", borderColor: "var(--border)" }}
            >
              <div className="badge">{card.badge}</div>
              <h3 className="font-display" style={{ marginTop: "0.7rem", fontSize: "1.25rem" }}>{card.title}</h3>
              <p style={{ color: "var(--text-muted)", fontSize: "0.88rem", marginTop: "0.35rem" }}>{card.sub}</p>
            </motion.div>
          );
          return card.href ? <Link key={card.badge} href={card.href}>{inner}</Link> : <div key={card.badge}>{inner}</div>;
        })}
      </div>

      <div className="grid-2">
        <section className="card" style={{ padding: "1.2rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.8rem" }}>
            <h2 className="font-display" style={{ fontSize: "1.15rem" }}>最近筆記</h2>
            <Link href="/library" style={{ color: "var(--accent-2)", fontSize: "0.85rem" }}>全部</Link>
          </div>
          {recentNotes.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>還沒有筆記。轉錄完成後可一鍵轉成筆記。</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
              {recentNotes.map((n, i) => (
                <motion.div key={n.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
                  <Link href={`/notes/${n.id}`} className="surface" style={{ padding: "0.75rem 0.9rem", display: "block" }}>
                    <div style={{ fontWeight: 600 }}>{n.title}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                      {n.updated_at.toLocaleString("zh-TW")}
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          )}
        </section>

        <section className="card" style={{ padding: "1.2rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.8rem" }}>
            <h2 className="font-display" style={{ fontSize: "1.15rem" }}>最近轉錄</h2>
            <Link href="/library" style={{ color: "var(--accent-2)", fontSize: "0.85rem" }}>全部</Link>
          </div>
          {recentJobs.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>尚無轉錄紀錄。</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
              {recentJobs.map((j, i) => (
                <motion.div key={j.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
                  <Link href={`/job/${j.id}`} className="surface" style={{ padding: "0.75rem 0.9rem", display: "block" }}>
                    <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {j.filenames?.[0] || j.youtube_url || "未命名"}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                      {j.status} · {j.created_at.toLocaleString("zh-TW")}
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
