"use client";

import { useEffect, useId, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { createPortal } from "react-dom";
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
import { moveIdBefore } from "@/lib/database";
import {
  WORKSPACE_SYSTEM_IDS,
  WS_STATUS_ID,
  WS_TYPE_ID,
  asDbProperty,
  archiveWorkspacePropertyDef,
  createCustomWorkspaceDef,
  ensureWorkspacePropertyDefs,
  getWorkspaceFieldValue,
  healWorkspaceProps,
  listenWorkspacePropertyDefs,
  patchWorkspaceField,
  reorderWorkspacePropertyDefs,
  setWorkspacePropertyHidden,
  upsertWorkspacePropertyDef,
  type WorkspacePropertyDef,
} from "@/lib/workspaceProperties";
import PropertyValueEditor from "@/components/notes/PropertyValueEditor";
import {
  NotePropsFieldRow,
  NotePropsFieldsGrid,
  type PropReorderHandlers,
} from "@/components/notes/NotePropsFields";
import NoteMetaPropFields, { type NoteMetaHandlers } from "@/components/notes/NoteMetaPropFields";
import MenuSelect from "@/components/MenuSelect";
import { askConfirm, askPrompt, type PromptSuggestion } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import type { DbPropType } from "@/lib/database";

/** Align with database addable types (exclude formula/rollup/system — need DB context). */
const ADDABLE_PROP_TYPES = [
  { value: "text", label: "文字", hint: "基本" },
  { value: "number", label: "數字", hint: "基本" },
  { value: "checkbox", label: "核取方塊", hint: "基本" },
  { value: "date", label: "日期", hint: "基本" },
  { value: "datetime", label: "日期時間", hint: "基本" },
  { value: "select", label: "單選", hint: "選項" },
  { value: "multi_select", label: "多選", hint: "選項" },
  { value: "status", label: "狀態", hint: "選項" },
  { value: "tags", label: "標籤", hint: "選項" },
  { value: "url", label: "網址", hint: "聯絡" },
  { value: "email", label: "Email", hint: "聯絡" },
  { value: "phone", label: "電話", hint: "聯絡" },
  { value: "person", label: "人員", hint: "聯絡" },
  { value: "files", label: "圖片／音訊／檔案", hint: "進階" },
  { value: "relation", label: "關聯", hint: "進階" },
] as const;

type AddablePropType = (typeof ADDABLE_PROP_TYPES)[number]["value"];

function coerceAddPropValue(type: AddablePropType, raw: string, checked: boolean): unknown {
  if (type === "checkbox") return checked;
  const t = raw.trim();
  if (!t) {
    if (type === "multi_select" || type === "tags" || type === "relation" || type === "files") return [];
    return "";
  }
  if (type === "number") {
    const n = Number(t);
    return Number.isFinite(n) ? n : t;
  }
  if (type === "multi_select" || type === "tags") {
    return t
      .split(/[,，、\n]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  if (type === "relation") {
    return t
      .split(/[,，\n]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return t;
}

function valuePlaceholder(type: AddablePropType): string {
  switch (type) {
    case "number":
      return "例如 42";
    case "date":
      return "YYYY-MM-DD";
    case "datetime":
      return "YYYY-MM-DD HH:mm";
    case "select":
    case "status":
      return "選項名稱（可留空）";
    case "multi_select":
    case "tags":
      return "多個用逗號分隔（可留空）";
    case "url":
      return "https://…";
    case "email":
      return "name@example.com";
    case "phone":
      return "電話號碼";
    case "person":
      return "人員名稱";
    case "files":
      return "可稍後上傳";
    case "relation":
      return "筆記標題（可稍後補）";
    default:
      return "可留空";
  }
}

type Props = {
  note: Note;
  userId?: string;
  readOnly?: boolean;
  onPropsPatch: (props: Record<string, unknown>) => void;
  /** Full note patch when workspace fields also touch status/body */
  onNotePatch?: (patch: Partial<Note>) => void;
  resolveNoteHref?: (title: string) => string | undefined;
  /** Note titles for link autocomplete (exclude current note upstream). */
  noteLinkSuggestions?: PromptSuggestion[];
  variant?: "inline" | "aside";
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  defaultCollapsed?: boolean;
  /** Also show database-only columns below workspace fields */
  extraDbProps?: import("@/lib/database").DbProperty[];
  onExtraDbCommit?: (propId: string, value: unknown) => void;
  /** Cover / folder / tags / status / word-count (chrome moved into 屬性). */
  meta?: NoteMetaHandlers | null;
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
  noteLinkSuggestions,
  variant = "inline",
  collapsed: collapsedProp,
  onCollapsedChange,
  defaultCollapsed = false,
  extraDbProps,
  onExtraDbCommit,
  meta,
}: Props) {
  const titleId = useId();
  const addDialogTitleId = useId();
  const addNameRef = useRef<HTMLInputElement>(null);
  const [defs, setDefs] = useState<WorkspacePropertyDef[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<"create" | "pick">("create");
  const [addName, setAddName] = useState("");
  const [addType, setAddType] = useState<AddablePropType>("text");
  const [addValue, setAddValue] = useState("");
  const [addChecked, setAddChecked] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [menuPropId, setMenuPropId] = useState<string | null>(null);
  const [hiddenMenuOpen, setHiddenMenuOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);
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

  useEffect(() => {
    if (!menuPropId && !hiddenMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (
        !(e.target as HTMLElement)?.closest?.(
          ".nk-prop-menu-wrap, .nk-prop-menu, .nk-prop-menu-btn, .nk-props-hidden-wrap, .nk-props-hidden-menu, .nk-props-hidden-btn"
        )
      ) {
        setMenuPropId(null);
        setHiddenMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuPropId, hiddenMenuOpen]);

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
  const systemDefs = useMemo(() => {
    const ids = meta
      ? WORKSPACE_SYSTEM_IDS.filter((id) => id !== WS_STATUS_ID)
      : WORKSPACE_SYSTEM_IDS;
    return ids
      .map((id) => activeDefs.find((d) => d.id === id))
      .filter((d): d is WorkspacePropertyDef => !!d);
  }, [activeDefs, meta]);

  /** Panel rows follow workspace catalog sortOrder (system + filled custom). */
  const panelDefs = useMemo(() => {
    const skipStatus = !!meta;
    return activeDefs.filter((d) => {
      if (d.hidden) return false;
      if (skipStatus && d.id === WS_STATUS_ID) return false;
      if ((WORKSPACE_SYSTEM_IDS as readonly string[]).includes(d.id)) return true;
      const v = getWorkspaceFieldValue(note, d.id);
      return v != null && v !== "";
    });
  }, [activeDefs, meta, note]);

  const hiddenDefs = useMemo(() => {
    const skipStatus = !!meta;
    return activeDefs.filter((d) => {
      if (!d.hidden) return false;
      if (skipStatus && d.id === WS_STATUS_ID) return false;
      return true;
    });
  }, [activeDefs, meta]);

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

  const unusedCatalogDefs = useMemo(
    () =>
      activeDefs.filter((d) => {
        const v = getWorkspaceFieldValue(note, d.id);
        return v == null || v === "";
      }),
    [activeDefs, note]
  );

  const openAddProperty = () => {
    setAddMode("create");
    setAddName("");
    setAddType("text");
    setAddValue("");
    setAddChecked(false);
    setAddBusy(false);
    setAddOpen(true);
  };

  const closeAddProperty = () => {
    if (addBusy) return;
    setAddOpen(false);
  };

  useEffect(() => {
    if (!addOpen) return;
    const t = window.setTimeout(() => {
      addNameRef.current?.focus({ preventScroll: true });
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (!addBusy) setAddOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [addOpen, addBusy]);

  const confirmCreateProperty = async (e?: FormEvent) => {
    e?.preventDefault();
    const name = addName.trim();
    if (!name) {
      toast("請輸入屬性名稱");
      addNameRef.current?.focus();
      return;
    }
    setAddBusy(true);
    try {
      if (!userId) {
        onPropsPatch(
          withFrontmatterExtra(
            note.props,
            name,
            addType === "checkbox" ? (addChecked ? "是" : "否") : addValue.trim()
          )
        );
        setAddOpen(false);
        return;
      }
      const def = createCustomWorkspaceDef(name, addType as DbPropType);
      if (
        (addType === "select" || addType === "status" || addType === "multi_select") &&
        addValue.trim()
      ) {
        const labels = addValue
          .split(/[,，、\n]+/)
          .map((x) => x.trim())
          .filter(Boolean);
        if (labels.length) {
          def.options = labels.map((label, i) => ({
            id: `o_${i}_${label.slice(0, 12)}`,
            label,
          }));
          if (addType === "status") {
            def.statusGroups = [{ name: "預設", optionIds: def.options.map((o) => o.id) }];
          }
        }
      }
      await upsertWorkspacePropertyDef(userId, def);
      let value = coerceAddPropValue(addType, addValue, addChecked);
      // For select/status, store option id when we seeded from content
      if (
        (addType === "select" || addType === "status") &&
        def.options?.length &&
        typeof value === "string" &&
        value
      ) {
        const hit = def.options.find((o) => o.label === value || o.id === value);
        value = hit?.id || def.options[0].id;
      }
      if (addType === "multi_select" && def.options?.length && Array.isArray(value)) {
        value = (value as string[])
          .map((v) => def.options!.find((o) => o.label === v || o.id === v)?.id || v)
          .filter(Boolean);
      }
      await commitWs(def.id, value);
      toast(`已加入工作區屬性「${def.name}」`);
      setAddOpen(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : "無法建立屬性");
    } finally {
      setAddBusy(false);
    }
  };

  const pickExistingProperty = async (def: WorkspacePropertyDef) => {
    setAddBusy(true);
    try {
      await commitWs(def.id, def.type === "checkbox" ? false : "");
      setAddOpen(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : "無法加入屬性");
    } finally {
      setAddBusy(false);
    }
  };

  const linkSuggestions = useMemo(() => {
    const items = noteLinkSuggestions || [];
    if (!items.length) return items;
    // Ensure we always have a few "related" seeds when empty query
    if (items.some((s) => s.related)) return items;
    return items.map((s, i) => (i < 8 ? { ...s, related: true } : s));
  }, [noteLinkSuggestions]);

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
      message: "輸入或選擇筆記標題（可打一字搜尋）",
      placeholder: "筆記標題",
      suggestions: linkSuggestions,
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
      message: `「${relLabel}」要連到哪一則筆記？可打一字搜尋，或從可能相關的筆記挑選。`,
      placeholder: "筆記標題",
      suggestions: linkSuggestions,
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

  const commitDefReorder = async (fromId: string, toId: string) => {
    if (!userId || fromId === toId || readOnly) return;
    const fullIds = activeDefs.map((d) => d.id);
    const nextIds = moveIdBefore(fullIds, fromId, toId);
    if (nextIds.join("\0") === fullIds.join("\0")) return;
    setDefs((prev) => {
      const map = new Map(prev.map((d) => [d.id, d]));
      const ordered: WorkspacePropertyDef[] = [];
      nextIds.forEach((id, i) => {
        const d = map.get(id);
        if (d) ordered.push({ ...d, sortOrder: i });
      });
      const rest = prev.filter((d) => !nextIds.includes(d.id));
      return [...ordered, ...rest];
    });
    try {
      await reorderWorkspacePropertyDefs(userId, nextIds);
    } catch (e) {
      toast(e instanceof Error ? e.message : "調整屬性順序失敗");
    }
  };

  const propReorderFor = (defId: string): PropReorderHandlers | null => {
    if (readOnly || !userId) return null;
    return {
      reorderId: defId,
      dragging: dragId === defId,
      dragOver: dragOverId === defId && dragId !== defId,
      onDragStart: (id) => {
        dragIdRef.current = id;
        setDragId(id);
        setDragOverId(id);
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
        if (from && from !== id) void commitDefReorder(from, id);
      },
      onDragEnd: () => {
        dragIdRef.current = null;
        setDragId(null);
        setDragOverId(null);
      },
    };
  };

  const renameDef = async (def: WorkspacePropertyDef) => {
    setMenuPropId(null);
    if (!userId) return;
    const name = await askPrompt({
      title: "重新命名屬性",
      message: def.systemKey ? "系統屬性可改顯示名稱" : "屬性名稱",
      defaultValue: def.name,
    });
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === def.name) return;
    try {
      await upsertWorkspacePropertyDef(userId, { ...def, name: trimmed });
      setDefs((prev) => prev.map((d) => (d.id === def.id ? { ...d, name: trimmed } : d)));
      toast("已更新名稱");
    } catch (e) {
      toast(e instanceof Error ? e.message : "重新命名失敗");
    }
  };

  const deleteDef = async (def: WorkspacePropertyDef) => {
    setMenuPropId(null);
    if (!userId) return;
    if ((WORKSPACE_SYSTEM_IDS as readonly string[]).includes(def.id)) {
      toast("系統屬性不可刪除");
      return;
    }
    const ok = await askConfirm({
      title: "刪除屬性",
      message: `刪除工作區屬性「${def.name}」後，其他筆記也不再顯示此欄（既有值會保留在資料中）。`,
      confirmLabel: "刪除",
      danger: true,
    });
    if (!ok) return;
    try {
      await archiveWorkspacePropertyDef(userId, def.id);
      setDefs((prev) => prev.map((d) => (d.id === def.id ? { ...d, archived: true } : d)));
      // Clear value on this note so the row disappears immediately.
      const nextProps = { ...(note.props || {}) };
      delete nextProps[def.id];
      onPropsPatch(nextProps);
      try {
        await updateNote(note.id, { props: nextProps });
      } catch {
        /* ignore — catalog already archived */
      }
      toast(`已刪除「${def.name}」`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "刪除屬性失敗");
    }
  };

  const hideDef = async (def: WorkspacePropertyDef) => {
    setMenuPropId(null);
    if (!userId) return;
    try {
      await setWorkspacePropertyHidden(userId, def.id, true);
      setDefs((prev) => prev.map((d) => (d.id === def.id ? { ...d, hidden: true } : d)));
      toast(`已隱藏「${def.name}」（數值仍保留）`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "隱藏屬性失敗");
    }
  };

  const unhideDef = async (def: WorkspacePropertyDef) => {
    setHiddenMenuOpen(false);
    if (!userId) return;
    try {
      await setWorkspacePropertyHidden(userId, def.id, false);
      setDefs((prev) => prev.map((d) => (d.id === def.id ? { ...d, hidden: false } : d)));
      toast(`已顯示「${def.name}」`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "顯示屬性失敗");
    }
  };

  if (!hasAnything && readOnly) return null;

  // Always show system rows when editing
  return (
    <section
      className={`nk-props nk-props--${variant}${collapsed ? " is-collapsed" : ""}`}
      aria-label="筆記屬性"
      aria-labelledby={titleId}
    >
      <header className="nk-props-head">
        <button
          type="button"
          className="nk-props-head-toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "展開屬性" : "收合屬性"}
          title={collapsed ? "展開" : "收合"}
          onClick={() => setCollapsed(!collapsed)}
        >
          <div className="nk-props-head-main">
            <strong id={titleId}>屬性</strong>
            {inbox ? <span className="nk-inbox-badge">待整理</span> : null}
            {organized ? <span className="nk-org-badge">已整理</span> : null}
          </div>
          <span className="nk-props-icon-btn nk-props-chevron" aria-hidden="true">
            {collapsed ? "▸" : "▾"}
          </span>
        </button>
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
          <NotePropsFieldsGrid aria-label="工作區屬性">
            {meta ? (
              <NoteMetaPropFields
                note={note}
                userId={userId}
                readOnly={readOnly}
                {...meta}
              />
            ) : null}
            {panelDefs.map((def) => {
              const prop = asDbProperty(def);
              const value = getWorkspaceFieldValue(note, def.id);
              const isSystem = (WORKSPACE_SYSTEM_IDS as readonly string[]).includes(def.id);
              return (
                <NotePropsFieldRow
                  key={def.id}
                  label={def.name}
                  type={def.type}
                  reorder={propReorderFor(def.id)}
                  menu={
                    !readOnly && userId ? (
                      <div className="nk-prop-menu-wrap">
                        <button
                          type="button"
                          className="nk-prop-menu-btn"
                          aria-label={`${def.name} 選項`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuPropId((id) => (id === def.id ? null : def.id));
                          }}
                        >
                          ···
                        </button>
                        {menuPropId === def.id ? (
                          <div className="nk-prop-menu" role="menu">
                            <button type="button" role="menuitem" onClick={() => void renameDef(def)}>
                              重新命名
                            </button>
                            <button type="button" role="menuitem" onClick={() => void hideDef(def)}>
                              隱藏
                            </button>
                            {!isSystem ? (
                              <button
                                type="button"
                                role="menuitem"
                                className="is-danger"
                                onClick={() => void deleteDef(def)}
                              >
                                刪除屬性
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : undefined
                  }
                >
                  <PropertyValueEditor
                    note={note}
                    prop={prop}
                    value={value}
                    userId={userId}
                    readOnly={readOnly}
                    onCommit={(v) => void commitWs(def.id, v)}
                  />
                </NotePropsFieldRow>
              );
            })}
            {extraDbProps?.map((prop) => (
              <NotePropsFieldRow key={prop.id} label={prop.name} type={prop.type}>
                <PropertyValueEditor
                  note={note}
                  prop={prop}
                  userId={userId}
                  readOnly={readOnly}
                  onCommit={(v) => onExtraDbCommit?.(prop.id, v)}
                />
              </NotePropsFieldRow>
            ))}
            {dates
              .filter((d) => d.kind === "system")
              .map((d) => (
                <NotePropsFieldRow
                  key={d.key}
                  label={d.label}
                  type={d.key === "updated" ? "last_edited_time" : "created_time"}
                  system
                >
                  <span title={d.text}>{d.text}</span>
                </NotePropsFieldRow>
              ))}
            {relations.map((rel) => {
              const tone = relationToneIndex(rel.key);
              return (
                <NotePropsFieldRow key={`rel:${rel.key}`} label={rel.label} icon="hub">
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
                              onClick={() => onPropsPatch(removeRelationTitle(note.props, rel.key, t))}
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
                </NotePropsFieldRow>
              );
            })}
          </NotePropsFieldsGrid>

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

          {!readOnly && (
            <div className="nk-props-foot">
              <button type="button" className="nk-props-add" onClick={openAddProperty}>
                + 新增屬性
              </button>
              <button type="button" className="nk-props-add" onClick={() => void addRelationship()}>
                + 新增關係
              </button>
              {hiddenDefs.length > 0 ? (
                <div className="nk-props-hidden-wrap">
                  <button
                    type="button"
                    className="nk-props-add nk-props-add--quiet nk-props-hidden-btn"
                    aria-expanded={hiddenMenuOpen}
                    onClick={() => setHiddenMenuOpen((v) => !v)}
                  >
                    顯示隱藏屬性（{hiddenDefs.length}）
                  </button>
                  {hiddenMenuOpen ? (
                    <div className="nk-props-hidden-menu" role="menu">
                      {hiddenDefs.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          role="menuitem"
                          onClick={() => void unhideDef(d)}
                        >
                          {d.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
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

      {addOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="cadence-dialog-backdrop"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) closeAddProperty();
            }}
          >
            <div
              className="cadence-dialog nk-add-prop-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby={addDialogTitleId}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <h2 id={addDialogTitleId} className="cadence-dialog-title">
                新增屬性
              </h2>
              {userId && addMode === "pick" ? (
                <>
                  <p className="cadence-dialog-msg">從工作區目錄挑選尚未填入此筆記的屬性。</p>
                  <div className="cadence-dialog-choices nk-add-prop-pick-list">
                    {unusedCatalogDefs.length === 0 ? (
                      <p className="cadence-dialog-msg">目前沒有可加入的工作區屬性。</p>
                    ) : (
                      unusedCatalogDefs.map((def) => (
                        <button
                          key={def.id}
                          type="button"
                          className="cadence-dialog-choice"
                          disabled={addBusy}
                          onClick={() => void pickExistingProperty(def)}
                        >
                          <strong>{def.name}</strong>
                          <span>
                            {ADDABLE_PROP_TYPES.find((t) => t.value === def.type)?.label || def.type}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                  <div className="cadence-dialog-actions" style={{ justifyContent: "space-between" }}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={addBusy}
                      onClick={() => setAddMode("create")}
                    >
                      ← 建立新屬性
                    </button>
                    <button type="button" className="btn btn-ghost" disabled={addBusy} onClick={closeAddProperty}>
                      取消
                    </button>
                  </div>
                </>
              ) : (
                <form className="cadence-dialog-form" onSubmit={(e) => void confirmCreateProperty(e)}>
                  <label className="cadence-dialog-field">
                    <span>名稱</span>
                    <input
                      ref={addNameRef}
                      className="input cadence-dialog-input"
                      type="text"
                      value={addName}
                      placeholder="屬性名稱"
                      autoComplete="off"
                      spellCheck={false}
                      disabled={addBusy}
                      onChange={(e) => setAddName(e.target.value)}
                      required
                    />
                  </label>
                  {userId ? (
                    <label className="cadence-dialog-field">
                      <span>類型</span>
                      <MenuSelect
                        variant="soft"
                        ariaLabel="屬性類型"
                        value={addType}
                        options={[...ADDABLE_PROP_TYPES]}
                        disabled={addBusy}
                        onChange={(v) => {
                          setAddType(v);
                          if (v === "checkbox") setAddValue("");
                        }}
                      />
                    </label>
                  ) : null}
                  <label className="cadence-dialog-field">
                    <span>內容</span>
                    {addType === "checkbox" && userId ? (
                      <label className="cadence-dialog-remember nk-add-prop-check">
                        <input
                          type="checkbox"
                          checked={addChecked}
                          disabled={addBusy}
                          onChange={(e) => setAddChecked(e.target.checked)}
                        />
                        <span>{addChecked ? "是" : "否"}</span>
                      </label>
                    ) : (
                      <input
                        className="input cadence-dialog-input"
                        type={addType === "number" ? "number" : addType === "date" ? "date" : "text"}
                        value={addValue}
                        placeholder={valuePlaceholder(addType)}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={addBusy}
                        onChange={(e) => setAddValue(e.target.value)}
                      />
                    )}
                  </label>
                  {userId ? (
                    <button
                      type="button"
                      className="nk-add-prop-pick-link"
                      disabled={addBusy}
                      onClick={() => setAddMode("pick")}
                    >
                      選擇既有工作區屬性…
                    </button>
                  ) : null}
                  <div className="cadence-dialog-actions">
                    <button type="button" className="btn btn-ghost" disabled={addBusy} onClick={closeAddProperty}>
                      取消
                    </button>
                    <button type="submit" className="btn" disabled={addBusy || !addName.trim()}>
                      {addBusy ? "建立中…" : "確定"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>,
          document.body
        )}
    </section>
  );
}
