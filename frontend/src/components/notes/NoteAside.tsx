"use client";

import Link from "next/link";
import { HeadingItem, NoteStats, RelatedNote } from "@/lib/noteMeta";
import { openGlobalAiRail } from "@/components/shell/GlobalAiDock";

type SlidePreview = {
  id: string;
  index: number;
  label: string;
};

type OutboundLink = {
  title: string;
  href?: string;
};

type Backlink = {
  id: string;
  title: string;
};

type Props = {
  stats: NoteStats;
  outline: HeadingItem[];
  related: RelatedNote[];
  outbound?: OutboundLink[];
  backlinks?: Backlink[];
  onJumpHeading?: (item: HeadingItem) => void;
  onOpenSlideForHeading?: (item: HeadingItem) => void;
  /** Presentation bridge in outline tab */
  slidePreview?: {
    slides: SlidePreview[];
    countHint: number;
    stale?: boolean;
    theme: { bg: string; fg: string; accent: string };
    onEnter: (index?: number) => void;
  };
  open: boolean;
  tab: "outline" | "info";
  onTab: (t: "outline" | "info") => void;
  widthPx?: number;
  onResizeWidth?: (px: number) => void;
};

export default function NoteAside({
  stats,
  outline,
  related,
  outbound = [],
  backlinks = [],
  onJumpHeading,
  onOpenSlideForHeading,
  slidePreview,
  open,
  tab,
  onTab,
  widthPx = 300,
  onResizeWidth,
}: Props) {
  if (!open) return null;

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
        {(
          [
            ["outline", "大綱"],
            ["info", "資訊"],
          ] as const
        ).map(([id, label]) => (
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

      {tab === "outline" && (
        <div className="note-aside-body">
          {slidePreview && (
            <div className="note-aside-slides">
              <button
                type="button"
                className={`doc-slide-bridge${slidePreview.stale ? " is-stale" : ""}`}
                onClick={() => slidePreview.onEnter()}
              >
                <span className="doc-slide-bridge-main">
                  {slidePreview.slides.length
                    ? `編輯簡報 · ${slidePreview.countHint} 頁`
                    : `產生簡報 · 約 ${slidePreview.countHint} 頁`}
                </span>
                <span className="doc-slide-bridge-hint">
                  {slidePreview.stale && slidePreview.slides.length ? "進入時會自動同步 · " : ""}
                  點縮圖直達 · ⌘.
                </span>
              </button>
              <div className="doc-slide-strip" role="list" aria-label="投影片預覽">
                {slidePreview.slides.slice(0, 12).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="listitem"
                    className="doc-slide-strip-item"
                    style={{
                      background: slidePreview.theme.bg,
                      color: slidePreview.theme.fg,
                      borderColor: slidePreview.theme.accent,
                    }}
                    onClick={() => slidePreview.onEnter(s.index)}
                    title={s.label}
                  >
                    <span
                      className="doc-slide-strip-accent"
                      style={{ background: slidePreview.theme.accent }}
                    />
                    <span className="doc-slide-strip-num">{s.index + 1}</span>
                    <span className="doc-slide-strip-label">{s.label}</span>
                  </button>
                ))}
                {slidePreview.slides.length > 12 && (
                  <button
                    type="button"
                    className="doc-slide-strip-more"
                    onClick={() => slidePreview.onEnter(12)}
                  >
                    +{slidePreview.slides.length - 12}
                  </button>
                )}
              </div>
            </div>
          )}
          <p className="note-aside-hint">
            點標題跳到段落
            {onOpenSlideForHeading ? "；▷ 開對應投影片" : "（依 Markdown 標題）"}。
            AI 請用右側全局欄或 Ctrl+Shift+A。
          </p>
          {outline.length === 0 ? (
            <p className="note-aside-empty">尚無標題。用 H1／H2 或輸入 # 建立結構。</p>
          ) : (
            <nav className="note-toc">
              {outline.map((h) => (
                <div key={h.id} className={`note-toc-row level-${h.level}`}>
                  <button
                    type="button"
                    className={`note-toc-item level-${h.level}`}
                    onClick={() => onJumpHeading?.(h)}
                  >
                    {h.text}
                  </button>
                  {onOpenSlideForHeading && (
                    <button
                      type="button"
                      className="note-toc-slide"
                      title="在簡報中開啟"
                      onClick={() => onOpenSlideForHeading(h)}
                    >
                      ▷
                    </button>
                  )}
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
          <div className="note-stat-grid">
            <div><strong>{stats.words}</strong><span>字詞</span></div>
            <div><strong>{stats.chars}</strong><span>字元</span></div>
            <div><strong>{stats.readingMins} 分</strong><span>閱讀</span></div>
            <div><strong>{stats.headings}</strong><span>標題</span></div>
            <div><strong>{stats.links}</strong><span>連結</span></div>
            <div><strong>{stats.todosDone}/{stats.todos}</strong><span>待辦</span></div>
          </div>
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
            {backlinks.length === 0 ? (
              <p className="note-aside-empty">尚無反向連結</p>
            ) : (
              backlinks.map((n) => (
                <div key={n.id}>
                  <Link href={`/notes/${n.id}`} className="doc-link-item">
                    {n.title}
                  </Link>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
