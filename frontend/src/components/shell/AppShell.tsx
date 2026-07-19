"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { loginWithGoogle, logout } from "@/lib/firebase";
import ThemeToggle from "@/components/ThemeToggle";
import CadenceLogo from "@/components/CadenceLogo";

const NAV = [
  { href: "/", label: "總覽", icon: HomeIcon },
  { href: "/library", label: "知識庫", icon: LibraryIcon },
  { href: "/journal", label: "日誌", icon: JournalIcon },
  { href: "/capture", label: "捕捉", icon: MicIcon },
  { href: "/settings", label: "設定", icon: SettingsIcon },
];

function HomeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 10.5L12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1v-10.5z" />
    </svg>
  );
}
function LibraryIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}
function JournalIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function useIsMobile(breakpoint = 900) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const apply = () => setMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [breakpoint]);
  return mobile;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const isMobile = useIsMobile();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  if (isMobile) {
    return (
      <div className="mobile-shell">
        <header className="mobile-top">
          <Link href="/"><CadenceLogo height={24} /></Link>
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <ThemeToggle />
            {!loading && !user && (
              <button className="btn btn-sm" onClick={() => loginWithGoogle()}>登入</button>
            )}
          </div>
        </header>
        <main className="app-main">{children}</main>
        <nav className="mobile-bottom">
          <Link href="/" className={isActive("/") ? "active" : ""}>
            <HomeIcon />
            總覽
          </Link>
          <Link href="/library" className={isActive("/library") ? "active" : ""}>
            <LibraryIcon />
            知識庫
          </Link>
          <Link href="/capture" className={isActive("/capture") ? "active" : ""}>
            <span className="capture-fab"><MicIcon /></span>
          </Link>
          <Link href="/journal" className={isActive("/journal") ? "active" : ""}>
            <JournalIcon />
            日誌
          </Link>
          <Link href="/settings" className={isActive("/settings") ? "active" : ""}>
            <SettingsIcon />
            設定
          </Link>
        </nav>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="desktop-sidebar">
        <Link href="/" style={{ padding: "0.35rem 0.6rem 1.1rem", display: "block" }}>
          <CadenceLogo height={28} />
        </Link>
        <nav className="sidebar-nav" style={{ flex: 1 }}>
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className={isActive(item.href) ? "active" : ""}>
              <item.icon />
              {item.label}
            </Link>
          ))}
        </nav>
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.8rem", display: "flex", flexDirection: "column", gap: "0.45rem" }}>
          <ThemeToggle />
          {loading ? null : user ? (
            <button className="nav-item" onClick={() => logout()} style={{ color: "var(--text-muted)" }}>
              <img src={user.photoURL || ""} alt="" width={20} height={20} style={{ borderRadius: "50%" }} />
              登出
            </button>
          ) : (
            <button className="btn btn-sm" onClick={() => loginWithGoogle()}>登入</button>
          )}
        </div>
      </aside>
      <main className="app-main">{children}</main>
    </div>
  );
}
