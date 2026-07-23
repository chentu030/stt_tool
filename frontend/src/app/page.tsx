"use client";

import PageLoading from "@/components/motion/PageLoading";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { useAuth } from "@/components/AuthProvider";
import { listenToUserJobs, loginWithGoogle, Job, jobDisplayTitle } from "@/lib/firebase";
import { useNotesList } from "@/components/notes/NotesListProvider";
import LineRippleBackground from "@/components/motion/LineRippleBackground";
import TypeWriter from "@/components/motion/TypeWriter";
import ScrambleText from "@/components/motion/ScrambleText";
import ShinyPill from "@/components/motion/ShinyPill";
import { libraryJobsUrl } from "@/lib/navApps";
import { readDailyRhythm, type DailyRhythmState } from "@/lib/dailyRhythm";
import { openGlobalAiRail } from "@/components/shell/GlobalAiDock";
import { journalTitle } from "@/lib/templates";

export default function HomePage() {
  const { user, loading } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const { notes } = useNotesList();
  const [rhythm, setRhythm] = useState<DailyRhythmState>(() =>
    typeof window === "undefined"
      ? { date: "", capture: false, open: false, organize: false }
      : readDailyRhythm()
  );

  useEffect(() => {
    if (!user) return;
    return listenToUserJobs(user.uid, setJobs);
  }, [user]);

  useEffect(() => {
    setRhythm(readDailyRhythm());
    const on = () => setRhythm(readDailyRhythm());
    window.addEventListener("cadence-daily-rhythm", on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener("cadence-daily-rhythm", on);
      window.removeEventListener("storage", on);
    };
  }, []);

  if (loading) {
    return <PageLoading />;
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
            words="Albireus"
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
            錄音與影片轉成可編輯的筆記：捕捉、校對、整理，全部在 Albireus 完成。
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
  const doneCount = [rhythm.capture, rhythm.open, rhythm.organize].filter(Boolean).length;

  return (
    <div style={{ minWidth: 0, maxWidth: "100%" }}>
      <motion.div className="page-chrome" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="page-title font-display">總覽</h1>
        <p className="page-sub">
          <TypeWriter
            prefix=""
            texts={["開始捕捉", "打開知識庫", "整理逐字稿"]}
            typedColor="var(--text-muted)"
            cursorColor="var(--accent-2)"
            typeMs={40}
            holdMs={2200}
          />
        </p>
      </motion.div>

      <section className="card home-rhythm" style={{ padding: "1.1rem 1.2rem", marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "baseline", flexWrap: "wrap" }}>
          <h2 className="font-display" style={{ fontSize: "1.1rem", margin: 0 }}>
            今日節奏
          </h2>
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            {doneCount}/3 完成 · 明天從日誌回來
          </span>
        </div>
        <ol className="home-rhythm-steps">
          <li className={rhythm.capture ? "is-done" : ""}>
            <span className="home-rhythm-check" aria-hidden>
              {rhythm.capture ? "✓" : "1"}
            </span>
            <div>
              <strong>捕捉</strong>
              <p>語音或 ⌘K 寫一句到今日日誌</p>
            </div>
            <Link
              href={`/journal?date=${encodeURIComponent(journalTitle())}`}
              className="btn btn-sm btn-soft"
            >
              去日誌
            </Link>
          </li>
          <li className={rhythm.open ? "is-done" : ""}>
            <span className="home-rhythm-check" aria-hidden>
              {rhythm.open ? "✓" : "2"}
            </span>
            <div>
              <strong>打開結果</strong>
              <p>到知識庫看剛捕捉的內容</p>
            </div>
            <Link
              href="/library"
              className="btn btn-sm btn-soft"
            >
              知識庫
            </Link>
          </li>
          <li className={rhythm.organize ? "is-done" : ""}>
            <span className="home-rhythm-check" aria-hidden>
              {rhythm.organize ? "✓" : "3"}
            </span>
            <div>
              <strong>整理結構</strong>
              <p>用 AI 抽出待辦或重排大綱</p>
            </div>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                openGlobalAiRail();
              }}
            >
              開 AI
            </button>
          </li>
        </ol>
      </section>

      <div className="grid-3" style={{ marginBottom: "1.25rem" }}>
        {[
          { href: "/journal", badge: "今日", title: "日誌", sub: "先寫下來，稍後再分類" },
          { href: "/capture", badge: "快捷", title: "捕捉語音", sub: "上傳、YouTube 或錄音" },
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
          return (
            <Link key={card.badge} href={card.href}>
              {inner}
            </Link>
          );
        })}
      </div>

      <div className="grid-2">
        <section className="card" style={{ padding: "1.2rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", marginBottom: "0.8rem", minWidth: 0 }}>
            <h2 className="font-display" style={{ fontSize: "1.15rem", minWidth: 0 }}>
              最近筆記
            </h2>
            <Link href="/library" style={{ color: "var(--accent-2)", fontSize: "0.85rem", flexShrink: 0 }}>
              全部
            </Link>
          </div>
          {recentNotes.length === 0 ? (
            <div className="hub-empty">
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", margin: 0 }}>
                還沒有筆記 — 先去日誌按住說話，或 ⌘K 寫一句
              </p>
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                <Link href="/journal" className="btn btn-sm">
                  今日日誌
                </Link>
                <Link href="/capture" className="btn btn-ghost btn-sm">
                  去捕捉
                </Link>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem", minWidth: 0 }}>
              {recentNotes.map((n, i) => (
                <motion.div
                  key={n.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  style={{ minWidth: 0 }}
                >
                  <Link
                    href={`/notes/${n.id}`}
                    className="surface"
                    style={{ padding: "0.75rem 0.9rem", display: "block", minWidth: 0 }}
                  >
                    <div
                      style={{
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {n.title}
                    </div>
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
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", marginBottom: "0.8rem", minWidth: 0 }}>
            <h2 className="font-display" style={{ fontSize: "1.15rem", minWidth: 0 }}>
              最近轉錄
            </h2>
            <Link href="/library?tab=jobs" style={{ color: "var(--accent-2)", fontSize: "0.85rem", flexShrink: 0 }}>
              全部
            </Link>
          </div>
          {recentJobs.length === 0 ? (
            <div className="hub-empty">
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", margin: 0 }}>
                尚無轉錄紀錄
              </p>
              <Link href="/capture" className="btn btn-sm">
                開始捕捉
              </Link>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem", minWidth: 0 }}>
              {recentJobs.map((j, i) => (
                <motion.div
                  key={j.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  style={{ minWidth: 0 }}
                >
                  <Link
                    href={`/job/${j.id}`}
                    className="surface"
                    style={{ padding: "0.75rem 0.9rem", display: "block", minWidth: 0 }}
                  >
                    <div
                      style={{
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {jobDisplayTitle(j)}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                      {j.status} · {j.created_at.toLocaleString("zh-TW")}
                    </div>
                  </Link>
                </motion.div>
              ))}
              {active.length > 0 && (
                <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0.35rem 0 0" }}>
                  進行中 {active.length} 件 · <Link href={libraryJobsUrl()}>查看</Link>
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
