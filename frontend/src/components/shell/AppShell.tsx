"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as REPointerEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { loginWithGoogle, logout, listenToUserNotes, listenToUserJobs, type Note, type Job } from "@/lib/firebase";
import ThemeToggle from "@/components/ThemeToggle";
import AlbireusLogo from "@/components/AlbireusLogo";
import { usePrefsOptional } from "@/components/PrefsProvider";
import SidebarNotesTree from "@/components/shell/SidebarNotesTree";
import CommandPalette from "@/components/CommandPalette";
import GlobalAiDock, { toggleGlobalAiRail } from "@/components/shell/GlobalAiDock";
import NavHistoryControls from "@/components/shell/NavHistoryControls";
import {
  listenUserTeams,
  listenChannels,
  listenChannelReads,
  listenNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  channelIsUnread,
  type TeamMembership,
  type Channel,
  type TeamNotification,
} from "@/lib/teamStore";
import { NAV_APPS, MOBILE_BOTTOM, type NavAppDef } from "@/lib/navApps";
import { useCommunityOptional } from "@/components/community/CommunityProvider";
import PageChromeIcon from "@/components/PageChromeIcon";
import {
  SIDEBAR_COLLAPSED_W,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  loadSidebarAppsIcons,
  loadSidebarCollapsed,
  loadSidebarWidthPx,
  prefSidebarToPx,
  saveSidebarAppsIcons,
  saveSidebarCollapsed,
  saveSidebarWidthPx,
} from "@/lib/sidebarLayout";

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
function ResearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3M11 8v6M8 11h6" />
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
function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}

function CommunityIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
      <path d="M5 19h14" strokeLinecap="round" />
      <path d="M8 16v3M16 16v3" strokeLinecap="round" />
    </svg>
  );
}

const NAV_ICONS: Record<string, () => ReactNode> = {
  library: LibraryIcon,
  journal: JournalIcon,
  capture: MicIcon,
  board: BoardIcon,
  db: DatabaseIcon,
  canvas: CanvasIcon,
  graph: GraphIcon,
  team: TeamIcon,
  research: ResearchIcon,
  community: CommunityIcon,
  settings: SettingsIcon,
};

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
  const router = useRouter();
  const { user, loading, displayName, username, photoURL } = useAuth();
  const community = useCommunityOptional();
  const prefsCtx = usePrefsOptional();
  const homeHref = prefsCtx?.prefs.homePage || "/";
  const isMobile = useIsMobile();
  const navApps = useMemo(() => {
    const extras: NavAppDef[] = (community?.enabledExtensions || []).map((ext) => ({
      id: `ext:${ext.id}`,
      href: `/ext/${ext.id}`,
      label: ext.manifest.nav?.label || ext.manifest.name,
      icon: ext.manifest.icon || "extension",
      source: "extension" as const,
    }));
    // Keep 社群 near the end but before nothing — insert extras before community
    const builtins = NAV_APPS.filter((a) => a.id !== "community");
    const communityApp = NAV_APPS.find((a) => a.id === "community");
    return [...builtins, ...extras, ...(communityApp ? [communityApp] : [])];
  }, [community?.enabledExtensions]);
  const isImmersive =
    pathname.startsWith("/notes/") ||
    pathname.startsWith("/canvas") ||
    pathname.startsWith("/graph") ||
    pathname.startsWith("/board") ||
    pathname.startsWith("/db/") ||
    pathname.startsWith("/web/");
  const isDoc = isImmersive;
  const [cmdOpen, setCmdOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [teamUnread, setTeamUnread] = useState(0);
  const [mentionUnread, setMentionUnread] = useState(0);
  const [notifications, setNotifications] = useState<TeamNotification[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifWrapRef = useRef<HTMLDivElement | null>(null);
  const prefSidebar = prefsCtx?.prefs.sidebarWidth || "default";
  const [sidebarW, setSidebarW] = useState(() =>
    loadSidebarWidthPx(prefSidebarToPx(prefSidebar))
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => loadSidebarCollapsed());
  const [appsIconsOnly, setAppsIconsOnly] = useState(() => loadSidebarAppsIcons());
  const sidebarDrag = useRef<{ startX: number; startW: number } | null>(null);
  const prefSidebarRef = useRef(prefSidebar);
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  useEffect(() => {
    if (prefSidebarRef.current === prefSidebar) return;
    prefSidebarRef.current = prefSidebar;
    const px = prefSidebarToPx(prefSidebar);
    setSidebarW(px);
    saveSidebarWidthPx(px);
  }, [prefSidebar]);

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((v) => {
      const next = !v;
      saveSidebarCollapsed(next);
      return next;
    });
  }, []);

  const toggleAppsIconsOnly = useCallback(() => {
    setAppsIconsOnly((v) => {
      const next = !v;
      saveSidebarAppsIcons(next);
      return next;
    });
  }, []);

  const clearSidebarResize = useCallback(() => {
    sidebarDrag.current = null;
    document.body.classList.remove("is-sidebar-resizing");
  }, []);

  const onSidebarResizeStart = useCallback(
    (e: REPointerEvent<HTMLDivElement>) => {
      if (sidebarCollapsed) return;
      e.preventDefault();
      const startX = e.clientX;
      const startW = sidebarW;
      sidebarDrag.current = { startX, startW };
      document.body.classList.add("is-sidebar-resizing");

      // Window-level listeners (not setPointerCapture): capture on a React node
      // can stick after re-renders and make the whole page look hoverable but
      // dead to clicks — matches "wait a few seconds, buttons stop working".
      const onMove = (ev: PointerEvent) => {
        if (!sidebarDrag.current) return;
        const dx = ev.clientX - startX;
        const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + dx));
        setSidebarW(next);
      };
      const onUp = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        const dx = ev.clientX - startX;
        const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + dx));
        sidebarDrag.current = null;
        setSidebarW(next);
        saveSidebarWidthPx(next);
        document.body.classList.remove("is-sidebar-resizing");
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [sidebarCollapsed, sidebarW]
  );

  // Never leave the page in a dead-click state after blur / tab switch
  useEffect(() => {
    const clear = () => clearSidebarResize();
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
      clearSidebarResize();
    };
  }, [clearSidebarResize]);

  useEffect(() => {
    if (!user) {
      setTeamUnread(0);
      return;
    }
    let cancelled = false;
    const teamUnsubs = new Map<string, () => void>();
    const channelMaps = new Map<string, Channel[]>();
    const readMaps = new Map<string, Record<string, Date>>();

    const recompute = () => {
      let n = 0;
      channelMaps.forEach((chs, teamId) => {
        const reads = readMaps.get(teamId) || {};
        chs.forEach((c) => {
          if (channelIsUnread(c, reads[c.id])) n += 1;
        });
      });
      if (!cancelled) setTeamUnread(n);
    };

    const rootUnsub = listenUserTeams(user.uid, (teams: TeamMembership[]) => {
      const keep = new Set(teams.slice(0, 8).map((t) => t.id));
      teamUnsubs.forEach((u, id) => {
        if (!keep.has(id)) {
          u();
          teamUnsubs.delete(id);
          channelMaps.delete(id);
          readMaps.delete(id);
        }
      });
      teams.slice(0, 8).forEach((t) => {
        if (teamUnsubs.has(t.id)) return;
        const u1 = listenChannels(t.id, (chs) => {
          channelMaps.set(t.id, chs);
          recompute();
        });
        const u2 = listenChannelReads(user.uid, t.id, (reads) => {
          readMaps.set(t.id, reads);
          recompute();
        });
        teamUnsubs.set(t.id, () => {
          u1();
          u2();
        });
      });
      recompute();
    });

    return () => {
      cancelled = true;
      rootUnsub();
      teamUnsubs.forEach((u) => u());
    };
  }, [user]);

  useEffect(() => {
    if (!user) {
      setMentionUnread(0);
      setNotifications([]);
      return;
    }
    return listenNotifications(user.uid, (items) => {
      setMentionUnread(items.filter((n) => n.type === "mention" && !n.read).length);
      setNotifications(items);
    });
  }, [user]);

  useEffect(() => {
    if (!notifOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (notifWrapRef.current && !notifWrapRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [notifOpen]);

  const closeNav = useCallback(() => setNavOpen(false), []);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  const goToNotification = (n: TeamNotification) => {
    if (!user) return;
    void markNotificationRead(user.uid, n.id);
    setNotifOpen(false);
    setNavOpen(false);
    const params = new URLSearchParams();
    if (n.channel_id) params.set("channel", n.channel_id);
    if (n.message_id) params.set("msg", n.message_id);
    const qs = params.toString();
    router.push(`/team/${n.team_id}${qs ? `?${qs}` : ""}`);
  };

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
      if (mod && e.key === "\\") {
        e.preventDefault();
        toggleSidebarCollapsed();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prefsCtx?.prefs.enableShortcuts, toggleSidebarCollapsed]);

  const palette = (
    <CommandPalette
      open={cmdOpen}
      onClose={() => setCmdOpen(false)}
      notes={notes}
      jobs={jobs}
      userId={user?.uid}
    />
  );

  const renderAppsNav = (opts: { collapsed?: boolean; iconsOnly?: boolean; onNavigate?: () => void }) => {
    const rail = Boolean(opts.collapsed);
    const iconsOnly = rail || Boolean(opts.iconsOnly);
    const onNavigate = opts.onNavigate;
    return (
      <div className={`sidebar-apps-block${iconsOnly ? " is-icons" : ""}${rail ? " is-rail" : ""}`}>
        {!rail && (
          <div className="sidebar-apps-head">
            <span>頁面</span>
            <button
              type="button"
              className="sidebar-apps-toggle"
              title={iconsOnly ? "展開頁面標籤" : "收合為圖示"}
              aria-label={iconsOnly ? "展開頁面標籤" : "收合為圖示"}
              aria-pressed={iconsOnly}
              onClick={toggleAppsIconsOnly}
            >
              {iconsOnly ? "▾" : "▴"}
            </button>
          </div>
        )}
      <nav
        className={`sidebar-apps${rail ? " is-collapsed" : ""}${!rail && iconsOnly ? " is-icons" : ""}`}
        aria-label="應用"
      >
        {navApps.map((item) => {
          const BuiltinIcon = NAV_ICONS[item.id] || LibraryIcon;
          const iconNode =
            item.source === "extension" && item.icon ? (
              <PageChromeIcon icon={item.icon} fallback="extension" className="sidebar-app-ms-icon" />
            ) : (
              <BuiltinIcon />
            );
          return item.href === "/team" ? (
            <div key={item.href} className="sidebar-team-item-wrap" ref={notifWrapRef}>
              <Link
                href={item.href}
                className={isActive(item.href) ? "is-on" : ""}
                title={item.label}
                onClick={onNavigate}
              >
                {iconNode}
                {!iconsOnly && <span>{item.label}</span>}
              </Link>
              {!iconsOnly && teamUnread + mentionUnread > 0 && (
                <span
                  role="button"
                  tabIndex={0}
                  className="sidebar-badge"
                  title="通知"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setNotifOpen((o) => !o);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setNotifOpen((o) => !o);
                    }
                  }}
                >
                  {teamUnread + mentionUnread > 9 ? "9+" : teamUnread + mentionUnread}
                </span>
              )}
              {notifOpen && (
                <div className="tm-notif-panel">
                  <div className="tm-notif-panel-head">
                    <strong>通知</strong>
                    {notifications.some((n) => !n.read) && (
                      <button
                        type="button"
                        className="doc-cmd"
                        onClick={() => user && void markAllNotificationsRead(user.uid, notifications)}
                      >
                        全部已讀
                      </button>
                    )}
                  </div>
                  <div className="tm-notif-panel-list">
                    {notifications.filter((n) => !n.read).length === 0 ? (
                      <p className="tm-sidebar-muted">沒有未讀通知。</p>
                    ) : (
                      notifications
                        .filter((n) => !n.read)
                        .map((n) => (
                          <button
                            key={n.id}
                            type="button"
                            className="tm-notif-item"
                            onClick={() => goToNotification(n)}
                          >
                            <strong>{n.from_name || "某人"}</strong>
                            <span>{n.text}</span>
                          </button>
                        ))
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Link
              key={item.href}
              href={item.href}
              className={isActive(item.href) ? "is-on" : ""}
              title={item.label}
              onClick={onNavigate}
            >
              {iconNode}
              {!iconsOnly && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>
      </div>
    );
  };

  const renderSidebarFooter = (opts: { collapsed?: boolean }) => {
    const collapsed = Boolean(opts.collapsed);
    return (
      <div className="sidebar-footer">
        {loading ? null : user ? (
          <div className={`sidebar-user${collapsed ? " is-collapsed" : ""}`}>
            {photoURL ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="sidebar-user-avatar"
                src={photoURL}
                alt=""
                referrerPolicy="no-referrer"
                title={displayName || "使用者"}
              />
            ) : (
              <span className="sidebar-user-avatar sidebar-user-avatar--fallback" title={displayName || "使用者"}>
                {(displayName || "?").slice(0, 1)}
              </span>
            )}
            {!collapsed && (
              <div className="sidebar-user-meta">
                <Link href="/settings#st-account" className="sidebar-user-name" title="編輯個人資料">
                  {displayName || "使用者"}
                </Link>
                {username ? (
                  <div className="sidebar-user-handle">@{username}</div>
                ) : null}
                <button type="button" className="sidebar-user-action" onClick={() => logout()}>
                  登出
                </button>
              </div>
            )}
            <ThemeToggle />
          </div>
        ) : (
          <div className="sidebar-user sidebar-user--guest">
            {!collapsed && (
              <button
                type="button"
                className="btn btn-sm"
                style={{ flex: 1 }}
                onClick={() => loginWithGoogle()}
              >
                登入
              </button>
            )}
            <ThemeToggle />
          </div>
        )}
      </div>
    );
  };

  if (isMobile) {
    return (
      <div className={`mobile-shell${navOpen ? " is-nav-open" : ""}`}>
        <header className="mobile-top">
          <div className="mobile-top-start">
            <button
              type="button"
              className="mobile-menu-btn"
              aria-label="開啟側邊欄"
              aria-expanded={navOpen}
              aria-controls="mobile-nav-drawer"
              onClick={() => setNavOpen(true)}
            >
              <MenuIcon />
            </button>
            <Link href={homeHref} className="mobile-top-logo" onClick={closeNav}>
              <AlbireusLogo height={24} />
            </Link>
          </div>
          <div className="mobile-top-actions">
            <NavHistoryControls variant="ghost" className="nav-history--mobile" />
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              title="Albireus AI"
              onClick={() => toggleGlobalAiRail()}
            >
              AI
            </button>
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

        <div
          className={`mobile-nav-backdrop${navOpen ? " is-visible" : ""}`}
          onClick={closeNav}
          aria-hidden={!navOpen}
        />
        <aside
          id="mobile-nav-drawer"
          className={`mobile-nav-drawer${navOpen ? " is-open" : ""}`}
          aria-hidden={!navOpen}
          aria-label="導覽側邊欄"
        >
          <button
            type="button"
            className="mobile-nav-sheet-handle"
            aria-label="關閉側邊欄"
            onClick={closeNav}
          />
          <div className="sidebar-brand">
            <Link href={homeHref} className="sidebar-brand-logo" onClick={closeNav}>
              <AlbireusLogo height={24} />
            </Link>
            <div className="sidebar-brand-links">
              <button
                type="button"
                className="sidebar-icon-btn"
                title="Albireus AI"
                onClick={() => {
                  toggleGlobalAiRail();
                  closeNav();
                }}
              >
                AI
              </button>
              <Link
                href="/"
                className={`sidebar-icon-btn${isActive("/") ? " is-on" : ""}`}
                title="總覽"
                onClick={closeNav}
              >
                <HomeIcon />
              </Link>
              <Link
                href="/settings"
                className={`sidebar-icon-btn${isActive("/settings") ? " is-on" : ""}`}
                title="設定"
                onClick={closeNav}
              >
                <SettingsIcon />
              </Link>
              <button
                type="button"
                className="sidebar-icon-btn"
                title="關閉側邊欄"
                aria-label="關閉側邊欄"
                onClick={closeNav}
              >
                <CloseIcon />
              </button>
            </div>
          </div>
          <div className="sidebar-search-row">
            <button
              type="button"
              className="sidebar-search"
              onClick={() => {
                setCmdOpen(true);
                closeNav();
              }}
              title="搜尋"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" />
              </svg>
              <span>搜尋筆記、指令…</span>
            </button>
            <div className="sidebar-nav-history">
              <NavHistoryControls />
            </div>
          </div>

          {renderAppsNav({ iconsOnly: appsIconsOnly, onNavigate: closeNav })}

          <div className="sidebar-tree-wrap" onClick={(e) => {
            const t = e.target as HTMLElement;
            if (t.closest("a")) closeNav();
          }}>
            <SidebarNotesTree />
          </div>

          {renderSidebarFooter({})}
        </aside>

        <main className={`app-main${isDoc ? " app-main--doc" : ""}${isImmersive ? " app-main--immersive" : ""}`}>{children}</main>
        {!isImmersive && (
        <nav className="mobile-bottom">
          {MOBILE_BOTTOM.map((item) => {
            const Icon = NAV_ICONS[item.id] || LibraryIcon;
            if (item.fab) {
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className={isActive(item.href) ? "active" : ""}
                >
                  <span className="capture-fab">
                    <Icon />
                  </span>
                </Link>
              );
            }
            return (
              <Link
                key={item.id}
                href={item.href}
                className={isActive(item.href) ? "active" : ""}
              >
                <Icon />
                {item.label}
              </Link>
            );
          })}
        </nav>
        )}
        {palette}
        <GlobalAiDock />
      </div>
    );
  }

  return (
    <div className={`app-shell${sidebarCollapsed ? " is-sidebar-collapsed" : ""}`}>
      <aside
        className={`desktop-sidebar desktop-sidebar--tree${sidebarCollapsed ? " is-collapsed" : ""}`}
        style={{ width: sidebarCollapsed ? SIDEBAR_COLLAPSED_W : sidebarW }}
      >
        <div className="sidebar-brand">
          {!sidebarCollapsed ? (
            <Link href={homeHref} className="sidebar-brand-logo">
              <AlbireusLogo height={24} />
            </Link>
          ) : (
            <button
              type="button"
              className="sidebar-collapse-btn sidebar-collapse-btn--brand"
              title="展開側欄 ⌘\\"
              onClick={toggleSidebarCollapsed}
            >
              <AlbireusLogo height={22} showWord={false} />
            </button>
          )}
          {!sidebarCollapsed && (
            <div className="sidebar-brand-links">
              <button
                type="button"
                className="sidebar-icon-btn"
                title="Albireus AI ⌘⇧A"
                onClick={() => toggleGlobalAiRail()}
              >
                AI
              </button>
              <Link
                href="/"
                className={`sidebar-icon-btn${isActive("/") ? " is-on" : ""}`}
                title="總覽"
              >
                <HomeIcon />
              </Link>
              <Link
                href="/settings"
                className={`sidebar-icon-btn${isActive("/settings") ? " is-on" : ""}`}
                title="設定"
              >
                <SettingsIcon />
              </Link>
              <button
                type="button"
                className="sidebar-icon-btn"
                title="收合側欄 ⌘\\"
                aria-label="收合側欄"
                aria-pressed={false}
                onClick={toggleSidebarCollapsed}
              >
                «
              </button>
            </div>
          )}
        </div>

        {sidebarCollapsed ? (
          <>
            <NavHistoryControls className="nav-history--rail" />
            <button
              type="button"
              className="sidebar-icon-btn sidebar-search-collapsed"
              title="搜尋 ⌘K"
              onClick={() => setCmdOpen(true)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" />
              </svg>
            </button>
          </>
        ) : (
          <div className="sidebar-search-row">
            <button
              type="button"
              className="sidebar-search"
              onClick={() => setCmdOpen(true)}
              title="搜尋 ⌘K"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" />
              </svg>
              <span>搜尋筆記、指令…</span>
              <kbd>⌘K</kbd>
            </button>
            <div className="sidebar-nav-history">
              <NavHistoryControls />
            </div>
          </div>
        )}

        {renderAppsNav({ collapsed: sidebarCollapsed, iconsOnly: appsIconsOnly })}

        {!sidebarCollapsed && (
          <div className="sidebar-tree-wrap">
            <SidebarNotesTree />
          </div>
        )}

        {renderSidebarFooter({ collapsed: sidebarCollapsed })}

        {!sidebarCollapsed && (
          <div
            className="sidebar-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="調整側欄寬度"
            title="拖曳調整寬度"
            onPointerDown={onSidebarResizeStart}
            onDoubleClick={() => {
              const mid = Math.round((SIDEBAR_MIN + SIDEBAR_MAX) / 2);
              setSidebarW(mid);
              saveSidebarWidthPx(mid);
            }}
          />
        )}
      </aside>
      <main className={`app-main${isDoc ? " app-main--doc" : ""}`}>{children}</main>
      {palette}
      <GlobalAiDock />
    </div>
  );
}
