import { aiFetch } from "@/lib/aiFetch";
/**
 * Meeting session façade: bind schedule event ↔ note, live capture, post-meeting AI pack.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { db, createNote, getNote, updateNote, appendNoteMarkdown } from "@/lib/firebase";
import {
  extractConferenceUrl,
  openConferenceWindow,
  updateScheduleEvent,
  type ScheduleEvent,
} from "@/lib/scheduleEvents";

export const MEETING_AI_MARKER_START = "<!-- cadence-meeting-ai:start -->";
export const MEETING_AI_MARKER_END = "<!-- cadence-meeting-ai:end -->";
export const MEETING_TX_MARKER_START = "<!-- cadence-meeting-tx:start -->";
export const MEETING_TX_MARKER_END = "<!-- cadence-meeting-tx:end -->";
export const MEETING_TRANSCRIPT_HEADING = "## 逐字稿來源";

const SESSION_STORAGE_KEY = "cadence_meeting_session_v1";

export type MeetingAiContext = {
  sessionId: string;
  eventId?: string;
  noteId: string;
  title: string;
  transcript: string;
  dateKey?: string;
  /** Snapshot for journal rollup after pack */
  event?: ScheduleEvent;
  uid?: string;
};

type Listener = (ctx: MeetingAiContext | null) => void;

let current: MeetingAiContext | null = null;
const listeners = new Set<Listener>();

function persistSession(ctx: MeetingAiContext | null) {
  try {
    if (typeof sessionStorage === "undefined") return;
    if (!ctx) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        sessionId: ctx.sessionId,
        eventId: ctx.eventId,
        noteId: ctx.noteId,
        title: ctx.title,
        transcript: (ctx.transcript || "").slice(-12000),
        dateKey: ctx.dateKey,
        event: ctx.event || null,
        uid: ctx.uid || null,
      })
    );
  } catch {
    /* ignore quota */
  }
}

export function rehydrateMeetingAiContext(noteId?: string): MeetingAiContext | null {
  if (current && (!noteId || current.noteId === noteId)) return current;
  try {
    if (typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MeetingAiContext;
    if (!parsed?.noteId) return null;
    if (noteId && parsed.noteId !== noteId) return null;
    current = {
      ...parsed,
      transcript: parsed.transcript || "",
      event: parsed.event || undefined,
      uid: parsed.uid || undefined,
    };
    listeners.forEach((cb) => cb(current));
    return current;
  } catch {
    return null;
  }
}

export function setMeetingAiContext(ctx: MeetingAiContext | null) {
  current = ctx;
  persistSession(ctx);
  listeners.forEach((cb) => cb(current));
}

export function getMeetingAiContext() {
  return current;
}

export function patchMeetingAiContext(patch: Partial<MeetingAiContext>) {
  if (!current) return;
  current = { ...current, ...patch };
  persistSession(current);
  listeners.forEach((cb) => cb(current));
}

/** Append a live STT chunk into in-memory transcript (for dock / pack). */
export function appendMeetingTranscriptChunk(chunk: string) {
  const t = chunk.trim();
  if (!t || !current) return;
  const next = `${current.transcript ? `${current.transcript}\n\n` : ""}${t}`.slice(-20000);
  patchMeetingAiContext({ transcript: next });
}

export function subscribeMeetingAiContext(cb: Listener): () => void {
  listeners.add(cb);
  if (!current) rehydrateMeetingAiContext();
  cb(current);
  return () => {
    listeners.delete(cb);
  };
}

export const MEETING_AI_SUGGESTIONS = [
  { label: "目前摘要", prompt: "用繁體中文摘要目前這場會議討論到哪裡（條列，簡短）。" },
  { label: "決議是什麼", prompt: "這場會議目前有哪些決議？若尚無明確決議請標明「未決」。" },
  { label: "待辦清單", prompt: "從會議內容抽出待辦（- [ ]），有負責人就寫上。" },
  { label: "會後跟進", prompt: "列出會後應跟進的事項與建議下一步。" },
];

function meetingNoteBody(ev: ScheduleEvent) {
  const join = ev.conferenceUrl ? `\n- 會議連結：${ev.conferenceUrl}\n` : "\n";
  const desc = (ev.description || "").trim();
  const brief = desc
    ? `\n> 來自行程說明\n>\n${desc
        .split("\n")
        .slice(0, 12)
        .map((l) => `> ${l}`)
        .join("\n")}\n`
    : "";
  return `# ${ev.title}

- 日期：${ev.dateKey}
- 時段：${ev.allDay ? "全天" : `${formatRange(ev.startMin, ev.endMin)}`}
${join}
## 會前準備
${brief}
- 議程：
  - 
- 我想確認／帶去討論：
  - 
- 相關筆記／待辦：


## 筆記

（開會時在這裡寫你的重點子彈，AI 不會覆蓋此區）

${MEETING_TX_MARKER_START}
${MEETING_TRANSCRIPT_HEADING}

:::toggle 逐字稿來源（可摺疊）
（即時轉錄會寫在這裡）
:::
${MEETING_TX_MARKER_END}

${MEETING_AI_MARKER_START}
## 會後整理

### 摘要

### 決議

### 待辦

- [ ] 

### 未決／跟進

${MEETING_AI_MARKER_END}
`;
}

export function formatMeetingRange(startMin: number, endMin: number) {
  return formatRange(startMin, endMin);
}

function formatRange(startMin: number, endMin: number) {
  const fmt = (m: number) => {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  };
  return `${fmt(startMin)}–${fmt(endMin)}`;
}

function linkDocId(provider: string, externalId: string) {
  return `${provider}_${externalId}`.replace(/[^\w.-]+/g, "_").slice(0, 700);
}

async function readExternalNoteLink(
  uid: string,
  provider: string,
  externalId: string
): Promise<string | null> {
  const snap = await getDoc(doc(db, "users", uid, "meeting_links", linkDocId(provider, externalId)));
  if (!snap.exists()) return null;
  const noteId = String(snap.data()?.noteId || "");
  return noteId || null;
}

async function writeExternalNoteLink(
  uid: string,
  provider: string,
  externalId: string,
  noteId: string,
  meta?: { title?: string; dateKey?: string }
) {
  await setDoc(
    doc(db, "users", uid, "meeting_links", linkDocId(provider, externalId)),
    {
      noteId,
      provider,
      externalId,
      title: meta?.title || "",
      dateKey: meta?.dateKey || "",
      updated_at: serverTimestamp(),
    },
    { merge: true }
  );
}

/** Ensure a meeting note exists and is linked on the schedule event. */
export async function ensureMeetingNote(
  uid: string,
  ev: ScheduleEvent
): Promise<{ noteId: string; created: boolean }> {
  if (ev.noteId) {
    const existing = await getNote(ev.noteId);
    if (existing) return { noteId: ev.noteId, created: false };
  }

  if (ev.provider !== "local" && ev.externalId) {
    const linked = await readExternalNoteLink(uid, ev.provider, ev.externalId);
    if (linked) {
      const existing = await getNote(linked);
      if (existing) return { noteId: linked, created: false };
    }
  }

  const noteId = await createNote(
    uid,
    ev.title || "會議",
    meetingNoteBody(ev),
    undefined,
    ["會議"],
    {
      folder: "會議",
      // Keep date for rollup lookup, but not as a journal entry (see isJournalNote).
      journal_date: "",
      status: "doing",
      props: {
        meeting_date: ev.dateKey,
        schedule_event_id: ev.id,
        schedule_provider: ev.provider,
        schedule_external_id: ev.externalId || "",
      },
    }
  );
  if (ev.provider === "local") {
    try {
      await updateScheduleEvent(uid, ev.id, { noteId });
    } catch {
      /* note exists; link can be retried */
    }
  } else if (ev.externalId) {
    await writeExternalNoteLink(uid, ev.provider, ev.externalId, noteId, {
      title: ev.title,
      dateKey: ev.dateKey,
    });
  }
  return { noteId, created: true };
}

export function upsertMeetingAiSection(bodyMd: string, packMd: string): string {
  const pack = packMd.trim();
  const block = `${MEETING_AI_MARKER_START}\n## 會後整理\n\n${pack}\n${MEETING_AI_MARKER_END}`;
  if (bodyMd.includes(MEETING_AI_MARKER_START) && bodyMd.includes(MEETING_AI_MARKER_END)) {
    return bodyMd.replace(
      new RegExp(
        `${escapeRe(MEETING_AI_MARKER_START)}[\\s\\S]*?${escapeRe(MEETING_AI_MARKER_END)}`,
        "m"
      ),
      block
    );
  }
  return `${bodyMd.trim()}\n\n${block}\n`;
}

/** Append STT text into the collapsible transcript source section. */
export function appendMeetingTranscriptSection(bodyMd: string, chunk: string): string {
  const t = chunk.trim();
  if (!t) return bodyMd;
  const stamp = new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
  const piece = `${stamp}\n${t}`;
  if (bodyMd.includes(MEETING_TX_MARKER_START) && bodyMd.includes(MEETING_TX_MARKER_END)) {
    return bodyMd.replace(MEETING_TX_MARKER_END, `\n\n${piece}\n${MEETING_TX_MARKER_END}`);
  }
  const block = `${MEETING_TX_MARKER_START}\n${MEETING_TRANSCRIPT_HEADING}\n\n:::toggle 逐字稿來源（可摺疊）\n${piece}\n:::\n${MEETING_TX_MARKER_END}`;
  return `${bodyMd.trim()}\n\n${block}\n`;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function runMeetingPackOnNote(noteId: string, title: string): Promise<string> {
  const note = await getNote(noteId);
  if (!note) throw new Error("找不到會議筆記");
  const ctx = getMeetingAiContext();
  const liveTx = ctx?.noteId === noteId ? ctx.transcript : "";
  const bodyForAi = liveTx.trim()
    ? `${note.body_md || ""}\n\n—— 即時逐字稿緩衝 ——\n${liveTx}`
    : note.body_md || "";
  const res = await aiFetch("/api/ai/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "meeting_pack",
      title,
      body: bodyForAi,
      prompt:
        "請產出會議整理包，必須用以下 Markdown 標題（缺則寫「無」）：\n## 摘要\n## 決議\n## 待辦\n（待辦必須用 - [ ] checklist）\n## 未決／跟進",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "會後整理失敗");
  const text = String(data.text || "").trim();
  if (!text) throw new Error("AI 未回傳內容");
  const next = upsertMeetingAiSection(note.body_md || "", text);
  await updateNote(noteId, { body_md: next });
  return text;
}

export async function runMeetingAiAction(
  noteId: string,
  title: string,
  prompt: string
): Promise<string> {
  const note = await getNote(noteId);
  if (!note) throw new Error("找不到會議筆記");
  const res = await aiFetch("/api/ai/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "note",
      title,
      body: note.body_md || "",
      prompt,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "AI 失敗");
  return String(data.text || "").trim();
}

/** Find primary journal note for a date (excludes 會議 folder). */
export async function findJournalNoteIdForDate(
  uid: string,
  dateKey: string
): Promise<string | null> {
  const q = query(
    collection(db, "notes"),
    where("user_id", "==", uid),
    where("journal_date", "==", dateKey),
    limit(30)
  );
  const snap = await getDocs(q);
  const rows = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as { folder?: string; tags?: string[] }) }))
    .filter((n) => n.folder !== "會議" && !(n.tags || []).includes("會議"));
  return rows[0]?.id || null;
}

export async function ensureJournalNoteForDate(uid: string, dateKey: string): Promise<string> {
  const existing = await findJournalNoteIdForDate(uid, dateKey);
  if (existing) return existing;
  return createNote(uid, dateKey, `# ${dateKey}\n\n`, undefined, ["journal"], {
    folder: "日誌",
    journal_date: dateKey,
  });
}

export async function appendJournalDayRollup(
  journalNoteId: string,
  ev: ScheduleEvent,
  meetingNoteId: string,
  blurb?: string,
  todosMd?: string
) {
  const blurbLine = blurb ? `\n- 摘要：${blurb.replace(/\s+/g, " ").slice(0, 160)}\n` : "\n";
  const todoBlock = todosMd?.trim()
    ? `\n#### 待辦\n${todosMd.trim()}\n`
    : "";
  const line = `\n\n### 會議 · ${ev.title}\n- 時段：${ev.allDay ? "全天" : formatRange(ev.startMin, ev.endMin)}\n- 筆記：[/notes/${meetingNoteId}](/notes/${meetingNoteId})${blurbLine}${todoBlock}`;
  await appendNoteMarkdown(journalNoteId, line);
}

function extractChecklist(pack: string): string {
  const lines = pack.split("\n").filter((l) => /^\s*[-*]\s*\[[ xX]\]/.test(l));
  return lines.slice(0, 12).join("\n");
}

async function scheduleEventFromMeetingNote(noteId: string): Promise<ScheduleEvent | null> {
  const note = await getNote(noteId);
  if (!note) return null;
  const props = (note.props || {}) as Record<string, unknown>;
  const dateKey = String(props.meeting_date || note.journal_date || "").trim();
  if (!dateKey) return null;
  const providerRaw = String(props.schedule_provider || "local");
  const provider = providerRaw === "google" ? "google" : "local";
  return {
    id: String(props.schedule_event_id || noteId),
    dateKey,
    startMin: 0,
    endMin: 60,
    allDay: true,
    title: note.title || "會議",
    provider,
    externalId: String(props.schedule_external_id || "") || undefined,
    noteId,
  };
}

/** Pack + optional rollup into that day's journal. */
export async function finishMeetingWithPack(opts: {
  uid: string;
  noteId: string;
  title: string;
  event?: ScheduleEvent | null;
  writeToJournal?: boolean;
}): Promise<{ pack: string; journalNoteId?: string }> {
  const pack = await runMeetingPackOnNote(opts.noteId, opts.title);
  let event = opts.event || undefined;
  if (!event?.dateKey) {
    event = (await scheduleEventFromMeetingNote(opts.noteId)) || undefined;
  }
  let journalNoteId: string | undefined;
  if (opts.writeToJournal && event?.dateKey) {
    journalNoteId = await ensureJournalNoteForDate(opts.uid, event.dateKey);
    const blurb =
      pack
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l && !l.startsWith("#") && l !== "無") || "";
    await appendJournalDayRollup(
      journalNoteId,
      event,
      opts.noteId,
      blurb,
      extractChecklist(pack)
    );
  }
  return { pack, journalNoteId };
}

export function conferenceUrlOf(ev: ScheduleEvent): string | undefined {
  return ev.conferenceUrl || extractConferenceUrl(ev.title);
}

export function joinMeeting(ev: ScheduleEvent) {
  const url = conferenceUrlOf(ev);
  if (!url) throw new Error("此行程沒有會議連結");
  if (!/^https:\/\//i.test(url)) throw new Error("會議連結必須是 https://");
  openConferenceWindow(url);
  return url;
}
