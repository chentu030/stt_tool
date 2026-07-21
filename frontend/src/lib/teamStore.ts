/**
 * Cadence Team Space — teams, channels, messages, invites, pins, unread.
 */

import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit as fsLimit,
  Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export type TeamRole = "owner" | "admin" | "member" | "guest";

export type Team = {
  id: string;
  name: string;
  slug: string;
  created_by: string;
  created_at: Date;
};

export type Member = {
  uid: string;
  role: TeamRole;
  joined_at: Date;
  display_name?: string;
  photo_url?: string;
  /** Slack-style custom status, e.g. "會議中" */
  status?: string;
};

export type Channel = {
  id: string;
  name: string;
  topic?: string;
  is_private: boolean;
  /** For private channels: uids allowed (always includes creator). */
  member_ids?: string[];
  /** Stable key for 1:1 DMs: dm:uidA_uidB */
  dm_key?: string;
  created_by: string;
  created_at: Date;
  last_message_at?: Date;
  last_message_preview?: string;
};

export type MessageKind = "text" | "note_share" | "file" | "poll";

export type PollOption = {
  id: string;
  text: string;
  /** uid -> true */
  votes: Record<string, boolean>;
};

export type Message = {
  id: string;
  author_id: string;
  author_name?: string;
  text: string;
  created_at: Date;
  thread_id?: string;
  kind?: MessageKind;
  note_id?: string;
  note_title?: string;
  reactions?: Record<string, string>;
  mentions?: string[];
  edited_at?: Date;
  deleted?: boolean;
  pinned?: boolean;
  /** Official decision marker (Slack/Teams gap) */
  is_decision?: boolean;
  file_url?: string;
  file_name?: string;
  file_mime?: string;
  poll_question?: string;
  poll_options?: PollOption[];
  poll_multi?: boolean;
};

export type TeamTaskStatus = "open" | "doing" | "done";

export type TeamTask = {
  id: string;
  title: string;
  status: TeamTaskStatus;
  assignee_uid?: string;
  assignee_name?: string;
  due?: string;
  channel_id?: string;
  message_id?: string;
  note_id?: string;
  created_by: string;
  created_at: Date;
};

export type StandupEntry = {
  uid: string;
  name: string;
  yesterday: string;
  today: string;
  blockers: string;
  updated_at: Date;
};

export type InviteStatus = "pending" | "accepted" | "revoked";

export type Invite = {
  id: string;
  token: string;
  team_id: string;
  role: TeamRole;
  created_by: string;
  expires_at: Date;
  status: InviteStatus;
  use_count?: number;
};

export type TeamMembership = {
  id: string;
  name: string;
  slug: string;
  role: TeamRole;
  joined_at: Date;
  unread?: number;
};

export type TeamPin = {
  id: string;
  note_id: string;
  title: string;
  pinned_by: string;
  pinned_at: Date;
};

export type TeamNotification = {
  id: string;
  type: "mention" | "invite" | "activity";
  team_id: string;
  channel_id?: string;
  message_id?: string;
  from_uid?: string;
  from_name?: string;
  text: string;
  created_at: Date;
  read: boolean;
};

export type TeamActivity = {
  id: string;
  kind: string;
  text: string;
  actor_id: string;
  actor_name?: string;
  channel_id?: string;
  note_id?: string;
  created_at: Date;
};

function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (base || "team") + "-" + Math.random().toString(36).slice(2, 6);
}

function randomToken(): string {
  const bytes = new Uint8Array(18);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function teamsCol() {
  return collection(db, "teams");
}
function membersCol(teamId: string) {
  return collection(db, "teams", teamId, "members");
}
function channelsCol(teamId: string) {
  return collection(db, "teams", teamId, "channels");
}
function messagesCol(teamId: string, channelId: string) {
  return collection(db, "teams", teamId, "channels", channelId, "messages");
}
function pinsCol(teamId: string) {
  return collection(db, "teams", teamId, "pins");
}
function invitesCol() {
  return collection(db, "invites");
}
function userTeamsCol(uid: string) {
  return collection(db, "users", uid, "teams");
}
function channelReadsCol(uid: string, teamId: string) {
  return collection(db, "users", uid, "teams", teamId, "reads");
}

function teamFromDoc(id: string, data: Record<string, unknown>): Team {
  return {
    id,
    name: String(data.name || "未命名團隊"),
    slug: String(data.slug || id),
    created_by: String(data.created_by || ""),
    created_at: (data.created_at as { toDate?: () => Date })?.toDate?.() || new Date(),
  };
}

function memberFromDoc(uid: string, data: Record<string, unknown>): Member {
  return {
    uid,
    role: (data.role as TeamRole) || "member",
    joined_at: (data.joined_at as { toDate?: () => Date })?.toDate?.() || new Date(),
    display_name: data.display_name ? String(data.display_name) : undefined,
    photo_url: data.photo_url ? String(data.photo_url) : undefined,
    status: data.status ? String(data.status).slice(0, 80) : undefined,
  };
}

function channelFromDoc(id: string, data: Record<string, unknown>): Channel {
  const member_ids = Array.isArray(data.member_ids)
    ? data.member_ids.map(String)
    : undefined;
  return {
    id,
    name: String(data.name || "頻道"),
    topic: data.topic ? String(data.topic) : undefined,
    is_private: !!data.is_private,
    member_ids,
    created_by: String(data.created_by || ""),
    dm_key: data.dm_key ? String(data.dm_key) : undefined,
    created_at: (data.created_at as { toDate?: () => Date })?.toDate?.() || new Date(),
    last_message_at: (data.last_message_at as { toDate?: () => Date })?.toDate?.(),
    last_message_preview: data.last_message_preview
      ? String(data.last_message_preview)
      : undefined,
  };
}

function messageFromDoc(id: string, data: Record<string, unknown>): Message {
  const reactions =
    data.reactions && typeof data.reactions === "object"
      ? (data.reactions as Record<string, string>)
      : undefined;
  return {
    id,
    author_id: String(data.author_id || ""),
    author_name: data.author_name ? String(data.author_name) : undefined,
    text: String(data.text || ""),
    created_at: (data.created_at as { toDate?: () => Date })?.toDate?.() || new Date(),
    thread_id: data.thread_id ? String(data.thread_id) : undefined,
    kind: (data.kind as MessageKind) || "text",
    note_id: data.note_id ? String(data.note_id) : undefined,
    note_title: data.note_title ? String(data.note_title) : undefined,
    reactions,
    mentions: Array.isArray(data.mentions) ? data.mentions.map(String) : undefined,
    edited_at: (data.edited_at as { toDate?: () => Date })?.toDate?.(),
    deleted: !!data.deleted,
    pinned: !!data.pinned,
    is_decision: !!data.is_decision,
    file_url: data.file_url ? String(data.file_url) : undefined,
    file_name: data.file_name ? String(data.file_name) : undefined,
    file_mime: data.file_mime ? String(data.file_mime) : undefined,
    poll_question: data.poll_question ? String(data.poll_question) : undefined,
    poll_multi: !!data.poll_multi,
    poll_options: Array.isArray(data.poll_options)
      ? (data.poll_options as PollOption[]).map((o) => ({
          id: String(o.id || ""),
          text: String(o.text || ""),
          votes:
            o.votes && typeof o.votes === "object"
              ? (o.votes as Record<string, boolean>)
              : {},
        }))
      : undefined,
  };
}

function inviteFromDoc(id: string, data: Record<string, unknown>): Invite {
  return {
    id,
    token: String(data.token || id),
    team_id: String(data.team_id || ""),
    role: (data.role as TeamRole) || "member",
    created_by: String(data.created_by || ""),
    expires_at: (data.expires_at as { toDate?: () => Date })?.toDate?.() || new Date(),
    status: (data.status as InviteStatus) || "pending",
    use_count: typeof data.use_count === "number" ? data.use_count : 0,
  };
}

function pinFromDoc(id: string, data: Record<string, unknown>): TeamPin {
  return {
    id,
    note_id: String(data.note_id || id),
    title: String(data.title || "筆記"),
    pinned_by: String(data.pinned_by || ""),
    pinned_at: (data.pinned_at as { toDate?: () => Date })?.toDate?.() || new Date(),
  };
}

export async function createTeam(
  uid: string,
  name: string,
  displayName?: string
): Promise<string> {
  const teamName = name.trim() || "新團隊";
  const teamRef = doc(teamsCol());
  const now = Timestamp.now();
  const slug = slugify(teamName);

  const write = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/permission|insufficient|Missing/i.test(msg)) {
        throw new Error(
          `${label}：沒有權限（請用專案擁有者帳號執行 firebase deploy --only firestore:rules）`
        );
      }
      throw new Error(`${label}：${msg}`);
    }
  };

  await write("建立團隊", () =>
    setDoc(teamRef, {
      name: teamName,
      slug,
      created_by: uid,
      created_at: now,
    })
  );

  await write("寫入擁有者", () =>
    setDoc(doc(membersCol(teamRef.id), uid), {
      uid,
      role: "owner" as TeamRole,
      joined_at: now,
      display_name: displayName || "",
    })
  );

  const channelRef = doc(channelsCol(teamRef.id));
  await write("建立預設頻道", () =>
    setDoc(channelRef, {
      name: "一般",
      topic: "",
      is_private: false,
      member_ids: [],
      created_by: uid,
      created_at: now,
    })
  );

  await write("加入我的團隊列表", () =>
    setDoc(doc(userTeamsCol(uid), teamRef.id), {
      role: "owner" as TeamRole,
      name: teamName,
      slug,
      joined_at: now,
    })
  );

  return teamRef.id;
}

export function listenUserTeams(
  uid: string,
  cb: (teams: TeamMembership[]) => void
): Unsubscribe {
  return onSnapshot(
    userTeamsCol(uid),
    (snap) => {
      const list = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: String(data.name || "未命名團隊"),
          slug: String(data.slug || d.id),
          role: (data.role as TeamRole) || "member",
          joined_at: data.joined_at?.toDate?.() || new Date(),
          unread: typeof data.unread === "number" ? data.unread : 0,
        } satisfies TeamMembership;
      });
      list.sort((a, b) => b.joined_at.getTime() - a.joined_at.getTime());
      cb(list);
    },
    (err) => console.error("[listenUserTeams]", err)
  );
}

export async function getTeam(teamId: string): Promise<Team | null> {
  const snap = await getDoc(doc(teamsCol(), teamId));
  if (!snap.exists()) return null;
  return teamFromDoc(snap.id, snap.data());
}

export async function getMember(teamId: string, uid: string): Promise<Member | null> {
  const snap = await getDoc(doc(membersCol(teamId), uid));
  if (!snap.exists()) return null;
  return memberFromDoc(snap.id, snap.data());
}

export function listenMembers(teamId: string, cb: (members: Member[]) => void): Unsubscribe {
  return onSnapshot(membersCol(teamId), (snap) => {
    const list = snap.docs.map((d) => memberFromDoc(d.id, d.data()));
    list.sort((a, b) => a.joined_at.getTime() - b.joined_at.getTime());
    cb(list);
  });
}

export function canAccessChannel(ch: Channel, uid: string): boolean {
  if (!ch.is_private) return true;
  if (ch.created_by === uid) return true;
  return (ch.member_ids || []).includes(uid);
}

export function listenChannels(
  teamId: string,
  cb: (channels: Channel[]) => void,
  uid?: string
): Unsubscribe {
  return onSnapshot(
    channelsCol(teamId),
    (snap) => {
      let list = snap.docs.map((d) => channelFromDoc(d.id, d.data()));
      if (uid) list = list.filter((c) => canAccessChannel(c, uid));
      list.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
      cb(list);
    },
    (err) => console.error("[listenChannels]", err)
  );
}

export async function createChannel(
  teamId: string,
  uid: string,
  name: string,
  opts?: { topic?: string; is_private?: boolean; member_ids?: string[] }
): Promise<string> {
  const ref = doc(channelsCol(teamId));
  const isPrivate = !!opts?.is_private;
  const member_ids = isPrivate
    ? Array.from(new Set([uid, ...(opts?.member_ids || [])]))
    : [];
  await setDoc(ref, {
    name: name.trim() || "新頻道",
    topic: opts?.topic || "",
    is_private: isPrivate,
    member_ids,
    created_by: uid,
    created_at: Timestamp.now(),
  });
  await pushActivity(teamId, {
    kind: "channel_created",
    text: `建立頻道 #${name.trim() || "新頻道"}${isPrivate ? "（私人）" : ""}`,
    actor_id: uid,
    channel_id: ref.id,
  });
  return ref.id;
}

export function listenMessages(
  teamId: string,
  channelId: string,
  cb: (messages: Message[]) => void,
  limitCount = 100
): Unsubscribe {
  const q = query(
    messagesCol(teamId, channelId),
    orderBy("created_at", "desc"),
    fsLimit(limitCount)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => messageFromDoc(d.id, d.data()));
      list.reverse();
      cb(list);
    },
    (err) => console.error("[listenMessages]", err)
  );
}

export type SendMessageInput = {
  author_id: string;
  author_name?: string;
  text: string;
  thread_id?: string;
  kind?: MessageKind;
  note_id?: string;
  note_title?: string;
  mentions?: string[];
  members?: Member[];
  file_url?: string;
  file_name?: string;
  file_mime?: string;
};

export async function sendMessage(
  teamId: string,
  channelId: string,
  msg: SendMessageInput
): Promise<string> {
  const ref = doc(messagesCol(teamId, channelId));
  const now = Timestamp.now();
  const kind = msg.kind || "text";
  const mentions =
    msg.mentions ||
    extractMentionUids(msg.text, msg.members);
  await setDoc(ref, {
    author_id: msg.author_id,
    author_name: msg.author_name || "",
    text: msg.text,
    thread_id: msg.thread_id || "",
    kind,
    note_id: msg.note_id || "",
    note_title: msg.note_title || "",
    reactions: {},
    mentions,
    file_url: msg.file_url || "",
    file_name: msg.file_name || "",
    file_mime: msg.file_mime || "",
    pinned: false,
    deleted: false,
    created_at: now,
  });
  if (!msg.thread_id) {
    const preview =
      kind === "note_share"
        ? `📎 ${msg.note_title || "筆記"}`
        : kind === "file"
          ? `📎 ${msg.file_name || msg.text || "檔案"}`
          : msg.text.slice(0, 80);
    await updateDoc(doc(channelsCol(teamId), channelId), {
      last_message_at: now,
      last_message_preview: preview,
    }).catch(() => undefined);
  }
  for (const uid of mentions) {
    if (uid === msg.author_id) continue;
    const muted = await isChannelMutedForUser(uid, teamId, channelId).catch(() => false);
    if (muted) continue;
    const isBroadcast = /@(channel|everyone|here)\b/i.test(msg.text);
    await pushNotification(uid, {
      type: "mention",
      team_id: teamId,
      channel_id: channelId,
      message_id: ref.id,
      from_uid: msg.author_id,
      from_name: msg.author_name || "",
      text: (isBroadcast ? "[頻道廣播] " : "") + msg.text.slice(0, 120),
    }).catch(() => undefined);
  }
  if (!msg.thread_id && kind === "note_share") {
    await pushActivity(teamId, {
      kind: "note_share",
      text: `分享了筆記「${msg.note_title || "筆記"}」`,
      actor_id: msg.author_id,
      actor_name: msg.author_name,
      channel_id: channelId,
      note_id: msg.note_id,
    }).catch(() => undefined);
  }
  return ref.id;
}

/** Reads users/{uid}/teams/{teamId}.muted_channels[channelId] to decide whether to notify. */
async function isChannelMutedForUser(
  uid: string,
  teamId: string,
  channelId: string
): Promise<boolean> {
  const snap = await getDoc(doc(userTeamsCol(uid), teamId));
  const muted = snap.data()?.muted_channels;
  return !!(muted && typeof muted === "object" && (muted as Record<string, boolean>)[channelId]);
}

/** Match @DisplayName against members; also accept raw @uid, @channel, @here, @everyone. */
export function extractMentionUids(text: string, members?: Member[]): string[] {
  if (!text) return [];
  const found = new Set<string>();
  const re = /@([^\s@]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const token = m[1];
    const lower = token.toLowerCase();
    if (lower === "channel" || lower === "everyone" || lower === "here") {
      if (members?.length) {
        members.forEach((x) => found.add(x.uid));
      }
      continue;
    }
    if (members?.length) {
      const hit = members.find(
        (x) =>
          x.uid === token ||
          x.display_name === token ||
          (x.display_name && x.display_name.replace(/\s+/g, "") === token)
      );
      if (hit) found.add(hit.uid);
    } else if (/^[a-zA-Z0-9_-]{6,}$/.test(token)) {
      found.add(token);
    }
  }
  return Array.from(found);
}

export async function toggleMessageReaction(
  teamId: string,
  channelId: string,
  messageId: string,
  uid: string,
  emoji: string
): Promise<void> {
  const ref = doc(messagesCol(teamId, channelId), messageId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const reactions = { ...((snap.data().reactions as Record<string, string>) || {}) };
  if (reactions[uid] === emoji) delete reactions[uid];
  else reactions[uid] = emoji;
  await updateDoc(ref, { reactions });
}

export async function markChannelRead(
  uid: string,
  teamId: string,
  channelId: string
): Promise<void> {
  await setDoc(
    doc(channelReadsCol(uid, teamId), channelId),
    { last_read_at: Timestamp.now() },
    { merge: true }
  );
}

/** Force unread: set last_read before last message (or clear). */
export async function markChannelUnread(
  uid: string,
  teamId: string,
  channelId: string
): Promise<void> {
  await setDoc(
    doc(channelReadsCol(uid, teamId), channelId),
    { last_read_at: Timestamp.fromMillis(0) },
    { merge: true }
  );
}

/** Open or reuse a 1:1 private DM channel between two members. */
export async function openOrCreateDm(
  teamId: string,
  me: Member,
  other: Member
): Promise<string> {
  const pair = [me.uid, other.uid].sort();
  const dmKey = `dm:${pair[0]}_${pair[1]}`;
  // Look for existing channel with this dm_key
  const snap = await getDocs(channelsCol(teamId));
  for (const d of snap.docs) {
    const data = d.data();
    if (data.dm_key === dmKey) return d.id;
  }
  const otherName = other.display_name || other.uid.slice(0, 6);
  const ref = doc(channelsCol(teamId));
  await setDoc(ref, {
    name: otherName,
    topic: "私人訊息",
    is_private: true,
    member_ids: pair,
    created_by: me.uid,
    dm_key: dmKey,
    created_at: Timestamp.now(),
  });
  return ref.id;
}

/** Group DM (3+ people). Uses dm:group:sortedUids key. */
export async function openOrCreateGroupDm(
  teamId: string,
  me: Member,
  others: Member[]
): Promise<string> {
  const unique = Array.from(new Map([[me.uid, me], ...others.map((o) => [o.uid, o] as const)]).values());
  if (unique.length < 3) {
    if (unique.length === 2) {
      const other = unique.find((m) => m.uid !== me.uid)!;
      return openOrCreateDm(teamId, me, other);
    }
    throw new Error("群組私訊至少需要兩位其他成員");
  }
  const ids = unique.map((m) => m.uid).sort();
  const dmKey = `dm:group:${ids.join("_")}`;
  const snap = await getDocs(channelsCol(teamId));
  for (const d of snap.docs) {
    if (d.data().dm_key === dmKey) return d.id;
  }
  const label = unique
    .filter((m) => m.uid !== me.uid)
    .map((m) => m.display_name || m.uid.slice(0, 6))
    .slice(0, 3)
    .join("、");
  const ref = doc(channelsCol(teamId));
  await setDoc(ref, {
    name: label || "群組私訊",
    topic: "群組私人訊息",
    is_private: true,
    member_ids: ids,
    created_by: me.uid,
    dm_key: dmKey,
    created_at: Timestamp.now(),
  });
  return ref.id;
}

/** Mark every unread channel in a team as read. */
export async function markAllTeamChannelsRead(
  uid: string,
  teamId: string,
  channels: Channel[],
  reads: Record<string, Date>,
  muted?: Record<string, boolean>
): Promise<number> {
  let n = 0;
  await Promise.all(
    channels.map(async (c) => {
      if (muted?.[c.id]) return;
      if (!channelIsUnread(c, reads[c.id])) return;
      await markChannelRead(uid, teamId, c.id);
      n += 1;
    })
  );
  return n;
}

export type TeamFileHit = {
  teamId: string;
  teamName: string;
  channelId: string;
  channelName: string;
  message: Message;
};

/** Recent file messages across a team's channels (client scan, capped). */
export async function listRecentTeamFiles(
  teamId: string,
  teamName: string,
  channelIds: string[],
  perChannel = 25
): Promise<TeamFileHit[]> {
  const hits: TeamFileHit[] = [];
  await Promise.all(
    channelIds.slice(0, 10).map(async (channelId) => {
      const snap = await getDocs(
        query(messagesCol(teamId, channelId), orderBy("created_at", "desc"), fsLimit(perChannel))
      );
      snap.docs.forEach((d) => {
        const message = messageFromDoc(d.id, d.data());
        if (message.deleted) return;
        if (message.kind !== "file" && !message.file_url) return;
        hits.push({
          teamId,
          teamName,
          channelId,
          channelName: channelId,
          message,
        });
      });
    })
  );
  hits.sort((a, b) => b.message.created_at.getTime() - a.message.created_at.getTime());
  return hits.slice(0, 40);
}


export function listenChannelReads(
  uid: string,
  teamId: string,
  cb: (reads: Record<string, Date>) => void
): Unsubscribe {
  return onSnapshot(channelReadsCol(uid, teamId), (snap) => {
    const map: Record<string, Date> = {};
    snap.docs.forEach((d) => {
      const t = d.data().last_read_at?.toDate?.();
      if (t) map[d.id] = t;
    });
    cb(map);
  });
}

export function channelIsUnread(ch: Channel, lastRead?: Date): boolean {
  if (!ch.last_message_at) return false;
  if (!lastRead) return true;
  return ch.last_message_at.getTime() > lastRead.getTime() + 500;
}

export async function createInvite(
  teamId: string,
  uid: string,
  role: TeamRole = "member",
  expiresInMs = 7 * 24 * 60 * 60 * 1000
): Promise<string> {
  const token = randomToken();
  await setDoc(doc(invitesCol(), token), {
    token,
    team_id: teamId,
    role,
    created_by: uid,
    expires_at: Timestamp.fromMillis(Date.now() + expiresInMs),
    status: "pending" as InviteStatus,
    use_count: 0,
    created_at: Timestamp.now(),
  });
  return token;
}

export async function getInvite(token: string): Promise<Invite | null> {
  const snap = await getDoc(doc(invitesCol(), token));
  if (!snap.exists()) return null;
  return inviteFromDoc(snap.id, snap.data());
}

export async function revokeInvite(token: string): Promise<void> {
  await updateDoc(doc(invitesCol(), token), { status: "revoked" as InviteStatus });
}

export type AcceptInviteResult =
  | { ok: true; teamId: string; teamName: string }
  | { ok: false; error: "not_found" | "expired" | "revoked" };

/** Join team; invite stays pending until expiry/revoke so links are reusable. */
export async function acceptInvite(
  token: string,
  uid: string,
  displayName?: string
): Promise<AcceptInviteResult> {
  const invite = await getInvite(token);
  if (!invite) return { ok: false, error: "not_found" };
  if (invite.status === "revoked") return { ok: false, error: "revoked" };
  if (invite.expires_at.getTime() < Date.now()) return { ok: false, error: "expired" };
  if (invite.status !== "pending") return { ok: false, error: "revoked" };

  const team = await getTeam(invite.team_id);
  if (!team) return { ok: false, error: "not_found" };

  const now = Timestamp.now();
  const existing = await getMember(invite.team_id, uid);
  if (!existing) {
    await setDoc(doc(membersCol(invite.team_id), uid), {
      uid,
      role: invite.role,
      joined_at: now,
      display_name: displayName || "",
      invite_token: token,
    });
    await updateDoc(doc(invitesCol(), token), {
      use_count: (invite.use_count || 0) + 1,
    }).catch(() => undefined);
  }
  await setDoc(
    doc(userTeamsCol(uid), invite.team_id),
    { role: existing?.role || invite.role, name: team.name, slug: team.slug, joined_at: now },
    { merge: true }
  );
  if (!existing) {
    await pushActivity(invite.team_id, {
      kind: "member_joined",
      text: `${displayName || "新成員"} 加入了團隊`,
      actor_id: uid,
      actor_name: displayName,
    }).catch(() => undefined);
    if (invite.created_by && invite.created_by !== uid) {
      await pushNotification(invite.created_by, {
        type: "invite",
        team_id: invite.team_id,
        from_uid: uid,
        from_name: displayName || "",
        text: `${displayName || "有人"} 已透過邀請加入「${team.name}」`,
      }).catch(() => undefined);
    }
  }
  return { ok: true, teamId: invite.team_id, teamName: team.name };
}

export async function leaveTeam(teamId: string, uid: string): Promise<void> {
  await deleteDoc(doc(membersCol(teamId), uid));
  await deleteDoc(doc(userTeamsCol(uid), teamId));
}

/** Admin/owner removes another member (not the sole owner). */
export async function removeMember(
  teamId: string,
  actorUid: string,
  targetUid: string,
  actorName?: string
): Promise<void> {
  if (actorUid === targetUid) {
    throw new Error("無法移除自己，請改用離開團隊");
  }
  const target = await getMember(teamId, targetUid);
  if (!target) return;
  if (target.role === "owner") {
    throw new Error("無法直接移除擁有者，請先轉移擁有權");
  }
  await leaveTeam(teamId, targetUid);
  await pushActivity(teamId, {
    kind: "member_removed",
    text: `移除了成員`,
    actor_id: actorUid,
    actor_name: actorName,
  }).catch(() => undefined);
  await pushNotification(targetUid, {
    type: "activity",
    team_id: teamId,
    from_uid: actorUid,
    from_name: actorName || "",
    text: "你已被移出團隊",
  }).catch(() => undefined);
}

/** Transfer owner role; previous owner becomes admin. */
export async function transferOwnership(
  teamId: string,
  fromUid: string,
  toUid: string
): Promise<void> {
  if (fromUid === toUid) return;
  const from = await getMember(teamId, fromUid);
  const to = await getMember(teamId, toUid);
  if (!from || from.role !== "owner") throw new Error("只有擁有者可以轉移擁有權");
  if (!to) throw new Error("找不到目標成員");
  await setMemberRole(teamId, toUid, "owner");
  await setMemberRole(teamId, fromUid, "admin");
  await pushActivity(teamId, {
    kind: "ownership_transfer",
    text: `擁有權已轉移給 ${to.display_name || toUid.slice(0, 6)}`,
    actor_id: fromUid,
  }).catch(() => undefined);
  await pushNotification(toUid, {
    type: "activity",
    team_id: teamId,
    from_uid: fromUid,
    from_name: from.display_name || "",
    text: "你已成為此團隊的擁有者",
  }).catch(() => undefined);
}

export async function setMemberRole(teamId: string, uid: string, role: TeamRole): Promise<void> {
  await updateDoc(doc(membersCol(teamId), uid), { role });
  await updateDoc(doc(userTeamsCol(uid), teamId), { role }).catch(() => undefined);
}

/** Self-serve status line (visible to teammates). */
export async function setMemberStatus(
  teamId: string,
  uid: string,
  status: string
): Promise<void> {
  await updateDoc(doc(membersCol(teamId), uid), {
    status: status.trim().slice(0, 80),
  });
}

export type TeamCanvas = {
  teamId: string;
  title: string;
  body: string;
  updated_at: Date;
  updated_by?: string;
};

export function listenTeamCanvas(
  teamId: string,
  cb: (canvas: TeamCanvas | null) => void
): Unsubscribe {
  return onSnapshot(doc(collection(db, "teams", teamId, "meta"), "canvas"), (snap) => {
    if (!snap.exists()) {
      cb(null);
      return;
    }
    const data = snap.data();
    cb({
      teamId,
      title: String(data.title || "團隊 Canvas"),
      body: String(data.body || ""),
      updated_at: data.updated_at?.toDate?.() || new Date(),
      updated_by: data.updated_by ? String(data.updated_by) : undefined,
    });
  });
}

export async function saveTeamCanvas(
  teamId: string,
  uid: string,
  patch: { title?: string; body?: string }
): Promise<void> {
  const ref = doc(collection(db, "teams", teamId, "meta"), "canvas");
  await setDoc(
    ref,
    {
      title: (patch.title ?? "團隊 Canvas").trim().slice(0, 80) || "團隊 Canvas",
      body: patch.body ?? "",
      updated_at: Timestamp.now(),
      updated_by: uid,
    },
    { merge: true }
  );
}

/** Forward a message into another channel (quote-style text). */
export async function forwardMessage(
  teamId: string,
  toChannelId: string,
  author: { uid: string; name?: string },
  original: { author_name?: string; text: string; channelName?: string },
  note?: string
): Promise<string> {
  const quote = `↪ 轉自 ${original.author_name || "某人"}${
    original.channelName ? `（#${original.channelName}）` : ""
  }：\n> ${original.text.slice(0, 500)}`;
  const text = note?.trim() ? `${note.trim()}\n\n${quote}` : quote;
  return sendMessage(teamId, toChannelId, {
    author_id: author.uid,
    author_name: author.name,
    text,
  });
}

export async function listTeamInvites(teamId: string): Promise<Invite[]> {
  const q = query(invitesCol(), where("team_id", "==", teamId));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => inviteFromDoc(d.id, d.data()))
    .sort((a, b) => b.expires_at.getTime() - a.expires_at.getTime());
}

export function listenPins(teamId: string, cb: (pins: TeamPin[]) => void): Unsubscribe {
  return onSnapshot(pinsCol(teamId), (snap) => {
    const list = snap.docs.map((d) => pinFromDoc(d.id, d.data()));
    list.sort((a, b) => b.pinned_at.getTime() - a.pinned_at.getTime());
    cb(list);
  });
}

export async function pinNote(
  teamId: string,
  noteId: string,
  title: string,
  uid: string
): Promise<void> {
  await setDoc(doc(pinsCol(teamId), noteId), {
    note_id: noteId,
    title: title || "筆記",
    pinned_by: uid,
    pinned_at: Timestamp.now(),
  });
  await pushActivity(teamId, {
    kind: "pin",
    text: `釘選筆記「${title || "筆記"}」`,
    actor_id: uid,
    note_id: noteId,
  }).catch(() => undefined);
}

export async function unpinNote(teamId: string, noteId: string): Promise<void> {
  await deleteDoc(doc(pinsCol(teamId), noteId));
}

export async function shareNoteToChannel(opts: {
  teamId: string;
  channelId: string;
  author_id: string;
  author_name?: string;
  note_id: string;
  note_title: string;
  pin?: boolean;
}): Promise<string> {
  const id = await sendMessage(opts.teamId, opts.channelId, {
    author_id: opts.author_id,
    author_name: opts.author_name,
    text: `分享了筆記「${opts.note_title}」`,
    kind: "note_share",
    note_id: opts.note_id,
    note_title: opts.note_title,
  });
  if (opts.pin) {
    await pinNote(opts.teamId, opts.note_id, opts.note_title, opts.author_id);
  }
  return id;
}

export async function findMembershipsAcrossTeams(
  uid: string
): Promise<{ teamId: string; role: TeamRole }[]> {
  const q = query(collectionGroup(db, "members"), where("uid", "==", uid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({
    teamId: d.ref.parent.parent?.id || "",
    role: (d.data().role as TeamRole) || "member",
  }));
}

export const REACTION_EMOJIS = [
  "👍", "👎", "❤️", "🔥", "👀", "✅", "🎉", "😂", "😮", "😢", "🙏", "💡", "🚀", "📌", "✨", "🤝",
] as const;

export async function updateChannel(
  teamId: string,
  channelId: string,
  patch: { topic?: string; name?: string }
): Promise<void> {
  const data: Record<string, string> = {};
  if (patch.topic !== undefined) data.topic = patch.topic;
  if (patch.name !== undefined) data.name = patch.name.trim();
  if (!Object.keys(data).length) return;
  await updateDoc(doc(channelsCol(teamId), channelId), data);
}

/** Delete channel metadata. Messages may linger (MVP). DMs blocked. */
export async function deleteChannel(
  teamId: string,
  channelId: string,
  actorUid: string,
  actorName?: string
): Promise<void> {
  const snap = await getDoc(doc(channelsCol(teamId), channelId));
  if (!snap.exists()) return;
  const data = snap.data();
  if (data.dm_key) throw new Error("私人訊息無法刪除");
  const name = String(data.name || "頻道");
  await deleteDoc(doc(channelsCol(teamId), channelId));
  await pushActivity(teamId, {
    kind: "channel_deleted",
    text: `刪除了頻道 #${name}`,
    actor_id: actorUid,
    actor_name: actorName,
  }).catch(() => undefined);
}

export async function setChannelMuted(
  uid: string,
  teamId: string,
  channelId: string,
  muted: boolean
): Promise<void> {
  const ref = doc(userTeamsCol(uid), teamId);
  const snap = await getDoc(ref);
  const prev =
    snap.exists() && snap.data().muted_channels && typeof snap.data().muted_channels === "object"
      ? { ...(snap.data().muted_channels as Record<string, boolean>) }
      : {};
  if (muted) prev[channelId] = true;
  else delete prev[channelId];
  await setDoc(ref, { muted_channels: prev }, { merge: true });
}

export function listenMutedChannels(
  uid: string,
  teamId: string,
  cb: (muted: Record<string, boolean>) => void
): Unsubscribe {
  return onSnapshot(doc(userTeamsCol(uid), teamId), (snap) => {
    const data = snap.data();
    const m = data?.muted_channels;
    cb(m && typeof m === "object" ? (m as Record<string, boolean>) : {});
  });
}

/** Fetch recent messages across channels (client-side filter). Cap channels for cost. */
export async function searchTeamMessages(
  teamId: string,
  channelIds: string[],
  queryText: string,
  perChannel = 40
): Promise<{ channelId: string; message: Message }[]> {
  const q = queryText.trim().toLowerCase();
  if (!q) return [];
  const results: { channelId: string; message: Message }[] = [];
  await Promise.all(
    channelIds.slice(0, 12).map(async (channelId) => {
      const snap = await getDocs(
        query(messagesCol(teamId, channelId), orderBy("created_at", "desc"), fsLimit(perChannel))
      );
      snap.docs.forEach((d) => {
        const message = messageFromDoc(d.id, d.data());
        if (message.deleted) return;
        const hay = `${message.text} ${message.note_title || ""} ${message.file_name || ""}`.toLowerCase();
        if (hay.includes(q)) results.push({ channelId, message });
      });
    })
  );
  results.sort((a, b) => b.message.created_at.getTime() - a.message.created_at.getTime());
  return results.slice(0, 50);
}


function activityCol(teamId: string) {
  return collection(db, "teams", teamId, "activity");
}
function typingCol(teamId: string, channelId: string) {
  return collection(db, "teams", teamId, "channels", channelId, "typing");
}
function notificationsCol(uid: string) {
  return collection(db, "users", uid, "notifications");
}

export async function pushActivity(
  teamId: string,
  entry: {
    kind: string;
    text: string;
    actor_id: string;
    actor_name?: string;
    channel_id?: string;
    note_id?: string;
  }
): Promise<void> {
  await setDoc(doc(activityCol(teamId)), {
    ...entry,
    actor_name: entry.actor_name || "",
    channel_id: entry.channel_id || "",
    note_id: entry.note_id || "",
    created_at: Timestamp.now(),
  });
}

export function listenActivity(
  teamId: string,
  cb: (items: TeamActivity[]) => void,
  limitCount = 40
): Unsubscribe {
  const q = query(activityCol(teamId), orderBy("created_at", "desc"), fsLimit(limitCount));
  return onSnapshot(q, (snap) => {
    cb(
      snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          kind: String(data.kind || ""),
          text: String(data.text || ""),
          actor_id: String(data.actor_id || ""),
          actor_name: data.actor_name ? String(data.actor_name) : undefined,
          channel_id: data.channel_id ? String(data.channel_id) : undefined,
          note_id: data.note_id ? String(data.note_id) : undefined,
          created_at: data.created_at?.toDate?.() || new Date(),
        };
      })
    );
  });
}

export async function pushNotification(
  uid: string,
  n: Omit<TeamNotification, "id" | "created_at" | "read">
): Promise<void> {
  await setDoc(doc(notificationsCol(uid)), {
    ...n,
    channel_id: n.channel_id || "",
    message_id: n.message_id || "",
    from_uid: n.from_uid || "",
    from_name: n.from_name || "",
    read: false,
    created_at: Timestamp.now(),
  });
}

export function listenNotifications(
  uid: string,
  cb: (items: TeamNotification[]) => void,
  limitCount = 30
): Unsubscribe {
  const q = query(notificationsCol(uid), orderBy("created_at", "desc"), fsLimit(limitCount));
  return onSnapshot(
    q,
    (snap) => {
      cb(
        snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            type: (data.type as TeamNotification["type"]) || "activity",
            team_id: String(data.team_id || ""),
            channel_id: data.channel_id ? String(data.channel_id) : undefined,
            message_id: data.message_id ? String(data.message_id) : undefined,
            from_uid: data.from_uid ? String(data.from_uid) : undefined,
            from_name: data.from_name ? String(data.from_name) : undefined,
            text: String(data.text || ""),
            created_at: data.created_at?.toDate?.() || new Date(),
            read: !!data.read,
          };
        })
      );
    },
    (err) => console.error("[listenNotifications]", err)
  );
}

export async function markNotificationRead(uid: string, id: string): Promise<void> {
  await updateDoc(doc(notificationsCol(uid), id), { read: true });
}

export async function markAllNotificationsRead(
  uid: string,
  items: TeamNotification[]
): Promise<void> {
  await Promise.all(
    items.filter((n) => !n.read).map((n) => markNotificationRead(uid, n.id).catch(() => undefined))
  );
}

export async function setTyping(
  teamId: string,
  channelId: string,
  uid: string,
  name: string
): Promise<void> {
  await setDoc(doc(typingCol(teamId, channelId), uid), {
    uid,
    name,
    at: Timestamp.now(),
  });
}

export async function clearTyping(
  teamId: string,
  channelId: string,
  uid: string
): Promise<void> {
  await deleteDoc(doc(typingCol(teamId, channelId), uid)).catch(() => undefined);
}

export function listenTyping(
  teamId: string,
  channelId: string,
  cb: (people: { uid: string; name: string }[]) => void
): Unsubscribe {
  return onSnapshot(typingCol(teamId, channelId), (snap) => {
    const now = Date.now();
    const people = snap.docs
      .map((d) => {
        const data = d.data();
        const at = data.at?.toDate?.()?.getTime?.() || 0;
        if (now - at > 5000) return null;
        return { uid: String(data.uid || d.id), name: String(data.name || "某人") };
      })
      .filter(Boolean) as { uid: string; name: string }[];
    cb(people);
  });
}

export async function updateChannelMembers(
  teamId: string,
  channelId: string,
  memberIds: string[]
): Promise<void> {
  await updateDoc(doc(channelsCol(teamId), channelId), {
    member_ids: memberIds,
  });
}

export async function editMessage(
  teamId: string,
  channelId: string,
  messageId: string,
  text: string
): Promise<void> {
  await updateDoc(doc(messagesCol(teamId, channelId), messageId), {
    text,
    edited_at: Timestamp.now(),
  });
}

export async function deleteMessage(
  teamId: string,
  channelId: string,
  messageId: string
): Promise<void> {
  await updateDoc(doc(messagesCol(teamId, channelId), messageId), {
    deleted: true,
    text: "（已刪除）",
    file_url: "",
    file_name: "",
  });
}

export async function toggleMessagePin(
  teamId: string,
  channelId: string,
  messageId: string,
  pinned: boolean
): Promise<void> {
  await updateDoc(doc(messagesCol(teamId, channelId), messageId), { pinned });
}

export async function uploadTeamFile(
  teamId: string,
  channelId: string,
  file: File,
  onProgress?: (pct: number) => void
): Promise<{ url: string; name: string; mime: string }> {
  const { uploadFile } = await import("@/lib/firebase");
  const safe = file.name.replace(/[^\w.\u4e00-\u9fff-]+/g, "_").slice(0, 80);
  const path = `uploads/teams/${teamId}/${channelId}/${Date.now()}_${safe}`;
  const url = await uploadFile(path, file, onProgress);
  return { url, name: file.name, mime: file.type || "application/octet-stream" };
}

export async function renameTeam(teamId: string, name: string): Promise<void> {
  const n = name.trim() || "未命名團隊";
  await updateDoc(doc(teamsCol(), teamId), { name: n });
}

export async function deleteTeam(teamId: string, memberUids: string[]): Promise<void> {
  // Best-effort: remove member mirrors then team doc (subcollections may linger — acceptable MVP)
  await Promise.all(
    memberUids.map((uid) => deleteDoc(doc(userTeamsCol(uid), teamId)).catch(() => undefined))
  );
  await Promise.all(
    memberUids.map((uid) => deleteDoc(doc(membersCol(teamId), uid)).catch(() => undefined))
  );
  await deleteDoc(doc(teamsCol(), teamId));
}

export async function setChannelPresence(
  teamId: string,
  channelId: string,
  uid: string,
  name: string,
  color: string
): Promise<void> {
  await setDoc(doc(collection(db, "teams", teamId, "channels", channelId, "presence"), uid), {
    uid,
    name,
    color,
    at: Timestamp.now(),
  });
}

export async function clearChannelPresence(
  teamId: string,
  channelId: string,
  uid: string
): Promise<void> {
  await deleteDoc(
    doc(collection(db, "teams", teamId, "channels", channelId, "presence"), uid)
  ).catch(() => undefined);
}

export function listenChannelPresence(
  teamId: string,
  channelId: string,
  cb: (people: { uid: string; name: string; color: string }[]) => void
): Unsubscribe {
  return onSnapshot(
    collection(db, "teams", teamId, "channels", channelId, "presence"),
    (snap) => {
      const now = Date.now();
      const people = snap.docs
        .map((d) => {
          const data = d.data();
          const at = data.at?.toDate?.()?.getTime?.() || 0;
          if (now - at > 45000) return null;
          return {
            uid: String(data.uid || d.id),
            name: String(data.name || "?"),
            color: String(data.color || "#0D9488"),
          };
        })
        .filter(Boolean) as { uid: string; name: string; color: string }[];
      cb(people);
    }
  );
}

function tasksCol(teamId: string) {
  return collection(db, "teams", teamId, "tasks");
}

function standupCol(teamId: string, dateKey: string) {
  return collection(db, "teams", teamId, "standups", dateKey, "entries");
}

export function todayStandupKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function listenTeamTasks(
  teamId: string,
  cb: (tasks: TeamTask[]) => void
): Unsubscribe {
  return onSnapshot(tasksCol(teamId), (snap) => {
    const list = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        title: String(data.title || ""),
        status: (data.status as TeamTaskStatus) || "open",
        assignee_uid: data.assignee_uid ? String(data.assignee_uid) : undefined,
        assignee_name: data.assignee_name ? String(data.assignee_name) : undefined,
        due: data.due ? String(data.due) : undefined,
        channel_id: data.channel_id ? String(data.channel_id) : undefined,
        message_id: data.message_id ? String(data.message_id) : undefined,
        note_id: data.note_id ? String(data.note_id) : undefined,
        created_by: String(data.created_by || ""),
        created_at: data.created_at?.toDate?.() || new Date(),
      } satisfies TeamTask;
    });
    list.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    cb(list);
  });
}

export async function createTeamTask(
  teamId: string,
  input: {
    title: string;
    created_by: string;
    assignee_uid?: string;
    assignee_name?: string;
    due?: string;
    channel_id?: string;
    message_id?: string;
  }
): Promise<string> {
  const ref = doc(tasksCol(teamId));
  await setDoc(ref, {
    title: input.title.trim().slice(0, 200) || "未命名任務",
    status: "open" as TeamTaskStatus,
    assignee_uid: input.assignee_uid || "",
    assignee_name: input.assignee_name || "",
    due: input.due || "",
    channel_id: input.channel_id || "",
    message_id: input.message_id || "",
    note_id: "",
    created_by: input.created_by,
    created_at: Timestamp.now(),
  });
  await pushActivity(teamId, {
    kind: "task_created",
    text: `建立任務「${input.title.trim().slice(0, 40)}」`,
    actor_id: input.created_by,
    channel_id: input.channel_id,
  }).catch(() => undefined);
  return ref.id;
}

export async function updateTeamTask(
  teamId: string,
  taskId: string,
  patch: Partial<Pick<TeamTask, "title" | "status" | "assignee_uid" | "assignee_name" | "due" | "note_id">>
): Promise<void> {
  const data: Record<string, string> = {};
  if (patch.title !== undefined) data.title = patch.title.trim().slice(0, 200);
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.assignee_uid !== undefined) data.assignee_uid = patch.assignee_uid;
  if (patch.assignee_name !== undefined) data.assignee_name = patch.assignee_name;
  if (patch.due !== undefined) data.due = patch.due;
  if (patch.note_id !== undefined) data.note_id = patch.note_id;
  if (!Object.keys(data).length) return;
  await updateDoc(doc(tasksCol(teamId), taskId), data);
}

export async function deleteTeamTask(teamId: string, taskId: string): Promise<void> {
  await deleteDoc(doc(tasksCol(teamId), taskId));
}

export async function toggleMessageDecision(
  teamId: string,
  channelId: string,
  messageId: string,
  isDecision: boolean
): Promise<void> {
  await updateDoc(doc(messagesCol(teamId, channelId), messageId), {
    is_decision: isDecision,
  });
}

export async function createPollMessage(
  teamId: string,
  channelId: string,
  author: { uid: string; name?: string },
  question: string,
  optionTexts: string[],
  multi = false
): Promise<string> {
  const options: PollOption[] = optionTexts
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((text, i) => ({ id: `o${i}`, text, votes: {} }));
  if (options.length < 2) throw new Error("投票至少需要兩個選項");
  const ref = doc(messagesCol(teamId, channelId));
  const now = Timestamp.now();
  await setDoc(ref, {
    author_id: author.uid,
    author_name: author.name || "",
    text: question.trim(),
    thread_id: "",
    kind: "poll" as MessageKind,
    note_id: "",
    note_title: "",
    reactions: {},
    mentions: [],
    file_url: "",
    file_name: "",
    file_mime: "",
    pinned: false,
    deleted: false,
    is_decision: false,
    poll_question: question.trim(),
    poll_options: options,
    poll_multi: multi,
    created_at: now,
  });
  await updateDoc(doc(channelsCol(teamId), channelId), {
    last_message_at: now,
    last_message_preview: `📊 ${question.trim().slice(0, 60)}`,
  }).catch(() => undefined);
  return ref.id;
}

export async function votePollOption(
  teamId: string,
  channelId: string,
  messageId: string,
  optionId: string,
  uid: string
): Promise<void> {
  const ref = doc(messagesCol(teamId, channelId), messageId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data();
  const multi = !!data.poll_multi;
  const options = Array.isArray(data.poll_options) ? [...data.poll_options] : [];
  const next = options.map((o: PollOption) => {
    const votes = { ...((o.votes as Record<string, boolean>) || {}) };
    if (o.id === optionId) {
      if (votes[uid]) delete votes[uid];
      else votes[uid] = true;
    } else if (!multi && votes[uid]) {
      delete votes[uid];
    }
    return { id: o.id, text: o.text, votes };
  });
  await updateDoc(ref, { poll_options: next });
}

export function listenStandupEntries(
  teamId: string,
  dateKey: string,
  cb: (entries: StandupEntry[]) => void
): Unsubscribe {
  return onSnapshot(standupCol(teamId, dateKey), (snap) => {
    const list = snap.docs.map((d) => {
      const data = d.data();
      return {
        uid: d.id,
        name: String(data.name || d.id.slice(0, 6)),
        yesterday: String(data.yesterday || ""),
        today: String(data.today || ""),
        blockers: String(data.blockers || ""),
        updated_at: data.updated_at?.toDate?.() || new Date(),
      } satisfies StandupEntry;
    });
    list.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
    cb(list);
  });
}

export async function upsertStandupEntry(
  teamId: string,
  dateKey: string,
  entry: Omit<StandupEntry, "updated_at">
): Promise<void> {
  await setDoc(
    doc(standupCol(teamId, dateKey), entry.uid),
    {
      name: entry.name,
      yesterday: entry.yesterday.slice(0, 500),
      today: entry.today.slice(0, 500),
      blockers: entry.blockers.slice(0, 500),
      updated_at: Timestamp.now(),
    },
    { merge: true }
  );
}
