"use client";

import Link from "next/link";
import {
  ActivityItem,
  FolderBucket,
  LibraryStats,
  TagBucket,
} from "@/lib/libraryIndex";

type Props = {
  stats: LibraryStats;
  folders: FolderBucket[];
  tags: TagBucket[];
  activity: ActivityItem[];
  folderFilter: string;
  tagFilter: string;
  statusFilter: string;
  inboxCount?: number;
  inboxActive?: boolean;
  onFolder: (v: string) => void;
  onTag: (v: string) => void;
  onStatus: (v: string) => void;
  onInbox?: (active: boolean) => void;
};

export default function LibraryRail({
  stats,
  folders,
  tags,
  activity,
  folderFilter,
  tagFilter,
  statusFilter,
  inboxCount = 0,
  inboxActive = false,
  onFolder,
  onTag,
  onStatus,
  onInbox,
}: Props) {
  const totalNotes = folders.reduce((sum, f) => sum + f.count, 0);
  const scoped = Boolean(folderFilter);

  return (
    <aside className="kb-rail">
      <section className="kb-rail-section">
        <h3>{scoped ? "此資料夾" : "總覽"}</h3>
        <div className="kb-stat-grid">
          <Stat label="筆記" value={stats.noteCount} />
          {!scoped ? <Stat label="轉錄" value={stats.jobCount} /> : null}
          <Stat label="標籤" value={stats.tagCount} />
          <Stat label="資料夾" value={stats.folderCount} />
          <Stat label="字數" value={formatNum(stats.wordCount)} />
          <Stat label="本週更新" value={stats.updatedThisWeek} />
          <Stat label="有連結" value={stats.linkedCount} />
          <Stat label="空白" value={stats.emptyCount} />
        </div>
      </section>

      <section className="kb-rail-section">
        <h3>捷徑</h3>
        <div className="kb-shortcuts">
          {onInbox ? (
            <button
              type="button"
              className={`kb-shortcut-btn${inboxActive ? " is-active" : ""}`}
              onClick={() => onInbox(!inboxActive)}
            >
              待整理{inboxCount > 0 ? ` (${inboxCount})` : ""}
            </button>
          ) : null}
          <Link
            href={`/library?folder=${encodeURIComponent("深度研究")}`}
            className="is-pin"
          >
            深度研究
          </Link>
          <Link href="/journal">日誌</Link>
          <Link href="/board">看板</Link>
          <Link href="/graph">連結圖</Link>
          <Link href="/canvas">白板</Link>
          <Link href="/capture">捕捉</Link>
          <Link href="/research">啟動研究</Link>
        </div>
      </section>

      <section className="kb-rail-section">
        <h3>資料夾</h3>
        <button
          type="button"
          className={`kb-rail-item${!folderFilter ? " is-active" : ""}`}
          onClick={() => onFolder("")}
        >
          <span>全部</span>
          <em>{totalNotes}</em>
        </button>
        {(() => {
          const pinned = folders.find((f) => f.name === "深度研究");
          const rest = folders.filter((f) => f.name !== "深度研究");
          const ordered = pinned ? [pinned, ...rest] : rest;
          return ordered.map((f) => (
            <button
              key={f.name}
              type="button"
              className={`kb-rail-item${folderFilter === (f.name === "未分類" ? "__none__" : f.name) ? " is-active" : ""}${f.name === "深度研究" ? " is-pin" : ""}`}
              onClick={() => onFolder(f.name === "未分類" ? "__none__" : f.name)}
            >
              <span>{f.name}</span>
              <em>{f.count}</em>
            </button>
          ));
        })()}
      </section>

      <section className="kb-rail-section">
        <h3>狀態</h3>
        {[
          { id: "", label: "全部狀態" },
          { id: "backlog", label: "待辦" },
          { id: "doing", label: "進行中" },
          { id: "done", label: "完成" },
        ].map((s) => (
          <button
            key={s.id || "all"}
            type="button"
            className={`kb-rail-item${statusFilter === s.id ? " is-active" : ""}`}
            onClick={() => onStatus(s.id)}
          >
            <span>{s.label}</span>
          </button>
        ))}
      </section>

      <section className="kb-rail-section">
        <h3>標籤</h3>
        {tags.length === 0 ? (
          <p className="kb-rail-muted">尚未有標籤。在筆記加上 #主題 即可。</p>
        ) : (
          <div className="kb-tag-cloud">
            {tags.slice(0, 28).map((t) => (
              <button
                key={t.name}
                type="button"
                className={`kb-tag${tagFilter === t.name ? " is-active" : ""}`}
                onClick={() => onTag(tagFilter === t.name ? "" : t.name)}
              >
                #{t.name}
                <span>{t.count}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="kb-rail-section">
        <h3>最近動態</h3>
        <ul className="kb-activity">
          {activity.map((a) => (
            <li key={a.id}>
              <Link href={a.href}>
                <strong>{a.title}</strong>
                <span>
                  {a.meta} · {a.at.toLocaleDateString("zh-TW")}
                </span>
              </Link>
            </li>
          ))}
          {activity.length === 0 && <li className="kb-rail-muted">尚無動態</li>}
        </ul>
      </section>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="kb-stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function formatNum(n: number) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}萬`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
