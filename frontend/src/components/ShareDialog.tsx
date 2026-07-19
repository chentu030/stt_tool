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
  { id: "edit", label: "可編輯", hint: "登入者可共同編輯內容（不可改擁有權）" },
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
  const { user } = useAuth();
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

  useEffect(() => {
    if (open) {
      setMode(share?.mode || "view");
      setError("");
      setCopied(false);
      setTeamShared(false);
    }
  }, [open, share]);

  useEffect(() => {
    if (!open || !user) return;
    return listenUserTeams(user.uid, setTeams);
  }, [open, user]);

  useEffect(() => {
    if (!teamId) {
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
    setBusy(true);
    setError("");
    try {
      await disableNoteShare(noteId, share?.token);
      onUpdated(null);
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
        author_name: user.displayName || "",
        note_id: noteId,
        note_title: noteTitle || "未命名筆記",
        pin: pinToo,
      });
      setTeamShared(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "分享到團隊失敗");
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
        <p className="cadence-dialog-msg">產生連結，或直接貼到團隊頻道。</p>

        <div className="share-mode-list" role="radiogroup" aria-label="分享權限">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`share-mode-item${mode === m.id ? " is-on" : ""}`}
              disabled={busy}
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

        {teams.length > 0 && (
          <div className="share-team-block">
            <h3 className="share-team-title">分享到團隊頻道</h3>
            <div className="share-team-row">
              <select className="input" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                <option value="">選擇團隊</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <select
                className="input"
                value={channelId}
                disabled={!teamId}
                onChange={(e) => setChannelId(e.target.value)}
              >
                <option value="">選擇頻道</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    # {c.name}
                  </option>
                ))}
              </select>
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

        {error && <p className="cadence-dialog-msg" style={{ color: "var(--danger)" }}>{error}</p>}

        <div className="cadence-dialog-actions">
          {enabled && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void disable()}>
              停止分享
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            關閉
          </button>
          {!enabled && (
            <button type="button" className="btn" disabled={busy} onClick={() => void enable()}>
              {busy ? "…" : "開啟分享"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
