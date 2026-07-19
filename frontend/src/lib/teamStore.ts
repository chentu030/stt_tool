/**
 * Cadence Team Space — Firestore-backed teams, channels, messages and invites.
 *
 * Layout:
 *   teams/{teamId}                              Team
 *   teams/{teamId}/members/{uid}                Member
 *   teams/{teamId}/channels/{channelId}         Channel
 *   teams/{teamId}/channels/{channelId}/messages/{messageId}   Message
 *   invites/{token}                             Invite (top-level, token == doc id)
 *   users/{uid}/teams/{teamId}                  mirror: { role, name, joined_at } for fast "my teams" list
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
};

export type Channel = {
  id: string;
  name: string;
  topic?: string;
  is_private: boolean;
  created_by: string;
  created_at: Date;
};

export type Message = {
  id: string;
  author_id: string;
  author_name?: string;
  text: string;
  created_at: Date;
  thread_id?: string;
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
};

/** Lightweight row from the users/{uid}/teams mirror, used to render "my teams" lists. */
export type TeamMembership = {
  id: string;
  name: string;
  slug: string;
  role: TeamRole;
  joined_at: Date;
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
function invitesCol() {
  return collection(db, "invites");
}
function userTeamsCol(uid: string) {
  return collection(db, "users", uid, "teams");
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
  };
}

function channelFromDoc(id: string, data: Record<string, unknown>): Channel {
  return {
    id,
    name: String(data.name || "頻道"),
    topic: data.topic ? String(data.topic) : undefined,
    is_private: !!data.is_private,
    created_by: String(data.created_by || ""),
    created_at: (data.created_at as { toDate?: () => Date })?.toDate?.() || new Date(),
  };
}

function messageFromDoc(id: string, data: Record<string, unknown>): Message {
  return {
    id,
    author_id: String(data.author_id || ""),
    author_name: data.author_name ? String(data.author_name) : undefined,
    text: String(data.text || ""),
    created_at: (data.created_at as { toDate?: () => Date })?.toDate?.() || new Date(),
    thread_id: data.thread_id ? String(data.thread_id) : undefined,
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
  };
}

/** Create a new team with the creator as owner, plus a default "#一般" channel. */
export async function createTeam(
  uid: string,
  name: string,
  displayName?: string
): Promise<string> {
  const teamName = name.trim() || "新團隊";
  const teamRef = doc(teamsCol());
  const now = Timestamp.now();
  const slug = slugify(teamName);

  await setDoc(teamRef, {
    name: teamName,
    slug,
    created_by: uid,
    created_at: now,
  });

  await setDoc(doc(membersCol(teamRef.id), uid), {
    uid,
    role: "owner" as TeamRole,
    joined_at: now,
    display_name: displayName || "",
  });

  const channelRef = doc(channelsCol(teamRef.id));
  await setDoc(channelRef, {
    name: "一般",
    topic: "",
    is_private: false,
    created_by: uid,
    created_at: now,
  });

  await setDoc(doc(userTeamsCol(uid), teamRef.id), {
    role: "owner" as TeamRole,
    name: teamName,
    slug,
    joined_at: now,
  });

  return teamRef.id;
}

/** Live list of the current user's teams via the users/{uid}/teams mirror. */
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

export function listenChannels(teamId: string, cb: (channels: Channel[]) => void): Unsubscribe {
  return onSnapshot(
    channelsCol(teamId),
    (snap) => {
      const list = snap.docs.map((d) => channelFromDoc(d.id, d.data()));
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
  opts?: { topic?: string; is_private?: boolean }
): Promise<string> {
  const ref = doc(channelsCol(teamId));
  await setDoc(ref, {
    name: name.trim() || "新頻道",
    topic: opts?.topic || "",
    is_private: !!opts?.is_private,
    created_by: uid,
    created_at: Timestamp.now(),
  });
  return ref.id;
}

export function listenMessages(
  teamId: string,
  channelId: string,
  cb: (messages: Message[]) => void,
  limitCount = 80
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

export async function sendMessage(
  teamId: string,
  channelId: string,
  msg: { author_id: string; author_name?: string; text: string; thread_id?: string }
): Promise<string> {
  const ref = doc(messagesCol(teamId, channelId));
  await setDoc(ref, {
    author_id: msg.author_id,
    author_name: msg.author_name || "",
    text: msg.text,
    thread_id: msg.thread_id || "",
    created_at: Timestamp.now(),
  });
  return ref.id;
}

/** Create an invite link. Default expiry: 7 days. */
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

/** Join the invite's team as the given uid, then mark the invite accepted. */
export async function acceptInvite(
  token: string,
  uid: string,
  displayName?: string
): Promise<AcceptInviteResult> {
  const invite = await getInvite(token);
  if (!invite) return { ok: false, error: "not_found" };
  if (invite.status === "revoked") return { ok: false, error: "revoked" };
  if (invite.expires_at.getTime() < Date.now()) return { ok: false, error: "expired" };

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
    });
  }
  await setDoc(
    doc(userTeamsCol(uid), invite.team_id),
    { role: existing?.role || invite.role, name: team.name, slug: team.slug, joined_at: now },
    { merge: true }
  );
  if (invite.status === "pending") {
    await updateDoc(doc(invitesCol(), token), { status: "accepted" as InviteStatus });
  }
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

/** Best-effort: all invites for a team (owner/admin management view). */
export async function listTeamInvites(teamId: string): Promise<Invite[]> {
  const q = query(invitesCol(), where("team_id", "==", teamId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => inviteFromDoc(d.id, d.data()));
}

/** Optional: collection-group lookup, useful if a caller only has a uid and no mirror. */
export async function findMembershipsAcrossTeams(uid: string): Promise<{ teamId: string; role: TeamRole }[]> {
  const q = query(collectionGroup(db, "members"), where("uid", "==", uid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({
    teamId: d.ref.parent.parent?.id || "",
    role: (d.data().role as TeamRole) || "member",
  }));
}
