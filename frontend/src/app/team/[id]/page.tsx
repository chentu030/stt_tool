"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { askPrompt, askConfirm } from "@/lib/dialogs";
import {
  getTeam,
  getMember,
  listenChannels,
  listenMembers,
  listenMessages,
  listenPins,
  listenChannelReads,
  createChannel,
  sendMessage,
  createInvite,
  listTeamInvites,
  revokeInvite,
  leaveTeam,
  setMemberRole,
  markChannelRead,
  channelIsUnread,
  toggleMessageReaction,
  pinNote,
  unpinNote,
  REACTION_EMOJIS,
  type Team,
  type Member,
  type Channel,
  type Message,
  type TeamRole,
  type Invite,
  type TeamPin,
} from "@/lib/teamStore";

const INVITE_ROLES: { id: TeamRole; label: string }[] = [
  { id: "member", label: "成員" },
  { id: "admin", label: "管理員" },
  { id: "guest", label: "訪客" },
];

const ROLE_LABEL: Record<TeamRole, string> = {
  owner: "擁有者",
  admin: "管理員",
  member: "成員",
  guest: "訪客",
};

export default function TeamRoomPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading } = useAuth();

  const [team, setTeam] = useState<Team | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [checked, setChecked] = useState(false);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannel, setActiveChannel] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pins, setPins] = useState<TeamPin[]>([]);
  const [reads, setReads] = useState<Record<string, Date>>({});
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteRole, setInviteRole] = useState<TeamRole>("member");
  const [inviteLink, setInviteLink] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [copied, setCopied] = useState(false);
  const [threadRoot, setThreadRoot] = useState<Message | null>(null);
  const [threadDraft, setThreadDraft] = useState("");
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
    if (!id || !member) return;
    return listenMembers(id, setMembers);
  }, [id, member]);

  useEffect(() => {
    if (!id || !member) return;
    return listenPins(id, setPins);
  }, [id, member]);

  useEffect(() => {
    if (!id || !user || !member) return;
    return listenChannelReads(user.uid, id, setReads);
  }, [id, user, member]);

  useEffect(() => {
    if (!id || !activeChannel) return;
    return listenMessages(id, activeChannel, setMessages, 120);
  }, [id, activeChannel]);

  useEffect(() => {
    if (!user || !id || !activeChannel) return;
    void markChannelRead(user.uid, id, activeChannel);
  }, [user, id, activeChannel, messages.length]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, activeChannel]);

  const activeChannelObj = useMemo(
    () => channels.find((c) => c.id === activeChannel) || null,
    [channels, activeChannel]
  );

  const topMessages = useMemo(
    () => messages.filter((m) => !m.thread_id),
    [messages]
  );

  const threadReplies = useMemo(() => {
    if (!threadRoot) return [];
    return messages.filter((m) => m.thread_id === threadRoot.id);
  }, [messages, threadRoot]);

  const replyCounts = useMemo(() => {
    const map: Record<string, number> = {};
    messages.forEach((m) => {
      if (m.thread_id) map[m.thread_id] = (map[m.thread_id] || 0) + 1;
    });
    return map;
  }, [messages]);

  const send = async (threadId?: string) => {
    const text = threadId ? threadDraft : draft;
    if (!user || !id || !activeChannel || !text.trim() || sending) return;
    setSending(true);
    try {
      await sendMessage(id, activeChannel, {
        author_id: user.uid,
        author_name: user.displayName || "",
        text: text.trim(),
        thread_id: threadId,
      });
      if (threadId) setThreadDraft("");
      else setDraft("");
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

  const refreshInvites = async () => {
    if (!id) return;
    try {
      setInvites(await listTeamInvites(id));
    } catch {
      /* ignore */
    }
  };

  const genInvite = async () => {
    if (!user || !id) return;
    setInviteBusy(true);
    try {
      const token = await createInvite(id, user.uid, inviteRole);
      const url = `${window.location.origin}/team/join?token=${token}`;
      setInviteLink(url);
      await refreshInvites();
    } catch (e) {
      setError(e instanceof Error ? e.message : "建立邀請連結失敗");
    } finally {
      setInviteBusy(false);
    }
  };

  const copyInvite = async (url?: string) => {
    const link = url || inviteLink;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  const doLeave = async () => {
    if (!user || !id) return;
    if (member?.role === "owner") {
      setError("擁有者無法直接離開，請先轉移擁有權或刪除團隊。");
      return;
    }
    const ok = await askConfirm({ title: "離開團隊", message: `確定離開「${team?.name}」？` });
    if (!ok) return;
    await leaveTeam(id, user.uid);
    router.push("/team");
  };

  const changeRole = async (uid: string, role: TeamRole) => {
    if (!id || !canAdmin) return;
    try {
      await setMemberRole(id, uid, role);
    } catch (e) {
      setError(e instanceof Error ? e.message : "變更角色失敗");
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
  const canAdmin = canInvite;

  return (
    <div className="tm-room">
      <aside className="tm-sidebar">
        <div className="tm-sidebar-head">
          <Link href="/team" className="tm-back">←</Link>
          <span className="tm-team-name">{team.name}</span>
        </div>

        <div className="tm-channel-list">
          <p className="tm-channel-label">頻道</p>
          {channels.map((c) => {
            const unread = channelIsUnread(c, reads[c.id]);
            return (
              <button
                key={c.id}
                type="button"
                className={`tm-channel-item${c.id === activeChannel ? " is-on" : ""}${unread && c.id !== activeChannel ? " is-unread" : ""}`}
                onClick={() => setActiveChannel(c.id)}
              >
                <span># {c.name}</span>
                {unread && c.id !== activeChannel && <span className="tm-unread-dot" aria-hidden />}
              </button>
            );
          })}
          <button type="button" className="tm-channel-add" onClick={() => void addChannel()}>
            ＋ 新增頻道
          </button>
        </div>

        <div className="tm-channel-list">
          <p className="tm-channel-label">知識</p>
          {pins.length === 0 ? (
            <p className="tm-sidebar-muted">從訊息釘選筆記，或從筆記「分享到團隊」</p>
          ) : (
            pins.map((p) => (
              <div key={p.id} className="tm-pin-row">
                <Link href={`/notes/${p.note_id}`} className="tm-pin-link">
                  📎 {p.title}
                </Link>
                {canAdmin && (
                  <button
                    type="button"
                    className="tm-pin-x"
                    title="取消釘選"
                    onClick={() => void unpinNote(id, p.note_id)}
                  >
                    ×
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        <div className="tm-members-block">
          <p className="tm-channel-label">成員 · {members.length}</p>
          <ul className="tm-member-list">
            {members.map((m) => (
              <li key={m.uid} className="tm-member-item">
                <span className="tm-member-avatar">{(m.display_name || "?").slice(0, 1)}</span>
                <span className="tm-member-name">
                  {m.display_name || m.uid.slice(0, 6)}
                  {m.uid === user.uid ? "（你）" : ""}
                </span>
                {canAdmin && m.role !== "owner" && m.uid !== user.uid ? (
                  <select
                    className="tm-role-select"
                    value={m.role}
                    onChange={(e) => void changeRole(m.uid, e.target.value as TeamRole)}
                  >
                    <option value="admin">管理員</option>
                    <option value="member">成員</option>
                    <option value="guest">訪客</option>
                  </select>
                ) : (
                  <span className="tm-member-role">{ROLE_LABEL[m.role]}</span>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="tm-sidebar-foot">
          {canInvite && (
            <button
              type="button"
              className="btn btn-sm btn-soft"
              onClick={() => {
                setInviteOpen(true);
                setInviteLink("");
                void refreshInvites();
              }}
            >
              邀請成員
            </button>
          )}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void doLeave()}>
            離開團隊
          </button>
        </div>
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
          {topMessages.length === 0 ? (
            <p className="note-aside-empty" style={{ padding: "1rem" }}>還沒有訊息，開始聊聊吧。</p>
          ) : (
            topMessages.map((m) => (
              <MessageRow
                key={m.id}
                m={m}
                mine={m.author_id === user.uid}
                replyCount={replyCounts[m.id] || 0}
                onReply={() => setThreadRoot(m)}
                onReact={(emoji) =>
                  void toggleMessageReaction(id, activeChannel!, m.id, user.uid, emoji)
                }
                onPin={
                  m.note_id
                    ? () => void pinNote(id, m.note_id!, m.note_title || "筆記", user.uid)
                    : undefined
                }
              />
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

      {threadRoot && (
        <aside className="tm-thread-panel">
          <div className="tm-thread-head">
            <strong>討論串</strong>
            <button type="button" className="doc-cmd" onClick={() => setThreadRoot(null)}>關閉</button>
          </div>
          <div className="tm-thread-root">
            <span className="tm-msg-author">{threadRoot.author_name || "匿名"}</span>
            <p>{threadRoot.text}</p>
          </div>
          <div className="tm-thread-replies">
            {threadReplies.map((r) => (
              <div key={r.id} className="tm-msg">
                <span className="tm-msg-author">{r.author_name || "匿名"}</span>
                <span className="tm-msg-text">{r.text}</span>
              </div>
            ))}
          </div>
          <div className="tm-composer">
            <input
              className="input"
              placeholder="回覆討論串…"
              value={threadDraft}
              onChange={(e) => setThreadDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void send(threadRoot.id);
                }
              }}
            />
            <button
              type="button"
              className="btn btn-sm"
              disabled={!threadDraft.trim() || sending}
              onClick={() => void send(threadRoot.id)}
            >
              回覆
            </button>
          </div>
        </aside>
      )}

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
            <p className="cadence-dialog-msg">
              邀請連結可重複使用，直到過期或撤銷。分享到群組即可讓多人加入。
            </p>

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

            {invites.filter((i) => i.status === "pending" && i.expires_at.getTime() > Date.now()).length > 0 && (
              <div className="tm-invite-list">
                <p className="tm-channel-label">有效邀請</p>
                {invites
                  .filter((i) => i.status === "pending" && i.expires_at.getTime() > Date.now())
                  .map((i) => {
                    const url = `${typeof window !== "undefined" ? window.location.origin : ""}/team/join?token=${i.token}`;
                    return (
                      <div key={i.token} className="tm-invite-row">
                        <span>
                          {ROLE_LABEL[i.role]} · 已用 {i.use_count || 0} 次 · 至{" "}
                          {i.expires_at.toLocaleDateString("zh-TW")}
                        </span>
                        <button type="button" className="doc-cmd" onClick={() => void copyInvite(url)}>
                          複製
                        </button>
                        <button
                          type="button"
                          className="doc-cmd"
                          onClick={() => void revokeInvite(i.token).then(refreshInvites)}
                        >
                          撤銷
                        </button>
                      </div>
                    );
                  })}
              </div>
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

function MessageRow({
  m,
  mine,
  replyCount,
  onReply,
  onReact,
  onPin,
}: {
  m: Message;
  mine: boolean;
  replyCount: number;
  onReply: () => void;
  onReact: (emoji: string) => void;
  onPin?: () => void;
}) {
  const reactionGroups = useMemo(() => {
    const map: Record<string, number> = {};
    Object.values(m.reactions || {}).forEach((e) => {
      map[e] = (map[e] || 0) + 1;
    });
    return Object.entries(map);
  }, [m.reactions]);

  return (
    <div className={`tm-msg${mine ? " is-mine" : ""}`}>
      <div className="tm-msg-meta">
        <span className="tm-msg-author">{m.author_name || "匿名"}</span>
        <span className="tm-msg-time">
          {m.created_at.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
      {m.kind === "note_share" && m.note_id ? (
        <Link href={`/notes/${m.note_id}`} className="tm-note-card">
          <strong>📎 {m.note_title || "筆記"}</strong>
          <span>{m.text}</span>
        </Link>
      ) : (
        <span className="tm-msg-text">{m.text}</span>
      )}
      {reactionGroups.length > 0 && (
        <div className="tm-msg-reactions">
          {reactionGroups.map(([emoji, n]) => (
            <button key={emoji} type="button" className="tm-react-chip" onClick={() => onReact(emoji)}>
              {emoji} {n}
            </button>
          ))}
        </div>
      )}
      <div className="tm-msg-actions">
        {REACTION_EMOJIS.map((e) => (
          <button key={e} type="button" className="tm-react-btn" onClick={() => onReact(e)} title="表情">
            {e}
          </button>
        ))}
        <button type="button" className="doc-cmd" onClick={onReply}>
          回覆{replyCount ? ` (${replyCount})` : ""}
        </button>
        {onPin && (
          <button type="button" className="doc-cmd" onClick={onPin}>
            釘選
          </button>
        )}
      </div>
    </div>
  );
}
