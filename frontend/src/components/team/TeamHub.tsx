"use client";

/**
 * Slack / Teams inspired Team Hub:
 * Home · Activity · DMs · Later · People
 */

import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { loginWithGoogle } from "@/lib/firebase";
import { askChoice, askPrompt, askConfirm } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import {
  createTeam,
  listenUserTeams,
  listenChannels,
  listenChannelReads,
  listenMembers,
  listenMutedChannels,
  listenNotifications,
  listenActivity,
  markAllNotificationsRead,
  markNotificationRead,
  markAllTeamChannelsRead,
  channelIsUnread,
  openOrCreateDm,
  openOrCreateGroupDm,
  listRecentTeamFiles,
  listenTeamCanvas,
  saveTeamCanvas,
  type TeamMembership,
  type Channel,
  type Member,
  type TeamNotification,
  type TeamActivity,
  type TeamFileHit,
  type TeamCanvas,
} from "@/lib/teamStore";
import {
  getStarredTeamIds,
  toggleStarredTeam,
  getLaterItems,
  removeLaterItem,
  snoozeLaterItem,
  completeLaterItem,
  getHubTab,
  setHubTab,
  getHubSections,
  createHubSection,
  deleteHubSection,
  renameHubSection,
  moveTeamToSection,
  type HubTab,
  type LaterItem,
  type HubSection,
} from "@/lib/teamHubPrefs";
import {
  listLocalDrafts,
  clearLocalDraft,
  getStarredChannelKeys,
  channelStarKey,
  getNotifPrefs,
  setNotifPrefs,
  ensureDesktopNotifPermission,
  getFollowedThreads,
  unfollowThread,
  type DraftItem,
  type NotifPrefs,
  type FollowedThread,
} from "@/lib/teamExtras";
import {
  TeamTasksPanel,
  TeamStandupPanel,
  TeamBookmarksStrip,
  fileHitToNote,
} from "@/components/team/TeamHubWorkPanels";

const ROLE_LABEL: Record<string, string> = {
  owner: "擁有者",
  admin: "管理員",
  member: "成員",
  guest: "訪客",
};

const TABS: { id: HubTab; label: string }[] = [
  { id: "home", label: "首頁" },
  { id: "unreads", label: "未讀" },
  { id: "activity", label: "活動" },
  { id: "dms", label: "私訊" },
  { id: "threads", label: "討論串" },
  { id: "tasks", label: "任務" },
  { id: "standup", label: "Standup" },
  { id: "drafts", label: "草稿" },
  { id: "files", label: "檔案" },
  { id: "later", label: "稍後" },
  { id: "canvas", label: "Canvas" },
  { id: "people", label: "成員" },
];

type HomeFilter = "all" | "unread" | "starred";

type TeamBundle = {
  channels: Channel[];
  members: Member[];
  reads: Record<string, Date>;
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

function formatRelative(d: Date): string {
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "剛剛";
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小時前`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days} 天前`;
  return formatJoined(d);
}

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

function dmPeerLabel(ch: Channel, uid: string, members: Member[]): string {
  const ids = (ch.member_ids || []).filter((x) => x !== uid);
  if (!ids.length) return ch.name || "私人訊息";
  const names = ids.map((id) => {
    const m = members.find((x) => x.uid === id);
    return m?.display_name || id.slice(0, 6);
  });
  return names.join("、") || ch.name || "私人訊息";
}

export default function TeamHub() {
  const { user, loading, displayName } = useAuth();
  const router = useRouter();
  const [teams, setTeams] = useState<TeamMembership[]>([]);
  const [bundles, setBundles] = useState<Record<string, TeamBundle>>({});
  const [mutedByTeam, setMutedByTeam] = useState<Record<string, Record<string, boolean>>>({});
  const [notifications, setNotifications] = useState<TeamNotification[]>([]);
  const [activities, setActivities] = useState<Array<TeamActivity & { teamId: string; teamName: string }>>([]);
  const [tab, setTab] = useState<HubTab>("home");
  const [homeFilter, setHomeFilter] = useState<HomeFilter>("all");
  const [q, setQ] = useState("");
  const [starred, setStarred] = useState<string[]>([]);
  const [starredChannels, setStarredChannels] = useState<string[]>([]);
  const [later, setLater] = useState<LaterItem[]>([]);
  const [sections, setSections] = useState<HubSection[]>([]);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [files, setFiles] = useState<TeamFileHit[]>([]);
  const [filesBusy, setFilesBusy] = useState(false);
  const [followed, setFollowed] = useState<FollowedThread[]>([]);
  const [canvasTeamId, setCanvasTeamId] = useState("");
  const [canvas, setCanvas] = useState<TeamCanvas | null>(null);
  const [canvasTitle, setCanvasTitle] = useState("團隊 Canvas");
  const [canvasBody, setCanvasBody] = useState("");
  const [canvasBusy, setCanvasBusy] = useState(false);
  const [notifPrefs, setNotifPrefsState] = useState<NotifPrefs>(() =>
    typeof window !== "undefined" ? getNotifPrefs() : { desktop: true, sound: true, mode: "mentions" }
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activityFilter, setActivityFilter] = useState<"all" | "mentions" | "feed">("all");
  const [peopleQ, setPeopleQ] = useState("");

  useEffect(() => {
    setStarred(getStarredTeamIds());
    setStarredChannels(getStarredChannelKeys());
    setLater(getLaterItems());
    setSections(getHubSections());
    setTab(getHubTab());
    setDrafts(listLocalDrafts());
    setFollowed(getFollowedThreads());
    setNotifPrefsState(getNotifPrefs());
  }, []);

  useEffect(() => {
    if (teams.length && !canvasTeamId) setCanvasTeamId(teams[0].id);
  }, [teams, canvasTeamId]);

  useEffect(() => {
    if (!canvasTeamId || tab !== "canvas") return;
    return listenTeamCanvas(canvasTeamId, (c) => {
      setCanvas(c);
      setCanvasTitle(c?.title || "團隊 Canvas");
      setCanvasBody(c?.body || "");
    });
  }, [canvasTeamId, tab]);

  useEffect(() => {
    if (!user) {
      setTeams([]);
      return;
    }
    return listenUserTeams(user.uid, setTeams);
  }, [user]);

  useEffect(() => {
    if (!user) {
      setBundles({});
      return;
    }
    const unsubs: Array<() => void> = [];
    const next: Record<string, TeamBundle> = {};
    const touch = (teamId: string, patch: Partial<TeamBundle>) => {
      next[teamId] = {
        channels: next[teamId]?.channels || [],
        members: next[teamId]?.members || [],
        reads: next[teamId]?.reads || {},
        ...patch,
      };
      setBundles({ ...next });
    };
    teams.forEach((t) => {
      unsubs.push(
        listenChannels(
          t.id,
          (chs) => touch(t.id, { channels: chs }),
          user.uid
        )
      );
      unsubs.push(
        listenChannelReads(user.uid, t.id, (reads) => touch(t.id, { reads }))
      );
      unsubs.push(listenMembers(t.id, (members) => touch(t.id, { members })));
      unsubs.push(
        listenMutedChannels(user.uid, t.id, (muted) => {
          setMutedByTeam((prev) => ({ ...prev, [t.id]: muted }));
        })
      );
    });
    return () => unsubs.forEach((u) => u());
  }, [user, teams]);

  useEffect(() => {
    if (tab === "drafts") setDrafts(listLocalDrafts());
  }, [tab]);

  useEffect(() => {
    if (tab !== "files" || !user || teams.length === 0) return;
    let cancelled = false;
    setFilesBusy(true);
    void (async () => {
      const all: TeamFileHit[] = [];
      for (const t of teams.slice(0, 8)) {
        const chs = bundles[t.id]?.channels || [];
        const hits = await listRecentTeamFiles(
          t.id,
          t.name,
          chs.map((c) => c.id),
          20
        );
        hits.forEach((h) => {
          const name = chs.find((c) => c.id === h.channelId)?.name || h.channelName;
          all.push({ ...h, channelName: name });
        });
      }
      if (!cancelled) {
        all.sort((a, b) => b.message.created_at.getTime() - a.message.created_at.getTime());
        setFiles(all.slice(0, 50));
        setFilesBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when switching to files or team list changes
  }, [tab, user, teams]);

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      return;
    }
    return listenNotifications(user.uid, setNotifications, 50);
  }, [user]);

  useEffect(() => {
    if (!user || teams.length === 0) {
      setActivities([]);
      return;
    }
    const map = new Map<string, TeamActivity & { teamId: string; teamName: string }>();
    const unsubs = teams.slice(0, 12).map((t) =>
      listenActivity(
        t.id,
        (items) => {
          items.forEach((a) => {
            map.set(`${t.id}:${a.id}`, { ...a, teamId: t.id, teamName: t.name });
          });
          const list = Array.from(map.values()).sort(
            (a, b) => b.created_at.getTime() - a.created_at.getTime()
          );
          setActivities(list.slice(0, 60));
        },
        20
      )
    );
    return () => unsubs.forEach((u) => u());
  }, [user, teams]);

  const switchTab = (t: HubTab) => {
    setTab(t);
    setHubTab(t);
  };

  const unreadByTeam = useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of teams) {
      const b = bundles[t.id];
      const muted = mutedByTeam[t.id] || {};
      if (!b) {
        out[t.id] = 0;
        continue;
      }
      out[t.id] = b.channels.filter(
        (c) => !muted[c.id] && channelIsUnread(c, b.reads[c.id])
      ).length;
    }
    return out;
  }, [teams, bundles, mutedByTeam]);

  const unreadRows = useMemo(() => {
    if (!user) return [];
    const rows: Array<{
      teamId: string;
      teamName: string;
      channel: Channel;
      label: string;
    }> = [];
    for (const t of teams) {
      const b = bundles[t.id];
      const muted = mutedByTeam[t.id] || {};
      if (!b) continue;
      for (const c of b.channels) {
        if (muted[c.id]) continue;
        if (!channelIsUnread(c, b.reads[c.id])) continue;
        rows.push({
          teamId: t.id,
          teamName: t.name,
          channel: c,
          label: c.dm_key ? dmPeerLabel(c, user.uid, b.members) : `#${c.name}`,
        });
      }
    }
    rows.sort((a, b) => {
      const ta = a.channel.last_message_at?.getTime() || 0;
      const tb = b.channel.last_message_at?.getTime() || 0;
      return tb - ta;
    });
    return rows;
  }, [teams, bundles, mutedByTeam, user]);

  const starredChannelRows = useMemo(() => {
    if (!user) return [];
    const rows: Array<{ teamId: string; teamName: string; channel: Channel; label: string }> = [];
    for (const key of starredChannels) {
      const idx = key.indexOf(":");
      if (idx < 0) continue;
      const teamId = key.slice(0, idx);
      const channelId = key.slice(idx + 1);
      if (!teamId || !channelId) continue;
      const t = teams.find((x) => x.id === teamId);
      const c = bundles[teamId]?.channels.find((x) => x.id === channelId);
      if (!t || !c) continue;
      rows.push({
        teamId,
        teamName: t.name,
        channel: c,
        label: c.dm_key ? dmPeerLabel(c, user.uid, bundles[teamId]?.members || []) : `#${c.name}`,
      });
    }
    return rows;
  }, [starredChannels, teams, bundles, user]);

  const saveCanvas = async () => {
    if (!user || !canvasTeamId) return;
    setCanvasBusy(true);
    try {
      await saveTeamCanvas(canvasTeamId, user.uid, { title: canvasTitle, body: canvasBody });
      toast("Canvas 已儲存");
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存 Canvas 失敗");
    } finally {
      setCanvasBusy(false);
    }
  };

  const unreadTotal = useMemo(
    () => Object.values(unreadByTeam).reduce((a, b) => a + b, 0),
    [unreadByTeam]
  );

  const mentionUnread = useMemo(
    () =>
      notifications.filter(
        (n) => (n.type === "mention" || n.type === "invite") && !n.read
      ).length,
    [notifications]
  );

  const dmRows = useMemo(() => {
    if (!user) return [];
    const rows: Array<{
      teamId: string;
      teamName: string;
      channel: Channel;
      label: string;
      unread: boolean;
    }> = [];
    for (const t of teams) {
      const b = bundles[t.id];
      if (!b) continue;
      for (const c of b.channels) {
        if (!c.dm_key) continue;
        rows.push({
          teamId: t.id,
          teamName: t.name,
          channel: c,
          label: dmPeerLabel(c, user.uid, b.members),
          unread: channelIsUnread(c, b.reads[c.id]),
        });
      }
    }
    rows.sort((a, b) => {
      const ta = a.channel.last_message_at?.getTime() || a.channel.created_at.getTime();
      const tb = b.channel.last_message_at?.getTime() || b.channel.created_at.getTime();
      return tb - ta;
    });
    return rows;
  }, [teams, bundles, user]);

  const peopleRows = useMemo(() => {
    if (!user) return [];
    const map = new Map<
      string,
      {
        uid: string;
        name: string;
        photo?: string;
        status?: string;
        teams: Array<{ id: string; name: string; role: string }>;
      }
    >();
    for (const t of teams) {
      const b = bundles[t.id];
      if (!b) continue;
      for (const m of b.members) {
        if (m.uid === user.uid) continue;
        const cur = map.get(m.uid) || {
          uid: m.uid,
          name: m.display_name || m.uid.slice(0, 8),
          photo: m.photo_url,
          status: m.status,
          teams: [],
        };
        cur.teams.push({ id: t.id, name: t.name, role: m.role });
        if (m.display_name) cur.name = m.display_name;
        if (m.photo_url) cur.photo = m.photo_url;
        if (m.status) cur.status = m.status;
        map.set(m.uid, cur);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
  }, [teams, bundles, user]);

  const filteredTeams = useMemo(() => {
    let list = [...teams];
    if (homeFilter === "starred") list = list.filter((t) => starred.includes(t.id));
    if (homeFilter === "unread") list = list.filter((t) => (unreadByTeam[t.id] || 0) > 0);
    const qq = q.trim().toLowerCase();
    if (qq) {
      list = list.filter((t) => {
        if (t.name.toLowerCase().includes(qq)) return true;
        const chs = bundles[t.id]?.channels || [];
        return chs.some((c) => c.name.toLowerCase().includes(qq));
      });
    }
    list.sort((a, b) => {
      const sa = starred.includes(a.id) ? 1 : 0;
      const sb = starred.includes(b.id) ? 1 : 0;
      if (sa !== sb) return sb - sa;
      const ua = unreadByTeam[a.id] || 0;
      const ub = unreadByTeam[b.id] || 0;
      if (ua !== ub) return ub - ua;
      return b.joined_at.getTime() - a.joined_at.getTime();
    });
    return list;
  }, [teams, homeFilter, starred, unreadByTeam, q, bundles]);

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

  const quickCreate = async () => {
    const pick = await askChoice({
      title: "建立",
      message: "要做什麼？",
      options: [
        { id: "team", label: "新增團隊", primary: true },
        { id: "join", label: "加入團隊（邀請連結）" },
        { id: "open", label: "開啟最近的團隊" },
      ],
    });
    if (!pick) return;
    if (pick.choice === "team") void create();
    else if (pick.choice === "join") void join();
    else if (pick.choice === "open" && teams[0]) router.push(`/team/${teams[0].id}`);
  };

  const toggleStar = (teamId: string, e?: ReactMouseEvent) => {
    e?.stopPropagation();
    setStarred(toggleStarredTeam(teamId));
  };

  const addSection = async () => {
    const name = await askPrompt({ title: "新增分區", defaultValue: "專案", message: "像 Teams 一樣把團隊分組。" });
    if (name == null) return;
    setSections(createHubSection(name));
  };

  const renameSection = async (sec: HubSection) => {
    const name = await askPrompt({ title: "重新命名分區", defaultValue: sec.name });
    if (name == null) return;
    setSections(renameHubSection(sec.id, name));
  };

  const removeSection = async (sec: HubSection) => {
    const ok = await askConfirm({
      title: "刪除分區",
      message: `刪除「${sec.name}」？團隊會回到未分組。`,
    });
    if (!ok) return;
    setSections(deleteHubSection(sec.id));
  };

  const assignSection = async (teamId: string) => {
    const opts = [
      { id: "__none__", label: "未分組", primary: true as const },
      ...sections.map((s) => ({ id: s.id, label: s.name })),
      { id: "__new__", label: "＋ 新增分區…" },
    ];
    const pick = await askChoice({
      title: "移到分區",
      message: "選擇要放入的分區",
      options: opts,
    });
    if (!pick) return;
    if (pick.choice === "__new__") {
      const name = await askPrompt({ title: "新增分區", defaultValue: "專案" });
      if (name == null) return;
      const next = createHubSection(name);
      const created = next[next.length - 1];
      setSections(moveTeamToSection(teamId, created?.id || null));
      return;
    }
    setSections(moveTeamToSection(teamId, pick.choice === "__none__" ? null : pick.choice));
  };

  const homeGroups = useMemo(() => {
    const byId = new Map(filteredTeams.map((t) => [t.id, t]));
    const assigned = new Set<string>();
    type Group = { key: string; title: string; section?: HubSection; teams: TeamMembership[] };
    const groups: Group[] = [];

    if (!sections.length) {
      return [{ key: "__all__", title: "我的團隊", teams: filteredTeams }] satisfies Group[];
    }

    for (const sec of sections) {
      const teamsIn = sec.teamIds
        .map((id) => byId.get(id))
        .filter((t): t is TeamMembership => !!t);
      teamsIn.forEach((t) => assigned.add(t.id));
      if (teamsIn.length > 0 || (homeFilter === "all" && !q.trim())) {
        groups.push({ key: sec.id, title: sec.name, section: sec, teams: teamsIn });
      }
    }

    const ungrouped = filteredTeams.filter((t) => !assigned.has(t.id));
    if (ungrouped.length > 0) {
      groups.push({ key: "__ungrouped__", title: "未分組", teams: ungrouped });
    }
    return groups;
  }, [filteredTeams, sections, homeFilter, q]);

  const openTeam = (teamId: string, channelId?: string) => {
    const qs = channelId ? `?channel=${encodeURIComponent(channelId)}` : "";
    router.push(`/team/${teamId}${qs}`);
  };

  const openNotification = async (n: TeamNotification) => {
    if (!user) return;
    await markNotificationRead(user.uid, n.id);
    const params = new URLSearchParams();
    if (n.channel_id) params.set("channel", n.channel_id);
    if (n.message_id) params.set("msg", n.message_id);
    const qs = params.toString();
    router.push(`/team/${n.team_id}${qs ? `?${qs}` : ""}`);
  };

  const markAllRead = async () => {
    if (!user) return;
    await markAllNotificationsRead(user.uid, notifications);
    toast("已全部標為已讀");
  };

  const markAllChannelsRead = async () => {
    if (!user) return;
    let n = 0;
    for (const t of teams) {
      const b = bundles[t.id];
      if (!b) continue;
      n += await markAllTeamChannelsRead(
        user.uid,
        t.id,
        b.channels,
        b.reads,
        mutedByTeam[t.id]
      );
    }
    toast(n ? `已標示 ${n} 個頻道為已讀` : "沒有未讀頻道");
  };

  const configureNotifs = async () => {
    const pick = await askChoice({
      title: "通知設定",
      message: "桌面通知與提醒音效（瀏覽器需允許通知權限）",
      options: [
        { id: "mentions", label: "僅提及／邀請（建議）", primary: true },
        { id: "all", label: "提及（較積極）" },
        { id: "off", label: "關閉桌面通知" },
        { id: "perm", label: "請求瀏覽器通知權限" },
      ],
    });
    if (!pick) return;
    if (pick.choice === "perm") {
      const ok = await ensureDesktopNotifPermission();
      toast(ok ? "已允許桌面通知" : "瀏覽器未允許通知");
      return;
    }
    const next = setNotifPrefs({
      mode: pick.choice as NotifPrefs["mode"],
      desktop: pick.choice !== "off",
    });
    setNotifPrefsState(next);
    toast("通知設定已更新");
  };

  const startDm = useCallback(
    async (teamId: string, peerUid: string) => {
      if (!user) return;
      const members = bundles[teamId]?.members || [];
      const me =
        members.find((m) => m.uid === user.uid) || {
          uid: user.uid,
          role: "member" as const,
          joined_at: new Date(),
          display_name: displayName || undefined,
        };
      const other = members.find((m) => m.uid === peerUid);
      if (!other) {
        setError("找不到成員資料，請稍後再試。");
        return;
      }
      try {
        const chId = await openOrCreateDm(teamId, me, other);
        openTeam(teamId, chId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "無法開啟私訊");
      }
    },
    [user, bundles, displayName]
  );

  const startGroupDm = async (teamId: string) => {
    if (!user) return;
    const members = (bundles[teamId]?.members || []).filter((m) => m.uid !== user.uid);
    if (members.length < 2) {
      setError("群組私訊需要至少兩位其他成員");
      return;
    }
    const pick = await askChoice({
      title: "選擇群組成員（第一位）",
      message: "稍後可再選第二位。至少選兩人。",
      options: members.map((m) => ({
        id: m.uid,
        label: m.display_name || m.uid.slice(0, 8),
      })),
    });
    if (!pick) return;
    const rest = members.filter((m) => m.uid !== pick.choice);
    const pick2 = await askChoice({
      title: "再選一位成員",
      options: rest.map((m) => ({
        id: m.uid,
        label: m.display_name || m.uid.slice(0, 8),
        primary: true,
      })),
    });
    if (!pick2) return;
    const me =
      members.find((m) => m.uid === user.uid) ||
      bundles[teamId]?.members.find((m) => m.uid === user.uid) || {
        uid: user.uid,
        role: "member" as const,
        joined_at: new Date(),
        display_name: displayName || undefined,
      };
    // me might not be in filtered members - get from full list
    const all = bundles[teamId]?.members || [];
    const meFull = all.find((m) => m.uid === user.uid) || me;
    const others = [pick.choice, pick2.choice]
      .map((uid) => all.find((m) => m.uid === uid))
      .filter(Boolean) as Member[];
    try {
      const chId = await openOrCreateGroupDm(teamId, meFull, others);
      openTeam(teamId, chId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "無法建立群組私訊");
    }
  };

  if (loading) {
    return null;
  }

  if (!user) {
    return (
      <div className="tm-page tm-guest">
        <div className="tm-page-glow" aria-hidden />
        <TeamMark />
        <h1 className="page-title font-display">團隊</h1>
        <p className="page-sub">登入後使用類 Slack 的協作空間：頻道、私訊、活動與稍後再看。</p>
        <button type="button" className="btn" onClick={() => loginWithGoogle()}>
          登入
        </button>
      </div>
    );
  }

  const activityItems = (() => {
    type FeedRow =
      | { kind: "notif"; n: TeamNotification }
      | { kind: "feed"; a: TeamActivity & { teamId: string; teamName: string } };

    if (activityFilter === "mentions") {
      return notifications
        .filter((n) => n.type === "mention")
        .map((n): FeedRow => ({ kind: "notif", n }));
    }
    if (activityFilter === "feed") {
      return activities.map((a): FeedRow => ({ kind: "feed", a }));
    }
    const merged: Array<FeedRow & { at: number }> = [
      ...notifications.map((n) => ({
        kind: "notif" as const,
        n,
        at: n.created_at.getTime(),
      })),
      ...activities.map((a) => ({
        kind: "feed" as const,
        a,
        at: a.created_at.getTime(),
      })),
    ];
    return merged
      .sort((x, y) => y.at - x.at)
      .slice(0, 80)
      .map(({ kind, ...rest }): FeedRow =>
        kind === "notif"
          ? { kind, n: (rest as { n: TeamNotification }).n }
          : { kind, a: (rest as { a: TeamActivity & { teamId: string; teamName: string } }).a }
      );
  })();

  return (
    <div className="tm-hub">
      <div className="tm-page-glow" aria-hidden />

      <header className="tm-hub-head">
        <div className="tm-hub-head-text">
          <h1 className="page-title font-display">團隊</h1>
          <p className="page-sub">頻道、私訊、提及與稍後再看 — 一個總覽搞定。</p>
        </div>
        <div className="tm-page-actions">
          <button type="button" className="btn btn-ghost" onClick={() => void configureNotifs()}>
            通知
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void join()}>
            加入
          </button>
          <button type="button" className="btn btn-soft" disabled={busy} onClick={() => void quickCreate()}>
            ＋ 建立
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void create()}>
            {busy ? "建立中…" : "新增團隊"}
          </button>
        </div>
      </header>

      <div className="tm-hub-stats">
        <span>{teams.length} 個團隊</span>
        <span className={unreadTotal ? "tm-stat-unread" : "tm-stat-muted"}>
          {unreadTotal ? `${unreadTotal} 個未讀頻道` : "頻道皆已讀"}
        </span>
        <span className={mentionUnread ? "tm-stat-unread" : "tm-stat-muted"}>
          {mentionUnread ? `${mentionUnread} 則提及` : "無新提及"}
        </span>
        <span className="tm-stat-muted">{later.length} 則稍後</span>
      </div>

      <nav className="tm-hub-tabs" aria-label="團隊總覽">
        {TABS.map((t) => {
          let badge = 0;
          if (t.id === "activity") badge = mentionUnread;
          if (t.id === "dms") badge = dmRows.filter((r) => r.unread).length;
          if (t.id === "later") badge = later.filter((x) => !x.done).length;
          if (t.id === "home" || t.id === "unreads") badge = unreadTotal;
          if (t.id === "drafts") badge = drafts.length || (tab === "drafts" ? 0 : listLocalDrafts().length);
          if (t.id === "threads") badge = followed.length;
          return (
            <button
              key={t.id}
              type="button"
              className={`tm-hub-tab${tab === t.id ? " is-on" : ""}`}
              onClick={() => switchTab(t.id)}
            >
              {t.label}
              {badge > 0 ? <span className="tm-hub-tab-badge">{badge > 99 ? "99+" : badge}</span> : null}
            </button>
          );
        })}
      </nav>

      {error && <p className="note-aside-error">{error}</p>}

      {tab === "unreads" && (
        <section className="tm-hub-panel">
          <div className="tm-hub-toolbar">
            <p className="tm-hub-empty-hint" style={{ padding: 0, margin: 0, textAlign: "left" }}>
              跨團隊未讀頻道（已排除靜音）
            </p>
            <button type="button" className="btn btn-sm btn-soft" onClick={() => void markAllChannelsRead()}>
              全部標為已讀
            </button>
          </div>
          {unreadRows.length === 0 ? (
            <p className="tm-hub-empty-hint">太棒了，目前沒有未讀。</p>
          ) : (
            <ul className="tm-hub-feed">
              {unreadRows.map((r) => (
                <li key={`${r.teamId}-${r.channel.id}`}>
                  <button
                    type="button"
                    className="tm-hub-feed-item is-unread"
                    onClick={() => openTeam(r.teamId, r.channel.id)}
                  >
                    <span className="tm-hub-feed-kind">未讀</span>
                    <span className="tm-hub-feed-body">
                      <strong>{r.label}</strong>
                      <span className="tm-hub-feed-meta">{r.teamName}</span>
                      <span className="tm-hub-feed-text">
                        {r.channel.last_message_preview || "有新訊息"}
                      </span>
                    </span>
                    <span className="tm-hub-feed-time">
                      {r.channel.last_message_at
                        ? formatRelative(r.channel.last_message_at)
                        : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "home" && (
        <section className="tm-hub-panel">
          <div className="tm-hub-toolbar">
            <input
              className="tm-hub-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜尋團隊或頻道…"
              aria-label="搜尋團隊或頻道"
            />
            <div className="tm-hub-filters">
              {(
                [
                  ["all", "全部"],
                  ["unread", "未讀"],
                  ["starred", "收藏"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`tm-hub-chip${homeFilter === id ? " is-on" : ""}`}
                  onClick={() => setHomeFilter(id)}
                >
                  {label}
                </button>
              ))}
              <button type="button" className="tm-hub-chip" onClick={() => void addSection()}>
                ＋ 分區
              </button>
            </div>
          </div>

          {teams.length === 0 ? (
            <div className="tm-empty">
              <TeamMark />
              <h2 className="tm-empty-title">還沒有任何團隊</h2>
              <p>建立空間並邀請夥伴，或貼上邀請連結加入。</p>
              <div className="tm-empty-actions">
                <button type="button" className="btn" disabled={busy} onClick={() => void create()}>
                  建立第一個團隊
                </button>
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void join()}>
                  貼上邀請連結
                </button>
              </div>
            </div>
          ) : filteredTeams.length === 0 ? (
            <p className="tm-hub-empty-hint">沒有符合篩選的團隊。</p>
          ) : (
            <div className="tm-hub-team-list">
              <TeamBookmarksStrip
                onOpen={(b) => {
                  const params = new URLSearchParams({
                    channel: b.channelId,
                    msg: b.messageId,
                  });
                  router.push(`/team/${b.teamId}?${params}`);
                }}
              />
              {starredChannelRows.length > 0 && homeFilter !== "unread" && (
                <div className="tm-hub-section">
                  <div className="tm-hub-section-head">
                    <h3 className="tm-hub-section-title">星標頻道</h3>
                  </div>
                  <ul className="tm-hub-feed">
                    {starredChannelRows.map((r) => (
                      <li key={channelStarKey(r.teamId, r.channel.id)}>
                        <button
                          type="button"
                          className="tm-hub-feed-item"
                          onClick={() => openTeam(r.teamId, r.channel.id)}
                        >
                          <span className="tm-hub-feed-kind">★</span>
                          <span className="tm-hub-feed-body">
                            <strong>{r.label}</strong>
                            <span className="tm-hub-feed-meta">{r.teamName}</span>
                            <span className="tm-hub-feed-text">
                              {r.channel.last_message_preview || "尚無訊息"}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {homeGroups.map((group) => (
                <div key={group.key} className="tm-hub-section">
                  <div className="tm-hub-section-head">
                    <h3 className="tm-hub-section-title">{group.title}</h3>
                    {group.section ? (
                      <div className="tm-hub-section-actions">
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => void renameSection(group.section!)}
                        >
                          重新命名
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => void removeSection(group.section!)}
                        >
                          刪除分區
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {group.teams.length === 0 ? (
                    <p className="tm-hub-channel-empty">此分區尚無團隊 — 在團隊上按「分區」移入。</p>
                  ) : (
                    group.teams.map((t) => {
                      const b = bundles[t.id] || { channels: [], members: [], reads: {} };
                      const unread = unreadByTeam[t.id] || 0;
                      const isStar = starred.includes(t.id);
                      const isOpen = !!expanded[t.id];
                      const publicChs = b.channels.filter((c) => !c.dm_key);
                      const lastCh = [...publicChs]
                        .filter((c) => c.last_message_at)
                        .sort(
                          (a, c) =>
                            (c.last_message_at?.getTime() || 0) -
                            (a.last_message_at?.getTime() || 0)
                        )[0];
                      return (
                        <article key={t.id} className={`tm-hub-team${unread ? " has-unread" : ""}`}>
                          <div className="tm-hub-team-row">
                            <button
                              type="button"
                              className="tm-hub-team-main"
                              onClick={() => openTeam(t.id)}
                            >
                              <span className="tm-team-avatar" data-role={t.role}>
                                {teamInitial(t.name)}
                              </span>
                              <span className="tm-hub-team-info">
                                <span className="tm-hub-team-name">
                                  {t.name}
                                  {unread > 0 ? (
                                    <span className="tm-unread-badge">
                                      {unread > 99 ? "99+" : unread}
                                    </span>
                                  ) : null}
                                </span>
                                <span className="tm-hub-team-sub">
                                  <span className={`tm-role-chip is-${t.role}`}>
                                    {ROLE_LABEL[t.role] || t.role}
                                  </span>
                                  <span>{b.members.length || "…"} 位成員</span>
                                  <span>{publicChs.length} 個頻道</span>
                                  {lastCh?.last_message_preview ? (
                                    <span className="tm-hub-preview">
                                      #{lastCh.name} · {lastCh.last_message_preview}
                                    </span>
                                  ) : (
                                    <span>加入於 {formatJoined(t.joined_at)}</span>
                                  )}
                                </span>
                              </span>
                            </button>
                            <div className="tm-hub-team-actions">
                              <button
                                type="button"
                                className="tm-hub-icon-btn"
                                title="移到分區"
                                aria-label="移到分區"
                                onClick={() => void assignSection(t.id)}
                              >
                                ⊞
                              </button>
                              <button
                                type="button"
                                className={`tm-hub-icon-btn${isStar ? " is-on" : ""}`}
                                title={isStar ? "取消收藏" : "收藏"}
                                aria-label={isStar ? "取消收藏" : "收藏"}
                                onClick={(e) => toggleStar(t.id, e)}
                              >
                                {isStar ? "★" : "☆"}
                              </button>
                              <button
                                type="button"
                                className="tm-hub-icon-btn"
                                title={isOpen ? "收合頻道" : "展開頻道"}
                                aria-expanded={isOpen}
                                onClick={() =>
                                  setExpanded((prev) => ({ ...prev, [t.id]: !prev[t.id] }))
                                }
                              >
                                {isOpen ? "▴" : "▾"}
                              </button>
                            </div>
                          </div>
                          {isOpen && (
                            <ul className="tm-hub-channel-list">
                              {publicChs.length === 0 ? (
                                <li className="tm-hub-channel-empty">尚無頻道</li>
                              ) : (
                                publicChs.map((c) => {
                                  const u = channelIsUnread(c, b.reads[c.id]);
                                  return (
                                    <li key={c.id}>
                                      <button
                                        type="button"
                                        className={`tm-hub-channel${u ? " is-unread" : ""}`}
                                        onClick={() => openTeam(t.id, c.id)}
                                      >
                                        <span className="tm-hub-channel-hash">
                                          {c.is_private ? "🔒" : "#"}
                                        </span>
                                        <span className="tm-hub-channel-name">{c.name}</span>
                                        {c.last_message_preview ? (
                                          <span className="tm-hub-channel-preview">
                                            {c.last_message_preview}
                                          </span>
                                        ) : null}
                                        {c.last_message_at ? (
                                          <span className="tm-hub-channel-time">
                                            {formatRelative(c.last_message_at)}
                                          </span>
                                        ) : null}
                                        {u ? <span className="tm-unread-dot" /> : null}
                                      </button>
                                    </li>
                                  );
                                })
                              )}
                            </ul>
                          )}
                        </article>
                      );
                    })
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "activity" && (
        <section className="tm-hub-panel">
          <div className="tm-hub-toolbar">
            <div className="tm-hub-filters">
              {(
                [
                  ["all", "全部"],
                  ["mentions", "@ 提及"],
                  ["feed", "團隊動態"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`tm-hub-chip${activityFilter === id ? " is-on" : ""}`}
                  onClick={() => setActivityFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void markAllRead()}>
              全部標為已讀
            </button>
          </div>
          {activityItems.length === 0 ? (
            <p className="tm-hub-empty-hint">目前沒有活動。有人 @ 你或團隊有新動態時會出現在這裡。</p>
          ) : (
            <ul className="tm-hub-feed">
              {activityItems.map((item, i) => {
                if (item.kind === "notif" && item.n) {
                  const n = item.n;
                  const teamName = teams.find((t) => t.id === n.team_id)?.name || "團隊";
                  return (
                    <li key={`n-${n.id}`}>
                      <button
                        type="button"
                        className={`tm-hub-feed-item${n.read ? "" : " is-unread"}`}
                        onClick={() => void openNotification(n)}
                      >
                        <span className="tm-hub-feed-kind">
                          {n.type === "mention" ? "@ 提及" : n.type === "invite" ? "邀請" : "通知"}
                        </span>
                        <span className="tm-hub-feed-body">
                          <strong>{n.from_name || "有人"}</strong> · {teamName}
                          <span className="tm-hub-feed-text">{n.text}</span>
                        </span>
                        <span className="tm-hub-feed-time">{formatRelative(n.created_at)}</span>
                      </button>
                    </li>
                  );
                }
                if (item.kind === "feed" && item.a) {
                  const a = item.a;
                  return (
                    <li key={`a-${a.teamId}-${a.id}-${i}`}>
                      <button
                        type="button"
                        className="tm-hub-feed-item"
                        onClick={() => openTeam(a.teamId, a.channel_id)}
                      >
                        <span className="tm-hub-feed-kind">動態</span>
                        <span className="tm-hub-feed-body">
                          <strong>{a.teamName}</strong>
                          <span className="tm-hub-feed-text">
                            {a.actor_name ? `${a.actor_name} · ` : ""}
                            {a.text}
                          </span>
                        </span>
                        <span className="tm-hub-feed-time">{formatRelative(a.created_at)}</span>
                      </button>
                    </li>
                  );
                }
                return null;
              })}
            </ul>
          )}
        </section>
      )}

      {tab === "dms" && (
        <section className="tm-hub-panel">
          {dmRows.length === 0 ? (
            <div className="tm-empty">
              <h2 className="tm-empty-title">尚無私人訊息</h2>
              <p>在「成員」分頁點選夥伴，或進入團隊後建立群組私訊。</p>
              <button type="button" className="btn btn-ghost" onClick={() => switchTab("people")}>
                查看成員
              </button>
            </div>
          ) : (
            <ul className="tm-hub-feed">
              {dmRows.map((r) => (
                <li key={`${r.teamId}-${r.channel.id}`}>
                  <button
                    type="button"
                    className={`tm-hub-feed-item${r.unread ? " is-unread" : ""}`}
                    onClick={() => openTeam(r.teamId, r.channel.id)}
                  >
                    <span className="tm-team-avatar tm-hub-dm-avatar">
                      {teamInitial(r.label)}
                    </span>
                    <span className="tm-hub-feed-body">
                      <strong>{r.label}</strong>
                      <span className="tm-hub-feed-meta">
                        {r.teamName}
                        {r.channel.dm_key?.startsWith("dm:group:") ? " · 群組" : ""}
                      </span>
                      <span className="tm-hub-feed-text">
                        {r.channel.last_message_preview || "尚無訊息"}
                      </span>
                    </span>
                    <span className="tm-hub-feed-time">
                      {r.channel.last_message_at
                        ? formatRelative(r.channel.last_message_at)
                        : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "threads" && (
        <section className="tm-hub-panel">
          {followed.length === 0 ? (
            <div className="tm-empty">
              <h2 className="tm-empty-title">尚未追蹤討論串</h2>
              <p>在訊息上按「追蹤討論串」，回覆會集中在這裡（類似 Slack Threads）。</p>
            </div>
          ) : (
            <ul className="tm-hub-feed">
              {followed.map((item) => (
                <li key={item.id}>
                  <div className="tm-hub-feed-item tm-hub-later-item">
                    <button
                      type="button"
                      className="tm-hub-later-main"
                      onClick={() => {
                        const params = new URLSearchParams({
                          channel: item.channelId,
                          msg: item.messageId,
                        });
                        router.push(`/team/${item.teamId}?${params}`);
                      }}
                    >
                      <span className="tm-hub-feed-body">
                        <strong>
                          {item.teamName} · #{item.channelName}
                        </strong>
                        <span className="tm-hub-feed-meta">{item.authorName || "討論串"}</span>
                        <span className="tm-hub-feed-text">{item.preview}</span>
                      </span>
                      <span className="tm-hub-feed-time">
                        {formatRelative(new Date(item.followedAt))}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => setFollowed(unfollowThread(item.id))}
                    >
                      取消追蹤
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "tasks" && user && (
        <TeamTasksPanel teams={teams} uid={user.uid} displayName={displayName || undefined} />
      )}

      {tab === "standup" && user && (
        <TeamStandupPanel teams={teams} uid={user.uid} displayName={displayName || undefined} />
      )}

      {tab === "drafts" && (
        <section className="tm-hub-panel">
          <div className="tm-hub-toolbar">
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setDrafts(listLocalDrafts())}
            >
              重新整理
            </button>
          </div>
          {drafts.length === 0 ? (
            <p className="tm-hub-empty-hint">沒有未送出的草稿。在頻道輸入框打字會自動暫存。</p>
          ) : (
            <ul className="tm-hub-feed">
              {drafts.map((d) => {
                const teamName = teams.find((t) => t.id === d.teamId)?.name || "團隊";
                const chName =
                  bundles[d.teamId]?.channels.find((c) => c.id === d.channelId)?.name || "頻道";
                return (
                  <li key={d.key}>
                    <div className="tm-hub-feed-item tm-hub-later-item">
                      <button
                        type="button"
                        className="tm-hub-later-main"
                        onClick={() => openTeam(d.teamId, d.channelId)}
                      >
                        <span className="tm-hub-feed-body">
                          <strong>
                            {teamName} · #{chName}
                          </strong>
                          <span className="tm-hub-feed-text">{d.text}</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => {
                          clearLocalDraft(d.teamId, d.channelId);
                          setDrafts(listLocalDrafts());
                        }}
                      >
                        刪除
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {tab === "files" && (
        <section className="tm-hub-panel">
          {filesBusy ? (
            <p className="tm-hub-empty-hint">載入檔案中…</p>
          ) : files.length === 0 ? (
            <p className="tm-hub-empty-hint">尚無近期分享的檔案。在頻道中上傳檔案後會出現在這裡。</p>
          ) : (
            <ul className="tm-hub-feed">
              {files.map((f) => (
                <li key={`${f.teamId}-${f.channelId}-${f.message.id}`}>
                  <div className="tm-hub-feed-item tm-hub-later-item">
                    <button
                      type="button"
                      className="tm-hub-later-main"
                      onClick={() => {
                        const params = new URLSearchParams({
                          channel: f.channelId,
                          msg: f.message.id,
                        });
                        router.push(`/team/${f.teamId}?${params}`);
                      }}
                    >
                      <span className="tm-hub-feed-kind">檔案</span>
                      <span className="tm-hub-feed-body">
                        <strong>{f.message.file_name || f.message.text || "檔案"}</strong>
                        <span className="tm-hub-feed-meta">
                          {f.teamName} · #{f.channelName} · {f.message.author_name || ""}
                        </span>
                      </span>
                      <span className="tm-hub-feed-time">
                        {formatRelative(f.message.created_at)}
                      </span>
                    </button>
                    {user && (
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() =>
                          void fileHitToNote(user.uid, f).then((noteId) => {
                            toast("已轉成筆記");
                            router.push(`/notes/${noteId}`);
                          })
                        }
                      >
                        轉筆記
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "later" && (
        <section className="tm-hub-panel">
          {later.length === 0 ? (
            <div className="tm-empty">
              <h2 className="tm-empty-title">稍後再看是空的</h2>
              <p>在訊息上按「稍後再看」，把待辦對話收集到這裡（類似 Slack Later）。</p>
            </div>
          ) : (
            <ul className="tm-hub-feed">
              {later.map((item) => (
                <li key={item.id}>
                  <div className={`tm-hub-feed-item tm-hub-later-item${item.done ? " is-done" : ""}`}>
                    <button
                      type="button"
                      className="tm-hub-later-main"
                      onClick={() => {
                        const params = new URLSearchParams({
                          channel: item.channelId,
                          msg: item.messageId,
                        });
                        router.push(`/team/${item.teamId}?${params}`);
                      }}
                    >
                      <span className="tm-hub-feed-body">
                        <strong>
                          {item.done ? "✓ " : ""}
                          {item.teamName} · #{item.channelName}
                        </strong>
                        <span className="tm-hub-feed-meta">
                          {item.authorName || "訊息"}
                          {item.remindAt
                            ? ` · 提醒 ${formatRelative(new Date(item.remindAt))}`
                            : ""}
                        </span>
                        <span className="tm-hub-feed-text">{item.text}</span>
                      </span>
                      <span className="tm-hub-feed-time">
                        {formatRelative(new Date(item.savedAt))}
                      </span>
                    </button>
                    <div className="tm-hub-later-actions">
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => setLater(completeLaterItem(item.id, !item.done))}
                      >
                        {item.done ? "復原" : "完成"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => {
                          setLater(snoozeLaterItem(item.id, 60 * 60 * 1000));
                          toast("一小時後提醒");
                        }}
                      >
                        稍後 1h
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => setLater(removeLaterItem(item.id))}
                      >
                        移除
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "canvas" && (
        <section className="tm-hub-panel">
          {teams.length === 0 ? (
            <p className="tm-hub-empty-hint">先建立或加入團隊，再使用共享 Canvas。</p>
          ) : (
            <>
              <div className="tm-hub-toolbar">
                <select
                  className="tm-hub-search"
                  value={canvasTeamId}
                  onChange={(e) => setCanvasTeamId(e.target.value)}
                  aria-label="選擇團隊 Canvas"
                >
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={canvasBusy || !canvasTeamId}
                  onClick={() => void saveCanvas()}
                >
                  {canvasBusy ? "儲存中…" : "儲存 Canvas"}
                </button>
              </div>
              <input
                className="tm-hub-search"
                style={{ maxWidth: "100%", marginBottom: "0.65rem" }}
                value={canvasTitle}
                onChange={(e) => setCanvasTitle(e.target.value)}
                placeholder="Canvas 標題"
              />
              <textarea
                className="tm-canvas-editor"
                value={canvasBody}
                onChange={(e) => setCanvasBody(e.target.value)}
                placeholder="團隊共用筆記／規範／決策記錄（類似 Slack Canvas）…"
                rows={16}
              />
              {canvas?.updated_at ? (
                <p className="tm-hub-feed-meta" style={{ marginTop: "0.5rem" }}>
                  上次更新 {formatRelative(canvas.updated_at)}
                  {canvas.updated_by ? ` · ${canvas.updated_by.slice(0, 8)}` : ""}
                </p>
              ) : null}
            </>
          )}
        </section>
      )}

      {tab === "people" && (
        <section className="tm-hub-panel">
          <div className="tm-hub-toolbar">
            <input
              className="tm-hub-search"
              value={peopleQ}
              onChange={(e) => setPeopleQ(e.target.value)}
              placeholder="搜尋成員…"
              aria-label="搜尋成員"
            />
            {teams[0] && (
              <button
                type="button"
                className="btn btn-sm btn-soft"
                onClick={() => void startGroupDm(teams[0].id)}
              >
                群組私訊
              </button>
            )}
          </div>
          {peopleRows.filter((p) =>
            !peopleQ.trim() ||
            p.name.toLowerCase().includes(peopleQ.trim().toLowerCase()) ||
            p.teams.some((t) => t.name.toLowerCase().includes(peopleQ.trim().toLowerCase()))
          ).length === 0 ? (
            <p className="tm-hub-empty-hint">尚無可顯示的成員。邀請夥伴加入團隊後會出現在這裡。</p>
          ) : (
            <ul className="tm-hub-people">
              {peopleRows
                .filter(
                  (p) =>
                    !peopleQ.trim() ||
                    p.name.toLowerCase().includes(peopleQ.trim().toLowerCase()) ||
                    p.teams.some((t) =>
                      t.name.toLowerCase().includes(peopleQ.trim().toLowerCase())
                    )
                )
                .map((p) => (
                  <li key={p.uid} className="tm-hub-person">
                    <span className="tm-team-avatar">{teamInitial(p.name)}</span>
                    <span className="tm-hub-person-info">
                      <strong>{p.name}</strong>
                      {p.status ? <span className="tm-hub-status">{p.status}</span> : null}
                      <span className="tm-hub-feed-meta">
                        {p.teams.map((t) => t.name).join(" · ")}
                      </span>
                    </span>
                    <div className="tm-hub-person-actions">
                      {p.teams.slice(0, 2).map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => void startDm(t.id, p.uid)}
                        >
                          私訊 · {t.name}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
