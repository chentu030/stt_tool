"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Note } from "@/lib/firebase";
import { uploadFile } from "@/lib/firebase";
import {
  evalFormula,
  evalRollup,
  getCellValue,
  type DbFileValue,
  type DbProperty,
} from "@/lib/database";
import MenuSelect from "@/components/MenuSelect";
import CadenceDateField from "@/components/CadenceDateField";
import { toast } from "@/lib/toast";

function formatDraft(raw: unknown, prop: DbProperty): string {
  if (raw == null) return "";
  if (prop.type === "number") return String(raw);
  if (Array.isArray(raw)) return raw.map(String).join(", ");
  return String(raw);
}

type Props = {
  note: Note;
  prop: DbProperty;
  value?: unknown;
  allProps?: DbProperty[];
  allRows?: Note[];
  userId?: string;
  databaseId?: string;
  readOnly?: boolean;
  onCommit: (value: unknown) => void;
};

/** Shared cell editor for database columns and workspace property catalog. */
export default function PropertyValueEditor({
  note,
  prop,
  value,
  allProps = [],
  allRows = [],
  userId = "",
  databaseId = "",
  readOnly,
  onCommit,
}: Props) {
  const raw = value !== undefined ? value : getCellValue(note, prop);
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
    if (prop.type === "select" || prop.type === "status") {
      const label = prop.options?.find((o) => o.id === String(raw || ""))?.label;
      return <span className={raw ? undefined : "ndb-empty"}>{label || (raw == null || raw === "" ? "空" : String(raw))}</span>;
    }
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
    return <MiniChips prop={prop} values={vals} onChange={onCommit} />;
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
  files,
  userId,
  databaseId,
  onCommit,
}: {
  files: DbFileValue[];
  userId: string;
  databaseId: string;
  onCommit: (value: unknown) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (list: FileList | null) => {
    if (!list?.length || !userId) return;
    setBusy(true);
    try {
      const next = [...files];
      for (const file of Array.from(list)) {
        const path = `users/${userId}/db/${databaseId || "ws"}/${Date.now()}_${file.name}`;
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
