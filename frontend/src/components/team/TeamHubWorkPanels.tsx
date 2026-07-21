"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast";
import { askPrompt } from "@/lib/dialogs";
import { createNote } from "@/lib/firebase";
import {
  listenTeamTasks,
  updateTeamTask,
  deleteTeamTask,
  createTeamTask,
  listenStandupEntries,
  upsertStandupEntry,
  todayStandupKey,
  type TeamMembership,
  type TeamTask,
  type TeamTaskStatus,
  type StandupEntry,
  type TeamFileHit,
} from "@/lib/teamStore";
import {
  getBookmarks,
  removeBookmark,
  type BookmarkItem,
} from "@/lib/teamExtras";

export function TeamTasksPanel({
  teams,
  uid,
  displayName,
}: {
  teams: TeamMembership[];
  uid: string;
  displayName?: string;
}) {
  const router = useRouter();
  const [teamId, setTeamId] = useState(teams[0]?.id || "");
  const [tasks, setTasks] = useState<TeamTask[]>([]);
  const [filter, setFilter] = useState<"all" | TeamTaskStatus>("all");

  useEffect(() => {
    if (teams.length && !teamId) setTeamId(teams[0].id);
  }, [teams, teamId]);

  useEffect(() => {
    if (!teamId) return;
    return listenTeamTasks(teamId, setTasks);
  }, [teamId]);

  const visible = useMemo(
    () => (filter === "all" ? tasks : tasks.filter((t) => t.status === filter)),
    [tasks, filter]
  );

  const addTask = async () => {
    if (!teamId) return;
    const title = await askPrompt({ title: "新增任務", defaultValue: "" });
    if (title == null || !title.trim()) return;
    await createTeamTask(teamId, {
      title: title.trim(),
      created_by: uid,
      assignee_uid: uid,
      assignee_name: displayName,
    });
    toast("已新增任務");
  };

  if (!teams.length) {
    return <p className="tm-hub-empty-hint">先加入團隊再追蹤任務。</p>;
  }

  return (
    <section className="tm-hub-panel">
      <div className="tm-hub-toolbar">
        <select
          className="tm-hub-search"
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
          aria-label="選擇團隊"
        >
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <div className="tm-hub-filters">
          {(["all", "open", "doing", "done"] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`tm-hub-chip${filter === f ? " is-on" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "全部" : f === "open" ? "待辦" : f === "doing" ? "進行中" : "完成"}
            </button>
          ))}
          <button type="button" className="btn btn-sm" onClick={() => void addTask()}>
            ＋ 任務
          </button>
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="tm-hub-empty-hint">
          尚無任務。在訊息上按「轉任務」，把聊天變成可追蹤工作（Slack Lists 缺口）。
        </p>
      ) : (
        <ul className="tm-hub-feed">
          {visible.map((t) => (
            <li key={t.id} className="tm-task-row">
              <select
                className="tm-task-status"
                value={t.status}
                onChange={(e) =>
                  void updateTeamTask(teamId, t.id, {
                    status: e.target.value as TeamTaskStatus,
                  })
                }
                aria-label="任務狀態"
              >
                <option value="open">待辦</option>
                <option value="doing">進行中</option>
                <option value="done">完成</option>
              </select>
              <button
                type="button"
                className="tm-hub-later-main"
                onClick={() => {
                  if (t.channel_id) {
                    const qs = new URLSearchParams({ channel: t.channel_id });
                    if (t.message_id) qs.set("msg", t.message_id);
                    router.push(`/team/${teamId}?${qs}`);
                  }
                }}
              >
                <span className="tm-hub-feed-body">
                  <strong className={t.status === "done" ? "is-strike" : ""}>{t.title}</strong>
                  <span className="tm-hub-feed-meta">
                    {t.assignee_name || "未指派"}
                    {t.due ? ` · 截止 ${t.due}` : ""}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => void deleteTeamTask(teamId, t.id)}
              >
                刪除
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TeamStandupPanel({
  teams,
  uid,
  displayName,
}: {
  teams: TeamMembership[];
  uid: string;
  displayName?: string;
}) {
  const dateKey = todayStandupKey();
  const [teamId, setTeamId] = useState(teams[0]?.id || "");
  const [entries, setEntries] = useState<StandupEntry[]>([]);
  const [yesterday, setYesterday] = useState("");
  const [today, setToday] = useState("");
  const [blockers, setBlockers] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (teams.length && !teamId) setTeamId(teams[0].id);
  }, [teams, teamId]);

  useEffect(() => {
    if (!teamId) return;
    return listenStandupEntries(teamId, dateKey, (list) => {
      setEntries(list);
      const mine = list.find((e) => e.uid === uid);
      if (mine) {
        setYesterday(mine.yesterday);
        setToday(mine.today);
        setBlockers(mine.blockers);
      }
    });
  }, [teamId, dateKey, uid]);

  const save = async () => {
    if (!teamId) return;
    setBusy(true);
    try {
      await upsertStandupEntry(teamId, dateKey, {
        uid,
        name: displayName || "成員",
        yesterday,
        today,
        blockers,
      });
      toast("今日 standup 已送出");
    } catch (e) {
      toast(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setBusy(false);
    }
  };

  if (!teams.length) {
    return <p className="tm-hub-empty-hint">先加入團隊再做非同步 standup。</p>;
  }

  return (
    <section className="tm-hub-panel">
      <div className="tm-hub-toolbar">
        <select
          className="tm-hub-search"
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
        >
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <span className="tm-hub-feed-meta">{dateKey} · 非同步日報（Slack 需裝 Geekbot）</span>
      </div>
      <div className="tm-standup-form">
        <label>
          昨天完成
          <textarea value={yesterday} onChange={(e) => setYesterday(e.target.value)} rows={2} />
        </label>
        <label>
          今天計畫
          <textarea value={today} onChange={(e) => setToday(e.target.value)} rows={2} />
        </label>
        <label>
          阻礙
          <textarea value={blockers} onChange={(e) => setBlockers(e.target.value)} rows={2} />
        </label>
        <button type="button" className="btn" disabled={busy} onClick={() => void save()}>
          {busy ? "送出中…" : "送出今日 standup"}
        </button>
      </div>
      <h3 className="tm-hub-section-title" style={{ marginTop: "1.25rem" }}>
        團隊回覆 · {entries.length}
      </h3>
      {entries.length === 0 ? (
        <p className="tm-hub-empty-hint">還沒有人回覆。</p>
      ) : (
        <ul className="tm-hub-feed">
          {entries.map((e) => (
            <li key={e.uid} className="tm-hub-feed-item" style={{ cursor: "default" }}>
              <span className="tm-hub-feed-body">
                <strong>{e.name}</strong>
                <span className="tm-hub-feed-text">昨：{e.yesterday || "—"}</span>
                <span className="tm-hub-feed-text">今：{e.today || "—"}</span>
                <span className="tm-hub-feed-text">阻：{e.blockers || "—"}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TeamBookmarksStrip({ onOpen }: { onOpen: (b: BookmarkItem) => void }) {
  const [items, setItems] = useState<BookmarkItem[]>([]);
  useEffect(() => {
    setItems(getBookmarks());
  }, []);
  if (!items.length) return null;
  return (
    <div className="tm-hub-section">
      <div className="tm-hub-section-head">
        <h3 className="tm-hub-section-title">個人書籤</h3>
      </div>
      <ul className="tm-hub-feed">
        {items.slice(0, 8).map((b) => (
          <li key={b.id}>
            <div className="tm-hub-feed-item tm-hub-later-item">
              <button type="button" className="tm-hub-later-main" onClick={() => onOpen(b)}>
                <span className="tm-hub-feed-body">
                  <strong>
                    {b.teamName} · #{b.channelName}
                  </strong>
                  <span className="tm-hub-feed-text">{b.text}</span>
                </span>
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setItems(removeBookmark(b.id))}
              >
                移除
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export async function fileHitToNote(
  uid: string,
  hit: TeamFileHit
): Promise<string> {
  const title = hit.message.file_name || "團隊檔案";
  const body = `> 來自團隊檔案 · ${hit.teamName} · #${hit.channelName}\n\n[${title}](${hit.message.file_url || "#"})`;
  return createNote(uid, title, body);
}
