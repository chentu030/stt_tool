"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import type { Note } from "@/lib/firebase";
import {
  FM_STATUS_PROP,
  addRelationTitle,
  ensureRelationField,
  isInboxCandidate,
  isOrganized,
  listNoteDatePills,
  listPropRelationFields,
  listScalarProps,
  noteTypeOf,
  relationToneIndex,
  removeRelationTitle,
  removeScalarProp,
  withFmStatus,
  withFrontmatterExtra,
  withNoteType,
  withOrganizedFlag,
} from "@/lib/noteKnowledge";
import { askConfirm, askPrompt } from "@/lib/dialogs";

type Props = {
  note: Note;
  readOnly?: boolean;
  onPropsPatch: (props: Record<string, unknown>) => void;
  /** Resolve wiki title → note href for relationship chips */
  resolveNoteHref?: (title: string) => string | undefined;
  /** `aside` = denser layout for note side panel */
  variant?: "inline" | "aside";
  /** Optional controlled collapse */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  defaultCollapsed?: boolean;
};

function collapseStorageKey(noteId: string) {
  return `cadence_nk_props_collapsed_${noteId}`;
}

/** Polished 屬性／關係 panel for notes that are not in a Cadence database. */
export default function NoteKnowledgePropsPanel({
  note,
  readOnly,
  onPropsPatch,
  resolveNoteHref,
  variant = "inline",
  collapsed: collapsedProp,
  onCollapsedChange,
  defaultCollapsed = false,
}: Props) {
  const titleId = useId();
  const type = noteTypeOf(note);
  const [draftType, setDraftType] = useState(type);
  const [editingType, setEditingType] = useState(false);
  const [localCollapsed, setLocalCollapsed] = useState(() => {
    if (typeof collapsedProp === "boolean") return collapsedProp;
    if (typeof window === "undefined") return defaultCollapsed;
    try {
      const v = sessionStorage.getItem(collapseStorageKey(note.id));
      if (v === "1") return true;
      if (v === "0") return false;
    } catch {
      /* ignore */
    }
    return defaultCollapsed;
  });

  const collapsed = typeof collapsedProp === "boolean" ? collapsedProp : localCollapsed;
  const setCollapsed = (next: boolean) => {
    onCollapsedChange?.(next);
    if (typeof collapsedProp !== "boolean") setLocalCollapsed(next);
    try {
      sessionStorage.setItem(collapseStorageKey(note.id), next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    setDraftType(type);
  }, [note.id, type]);

  useEffect(() => {
    if (typeof collapsedProp === "boolean") return;
    try {
      const v = sessionStorage.getItem(collapseStorageKey(note.id));
      if (v === "1") setLocalCollapsed(true);
      else if (v === "0") setLocalCollapsed(false);
    } catch {
      /* ignore */
    }
  }, [note.id, collapsedProp]);

  const fmStatus =
    note.props?.[FM_STATUS_PROP] != null
      ? String(note.props[FM_STATUS_PROP]).trim()
      : "";
  const relations = listPropRelationFields(note.props);
  const scalars = listScalarProps(note.props);
  const dates = listNoteDatePills(note);
  const organized = isOrganized(note);
  const inbox = isInboxCandidate(note);

  if (note.database_id) return null;

  const hasAnything =
    type ||
    fmStatus ||
    relations.length > 0 ||
    scalars.length > 0 ||
    dates.length > 0 ||
    organized ||
    inbox;

  if (!hasAnything && readOnly) return null;

  const patchType = (next: string) => {
    const t = next.trim();
    setDraftType(t);
    if (t === type) return;
    onPropsPatch(withNoteType(note.props, t));
  };

  const addProperty = async () => {
    const key = await askPrompt({
      title: "新增屬性",
      message: "屬性名稱（例如：優先級、地點）",
      placeholder: "屬性名稱",
    });
    if (key == null) return;
    const k = key.trim();
    if (!k) return;
    const value = await askPrompt({
      title: "屬性值",
      message: `「${k}」的內容`,
      placeholder: "文字",
    });
    if (value == null) return;
    onPropsPatch(withFrontmatterExtra(note.props, k, value));
  };

  const addRelationship = async () => {
    const key = await askPrompt({
      title: "新增關係",
      message: "關係名稱（例如：屬於、相關、專案）",
      defaultValue: "相關",
      placeholder: "關係名稱",
    });
    if (key == null) return;
    const k = key.trim();
    if (!k) return;
    const title = await askPrompt({
      title: "連結筆記",
      message: "輸入筆記標題（可稍後再補）",
      placeholder: "筆記標題",
    });
    if (title == null) {
      onPropsPatch(ensureRelationField(note.props, k));
      return;
    }
    const t = title.trim();
    if (!t) {
      onPropsPatch(ensureRelationField(note.props, k));
      return;
    }
    onPropsPatch(addRelationTitle(ensureRelationField(note.props, k), k, t));
  };

  const addLinkToRelation = async (relKey: string, relLabel: string) => {
    const title = await askPrompt({
      title: "新增連結",
      message: `「${relLabel}」要連到哪一則筆記？`,
      placeholder: "筆記標題",
    });
    if (title == null) return;
    const t = title.trim();
    if (!t) return;
    onPropsPatch(addRelationTitle(note.props, relKey, t));
  };

  const editStatus = async () => {
    const next = await askPrompt({
      title: "狀態",
      message: "自由文字狀態（例如：進行中、草稿）",
      defaultValue: fmStatus || "",
      placeholder: "狀態",
    });
    if (next == null) return;
    onPropsPatch(withFmStatus(note.props, next));
  };

  const removeScalar = async (key: string, label: string) => {
    const ok = await askConfirm({
      title: "移除屬性",
      message: `移除「${label}」？`,
      confirmLabel: "移除",
      danger: true,
    });
    if (!ok) return;
    onPropsPatch(removeScalarProp(note.props, key));
  };

  return (
    <section
      className={`nk-props nk-props--${variant}${collapsed ? " is-collapsed" : ""}`}
      aria-label="筆記屬性"
      aria-labelledby={titleId}
    >
      <header className="nk-props-head">
        <div className="nk-props-head-main">
          <strong id={titleId}>屬性</strong>
          {inbox ? <span className="nk-inbox-badge">待整理</span> : null}
          {organized ? <span className="nk-org-badge">已整理</span> : null}
        </div>
        <div className="nk-props-head-actions">
          <button
            type="button"
            className="nk-props-icon-btn"
            aria-expanded={!collapsed}
            aria-label={collapsed ? "展開屬性" : "收合屬性"}
            title={collapsed ? "展開" : "收合"}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? "▸" : "▾"}
          </button>
          <button
            type="button"
            className="nk-props-icon-btn"
            aria-label="關閉屬性面板"
            title="關閉"
            onClick={() => setCollapsed(true)}
          >
            ×
          </button>
        </div>
      </header>

      {collapsed ? (
        <button
          type="button"
          className="nk-props-collapsed-summary"
          onClick={() => setCollapsed(false)}
        >
          {[
            type ? `類型 · ${type}` : null,
            fmStatus ? `狀態 · ${fmStatus}` : null,
            relations.length ? `${relations.length} 組關係` : null,
            scalars.length ? `${scalars.length} 項屬性` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "點擊展開屬性與關係"}
        </button>
      ) : (
        <>
          <div className="nk-props-pills" role="list">
            {readOnly ? (
              type ? (
                <span className="nk-pill nk-pill--type" role="listitem">
                  <span className="nk-pill-label">類型</span>
                  <span className="nk-pill-value">{type}</span>
                </span>
              ) : null
            ) : editingType ? (
              <label className="nk-pill nk-pill--type nk-pill--edit" role="listitem">
                <span className="nk-pill-label">類型</span>
                <input
                  className="nk-pill-input"
                  autoFocus
                  placeholder="專案、人物…"
                  value={draftType}
                  onChange={(e) => setDraftType(e.target.value)}
                  onBlur={() => {
                    setEditingType(false);
                    patchType(draftType);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      (e.target as HTMLInputElement).blur();
                    }
                    if (e.key === "Escape") {
                      setDraftType(type);
                      setEditingType(false);
                    }
                  }}
                />
              </label>
            ) : (
              <button
                type="button"
                className={`nk-pill nk-pill--type${type ? "" : " is-empty"}`}
                role="listitem"
                onClick={() => setEditingType(true)}
              >
                <span className="nk-pill-label">類型</span>
                <span className="nk-pill-value">{type || "新增"}</span>
              </button>
            )}

            {readOnly ? (
              fmStatus ? (
                <span className="nk-pill nk-pill--status" role="listitem">
                  <span className="nk-pill-label">狀態</span>
                  <span className="nk-pill-value">{fmStatus}</span>
                </span>
              ) : null
            ) : (
              <button
                type="button"
                className={`nk-pill nk-pill--status${fmStatus ? "" : " is-empty"}`}
                role="listitem"
                onClick={() => void editStatus()}
              >
                <span className="nk-pill-label">狀態</span>
                <span className="nk-pill-value">{fmStatus || "新增"}</span>
              </button>
            )}

            {dates.map((d) => (
              <span key={d.key} className="nk-pill nk-pill--date" role="listitem" title={d.label}>
                <span className="nk-pill-label">{d.label}</span>
                <span className="nk-pill-value">{d.text}</span>
              </span>
            ))}

            {scalars.map((s) =>
              readOnly ? (
                <span key={s.key} className="nk-pill nk-pill--extra" role="listitem" title={s.key}>
                  <span className="nk-pill-label">{s.label}</span>
                  <span className="nk-pill-value">{s.value}</span>
                </span>
              ) : (
                <button
                  key={s.key}
                  type="button"
                  className="nk-pill nk-pill--extra"
                  role="listitem"
                  title={`${s.key}（點擊移除）`}
                  onClick={() => void removeScalar(s.key, s.label)}
                >
                  <span className="nk-pill-label">{s.label}</span>
                  <span className="nk-pill-value">{s.value}</span>
                </button>
              )
            )}
          </div>

          {(relations.length > 0 || !readOnly) && (
            <div className="nk-rels" aria-label="關係">
              {relations.map((rel) => {
                const tone = relationToneIndex(rel.key);
                return (
                  <div key={rel.key} className="nk-rel-row">
                    <span className="nk-rel-key" title={rel.key}>
                      {rel.label}
                    </span>
                    <div className="nk-rel-chips">
                      {rel.titles.map((t) => {
                        const href = resolveNoteHref?.(t);
                        const chipClass = `nk-rel-chip nk-rel-chip--t${tone}`;
                        return href ? (
                          <span key={t} className="nk-rel-chip-wrap">
                            <Link href={href} className={chipClass}>
                              {t}
                            </Link>
                            {!readOnly ? (
                              <button
                                type="button"
                                className="nk-rel-chip-x"
                                aria-label={`移除 ${t}`}
                                title="移除"
                                onClick={() =>
                                  onPropsPatch(removeRelationTitle(note.props, rel.key, t))
                                }
                              >
                                ×
                              </button>
                            ) : null}
                          </span>
                        ) : (
                          <span key={t} className="nk-rel-chip-wrap">
                            <span className={`${chipClass} is-missing`} title="尚未建立此筆記">
                              {t}
                            </span>
                            {!readOnly ? (
                              <button
                                type="button"
                                className="nk-rel-chip-x"
                                aria-label={`移除 ${t}`}
                                title="移除"
                                onClick={() =>
                                  onPropsPatch(removeRelationTitle(note.props, rel.key, t))
                                }
                              >
                                ×
                              </button>
                            ) : null}
                          </span>
                        );
                      })}
                      {!readOnly ? (
                        <button
                          type="button"
                          className="nk-rel-slot"
                          onClick={() => void addLinkToRelation(rel.key, rel.label)}
                        >
                          新增
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!readOnly && (
            <div className="nk-props-foot">
              <button type="button" className="nk-props-add" onClick={() => void addProperty()}>
                + 新增屬性
              </button>
              <button type="button" className="nk-props-add" onClick={() => void addRelationship()}>
                + 新增關係
              </button>
              {inbox || !organized ? (
                <button
                  type="button"
                  className="nk-props-add nk-props-add--quiet"
                  onClick={() => onPropsPatch(withOrganizedFlag(note.props, true))}
                >
                  標為已整理
                </button>
              ) : (
                <button
                  type="button"
                  className="nk-props-add nk-props-add--quiet"
                  onClick={() => onPropsPatch(withOrganizedFlag(note.props, false))}
                >
                  改回待整理
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
