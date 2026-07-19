"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { askPrompt } from "@/lib/dialogs";
import {
  getTeam,
  getMember,
  listenChannels,
  createChannel,
  listenMessages,
  sendMessage,
  createInvite,
  type Team,
  type Member,
  type Channel,
  type Message,
  type TeamRole,
} from "@/lib/teamStore";

const INVITE_ROLES: { id: TeamRole; label: string }[] = [
  { id: "member", label: "成員" },
  { id: "admin", label: "管理員" },
  { id: "guest", label: "訪客" },
];

export default function TeamRoomPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useAuth();

  const [team, setTeam] = useState<Team | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [checked, setChecked] = useState(false);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannel, setActiveChannel] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteRole, setInviteRole] = useState<TeamRole>("member");
  const [inviteLink, setInviteLink] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!id || !user) return;
    let cancelled = false;
    void (async () => {
      try {
        const [t, m] = await Promise.all([getTeam(id), getMember(id, user.uid)]);
        if (cancelled) return;
        setTeam(t);
        setMember(m);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "無法載入團隊");
      } finally {
        if (!cancelled) setChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, user]);

  useEffect(() => {
    if (!id || !member) return;
    return listenChannels(id, (list) => {
      setChannels(list);
      setActiveChannel((cur) => cur || list[0]?.id || null);
    });
  }, [id, member]);

  useEffect(() => {
    if (!id || !activeChannel) return;
    return listenMessages(id, activeChannel, setMessages, 80);
  }, [id, activeChannel]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const activeChannelObj = useMemo(
    () => channels.find((c) => c.id === activeChannel) || null,
    [channels, activeChannel]
  );

  const send = async () => {
    if (!user || !id || !activeChannel || !draft.trim() || sending) return;
    setSending(true);
    try {
      await sendMessage(id, activeChannel, {
        author_id: user.uid,
        author_name: user.displayName || "",
        text: draft.trim(),
      });
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "發送失敗");
    } finally {
      setSending(false);
    }
  };

  const addChannel = async () => {
    if (!user || !id) return;
    const name = await askPrompt("新增頻道", "channel-name");
    if (name == null) return;
    try {
      const cid = await createChannel(id, user.uid, name);
      setActiveChannel(cid);
    } catch (e) {
      setError(e instanceof Error ? e.message : "建立頻道失敗");
    }
  };

  const genInvite = async () => {
    if (!user || !id) return;
    setInviteBusy(true);
    try {
      const token = await createInvite(id, user.uid, inviteRole);
      const url = `${window.location.origin}/team/join?token=${token}`;
      setInviteLink(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "建立邀請連結失敗");
    } finally {
      setInviteBusy(false);
    }
  };

  const copyInvite = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  if (loading || !checked) return <p style={{ color: "var(--text-muted)", padding: "2rem" }}>載入中…</p>;
  if (!user) return <p style={{ padding: "2rem" }}>請先登入。</p>;
  if (!team) return <p style={{ padding: "2rem" }}>找不到此團隊。</p>;
  if (!member) {
    return (
      <div className="tm-page">
        <p>你不是「{team.name}」的成員。請向團隊管理員索取邀請連結。</p>
        <Link href="/team" className="btn btn-ghost">回團隊列表</Link>
      </div>
    );
  }

  const canInvite = member.role === "owner" || member.role === "admin";

  return (
    <div className="tm-room">
      <aside className="tm-sidebar">
        <div className="tm-sidebar-head">
          <Link href="/team" className="tm-back">←</Link>
          <span className="tm-team-name">{team.name}</span>
        </div>
        <div className="tm-channel-list">
          <p className="tm-channel-label">頻道</p>
          {channels.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`tm-channel-item${c.id === activeChannel ? " is-on" : ""}`}
              onClick={() => setActiveChannel(c.id)}
            >
              # {c.name}
            </button>
          ))}
          <button type="button" className="tm-channel-add" onClick={() => void addChannel()}>
            ＋ 新增頻道
          </button>
        </div>
        {canInvite && (
          <div className="tm-sidebar-foot">
            <button
              type="button"
              className="btn btn-sm btn-soft"
              onClick={() => {
                setInviteOpen((v) => !v);
                setInviteLink("");
              }}
            >
              邀請成員
            </button>
          </div>
        )}
      </aside>

      <div className="tm-main">
        <div className="tm-main-head">
          <span className="tm-channel-title">
            {activeChannelObj ? `# ${activeChannelObj.name}` : "選擇頻道"}
          </span>
          {activeChannelObj?.topic && <span className="tm-channel-topic">{activeChannelObj.topic}</span>}
        </div>

        {error && <p className="note-aside-error" style={{ padding: "0 1rem" }}>{error}</p>}

        <div className="tm-messages" ref={scrollRef}>
          {messages.length === 0 ? (
            <p className="note-aside-empty" style={{ padding: "1rem" }}>還沒有訊息，開始聊聊吧。</p>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`tm-msg${m.author_id === user.uid ? " is-mine" : ""}`}>
                <span className="tm-msg-author">{m.author_name || "匿名"}</span>
                <span className="tm-msg-text">{m.text}</span>
                <span className="tm-msg-time">
                  {m.created_at.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="tm-composer">
          <input
            className="input"
            placeholder={activeChannelObj ? `在 #${activeChannelObj.name} 傳訊息…` : "選擇頻道以開始聊天"}
            value={draft}
            disabled={!activeChannel}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button type="button" className="btn btn-sm" disabled={!draft.trim() || sending} onClick={() => void send()}>
            送出
          </button>
        </div>
      </div>

      {inviteOpen && (
        <div
          className="cadence-dialog-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setInviteOpen(false);
          }}
        >
          <div className="cadence-dialog tm-invite-dialog" role="dialog" aria-modal="true">
            <h2 className="cadence-dialog-title">邀請成員</h2>
            <p className="cadence-dialog-msg">產生邀請連結，分享給要加入「{team.name}」的夥伴。連結 7 天後失效。</p>

            <div className="tm-invite-roles" role="radiogroup" aria-label="邀請身分">
              {INVITE_ROLES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`share-mode-item${inviteRole === r.id ? " is-on" : ""}`}
                  onClick={() => setInviteRole(r.id)}
                >
                  <strong>{r.label}</strong>
                </button>
              ))}
            </div>

            {inviteLink ? (
              <div className="share-link-row">
                <input className="input" readOnly value={inviteLink} onFocus={(e) => e.target.select()} />
                <button type="button" className="btn btn-sm" onClick={() => void copyInvite()}>
                  {copied ? "已複製" : "複製連結"}
                </button>
              </div>
            ) : (
              <button type="button" className="btn" disabled={inviteBusy} onClick={() => void genInvite()}>
                {inviteBusy ? "產生中…" : "產生邀請連結"}
              </button>
            )}

            <div className="cadence-dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setInviteOpen(false)}>關閉</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
