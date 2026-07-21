"use client";

import PageLoading from "@/components/motion/PageLoading";

import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { askPrompt, askConfirm, askChoice } from "@/lib/dialogs";
import { createNote } from "@/lib/firebase";
import { colorForUid } from "@/lib/presence";
import NoteHuddle from "@/components/notes/NoteHuddle";
import MenuSelect from "@/components/MenuSelect";
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
  removeMember,
  transferOwnership,
  markChannelRead,
  markChannelUnread,
  openOrCreateDm,
  channelIsUnread,
  toggleMessageReaction,
  pinNote,
  unpinNote,
  listenTyping,
  setTyping,
  clearTyping,
  listenActivity,
  editMessage,
  deleteMessage,
  toggleMessagePin,
  uploadTeamFile,
  updateChannelMembers,
  updateChannel,
  deleteChannel,
  setChannelMuted,
  listenMutedChannels,
  searchTeamMessages,
  renameTeam,
  deleteTeam,
  setChannelPresence,
  clearChannelPresence,
  listenChannelPresence,
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
import { addLaterItem } from "@/lib/teamHubPrefs";
import { toast } from "@/lib/toast";

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

function draftKey(teamId: string, channelId: string): string {
  return `cadence:tm:${teamId}:ch:${channelId}:draft`;
}

function threadDraftKey(teamId: string, channelId: string, threadRootId: string): string {
  return `cadence:tm:${teamId}:ch:${channelId}:threadDraft:${threadRootId}`;
}

type SlashCommand = { cmd: string; desc: string };

const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: "/me", desc: "以動作訊息發送（斜體）" },
  { cmd: "/shrug", desc: "附加 ¯\\_(ツ)_/¯" },
  { cmd: "/note", desc: "以剩餘文字為標題建立筆記" },
  { cmd: "/summary", desc: "產生本頻道 AI 摘要" },
  { cmd: "/help", desc: "顯示指令說明" },
];

const SLASH_HELP_TEXT =
  "可用指令：/me 動作內容、/shrug 附加表情、/note 標題 建立筆記、/summary 產生摘要、/help 顯示說明";

function TeamRoomInner() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading, displayName } = useAuth();

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

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const [membersDialogOpen, setMembersDialogOpen] = useState(false);
  const [membersDialogSelected, setMembersDialogSelected] = useState<Set<string>>(new Set());

  const [settingsOpen, setSettingsOpen] = useState(false);

  const [presencePeople, setPresencePeople] = useState<{ uid: string; name: string; color: string }[]>([]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mutedChannels, setMutedChannels] = useState<Record<string, boolean>>({});
  const [teamSearchOpen, setTeamSearchOpen] = useState(false);
  const [teamSearchBusy, setTeamSearchBusy] = useState(false);
  const [teamSearchResults, setTeamSearchResults] = useState<{ channelId: string; message: Message }[]>([]);

  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [emojiOpenId, setEmojiOpenId] = useState<string | null>(null);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const [memberPopover, setMemberPopover] = useState<{ member: Member; x: number; y: number } | null>(null);
  const memberPopRef = useRef<HTMLDivElement | null>(null);

  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const threadDraftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftLoadedRef = useRef(false);

  const deepLinkRef = useRef(false);

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
        setActiveChannel((cur) => {
          if (cur) return cur;
          const fromQuery = searchParams.get("channel");
          if (fromQuery && list.some((c) => c.id === fromQuery)) return fromQuery;
          return list[0]?.id || null;
        });
      },
      user.uid
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (!id || !user || !member) return;
    return listenMutedChannels(user.uid, id, setMutedChannels);
  }, [id, user, member]);

  useEffect(() => {
    if (!id || !activeChannel) return;
    return listenMessages(id, activeChannel, setMessages, 120);
  }, [id, activeChannel]);

  useEffect(() => {
    if (!user || !id || !activeChannel) return;
    void markChannelRead(user.uid, id, activeChannel);
  }, [user, id, activeChannel, messages.length]);

  // Draft persistence: load whenever the active channel changes.
  useEffect(() => {
    if (!id || !activeChannel) return;
    draftLoadedRef.current = false;
    try {
      const saved = window.localStorage.getItem(draftKey(id, activeChannel));
      setDraft(saved || "");
    } catch {
      /* ignore */
    } finally {
      draftLoadedRef.current = true;
    }
  }, [id, activeChannel]);

  // Draft persistence: debounce-save 300ms after each change.
  useEffect(() => {
    if (!id || !activeChannel || !draftLoadedRef.current) return;
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      try {
        if (draft) window.localStorage.setItem(draftKey(id, activeChannel), draft);
        else window.localStorage.removeItem(draftKey(id, activeChannel));
      } catch {
        /* ignore */
      }
    }, 300);
    return () => {
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    };
  }, [draft, id, activeChannel]);

  // Thread draft persistence: load whenever the open thread changes.
  useEffect(() => {
    if (!id || !activeChannel || !threadRoot) return;
    try {
      const saved = window.localStorage.getItem(threadDraftKey(id, activeChannel, threadRoot.id));
      setThreadDraft(saved || "");
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadRoot?.id]);

  // Thread draft persistence: debounce-save 300ms after each change.
  useEffect(() => {
    if (!id || !activeChannel || !threadRoot) return;
    if (threadDraftSaveTimerRef.current) clearTimeout(threadDraftSaveTimerRef.current);
    threadDraftSaveTimerRef.current = setTimeout(() => {
      try {
        if (threadDraft) window.localStorage.setItem(threadDraftKey(id, activeChannel, threadRoot.id), threadDraft);
        else window.localStorage.removeItem(threadDraftKey(id, activeChannel, threadRoot.id));
      } catch {
        /* ignore */
      }
    }, 300);
    return () => {
      if (threadDraftSaveTimerRef.current) clearTimeout(threadDraftSaveTimerRef.current);
    };
  }, [threadDraft, id, activeChannel, threadRoot]);

  // Esc closes overlays, in priority order (most specific/topmost first).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (lightboxUrl) {
        setLightboxUrl(null);
        return;
      }
      if (emojiOpenId) {
        setEmojiOpenId(null);
        return;
      }
      if (memberPopover) {
        setMemberPopover(null);
        return;
      }
      if (teamSearchOpen) {
        setTeamSearchOpen(false);
        return;
      }
      if (activityOpen) {
        setActivityOpen(false);
        return;
      }
      if (inviteOpen) {
        setInviteOpen(false);
        return;
      }
      if (settingsOpen) {
        setSettingsOpen(false);
        return;
      }
      if (membersDialogOpen) {
        setMembersDialogOpen(false);
        return;
      }
      if (threadRoot) {
        setThreadRoot(null);
        return;
      }
      if (sidebarOpen) {
        setSidebarOpen(false);
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    lightboxUrl,
    emojiOpenId,
    memberPopover,
    teamSearchOpen,
    activityOpen,
    inviteOpen,
    settingsOpen,
    membersDialogOpen,
    threadRoot,
    sidebarOpen,
  ]);

  // Close the member popover on an outside click.
  useEffect(() => {
    if (!memberPopover) return;
    const onOutside = (e: MouseEvent) => {
      if (memberPopRef.current && !memberPopRef.current.contains(e.target as Node)) {
        setMemberPopover(null);
      }
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [memberPopover]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, activeChannel]);

  // Deep link: scroll to & flash a specific message once it's loaded (?msg=…).
  useEffect(() => {
    const msgId = searchParams.get("msg");
    if (!msgId || deepLinkRef.current || messages.length === 0) return;
    const el = document.querySelector(`[data-msg-id="${msgId}"]`);
    if (!el) return;
    deepLinkRef.current = true;
    window.requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("is-flash");
      setTimeout(() => el.classList.remove("is-flash"), 2200);
    });
  }, [messages, searchParams]);

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

  // Channel presence: heartbeat + live listener, reset whenever the channel changes.
  useEffect(() => {
    if (!id || !activeChannel) {
      setPresencePeople([]);
      return;
    }
    const unsub = listenChannelPresence(id, activeChannel, setPresencePeople);
    return () => {
      unsub();
      setPresencePeople([]);
    };
  }, [id, activeChannel]);

  useEffect(() => {
    if (!id || !activeChannel || !user) return;
    const name = displayName || member?.display_name || "訪客";
    const color = colorForUid(user.uid);
    const beat = () => void setChannelPresence(id, activeChannel, user.uid, name, color);
    beat();
    const interval = setInterval(beat, 12000);
    return () => {
      clearInterval(interval);
      void clearChannelPresence(id, activeChannel, user.uid);
    };
  }, [id, activeChannel, user, member?.display_name]);

  const activeChannelObj = useMemo(
    () => channels.find((c) => c.id === activeChannel) || null,
    [channels, activeChannel]
  );

  const topMessages = useMemo(
    () => messages.filter((m) => !m.thread_id),
    [messages]
  );

  const pinnedMessages = useMemo(
    () => messages.filter((m) => m.pinned && !m.deleted),
    [messages]
  );

  const dms = useMemo(() => channels.filter((c) => c.dm_key), [channels]);
  const rooms = useMemo(() => channels.filter((c) => !c.dm_key), [channels]);

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

  const slashOpen = !mentionOpen && draft.startsWith("/") && !!activeChannel;
  const slashMatches = useMemo(() => {
    if (!slashOpen) return [];
    const head = draft.trim().split(/\s+/)[0]?.toLowerCase() || "/";
    return SLASH_COMMANDS.filter((c) => c.cmd.startsWith(head));
  }, [slashOpen, draft]);

  const activeChannelMuted = !!(activeChannel && mutedChannels[activeChannel]);

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
        void setTyping(id, activeChannel, user.uid, displayName || member?.display_name || "某人");
      }, 250);
    } else {
      void clearTyping(id, activeChannel, user.uid);
    }
  };

  /** Handles a leading-slash draft. Returns true if it was fully handled (should not send literally). */
  const runSlashCommand = async (text: string): Promise<boolean> => {
    if (!user || !id || !activeChannel) return false;
    const spaceIdx = text.indexOf(" ");
    const cmd = (spaceIdx === -1 ? text : text.slice(0, spaceIdx)).toLowerCase();
    const rest = spaceIdx === -1 ? "" : text.slice(spaceIdx + 1).trim();
    const name = displayName || member?.display_name || "某人";

    switch (cmd) {
      case "/me": {
        if (!rest) return true;
        await sendMessage(id, activeChannel, {
          author_id: user.uid,
          author_name: displayName || "",
          text: `_${name} ${rest}_`,
          members,
        });
        return true;
      }
      case "/shrug": {
        await sendMessage(id, activeChannel, {
          author_id: user.uid,
          author_name: displayName || "",
          text: `${rest} ¯\\_(ツ)_/¯`.trim(),
          members,
        });
        return true;
      }
      case "/note": {
        const title = rest || "新筆記";
        try {
          const noteId = await createNote(user.uid, title, "");
          await pinNote(id, noteId, title, user.uid);
          await sendMessage(id, activeChannel, {
            author_id: user.uid,
            author_name: displayName || "",
            text: `建立了筆記「${title}」`,
            kind: "note_share",
            note_id: noteId,
            note_title: title,
            members,
          });
        } catch (e) {
          setError(e instanceof Error ? e.message : "建立筆記失敗");
        }
        return true;
      }
      case "/summary": {
        void runAiSummary();
        return true;
      }
      case "/help": {
        setError(SLASH_HELP_TEXT);
        return true;
      }
      default:
        return false;
    }
  };

  const send = async (threadId?: string) => {
    const text = threadId ? threadDraft : draft;
    if (!user || !id || !activeChannel || !text.trim() || sending) return;
    setSending(true);
    try {
      if (!threadId && text.trim().startsWith("/")) {
        const handled = await runSlashCommand(text.trim());
        if (handled) {
          setDraft("");
          try {
            window.localStorage.removeItem(draftKey(id, activeChannel));
          } catch {
            /* ignore */
          }
          if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
          void clearTyping(id, activeChannel, user.uid);
          return;
        }
      }
      await sendMessage(id, activeChannel, {
        author_id: user.uid,
        author_name: displayName || "",
        text: text.trim(),
        thread_id: threadId,
        members,
      });
      if (threadId) {
        setThreadDraft("");
        try {
          window.localStorage.removeItem(threadDraftKey(id, activeChannel, threadId));
        } catch {
          /* ignore */
        }
      } else {
        setDraft("");
        try {
          window.localStorage.removeItem(draftKey(id, activeChannel));
        } catch {
          /* ignore */
        }
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

  const editTopic = async () => {
    if (!id || !activeChannel || !activeChannelObj) return;
    const next = await askPrompt({
      title: "頻道主題",
      defaultValue: activeChannelObj.topic || "",
      placeholder: "這個頻道是做什麼的？",
    });
    if (next == null) return;
    try {
      await updateChannel(id, activeChannel, { topic: next.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新主題失敗");
    }
  };

  const toggleActiveChannelMute = async () => {
    if (!user || !id || !activeChannel) return;
    try {
      await setChannelMuted(user.uid, id, activeChannel, !activeChannelMuted);
    } catch (e) {
      setError(e instanceof Error ? e.message : "設定靜音失敗");
    }
  };

  const selectChannel = (cid: string) => {
    setActiveChannel(cid);
    setSidebarOpen(false);
  };

  const runTeamSearch = async () => {
    if (!id || searchQuery.trim().length < 2) return;
    setTeamSearchBusy(true);
    try {
      const results = await searchTeamMessages(id, channels.map((c) => c.id), searchQuery.trim());
      setTeamSearchResults(results);
      setTeamSearchOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "全隊搜尋失敗");
    } finally {
      setTeamSearchBusy(false);
    }
  };

  const jumpToTeamSearchResult = (channelId: string, messageId: string) => {
    setTeamSearchOpen(false);
    setSidebarOpen(false);
    setActiveChannel(channelId);
    window.setTimeout(() => scrollToMessage(messageId), 350);
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

  const doRemoveMember = async (target: Member) => {
    if (!user || !id || !canAdmin) return;
    if (target.uid === user.uid) return;
    const ok = await askConfirm({
      title: "移除成員",
      message: `確定將「${target.display_name || target.uid.slice(0, 6)}」移出團隊？`,
      danger: true,
    });
    if (!ok) return;
    try {
      await removeMember(id, user.uid, target.uid, displayName || undefined);
      setMemberPopover(null);
      toast("已移除成員");
    } catch (e) {
      setError(e instanceof Error ? e.message : "移除失敗");
    }
  };

  const doTransferOwnership = async () => {
    if (!user || !id || member?.role !== "owner") return;
    const candidates = members.filter((m) => m.uid !== user.uid);
    if (!candidates.length) {
      setError("沒有可轉移的成員，請先邀請夥伴加入。");
      return;
    }
    const pick = await askChoice({
      title: "轉移擁有權",
      message: "選擇新的擁有者。你會變成管理員，之後即可離開團隊。",
      options: candidates.map((m) => ({
        id: m.uid,
        label: m.display_name || m.uid.slice(0, 8),
        description: ROLE_LABEL[m.role],
      })),
    });
    if (!pick) return;
    const ok = await askConfirm({
      title: "確認轉移",
      message: "轉移後你將不再是擁有者。確定？",
      danger: true,
    });
    if (!ok) return;
    try {
      await transferOwnership(id, user.uid, pick.choice);
      setSettingsOpen(false);
      toast("擁有權已轉移");
    } catch (e) {
      setError(e instanceof Error ? e.message : "轉移失敗");
    }
  };

  const renameChannel = async () => {
    if (!id || !activeChannel || !activeChannelObj || activeChannelObj.dm_key) return;
    if (!canAdmin) {
      setError("只有管理員可以重新命名頻道");
      return;
    }
    const name = await askPrompt({
      title: "重新命名頻道",
      defaultValue: activeChannelObj.name,
    });
    if (name == null) return;
    try {
      await updateChannel(id, activeChannel, { name });
      toast("頻道已重新命名");
    } catch (e) {
      setError(e instanceof Error ? e.message : "重新命名失敗");
    }
  };

  const doDeleteChannel = async () => {
    if (!user || !id || !activeChannel || !activeChannelObj || activeChannelObj.dm_key) return;
    if (!canAdmin) {
      setError("只有管理員可以刪除頻道");
      return;
    }
    const ok = await askConfirm({
      title: "刪除頻道",
      message: `確定刪除 #${activeChannelObj.name}？此操作無法復原。`,
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteChannel(id, activeChannel, user.uid, displayName || undefined);
      setActiveChannel(null);
      toast("頻道已刪除");
    } catch (e) {
      setError(e instanceof Error ? e.message : "刪除頻道失敗");
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
        author_name: displayName || "",
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
        author_name: displayName || "",
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

  const convertThreadToNote = async () => {
    if (!user || !id || !activeChannel || !threadRoot) return;
    try {
      const title = threadRoot.text.trim().slice(0, 40) || "討論串筆記";
      const lines = [
        `> 討論串 · 來自 ${threadRoot.author_name || "匿名"} · #${activeChannelObj?.name || ""} · ${threadRoot.created_at.toLocaleString("zh-TW")}`,
        "",
        threadRoot.text,
        "",
        "---",
        "",
        ...threadReplies.map((r) => `**${r.author_name || "匿名"}**：${r.text}`),
      ];
      const noteId = await createNote(user.uid, title, lines.join("\n"));
      await pinNote(id, noteId, title, user.uid);
      await sendMessage(id, activeChannel, {
        author_id: user.uid,
        author_name: displayName || "",
        text: `將討論串轉為筆記「${title}」`,
        kind: "note_share",
        note_id: noteId,
        note_title: title,
        members,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "轉筆記失敗");
    }
  };

  const doEditMessage = async (m: Message) => {
    if (!id || !activeChannel) return;
    const next = await askPrompt({ title: "編輯訊息", defaultValue: m.text, multiline: true });
    if (next == null || !next.trim() || next.trim() === m.text) return;
    try {
      await editMessage(id, activeChannel, m.id, next.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "編輯失敗");
    }
  };

  const doDeleteMessage = async (m: Message) => {
    if (!id || !activeChannel) return;
    const ok = await askConfirm({ title: "刪除訊息", message: "確定要刪除這則訊息嗎？", danger: true });
    if (!ok) return;
    try {
      await deleteMessage(id, activeChannel, m.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "刪除失敗");
    }
  };

  const doTogglePin = async (m: Message) => {
    if (!id || !activeChannel) return;
    try {
      await toggleMessagePin(id, activeChannel, m.id, !m.pinned);
    } catch (e) {
      setError(e instanceof Error ? e.message : "釘選失敗");
    }
  };

  const scrollToMessage = (messageId: string) => {
    const el = document.querySelector(`[data-msg-id="${messageId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("is-flash");
    setTimeout(() => el.classList.remove("is-flash"), 2200);
  };

  const copyMessageLink = async (m: Message) => {
    if (!id || !activeChannel) return;
    const url = `${window.location.origin}/team/${id}?channel=${activeChannel}&msg=${m.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLinkId(m.id);
      setTimeout(() => setCopiedLinkId((cur) => (cur === m.id ? null : cur)), 1600);
    } catch {
      /* ignore */
    }
  };

  const exportTranscript = () => {
    if (!activeChannel || !activeChannelObj) return;
    const lines = topMessages
      .slice(-500)
      .filter((m) => !m.deleted)
      .map(
        (m) =>
          `**${m.author_name || "匿名"}** · ${m.created_at.toLocaleString("zh-TW")}\n${m.text}\n`
      );
    const content = `# ${activeChannelObj.name}\n\n${lines.join("\n")}`;
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeChannelObj.name || "channel"}-transcript.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openMemberPopover = (uid: string, e: ReactMouseEvent) => {
    const m = members.find((mm) => mm.uid === uid);
    if (!m) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMemberPopover({ member: m, x: rect.left, y: rect.bottom + 6 });
  };

  const mentionFromPopover = () => {
    if (!memberPopover) return;
    insertMention(memberPopover.member);
    setMemberPopover(null);
  };

  const startDm = async (other: Member) => {
    if (!id || !member) return;
    try {
      const cid = await openOrCreateDm(id, member, other);
      setActiveChannel(cid);
      setSidebarOpen(false);
      setMemberPopover(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "開啟私訊失敗");
    }
  };

  const dmOtherMember = (c: Channel): Member | undefined =>
    members.find((mm) => mm.uid !== user?.uid && c.member_ids?.includes(mm.uid));

  const pickFile = () => fileInputRef.current?.click();

  const onFileChosen = async (file: File | null) => {
    if (!file || !user || !id || !activeChannel) return;
    setUploading(true);
    try {
      const uploaded = await uploadTeamFile(id, activeChannel, file);
      await sendMessage(id, activeChannel, {
        author_id: user.uid,
        author_name: displayName || "",
        text: uploaded.name,
        kind: "file",
        file_url: uploaded.url,
        file_name: uploaded.name,
        file_mime: uploaded.mime,
        members,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "上傳失敗");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const openMembersDialog = () => {
    setMembersDialogSelected(new Set(activeChannelObj?.member_ids || []));
    setMembersDialogOpen(true);
  };

  const saveMembersDialog = async () => {
    if (!id || !activeChannel || !activeChannelObj) return;
    const ids = new Set(membersDialogSelected);
    ids.add(activeChannelObj.created_by);
    try {
      await updateChannelMembers(id, activeChannel, Array.from(ids));
      setMembersDialogOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新成員失敗");
    }
  };

  const doRenameTeam = async () => {
    if (!id || !team) return;
    const name = await askPrompt({ title: "重新命名團隊", defaultValue: team.name });
    if (name == null || !name.trim() || name.trim() === team.name) return;
    try {
      await renameTeam(id, name.trim());
      setTeam((t) => (t ? { ...t, name: name.trim() } : t));
    } catch (e) {
      setError(e instanceof Error ? e.message : "重新命名失敗");
    }
  };

  const doDeleteTeam = async () => {
    if (!id || !team) return;
    const ok = await askConfirm({
      title: "刪除團隊",
      message: `確定要刪除「${team.name}」嗎？此操作無法復原。`,
      danger: true,
      confirmLabel: "刪除",
    });
    if (!ok) return;
    try {
      await deleteTeam(id, members.map((m) => m.uid));
      router.push("/team");
    } catch (e) {
      setError(e instanceof Error ? e.message : "刪除團隊失敗");
    }
  };

  if (loading || !checked) return <PageLoading />;
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
    <div className={`tm-room${sidebarOpen ? " is-drawer-open" : ""}`}>
      {sidebarOpen && (
        <div className="tm-drawer-backdrop" onClick={() => setSidebarOpen(false)} />
      )}
      <aside className="tm-sidebar">
        <div className="tm-sidebar-head">
          <Link href="/team" className="tm-back">←</Link>
          <span className="tm-team-name">{team.name}</span>
        </div>

        <div className="tm-channel-list">
          <p className="tm-channel-label">私人訊息</p>
          {dms.length === 0 ? (
            <p className="tm-sidebar-muted">點成員大頭貼選「傳訊息」開始私訊</p>
          ) : (
            dms.map((c) => {
              const unread = channelIsUnread(c, reads[c.id]);
              const muted = !!mutedChannels[c.id];
              const other = dmOtherMember(c);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`tm-channel-item${c.id === activeChannel ? " is-on" : ""}${unread && c.id !== activeChannel ? " is-unread" : ""}${muted ? " is-muted" : ""}`}
                  onClick={() => selectChannel(c.id)}
                >
                  <span className="tm-dm-label">
                    💬 {other ? memberLabel(other) : c.name}
                    {muted && (
                      <span className="tm-mute-icon" title="已靜音">
                        🔕
                      </span>
                    )}
                  </span>
                  {unread && c.id !== activeChannel && <span className="tm-unread-dot" aria-hidden />}
                </button>
              );
            })
          )}
        </div>

        <div className="tm-channel-list">
          <p className="tm-channel-label">頻道</p>
          {rooms.map((c) => {
            const unread = channelIsUnread(c, reads[c.id]);
            const muted = !!mutedChannels[c.id];
            return (
              <button
                key={c.id}
                type="button"
                className={`tm-channel-item${c.id === activeChannel ? " is-on" : ""}${unread && c.id !== activeChannel ? " is-unread" : ""}${muted ? " is-muted" : ""}`}
                onClick={() => selectChannel(c.id)}
              >
                <span>
                  # {c.name}
                  {c.is_private && (
                    <span className="tm-lock" title="私人頻道">
                      🔒
                    </span>
                  )}
                  {muted && (
                    <span className="tm-mute-icon" title="已靜音">
                      🔕
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
                <button
                  type="button"
                  className="tm-member-pop-trigger"
                  onClick={(e) => openMemberPopover(m.uid, e)}
                >
                  <span className="tm-member-avatar">{(m.display_name || "?").slice(0, 1)}</span>
                  <span className="tm-member-name">
                    {m.display_name || m.uid.slice(0, 6)}
                    {m.uid === user.uid ? "（你）" : ""}
                  </span>
                </button>
                {canAdmin && m.role !== "owner" && m.uid !== user.uid ? (
                  <MenuSelect
                    variant="soft"
                    size="sm"
                    className="tm-role-select"
                    ariaLabel="成員角色"
                    value={m.role}
                    options={[
                      { value: "admin", label: "管理員" },
                      { value: "member", label: "成員" },
                      { value: "guest", label: "訪客" },
                    ]}
                    onChange={(role) => void changeRole(m.uid, role as TeamRole)}
                  />
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
          {canAdmin && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSettingsOpen(true)}>
              ⚙ 設定
            </button>
          )}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void doLeave()}>
            離開團隊
          </button>
        </div>
      </aside>

      <div className="tm-main">
        <div className="tm-main-head">
          <button
            type="button"
            className="tm-menu-btn"
            aria-label="開啟頻道選單"
            onClick={() => setSidebarOpen(true)}
          >
            ☰
          </button>
          <span className="tm-channel-title">
            {activeChannelObj
              ? activeChannelObj.dm_key
                ? `💬 ${dmOtherMember(activeChannelObj) ? memberLabel(dmOtherMember(activeChannelObj)!) : activeChannelObj.name}`
                : `# ${activeChannelObj.name}`
              : "選擇頻道"}
          </span>
          {activeChannelObj?.is_private && !activeChannelObj.dm_key && (
            <span className="tm-lock" title="私人頻道">
              🔒
            </span>
          )}
          {activeChannelObj && (
            <button
              type="button"
              className="tm-channel-topic-btn"
              onClick={() => void editTopic()}
              title="編輯主題"
            >
              {activeChannelObj.topic || "新增主題…"}
            </button>
          )}

          {activeChannelObj && !activeChannelObj.dm_key && canAdmin && (
            <>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                title="重新命名頻道"
                onClick={() => void renameChannel()}
              >
                重新命名
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                title="刪除頻道"
                onClick={() => void doDeleteChannel()}
              >
                刪除頻道
              </button>
            </>
          )}

          {activeChannel && (
            <NoteHuddle roomId={`team:${id}:ch:${activeChannel}`} label="語音" />
          )}

          {presencePeople.filter((p) => p.uid !== user.uid).length > 0 && (
            <div
              className="tm-presence-avatars"
              title={presencePeople
                .filter((p) => p.uid !== user.uid)
                .map((p) => p.name)
                .join("、")}
            >
              {presencePeople
                .filter((p) => p.uid !== user.uid)
                .slice(0, 5)
                .map((p) => (
                  <span key={p.uid} className="tm-presence-avatar" style={{ background: p.color }}>
                    {(p.name || "?").slice(0, 1)}
                  </span>
                ))}
            </div>
          )}

          <div className="tm-main-head-actions">
            <input
              className="input tm-search"
              placeholder="搜尋訊息…（Enter 全隊搜尋）"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && searchQuery.trim().length >= 2) {
                  e.preventDefault();
                  void runTeamSearch();
                }
              }}
            />
            {searchQuery.trim() && (
              <span className="tm-search-count">符合 {filteredMessages.length} 筆</span>
            )}
            {searchQuery.trim().length >= 2 && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={teamSearchBusy}
                onClick={() => void runTeamSearch()}
                title="搜尋所有頻道"
              >
                {teamSearchBusy ? "搜尋中…" : "全隊搜尋"}
              </button>
            )}
            {activeChannelObj?.is_private &&
              (canAdmin || activeChannelObj.created_by === user.uid) && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={openMembersDialog}>
                管理成員
              </button>
            )}
            <button
              type="button"
              className={`btn btn-sm btn-ghost${activeChannelMuted ? " is-on" : ""}`}
              disabled={!activeChannel}
              onClick={() => void toggleActiveChannelMute()}
            >
              {activeChannelMuted ? "🔕 取消靜音" : "🔔 靜音"}
            </button>
            {activeChannel && (
              <>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => void markChannelRead(user.uid, id, activeChannel)}
                >
                  標為已讀
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => void markChannelUnread(user.uid, id, activeChannel)}
                >
                  標為未讀
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={exportTranscript}
                  title="匯出此頻道的訊息記錄"
                >
                  匯出
                </button>
              </>
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

        {teamSearchOpen && (
          <div className="tm-team-search-panel">
            <div className="tm-ai-panel-head">
              <strong>全隊搜尋 ·「{searchQuery.trim()}」</strong>
              <button type="button" className="doc-cmd" onClick={() => setTeamSearchOpen(false)}>
                關閉
              </button>
            </div>
            {teamSearchResults.length === 0 ? (
              <p className="tm-sidebar-muted">沒有符合的訊息。</p>
            ) : (
              <div className="tm-team-search-list">
                {teamSearchResults.map(({ channelId, message }) => {
                  const ch = channels.find((c) => c.id === channelId);
                  return (
                    <button
                      key={message.id}
                      type="button"
                      className="tm-team-search-item"
                      onClick={() => jumpToTeamSearchResult(channelId, message.id)}
                    >
                      <span className="tm-team-search-channel"># {ch?.name || "頻道"}</span>
                      <span className="tm-team-search-snippet">
                        <strong>{message.author_name || "匿名"}</strong> {message.text.slice(0, 100)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {pinnedMessages.length > 0 && (
          <div className="tm-pinned-strip">
            <span className="tm-pinned-strip-label">📌 已釘選</span>
            {pinnedMessages.map((p) => (
              <button
                key={p.id}
                type="button"
                className="tm-pinned-strip-item"
                onClick={() => scrollToMessage(p.id)}
              >
                <strong>{p.author_name || "匿名"}</strong>
                <span>{p.kind === "file" ? `📎 ${p.file_name || p.text}` : p.text.slice(0, 60)}</span>
              </button>
            ))}
          </div>
        )}

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
            searchQuery.trim() ? (
              <p className="note-aside-empty" style={{ padding: "1rem" }}>沒有符合的訊息。</p>
            ) : (
              <div className="tm-welcome">
                <p className="tm-welcome-title">
                  這是 #{activeChannelObj?.name || "頻道"} 的開頭
                </p>
                <p className="tm-sidebar-muted">開始聊聊，或試試以下動作：</p>
                <div className="tm-welcome-actions">
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
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => void editTopic()}>
                    設定主題
                  </button>
                </div>
                <p className="tm-sidebar-muted">分享筆記提示：從筆記按「分享」→「團隊」</p>
              </div>
            )
          ) : (
            filteredMessages.map((m) => (
              <MessageRow
                key={m.id}
                m={m}
                mine={m.author_id === user.uid}
                mentioned={!!m.mentions?.includes(user.uid)}
                replyCount={replyCounts[m.id] || 0}
                converting={convertingId === m.id}
                flashNoteId={noteFlash[m.id]}
                copied={copiedLinkId === m.id}
                emojiOpen={emojiOpenId === m.id}
                onEmojiOpenChange={(open) => setEmojiOpenId(open ? m.id : null)}
                onReply={() => {
                  setThreadRoot(m);
                  setActivityOpen(false);
                }}
                onReact={(emoji) =>
                  void toggleMessageReaction(id, activeChannel!, m.id, user.uid, emoji)
                }
                onPinNote={
                  m.note_id
                    ? () => void pinNote(id, m.note_id!, m.note_title || "筆記", user.uid)
                    : undefined
                }
                onNoteify={() => void convertMessageToNote(m)}
                onTogglePin={() => void doTogglePin(m)}
                onEdit={() => void doEditMessage(m)}
                onDelete={() => void doDeleteMessage(m)}
                onCopyLink={() => void copyMessageLink(m)}
                onSaveLater={() => {
                  if (!activeChannel || !team) return;
                  addLaterItem({
                    teamId: id,
                    teamName: team.name,
                    channelId: activeChannel,
                    channelName: activeChannelObj?.name || "頻道",
                    messageId: m.id,
                    text: (m.text || m.note_title || m.file_name || "訊息").slice(0, 160),
                    authorName: m.author_name || "",
                  });
                  toast("已加入稍後再看");
                }}
                onImageClick={setLightboxUrl}
                onAuthorClick={(uid, e) => openMemberPopover(uid, e)}
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
            {slashOpen && slashMatches.length > 0 && (
              <div className="tm-slash-menu">
                {slashMatches.map((c) => (
                  <button
                    key={c.cmd}
                    type="button"
                    className="tm-slash-menu-item"
                    onClick={() => {
                      setDraft(`${c.cmd} `);
                      composerRef.current?.focus();
                    }}
                  >
                    <strong>{c.cmd}</strong>
                    <span>{c.desc}</span>
                  </button>
                ))}
              </div>
            )}
            <input
              ref={composerRef}
              className="input"
              placeholder={activeChannelObj ? `在 #${activeChannelObj.name} 傳訊息…（/ 開啟指令）` : "選擇頻道以開始聊天"}
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
          <input
            ref={fileInputRef}
            type="file"
            hidden
            onChange={(e) => void onFileChosen(e.target.files?.[0] || null)}
          />
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            title="上傳檔案"
            disabled={!activeChannel || uploading}
            onClick={pickFile}
          >
            {uploading ? "上傳中…" : "📎"}
          </button>
          <button type="button" className="btn btn-sm" disabled={!draft.trim() || sending} onClick={() => void send()}>
            送出
          </button>
        </div>
      </div>

      {threadRoot && (
        <aside className="tm-thread-panel">
          <div className="tm-thread-head">
            <strong>討論串</strong>
            <div style={{ display: "flex", gap: "0.35rem" }}>
              <button type="button" className="doc-cmd" onClick={() => void convertThreadToNote()}>
                討論串轉筆記
              </button>
              <button type="button" className="doc-cmd" onClick={() => setThreadRoot(null)}>關閉</button>
            </div>
          </div>
          <div className="tm-thread-root">
            <span
              className="tm-msg-author tm-clickable-author"
              onClick={(e) => openMemberPopover(threadRoot.author_id, e)}
            >
              {threadRoot.author_name || "匿名"}
            </span>
            <p>{renderMentions(threadRoot.text)}</p>
          </div>
          <div className="tm-thread-replies">
            {threadReplies.map((r) => (
              <div key={r.id} className="tm-msg">
                <span
                  className="tm-msg-author tm-clickable-author"
                  onClick={(e) => openMemberPopover(r.author_id, e)}
                >
                  {r.author_name || "匿名"}
                </span>
                <span className="tm-msg-text">{renderMentions(r.text)}</span>
              </div>
            ))}
          </div>
          <div className="tm-quote-chip">
            <span>
              回覆 {threadRoot.author_name || "匿名"}：{threadRoot.text.slice(0, 60)}
              {threadRoot.text.length > 60 ? "…" : ""}
            </span>
            <button type="button" onClick={() => setThreadRoot(null)} title="關閉討論串" aria-label="關閉討論串">
              ×
            </button>
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

      {membersDialogOpen && activeChannelObj && (
        <div
          className="cadence-dialog-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setMembersDialogOpen(false);
          }}
        >
          <div className="cadence-dialog" role="dialog" aria-modal="true">
            <h2 className="cadence-dialog-title">管理成員 · #{activeChannelObj.name}</h2>
            <p className="cadence-dialog-msg">選擇可以看到並發言於此私人頻道的成員。</p>
            <ul className="tm-member-checklist">
              {members.map((m) => {
                const isCreator = m.uid === activeChannelObj.created_by;
                const checked = isCreator || membersDialogSelected.has(m.uid);
                return (
                  <li key={m.uid} className="tm-member-checkitem">
                    <label>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isCreator}
                        onChange={(e) => {
                          setMembersDialogSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(m.uid);
                            else next.delete(m.uid);
                            return next;
                          });
                        }}
                      />
                      {memberLabel(m)}
                      {isCreator ? "（建立者）" : ""}
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="cadence-dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setMembersDialogOpen(false)}>
                取消
              </button>
              <button type="button" className="btn" onClick={() => void saveMembersDialog()}>
                儲存
              </button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div
          className="cadence-dialog-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSettingsOpen(false);
          }}
        >
          <div className="cadence-dialog" role="dialog" aria-modal="true">
            <h2 className="cadence-dialog-title">團隊設定</h2>
            <p className="cadence-dialog-msg">管理「{team.name}」的名稱與生命週期。</p>
            <div className="cadence-dialog-actions" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
              <button type="button" className="btn btn-sm btn-soft" onClick={() => void doRenameTeam()}>
                重新命名
              </button>
              {member.role === "owner" && (
                <button type="button" className="btn btn-sm btn-soft" onClick={() => void doTransferOwnership()}>
                  轉移擁有權
                </button>
              )}
              {member.role === "owner" && (
                <button type="button" className="btn btn-sm btn-danger" onClick={() => void doDeleteTeam()}>
                  刪除團隊
                </button>
              )}
            </div>
            <div className="cadence-dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setSettingsOpen(false)}>
                關閉
              </button>
            </div>
          </div>
        </div>
      )}

      {lightboxUrl && (
        <div className="tm-lightbox" role="presentation" onClick={() => setLightboxUrl(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightboxUrl} alt="圖片預覽" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {memberPopover && (
        <div
          className="tm-member-pop"
          ref={memberPopRef}
          style={{ left: memberPopover.x, top: memberPopover.y }}
        >
          <div className="tm-member-pop-head">
            <span className="tm-member-avatar">
              {(memberPopover.member.display_name || "?").slice(0, 1)}
            </span>
            <div>
              <strong>{memberLabel(memberPopover.member)}</strong>
              <span className="tm-member-role">{ROLE_LABEL[memberPopover.member.role]}</span>
            </div>
          </div>
          <div className="tm-member-pop-actions">
            <button type="button" className="btn btn-sm btn-ghost" onClick={mentionFromPopover}>
              提及
            </button>
            {memberPopover.member.uid !== user.uid && (
              <button type="button" className="btn btn-sm btn-soft" onClick={() => void startDm(memberPopover.member)}>
                傳訊息
              </button>
            )}
            {canAdmin &&
              memberPopover.member.uid !== user.uid &&
              memberPopover.member.role !== "owner" && (
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={() => void doRemoveMember(memberPopover.member)}
                >
                  移除成員
                </button>
              )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function TeamRoomPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <TeamRoomInner />
    </Suspense>
  );
}

function MessageRow({
  m,
  mine,
  mentioned,
  replyCount,
  converting,
  flashNoteId,
  copied,
  emojiOpen,
  onEmojiOpenChange,
  onReply,
  onReact,
  onPinNote,
  onNoteify,
  onTogglePin,
  onEdit,
  onDelete,
  onCopyLink,
  onSaveLater,
  onImageClick,
  onAuthorClick,
}: {
  m: Message;
  mine: boolean;
  mentioned?: boolean;
  replyCount: number;
  converting?: boolean;
  flashNoteId?: string;
  copied?: boolean;
  emojiOpen: boolean;
  onEmojiOpenChange: (open: boolean) => void;
  onReply: () => void;
  onReact: (emoji: string) => void;
  onPinNote?: () => void;
  onNoteify?: () => void;
  onTogglePin: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCopyLink: () => void;
  onSaveLater?: () => void;
  onImageClick: (url: string) => void;
  onAuthorClick: (uid: string, e: ReactMouseEvent) => void;
}) {
  const reactionGroups = useMemo(() => {
    const map: Record<string, number> = {};
    Object.values(m.reactions || {}).forEach((e) => {
      map[e] = (map[e] || 0) + 1;
    });
    return Object.entries(map);
  }, [m.reactions]);

  const emojiWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!emojiOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (emojiWrapRef.current && !emojiWrapRef.current.contains(e.target as Node)) {
        onEmojiOpenChange(false);
      }
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [emojiOpen, onEmojiOpenChange]);

  if (m.deleted) {
    return (
      <div
        className={`tm-msg is-deleted${mine ? " is-mine" : ""}`}
        data-msg-id={m.id}
      >
        <div className="tm-msg-meta">
          <span className="tm-msg-author">{m.author_name || "匿名"}</span>
          <span className="tm-msg-time">
            {m.created_at.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
        <span className="tm-msg-text tm-msg-text-muted">（已刪除）</span>
      </div>
    );
  }

  return (
    <div
      className={`tm-msg${mine ? " is-mine" : ""}${mentioned ? " is-mentioned" : ""}${m.pinned ? " is-pinned" : ""}`}
      data-msg-id={m.id}
    >
      <div className="tm-msg-meta">
        <span
          className="tm-msg-author tm-clickable-author"
          onClick={(e) => onAuthorClick(m.author_id, e)}
        >
          {m.author_name || "匿名"}
        </span>
        <span className="tm-msg-time">
          {m.created_at.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
        </span>
        {m.edited_at && <span className="tm-msg-edited">已編輯</span>}
        {m.pinned && <span className="tm-msg-pin-flag" title="已釘選">📌</span>}
      </div>
      {m.kind === "note_share" && m.note_id ? (
        <Link href={`/notes/${m.note_id}`} className="tm-note-card">
          <strong>📎 {m.note_title || "筆記"}</strong>
          <span>{renderMentions(m.text)}</span>
        </Link>
      ) : m.kind === "file" && m.file_url ? (
        <div className="tm-file-msg">
          {(m.file_mime || "").startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={m.file_url}
              alt={m.file_name || "圖片"}
              className="tm-file-msg-img"
              onClick={() => onImageClick(m.file_url!)}
            />
          ) : (
            <a href={m.file_url} target="_blank" rel="noreferrer" className="tm-file-msg-link">
              📎 {m.file_name || "下載檔案"}
            </a>
          )}
        </div>
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
        {REACTION_EMOJIS.slice(0, 4).map((e) => (
          <button key={e} type="button" className="tm-react-btn" onClick={() => onReact(e)} title="表情">
            {e}
          </button>
        ))}
        <div className="tm-emoji-popover-wrap" ref={emojiWrapRef}>
          <button
            type="button"
            className="tm-react-btn"
            title="更多表情"
            onClick={() => onEmojiOpenChange(!emojiOpen)}
          >
            ☺
          </button>
          {emojiOpen && (
            <div className="tm-emoji-popover">
              {REACTION_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  className="tm-react-btn"
                  title="表情"
                  onClick={() => {
                    onReact(e);
                    onEmojiOpenChange(false);
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="doc-cmd" onClick={onReply}>
          回覆{replyCount ? ` (${replyCount})` : ""}
        </button>
        <button type="button" className="doc-cmd" onClick={onTogglePin}>
          {m.pinned ? "取消釘訊息" : "釘訊息"}
        </button>
        <button type="button" className="doc-cmd" onClick={onCopyLink}>
          {copied ? "已複製" : "複製連結"}
        </button>
        {onSaveLater && (
          <button type="button" className="doc-cmd" onClick={onSaveLater}>
            稍後再看
          </button>
        )}
        {onPinNote && (
          <button type="button" className="doc-cmd" onClick={onPinNote}>
            釘選
          </button>
        )}
        {onNoteify && m.kind !== "note_share" && (
          <button type="button" className="doc-cmd" disabled={converting} onClick={onNoteify}>
            {converting ? "轉換中…" : "轉筆記"}
          </button>
        )}
        {mine && (
          <>
            <button type="button" className="doc-cmd" onClick={onEdit}>
              編輯
            </button>
            <button type="button" className="doc-cmd" onClick={onDelete}>
              刪除
            </button>
          </>
        )}
      </div>
    </div>
  );
}
