/** Meeting pack → optional board cards + schedule reminders (opt-in). */

import { createNote } from "@/lib/firebase";
import { createBoard, lastBoardKey, listenBoards, type BoardConfig } from "@/lib/boardStore";
import { createScheduleEvent } from "@/lib/scheduleEvents";
import { askChoice, askConfirm } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import { openGlobalAiRail } from "@/lib/aiRailBridge";
import { packTranscriptForAi } from "@/lib/jobAiContext";
import { getMeetingAiContext } from "@/lib/meetingSession";

/** Checklist lines from meeting_pack markdown (`- [ ] …`). */
export function extractChecklistItems(pack: string): string[] {
  return (pack || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s*\[[ xX]?\]/.test(l))
    .map((l) => l.replace(/^[-*]\s*\[[ xX]?\]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

function resolveLastBoardId(uid: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(lastBoardKey(uid));
  } catch {
    return null;
  }
}

async function pickBoard(uid: string): Promise<BoardConfig | null> {
  const boards = await new Promise<BoardConfig[]>((resolve) => {
    const unsub = listenBoards(uid, (list) => {
      unsub();
      resolve(list);
    });
    setTimeout(() => {
      try {
        unsub();
      } catch {
        /* ignore */
      }
      resolve([]);
    }, 4000);
  });
  const last = resolveLastBoardId(uid);
  if (last) {
    const hit = boards.find((b) => b.id === last);
    if (hit) return hit;
  }
  if (boards[0]) return boards[0];
  const id = await createBoard(uid, "會議待辦");
  return {
    id,
    name: "會議待辦",
    folders: [],
    tags: ["會議待辦"],
    statuses: [],
    created_at: new Date(),
    updated_at: new Date(),
  };
}

export async function createBoardCardsFromActionItems(opts: {
  uid: string;
  items: string[];
  meetingNoteId: string;
  meetingTitle?: string;
  /** YYYY-MM-DD for optional ws_due / reminder */
  dueDate?: string;
}): Promise<{ created: number; boardId: string }> {
  const items = opts.items.map((t) => t.trim()).filter(Boolean).slice(0, 12);
  if (!items.length) return { created: 0, boardId: "" };

  const board = await pickBoard(opts.uid);
  if (!board) throw new Error("找不到看板");

  const seedTags =
    board.tags.length > 0 ? [...board.tags.slice(0, 1), "會議待辦"] : ["會議待辦"];
  const folder = board.folders[0] || "看板";
  let created = 0;
  for (const title of items) {
    await createNote(opts.uid, title.slice(0, 120), "", undefined, seedTags, {
      status: "backlog",
      folder,
      props: {
        ws_status: "backlog",
        ws_priority: "normal",
        source_meeting_note_id: opts.meetingNoteId,
        ...(opts.dueDate ? { ws_due: opts.dueDate.slice(0, 10) } : {}),
      },
    });
    created += 1;
  }
  try {
    localStorage.setItem(lastBoardKey(opts.uid), board.id);
  } catch {
    /* ignore */
  }
  return { created, boardId: board.id };
}

async function scheduleRemindersForItems(opts: {
  uid: string;
  items: string[];
  dateKey: string;
  meetingNoteId: string;
}): Promise<number> {
  const items = opts.items.slice(0, 8);
  if (!items.length || !opts.dateKey) return 0;
  let n = 0;
  // Stagger mid-morning slots so reminders don't collide.
  let startMin = 10 * 60;
  for (const title of items) {
    await createScheduleEvent(opts.uid, {
      dateKey: opts.dateKey,
      startMin,
      endMin: startMin + 30,
      allDay: false,
      title: title.slice(0, 80),
      noteId: opts.meetingNoteId,
      remindMinutesBefore: 30,
      provider: "local",
    });
    startMin += 30;
    n += 1;
  }
  return n;
}

/**
 * After a meeting pack lands, optionally create board cards / reminders.
 * Always confirm — never auto-write.
 */
export async function offerMeetingBoardExport(opts: {
  uid: string;
  pack: string;
  meetingNoteId: string;
  meetingTitle?: string;
  dateKey?: string;
}): Promise<void> {
  const items = extractChecklistItems(opts.pack);
  if (!items.length) return;

  const preview = items
    .slice(0, 5)
    .map((t, i) => `${i + 1}. ${t}`)
    .join("\n");
  const more = items.length > 5 ? `\n…共 ${items.length} 項` : "";

  const choice = await askChoice<"skip" | "cards" | "cards_remind">({
    title: "建立看板待辦？",
    message: `會後整理找到 ${items.length} 項待辦：\n${preview}${more}\n\n可選擇建立看板卡片（需確認才會寫入）。`,
    options: [
      { id: "cards", label: "建立看板卡片", primary: true },
      ...(opts.dateKey
        ? ([{ id: "cards_remind" as const, label: "卡片 + 截止提醒" }] as const)
        : []),
      { id: "skip", label: "只保留筆記" },
    ],
    cancelLabel: "略過",
  });

  if (!choice || choice.choice === "skip") return;

  try {
    const { created, boardId } = await createBoardCardsFromActionItems({
      uid: opts.uid,
      items,
      meetingNoteId: opts.meetingNoteId,
      meetingTitle: opts.meetingTitle,
      dueDate: opts.dateKey,
    });
    let remindCount = 0;
    if (choice.choice === "cards_remind" && opts.dateKey) {
      remindCount = await scheduleRemindersForItems({
        uid: opts.uid,
        items,
        dateKey: opts.dateKey,
        meetingNoteId: opts.meetingNoteId,
      });
    }
    if (created) {
      toast(
        remindCount
          ? `已建立 ${created} 張看板卡片，並排程 ${remindCount} 則提醒`
          : `已建立 ${created} 張看板卡片`
      );
    }
    if (boardId) {
      try {
        localStorage.setItem(lastBoardKey(opts.uid), boardId);
      } catch {
        /* ignore */
      }
    }

    const askAi = await askConfirm({
      title: "要帶會議脈絡開啟 AI 嗎？",
      message: "可接著用右側 AI 延續討論這場會議的重點與待辦。",
      confirmLabel: "開啟 AI",
      cancelLabel: "之後再說",
    });
    if (askAi) {
      const meetingCtx = getMeetingAiContext();
      const packed = packTranscriptForAi(
        meetingCtx?.noteId === opts.meetingNoteId ? meetingCtx.transcript || "" : ""
      );
      const title = opts.meetingTitle || meetingCtx?.title || "會議";
      openGlobalAiRail({
        prompt: "",
        contextLabel: `會議 · ${title}`,
        contextExtra: [
          packed.trim() ? `—— 會議脈絡 ——\n${packed.slice(0, 10000)}\n—— 結束 ——` : "",
          opts.pack?.trim()
            ? `—— 會後整理 ——\n${opts.pack.trim().slice(0, 8000)}\n—— 結束 ——`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      });
    }
  } catch (e) {
    toast(e instanceof Error ? e.message : "建立看板卡片失敗");
  }
}
