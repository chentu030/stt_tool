"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { askPrompt, askConfirm } from "@/lib/dialogs";
import { createNote } from "@/lib/firebase";
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
  listenTyping,
  setTyping,
  clearTyping,
  listenActivity,
  REACTION_EMOJIS,
  type Team,
  type Member,
  type Channel,
  type Message,
  type TeamRole,
  type Invite,
  type TeamPin,
  type TeamActivity,
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

/** Splits text on @mentions and wraps each token in a highlighted <strong>. */
function renderMentions(text: string): ReactNode {
  const parts = text.split(/(@[^\s@]+)/g);
  return parts.map((part, idx) =>
    part.startsWith("@") && part.length > 1 ? (
      <strong key={idx} className="tm-mention">
        {part}
      </strong>
    ) : (
      <span key={idx}>{part}</span>
    )
  );
}

function memberLabel(m: Member): string {
  return m.display_name || m.uid.slice(0, 6);
}

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
  const composerRef = useRef<HTMLInputElement | null>(null);

  const [typingPeople, setTypingPeople] = useState<{ uid: string; name: string }[]>([]);
  const typingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [searchQuery, setSearchQuery] = useState("");

  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiSummary, setAiSummary] = useState("");
  const [aiSaving, setAiSaving] = useState(false);
  const [aiSavedNoteId, setAiSavedNoteId] = useState<string | null>(null);

  const [noteFlash, setNoteFlash] = useState<Record<string, string>>({});
  const [convertingId, setConvertingId] = useState<string | null>(null);

  const [activity, setActivity] = useState<TeamActivity[]>([]);
  const [activityOpen, setActivityOpen] = useState(false);

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
    if (!id || !member || !user) return;
    return listenChannels(
      id,
      (list) => {
        setChannels(list);
        setActiveChannel((cur) => cur || list[0]?.id || null);
      },
      user.uid
    );
  }, [id, member, user]);

  useEffect(() => {
    if (!id || !member) return;
    return listenMembers(id, setMembers);
  }, [id, member]);

  useEffect(() => {
    if (!id || !member) return;
    return listenPins(id, setPins);
  }, [id, member]);

  useEffect(() => {
    if (!id || !member) return;
    return listenActivity(id, setActivity);
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

  useEffect(() => {
    if (!id || !activeChannel) {
      setTypingPeople([]);
      return;
    }
    return listenTyping(id, activeChannel, (people) => {
      setTypingPeople(people.filter((p) => p.uid !== user?.uid));
    });
  }, [id, activeChannel, user?.uid]);

  // Clear the typing flag whenever the channel changes or the page unmounts.
  useEffect(() => {
    return () => {
      if (user && id && activeChannel) void clearTyping(id, activeChannel, user.uid);
    };
  }, [id, activeChannel, user]);

  const activeChannelObj = useMemo(
    () => channels.find((c) => c.id === activeChannel) || null,
    [channels, activeChannel]
  );

  const topMessages = useMemo(
    () => messages.filter((m) => !m.thread_id),
    [messages]
  );

  const filteredMessages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return topMessages;
    return topMessages.filter(
      (m) =>
        m.text.toLowerCase().includes(q) ||
        (m.note_title || "").toLowerCase().includes(q)
    );
  }, [topMessages, searchQuery]);

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

  const mentionMatch = useMemo(() => draft.match(/@([^\s@]*)$/), [draft]);
  const mentionOpen = !!mentionMatch && !!activeChannel;
  const mentionMembers = useMemo(() => {
    if (!mentionOpen || !mentionMatch) return [];
    const q = mentionMatch[1].toLowerCase();
    return members.filter((m) => memberLabel(m).toLowerCase().includes(q)).slice(0, 6);
  }, [mentionOpen, mentionMatch, members]);

  const insertMention = (m: Member) => {
    setDraft((d) => {
      const match = d.match(/@([^\s@]*)$/);
      const name = memberLabel(m);
      if (!match) return `${d}@${name} `;
      const start = d.length - match[0].length;
      return `${d.slice(0, start)}@${name} `;
    });
    composerRef.current?.focus();
  };

  const handleDraftChange = (value: string) => {
    setDraft(value);
    if (!user || !id || !activeChannel) return;
    if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
    if (value.trim()) {
      typingDebounceRef.current = setTimeout(() => {
        void setTyping(id, activeChannel, user.uid, user.displayName || member?.display_name || "某人");
      }, 250);
    } else {
      void clearTyping(id, activeChannel, user.uid);
    }
  };

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
        members,
      });
      if (threadId) setThreadDraft("");
      else {
        setDraft("");
        if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
        void clearTyping(id, activeChannel, user.uid);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "發送失敗");
    } finally {
      setSending(false);
    }
  };

  const addChannel = async () => {
    if (!user || !id) return;
    const name = await askPrompt("新增頻道", "channel-name");
    if (name == null || !name.trim()) return;
    const makePrivate = await askConfirm("設為私人頻道？");
    try {
      const cid = await createChannel(
        id,
        user.uid,
        name,
        makePrivate ? { is_private: true, member_ids: [user.uid] } : undefined
      );
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

  const runAiSummary = async () => {
    if (!id || !activeChannel) return;
    setAiOpen(true);
    setAiBusy(true);
    setAiError("");
    setAiSummary("");
    setAiSavedNoteId(null);
    try {
      const recent = topMessages.slice(-40);
      const text = recent
        .map((m) => `${m.author_name || "匿名"}: ${m.text}`)
        .join("\n");
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "summarize",
          title: activeChannelObj?.name || "頻道",
          body: text || "（沒有訊息）",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "摘要失敗");
      setAiSummary(String(data.text || ""));
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "摘要失敗");
    } finally {
      setAiBusy(false);
    }
  };

  const saveAiSummaryAsNote = async () => {
    if (!user || !id || !activeChannel || !aiSummary.trim()) return;
    setAiSaving(true);
    try {
      const title = `#${activeChannelObj?.name || "頻道"} 摘要 · ${new Date().toLocaleDateString("zh-TW")}`;
      const noteId = await createNote(user.uid, title, aiSummary);
      await pinNote(id, noteId, title, user.uid);
      await sendMessage(id, activeChannel, {
        author_id: user.uid,
        author_name: user.displayName || "",
        text: `分享了頻道摘要筆記「${title}」`,
        kind: "note_share",
        note_id: noteId,
        note_title: title,
        members,
      });
      setAiSavedNoteId(noteId);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setAiSaving(false);
    }
  };

  const convertMessageToNote = async (m: Message) => {
    if (!user || !id || !activeChannel || convertingId) return;
    setConvertingId(m.id);
    try {
      const title = m.text.trim().slice(0, 40) || "訊息筆記";
      const body = `> 來自 ${m.author_name || "匿名"} · #${activeChannelObj?.name || ""} · ${m.created_at.toLocaleString("zh-TW")}\n\n${m.text}`;
      const noteId = await createNote(user.uid, title, body);
      await pinNote(id, noteId, title, user.uid);
      await sendMessage(id, activeChannel, {
        author_id: user.uid,
        author_name: user.displayName || "",
        text: `將訊息轉為筆記「${title}」`,
        kind: "note_share",
        note_id: noteId,
        note_title: title,
        members,
      });
      setNoteFlash((f) => ({ ...f, [m.id]: noteId }));
      setTimeout(() => {
        setNoteFlash((f) => {
          const next = { ...f };
          delete next[m.id];
          return next;
        });
      }, 6000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "轉筆記失敗");
    } finally {
      setConvertingId(null);
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
                <span>
                  # {c.name}
                  {c.is_private && (
                    <span className="tm-lock" title="私人頻道">
                      🔒
                    </span>
                  )}
                </span>
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
          <button
            type="button"
            className={`btn btn-sm btn-ghost${activityOpen ? " is-on" : ""}`}
            onClick={() => {
              setActivityOpen((o) => !o);
              setThreadRoot(null);
            }}
          >
            動態
          </button>
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
          {activeChannelObj?.is_private && (
            <span className="tm-lock" title="私人頻道">
              🔒
            </span>
          )}
          {activeChannelObj?.topic && <span className="tm-channel-topic">{activeChannelObj.topic}</span>}

          <div className="tm-main-head-actions">
            <input
              className="input tm-search"
              placeholder="搜尋訊息…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery.trim() && (
              <span className="tm-search-count">符合 {filteredMessages.length} 筆</span>
            )}
            <button
              type="button"
              className="btn btn-sm btn-soft"
              disabled={!activeChannel || aiBusy}
              onClick={() => void runAiSummary()}
            >
              {aiBusy ? "摘要中…" : "摘要"}
            </button>
          </div>
        </div>

        {error && <p className="note-aside-error" style={{ padding: "0 1rem" }}>{error}</p>}

        {aiOpen && (
          <div className="tm-ai-panel">
            <div className="tm-ai-panel-head">
              <strong>AI 摘要</strong>
              <button type="button" className="doc-cmd" onClick={() => setAiOpen(false)}>
                關閉
              </button>
            </div>
            {aiBusy ? (
              <p className="tm-sidebar-muted">正在生成摘要…</p>
            ) : aiError ? (
              <p className="note-aside-error">{aiError}</p>
            ) : (
              <>
                <p className="tm-ai-panel-text">{aiSummary || "沒有可摘要的訊息。"}</p>
                <div className="tm-ai-panel-actions">
                  {aiSavedNoteId ? (
                    <Link href={`/notes/${aiSavedNoteId}`} className="btn btn-sm btn-soft">
                      查看筆記
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={!aiSummary.trim() || aiSaving}
                      onClick={() => void saveAiSummaryAsNote()}
                    >
                      {aiSaving ? "儲存中…" : "存成筆記"}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <div className="tm-messages" ref={scrollRef}>
          {filteredMessages.length === 0 ? (
            <p className="note-aside-empty" style={{ padding: "1rem" }}>
              {searchQuery.trim() ? "沒有符合的訊息。" : "還沒有訊息，開始聊聊吧。"}
            </p>
          ) : (
            filteredMessages.map((m) => (
              <MessageRow
                key={m.id}
                m={m}
                mine={m.author_id === user.uid}
                replyCount={replyCounts[m.id] || 0}
                converting={convertingId === m.id}
                flashNoteId={noteFlash[m.id]}
                onReply={() => {
                  setThreadRoot(m);
                  setActivityOpen(false);
                }}
                onReact={(emoji) =>
                  void toggleMessageReaction(id, activeChannel!, m.id, user.uid, emoji)
                }
                onPin={
                  m.note_id
                    ? () => void pinNote(id, m.note_id!, m.note_title || "筆記", user.uid)
                    : undefined
                }
                onNoteify={() => void convertMessageToNote(m)}
              />
            ))
          )}
        </div>

        {typingPeople.length > 0 && (
          <p className="tm-typing">{typingPeople.map((p) => p.name).join("、")} 正在輸入…</p>
        )}

        <div className="tm-composer">
          <div className="tm-composer-wrap">
            {mentionOpen && mentionMembers.length > 0 && (
              <div className="tm-mention-menu">
                {mentionMembers.map((m) => (
                  <button
                    key={m.uid}
                    type="button"
                    className="tm-mention-menu-item"
                    onClick={() => insertMention(m)}
                  >
                    <span className="tm-member-avatar">{(m.display_name || "?").slice(0, 1)}</span>
                    {memberLabel(m)}
                  </button>
                ))}
              </div>
            )}
            <input
              ref={composerRef}
              className="input"
              placeholder={activeChannelObj ? `在 #${activeChannelObj.name} 傳訊息…` : "選擇頻道以開始聊天"}
              value={draft}
              disabled={!activeChannel}
              onChange={(e) => handleDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void send();
                }
              }}
            />
          </div>
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
            <p>{renderMentions(threadRoot.text)}</p>
          </div>
          <div className="tm-thread-replies">
            {threadReplies.map((r) => (
              <div key={r.id} className="tm-msg">
                <span className="tm-msg-author">{r.author_name || "匿名"}</span>
                <span className="tm-msg-text">{renderMentions(r.text)}</span>
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

      {activityOpen && (
        <aside className="tm-thread-panel tm-activity-panel">
          <div className="tm-thread-head">
            <strong>動態</strong>
            <button type="button" className="doc-cmd" onClick={() => setActivityOpen(false)}>
              關閉
            </button>
          </div>
          <div className="tm-thread-replies">
            {activity.length === 0 ? (
              <p className="tm-sidebar-muted">還沒有動態。</p>
            ) : (
              activity.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="tm-activity-item"
                  onClick={() => {
                    if (a.channel_id) {
                      setActiveChannel(a.channel_id);
                      setActivityOpen(false);
                    }
                  }}
                >
                  <span className="tm-activity-text">
                    <strong>{a.actor_name || "某人"}</strong> · {a.text}
                  </span>
                  <span className="tm-activity-time">
                    {a.created_at.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </button>
              ))
            )}
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
  converting,
  flashNoteId,
  onReply,
  onReact,
  onPin,
  onNoteify,
}: {
  m: Message;
  mine: boolean;
  replyCount: number;
  converting?: boolean;
  flashNoteId?: string;
  onReply: () => void;
  onReact: (emoji: string) => void;
  onPin?: () => void;
  onNoteify?: () => void;
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
          <span>{renderMentions(m.text)}</span>
        </Link>
      ) : (
        <span className="tm-msg-text">{renderMentions(m.text)}</span>
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
      {flashNoteId && (
        <Link href={`/notes/${flashNoteId}`} className="tm-note-flash">
          ✅ 已建立筆記 → 查看
        </Link>
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
        {onNoteify && m.kind !== "note_share" && (
          <button type="button" className="doc-cmd" disabled={converting} onClick={onNoteify}>
            {converting ? "轉換中…" : "轉筆記"}
          </button>
        )}
      </div>
    </div>
  );
}
