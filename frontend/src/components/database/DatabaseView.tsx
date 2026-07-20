"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Note } from "@/lib/firebase";
import {
  addProperty,
  createDatabaseRow,
  getCellValue,
  listenDatabase,
  listenDatabaseRows,
  setCellValue,
  updateDatabase,
  type CadenceDatabase,
  type DbPropType,
  type DbProperty,
  type DbView,
} from "@/lib/database";
import MenuSelect from "@/components/MenuSelect";

type Props = {
  databaseId: string;
  userId: string;
  viewId?: string;
  compact?: boolean;
};

const ADDABLE: { type: DbPropType; label: string }[] = [
  { type: "text", label: "文字" },
  { type: "number", label: "數字" },
  { type: "checkbox", label: "核取方塊" },
  { type: "date", label: "日期" },
  { type: "datetime", label: "日期時間" },
  { type: "select", label: "單選" },
  { type: "multi_select", label: "多選" },
  { type: "status", label: "狀態" },
  { type: "tags", label: "標籤" },
  { type: "url", label: "網址" },
  { type: "email", label: "Email" },
  { type: "phone", label: "電話" },
];

export default function DatabaseView({ databaseId, userId, viewId, compact }: Props) {
  const router = useRouter();
  const [db, setDb] = useState<CadenceDatabase | null>(null);
  const [rows, setRows] = useState<Note[]>([]);
  const [activeViewId, setActiveViewId] = useState(viewId || "");
  const [addOpen, setAddOpen] = useState(false);
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

  const addRow = async () => {
    try {
      const id = await createDatabaseRow(userId, databaseId, "未命名");
      router.push(`/notes/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const addProp = async (type: DbPropType) => {
    if (!db) return;
    setAddOpen(false);
    const next = addProperty(db.properties, type);
    await updateDatabase(db.id, { properties: next });
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
            onChange={(e) => {
              const name = e.target.value;
              setDb({ ...db, name });
            }}
            onBlur={(e) => void updateDatabase(db.id, { name: e.target.value || "未命名資料庫" })}
          />
          <Link href={`/db/${db.id}`} className="cdb-open-full" title="全頁開啟">
            全頁
          </Link>
        </div>
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
        </div>
      </div>

      {error && <p className="cdb-error">{error}</p>}

      {view?.type === "list" ? (
        <div className="cdb-list">
          {rows.map((row) => (
            <Link key={row.id} href={`/notes/${row.id}`} className="cdb-list-row">
              <strong>{row.title || "未命名"}</strong>
              <span>{row.updated_at.toLocaleDateString("zh-TW")}</span>
            </Link>
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
                    <div className="cdb-add-menu">
                      {ADDABLE.map((a) => (
                        <button key={a.type} type="button" onClick={() => void addProp(a.type)}>
                          {a.label}
                        </button>
                      ))}
                    </div>
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {props.map((p) => (
                    <td key={p.id}>
                      <PropertyCell
                        row={row}
                        prop={p}
                        onOpen={() => router.push(`/notes/${row.id}`)}
                      />
                    </td>
                  ))}
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="cdb-add-row" onClick={() => void addRow()}>
            + 新增列
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
    created_time: "建立",
    last_edited_time: "編輯",
  };
  return map[t] || t;
}

function PropertyCell({
  row,
  prop,
  onOpen,
}: {
  row: Note;
  prop: DbProperty;
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

  if (prop.type === "created_time" || prop.type === "last_edited_time") {
    const d = raw ? new Date(String(raw)) : null;
    return <span className="cdb-readonly">{d ? d.toLocaleString("zh-TW") : "—"}</span>;
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
        if (prop.type === "tags") v = draft;
        if (prop.type === "multi_select") {
          v = draft
            .split(/[,，]/)
            .map((x) => x.trim())
            .filter(Boolean);
        }
        void setCellValue(row, prop, v);
      }}
      placeholder={prop.type === "tags" || prop.type === "multi_select" ? "逗號分隔" : ""}
    />
  );
}

function formatDraft(raw: unknown, prop: DbProperty): string {
  if (raw == null) return "";
  if (Array.isArray(raw)) return raw.join(", ");
  if (prop.type === "datetime" && typeof raw === "string" && raw.includes("T")) {
    return raw.slice(0, 16);
  }
  return String(raw);
}
