"use client";

import { useEffect, useState } from "react";
import {
  disableNoteShare,
  enableNoteShare,
  setNoteShareMode,
  shareUrl,
  type NoteShare,
  type ShareMode,
} from "@/lib/share";
import { useAuth } from "@/components/AuthProvider";
import {
  listenUserTeams,
  listenChannels,
  shareNoteToChannel,
  type TeamMembership,
  type Channel,
} from "@/lib/teamStore";
import {
  listenNoteAcl,
  removeNoteAclEntry,
  resolveUidByUsername,
  setNoteAclEntry,
  type NoteAclEntry,
  type NoteAclRole,
} from "@/lib/noteAcl";
import { fetchUserProfile } from "@/lib/userProfile";
import { askConfirm } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import MenuSelect from "@/components/MenuSelect";

type Props = {
  open: boolean;
  onClose: () => void;
  noteId: string;
  ownerId: string;
  noteTitle?: string;
  share: NoteShare | null | undefined;
  onUpdated: (share: NoteShare | null) => void;
};

const MODES: { id: ShareMode; label: string; hint: string }[] = [
  { id: "view", label: "僅檢視", hint: "任何人持連結可唯讀開啟" },
  { id: "edit", label: "可編輯", hint: "登入者可即時共編（字元級合併，不可改擁有權）" },
  { id: "copy", label: "可複製", hint: "可開啟並複製成自己的筆記" },
];

export default function ShareDialog({
  open,
  onClose,
  noteId,
  ownerId,
  noteTitle,
  share,
  onUpdated,
}: Props) {
  const { user, displayName } = useAuth();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<ShareMode>(share?.mode || "view");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [teams, setTeams] = useState<TeamMembership[]>([]);
  const [teamId, setTeamId] = useState("");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelId, setChannelId] = useState("");
  const [pinToo, setPinToo] = useState(true);
  const [teamShared, setTeamShared] = useState(false);
  const [acl, setAcl] = useState<NoteAclEntry[]>([]);
  const [inviteInput, setInviteInput] = useState("");
  const [inviteRole, setInviteRole] = useState<NoteAclRole>("editor");

  useEffect(() => {
    if (!open) return;
    /* Reset ephemeral dialog state when opened */
    /* eslint-disable react-hooks/set-state-in-effect */
    setMode(share?.mode || "view");
    setError("");
    setCopied(false);
    setTeamShared(false);
    setInviteInput("");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, share]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !user) return;
    return listenUserTeams(user.uid, setTeams);
  }, [open, user]);

  useEffect(() => {
    if (!open || !noteId) return;
    return listenNoteAcl(noteId, setAcl);
  }, [open, noteId]);

  useEffect(() => {
    if (!teamId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear channel picker when team cleared
      setChannels([]);
      setChannelId("");
      return;
    }
    return listenChannels(teamId, (list) => {
      setChannels(list);
      setChannelId((cur) => cur || list[0]?.id || "");
    });
  }, [teamId]);

  if (!open) return null;

  const enabled = !!share?.enabled && !!share.token;
  const url = enabled ? shareUrl(share!.token) : "";
  const isOwner = !!user && user.uid === ownerId;

  const enable = async () => {
    setBusy(true);
    setError("");
    try {
      const next = await enableNoteShare(noteId, ownerId, mode, share?.token);
      onUpdated(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const changeMode = async (m: ShareMode) => {
    setMode(m);
    if (!enabled || !share?.token) return;
    setBusy(true);
    setError("");
    try {
      const next = await setNoteShareMode(noteId, ownerId, m, share.token);
      onUpdated(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (
      !(await askConfirm({
        title: "停止分享？",
        message: "連結將立即失效，已分享的人將無法再開啟。",
        danger: true,
        confirmLabel: "停止分享",
      }))
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await disableNoteShare(noteId, share?.token);
      onUpdated(null);
      toast("已停止分享");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast("已複製連結");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("無法複製連結");
    }
  };

  const postToTeam = async () => {
    if (!user || !teamId || !channelId) return;
    setBusy(true);
    setError("");
    try {
      if (!enabled) {
        const next = await enableNoteShare(noteId, ownerId, "edit", share?.token);
        onUpdated(next);
      }
      await shareNoteToChannel({
        teamId,
        channelId,
        author_id: user.uid,
        author_name: displayName || "",
        note_id: noteId,
        note_title: noteTitle || "未命名筆記",
        pin: pinToo,
      });
      setTeamShared(true);
      toast("已送到頻道");
    } catch (e) {
      setError(e instanceof Error ? e.message : "分享到團隊失敗");
    } finally {
      setBusy(false);
    }
  };

  const inviteCollaborator = async () => {
    if (!user || !isOwner) return;
    const raw = inviteInput.trim();
    if (!raw) return;
    setBusy(true);
    setError("");
    try {
      const resolved = await resolveUidByUsername(raw);
      if (!resolved) throw new Error("找不到此用戶名稱，請確認對方已設定 @用戶名");
      if (resolved.uid === ownerId) throw new Error("擁有者無需加入協作者");
      const profile = await fetchUserProfile(resolved.uid);
      await setNoteAclEntry({
        noteId,
        uid: resolved.uid,
        role: inviteRole,
        name: profile?.display_name || resolved.username,
        username: resolved.username,
        invitedBy: user.uid,
      });
      setInviteInput("");
      toast(inviteRole === "editor" ? "已加入可編輯協作者" : "已加入唯讀協作者");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const removeCollaborator = async (uid: string) => {
    if (!isOwner) return;
    setBusy(true);
    setError("");
    try {
      await removeNoteAclEntry(noteId, uid);
      toast("已移除協作者");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const changeAclRole = async (uid: string, role: NoteAclRole) => {
    if (!isOwner || !user) return;
    const row = acl.find((a) => a.uid === uid);
    if (!row) return;
    setBusy(true);
    try {
      await setNoteAclEntry({
        noteId,
        uid,
        role,
        name: row.name,
        username: row.username,
        invitedBy: user.uid,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="cadence-dialog-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cadence-dialog share-dialog" role="dialog" aria-modal="true">
        <h2 className="cadence-dialog-title">分享筆記</h2>
        <p className="cadence-dialog-msg">產生連結、邀請協作者，或貼到團隊頻道。</p>

        <div className="share-mode-list" role="radiogroup" aria-label="分享權限">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`share-mode-item${mode === m.id ? " is-on" : ""}`}
              disabled={busy || !isOwner}
              onClick={() => void changeMode(m.id)}
            >
              <strong>{m.label}</strong>
              <span>{m.hint}</span>
            </button>
          ))}
        </div>

        {enabled ? (
          <div className="share-link-row">
            <input className="input" readOnly value={url} onFocus={(e) => e.target.select()} />
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void copyLink()}>
              {copied ? "已複製" : "複製連結"}
            </button>
          </div>
        ) : (
          <p className="share-off-hint">尚未開啟公開連結。選擇權限後按「開啟分享」。</p>
        )}

        {isOwner && (
          <div className="share-team-block">
            <h3 className="share-team-title">邀請協作者（即時共編）</h3>
            <p className="share-off-hint" style={{ marginTop: 0 }}>
              輸入對方的 @用戶名稱。可編輯者開啟 /notes/此篇 即可即時共編。
            </p>
            <div className="share-acl-invite">
              <input
                className="input"
                placeholder="@username"
                value={inviteInput}
                onChange={(e) => setInviteInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void inviteCollaborator();
                  }
                }}
              />
              <MenuSelect
                variant="soft"
                ariaLabel="協作者權限"
                value={inviteRole}
                options={[
                  { value: "editor", label: "可編輯" },
                  { value: "viewer", label: "唯讀" },
                ]}
                onChange={(v) => setInviteRole(v === "viewer" ? "viewer" : "editor")}
              />
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy || !inviteInput.trim()}
                onClick={() => void inviteCollaborator()}
              >
                邀請
              </button>
            </div>
            {acl.length > 0 && (
              <ul className="share-acl-list">
                {acl.map((row) => (
                  <li key={row.uid} className="share-acl-row">
                    <span>
                      {row.name || row.username || row.uid}
                      {row.username ? (
                        <span className="share-acl-handle"> @{row.username}</span>
                      ) : null}
                    </span>
                    <MenuSelect
                      variant="soft"
                      ariaLabel="變更權限"
                      value={row.role}
                      options={[
                        { value: "editor", label: "可編輯" },
                        { value: "viewer", label: "唯讀" },
                      ]}
                      onChange={(v) => void changeAclRole(row.uid, v === "viewer" ? "viewer" : "editor")}
                    />
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={busy}
                      onClick={() => void removeCollaborator(row.uid)}
                    >
                      移除
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {teams.length > 0 && isOwner && (
          <div className="share-team-block">
            <h3 className="share-team-title">分享到團隊頻道</h3>
            <div className="share-team-row">
              <label className="share-team-select">
                <span className="sr-only">選擇團隊</span>
                <select
                  className="input share-team-native"
                  aria-label="選擇團隊"
                  value={teamId || ""}
                  onChange={(e) => setTeamId(e.target.value)}
                >
                  <option value="">選擇團隊</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="share-team-select">
                <span className="sr-only">選擇頻道</span>
                <select
                  className="input share-team-native"
                  aria-label="選擇頻道"
                  disabled={!teamId}
                  value={channelId || ""}
                  onChange={(e) => setChannelId(e.target.value)}
                >
                  <option value="">選擇頻道</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      # {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="share-team-pin">
              <input type="checkbox" checked={pinToo} onChange={(e) => setPinToo(e.target.checked)} />
              同時釘選到團隊「知識」
            </label>
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy || !teamId || !channelId}
              onClick={() => void postToTeam()}
            >
              {teamShared ? "已送到頻道 ✓" : "送到頻道"}
            </button>
          </div>
        )}

        {error && (
          <p className="cadence-dialog-msg" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}

        <div className="cadence-dialog-actions">
          {enabled && isOwner && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void disable()}>
              停止分享
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            關閉
          </button>
          {!enabled && isOwner && (
            <button type="button" className="btn" disabled={busy} onClick={() => void enable()}>
              {busy ? "…" : "開啟分享"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
