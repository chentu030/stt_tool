"use client";

import { useEffect, useState } from "react";
import type { Note } from "@/lib/firebase";
import {
  FM_STATUS_PROP,
  extractPropRelations,
  isInboxCandidate,
  isOrganized,
  noteTypeOf,
  withNoteType,
  withOrganizedFlag,
} from "@/lib/noteKnowledge";
import { askPrompt } from "@/lib/dialogs";

type Props = {
  note: Note;
  readOnly?: boolean;
  onPropsPatch: (props: Record<string, unknown>) => void;
};

/** Lightweight 屬性 row for notes that are not in a Cadence database. */
export default function NoteKnowledgePropsPanel({ note, readOnly, onPropsPatch }: Props) {
  const type = noteTypeOf(note);
  const [draftType, setDraftType] = useState(type);
  useEffect(() => {
    setDraftType(type);
  }, [note.id, type]);

  const fmStatus =
    note.props?.[FM_STATUS_PROP] != null
      ? String(note.props[FM_STATUS_PROP]).trim()
      : "";
  const relations = extractPropRelations(note.props);
  const organized = isOrganized(note);
  const inbox = isInboxCandidate(note);

  if (note.database_id) return null;

  const extras =
    note.props && typeof note.props.frontmatter === "object"
      ? Object.entries(note.props.frontmatter as Record<string, unknown>).filter(
          ([k]) => !["created", "updated", "date"].includes(k)
        )
      : [];

  const hasAnything =
    type || fmStatus || relations.length > 0 || organized || inbox || extras.length > 0;

  if (!hasAnything && readOnly) return null;

  return (
    <div className="nk-props" aria-label="筆記屬性">
      <div className="nk-props-row">
        <label className="nk-props-key">類型</label>
        {readOnly ? (
          <span className="nk-props-val">{type || "—"}</span>
        ) : (
          <input
            className="doc-prop-input nk-props-input"
            placeholder="例如：專案、人物、會議"
            value={draftType}
            onChange={(e) => setDraftType(e.target.value)}
            onBlur={() => {
              const next = draftType.trim();
              if (next === type) return;
              onPropsPatch(withNoteType(note.props, next));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
        )}
      </div>

      {fmStatus ? (
        <div className="nk-props-row">
          <label className="nk-props-key">狀態</label>
          <span className="nk-props-val">{fmStatus}</span>
        </div>
      ) : null}

      {relations.map((rel) => (
        <div key={rel.key} className="nk-props-row nk-props-row--rel">
          <label className="nk-props-key" title={rel.key}>
            {rel.label}
          </label>
          <div className="nk-props-val nk-props-links">
            {rel.titles.map((t) => (
              <span key={t} className="nk-wiki-chip">
                [[{t}]]
              </span>
            ))}
          </div>
        </div>
      ))}

      {extras.slice(0, 8).map(([k, v]) => (
        <div key={k} className="nk-props-row">
          <label className="nk-props-key">{k}</label>
          <span className="nk-props-val">
            {Array.isArray(v) ? v.map(String).join(", ") : String(v ?? "")}
          </span>
        </div>
      ))}

      {!readOnly && (
        <div className="nk-props-actions">
          {inbox || !organized ? (
            <button
              type="button"
              className="doc-cmd"
              onClick={() => onPropsPatch(withOrganizedFlag(note.props, true))}
            >
              標為已整理
            </button>
          ) : (
            <button
              type="button"
              className="doc-cmd"
              onClick={() => onPropsPatch(withOrganizedFlag(note.props, false))}
            >
              改回待整理
            </button>
          )}
          <button
            type="button"
            className="doc-cmd"
            onClick={() => {
              void (async () => {
                const next = await askPrompt("設定類型", type || "專案");
                if (next == null) return;
                setDraftType(next.trim());
                onPropsPatch(withNoteType(note.props, next.trim()));
              })();
            }}
          >
            設類型…
          </button>
          {inbox ? <span className="nk-inbox-badge">待整理</span> : null}
          {organized ? <span className="nk-org-badge">已整理</span> : null}
        </div>
      )}

      {readOnly && inbox ? <span className="nk-inbox-badge">待整理</span> : null}
      {readOnly && organized ? <span className="nk-org-badge">已整理</span> : null}
    </div>
  );
}
