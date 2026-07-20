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

export type MessageKind = "text" | "note_share" | "file";

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
  file_url?: string;
  file_name?: string;
  file_mime?: string;
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
    file_url: data.file_url ? String(data.file_url) : undefined,
    file_name: data.file_name ? String(data.file_name) : undefined,
    file_mime: data.file_mime ? String(data.file_mime) : undefined,
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
    await pushNotification(uid, {
      type: "mention",
      team_id: teamId,
      channel_id: channelId,
      message_id: ref.id,
      from_uid: msg.author_id,
      from_name: msg.author_name || "",
      text: msg.text.slice(0, 120),
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

/** Match @DisplayName against members; also accept raw @uid. */
export function extractMentionUids(text: string, members?: Member[]): string[] {
  if (!text) return [];
  const found = new Set<string>();
  const re = /@([^\s@]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const token = m[1];
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
  return { ok: true, teamId: invite.team_id, teamName: team.name };
}

export async function leaveTeam(teamId: string, uid: string): Promise<void> {
  await deleteDoc(doc(membersCol(teamId), uid));
  await deleteDoc(doc(userTeamsCol(uid), teamId));
}

export async function setMemberRole(teamId: string, uid: string, role: TeamRole): Promise<void> {
  await updateDoc(doc(membersCol(teamId), uid), { role });
  await updateDoc(doc(userTeamsCol(uid), teamId), { role }).catch(() => undefined);
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
