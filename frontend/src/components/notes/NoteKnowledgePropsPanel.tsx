"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Note } from "@/lib/firebase";
import { updateNote } from "@/lib/firebase";
import {
  addRelationTitle,
  ensureRelationField,
  isInboxCandidate,
  isOrganized,
  listNoteDatePills,
  listPropRelationFields,
  listScalarProps,
  relationToneIndex,
  removeRelationTitle,
  removeScalarProp,
  withFrontmatterExtra,
  withOrganizedFlag,
} from "@/lib/noteKnowledge";
import {
  WORKSPACE_SYSTEM_IDS,
  WS_STATUS_ID,
  WS_TYPE_ID,
  asDbProperty,
  createCustomWorkspaceDef,
  ensureWorkspacePropertyDefs,
  getWorkspaceFieldValue,
  healWorkspaceProps,
  listenWorkspacePropertyDefs,
  patchWorkspaceField,
  upsertWorkspacePropertyDef,
  type WorkspacePropertyDef,
} from "@/lib/workspaceProperties";
import PropertyValueEditor from "@/components/notes/PropertyValueEditor";
import { askConfirm, askPrompt } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import type { DbPropType } from "@/lib/database";

type Props = {
  note: Note;
  userId?: string;
  readOnly?: boolean;
  onPropsPatch: (props: Record<string, unknown>) => void;
  /** Full note patch when workspace fields also touch status/body */
  onNotePatch?: (patch: Partial<Note>) => void;
  resolveNoteHref?: (title: string) => string | undefined;
  variant?: "inline" | "aside";
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  defaultCollapsed?: boolean;
  /** Also show database-only columns below workspace fields */
  extraDbProps?: import("@/lib/database").DbProperty[];
  onExtraDbCommit?: (propId: string, value: unknown) => void;
};

function collapseStorageKey(noteId: string) {
  return `cadence_nk_props_collapsed_${noteId}`;
}

/** 屬性／關係 panel — workspace catalog fields + relations + custom scalars. */
export default function NoteKnowledgePropsPanel({
  note,
  userId,
  readOnly,
  onPropsPatch,
  onNotePatch,
  resolveNoteHref,
  variant = "inline",
  collapsed: collapsedProp,
  onCollapsedChange,
  defaultCollapsed = false,
  extraDbProps,
  onExtraDbCommit,
}: Props) {
  const titleId = useId();
  const [defs, setDefs] = useState<WorkspacePropertyDef[]>([]);
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
    if (typeof collapsedProp === "boolean") return;
    try {
      const v = sessionStorage.getItem(collapseStorageKey(note.id));
      if (v === "1") setLocalCollapsed(true);
      else if (v === "0") setLocalCollapsed(false);
    } catch {
      /* ignore */
    }
  }, [note.id, collapsedProp]);

  useEffect(() => {
    if (!userId) return;
    let unsub: (() => void) | undefined;
    void (async () => {
      try {
        await ensureWorkspacePropertyDefs(userId);
        unsub = listenWorkspacePropertyDefs(userId, setDefs);
      } catch (e) {
        console.warn("[workspaceProperties]", e);
      }
    })();
    return () => unsub?.();
  }, [userId]);

  // On-read heal into ws_* (once per note)
  const healedRef = useRef<string>("");
  useEffect(() => {
    if (!userId || readOnly) return;
    if (healedRef.current === note.id) return;
    const healed = healWorkspaceProps(note);
    if (!healed.changed || !healed.props) {
      healedRef.current = note.id;
      return;
    }
    healedRef.current = note.id;
    void updateNote(note.id, {
      props: healed.props,
      ...(healed.status ? { status: healed.status } : {}),
    })
      .then(() => {
        onNotePatch?.({
          props: healed.props,
          ...(healed.status ? { status: healed.status } : {}),
        });
        onPropsPatch(healed.props!);
      })
      .catch(() => {
        healedRef.current = "";
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, userId, readOnly]);

  const activeDefs = useMemo(
    () => defs.filter((d) => !d.archived),
    [defs]
  );
  const systemDefs = useMemo(
    () =>
      WORKSPACE_SYSTEM_IDS.map((id) => activeDefs.find((d) => d.id === id)).filter(
        (d): d is WorkspacePropertyDef => !!d
      ),
    [activeDefs]
  );
  const customCatalogDefs = useMemo(
    () => activeDefs.filter((d) => !(WORKSPACE_SYSTEM_IDS as readonly string[]).includes(d.id)),
    [activeDefs]
  );

  const relations = listPropRelationFields(note.props);
  const scalars = listScalarProps(note.props).filter(
    (s) =>
      !(WORKSPACE_SYSTEM_IDS as readonly string[]).includes(s.key) &&
      s.key !== "type" &&
      s.key !== "fm_status" &&
      s.key !== "status" &&
      s.key !== "priority" &&
      s.key !== "due"
  );
  const dates = listNoteDatePills(note);
  const organized = isOrganized(note);
  const inbox = isInboxCandidate(note);

  // When note is in a DB, parent may still show this for workspace+relations if we allow it.
  // Plan P1: show workspace fields even for DB notes via unified panel — allow when userId set.
  if (note.database_id && !extraDbProps) {
    // Keep old gate only when not in unified mode; still show if we have userId (P1)
    // Fall through — always show for consistency
  }

  const typeVal = String(getWorkspaceFieldValue(note, WS_TYPE_ID) || "");
  const statusVal = String(getWorkspaceFieldValue(note, WS_STATUS_ID) || "");
  const statusLabel =
    systemDefs
      .find((d) => d.id === WS_STATUS_ID)
      ?.options?.find((o) => o.id === statusVal)?.label || statusVal;

  const commitWs = async (defId: string, value: unknown) => {
    const patch = patchWorkspaceField(note, defId, value);
    onPropsPatch(patch.props);
    onNotePatch?.({
      props: patch.props,
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.body_md != null ? { body_md: patch.body_md } : {}),
    });
    try {
      await updateNote(note.id, {
        props: patch.props,
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.body_md != null ? { body_md: patch.body_md } : {}),
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : "儲存屬性失敗");
    }
  };

  const addProperty = async () => {
    if (!userId) {
      const key = await askPrompt({
        title: "新增屬性",
        message: "屬性名稱",
        placeholder: "屬性名稱",
      });
      if (key == null || !key.trim()) return;
      const value = await askPrompt({
        title: "屬性值",
        message: `「${key.trim()}」的內容`,
        placeholder: "文字",
      });
      if (value == null) return;
      onPropsPatch(withFrontmatterExtra(note.props, key.trim(), value));
      return;
    }

    const mode = await askPrompt({
      title: "新增屬性",
      message: "輸入「工作區」從目錄選，或直接輸入新屬性名稱",
      placeholder: "工作區 或 屬性名稱",
      defaultValue: "",
    });
    if (mode == null) return;
    const m = mode.trim();
    if (!m) return;

    if (m === "工作區" || m.toLowerCase() === "ws") {
      const unused = activeDefs.filter(
        (d) =>
          !(WORKSPACE_SYSTEM_IDS as readonly string[]).includes(d.id) ||
          getWorkspaceFieldValue(note, d.id) == null ||
          getWorkspaceFieldValue(note, d.id) === ""
      );
      const pick = await askPrompt({
        title: "工作區屬性",
        message: unused.map((d) => d.name).join("、") || "（目錄為空）",
        placeholder: "輸入屬性名稱",
      });
      if (pick == null) return;
      const def = activeDefs.find((d) => d.name === pick.trim() || d.id === pick.trim());
      if (!def) {
        toast("找不到該工作區屬性");
        return;
      }
      await commitWs(def.id, def.type === "checkbox" ? false : "");
      return;
    }

    const typePick = await askPrompt({
      title: "屬性類型",
      message: "text / select / status / date / number / checkbox",
      defaultValue: "text",
      placeholder: "text",
    });
    if (typePick == null) return;
    const t = (typePick.trim() || "text") as DbPropType;
    const def = createCustomWorkspaceDef(m, t);
    try {
      await upsertWorkspacePropertyDef(userId, def);
      await commitWs(def.id, t === "checkbox" ? false : "");
      toast(`已加入工作區屬性「${def.name}」`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "無法建立屬性");
    }
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

  const hasAnything =
    typeVal ||
    statusVal ||
    relations.length > 0 ||
    scalars.length > 0 ||
    dates.length > 0 ||
    organized ||
    inbox ||
    systemDefs.length > 0 ||
    (extraDbProps?.length || 0) > 0;

  if (!hasAnything && readOnly) return null;

  const displayDefs = [...systemDefs, ...customCatalogDefs.filter((d) => {
    const v = getWorkspaceFieldValue(note, d.id);
    return v != null && v !== "";
  })];

  // Always show system rows when editing
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
        <button type="button" className="nk-props-collapsed-summary" onClick={() => setCollapsed(false)}>
          {[
            typeVal ? `類型 · ${typeVal}` : null,
            statusLabel ? `狀態 · ${statusLabel}` : null,
            relations.length ? `${relations.length} 組關係` : null,
            scalars.length ? `${scalars.length} 項屬性` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "點擊展開屬性與關係"}
        </button>
      ) : (
        <>
          <div className="nk-props-rows ndb-props-list" aria-label="工作區屬性">
            {(readOnly ? displayDefs : systemDefs.concat(
              customCatalogDefs.filter((d) => {
                const v = getWorkspaceFieldValue(note, d.id);
                return v != null && v !== "";
              })
            )).map((def) => {
              const prop = asDbProperty(def);
              const value = getWorkspaceFieldValue(note, def.id);
              return (
                <div key={def.id} className="nk-prop-row ndb-prop-row">
                  <span className="nk-prop-row-key">{def.name}</span>
                  <div className="nk-prop-row-val ndb-prop-value">
                    <PropertyValueEditor
                      note={note}
                      prop={prop}
                      value={value}
                      userId={userId}
                      readOnly={readOnly}
                      onCommit={(v) => void commitWs(def.id, v)}
                    />
                  </div>
                </div>
              );
            })}
            {extraDbProps?.map((prop) => (
              <div key={prop.id} className="nk-prop-row ndb-prop-row">
                <span className="nk-prop-row-key">{prop.name}</span>
                <div className="nk-prop-row-val ndb-prop-value">
                  <PropertyValueEditor
                    note={note}
                    prop={prop}
                    userId={userId}
                    readOnly={readOnly}
                    onCommit={(v) => onExtraDbCommit?.(prop.id, v)}
                  />
                </div>
              </div>
            ))}
          </div>

          {dates.some((d) => d.kind === "system") ? (
            <div className="nk-props-rows" aria-label="時間屬性">
              {dates
                .filter((d) => d.kind === "system")
                .map((d) => (
                  <div key={d.key} className="nk-prop-row nk-prop-row--system">
                    <span className="nk-prop-row-key">{d.label}</span>
                    <span className="nk-prop-row-val" title={d.text}>
                      {d.text}
                    </span>
                  </div>
                ))}
            </div>
          ) : null}

          {scalars.length > 0 ? (
            <div className="nk-props-pills" role="list">
              {scalars.map((s) =>
                readOnly ? (
                  <span key={s.key} className="nk-pill nk-pill--extra" role="listitem">
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
          ) : null}

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
                        return (
                          <span key={t} className="nk-rel-chip-wrap">
                            {href ? (
                              <Link href={href} className={chipClass}>
                                {t}
                              </Link>
                            ) : (
                              <span className={`${chipClass} is-missing`} title="尚未建立此筆記">
                                {t}
                              </span>
                            )}
                            {!readOnly ? (
                              <button
                                type="button"
                                className="nk-rel-chip-x"
                                aria-label={`移除 ${t}`}
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
