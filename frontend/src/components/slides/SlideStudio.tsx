"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { saveAs } from "file-saver";
import SlideStage from "./SlideStage";
import {
  SlideDeck,
  SlideBlock,
  SlideLayoutId,
  SLIDE_LAYOUTS,
  SLIDE_THEMES,
  applyLayoutToSlide,
  buildLayoutSlide,
  clampBlock,
  deckFromMarkdown,
  getTheme,
  uid,
} from "@/lib/slideDeck";

type Props = {
  open: boolean;
  noteTitle: string;
  noteBody: string;
  deck: SlideDeck;
  onChange: (deck: SlideDeck) => void;
  onClose: () => void;
};

export default function SlideStudio({
  open,
  noteTitle,
  noteBody,
  deck,
  onChange,
  onClose,
}: Props) {
  const [idx, setIdx] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [busy, setBusy] = useState("");
  const stageRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  const slide = deck.slides[idx] || deck.slides[0];
  const theme = getTheme(deck.theme);

  useEffect(() => {
    if (!open) {
      setPresenting(false);
      setSelectedId(null);
      setEditingId(null);
    }
  }, [open]);

  useEffect(() => {
    if (idx >= deck.slides.length) setIdx(Math.max(0, deck.slides.length - 1));
  }, [deck.slides.length, idx]);

  const patchDeck = useCallback(
    (fn: (d: SlideDeck) => SlideDeck) => {
      onChange(fn({ ...deck, updatedAt: Date.now() }));
    },
    [deck, onChange]
  );

  const updateSlideBlocks = (slideId: string, blocks: SlideBlock[]) => {
    patchDeck((d) => ({
      ...d,
      slides: d.slides.map((s) => (s.id === slideId ? { ...s, blocks } : s)),
    }));
  };

  const onChangeBlock = (id: string, patch: Partial<SlideBlock>) => {
    if (!slide) return;
    const blocks = slide.blocks.map((b) =>
      b.id === id ? clampBlock({ ...b, ...patch }) : b
    );
    updateSlideBlocks(slide.id, blocks);
  };

  const setLayout = (layout: SlideLayoutId) => {
    if (!slide) return;
    patchDeck((d) => ({
      ...d,
      slides: d.slides.map((s) => (s.id === slide.id ? applyLayoutToSlide(s, layout) : s)),
    }));
    setSelectedId(null);
    setEditingId(null);
  };

  const rebuildFromNote = () => {
    if (!confirm("用目前筆記內容重新產生投影片？既有排版會被覆蓋。")) return;
    const next = deckFromMarkdown(noteTitle, noteBody, deck.theme);
    onChange(next);
    setIdx(0);
    setSelectedId(null);
    setEditingId(null);
  };

  const addSlide = () => {
    const s = buildLayoutSlide("bullets", "新投影片", "• 重點一\n• 重點二");
    patchDeck((d) => ({ ...d, slides: [...d.slides, s] }));
    setIdx(deck.slides.length);
  };

  const duplicateSlide = () => {
    if (!slide) return;
    const copy = {
      ...slide,
      id: uid("sl"),
      blocks: slide.blocks.map((b) => ({ ...b, id: uid("tb") })),
    };
    patchDeck((d) => {
      const slides = [...d.slides];
      slides.splice(idx + 1, 0, copy);
      return { ...d, slides };
    });
    setIdx(idx + 1);
  };

  const deleteSlide = () => {
    if (deck.slides.length <= 1) return;
    if (!confirm("刪除此投影片？")) return;
    patchDeck((d) => ({
      ...d,
      slides: d.slides.filter((_, i) => i !== idx),
    }));
    setIdx((i) => Math.max(0, i - 1));
    setSelectedId(null);
  };

  const addTextBlock = () => {
    if (!slide) return;
    const b: SlideBlock = {
      id: uid("tb"),
      type: "text",
      x: 20,
      y: 40,
      w: 60,
      h: 18,
      text: "雙擊編輯文字",
      role: "body",
      scale: 1.2,
      align: "center",
    };
    updateSlideBlocks(slide.id, [...slide.blocks, b]);
    setSelectedId(b.id);
  };

  const addImageBlock = () => {
    if (!slide) return;
    const url = window.prompt("圖片網址", "https://");
    if (!url) return;
    const b: SlideBlock = {
      id: uid("img"),
      type: "image",
      x: 55,
      y: 28,
      w: 38,
      h: 50,
      src: url,
    };
    updateSlideBlocks(slide.id, [...slide.blocks, b]);
    setSelectedId(b.id);
  };

  const deleteSelected = () => {
    if (!slide || !selectedId) return;
    updateSlideBlocks(
      slide.id,
      slide.blocks.filter((b) => b.id !== selectedId)
    );
    setSelectedId(null);
    setEditingId(null);
  };

  const exportPng = async () => {
    const node = exportRef.current;
    if (!node) return;
    setBusy("匯出 PNG…");
    try {
      const dataUrl = await toPng(node, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: theme.bg,
      });
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      saveAs(blob, `${safeName(noteTitle)}-slide-${idx + 1}.png`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "PNG 匯出失敗");
    } finally {
      setBusy("");
    }
  };

  const exportPdf = () => {
    const themeTok = getTheme(deck.theme);
    const pages = deck.slides
      .map((s, i) => {
        const blocks = s.blocks
          .map((b) => {
            if (b.type === "image" && b.src) {
              return `<div style="position:absolute;left:${b.x}%;top:${b.y}%;width:${b.w}%;height:${b.h}%"><img src="${escapeAttr(b.src)}" style="width:100%;height:100%;object-fit:contain"/></div>`;
            }
            const align = b.align || "left";
            const weight = b.bold ? 700 : 500;
            const color =
              b.role === "caption" || b.role === "subtitle" ? themeTok.muted : themeTok.fg;
            const size = 16 * (b.scale || 1);
            const text = escapeHtml(b.text || "").replace(/\n/g, "<br/>");
            return `<div style="position:absolute;left:${b.x}%;top:${b.y}%;width:${b.w}%;height:${b.h}%;text-align:${align};font-weight:${weight};color:${color};font-size:${size}pt;line-height:1.35;overflow:hidden">${text}</div>`;
          })
          .join("");
        return `<section class="page" style="background:${themeTok.bg}"><div class="bar" style="background:${themeTok.accent}"></div>${blocks}<div class="num">${i + 1}</div></section>`;
      })
      .join("");

    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(noteTitle)}</title>
<style>
@page{size: landscape; margin: 0}
html,body{margin:0;padding:0;font-family:"Noto Sans TC","Microsoft JhengHei",sans-serif}
.page{position:relative;width:100vw;height:100vh;page-break-after:always;overflow:hidden;box-sizing:border-box}
.bar{position:absolute;left:0;top:0;width:8px;height:100%}
.num{position:absolute;right:24px;bottom:16px;font-size:12px;opacity:.45;color:${themeTok.muted}}
@media print{.page{width:100%;height:100vh}}
</style></head><body>${pages}</body></html>`;

    const w = window.open("", "_blank", "noopener,noreferrer,width=1100,height=700");
    if (!w) {
      alert("請允許彈出視窗以匯出 PDF");
      return;
    }
    w.document.write(html);
    w.document.close();
    setTimeout(() => {
      w.focus();
      w.print();
    }, 400);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (presenting) {
        if (e.key === "Escape") setPresenting(false);
        if (e.key === "ArrowRight" || e.key === " ") {
          e.preventDefault();
          setIdx((i) => Math.min(i + 1, deck.slides.length - 1));
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setIdx((i) => Math.max(i - 1, 0));
        }
        return;
      }
      if (e.key === "Escape") {
        if (editingId) setEditingId(null);
        else onClose();
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId && !editingId) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presenting, deck.slides.length, selectedId, editingId]);

  const thumbs = useMemo(() => deck.slides, [deck.slides]);

  if (!open || !slide) return null;

  return (
    <div className="slide-studio">
      <header className="slide-studio-bar">
        <div className="slide-studio-title">
          <strong>簡報工作室</strong>
          <span>{noteTitle || "未命名"} · {idx + 1}/{deck.slides.length}</span>
        </div>
        <div className="slide-studio-actions">
          {busy && <span className="slide-busy">{busy}</span>}
          <button type="button" className="doc-cmd" onClick={rebuildFromNote}>從筆記重建</button>
          <button type="button" className="doc-cmd" onClick={() => setPresenting(true)}>播放</button>
          <button type="button" className="doc-cmd" onClick={() => void exportPng()}>PNG</button>
          <button type="button" className="doc-cmd" onClick={exportPdf}>PDF</button>
          <button type="button" className="doc-cmd is-on" onClick={onClose}>完成</button>
        </div>
      </header>

      <div className="slide-studio-body">
        <aside className="slide-thumbs">
          {thumbs.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`slide-thumb${i === idx ? " is-on" : ""}`}
              onClick={() => {
                setIdx(i);
                setSelectedId(null);
                setEditingId(null);
              }}
            >
              <span className="slide-thumb-num">{i + 1}</span>
              <span className="slide-thumb-preview" style={{ background: theme.bg }}>
                <span className="slide-thumb-accent" style={{ background: theme.accent }} />
                <span className="slide-thumb-label" style={{ color: theme.fg }}>
                  {s.blocks.find((b) => b.role === "title")?.text || "投影片"}
                </span>
              </span>
            </button>
          ))}
          <button type="button" className="slide-thumb-add" onClick={addSlide}>＋ 新增</button>
        </aside>

        <main className="slide-stage-wrap">
          <div className="slide-stage-frame">
            <SlideStage
              slide={slide}
              theme={theme}
              selectedId={selectedId}
              editingId={editingId}
              interactive
              stageRef={stageRef}
              onSelect={setSelectedId}
              onChangeBlock={onChangeBlock}
              onEditStart={setEditingId}
              onEditEnd={() => setEditingId(null)}
            />
          </div>
          {/* Hidden export node at fixed 1920×1080 for sharp PNG */}
          <div className="slide-export-host" aria-hidden>
            <div ref={exportRef} className="slide-export-node">
              <SlideStage slide={slide} theme={theme} interactive={false} />
            </div>
          </div>
        </main>

        <aside className="slide-props">
          <p className="slide-props-label">主題</p>
          <div className="slide-theme-row">
            {SLIDE_THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`slide-theme-btn${deck.theme === t.id ? " is-on" : ""}`}
                style={{ background: t.bg, color: t.fg, borderColor: t.accent }}
                onClick={() => patchDeck((d) => ({ ...d, theme: t.id }))}
                title={t.label}
              >
                {t.label}
              </button>
            ))}
          </div>

          <p className="slide-props-label">版型</p>
          <div className="slide-layout-grid">
            {SLIDE_LAYOUTS.map((l) => (
              <button
                key={l.id}
                type="button"
                className={`slide-layout-btn${slide.layout === l.id ? " is-on" : ""}`}
                onClick={() => setLayout(l.id)}
                title={l.hint}
              >
                <strong>{l.label}</strong>
                <span>{l.hint}</span>
              </button>
            ))}
          </div>

          <p className="slide-props-label">區塊</p>
          <div className="slide-prop-actions">
            <button type="button" className="doc-cmd" onClick={addTextBlock}>＋ 文字</button>
            <button type="button" className="doc-cmd" onClick={addImageBlock}>＋ 圖片</button>
            <button type="button" className="doc-cmd" onClick={duplicateSlide}>複製頁</button>
            <button type="button" className="doc-cmd" onClick={deleteSlide} disabled={deck.slides.length <= 1}>刪頁</button>
            <button type="button" className="doc-cmd" onClick={deleteSelected} disabled={!selectedId}>刪區塊</button>
          </div>

          {selectedId && (
            <SelectedBlockProps
              block={slide.blocks.find((b) => b.id === selectedId) || null}
              onChange={(patch) => onChangeBlock(selectedId, patch)}
            />
          )}

          <p className="slide-tip">雙擊文字可編輯 · 拖曳移動 · 右下角縮放 · Esc 關閉</p>
        </aside>
      </div>

      {presenting && (
        <div
          className="slide-present"
          onClick={() => setIdx((i) => Math.min(i + 1, deck.slides.length - 1))}
        >
          <div className="slide-present-bar" onClick={(e) => e.stopPropagation()}>
            <span>{idx + 1} / {deck.slides.length}</span>
            <button type="button" className="doc-cmd" onClick={() => setPresenting(false)}>離開</button>
          </div>
          <div className="slide-present-frame">
            <SlideStage slide={deck.slides[idx]} theme={theme} interactive={false} />
          </div>
        </div>
      )}
    </div>
  );
}

function SelectedBlockProps({
  block,
  onChange,
}: {
  block: SlideBlock | null;
  onChange: (patch: Partial<SlideBlock>) => void;
}) {
  if (!block || block.type !== "text") return null;
  return (
    <div className="slide-block-props">
      <p className="slide-props-label">文字區塊</p>
      <label className="slide-field">
        <span>對齊</span>
        <select
          value={block.align || "left"}
          onChange={(e) => onChange({ align: e.target.value as SlideBlock["align"] })}
        >
          <option value="left">左</option>
          <option value="center">中</option>
          <option value="right">右</option>
        </select>
      </label>
      <label className="slide-field">
        <span>大小</span>
        <input
          type="range"
          min={0.7}
          max={3}
          step={0.05}
          value={block.scale || 1}
          onChange={(e) => onChange({ scale: Number(e.target.value) })}
        />
      </label>
      <label className="slide-field slide-field--check">
        <input
          type="checkbox"
          checked={!!block.bold}
          onChange={(e) => onChange({ bold: e.target.checked })}
        />
        <span>粗體</span>
      </label>
    </div>
  );
}

function safeName(title: string) {
  return (title || "slides").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60);
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
