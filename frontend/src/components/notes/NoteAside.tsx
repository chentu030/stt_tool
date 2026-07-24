"use client";

import Link from "next/link";
import { HeadingItem, NoteStats, RelatedNote } from "@/lib/noteMeta";
import { openGlobalAiRail } from "@/components/shell/GlobalAiDock";
import NoteAsideRecording from "@/components/notes/NoteAsideRecording";
import NoteKnowledgePropsPanel from "@/components/notes/NoteKnowledgePropsPanel";
import NoteWritingGoalEditor from "@/components/notes/NoteWritingGoalEditor";
import type { LiveSegment } from "@/lib/liveSegments";
import type { Note } from "@/lib/firebase";
import type { WritingGoalProgress } from "@/lib/writingGoals";

type OutboundLink = {
  title: string;
  href?: string;
};

type Backlink = {
  id: string;
  title: string;
};

type PropRelationView = {
  label: string;
  titles: OutboundLink[];
};

type ReverseRelationView = {
  id: string;
  title: string;
  via: string;
};

type LinkCandidate = {
  id: string;
  title: string;
};

export type NoteAsideTab = "outline" | "info" | "recording";

type Props = {
  stats: NoteStats;
  outline: HeadingItem[];
  related: RelatedNote[];
  outbound?: OutboundLink[];
  backlinks?: Backlink[];
  propRelations?: PropRelationView[];
  reverseRelations?: ReverseRelationView[];
  onJumpHeading?: (item: HeadingItem) => void;
  /** Search / open / insert wiki links */
  linkPicker?: string;
  onLinkPickerChange?: (q: string) => void;
  linkCandidates?: LinkCandidate[];
  onOpenWikiNote?: (title: string, noteId?: string | null) => void;
  onInsertWiki?: (title: string) => void;
  open: boolean;
  tab: NoteAsideTab;
  onTab: (t: NoteAsideTab) => void;
  widthPx?: number;
  onResizeWidth?: (px: number) => void;
  liveSegments?: LiveSegment[];
  onJumpOrganize?: () => void;
  onUpdateLiveSegment?: (id: string, text: string) => Promise<void> | void;
  onDeleteLiveSegment?: (id: string) => Promise<void> | void;
  recordingExportFilename?: string;
  canEditRecording?: boolean;
  /** Keep「錄音」tab visible while a live session is active (even before first segment). */
  showRecordingTab?: boolean;
  /** Non-database note 屬性／關係 panel (same component as editor chrome). */
  knowledgeNote?: Note | null;
  knowledgeUserId?: string;
  knowledgeReadOnly?: boolean;
  onKnowledgePropsPatch?: (props: Record<string, unknown>) => void;
  resolveNoteHref?: (title: string) => string | undefined;
  goalProgress?: WritingGoalProgress | null;
};

export default function NoteAside({
  stats,
  outline,
  related,
  outbound = [],
  backlinks = [],
  propRelations = [],
  reverseRelations = [],
  onJumpHeading,
  linkPicker = "",
  onLinkPickerChange,
  linkCandidates = [],
  onOpenWikiNote,
  onInsertWiki,
  open,
  tab,
  onTab,
  widthPx = 300,
  onResizeWidth,
  liveSegments = [],
  onJumpOrganize,
  onUpdateLiveSegment,
  onDeleteLiveSegment,
  recordingExportFilename,
  canEditRecording = false,
  showRecordingTab = false,
  knowledgeNote = null,
  knowledgeUserId,
  knowledgeReadOnly = false,
  onKnowledgePropsPatch,
  resolveNoteHref,
  goalProgress = null,
}: Props) {
  if (!open) return null;

  const q = linkPicker.trim();
  const showLinkSearch = !!onLinkPickerChange;
  const hasRecording = liveSegments.length > 0 || showRecordingTab;
  const tabs: { id: NoteAsideTab; label: string }[] = [
    { id: "outline", label: "大綱" },
    ...(hasRecording
      ? [
          {
            id: "recording" as const,
            label: liveSegments.length ? `錄音 (${liveSegments.length})` : "錄音",
          },
        ]
      : []),
    { id: "info", label: "資訊" },
  ];

  return (
    <aside className="note-aside" style={{ width: widthPx }}>
      {onResizeWidth && (
        <div
          className="note-aside-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="調整側欄寬度"
          title="拖曳調整寬度"
          onPointerDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startW = widthPx;
            const onMove = (ev: globalThis.PointerEvent) => {
              const dx = startX - ev.clientX;
              const next = Math.round(Math.min(560, Math.max(220, startW + dx)));
              onResizeWidth(next);
            };
            const onUp = () => {
              window.removeEventListener("pointermove", onMove);
              window.removeEventListener("pointerup", onUp);
              window.removeEventListener("pointercancel", onUp);
            };
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
            window.addEventListener("pointercancel", onUp);
          }}
        />
      )}
      <div className="note-aside-tabs">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "is-active" : ""}
            onClick={() => onTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {showLinkSearch && (
        <div className="doc-link-insert doc-link-insert--aside">
          <input
            className="doc-prop-input doc-link-input"
            placeholder="搜尋筆記… Enter 開啟"
            value={linkPicker}
            onChange={(e) => onLinkPickerChange?.(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                onLinkPickerChange?.("");
                return;
              }
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (!q) return;
              if (linkCandidates[0]) onOpenWikiNote?.(linkCandidates[0].title);
              else onOpenWikiNote?.(q);
            }}
            aria-label="搜尋筆記"
          />
          {q && (
            <div className="doc-link-menu doc-link-menu--aside">
              {linkCandidates.length === 0 ? (
                <button
                  type="button"
                  className="doc-link-row-main"
                  onClick={() => onOpenWikiNote?.(q)}
                >
                  <strong>{`建立並開啟「${q}」`}</strong>
                  <span>新筆記</span>
                </button>
              ) : (
                linkCandidates.map((n) => (
                  <div key={n.id} className="doc-link-row">
                    <button
                      type="button"
                      className="doc-link-row-main"
                      onClick={() => onOpenWikiNote?.(n.title)}
                    >
                      <strong>{n.title || "未命名"}</strong>
                      <span>開啟</span>
                    </button>
                    <button
                      type="button"
                      className="doc-link-row-link"
                      title="插入雙向連結到本文"
                      onClick={() => onInsertWiki?.(n.title)}
                    >
                      連結
                    </button>
                  </div>
                ))
              )}
              {linkCandidates.length > 0 &&
                !linkCandidates.some(
                  (n) => n.title.trim().toLowerCase() === q.toLowerCase()
                ) && (
                  <button
                    type="button"
                    className="doc-link-row-main doc-link-row-create"
                    onClick={() => onOpenWikiNote?.(q)}
                  >
                    <strong>{`建立「${q}」`}</strong>
                    <span>新筆記</span>
                  </button>
                )}
            </div>
          )}
        </div>
      )}

      {tab === "recording" && (
        <NoteAsideRecording
          segments={liveSegments}
          onJumpOrganize={onJumpOrganize}
          onUpdateSegment={onUpdateLiveSegment}
          onDeleteSegment={onDeleteLiveSegment}
          exportFilename={recordingExportFilename}
          canEdit={canEditRecording}
        />
      )}

      {tab === "outline" && (
        <div className="note-aside-body">
          {outline.length === 0 ? (
            <p className="note-aside-empty">尚無標題。用 H1／H2 或輸入 # 建立結構。</p>
          ) : (
            <nav className="note-toc" aria-label="大綱">
              {outline.map((h) => (
                <div key={h.id} className={`note-toc-row level-${h.level}`}>
                  <button
                    type="button"
                    className={`note-toc-item level-${h.level}`}
                    onClick={() => onJumpHeading?.(h)}
                    title={h.text}
                  >
                    <span className="note-toc-level" aria-hidden>
                      H{h.level}
                    </span>
                    <span className="note-toc-label">{h.text}</span>
                  </button>
                </div>
              ))}
            </nav>
          )}
          {related.length > 0 && (
            <div className="note-aside-block">
              <h4>相關筆記</h4>
              <ul className="note-related">
                {related.map((r) => (
                  <li key={r.id}>
                    <Link href={`/notes/${r.id}`}>
                      <strong>{r.title}</strong>
                      <span>{r.reason}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === "info" && (
        <div className="note-aside-body">
          {knowledgeNote ? (
            <NoteKnowledgePropsPanel
              note={knowledgeNote}
              userId={knowledgeUserId || knowledgeNote.user_id}
              readOnly={knowledgeReadOnly || !onKnowledgePropsPatch}
              variant="aside"
              resolveNoteHref={resolveNoteHref}
              onPropsPatch={onKnowledgePropsPatch || (() => {})}
            />
          ) : null}
          <div className="note-stat-grid">
            <div><strong>{stats.words}</strong><span>字詞</span></div>
            <div><strong>{stats.chars}</strong><span>字元</span></div>
            <div><strong>{stats.readingMins} 分</strong><span>閱讀</span></div>
            <div><strong>{stats.headings}</strong><span>標題</span></div>
            <div><strong>{stats.links}</strong><span>連結</span></div>
            <div><strong>{stats.todosDone}/{stats.todos}</strong><span>待辦</span></div>
          </div>
          {goalProgress ? (
            <div className="note-aside-block note-aside-goal">
              <h4>目標進度</h4>
              <p className="note-aside-goal-summary">{goalProgress.summary}</p>
              {goalProgress.goal.minWords || goalProgress.goal.dailyQuota ? (
                <div className="note-aside-goal-bar" aria-hidden>
                  <i
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          ((goalProgress.minProgress ?? goalProgress.dailyProgress) || 0) * 100
                        )
                      )}%`,
                    }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          {knowledgeNote && onKnowledgePropsPatch ? (
            <NoteWritingGoalEditor
              propsBag={knowledgeNote.props}
              onPropsPatch={onKnowledgePropsPatch}
              readOnly={knowledgeReadOnly}
              compact
            />
          ) : null}
          <div className="note-aside-block">
            <h4>快捷鍵</h4>
            <ul className="note-shortcuts">
              <li><kbd>/</kbd> 或空白段 <kbd>Space</kbd> 插入區塊</li>
              <li><kbd>/ai</kbd> Albireus AI 動作</li>
              <li>
                <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> 全局 AI{" "}
                <button type="button" className="doc-cmd" onClick={() => openGlobalAiRail()}>
                  開啟
                </button>
              </li>
              <li><kbd>@</kbd> 提及頁面／日期／人名</li>
              <li><kbd>[[</kbd> 連結筆記</li>
              <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> 復原　<kbd>Ctrl</kbd>+<kbd>Y</kbd> 重做</li>
              <li><kbd>Ctrl</kbd>+<kbd>D</kbd> 複製區塊</li>
              <li><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>↑↓</kbd> 移動區塊</li>
              <li><kbd>Ctrl</kbd>+<kbd>P</kbd>／<kbd>K</kbd> 快速搜尋</li>
              <li><kbd>Ctrl</kbd>+<kbd>S</kbd> 手動儲存</li>
              <li><kbd>Ctrl</kbd>+<kbd>F</kbd> 尋找</li>
              <li><kbd>Ctrl</kbd>+<kbd>\\</kbd> 側欄</li>
            </ul>
          </div>
          <p className="note-aside-hint">自動儲存約每 1.2 秒；版本歷史可從上方選單還原。</p>
        </div>
      )}

      <div className="note-aside-block note-aside-links">
        <div className="doc-backlinks-head">
          <h4>連結圖譜</h4>
          <Link href="/graph">開啟圖譜 →</Link>
        </div>
        {propRelations.length > 0 && (
          <div className="note-aside-block note-aside-rels">
            <p className="doc-link-label">關係屬性</p>
            {propRelations.map((rel) => (
              <div key={rel.label} className="note-rel-group">
                <span className="note-rel-label">{rel.label}</span>
                <div className="note-rel-links">
                  {rel.titles.map((t) =>
                    t.href ? (
                      <Link key={t.title} href={t.href} className="doc-link-item">
                        {t.title}
                      </Link>
                    ) : (
                      <span key={t.title} className="doc-link-missing">
                        {t.title}（未建立）
                      </span>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="doc-link-grid doc-link-grid--aside">
          <div>
            <p className="doc-link-label">此頁連出</p>
            {outbound.length === 0 ? (
              <p className="note-aside-empty">尚無 [[連結]]</p>
            ) : (
              outbound.map((t) =>
                t.href ? (
                  <div key={t.title}>
                    <Link href={t.href} className="doc-link-item">
                      {t.title}
                    </Link>
                  </div>
                ) : (
                  <div key={t.title} className="doc-link-missing">
                    {t.title}（未建立）
                  </div>
                )
              )
            )}
          </div>
          <div>
            <p className="doc-link-label">連到此頁</p>
            {backlinks.length === 0 && reverseRelations.length === 0 ? (
              <p className="note-aside-empty">尚無反向連結</p>
            ) : (
              <>
                {backlinks.map((n) => (
                  <div key={n.id}>
                    <Link href={`/notes/${n.id}`} className="doc-link-item">
                      {n.title}
                    </Link>
                  </div>
                ))}
                {reverseRelations
                  .filter((r) => !backlinks.some((b) => b.id === r.id))
                  .map((r) => (
                    <div key={`rev-${r.id}`}>
                      <Link href={`/notes/${r.id}`} className="doc-link-item">
                        {r.title}
                      </Link>
                      <span className="note-rel-via"> ← {r.via}</span>
                    </div>
                  ))}
              </>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
