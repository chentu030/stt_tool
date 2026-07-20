"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { updateNote, type Note } from "@/lib/firebase";
import { normalizeWebUrl, webUrlFromNote } from "@/lib/workspacePages";
import { resolveEmbedUrl } from "@/lib/embedUrls";

type Props = {
  note: Pick<Note, "id" | "title" | "props" | "app_link">;
  compact?: boolean;
  /** When true, URL changes stay local (TipTap embed) */
  ephemeral?: boolean;
  onTitleHint?: (title: string) => void;
  onUrlChange?: (url: string) => void;
};

export default function WebPageView({
  note,
  compact,
  ephemeral,
  onTitleHint,
  onUrlChange,
}: Props) {
  const saved = webUrlFromNote(note);
  const [draft, setDraft] = useState(saved || "https://");
  const [active, setActive] = useState(saved || "");
  const [frameKey, setFrameKey] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(saved || "https://");
    setActive(saved || "");
  }, [saved, note.id]);

  const resolved = useMemo(() => {
    if (!active) return null;
    const r = resolveEmbedUrl(active);
    if (!r) {
      return {
        kind: "web" as const,
        src: active,
        title: active,
        original: active,
        frameable: true,
      };
    }
    // Browser pages: attempt iframe even when embed helper marks link as unframeable
    if (r.kind === "link" || r.kind === "web") {
      return { ...r, kind: "web" as const, frameable: true, src: r.original || r.src };
    }
    return r;
  }, [active]);

  const persist = useCallback(
    async (url: string) => {
      const next = normalizeWebUrl(url);
      if (!next) return;
      setBusy(true);
      setActive(next);
      setDraft(next);
      setFrameKey((k) => k + 1);
      onUrlChange?.(next);
      try {
        let title = note.title;
        try {
          const host = new URL(next).hostname.replace(/^www\./, "");
          if (host && (!title || title === "未命名網頁" || title.includes("."))) {
            title = host;
            onTitleHint?.(host);
          }
        } catch {
          /* ignore */
        }
        if (ephemeral) return;
        await updateNote(note.id, {
          props: { ...(note.props || {}), web_url: next },
          ...(title && title !== note.title ? { title } : {}),
        });
      } finally {
        setBusy(false);
      }
    },
    [note.id, note.props, note.title, onTitleHint, onUrlChange, ephemeral]
  );

  const go = () => {
    void persist(draft);
  };

  return (
    <div className={`web-page-view${compact ? " is-compact" : ""}`}>
      <div className="web-page-chrome">
        <button
          type="button"
          className="web-page-btn"
          title="重新整理"
          disabled={!active || busy}
          onClick={() => setFrameKey((k) => k + 1)}
        >
          ↻
        </button>
        <form
          className="web-page-url-form"
          onSubmit={(e) => {
            e.preventDefault();
            go();
          }}
        >
          <input
            className="web-page-url"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="https://"
            spellCheck={false}
            aria-label="網址"
          />
        </form>
        <button type="button" className="web-page-btn" disabled={busy} onClick={go}>
          前往
        </button>
        {active ? (
          <a
            className="web-page-btn web-page-external"
            href={active}
            target="_blank"
            rel="noopener noreferrer"
            title="用系統瀏覽器開啟"
          >
            ↗
          </a>
        ) : null}
      </div>
      <div className="web-page-stage">
        {!active ? (
          <div className="web-page-empty">
            <p>輸入網址，把這個分頁當成瀏覽器使用。</p>
          </div>
        ) : resolved && !resolved.frameable ? (
          <div className="web-page-blocked">
            <p>此網站不允許嵌入預覽（常見於 Google、社群網站等）。</p>
            <a className="btn" href={resolved.original} target="_blank" rel="noopener noreferrer">
              用外部瀏覽器開啟
            </a>
          </div>
        ) : (
          <iframe
            key={`${active}-${frameKey}`}
            className="web-page-frame"
            src={resolved?.src || active}
            title={resolved?.title || "網頁"}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
            referrerPolicy="no-referrer-when-downgrade"
          />
        )}
      </div>
    </div>
  );
}
