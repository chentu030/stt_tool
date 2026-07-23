"use client";

import { useState } from "react";
import {
  finishMeetingWithPack,
  getMeetingAiContext,
  runMeetingAiAction,
  setMeetingAiContext,
  upsertMeetingAiSection,
  type MeetingAiContext,
} from "@/lib/meetingSession";
import { getNote, updateNote } from "@/lib/firebase";
import { toast } from "@/lib/toast";
import { askConfirm } from "@/lib/dialogs";

type Props = {
  noteId: string;
  noteTitle: string;
  uid: string;
  /** True when note is a meeting folder note or has active meeting context */
  active?: boolean;
  meetingCtx?: MeetingAiContext | null;
  onBodyPatched?: () => void;
};

export default function MeetingNoteBar({
  noteId,
  noteTitle,
  uid,
  active,
  meetingCtx,
  onBodyPatched,
}: Props) {
  const [busy, setBusy] = useState(false);
  const ctx = meetingCtx ?? getMeetingAiContext();
  const show = active || ctx?.noteId === noteId;
  if (!show) return null;

  const run = async (kind: "summary" | "actions" | "pack" | "journal") => {
    if (busy) return;
    setBusy(true);
    try {
      if (kind === "pack" || kind === "journal") {
        const writeToJournal =
          kind === "journal" ||
          (await askConfirm({
            title: "寫進今日日誌？",
            message: "整理後附加到當日日誌。",
            confirmLabel: "整理並寫進今天",
            cancelLabel: "只整理筆記",
          }));
        toast("正在產生會後整理…");
        const { journalNoteId } = await finishMeetingWithPack({
          uid,
          noteId,
          title: noteTitle || ctx?.title || "會議",
          event: ctx?.event,
          writeToJournal: Boolean(writeToJournal && ctx?.event?.dateKey),
        });
        toast(journalNoteId ? "已整理並寫進今天" : "會後整理已寫入");
        onBodyPatched?.();
        return;
      }
      const prompt =
        kind === "summary"
          ? "用繁體中文摘要目前這場會議（條列，簡短）。只輸出摘要。"
          : "從會議內容抽出待辦（- [ ]）。只輸出清單。";
      const text = await runMeetingAiAction(noteId, noteTitle || "會議", prompt);
      if (!text) throw new Error("AI 未回傳內容");
      const note = await getNote(noteId);
      if (!note) throw new Error("找不到筆記");
      const labeled =
        kind === "summary" ? `### 目前摘要\n\n${text}` : `### 待辦\n\n${text}`;
      const next = upsertMeetingAiSection(note.body_md || "", labeled);
      await updateNote(noteId, { body_md: next });
      toast(kind === "summary" ? "已更新摘要" : "已更新待辦");
      onBodyPatched?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : "操作失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="meeting-note-bar">
      <span className="meeting-note-bar-label">會議</span>
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void run("summary")}>
        目前摘要
      </button>
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void run("actions")}>
        待辦
      </button>
      <button type="button" className="btn btn-soft btn-sm" disabled={busy} onClick={() => void run("pack")}>
        會後整理
      </button>
      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void run("journal")}>
        寫進今天
      </button>
      {ctx?.noteId === noteId && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={() => setMeetingAiContext(null)}
          title="結束會議模式提示"
        >
          結束
        </button>
      )}
    </div>
  );
}
