"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
import Link from "next/link";
import type { Note } from "@/lib/firebase";
import { updateNote } from "@/lib/firebase";
import {
  ADDABLE_DB_PROPS,
  addProperty,
  ensureSystemTimeProperties,
  evalFormula,
  evalRollup,
  getCellValue,
  listenDatabase,
  listenDatabaseRows,
  removeProperty,
  swapProperties,
  scrubViewsAfterPropRemove,
  setCellValue,
  setPropertyHidden,
  updateDatabase,
  type CadenceDatabase,
  type DbPropType,
  type DbProperty,
} from "@/lib/database";
import {
  asDbProperty,
  ensureWorkspacePropertyDefs,
  listenWorkspacePropertyDefs,
  resolveDatabaseProperties,
  upsertWorkspacePropertyDef,
  WS_STATUS_ID,
  type WorkspacePropertyDef,
} from "@/lib/workspaceProperties";
import PropertyValueEditor from "@/components/notes/PropertyValueEditor";
import {
  NotePropsFieldRow,
  NotePropsFieldsGrid,
  type PropReorderHandlers,
} from "@/components/notes/NotePropsFields";
import NoteMetaPropFields, { type NoteMetaHandlers } from "@/components/notes/NoteMetaPropFields";
import { askConfirm, askPrompt } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import {
  getOrganizeStatus,
  nextOrganizeStatus,
  ORGANIZE_STATUS_LABEL,
  withOrganizeStatus,
} from "@/lib/noteKnowledge";

const COLLAPSED_MAX = 6;

function isEmptyValue(prop: DbProperty, row: Note, allProps: DbProperty[], allRows: Note[]): boolean {
  if (prop.type === "title") return !(row.title || "").trim();
  if (prop.type === "checkbox") return false;
  if (prop.type === "formula") return !evalFormula(prop, row, allProps, allRows);
  if (prop.type === "rollup") return !evalRollup(prop, row, allProps, allRows);
  const v = getCellValue(row, prop);
  if (v == null || v === "") return true;
  if (Array.isArray(v) && v.length === 0) return true;
  return false;
}

type Props = {
  note: Note;
  userId: string;
  readOnly?: boolean;
  onNotePatch: (patch: Partial<Note>) => void;
  /** Cover / folder / tags / status / word-count (chrome moved into 屬性). */
  meta?: NoteMetaHandlers | null;
};

export default function NoteDbPropertiesPanel({ note, userId, readOnly, onNotePatch, meta }: Props) {
  const databaseId = (note.database_id || "").trim();
  const [db, setDb] = useState<CadenceDatabase | null>(null);
  const [rows, setRows] = useState<Note[]>([]);
  const [wsDefs, setWsDefs] = useState<WorkspacePropertyDef[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [menuPropId, setMenuPropId] = useState<string | null>(null);
  const [hiddenMenuOpen, setHiddenMenuOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const ensuredRef = useRef<string | null>(null);
  const dragIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!databaseId) return;
    return listenDatabase(databaseId, setDb);
  }, [databaseId]);

  useEffect(() => {
    if (!databaseId) return;
    return listenDatabaseRows(userId, databaseId, setRows);
  }, [databaseId, userId]);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    void ensureWorkspacePropertyDefs(userId)
      .then(() => {
        unsub = listenWorkspacePropertyDefs(userId, setWsDefs);
      })
      .catch(() => {});
    return () => unsub?.();
  }, [userId]);

  useEffect(() => {
    if (!addOpen && !menuPropId && !hiddenMenuOpen) return;
    const onDoc = (e: globalThis.MouseEvent) => {
      const t = e.target as Node;
      if (addBtnRef.current?.contains(t)) return;
      const root = (e.target as HTMLElement)?.closest?.(".ndb-props");
      if (!root) {
        setAddOpen(false);
        setMenuPropId(null);
        setHiddenMenuOpen(false);
        return;
      }
      if (
        !(e.target as HTMLElement).closest(
          ".ndb-props-add-menu, .nk-prop-menu, .ndb-prop-menu, .ndb-props-add, .nk-props-add, .nk-prop-menu-btn, .ndb-prop-menu-btn, .nk-props-hidden-menu, .nk-props-hidden-btn"
        )
      ) {
        setAddOpen(false);
        setMenuPropId(null);
        setHiddenMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [addOpen, menuPropId, hiddenMenuOpen]);

  // Auto-add created / last edited props once per database.
  useEffect(() => {
    if (!db || readOnly) return;
    if (ensuredRef.current === db.id) return;
    const next = ensureSystemTimeProperties(db.properties);
    if (next.length === db.properties.length) {
      ensuredRef.current = db.id;
      return;
    }
    ensuredRef.current = db.id;
    setDb({ ...db, properties: next });
    void updateDatabase(db.id, { properties: next }).catch(() => {
      ensuredRef.current = null;
    });
  }, [db, readOnly]);

  const allResolvedProps = useMemo(() => {
    if (!db) return [];
    return resolveDatabaseProperties(db.properties, wsDefs).filter((p) => {
      if (p.type === "title") return false;
      if (meta && (p.id === WS_STATUS_ID || p.workspaceDefId === WS_STATUS_ID)) return false;
      return true;
    });
  }, [db, wsDefs, meta]);

  const displayProps = useMemo(
    () => allResolvedProps.filter((p) => !p.hidden),
    [allResolvedProps]
  );

  const hiddenProps = useMemo(
    () => allResolvedProps.filter((p) => !!p.hidden),
    [allResolvedProps]
  );

  const filled = useMemo(
    () => displayProps.filter((p) => !isEmptyValue(p, note, db?.properties || [], rows)),
    [displayProps, note, db, rows]
  );
  const emptyCount = displayProps.length - filled.length;

  const visible = useMemo(() => {
    if (showAll || dragId) return displayProps;
    if (filled.length >= COLLAPSED_MAX) return filled.slice(0, COLLAPSED_MAX);
    const rest = displayProps.filter((p) => isEmptyValue(p, note, db?.properties || [], rows));
    return [...filled, ...rest].slice(0, COLLAPSED_MAX);
  }, [showAll, dragId, displayProps, filled, note, db, rows]);

  const commitPropReorder = async (fromId: string, toId: string) => {
    if (!db || fromId === toId || readOnly) return;
    // Pairwise swap among movable DB props (meta rows have no drop handlers).
    const properties = swapProperties(db.properties, fromId, toId);
    setDb({ ...db, properties });
    try {
      await updateDatabase(db.id, { properties });
    } catch (e) {
      toast(e instanceof Error ? e.message : "調整屬性順序失敗");
    }
  };

  const propReorderFor = (propId: string): PropReorderHandlers | null => {
    if (readOnly) return null;
    return {
      reorderId: propId,
      dragging: dragId === propId,
      dragOver: dragOverId === propId && dragId !== propId,
      onDragStart: (id) => {
        dragIdRef.current = id;
        setDragId(id);
        setDragOverId(id);
        setShowAll(true);
      },
      onDragOver: (id, e: DragEvent) => {
        e.preventDefault();
        if (dragOverId !== id) setDragOverId(id);
      },
      onDrop: (id) => {
        const from = dragIdRef.current;
        dragIdRef.current = null;
        setDragId(null);
        setDragOverId(null);
        if (from && from !== id) void commitPropReorder(from, id);
      },
      onDragEnd: () => {
        dragIdRef.current = null;
        setDragId(null);
        setDragOverId(null);
      },
    };
  };

  if (!databaseId) return null;
  if (!db) {
    return (
      <div className="ndb-props ndb-props--loading" aria-busy>
        載入資料庫屬性…
      </div>
    );
  }

  const addProp = async (type: DbPropType) => {
    setAddOpen(false);
    let next = addProperty(db.properties, type);
    const created = next[next.length - 1];
    if (type === "formula") {
      const expr = await askPrompt({
        title: "公式",
        message: "可用 {{屬性id}}。例如 if({{status}},完成,未完成)",
        defaultValue: created?.formula || "{{title}}",
      });
      if (expr == null) return;
      next = next.map((p) => (p.id === created.id ? { ...p, formula: expr } : p));
    }
    setDb({ ...db, properties: next });
    await updateDatabase(db.id, { properties: next });
    setCollapsed(false);
    setShowAll(true);
    toast(`已新增屬性「${next.find((p) => p.id === created.id)?.name || ""}」`);
  };

  const renameProp = async (prop: DbProperty) => {
    setMenuPropId(null);
    const name = await askPrompt({
      title: "重新命名屬性",
      defaultValue: prop.name,
    });
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === prop.name) return;
    const properties = db.properties.map((p) => (p.id === prop.id ? { ...p, name: trimmed } : p));
    setDb({ ...db, properties });
    try {
      await updateDatabase(db.id, { properties });
      const defId = prop.workspaceDefId || (wsDefs.some((d) => d.id === prop.id) ? prop.id : "");
      if (defId) {
        const def = wsDefs.find((d) => d.id === defId);
        if (def) {
          await upsertWorkspacePropertyDef(userId, { ...def, name: trimmed });
          setWsDefs((prev) => prev.map((d) => (d.id === defId ? { ...d, name: trimmed } : d)));
        }
      }
      toast("已更新名稱");
    } catch (e) {
      toast(e instanceof Error ? e.message : "重新命名失敗");
    }
  };

  const deleteProp = async (prop: DbProperty) => {
    setMenuPropId(null);
    if (prop.type === "title") return;
    const ok = await askConfirm({
      title: "刪除屬性",
      message: `刪除「${prop.name}」後，資料庫所有列此欄會一併移除。`,
      confirmLabel: "刪除",
      danger: true,
    });
    if (!ok) return;
    const properties = removeProperty(db.properties, prop.id);
    const views = scrubViewsAfterPropRemove(db.views, prop.id);
    setDb({ ...db, properties, views });
    try {
      await updateDatabase(db.id, { properties, views });
      // Clear value on this note so the row disappears immediately.
      if (note.props && Object.prototype.hasOwnProperty.call(note.props, prop.id)) {
        const nextProps = { ...(note.props || {}) };
        delete nextProps[prop.id];
        onNotePatch({ props: nextProps });
        await updateNote(note.id, { props: nextProps }).catch(() => undefined);
      }
      toast(`已刪除「${prop.name}」`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "刪除屬性失敗");
    }
  };

  const hideProp = async (prop: DbProperty) => {
    setMenuPropId(null);
    if (prop.type === "title") return;
    const properties = setPropertyHidden(db.properties, prop.id, true);
    setDb({ ...db, properties });
    try {
      await updateDatabase(db.id, { properties });
      toast(`已隱藏「${prop.name}」（數值仍保留）`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "隱藏屬性失敗");
    }
  };

  const unhideProp = async (prop: DbProperty) => {
    setHiddenMenuOpen(false);
    const properties = setPropertyHidden(db.properties, prop.id, false);
    setDb({ ...db, properties });
    try {
      await updateDatabase(db.id, { properties });
      setShowAll(true);
      toast(`已顯示「${prop.name}」`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "顯示屬性失敗");
    }
  };

  const commitValue = async (prop: DbProperty, value: unknown) => {
    await setCellValue(note, prop, value);
    if (prop.type === "title") {
      onNotePatch({ title: String(value || "未命名") });
    } else if (prop.type === "tags") {
      const tags = Array.isArray(value) ? value.map(String) : [];
      onNotePatch({ tags });
    } else {
      const nextProps = { ...(note.props || {}), [prop.id]: value };
      const patch: Partial<Note> = { props: nextProps };
      if (
        (prop.id === "ws_status" || prop.workspaceDefId === "ws_status" || prop.type === "status") &&
        typeof value === "string"
      ) {
        if (value === "doing" || value === "done" || value === "backlog" || value === "todo") {
          patch.status = value === "todo" ? "backlog" : (value as Note["status"]);
        }
      }
      onNotePatch(patch);
    }
  };

  const addWorkspaceProp = async (def: WorkspacePropertyDef) => {
    setAddOpen(false);
    if (db.properties.some((p) => p.workspaceDefId === def.id || p.id === def.id)) {
      toast("此工作區屬性已在資料庫中");
      return;
    }
    const bound = asDbProperty(def);
    const next = addProperty(db.properties, bound.type, bound.name, {
      id: bound.id,
      workspaceDefId: def.id,
      options: bound.options,
      statusGroups: bound.statusGroups,
    });
    setDb({ ...db, properties: next });
    await updateDatabase(db.id, { properties: next });
    setCollapsed(false);
    setShowAll(true);
    toast(`已加入工作區屬性「${def.name}」`);
  };

  const addMenu = !readOnly ? (
    <div className="ndb-props-add-wrap">
      <button
        ref={addBtnRef}
        type="button"
        className="nk-props-add"
        aria-expanded={addOpen}
        onClick={() => setAddOpen((v) => !v)}
      >
        + 新增屬性
      </button>
      {addOpen ? (
        <div className="ndb-props-add-menu" role="menu">
          {wsDefs.filter((d) => !d.archived).length ? (
            <div className="ndb-props-add-group">
              <strong>工作區屬性</strong>
              {wsDefs
                .filter((d) => !d.archived)
                .map((d) => (
                  <button key={d.id} type="button" role="menuitem" onClick={() => void addWorkspaceProp(d)}>
                    {d.name}
                  </button>
                ))}
            </div>
          ) : null}
          {["基本", "選項", "聯絡", "進階", "系統"].map((g) => (
            <div key={g} className="ndb-props-add-group">
              <strong>{g}</strong>
              {ADDABLE_DB_PROPS.filter((a) => a.group === g).map((a) => (
                <button key={a.type} type="button" role="menuitem" onClick={() => void addProp(a.type)}>
                  {a.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  ) : null;

  const collapsedSummary =
    [
      filled
        .slice(0, 3)
        .map((p) => p.name)
        .join(" · ") || null,
      displayProps.length ? `${filled.length}/${displayProps.length} 個屬性` : null,
      db.name ? `資料庫 · ${db.name}` : null,
    ]
      .filter(Boolean)
      .join(" · ") || "點擊展開屬性";

  const organizeStatus = getOrganizeStatus(note);
  const organizeLabel = ORGANIZE_STATUS_LABEL[organizeStatus];

  const cycleOrganizeStatus = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (readOnly) return;
    const props = withOrganizeStatus(note.props, nextOrganizeStatus(organizeStatus));
    onNotePatch({ props });
    void updateNote(note.id, { props }).catch((err) => {
      toast(err instanceof Error ? err.message : "儲存整理狀態失敗");
    });
  };

  return (
    <section
      className={`nk-props nk-props--inline ndb-props${collapsed ? " is-collapsed" : ""}`}
      aria-label="資料庫屬性"
    >
      <header className="nk-props-head">
        <div className="nk-props-head-leading">
          <div className="nk-props-head-main">
            <button
              type="button"
              className="nk-props-head-title-btn"
              aria-expanded={!collapsed}
              aria-label={collapsed ? "展開屬性" : "收合屬性"}
              title={collapsed ? "展開" : "收合"}
              onClick={() => setCollapsed(!collapsed)}
            >
              <strong>屬性</strong>
            </button>
            {readOnly ? (
              <span
                className={`nk-org-status-badge nk-org-status-badge--${organizeStatus}`}
                title={organizeLabel}
              >
                {organizeLabel}
              </span>
            ) : (
              <button
                type="button"
                className={`nk-org-status-badge nk-org-status-badge--${organizeStatus}`}
                title={`整理狀態：${organizeLabel}（點擊切換）`}
                aria-label={`整理狀態：${organizeLabel}，點擊切換下一狀態`}
                onClick={cycleOrganizeStatus}
              >
                {organizeLabel}
              </button>
            )}
            <Link
              href={`/db/${db.id}`}
              className="ndb-props-db"
              title="開啟資料庫"
              onClick={(e) => e.stopPropagation()}
            >
              {db.icon || "▦"} {db.name}
            </Link>
            <span className="ndb-props-count">
              {filled.length}/{displayProps.length}
            </span>
          </div>
          <button
            type="button"
            className="nk-props-icon-btn nk-props-chevron"
            aria-expanded={!collapsed}
            aria-label={collapsed ? "展開屬性" : "收合屬性"}
            title={collapsed ? "展開" : "收合"}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? "▸" : "▾"}
          </button>
        </div>
        <div className="nk-props-head-actions">
          <button
            type="button"
            className="nk-props-icon-btn"
            aria-label="關閉屬性面板"
            title="關閉"
            onClick={(e) => {
              e.stopPropagation();
              setCollapsed(true);
            }}
          >
            ×
          </button>
        </div>
      </header>

      {collapsed ? (
        <button type="button" className="nk-props-collapsed-summary" onClick={() => setCollapsed(false)}>
          {collapsedSummary}
        </button>
      ) : (
        <>
          <NotePropsFieldsGrid aria-label="資料庫屬性欄位">
            {meta ? (
              <NoteMetaPropFields
                note={note}
                userId={userId}
                readOnly={readOnly}
                {...meta}
              />
            ) : null}
            {visible.map((prop) => (
              <NotePropsFieldRow
                key={prop.id}
                label={prop.name}
                type={prop.type}
                system={prop.type === "created_time" || prop.type === "last_edited_time"}
                reorder={propReorderFor(prop.id)}
                menu={
                  !readOnly ? (
                    <div className="nk-prop-menu-wrap">
                      <button
                        type="button"
                        className="nk-prop-menu-btn"
                        aria-label={`${prop.name} 選項`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuPropId((id) => (id === prop.id ? null : prop.id));
                        }}
                      >
                        ···
                      </button>
                      {menuPropId === prop.id ? (
                        <div className="nk-prop-menu" role="menu">
                          <button type="button" role="menuitem" onClick={() => void renameProp(prop)}>
                            重新命名
                          </button>
                          <button type="button" role="menuitem" onClick={() => void hideProp(prop)}>
                            隱藏
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="is-danger"
                            onClick={() => void deleteProp(prop)}
                          >
                            刪除屬性
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : undefined
                }
              >
                <PropertyValueEditor
                  note={note}
                  prop={prop}
                  allProps={resolveDatabaseProperties(db.properties, wsDefs)}
                  allRows={rows}
                  userId={userId}
                  databaseId={databaseId}
                  readOnly={readOnly}
                  onCommit={(v) => void commitValue(prop, v)}
                />
              </NotePropsFieldRow>
            ))}
          </NotePropsFieldsGrid>

          {!showAll && displayProps.length > visible.length ? (
            <button type="button" className="nk-props-add" onClick={() => setShowAll(true)}>
              還有 {displayProps.length - visible.length} 個屬性…
              {emptyCount > 0 ? `（含空白）` : ""}
            </button>
          ) : null}

          {!readOnly ? (
            <div className="nk-props-foot">
              {addMenu}
              {hiddenProps.length > 0 ? (
                <div className="nk-props-hidden-wrap">
                  <button
                    type="button"
                    className="nk-props-add nk-props-add--quiet nk-props-hidden-btn"
                    aria-expanded={hiddenMenuOpen}
                    onClick={() => setHiddenMenuOpen((v) => !v)}
                  >
                    顯示隱藏屬性（{hiddenProps.length}）
                  </button>
                  {hiddenMenuOpen ? (
                    <div className="nk-props-hidden-menu" role="menu">
                      {hiddenProps.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          role="menuitem"
                          onClick={() => void unhideProp(p)}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
