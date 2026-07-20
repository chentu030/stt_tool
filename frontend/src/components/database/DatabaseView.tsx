"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Note } from "@/lib/firebase";
import {
  addDatabaseView,
  addProperty,
  createDatabaseRow,
  evalFormula,
  getCellValue,
  listenDatabase,
  listenDatabaseRows,
  setCellValue,
  updateDatabase,
  type CadenceDatabase,
  type DbFileValue,
  type DbPropType,
  type DbProperty,
  type DbView,
  type DbViewType,
} from "@/lib/database";
import MenuSelect from "@/components/MenuSelect";
import { askPrompt } from "@/lib/dialogs";
import { toast } from "@/lib/toast";

type Props = {
  databaseId: string;
  userId: string;
  viewId?: string;
  compact?: boolean;
};

const ADDABLE: { type: DbPropType; label: string; group: string }[] = [
  { type: "text", label: "文字", group: "基本" },
  { type: "number", label: "數字", group: "基本" },
  { type: "checkbox", label: "核取方塊", group: "基本" },
  { type: "date", label: "日期", group: "基本" },
  { type: "datetime", label: "日期時間", group: "基本" },
  { type: "select", label: "單選", group: "選項" },
  { type: "multi_select", label: "多選", group: "選項" },
  { type: "status", label: "狀態", group: "選項" },
  { type: "tags", label: "標籤", group: "選項" },
  { type: "url", label: "網址", group: "聯絡" },
  { type: "email", label: "Email", group: "聯絡" },
  { type: "phone", label: "電話", group: "聯絡" },
  { type: "person", label: "人員", group: "聯絡" },
  { type: "files", label: "檔案／媒體", group: "進階" },
  { type: "relation", label: "關聯（列 ID）", group: "進階" },
  { type: "formula", label: "公式", group: "進階" },
  { type: "unique_id", label: "唯一 ID", group: "系統" },
  { type: "created_time", label: "建立時間", group: "系統" },
  { type: "last_edited_time", label: "最後編輯", group: "系統" },
  { type: "created_by", label: "建立者", group: "系統" },
  { type: "last_edited_by", label: "編輯者", group: "系統" },
];

const VIEW_TYPES: { type: DbViewType; label: string }[] = [
  { type: "table", label: "表格" },
  { type: "board", label: "看板" },
  { type: "list", label: "列表" },
  { type: "gallery", label: "畫廊" },
  { type: "calendar", label: "日曆" },
  { type: "form", label: "表單" },
];

export default function DatabaseView({ databaseId, userId, viewId, compact }: Props) {
  const router = useRouter();
  const [db, setDb] = useState<CadenceDatabase | null>(null);
  const [rows, setRows] = useState<Note[]>([]);
  const [activeViewId, setActiveViewId] = useState(viewId || "");
  const [addOpen, setAddOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  useEffect(
    () =>
      listenDatabase(databaseId, setDb, (err) =>
        setError(
          /permission|insufficient|Missing/i.test(err.message)
            ? "沒有權限讀取此資料庫"
            : err.message || "無法載入資料庫"
        )
      ),
    [databaseId]
  );
  useEffect(() => listenDatabaseRows(userId, databaseId, setRows), [userId, databaseId]);
  useEffect(() => {
    if (viewId) setActiveViewId(viewId);
    else if (db?.views?.[0] && !activeViewId) setActiveViewId(db.views[0].id);
  }, [db, viewId, activeViewId]);

  const view: DbView | undefined = useMemo(
    () => db?.views.find((v) => v.id === activeViewId) || db?.views[0],
    [db, activeViewId]
  );

  const props = db?.properties || [];

  const filteredRows = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return rows;
    return rows.filter((row) => {
      if ((row.title || "").toLowerCase().includes(qq)) return true;
      if ((row.body_md || "").toLowerCase().includes(qq)) return true;
      for (const p of props) {
        const v = p.type === "formula" ? evalFormula(p, row, props) : getCellValue(row, p);
        if (v == null) continue;
        const s = Array.isArray(v) ? v.join(" ") : String(v);
        if (s.toLowerCase().includes(qq)) return true;
      }
      return false;
    });
  }, [rows, q, props]);

  const openRow = (id: string) => router.push(`/notes/${id}`);

  const addRow = async () => {
    try {
      const id = await createDatabaseRow(userId, databaseId, "未命名");
      toast("已新增列 — 可開啟頁面放入任意內容");
      openRow(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const addProp = async (type: DbPropType) => {
    if (!db) return;
    setAddOpen(false);
    let next = addProperty(db.properties, type);
    if (type === "formula") {
      const expr = await askPrompt({
        title: "公式",
        message: "可用 {{屬性id}}，例如 {{title}} 或 {{priority}}。也可寫 {{a}}+{{b}}。",
        defaultValue: "{{title}}",
        placeholder: "{{title}}",
      });
      if (expr != null) {
        const last = next[next.length - 1];
        next = next.map((p) => (p.id === last.id ? { ...p, formula: expr.trim() || "{{title}}" } : p));
      }
    }
    await updateDatabase(db.id, { properties: next });
  };

  const addView = async (type: DbViewType) => {
    if (!db) return;
    setViewMenuOpen(false);
    const next = addDatabaseView(db.views, type);
    await updateDatabase(db.id, { views: next });
    setActiveViewId(next[next.length - 1].id);
  };

  if (!db) {
    return <p className="cdb-empty">{error || "載入資料庫…"}</p>;
  }

  return (
    <div className={`cdb${compact ? " cdb--compact" : ""}`}>
      <div className="cdb-toolbar">
        <div className="cdb-title-row">
          <span className="cdb-icon">{db.icon || "▦"}</span>
          <input
            className="cdb-name"
            value={db.name}
            onChange={(e) => setDb({ ...db, name: e.target.value })}
            onBlur={(e) => void updateDatabase(db.id, { name: e.target.value || "未命名資料庫" })}
          />
          <Link href={`/db/${db.id}`} className="cdb-open-full" title="全頁開啟">
            全頁
          </Link>
        </div>
        <p className="cdb-hint">
          每一列都是完整筆記頁：可放入文字、圖片、嵌入、白板連結等任意內容。點標題或「開啟頁面」編輯。
        </p>
        <div className="cdb-toolbar-row">
          <div className="cdb-views">
            {db.views.map((v) => (
              <button
                key={v.id}
                type="button"
                className={`cdb-view-tab${view?.id === v.id ? " is-on" : ""}`}
                onClick={() => setActiveViewId(v.id)}
              >
                {v.name}
              </button>
            ))}
            <div className="cdb-view-add-wrap">
              <button
                type="button"
                className="cdb-view-tab cdb-view-add"
                onClick={() => setViewMenuOpen((v) => !v)}
              >
                + 視圖
              </button>
              {viewMenuOpen && (
                <div className="cdb-add-menu cdb-view-menu">
                  {VIEW_TYPES.map((v) => (
                    <button key={v.type} type="button" onClick={() => void addView(v.type)}>
                      {v.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <input
            className="cdb-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜尋列…"
            aria-label="搜尋"
          />
          <button type="button" className="btn" onClick={() => void addRow()}>
            + 新增列
          </button>
        </div>
      </div>

      {error && <p className="cdb-error">{error}</p>}

      {view?.type === "board" ? (
        <BoardView
          rows={filteredRows}
          props={props}
          groupBy={view.groupBy || "status"}
          onOpen={openRow}
          onAdd={() => void addRow()}
        />
      ) : view?.type === "gallery" ? (
        <GalleryView rows={filteredRows} props={props} onOpen={openRow} onAdd={() => void addRow()} />
      ) : view?.type === "calendar" ? (
        <CalendarView
          rows={filteredRows}
          props={props}
          dateProp={view.dateProp || "due"}
          onOpen={openRow}
          onAdd={() => void addRow()}
        />
      ) : view?.type === "form" ? (
        <FormView
          userId={userId}
          databaseId={databaseId}
          props={props}
          onCreated={(id) => openRow(id)}
        />
      ) : view?.type === "list" ? (
        <div className="cdb-list">
          {filteredRows.map((row) => (
            <div key={row.id} className="cdb-list-row-wrap">
              <Link href={`/notes/${row.id}`} className="cdb-list-row">
                <strong>{row.title || "未命名"}</strong>
                <span className="cdb-list-excerpt">
                  {(row.body_md || "").replace(/[#>*`\[\]]/g, "").slice(0, 80) || "空白頁 — 點擊編輯任意內容"}
                </span>
                <span>{row.updated_at.toLocaleDateString("zh-TW")}</span>
              </Link>
              <button type="button" className="btn btn-ghost cdb-open-page" onClick={() => openRow(row.id)}>
                開啟頁面
              </button>
            </div>
          ))}
          <button type="button" className="cdb-add-row" onClick={() => void addRow()}>
            + 新增
          </button>
        </div>
      ) : (
        <div className="cdb-table-wrap">
          <table className="cdb-table">
            <thead>
              <tr>
                <th className="cdb-th-open" />
                {props.map((p) => (
                  <th key={p.id}>
                    <span>{p.name}</span>
                    <em>{typeLabel(p.type)}</em>
                  </th>
                ))}
                <th className="cdb-th-add">
                  <button type="button" className="cdb-add-prop" onClick={() => setAddOpen((v) => !v)}>
                    +
                  </button>
                  {addOpen && (
                    <div className="cdb-add-menu cdb-add-menu--wide">
                      {["基本", "選項", "聯絡", "進階", "系統"].map((g) => (
                        <div key={g} className="cdb-add-group">
                          <strong>{g}</strong>
                          {ADDABLE.filter((a) => a.group === g).map((a) => (
                            <button key={a.type} type="button" onClick={() => void addProp(a.type)}>
                              {a.label}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id}>
                  <td className="cdb-td-open">
                    <button type="button" className="cdb-open-page" onClick={() => openRow(row.id)} title="開啟完整筆記頁">
                      ↗
                    </button>
                  </td>
                  {props.map((p) => (
                    <td key={p.id}>
                      <PropertyCell
                        row={row}
                        prop={p}
                        allProps={props}
                        onOpen={() => openRow(row.id)}
                      />
                    </td>
                  ))}
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="cdb-add-row" onClick={() => void addRow()}>
            + 新增列（並開啟筆記頁）
          </button>
        </div>
      )}
    </div>
  );
}

function typeLabel(t: DbPropType) {
  const map: Record<string, string> = {
    title: "標題",
    text: "文字",
    number: "數字",
    checkbox: "核取",
    date: "日期",
    datetime: "日期時間",
    select: "單選",
    multi_select: "多選",
    status: "狀態",
    tags: "標籤",
    url: "URL",
    email: "Email",
    phone: "電話",
    files: "檔案",
    person: "人員",
    relation: "關聯",
    formula: "公式",
    unique_id: "ID",
    created_time: "建立",
    last_edited_time: "編輯",
    created_by: "建立者",
    last_edited_by: "編輯者",
  };
  return map[t] || t;
}

function PropertyCell({
  row,
  prop,
  allProps,
  onOpen,
}: {
  row: Note;
  prop: DbProperty;
  allProps: DbProperty[];
  onOpen: () => void;
}) {
  const raw = getCellValue(row, prop);
  const [draft, setDraft] = useState(formatDraft(raw, prop));

  useEffect(() => {
    setDraft(formatDraft(raw, prop));
  }, [raw, prop]);

  if (prop.type === "title") {
    return (
      <button type="button" className="cdb-title-cell" onClick={onOpen}>
        {row.title || "未命名"}
      </button>
    );
  }

  if (prop.type === "formula") {
    return <span className="cdb-readonly cdb-formula">{evalFormula(prop, row, allProps) || "—"}</span>;
  }

  if (prop.type === "checkbox") {
    return (
      <input
        type="checkbox"
        checked={!!raw}
        onChange={(e) => void setCellValue(row, prop, e.target.checked)}
      />
    );
  }

  if (prop.type === "select" || prop.type === "status") {
    const opts = prop.options || [];
    return (
      <MenuSelect
        variant="ghost"
        size="sm"
        className="cdb-select"
        ariaLabel={prop.name || "選擇"}
        value={String(raw || "")}
        options={[
          { value: "", label: "—" },
          ...opts.map((o) => ({ value: o.id, label: o.label })),
        ]}
        onChange={(v) => void setCellValue(row, prop, v || null)}
      />
    );
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
      return <span className="cdb-readonly">{d ? d.toLocaleString("zh-TW") : "—"}</span>;
    }
    return <span className="cdb-readonly">{String(raw || "—")}</span>;
  }

  if (prop.type === "files") {
    const files = (Array.isArray(raw) ? raw : []) as DbFileValue[];
    return (
      <div className="cdb-files-cell">
        {files.map((f) => (
          <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="cdb-file-chip">
            {f.name || "檔案"}
          </a>
        ))}
        <input
          className="cdb-cell-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void setCellValue(row, prop, draft)}
          placeholder="貼上 https 連結…"
        />
      </div>
    );
  }

  if (prop.type === "relation") {
    return (
      <input
        className="cdb-cell-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void setCellValue(row, prop, draft)}
        placeholder="關聯列 ID，逗號分隔"
      />
    );
  }

  const inputType =
    prop.type === "number"
      ? "number"
      : prop.type === "date"
        ? "date"
        : prop.type === "datetime"
          ? "datetime-local"
          : prop.type === "email"
            ? "email"
            : prop.type === "url"
              ? "url"
              : prop.type === "phone"
                ? "tel"
                : "text";

  return (
    <input
      className="cdb-cell-input"
      type={inputType}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        let v: unknown = draft;
        if (prop.type === "number") v = draft === "" ? null : Number(draft);
        if (prop.type === "tags" || prop.type === "multi_select") {
          v = draft
            .split(/[,，]/)
            .map((x) => x.trim())
            .filter(Boolean);
        }
        void setCellValue(row, prop, v);
      }}
      placeholder={
        prop.type === "tags" || prop.type === "multi_select"
          ? "逗號分隔"
          : prop.type === "person"
            ? "人名"
            : ""
      }
    />
  );
}

function formatDraft(raw: unknown, prop: DbProperty): string {
  if (raw == null) return "";
  if (prop.type === "files" && Array.isArray(raw)) {
    return (raw as DbFileValue[]).map((f) => f.url).join("\n");
  }
  if (Array.isArray(raw)) return raw.join(", ");
  if (prop.type === "datetime" && typeof raw === "string" && raw.includes("T")) {
    return raw.slice(0, 16);
  }
  return String(raw);
}

function statusProp(props: DbProperty[], groupBy?: string) {
  return props.find((p) => p.id === groupBy) || props.find((p) => p.type === "status");
}

function BoardView({
  rows,
  props,
  groupBy,
  onOpen,
  onAdd,
}: {
  rows: Note[];
  props: DbProperty[];
  groupBy: string;
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  const sp = statusProp(props, groupBy);
  const cols = sp?.options?.length
    ? sp.options
    : [
        { id: "_none", label: "未分類" },
      ];
  const byCol = new Map<string, Note[]>();
  for (const c of cols) byCol.set(c.id, []);
  if (!byCol.has("_none")) byCol.set("_none", []);
  for (const row of rows) {
    const v = sp ? String(getCellValue(row, sp) || "") : "";
    const key = byCol.has(v) ? v : "_none";
    byCol.get(key)!.push(row);
  }
  return (
    <div className="cdb-board">
      {cols.map((c) => (
        <div key={c.id} className="cdb-board-col">
          <header>
            <strong>{c.label}</strong>
            <span>{byCol.get(c.id)?.length || 0}</span>
          </header>
          <div className="cdb-board-cards">
            {(byCol.get(c.id) || []).map((row) => (
              <button key={row.id} type="button" className="cdb-board-card" onClick={() => onOpen(row.id)}>
                <strong>{row.title || "未命名"}</strong>
                <span>{(row.body_md || "").replace(/[#>*`\[\]]/g, "").slice(0, 60) || "開啟頁面編輯內容"}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {byCol.get("_none")?.length ? (
        <div className="cdb-board-col">
          <header>
            <strong>未分類</strong>
            <span>{byCol.get("_none")?.length}</span>
          </header>
          <div className="cdb-board-cards">
            {(byCol.get("_none") || []).map((row) => (
              <button key={row.id} type="button" className="cdb-board-card" onClick={() => onOpen(row.id)}>
                <strong>{row.title || "未命名"}</strong>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <button type="button" className="cdb-add-row" onClick={onAdd}>
        + 新增列
      </button>
    </div>
  );
}

function GalleryView({
  rows,
  props,
  onOpen,
  onAdd,
}: {
  rows: Note[];
  props: DbProperty[];
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  const fileProp = props.find((p) => p.type === "files");
  return (
    <div className="cdb-gallery">
      {rows.map((row) => {
        const files = fileProp
          ? ((getCellValue(row, fileProp) as DbFileValue[]) || [])
          : [];
        const cover = files.find((f) => /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(f.url))?.url;
        return (
          <button key={row.id} type="button" className="cdb-gallery-card" onClick={() => onOpen(row.id)}>
            <div
              className="cdb-gallery-cover"
              style={cover ? { backgroundImage: `url(${cover})` } : undefined}
            />
            <strong>{row.title || "未命名"}</strong>
            <span>{(row.body_md || "").replace(/[#>*`\[\]]/g, "").slice(0, 90) || "點擊開啟完整頁面"}</span>
          </button>
        );
      })}
      <button type="button" className="cdb-gallery-card cdb-gallery-add" onClick={onAdd}>
        + 新增
      </button>
    </div>
  );
}

function CalendarView({
  rows,
  props,
  dateProp,
  onOpen,
  onAdd,
}: {
  rows: Note[];
  props: DbProperty[];
  dateProp: string;
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  const dp = props.find((p) => p.id === dateProp) || props.find((p) => p.type === "date" || p.type === "datetime");
  const withDate = rows
    .map((row) => {
      const v = dp ? getCellValue(row, dp) : null;
      const day = v ? String(v).slice(0, 10) : "";
      return { row, day };
    })
    .filter((x) => x.day)
    .sort((a, b) => a.day.localeCompare(b.day));
  const noDate = rows.filter((row) => {
    const v = dp ? getCellValue(row, dp) : null;
    return !v;
  });
  const groups = new Map<string, Note[]>();
  for (const { row, day } of withDate) {
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(row);
  }
  return (
    <div className="cdb-calendar">
      {[...groups.entries()].map(([day, list]) => (
        <div key={day} className="cdb-cal-day">
          <h3>{day}</h3>
          {list.map((row) => (
            <button key={row.id} type="button" className="cdb-cal-item" onClick={() => onOpen(row.id)}>
              {row.title || "未命名"}
            </button>
          ))}
        </div>
      ))}
      {noDate.length > 0 && (
        <div className="cdb-cal-day">
          <h3>未設定日期</h3>
          {noDate.map((row) => (
            <button key={row.id} type="button" className="cdb-cal-item" onClick={() => onOpen(row.id)}>
              {row.title || "未命名"}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="cdb-add-row" onClick={onAdd}>
        + 新增列
      </button>
    </div>
  );
}

function FormView({
  userId,
  databaseId,
  props,
  onCreated,
}: {
  userId: string;
  databaseId: string;
  props: DbProperty[];
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const editable = props.filter(
    (p) =>
      !["title", "formula", "unique_id", "created_time", "last_edited_time", "created_by", "last_edited_by"].includes(
        p.type
      )
  );

  const submit = async () => {
    setBusy(true);
    try {
      const propsObj: Record<string, unknown> = {};
      for (const p of editable) {
        const raw = values[p.id];
        if (raw == null || raw === "") continue;
        if (p.type === "number") propsObj[p.id] = Number(raw);
        else if (p.type === "checkbox") propsObj[p.id] = raw === "true" || raw === "1";
        else if (p.type === "multi_select" || p.type === "tags") {
          propsObj[p.id] = raw.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
        } else propsObj[p.id] = raw;
      }
      const id = await createDatabaseRow(userId, databaseId, title.trim() || "未命名", propsObj);
      setTitle("");
      setValues({});
      toast("已建立 — 正在開啟筆記頁");
      onCreated(id);
    } catch (e) {
      toast(e instanceof Error ? e.message : "建立失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cdb-form">
      <p className="cdb-hint">用表單快速建列；送出後會開啟完整筆記頁，可繼續塞入任意內容。</p>
      <label>
        標題
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="名稱" />
      </label>
      {editable.map((p) => (
        <label key={p.id}>
          {p.name}
          {p.type === "checkbox" ? (
            <input
              type="checkbox"
              checked={values[p.id] === "true"}
              onChange={(e) => setValues((v) => ({ ...v, [p.id]: e.target.checked ? "true" : "" }))}
            />
          ) : p.type === "select" || p.type === "status" ? (
            <select
              value={values[p.id] || ""}
              onChange={(e) => setValues((v) => ({ ...v, [p.id]: e.target.value }))}
            >
              <option value="">—</option>
              {(p.options || []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={p.type === "number" ? "number" : p.type === "date" ? "date" : "text"}
              value={values[p.id] || ""}
              onChange={(e) => setValues((v) => ({ ...v, [p.id]: e.target.value }))}
            />
          )}
        </label>
      ))}
      <button type="button" className="btn" disabled={busy} onClick={() => void submit()}>
        {busy ? "建立中…" : "建立並開啟頁面"}
      </button>
    </div>
  );
}
