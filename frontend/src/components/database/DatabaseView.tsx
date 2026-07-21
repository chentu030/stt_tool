"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Note } from "@/lib/firebase";
import { uploadFile } from "@/lib/firebase";
import {
  addDatabaseView,
  addProperty,
  applyViewPipeline,
  createDatabaseRow,
  evalFormula,
  evalRollup,
  getCellValue,
  listenDatabase,
  listenDatabaseRows,
  patchView,
  setCellValue,
  updateDatabase,
  visibleProperties,
  type CadenceDatabase,
  type DbFileValue,
  type DbFilter,
  type DbFilterOp,
  type DbPropType,
  type DbProperty,
  type DbRollupCalc,
  type DbSort,
  type DbView,
  type DbViewType,
} from "@/lib/database";
import MenuSelect from "@/components/MenuSelect";
import { askPrompt } from "@/lib/dialogs";
import { toast } from "@/lib/toast";

/** Fixed-position menu portaled to body so table overflow cannot clip it. */
function CdbPortalMenu({
  open,
  anchorRef,
  onClose,
  className = "",
  align = "right",
  children,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  className?: string;
  align?: "left" | "right";
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  const updatePos = () => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = 240;
    const pad = 8;
    let left = align === "right" ? r.right - width : r.left;
    left = Math.max(pad, Math.min(left, window.innerWidth - width - pad));
    const spaceBelow = window.innerHeight - r.bottom - pad;
    const spaceAbove = r.top - pad;
    const placeBelow = spaceBelow >= 180 || spaceBelow >= spaceAbove;
    const maxHeight = Math.max(160, Math.min(360, placeBelow ? spaceBelow : spaceAbove));
    const top = placeBelow ? r.bottom + 4 : Math.max(pad, r.top - maxHeight - 4);
    setPos({ top, left, maxHeight });
  };

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    updatePos();
  }, [open, align]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onReposition = () => updatePos();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !pos || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      className={`cdb-add-menu cdb-add-menu--portal ${className}`.trim()}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        maxHeight: pos.maxHeight,
        zIndex: 5200,
      }}
      role="menu"
    >
      {children}
    </div>,
    document.body
  );
}

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
  { type: "relation", label: "關聯", group: "進階" },
  { type: "rollup", label: "彙總（Rollup）", group: "進階" },
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

const FILTER_OPS: { value: DbFilterOp; label: string }[] = [
  { value: "eq", label: "等於" },
  { value: "neq", label: "不等於" },
  { value: "contains", label: "包含" },
  { value: "empty", label: "為空" },
  { value: "not_empty", label: "不為空" },
];

const ROLLUP_CALCS: { value: DbRollupCalc; label: string }[] = [
  { value: "count", label: "計數" },
  { value: "sum", label: "加總" },
  { value: "avg", label: "平均" },
  { value: "min", label: "最小" },
  { value: "max", label: "最大" },
  { value: "earliest", label: "最早" },
  { value: "latest", label: "最晚" },
  { value: "show", label: "顯示原值" },
];

export default function DatabaseView({ databaseId, userId, viewId, compact }: Props) {
  const router = useRouter();
  const [db, setDb] = useState<CadenceDatabase | null>(null);
  const [rows, setRows] = useState<Note[]>([]);
  const [activeViewId, setActiveViewId] = useState(viewId || "");
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const addPropBtnRef = useRef<HTMLButtonElement>(null);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const layoutBtnRef = useRef<HTMLButtonElement>(null);
  const [panel, setPanel] = useState<"filter" | "sort" | "props" | null>(null);
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
  const shownProps = useMemo(() => visibleProperties(props, view), [props, view]);

  const pipedRows = useMemo(() => applyViewPipeline(rows, view, props), [rows, view, props]);

  const filteredRows = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return pipedRows;
    return pipedRows.filter((row) => {
      if ((row.title || "").toLowerCase().includes(qq)) return true;
      if ((row.body_md || "").toLowerCase().includes(qq)) return true;
      for (const p of props) {
        const v =
          p.type === "formula"
            ? evalFormula(p, row, props, rows)
            : p.type === "rollup"
              ? evalRollup(p, row, props, rows)
              : getCellValue(row, p);
        if (v == null) continue;
        const s = Array.isArray(v) ? v.join(" ") : String(v);
        if (s.toLowerCase().includes(qq)) return true;
      }
      return false;
    });
  }, [pipedRows, q, props, rows]);

  const openRow = (id: string) => router.push(`/notes/${id}`);

  const saveViews = async (next: DbView[]) => {
    if (!db) return;
    setDb({ ...db, views: next });
    await updateDatabase(db.id, { views: next });
  };

  const patchActiveView = async (patch: Partial<DbView>) => {
    if (!db || !view) return;
    await saveViews(patchView(db.views, view.id, patch));
  };

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
        message: "可用 {{屬性id}}、if(條件,是,否)、days(日期a,日期b)。例如 if({{status}},完成,未完成)",
        defaultValue: "{{title}}",
        placeholder: "{{title}}",
      });
      if (expr != null) {
        const last = next[next.length - 1];
        next = next.map((p) => (p.id === last.id ? { ...p, formula: expr.trim() || "{{title}}" } : p));
      }
    }
    if (type === "rollup") {
      const rel = next.find((p) => p.type === "relation");
      if (!rel) toast("建議先新增「關聯」屬性，再設定彙總來源");
      const last = next[next.length - 1];
      next = next.map((p) =>
        p.id === last.id
          ? {
              ...p,
              rollup: {
                relationPropId: rel?.id || "",
                targetPropId: "title",
                calc: "count",
              },
            }
          : p
      );
    }
    await updateDatabase(db.id, { properties: next });
  };

  const addView = async (type: DbViewType) => {
    if (!db) return;
    setLayoutOpen(false);
    setSettingsOpen(false);
    const next = addDatabaseView(db.views, type);
    await updateDatabase(db.id, { views: next });
    setActiveViewId(next[next.length - 1].id);
  };

  const openPanel = (next: "filter" | "sort" | "props") => {
    setSettingsOpen(false);
    setPanel((p) => (p === next ? null : next));
  };

  if (!db) {
    return <p className="cdb-empty">{error || "載入資料庫…"}</p>;
  }

  const filterCount = view?.filters?.length || 0;
  const sortCount = view?.sorts?.length || 0;

  return (
    <div className={`cdb${compact ? " cdb--compact" : ""}`}>
      <div className="cdb-toolbar">
        <div className="cdb-title-row">
          <span className="cdb-icon" aria-hidden>
            {db.icon || "▦"}
          </span>
          <input
            className="cdb-name"
            value={db.name}
            onChange={(e) => setDb({ ...db, name: e.target.value })}
            onBlur={(e) => void updateDatabase(db.id, { name: e.target.value || "未命名資料庫" })}
            aria-label="資料庫名稱"
          />
          <div className="cdb-title-actions">
            <Link href={`/db/${db.id}`} className="cdb-icon-btn" title="全頁開啟" aria-label="全頁開啟">
              ↗
            </Link>
            <button
              ref={settingsBtnRef}
              type="button"
              className={`cdb-icon-btn${settingsOpen || panel ? " is-on" : ""}`}
              title="設定"
              aria-label="資料庫設定"
              aria-expanded={settingsOpen}
              onClick={() => {
                setSettingsOpen((v) => !v);
                setLayoutOpen(false);
              }}
            >
              ☰
            </button>
            <button type="button" className="btn btn-sm cdb-new-btn" onClick={() => void addRow()}>
              新建
            </button>
          </div>
        </div>

        <CdbPortalMenu
          open={settingsOpen}
          anchorRef={settingsBtnRef}
          onClose={() => {
            setSettingsOpen(false);
            setLayoutOpen(false);
          }}
          className="cdb-settings-menu"
          align="right"
        >
          <p className="cdb-settings-label">瀏覽</p>
          {db.views.map((v) => (
            <button
              key={v.id}
              type="button"
              className={view?.id === v.id ? "is-on" : ""}
              onClick={() => {
                setActiveViewId(v.id);
                setPanel(null);
                setSettingsOpen(false);
              }}
            >
              {v.name}
              <em>{VIEW_TYPES.find((t) => t.type === v.type)?.label || v.type}</em>
            </button>
          ))}
          <div className="cdb-settings-sub">
            <button
              ref={layoutBtnRef}
              type="button"
              onClick={() => setLayoutOpen((v) => !v)}
            >
              + 新增視圖
            </button>
            <CdbPortalMenu
              open={layoutOpen}
              anchorRef={layoutBtnRef}
              onClose={() => setLayoutOpen(false)}
              className="cdb-view-menu"
              align="left"
            >
              {VIEW_TYPES.map((v) => (
                <button key={v.type} type="button" onClick={() => void addView(v.type)}>
                  {v.label}
                </button>
              ))}
            </CdbPortalMenu>
          </div>

          <hr className="cdb-settings-sep" />
          <button type="button" onClick={() => openPanel("filter")}>
            篩選{filterCount ? ` · ${filterCount}` : ""}
          </button>
          <button type="button" onClick={() => openPanel("sort")}>
            排序{sortCount ? ` · ${sortCount}` : ""}
          </button>
          <button type="button" onClick={() => openPanel("props")}>
            屬性
          </button>
          {view?.type === "board" && (
            <div className="cdb-settings-inline">
              <span>分組</span>
              <MenuSelect
                variant="toolbar"
                size="sm"
                ariaLabel="分組依據"
                value={view.groupBy || "status"}
                options={props
                  .filter((p) => p.type === "status" || p.type === "select")
                  .map((p) => ({ value: p.id, label: p.name }))}
                onChange={(groupBy) => void patchActiveView({ groupBy })}
              />
            </div>
          )}
          {view?.type === "calendar" && (
            <div className="cdb-settings-inline">
              <span>日期欄</span>
              <MenuSelect
                variant="toolbar"
                size="sm"
                ariaLabel="日期欄"
                value={view.dateProp || "due"}
                options={props
                  .filter((p) => p.type === "date" || p.type === "datetime")
                  .map((p) => ({ value: p.id, label: p.name }))}
                onChange={(dateProp) => void patchActiveView({ dateProp })}
              />
            </div>
          )}
          {view?.type === "gallery" && (
            <>
              <div className="cdb-settings-inline">
                <span>顯示</span>
                <MenuSelect
                  variant="toolbar"
                  size="sm"
                  ariaLabel="畫廊密度"
                  value={view.cardDensity || "comfy"}
                  options={[
                    { value: "comfy", label: "舒適" },
                    { value: "compact", label: "緊湊" },
                  ]}
                  onChange={(cardDensity) =>
                    void patchActiveView({
                      cardDensity: cardDensity as "comfy" | "compact",
                      cardSize: cardDensity === "compact" ? "s" : "m",
                    })
                  }
                />
              </div>
              <div className="cdb-settings-inline">
                <span>封面</span>
                <MenuSelect
                  variant="toolbar"
                  size="sm"
                  ariaLabel="封面欄"
                  value={view.coverPropId || ""}
                  options={[
                    { value: "", label: "自動" },
                    ...props
                      .filter((p) => p.type === "files" || p.type === "url" || p.type === "text")
                      .map((p) => ({ value: p.id, label: p.name })),
                  ]}
                  onChange={(coverPropId) => void patchActiveView({ coverPropId: coverPropId || undefined })}
                />
              </div>
            </>
          )}

          <hr className="cdb-settings-sep" />
          <label className="cdb-settings-search">
            <span>搜尋</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜尋列…"
              aria-label="搜尋"
            />
          </label>
        </CdbPortalMenu>

        {panel === "filter" && view && (
          <FilterPanel
            props={props}
            filters={view.filters || []}
            onChange={(filters) => void patchActiveView({ filters })}
          />
        )}
        {panel === "sort" && view && (
          <SortPanel
            props={props}
            sorts={view.sorts || []}
            onChange={(sorts) => void patchActiveView({ sorts })}
          />
        )}
        {panel === "props" && view && (
          <PropsPanel
            props={props}
            visibleIds={view.visiblePropIds}
            onChange={(visiblePropIds) => void patchActiveView({ visiblePropIds })}
            onConfigureRollup={async (propId) => {
              const p = props.find((x) => x.id === propId);
              if (!p || p.type !== "rollup") return;
              const rels = props.filter((x) => x.type === "relation");
              if (!rels.length) {
                toast("請先新增關聯屬性");
                return;
              }
              const relId =
                (await askPrompt({
                  title: "彙總 — 關聯來源",
                  message: `輸入關聯屬性 id（可用：${rels.map((r) => `${r.name}=${r.id}`).join("、")}）`,
                  defaultValue: p.rollup?.relationPropId || rels[0].id,
                })) || "";
              const targetId =
                (await askPrompt({
                  title: "彙總 — 目標屬性",
                  message: "輸入要彙總的屬性 id（例如 title、數字欄 id）",
                  defaultValue: p.rollup?.targetPropId || "title",
                })) || "title";
              const calcRaw =
                (await askPrompt({
                  title: "彙總方式",
                  message: "count / sum / avg / min / max / earliest / latest / show",
                  defaultValue: p.rollup?.calc || "count",
                })) || "count";
              const calc = (ROLLUP_CALCS.some((c) => c.value === calcRaw) ? calcRaw : "count") as DbRollupCalc;
              const next = props.map((x) =>
                x.id === propId
                  ? { ...x, rollup: { relationPropId: relId.trim(), targetPropId: targetId.trim(), calc } }
                  : x
              );
              await updateDatabase(db.id, { properties: next });
            }}
          />
        )}
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
        <GalleryView
          rows={filteredRows}
          props={props}
          view={view}
          onOpen={openRow}
          onAdd={() => void addRow()}
        />
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
                {shownProps.map((p) => (
                  <th key={p.id}>
                    <span>{p.name}</span>
                    <em>{typeLabel(p.type)}</em>
                  </th>
                ))}
                <th className="cdb-th-add">
                  <button
                    ref={addPropBtnRef}
                    type="button"
                    className="cdb-add-prop"
                    onClick={() => setAddOpen((v) => !v)}
                    aria-expanded={addOpen}
                    aria-haspopup="menu"
                    title="新增屬性"
                  >
                    +
                  </button>
                  <CdbPortalMenu
                    open={addOpen}
                    anchorRef={addPropBtnRef}
                    onClose={() => setAddOpen(false)}
                    className="cdb-add-menu--wide"
                    align="right"
                  >
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
                  </CdbPortalMenu>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id}>
                  <td className="cdb-td-open">
                    <button
                      type="button"
                      className="cdb-open-page"
                      onClick={() => openRow(row.id)}
                      title="開啟完整筆記頁"
                    >
                      ↗
                    </button>
                  </td>
                  {shownProps.map((p) => (
                    <td key={p.id}>
                      <PropertyCell
                        row={row}
                        prop={p}
                        allProps={props}
                        allRows={rows}
                        userId={userId}
                        databaseId={databaseId}
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

function FilterPanel({
  props,
  filters,
  onChange,
}: {
  props: DbProperty[];
  filters: DbFilter[];
  onChange: (f: DbFilter[]) => void;
}) {
  const add = () => {
    const first = props[0];
    if (!first) return;
    onChange([...filters, { propId: first.id, op: "eq", value: "" }]);
  };
  return (
    <div className="cdb-panel">
      <header>
        <strong>篩選</strong>
        <button type="button" className="btn btn-ghost" onClick={add}>
          + 條件
        </button>
      </header>
      {filters.length === 0 && <p className="cdb-panel-empty">尚無條件 — 此視圖顯示全部列</p>}
      {filters.map((f, i) => (
        <div key={i} className="cdb-panel-row">
          <select
            value={f.propId}
            onChange={(e) => {
              const next = [...filters];
              next[i] = { ...f, propId: e.target.value };
              onChange(next);
            }}
          >
            {props.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={f.op}
            onChange={(e) => {
              const next = [...filters];
              next[i] = { ...f, op: e.target.value as DbFilterOp };
              onChange(next);
            }}
          >
            {FILTER_OPS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {f.op !== "empty" && f.op !== "not_empty" && (
            <input
              value={f.value == null ? "" : String(f.value)}
              onChange={(e) => {
                const next = [...filters];
                next[i] = { ...f, value: e.target.value };
                onChange(next);
              }}
              placeholder="值"
            />
          )}
          <button
            type="button"
            className="cdb-panel-remove"
            onClick={() => onChange(filters.filter((_, j) => j !== i))}
            aria-label="移除"
          >
            ×
          </button>
        </div>
      ))}
      {filters.length > 0 && (
        <button type="button" className="btn btn-ghost" onClick={() => onChange([])}>
          清除全部
        </button>
      )}
    </div>
  );
}

function SortPanel({
  props,
  sorts,
  onChange,
}: {
  props: DbProperty[];
  sorts: DbSort[];
  onChange: (s: DbSort[]) => void;
}) {
  return (
    <div className="cdb-panel">
      <header>
        <strong>排序</strong>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            const first = props[0];
            if (!first) return;
            onChange([...sorts, { propId: first.id, dir: "asc" }]);
          }}
        >
          + 規則
        </button>
      </header>
      {sorts.length === 0 && <p className="cdb-panel-empty">尚未排序 — 預設依最近更新</p>}
      {sorts.map((s, i) => (
        <div key={i} className="cdb-panel-row">
          <select
            value={s.propId}
            onChange={(e) => {
              const next = [...sorts];
              next[i] = { ...s, propId: e.target.value };
              onChange(next);
            }}
          >
            {props.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={s.dir}
            onChange={(e) => {
              const next = [...sorts];
              next[i] = { ...s, dir: e.target.value as "asc" | "desc" };
              onChange(next);
            }}
          >
            <option value="asc">升冪</option>
            <option value="desc">降冪</option>
          </select>
          <button
            type="button"
            className="cdb-panel-remove"
            onClick={() => onChange(sorts.filter((_, j) => j !== i))}
            aria-label="移除"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function PropsPanel({
  props,
  visibleIds,
  onChange,
  onConfigureRollup,
}: {
  props: DbProperty[];
  visibleIds?: string[];
  onChange: (ids: string[] | undefined) => void;
  onConfigureRollup: (propId: string) => void;
}) {
  const active = visibleIds?.length ? new Set(visibleIds) : null;
  return (
    <div className="cdb-panel">
      <header>
        <strong>此視圖顯示的屬性</strong>
        <button type="button" className="btn btn-ghost" onClick={() => onChange(undefined)}>
          全部顯示
        </button>
      </header>
      <div className="cdb-prop-toggles">
        {props.map((p) => {
          const on = !active || active.has(p.id) || p.type === "title";
          return (
            <label key={p.id} className="cdb-prop-toggle">
              <input
                type="checkbox"
                checked={on}
                disabled={p.type === "title"}
                onChange={() => {
                  const base = active ? [...active] : props.map((x) => x.id);
                  const next = on ? base.filter((id) => id !== p.id) : [...base, p.id];
                  onChange(next);
                }}
              />
              <span>{p.name}</span>
              <em>{typeLabel(p.type)}</em>
              {p.type === "rollup" && (
                <button type="button" className="btn btn-ghost" onClick={() => onConfigureRollup(p.id)}>
                  設定
                </button>
              )}
            </label>
          );
        })}
      </div>
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
    rollup: "彙總",
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
  allRows,
  userId,
  databaseId,
  onOpen,
}: {
  row: Note;
  prop: DbProperty;
  allProps: DbProperty[];
  allRows: Note[];
  userId: string;
  databaseId: string;
  onOpen: () => void;
}) {
  const raw = getCellValue(row, prop);
  const [draft, setDraft] = useState(formatDraft(raw, prop));

  useEffect(() => {
    setDraft(formatDraft(raw, prop));
  }, [raw, prop]);

  if (prop.type === "title") {
    return (
      <button type="button" className="cdb-title-cell" onClick={onOpen} onDoubleClick={onOpen}>
        {row.title || "未命名"}
      </button>
    );
  }

  if (prop.type === "formula") {
    return <span className="cdb-readonly cdb-formula">{evalFormula(prop, row, allProps, allRows) || "—"}</span>;
  }

  if (prop.type === "rollup") {
    return <span className="cdb-readonly cdb-rollup">{evalRollup(prop, row, allProps, allRows) || "—"}</span>;
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
          ...opts.map((o) => ({ value: o.id, label: o.label, color: o.color })),
        ]}
        onChange={(v) => void setCellValue(row, prop, v || null)}
      />
    );
  }

  if (prop.type === "multi_select" || prop.type === "tags") {
    return (
      <ChipSelect
        prop={prop}
        values={(Array.isArray(raw) ? raw : []).map(String)}
        onChange={(vals) => void setCellValue(row, prop, vals)}
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
    return (
      <FilesCell
        row={row}
        prop={prop}
        files={(Array.isArray(raw) ? raw : []) as DbFileValue[]}
        userId={userId}
        databaseId={databaseId}
      />
    );
  }

  if (prop.type === "relation") {
    return (
      <RelationPicker
        selected={(Array.isArray(raw) ? raw : []).map(String)}
        candidates={allRows.filter((r) => r.id !== row.id)}
        onChange={(ids) => void setCellValue(row, prop, ids)}
        onOpen={onOpen}
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
        void setCellValue(row, prop, v);
      }}
      placeholder={prop.type === "person" ? "人名" : ""}
    />
  );
}

function ChipSelect({
  prop,
  values,
  onChange,
}: {
  prop: DbProperty;
  values: string[];
  onChange: (vals: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = prop.options || [];
  const isTags = prop.type === "tags";
  const [tagDraft, setTagDraft] = useState("");

  const labelOf = (id: string) => options.find((o) => o.id === id)?.label || id;

  const toggle = (id: string) => {
    if (values.includes(id)) onChange(values.filter((v) => v !== id));
    else onChange([...values, id]);
  };

  return (
    <div className="cdb-chips">
      <div className="cdb-chip-list">
        {values.map((v) => (
          <button key={v} type="button" className="cdb-chip" onClick={() => toggle(v)} title="點擊移除">
            {isTags ? `#${v}` : labelOf(v)}
          </button>
        ))}
        <button type="button" className="cdb-chip-add" onClick={() => setOpen((o) => !o)}>
          +
        </button>
      </div>
      {open && (
        <div className="cdb-chip-menu">
          {isTags ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const t = tagDraft.replace(/^#/, "").trim();
                if (t && !values.includes(t)) onChange([...values, t]);
                setTagDraft("");
                setOpen(false);
              }}
            >
              <input
                autoFocus
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                placeholder="新增標籤"
              />
            </form>
          ) : (
            options.map((o) => (
              <button
                key={o.id}
                type="button"
                className={values.includes(o.id) ? "is-on" : ""}
                onClick={() => toggle(o.id)}
              >
                {o.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function FilesCell({
  row,
  prop,
  files,
  userId,
  databaseId,
}: {
  row: Note;
  prop: DbProperty;
  files: DbFileValue[];
  userId: string;
  databaseId: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const safe = file.name.replace(/[^\w.\-()\u4e00-\u9fff]+/g, "_");
      const path = `users/${userId}/db/${databaseId}/${row.id}/${Date.now()}_${safe}`;
      const url = await uploadFile(path, file);
      await setCellValue(row, prop, [...files, { url, name: file.name }]);
      toast("已上傳檔案");
    } catch (e) {
      toast(e instanceof Error ? e.message : "上傳失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cdb-files-cell">
      {files.map((f) => (
        <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="cdb-file-chip">
          {f.name || "檔案"}
        </a>
      ))}
      <div className="cdb-files-actions">
        <button type="button" className="cdb-file-btn" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? "上傳中…" : "上傳"}
        </button>
        <input
          ref={inputRef}
          type="file"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

function RelationPicker({
  selected,
  candidates,
  onChange,
  onOpen,
}: {
  selected: string[];
  candidates: Note[];
  onChange: (ids: string[]) => void;
  onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return candidates
      .filter((c) => !qq || (c.title || "").toLowerCase().includes(qq) || c.id.includes(qq))
      .slice(0, 40);
  }, [candidates, q]);

  return (
    <div className="cdb-rel">
      <div className="cdb-chip-list">
        {selected.map((id) => (
          <button
            key={id}
            type="button"
            className="cdb-chip cdb-chip--rel"
            onClick={() => onChange(selected.filter((x) => x !== id))}
            title="點擊取消關聯"
          >
            {byId.get(id)?.title || id.slice(-6)}
          </button>
        ))}
        <button type="button" className="cdb-chip-add" onClick={() => setOpen((o) => !o)}>
          +
        </button>
      </div>
      {open && (
        <div className="cdb-rel-menu">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜尋列標題…"
          />
          {filtered.map((c) => {
            const on = selected.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                className={on ? "is-on" : ""}
                onClick={() => {
                  onChange(on ? selected.filter((x) => x !== c.id) : [...selected, c.id]);
                }}
              >
                {c.title || "未命名"}
              </button>
            );
          })}
          {!filtered.length && <p className="cdb-panel-empty">無符合列</p>}
          <button type="button" className="btn btn-ghost" onClick={onOpen}>
            開啟本列頁面
          </button>
        </div>
      )}
    </div>
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
  const cols = sp?.options?.length ? sp.options : [{ id: "_none", label: "未分類" }];
  const byCol = new Map<string, Note[]>();
  for (const c of cols) byCol.set(c.id, []);
  if (!byCol.has("_none")) byCol.set("_none", []);
  for (const row of rows) {
    const v = sp ? String(getCellValue(row, sp) || "") : "";
    const key = byCol.has(v) ? v : "_none";
    byCol.get(key)!.push(row);
  }

  const onDrop = async (colId: string, rowId: string) => {
    if (!sp || colId === "_none") return;
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
    await setCellValue(row, sp, colId);
  };

  return (
    <div className="cdb-board">
      {cols.map((c) => (
        <div
          key={c.id}
          className="cdb-board-col"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const id = e.dataTransfer.getData("text/plain");
            if (id) void onDrop(c.id, id);
          }}
        >
          <header>
            <strong>{c.label}</strong>
            <span>{byCol.get(c.id)?.length || 0}</span>
          </header>
          <div className="cdb-board-cards">
            {(byCol.get(c.id) || []).map((row) => (
              <button
                key={row.id}
                type="button"
                className="cdb-board-card"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", row.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => onOpen(row.id)}
              >
                <strong>{row.title || "未命名"}</strong>
                <span>{(row.body_md || "").replace(/[#>*`\[\]]/g, "").slice(0, 60) || "拖曳改狀態 · 點擊開啟"}</span>
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
              <button
                key={row.id}
                type="button"
                className="cdb-board-card"
                draggable
                onDragStart={(e) => e.dataTransfer.setData("text/plain", row.id)}
                onClick={() => onOpen(row.id)}
              >
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

function firstBodyImage(body?: string): string | undefined {
  if (!body) return undefined;
  const md = body.match(/!\[[^\]]*\]\((https?:[^)\s]+)\)/);
  if (md?.[1]) return md[1];
  const html = body.match(/<img[^>]+src=["'](https?:[^"']+)["']/i);
  return html?.[1];
}

function looksLikeImageUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) && /\.(png|jpe?g|gif|webp|svg|avif)(\?|$)/i.test(url);
}

function resolveGalleryCover(
  row: Note,
  props: DbProperty[],
  coverPropId?: string
): string | undefined {
  if (coverPropId) {
    const prop = props.find((p) => p.id === coverPropId);
    if (prop) {
      if (prop.type === "files") {
        const files = (getCellValue(row, prop) as DbFileValue[]) || [];
        const hit = files.find((f) => looksLikeImageUrl(f.url) || /\.(png|jpe?g|gif|webp|svg)/i.test(f.name || ""));
        if (hit?.url) return hit.url;
      } else {
        const raw = String(getCellValue(row, prop) || "").trim();
        if (raw && looksLikeImageUrl(raw)) return raw;
        if (raw && /^https?:\/\//i.test(raw)) return raw;
      }
    }
  }
  for (const prop of props) {
    if (prop.type !== "files") continue;
    const files = (getCellValue(row, prop) as DbFileValue[]) || [];
    const hit = files.find((f) => looksLikeImageUrl(f.url) || /\.(png|jpe?g|gif|webp|svg)/i.test(f.name || ""));
    if (hit?.url) return hit.url;
  }
  return firstBodyImage(row.body_md);
}

function defaultCardPropIds(props: DbProperty[], view?: DbView): string[] {
  if (view?.cardPropIds?.length) return view.cardPropIds.slice(0, 3);
  const prefer = new Set(["status", "select", "tags", "date", "datetime", "number"]);
  const skip = new Set(["title", "files", "formula", "rollup", "relation"]);
  const out: string[] = [];
  for (const p of props) {
    if (skip.has(p.type) || p.type === "title") continue;
    if (prefer.has(p.type) || p.type === "text" || p.type === "url") {
      out.push(p.id);
      if (out.length >= 3) break;
    }
  }
  return out;
}

function formatGalleryProp(row: Note, prop: DbProperty): string {
  const v = getCellValue(row, prop);
  if (v == null || v === "") return "";
  if (prop.type === "status" || prop.type === "select") {
    const opt = prop.options?.find((o) => o.id === v || o.label === v);
    return opt?.label || String(v);
  }
  if (prop.type === "tags" && Array.isArray(v)) {
    return v.map(String).slice(0, 3).join(" · ");
  }
  if (prop.type === "date" || prop.type === "datetime") {
    const d = typeof v === "string" || typeof v === "number" ? new Date(v) : null;
    if (d && !Number.isNaN(d.getTime())) return d.toLocaleDateString("zh-TW");
  }
  if (prop.type === "url") {
    try {
      return new URL(String(v)).hostname.replace(/^www\./, "");
    } catch {
      return "連結";
    }
  }
  if (prop.type === "files") return "";
  return String(v);
}

function GalleryView({
  rows,
  props,
  view,
  onOpen,
  onAdd,
}: {
  rows: Note[];
  props: DbProperty[];
  view: DbView;
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  const density = view.cardDensity || "comfy";
  const size = view.cardSize || (density === "compact" ? "s" : "m");
  const cardPropIds = defaultCardPropIds(props, view);
  const cardProps = cardPropIds
    .map((id) => props.find((p) => p.id === id))
    .filter(Boolean) as DbProperty[];

  if (!rows.length) {
    return (
      <div className="cdb-gallery-empty">
        <p>用畫廊瀏覽封面與狀態</p>
        <button type="button" className="btn" onClick={onAdd}>
          新增第一筆
        </button>
      </div>
    );
  }

  return (
    <div className={`cdb-gallery cdb-gallery--${size}`} data-density={density}>
      {rows.map((row) => {
        const cover = resolveGalleryCover(row, props, view.coverPropId);
        const title = row.title || "未命名";
        const initial = title.trim().charAt(0) || "·";
        const textProps = cardProps.filter((p) => p.type === "text");
        const subtitleProp = textProps[0];
        const subtitle = subtitleProp ? formatGalleryProp(row, subtitleProp) : "";
        const chipProps = cardProps.filter((p) => p.id !== subtitleProp?.id);
        return (
          <button
            key={row.id}
            type="button"
            className="cdb-gallery-card"
            onClick={() => onOpen(row.id)}
          >
            <div
              className={`cdb-gallery-cover${cover ? "" : " is-empty"}`}
              style={cover ? { backgroundImage: `url(${cover})` } : undefined}
              data-initial={cover ? undefined : initial}
            />
            <div className="cdb-gallery-meta">
              <strong>{title}</strong>
              {subtitle ? <span className="cdb-gallery-sub">{subtitle}</span> : null}
              {chipProps.length > 0 ? (
                <div className="cdb-gallery-chips">
                  {chipProps.map((p) => {
                    const label = formatGalleryProp(row, p);
                    if (!label) return null;
                    const opt =
                      p.type === "status" || p.type === "select"
                        ? p.options?.find((o) => o.id === getCellValue(row, p) || o.label === getCellValue(row, p))
                        : null;
                    return (
                      <span
                        key={p.id}
                        className="cdb-gallery-chip"
                        style={opt?.color ? { background: `${opt.color}22`, color: opt.color } : undefined}
                      >
                        {label}
                      </span>
                    );
                  })}
                </div>
              ) : null}
            </div>
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
      ![
        "title",
        "formula",
        "rollup",
        "unique_id",
        "created_time",
        "last_edited_time",
        "created_by",
        "last_edited_by",
        "files",
        "relation",
      ].includes(p.type)
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
