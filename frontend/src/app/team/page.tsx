"use client";

import { useEffect, useState } from "react";
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

export default function TeamListPage() {
  const { user, loading } = useAuth();
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

  const create = async () => {
    if (!user || busy) return;
    const name = await askPrompt("新增團隊", "我的團隊");
    if (name == null) return;
    setBusy(true);
    setError("");
    try {
      const id = await createTeam(user.uid, name, user.displayName || undefined);
      router.push(`/team/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "建立團隊失敗");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p style={{ color: "var(--text-muted)", padding: "2rem" }}>載入中…</p>;
  if (!user) {
    return (
      <div className="tm-page tm-guest">
        <h1 className="page-title font-display">團隊</h1>
        <p className="page-sub">登入後建立或加入團隊空間。</p>
        <button type="button" className="btn" onClick={() => loginWithGoogle()}>登入</button>
      </div>
    );
  }

  return (
    <div className="tm-page">
      <div className="tm-page-head">
        <div>
          <h1 className="page-title font-display">團隊</h1>
          <p className="page-sub">與夥伴共用頻道、訊息與筆記討論。</p>
        </div>
        <button type="button" className="btn" disabled={busy} onClick={() => void create()}>
          {busy ? "建立中…" : "＋ 新增團隊"}
        </button>
      </div>

      {error && <p className="note-aside-error">{error}</p>}

      {teams.length === 0 ? (
        <div className="tm-empty">
          <p>還沒有任何團隊。建立一個團隊，開始邀請夥伴一起協作。</p>
          <button type="button" className="btn" disabled={busy} onClick={() => void create()}>
            建立第一個團隊
          </button>
        </div>
      ) : (
        <div className="tm-team-grid">
          {teams.map((t) => (
            <button
              key={t.id}
              type="button"
              className="tm-team-card"
              onClick={() => router.push(`/team/${t.id}`)}
            >
              <span className="tm-team-card-name">{t.name}</span>
              <span className="tm-team-card-role">{ROLE_LABEL[t.role] || t.role}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
