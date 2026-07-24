"use client";

import Link from "next/link";
import MenuSelect, { NOTE_STATUS_OPTIONS } from "@/components/MenuSelect";
import { NotePropsFieldRow } from "@/components/notes/NotePropsFields";
import EditorWritingStats from "@/components/notes/EditorWritingStats";
import type { NoteStats } from "@/lib/noteMeta";
import type { WritingGoalProgress } from "@/lib/writingGoals";
import type { Note } from "@/lib/firebase";
import { getWorkspaceFieldValue, WS_STATUS_ID } from "@/lib/workspaceProperties";

export type NoteMetaPropFieldsProps = {
  note: Note;
  userId?: string;
  readOnly?: boolean;
  folder: string;
  onFolderChange: (v: string) => void;
  tags: string[];
  tagInput: string;
  onTagInputChange: (v: string) => void;
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
  /** Board / note.status — dual-write ws_status upstream when wiring. */
  onStatusChange: (status: Note["status"]) => void;
  stats: NoteStats;
  goalProgress?: WritingGoalProgress | null;
};

/** Folder / tags / status / word-count rows shared by note & DB property panels. */
export default function NoteMetaPropFields({
  note,
  readOnly,
  folder,
  onFolderChange,
  tags,
  tagInput,
  onTagInputChange,
  onAddTag,
  onRemoveTag,
  onStatusChange,
  stats,
  goalProgress,
}: NoteMetaPropFieldsProps) {
  const wsStatus = getWorkspaceFieldValue(note, WS_STATUS_ID);
  let statusValue: "" | "backlog" | "doing" | "done" = "";
  if (wsStatus === "") {
    statusValue = "";
  } else if (note.status === "doing" || note.status === "done" || note.status === "backlog") {
    statusValue = note.status;
  } else if (wsStatus === "doing" || wsStatus === "done" || wsStatus === "backlog") {
    statusValue = wsStatus;
  } else if (note.status === "") {
    statusValue = "";
  } else {
    statusValue = "backlog";
  }

  return (
    <>
      <NotePropsFieldRow label="資料夾" icon="folder">
        {readOnly ? (
          <span className={folder ? undefined : "ndb-empty"}>{folder || "空"}</span>
        ) : (
          <input
            className="nk-meta-input"
            type="text"
            value={folder}
            placeholder="資料夾"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => onFolderChange(e.target.value)}
          />
        )}
      </NotePropsFieldRow>

      <NotePropsFieldRow label="標籤" icon="sell">
        <div className="nk-meta-tags">
          {tags.map((t) => (
            <span key={t} className="badge doc-tag-chip">
              #{t}
              {!readOnly ? (
                <button
                  type="button"
                  className="doc-tag-remove"
                  aria-label={`移除標籤 ${t}`}
                  title="移除標籤"
                  onClick={() => onRemoveTag(t)}
                >
                  ×
                </button>
              ) : null}
            </span>
          ))}
          {!readOnly ? (
            <input
              className="nk-meta-input nk-meta-input--tag"
              type="text"
              value={tagInput}
              placeholder="加標籤…"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => onTagInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onAddTag();
                }
              }}
            />
          ) : tags.length === 0 ? (
            <span className="ndb-empty">空</span>
          ) : null}
        </div>
      </NotePropsFieldRow>

      <NotePropsFieldRow label="狀態" icon="flag">
        {readOnly ? (
          <span className={statusValue ? undefined : "ndb-empty"}>
            {statusValue === "doing"
              ? "進行中"
              : statusValue === "done"
                ? "完成"
                : statusValue === "backlog"
                  ? "待辦"
                  : "空"}
          </span>
        ) : (
          <MenuSelect
            variant="ghost"
            size="sm"
            ariaLabel="筆記狀態"
            value={statusValue}
            options={[{ value: "" as const, label: "空" }, ...NOTE_STATUS_OPTIONS]}
            onChange={(v) => {
              onStatusChange((v || "") as Note["status"]);
            }}
          />
        )}
      </NotePropsFieldRow>

      <NotePropsFieldRow label="字數" icon="numbers" system>
        <EditorWritingStats stats={stats} goalProgress={goalProgress} />
      </NotePropsFieldRow>

      {note.source_job_id ? (
        <NotePropsFieldRow label="來源" icon="link" system>
          <Link href={`/job/${note.source_job_id}`} className="nk-meta-source-link">
            來源逐字稿
          </Link>
        </NotePropsFieldRow>
      ) : null}
    </>
  );
}

export type NoteMetaHandlers = Omit<NoteMetaPropFieldsProps, "note" | "readOnly" | "userId">;
