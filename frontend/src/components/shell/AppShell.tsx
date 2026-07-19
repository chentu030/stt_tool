"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { loginWithGoogle, logout, listenToUserNotes, listenToUserJobs, type Note, type Job } from "@/lib/firebase";
import ThemeToggle from "@/components/ThemeToggle";
import CadenceLogo from "@/components/CadenceLogo";
import { usePrefsOptional } from "@/components/PrefsProvider";
import SidebarNotesTree from "@/components/shell/SidebarNotesTree";
import CommandPalette from "@/components/CommandPalette";
import GlobalAiDock from "@/components/shell/GlobalAiDock";

const NAV_APPS = [
  { href: "/library", label: "知識庫", icon: LibraryIcon },
  { href: "/journal", label: "日誌", icon: JournalIcon },
  { href: "/capture", label: "捕捉", icon: MicIcon },
  { href: "/board", label: "看板", icon: BoardIcon },
  { href: "/db", label: "資料庫", icon: DatabaseIcon },
  { href: "/canvas", label: "白板", icon: CanvasIcon },
  { href: "/graph", label: "圖譜", icon: GraphIcon },
  { href: "/team", label: "團隊", icon: TeamIcon },
];

function HomeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 10.5L12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1v-10.5z" />
    </svg>
  );
}
function LibraryIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}
function JournalIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
function BoardIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="18" rx="1" />
      <rect x="14" y="3" width="7" height="10" rx="1" />
    </svg>
  );
}
function DatabaseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </svg>
  );
}
function CanvasIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="9" cy="16" r="1.5" />
    </svg>
  );
}
function GraphIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="6" cy="7" r="2.5" />
      <circle cx="18" cy="7" r="2.5" />
      <circle cx="12" cy="17" r="2.5" />
      <path d="M8.2 8.5l3 6.5M15.8 8.5l-3 6.5M8.5 7h7" />
    </svg>
  );
}
function TeamIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="9" cy="8" r="3" />
      <path d="M3 21v-1.5A4.5 4.5 0 0 1 7.5 15h3A4.5 4.5 0 0 1 15 19.5V21" />
      <circle cx="17" cy="8.5" r="2.2" />
      <path d="M16 15.2a3.6 3.6 0 0 1 5 3.3V21" />
    </svg>
  );
}
function MicIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function useIsMobile(breakpoint = 900) {
  const [mobile, setMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(`(max-width: ${breakpoint}px)`).matches;
  });
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const apply = () => setMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [breakpoint]);
  return mobile;
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const prefsCtx = usePrefsOptional();
  const homeHref = prefsCtx?.prefs.homePage || "/";
  const isMobile = useIsMobile();
  const isImmersive =
    pathname.startsWith("/notes/") ||
    pathname.startsWith("/canvas") ||
    pathname.startsWith("/graph");
  const isDoc = isImmersive;
  const [cmdOpen, setCmdOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  useEffect(() => {
    if (!user) {
      setNotes([]);
      setJobs([]);
      return;
    }
    const u1 = listenToUserNotes(user.uid, setNotes);
    const u2 = listenToUserJobs(user.uid, setJobs);
    return () => {
      u1();
      u2();
    };
  }, [user]);

  useEffect(() => {
    if (prefsCtx?.prefs.enableShortcuts === false) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && (key === "k" || key === "p")) {
        e.preventDefault();
        setCmdOpen(true);
      }
      if (mod && e.key === "[") {
        e.preventDefault();
        window.history.back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prefsCtx?.prefs.enableShortcuts]);

  const palette = (
    <CommandPalette
      open={cmdOpen}
      onClose={() => setCmdOpen(false)}
      notes={notes}
      jobs={jobs}
      userId={user?.uid}
    />
  );

  if (isMobile) {
    return (
      <div className="mobile-shell">
        <header className="mobile-top">
          <Link href={homeHref}>
            <CadenceLogo height={24} />
          </Link>
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              title="搜尋 ⌘K"
              onClick={() => setCmdOpen(true)}
            >
              ⌕
            </button>
            <ThemeToggle />
            {!loading && !user && (
              <button className="btn btn-sm" onClick={() => loginWithGoogle()}>
                登入
              </button>
            )}
          </div>
        </header>
        <main className={`app-main${isDoc ? " app-main--doc" : ""}`}>{children}</main>
        <nav className="mobile-bottom">
          <Link href="/library" className={isActive("/library") ? "active" : ""}>
            <LibraryIcon />
            知識庫
          </Link>
          <Link href="/journal" className={isActive("/journal") ? "active" : ""}>
            <JournalIcon />
            日誌
          </Link>
          <Link href="/capture" className={isActive("/capture") ? "active" : ""}>
            <span className="capture-fab">
              <MicIcon />
            </span>
          </Link>
          <Link href="/board" className={isActive("/board") ? "active" : ""}>
            <BoardIcon />
            看板
          </Link>
          <Link href="/settings" className={isActive("/settings") ? "active" : ""}>
            <SettingsIcon />
            設定
          </Link>
        </nav>
        {palette}
        <GlobalAiDock />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="desktop-sidebar desktop-sidebar--tree">
        <div className="sidebar-brand">
          <Link href={homeHref}>
            <CadenceLogo height={24} />
          </Link>
          <div className="sidebar-brand-links">
            <button
              type="button"
              className="sidebar-brand-links a"
              title="搜尋 ⌘K"
              onClick={() => setCmdOpen(true)}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: "var(--text-muted)",
                padding: "0.35rem",
              }}
            >
              ⌕
            </button>
            <Link href="/" className={isActive("/") ? "is-on" : ""} title="總覽">
              <HomeIcon />
            </Link>
            <Link href="/settings" className={isActive("/settings") ? "is-on" : ""} title="設定">
              <SettingsIcon />
            </Link>
          </div>
        </div>

        <nav className="sidebar-apps" aria-label="應用">
          {NAV_APPS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={isActive(item.href) ? "is-on" : ""}
              title={item.label}
            >
              <item.icon />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar-tree-wrap">
          <SidebarNotesTree />
        </div>

        <div className="sidebar-footer">
          {loading ? null : user ? (
            <div className="sidebar-user">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="sidebar-user-avatar"
                src={user.photoURL || ""}
                alt=""
                referrerPolicy="no-referrer"
              />
              <div className="sidebar-user-meta">
                <div className="sidebar-user-name">{user.displayName || "使用者"}</div>
                <button type="button" className="sidebar-user-action" onClick={() => logout()}>
                  登出
                </button>
              </div>
              <ThemeToggle />
            </div>
          ) : (
            <div className="sidebar-user sidebar-user--guest">
              <button
                type="button"
                className="btn btn-sm"
                style={{ flex: 1 }}
                onClick={() => loginWithGoogle()}
              >
                登入
              </button>
              <ThemeToggle />
            </div>
          )}
        </div>
      </aside>
      <main className={`app-main${isDoc ? " app-main--doc" : ""}`}>{children}</main>
      {palette}
      <GlobalAiDock />
    </div>
  );
}
