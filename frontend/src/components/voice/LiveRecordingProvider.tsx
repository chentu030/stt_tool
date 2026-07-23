"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import LiveNoteRecorder, {
  type LiveRecordMode,
  type LiveAudioSource,
} from "@/components/voice/LiveNoteRecorder";
import { appendNoteMarkdown } from "@/lib/firebase";
import { toast } from "@/lib/toast";
import { askChoice, askConfirm } from "@/lib/dialogs";
import {
  finishMeetingWithPack,
  getMeetingAiContext,
  setMeetingAiContext,
} from "@/lib/meetingSession";

export type LiveRecordingStart = {
  uid: string;
  noteId: string;
  mode?: LiveRecordMode;
  audioSource?: LiveAudioSource;
  autoStart?: boolean;
};

type LiveSession = {
  uid: string;
  noteId: string;
  mode: LiveRecordMode;
  audioSource: LiveAudioSource;
  autoStart: boolean;
};

type LiveRecordingCtx = {
  /** Panel/session open (may be idle, recording, or finishing). */
  open: boolean;
  noteId: string | null;
  mode: LiveRecordMode | null;
  /** True while MediaRecorder / stop pipeline is active. */
  active: boolean;
  startLive: (opts: LiveRecordingStart) => void;
  closeLive: () => void;
  /** Note page registers editor insert; returns unregister. */
  registerNoteInsert: (noteId: string, insert: (md: string) => void) => () => void;
};

const Ctx = createContext<LiveRecordingCtx | null>(null);

export function useLiveRecording(): LiveRecordingCtx {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error("useLiveRecording must be used within LiveRecordingProvider");
  }
  return v;
}

export function useLiveRecordingOptional(): LiveRecordingCtx | null {
  return useContext(Ctx);
}

export default function LiveRecordingProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<LiveSession | null>(null);
  const [sessionKey, setSessionKey] = useState(0);
  const [active, setActive] = useState(false);
  const sessionRef = useRef<LiveSession | null>(null);
  const insertRef = useRef<{ noteId: string; insert: (md: string) => void } | null>(null);
  const writeChain = useRef(Promise.resolve());
  sessionRef.current = session;

  const startLive = useCallback((opts: LiveRecordingStart) => {
    const prev = sessionRef.current;
    if (prev && prev.noteId !== opts.noteId) {
      toast("錄音進行中，請先結束目前這段再換筆記");
      return;
    }
    if (prev && prev.noteId === opts.noteId) {
      setSession({
        ...prev,
        mode: opts.mode || prev.mode,
        audioSource: opts.audioSource || prev.audioSource,
        autoStart: opts.autoStart ?? prev.autoStart,
      });
      return;
    }
    setSessionKey((k) => k + 1);
    setSession({
      uid: opts.uid,
      noteId: opts.noteId,
      mode: opts.mode || "organize",
      audioSource: opts.audioSource || "mic",
      autoStart: opts.autoStart !== false,
    });
  }, []);

  const closeLive = useCallback(() => {
    const noteId = sessionRef.current?.noteId;
    const uid = sessionRef.current?.uid;
    const meeting = getMeetingAiContext();
    setSession(null);
    setActive(false);
    if (noteId && meeting?.noteId === noteId && uid) {
      void (async () => {
        try {
          // Flush any off-page transcript appends before packing.
          await writeChain.current.catch(() => undefined);
          await new Promise((r) => setTimeout(r, 400));

          const ok = await askConfirm({
            title: "產生會後整理？",
            message: "會把摘要、決議與待辦寫入筆記的「會後整理」區塊（不覆蓋你寫的正文）。",
            confirmLabel: "產生整理",
            cancelLabel: "稍後",
          });
          if (!ok) {
            setMeetingAiContext(null);
            return;
          }

          let writeToJournal = false;
          if (meeting.event?.dateKey) {
            const choice = await askChoice<"journal" | "note_only">({
              title: "寫進今日日誌？",
              message: "會在當日日誌附加會議標題、時段與筆記連結。",
              options: [
                { id: "journal", label: "整理並寫進今天", primary: true },
                { id: "note_only", label: "只整理會議筆記" },
              ],
            });
            writeToJournal = choice?.choice === "journal";
          }

          toast("正在產生會後整理…");
          const { journalNoteId } = await finishMeetingWithPack({
            uid,
            noteId,
            title: meeting.title,
            event: meeting.event,
            writeToJournal,
          });
          toast(
            journalNoteId ? "會後整理已寫入，並附加到今日日誌" : "會後整理已寫入筆記"
          );
        } catch (e) {
          toast(e instanceof Error ? e.message : "會後整理失敗");
        } finally {
          setMeetingAiContext(null);
        }
      })();
    } else if (meeting?.noteId === noteId) {
      setMeetingAiContext(null);
    }
  }, []);

  const registerNoteInsert = useCallback((noteId: string, insert: (md: string) => void) => {
    insertRef.current = { noteId, insert };
    return () => {
      if (insertRef.current?.noteId === noteId) insertRef.current = null;
    };
  }, []);

  const insertMd = useCallback(
    (md: string) => {
      if (!md) return;
      const noteId = session?.noteId;
      if (!noteId) return;
      const local = insertRef.current;
      if (local && local.noteId === noteId) {
        local.insert(md);
        return;
      }
      writeChain.current = writeChain.current
        .then(() => appendNoteMarkdown(noteId, md))
        .catch((e) => {
          toast(e instanceof Error ? e.message : "無法寫入錄音內容到筆記");
        });
    },
    [session?.noteId]
  );

  const value = useMemo<LiveRecordingCtx>(
    () => ({
      open: !!session,
      noteId: session?.noteId ?? null,
      mode: session?.mode ?? null,
      active,
      startLive,
      closeLive,
      registerNoteInsert,
    }),
    [session, active, startLive, closeLive, registerNoteInsert]
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {session ? (
        <LiveNoteRecorder
          key={sessionKey}
          uid={session.uid}
          noteId={session.noteId}
          open
          mode={session.mode}
          audioSource={session.audioSource}
          autoStart={session.autoStart}
          noteHref={`/notes/${session.noteId}`}
          onLiveChange={setActive}
          onClose={closeLive}
          insertMd={insertMd}
        />
      ) : null}
    </Ctx.Provider>
  );
}
