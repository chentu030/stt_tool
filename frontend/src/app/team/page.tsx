"use client";

import PageLoading from "@/components/motion/PageLoading";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { loginWithGoogle } from "@/lib/firebase";
import { askPrompt } from "@/lib/dialogs";
import { createTeam, listenUserTeams, type TeamMembership } from "@/lib/teamStore";

const ROLE_LABEL: Record<string, string> = {
  owner: "擁有者",
  admin: "管理員",
  member: "成員",
  guest: "訪客",
};

function teamInitial(name: string): string {
  const t = name.trim();
  if (!t) return "團";
  return Array.from(t)[0]!.toUpperCase();
}

function formatJoined(d: Date): string {
  try {
    return d.toLocaleDateString("zh-TW", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

/** Accept full /team/join?token=… URL or a raw token. */
function parseInviteInput(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    const token = u.searchParams.get("token");
    if (token) return token.trim();
  } catch {
    /* not a URL */
  }
  const m = s.match(/[?&]token=([^&\s#]+)/i);
  if (m?.[1]) return decodeURIComponent(m[1]).trim();
  if (/^[A-Za-z0-9_-]{8,}$/.test(s)) return s;
  return null;
}

function TeamMark() {
  return (
    <div className="tm-mark" aria-hidden>
      <span className="tm-mark-a" />
      <span className="tm-mark-b" />
      <span className="tm-mark-c" />
    </div>
  );
}

export default function TeamListPage() {
  const { user, loading, displayName } = useAuth();
  const router = useRouter();
  const [teams, setTeams] = useState<TeamMembership[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) {
      setTeams([]);
      return;
    }
    return listenUserTeams(user.uid, setTeams);
  }, [user]);

  const unreadTotal = useMemo(
    () => teams.reduce((n, t) => n + (t.unread || 0), 0),
    [teams]
  );

  const create = async () => {
    if (!user || busy) return;
    const name = await askPrompt("新增團隊", "我的團隊");
    if (name == null) return;
    setBusy(true);
    setError("");
    try {
      const id = await createTeam(user.uid, name, displayName || undefined);
      router.push(`/team/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "建立團隊失敗");
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    setError("");
    const raw = await askPrompt({
      title: "加入團隊",
      defaultValue: "",
      message: "貼上邀請連結，或直接輸入 token。",
    });
    if (raw == null) return;
    const token = parseInviteInput(raw);
    if (!token) {
      setError("無法辨識邀請連結，請確認後再試。");
      return;
    }
    router.push(`/team/join?token=${encodeURIComponent(token)}`);
  };

  if (loading) return <PageLoading />;

  if (!user) {
    return (
      <div className="tm-page tm-guest">
        <div className="tm-page-glow" aria-hidden />
        <TeamMark />
        <h1 className="page-title font-display">團隊</h1>
        <p className="page-sub">登入後建立或加入團隊空間，與夥伴共用頻道、訊息與筆記。</p>
        <button type="button" className="btn" onClick={() => loginWithGoogle()}>
          登入
        </button>
      </div>
    );
  }

  return (
    <div className="tm-page">
      <div className="tm-page-glow" aria-hidden />

      <div className="tm-page-head">
        <div className="tm-page-head-text">
          <h1 className="page-title font-display">團隊</h1>
          <p className="page-sub">與夥伴共用頻道、訊息與筆記討論。</p>
        </div>
        <div className="tm-page-actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void join()}>
            加入團隊
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void create()}>
            {busy ? "建立中…" : "＋ 新增團隊"}
          </button>
        </div>
      </div>

      {error && <p className="note-aside-error">{error}</p>}

      {teams.length > 0 && (
        <div className="tm-stat">
          <span>
            我的團隊 · {teams.length} 個
          </span>
          {unreadTotal > 0 ? (
            <span className="tm-stat-unread">{unreadTotal} 則未讀</span>
          ) : (
            <span className="tm-stat-muted">全部已讀</span>
          )}
        </div>
      )}

      {teams.length === 0 ? (
        <div className="tm-empty">
          <TeamMark />
          <h2 className="tm-empty-title">還沒有任何團隊</h2>
          <p>建立一個空間，邀請夥伴一起討論；或貼上邀請連結直接加入。</p>
          <div className="tm-empty-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => void create()}>
              建立第一個團隊
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void join()}>
              貼上邀請連結
            </button>
          </div>
        </div>
      ) : (
        <div className="tm-team-grid">
          {teams.map((t) => {
            const unread = t.unread || 0;
            return (
              <button
                key={t.id}
                type="button"
                className="tm-team-card"
                onClick={() => router.push(`/team/${t.id}`)}
              >
                <span className="tm-team-card-top">
                  <span className="tm-team-avatar" data-role={t.role}>
                    {teamInitial(t.name)}
                  </span>
                  {unread > 0 ? (
                    <span className="tm-unread-badge" aria-label={`${unread} 則未讀`}>
                      {unread > 99 ? "99+" : unread}
                    </span>
                  ) : null}
                </span>
                <span className="tm-team-card-body">
                  <span className="tm-team-card-name">{t.name}</span>
                  <span className="tm-team-card-meta">
                    <span className={`tm-role-chip is-${t.role}`}>
                      {ROLE_LABEL[t.role] || t.role}
                    </span>
                    {t.joined_at ? (
                      <span className="tm-team-card-joined">加入於 {formatJoined(t.joined_at)}</span>
                    ) : null}
                  </span>
                </span>
                <span className="tm-team-card-chevron" aria-hidden>
                  →
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
