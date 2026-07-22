"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Note } from "@/lib/firebase";
import { uploadFile } from "@/lib/firebase";
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
  scrubViewsAfterPropRemove,
  setCellValue,
  updateDatabase,
  type CadenceDatabase,
  type DbFileValue,
  type DbPropType,
  type DbProperty,
} from "@/lib/database";
import MenuSelect from "@/components/MenuSelect";
import CadenceDateField from "@/components/CadenceDateField";
import { askConfirm, askPrompt } from "@/lib/dialogs";
import { toast } from "@/lib/toast";

const COLLAPSED_MAX = 6;

function propIcon(type: DbPropType): string {
  const map: Partial<Record<DbPropType, string>> = {
    text: "≡",
    number: "#",
    checkbox: "☑",
    date: "▦",
    datetime: "▦",
    select: "▾",
    multi_select: "≡",
    status: "●",
    tags: "#",
    url: "↗",
    email: "@",
    phone: "☎",
    files: "◫",
    person: "☺",
    relation: "↗",
    rollup: "Σ",
    formula: "ƒ",
    unique_id: "ID",
    created_time: "◷",
    last_edited_time: "◷",
    created_by: "☺",
    last_edited_by: "☺",
  };
  return map[type] || "·";
}

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
};

export default function NoteDbPropertiesPanel({ note, userId, readOnly, onNotePatch }: Props) {
  const databaseId = (note.database_id || "").trim();
  const [db, setDb] = useState<CadenceDatabase | null>(null);
  const [rows, setRows] = useState<Note[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [menuPropId, setMenuPropId] = useState<string | null>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const ensuredRef = useRef<string | null>(null);

  useEffect(() => {
    if (!databaseId) return;
    return listenDatabase(databaseId, setDb);
  }, [databaseId]);

  useEffect(() => {
    if (!databaseId) return;
    return listenDatabaseRows(userId, databaseId, setRows);
  }, [databaseId, userId]);

  useEffect(() => {
    if (!addOpen && !menuPropId) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (addBtnRef.current?.contains(t)) return;
      const root = (e.target as HTMLElement)?.closest?.(".ndb-props");
      if (!root) {
        setAddOpen(false);
        setMenuPropId(null);
        return;
      }
      if (!(e.target as HTMLElement).closest(".ndb-props-add-menu, .ndb-prop-menu, .ndb-props-add, .ndb-prop-menu-btn")) {
        setAddOpen(false);
        setMenuPropId(null);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [addOpen, menuPropId]);

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

  const displayProps = useMemo(() => {
    if (!db) return [];
    return db.properties.filter((p) => p.type !== "title");
  }, [db]);

  const filled = useMemo(
    () => displayProps.filter((p) => !isEmptyValue(p, note, db?.properties || [], rows)),
    [displayProps, note, db, rows]
  );
  const emptyCount = displayProps.length - filled.length;

  const visible = useMemo(() => {
    if (expanded) return displayProps;
    if (filled.length >= COLLAPSED_MAX) return filled.slice(0, COLLAPSED_MAX);
    const rest = displayProps.filter((p) => isEmptyValue(p, note, db?.properties || [], rows));
    return [...filled, ...rest].slice(0, COLLAPSED_MAX);
  }, [expanded, displayProps, filled, note, db, rows]);

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
    setExpanded(true);
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
    if (!trimmed) return;
    const properties = db.properties.map((p) => (p.id === prop.id ? { ...p, name: trimmed } : p));
    setDb({ ...db, properties });
    await updateDatabase(db.id, { properties });
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
    await updateDatabase(db.id, { properties, views });
    toast(`已刪除「${prop.name}」`);
  };

  const commitValue = async (prop: DbProperty, value: unknown) => {
    await setCellValue(note, prop, value);
    if (prop.type === "title") {
      onNotePatch({ title: String(value || "未命名") });
    } else if (prop.type === "tags") {
      const tags = Array.isArray(value) ? value.map(String) : [];
      onNotePatch({ tags });
    } else {
      onNotePatch({ props: { ...(note.props || {}), [prop.id]: value } });
    }
  };

  const hiddenEmpty = !expanded && emptyCount > 0 && filled.length >= COLLAPSED_MAX;

  return (
    <section className={`ndb-props${expanded ? " is-expanded" : ""}`} aria-label="資料庫屬性">
      <header className="ndb-props-head">
        <div className="ndb-props-head-main">
          <strong>屬性</strong>
          <Link href={`/db/${db.id}`} className="ndb-props-db" title="開啟資料庫">
            {db.icon || "▦"} {db.name}
          </Link>
          <span className="ndb-props-count">
            {filled.length}/{displayProps.length}
          </span>
        </div>
        <div className="ndb-props-head-actions">
          {displayProps.length > COLLAPSED_MAX || emptyCount > 0 ? (
            <button
              type="button"
              className="ndb-props-toggle"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "收合" : hiddenEmpty ? `展開（含 ${emptyCount} 個空白）` : "展開全部"}
            </button>
          ) : null}
          {!readOnly ? (
            <div className="ndb-props-add-wrap">
              <button
                ref={addBtnRef}
                type="button"
                className="ndb-props-add"
                aria-expanded={addOpen}
                onClick={() => setAddOpen((v) => !v)}
              >
                + 屬性
              </button>
              {addOpen ? (
                <div className="ndb-props-add-menu" role="menu">
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
          ) : null}
        </div>
      </header>

      <div className="ndb-props-grid">
        {visible.map((prop) => (
          <div key={prop.id} className="ndb-prop-row">
            <div className="ndb-prop-label">
              <span className="ndb-prop-icon" aria-hidden>
                {propIcon(prop.type)}
              </span>
              <span className="ndb-prop-name" title={prop.name}>
                {prop.name}
              </span>
              {!readOnly ? (
                <div className="ndb-prop-menu-wrap">
                  <button
                    type="button"
                    className="ndb-prop-menu-btn"
                    aria-label={`${prop.name} 選項`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuPropId((id) => (id === prop.id ? null : prop.id));
                    }}
                  >
                    ···
                  </button>
                  {menuPropId === prop.id ? (
                    <div className="ndb-prop-menu" role="menu">
                      <button type="button" role="menuitem" onClick={() => void renameProp(prop)}>
                        重新命名
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
              ) : null}
            </div>
            <div className="ndb-prop-value">
              <CompactPropEditor
                note={note}
                prop={prop}
                allProps={db.properties}
                allRows={rows}
                userId={userId}
                databaseId={databaseId}
                readOnly={readOnly}
                onCommit={(v) => void commitValue(prop, v)}
              />
            </div>
          </div>
        ))}
      </div>

      {!expanded && displayProps.length > visible.length ? (
        <button type="button" className="ndb-props-more" onClick={() => setExpanded(true)}>
          還有 {displayProps.length - visible.length} 個屬性…
        </button>
      ) : null}
    </section>
  );
}

function CompactPropEditor({
  note,
  prop,
  allProps,
  allRows,
  userId,
  databaseId,
  readOnly,
  onCommit,
}: {
  note: Note;
  prop: DbProperty;
  allProps: DbProperty[];
  allRows: Note[];
  userId: string;
  databaseId: string;
  readOnly?: boolean;
  onCommit: (value: unknown) => void;
}) {
  const raw = getCellValue(note, prop);
  const [draft, setDraft] = useState(formatDraft(raw, prop));

  useEffect(() => {
    setDraft(formatDraft(raw, prop));
  }, [raw, prop]);

  if (prop.type === "formula") {
    return <span className="ndb-empty">{evalFormula(prop, note, allProps, allRows) || "空"}</span>;
  }
  if (prop.type === "rollup") {
    return <span className="ndb-empty">{evalRollup(prop, note, allProps, allRows) || "空"}</span>;
  }
  if (
    prop.type === "created_time" ||
    prop.type === "last_edited_time" ||
    prop.type === "created_by" ||
    prop.type === "last_edited_by" ||
    prop.type === "unique_id"
  ) {
    if (prop.type.includes("time")) {
      const d = raw ? new Date(String(raw)) : null;
      return <span className="ndb-readonly">{d ? d.toLocaleString("zh-TW") : "空"}</span>;
    }
    return <span className="ndb-readonly">{String(raw || "空")}</span>;
  }

  if (readOnly) {
    if (prop.type === "checkbox") return <span>{raw ? "是" : "否"}</span>;
    if (Array.isArray(raw)) return <span>{raw.length ? raw.map(String).join("、") : "空"}</span>;
    return <span className={raw ? undefined : "ndb-empty"}>{raw == null || raw === "" ? "空" : String(raw)}</span>;
  }

  if (prop.type === "checkbox") {
    return (
      <input type="checkbox" checked={!!raw} onChange={(e) => onCommit(e.target.checked)} aria-label={prop.name} />
    );
  }

  if (prop.type === "select" || prop.type === "status") {
    const opts = prop.options || [];
    return (
      <MenuSelect
        variant="ghost"
        size="sm"
        className="ndb-select"
        ariaLabel={prop.name}
        value={String(raw || "")}
        options={[{ value: "", label: "空" }, ...opts.map((o) => ({ value: o.id, label: o.label, color: o.color }))]}
        onChange={(v) => onCommit(v || null)}
      />
    );
  }

  if (prop.type === "multi_select" || prop.type === "tags") {
    const vals = (Array.isArray(raw) ? raw : []).map(String);
    return (
      <MiniChips
        prop={prop}
        values={vals}
        onChange={onCommit}
      />
    );
  }

  if (prop.type === "date" || prop.type === "datetime") {
    return (
      <CadenceDateField
        value={draft}
        mode={prop.type === "datetime" ? "datetime" : "date"}
        ariaLabel={prop.name}
        placeholder="空"
        onChange={(next) => {
          setDraft(next);
          onCommit(next || null);
        }}
      />
    );
  }

  if (prop.type === "files") {
    return (
      <MiniFiles
        note={note}
        files={(Array.isArray(raw) ? raw : []) as DbFileValue[]}
        userId={userId}
        databaseId={databaseId}
        onCommit={onCommit}
      />
    );
  }

  if (prop.type === "relation") {
    const ids = (Array.isArray(raw) ? raw : []).map(String);
    const byId = new Map(allRows.map((r) => [r.id, r]));
    return (
      <span className="ndb-rel">
        {ids.length === 0 ? (
          <em className="ndb-empty">空</em>
        ) : (
          ids.map((id) => (
            <Link key={id} href={`/notes/${id}`} className="ndb-rel-chip">
              {byId.get(id)?.title || id.slice(-6)}
            </Link>
          ))
        )}
      </span>
    );
  }

  const inputType =
    prop.type === "number"
      ? "number"
      : prop.type === "email"
        ? "email"
        : prop.type === "url"
          ? "url"
          : prop.type === "phone"
            ? "tel"
            : "text";

  return (
    <input
      className="ndb-input"
      type={inputType}
      value={draft}
      placeholder="空"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next =
          prop.type === "number"
            ? draft.trim() === "" || !Number.isFinite(Number(draft))
              ? null
              : Number(draft)
            : draft;
        onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function MiniChips({
  prop,
  values,
  onChange,
}: {
  prop: DbProperty;
  values: string[];
  onChange: (vals: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const opts = prop.options || [];
  const labelOf = (id: string) => opts.find((o) => o.id === id)?.label || id;

  return (
    <div className="ndb-chips">
      {values.map((v) => (
        <button
          key={v}
          type="button"
          className="ndb-chip"
          title="移除"
          onClick={() => onChange(values.filter((x) => x !== v))}
        >
          {labelOf(v)} ×
        </button>
      ))}
      {opts.length ? (
        <select
          className="ndb-chip-add"
          value=""
          aria-label={`新增 ${prop.name}`}
          onChange={(e) => {
            const v = e.target.value;
            if (!v || values.includes(v)) return;
            onChange([...values, v]);
          }}
        >
          <option value="">+</option>
          {opts
            .filter((o) => !values.includes(o.id))
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
        </select>
      ) : (
        <input
          className="ndb-chip-input"
          value={draft}
          placeholder="+"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const t = draft.trim().replace(/^#/, "");
            if (!t || values.includes(t)) return;
            onChange([...values, t]);
            setDraft("");
          }}
        />
      )}
    </div>
  );
}

function MiniFiles({
  note,
  files,
  userId,
  databaseId,
  onCommit,
}: {
  note: Note;
  files: DbFileValue[];
  userId: string;
  databaseId: string;
  onCommit: (value: unknown) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try {
      const next = [...files];
      for (const file of Array.from(list)) {
        const safe = file.name.replace(/[^\w.\-()\u4e00-\u9fff]+/g, "_");
        const path = `uploads/${userId}/db/${databaseId}/${note.id}/${Date.now()}_${safe}`;
        const url = await uploadFile(path, file);
        next.push({ url, name: file.name });
      }
      onCommit(next);
    } catch (e) {
      toast(e instanceof Error ? e.message : "上傳失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ndb-files">
      {files.map((f) => (
        <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="ndb-file">
          {f.name || "檔案"}
        </a>
      ))}
      <button type="button" className="ndb-file-add" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? "…" : "+"}
      </button>
      <input
        ref={inputRef}
        type="file"
        hidden
        multiple
        accept="image/*,audio/*,video/*,.pdf"
        onChange={(e) => {
          void upload(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function formatDraft(raw: unknown, prop: DbProperty): string {
  if (raw == null) return "";
  if (prop.type === "number") return String(raw);
  if (Array.isArray(raw)) return raw.map(String).join(", ");
  return String(raw);
}
