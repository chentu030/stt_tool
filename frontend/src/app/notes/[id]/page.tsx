"use client";
import { aiFetch } from "@/lib/aiFetch";

import PageLoading from "@/components/motion/PageLoading";

import { askPrompt, askConfirm, askChoice } from "@/lib/dialogs";
import { toast } from "@/lib/toast";
import {
  resolveMediaIngestChoice,
  formatIngestBlock,
  loadPendingIngests,
  removePendingIngest,
  replaceIngestMarker,
  startTranscriptionJob,
  summarizeTranscript,
  upsertPendingIngest,
  watchJob,
  loadJobPlainTranscript,
  finalizePendingIngest,
  type TranscribableMedia,
  type MediaIngestChoice,
  type PendingIngest,
} from "@/lib/noteMediaIngest";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import {
  getNote,
  updateNote,
  maybePushNoteVersion,
  listNoteVersions,
  createNote,
  deleteNote,
  listenToNote,
  Note,
  NoteVersion,
} from "@/lib/firebase";
import { useNotesList } from "@/components/notes/NotesListProvider";
import {
  loadPendingNoteDraft,
  saveNoteWithSync,
} from "@/lib/offlineSync";
import { takeNoteBodySeed } from "@/lib/jobToNote";
import NoteAppSurface from "@/components/workspace/NoteAppSurface";
import RichNoteEditor from "@/components/RichNoteEditor";
import MeetingNoteBar from "@/components/notes/MeetingNoteBar";
import ShareDialog from "@/components/ShareDialog";
import {
  subscribeMeetingAiContext,
  rehydrateMeetingAiContext,
  type MeetingAiContext,
} from "@/lib/meetingSession";
import MenuSelect, { NOTE_STATUS_OPTIONS } from "@/components/MenuSelect";
import { parseNoteShare, type NoteShare } from "@/lib/share";
import { getNoteAclRole, listenNoteAcl, type NoteAclRole } from "@/lib/noteAcl";
import { useNoteCollab } from "@/hooks/useNoteCollab";
import NoteAside from "@/components/notes/NoteAside";
import type { NoteAsideTab } from "@/components/notes/NoteAside";
import {
  LIVE_SEGMENTS_PROP,
  liveSegmentsFromProps,
  migrateInterleavedTranscriptFromBody,
} from "@/lib/liveSegments";
import { openGlobalAiRail } from "@/components/shell/GlobalAiDock";
import {
  NOTE_AI_EDIT_EVENT,
  applyNoteAiEditToBody,
  clearNoteLiveDraft,
  publishNoteLiveDraft,
  type NoteAiEditEventDetail,
} from "@/lib/noteAiEdit";
import NoteSplitPane from "@/components/notes/NoteSplitPane";
import NoteSplitResizer, { useNoteSplitLayout } from "@/components/notes/NoteSplitResizer";
import { useNoteTabsOptional } from "@/components/notes/NoteTabsProvider";
import {
  downloadDocx,
  downloadMarkdown,
  downloadPdfViaPrint,
  downloadPptOutline,
} from "@/lib/exportNote";
import SlideStudio, { SlideStudioActions } from "@/components/slides/SlideStudio";
import {
  SlideDeck,
  deckFromMarkdown,
  isDeckStale,
  loadDeckLocal,
  normalizeDeck,
  saveDeckLocal,
  splitMarkdownSections,
} from "@/lib/slideDeck";
import { extractTagsFromText, extractWikiLinks, findBacklinks, findNoteByTitle } from "@/lib/wiki";
import { buildResearchUrl, takeResearchInsert } from "@/lib/researchBridge";
import {
  NOTE_AI_ACTIONS,
  NoteAiActionId,
  HeadingItem,
  computeNoteStats,
  extractOutline,
  findRelatedNotes,
} from "@/lib/noteMeta";
import { buildNoteAiContext } from "@/lib/noteAiContext";
import { findCadenceAiAction } from "@/lib/cadenceAiActions";
import { usePrefsOptional } from "@/components/PrefsProvider";
import { toggleFavoriteId, touchRecentId } from "@/lib/userPrefs";
import { NOTE_TEMPLATES } from "@/lib/templates";
import { allNoteTemplates } from "@/lib/community/templateBridge";
import { useCommunityOptional } from "@/components/community/CommunityProvider";
import { splitFolderPath } from "@/lib/noteTree";
import { FocusModeProvider, useFocusMode } from "@/components/notes/FocusModeProvider";
import NotePresence from "@/components/notes/NotePresence";
import NoteHuddle from "@/components/notes/NoteHuddle";
import {
  liveModeLabel,
  type LiveAudioSource,
  type LiveRecordMode,
} from "@/components/voice/LiveNoteRecorder";
import { useLiveRecording } from "@/components/voice/LiveRecordingProvider";
import { liveAudioSourceHint, liveAudioSourceLabel } from "@/lib/voiceSession";
import NotePageLog from "@/components/notes/NotePageLog";
import NoteDbPropertiesPanel from "@/components/notes/NoteDbPropertiesPanel";
import BlockThreadPanel from "@/components/notes/BlockThreadPanel";
import IconColorPicker from "@/components/IconColorPicker";
import ColorSwatchUtility from "@/components/ColorSwatchUtility";
import PageChromeIcon from "@/components/PageChromeIcon";
import { fireConfetti } from "@/lib/confetti";
import { normalizePageColor, normalizePageIcon, pageColorMeta } from "@/lib/pageChrome";
import { isFullScreenAppLink, isNoteAppSurface, noteOpenHref } from "@/lib/workspacePages";

function countTaskCheckboxes(md: string): { total: number; checked: number } {
  const unchecked = md.match(/^\s*[-*]\s\[ \]/gim)?.length || 0;
  const checked = md.match(/^\s*[-*]\s\[[xX]\]/gim)?.length || 0;
  return { total: unchecked + checked, checked };
}

export default function NotePage() {
  return (
    <FocusModeProvider>
      <NotePageInner />
    </FocusModeProvider>
  );
}

function NotePageInner() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabs = useNoteTabsOptional();
  // When NoteTabsProvider is present, its splitId is source of truth (including null).
  // Do not fall back to ?split= — history.replaceState sync won't update useSearchParams,
  // so `|| searchParams` would revive a closed split and make the × button look dead.
  const splitId = tabs ? tabs.splitId : searchParams.get("split") || null;
  const [splitLayout, setSplitLayout] = useNoteSplitLayout();
  const { user, loading, displayName, photoURL } = useAuth();
  const prefsCtx = usePrefsOptional();
  const community = useCommunityOptional();
  const noteTemplates = useMemo(
    () => allNoteTemplates(community?.enabledTemplates),
    [community?.enabledTemplates]
  );
  const [note, setNote] = useState<Note | null>(null);
  const { notes: allNotes } = useNotesList();
  const [meetingCtx, setMeetingCtxState] = useState<MeetingAiContext | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [folder, setFolder] = useState("");
  const [icon, setIcon] = useState("");
  const [color, setColor] = useState("");
  const [cover, setCover] = useState("");
  const [parentId, setParentId] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<"idle" | "dirty" | "saving" | "saved" | "error" | "offline">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [morePos, setMorePos] = useState<{ top: number; left: number; minWidth: number } | null>(
    null
  );
  const moreWrapRef = useRef<HTMLDivElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const exportWrapRef = useRef<HTMLDivElement | null>(null);
  const [viewMode, setViewMode] = useState<"write" | "read" | "slides">("write");
  const [deck, setDeck] = useState<SlideDeck | null>(null);
  const [slideActions, setSlideActions] = useState<SlideStudioActions | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [slideFocusIndex, setSlideFocusIndex] = useState<number | null>(null);
  const [slideFocusNonce, setSlideFocusNonce] = useState(0);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<NoteVersion[]>([]);
  const [ribbonHost, setRibbonHost] = useState<HTMLDivElement | null>(null);
  const [asideOpen, setAsideOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      const saved = localStorage.getItem("cadence_note_aside_open");
      if (saved === "0") return false;
      if (saved === "1") return true;
    } catch {
      /* ignore */
    }
    return true;
  });
  const [asideTab, setAsideTab] = useState<NoteAsideTab>("outline");
  const asideManualRef = useRef(false);
  const migratedSegmentsRef = useRef<string | null>(null);
  const [liveRecordingHere, setLiveRecordingHere] = useState(false);
  const [asideWidth, setAsideWidth] = useState(() => {
    if (typeof window === "undefined") return 300;
    try {
      const n = Number(localStorage.getItem("cadence_note_aside_w"));
      if (Number.isFinite(n) && n >= 220 && n <= 560) return n;
    } catch {
      /* ignore */
    }
    return 300;
  });
  const [focusMode, setFocusMode] = useState(false);
  /** App surfaces (extension / specialty): fill content area below chrome */
  const [appFill, setAppFill] = useState(true);
  const [threadSelection, setThreadSelection] = useState<string | null>(null);
  const teamFocus = useFocusMode();
  const allCheckedRef = useRef(false);
  const [pageMode, setPageMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("cadence_page_mode") === "1";
  });
  const [linkPicker, setLinkPicker] = useState("");
  const [ingestStatus, setIngestStatus] = useState("");
  const [ingestJobId, setIngestJobId] = useState<string | null>(null);
  const [ingestError, setIngestError] = useState("");
  const ingestBusy = useRef(false);
  const ingestQueue = useRef<TranscribableMedia[]>([]);
  const ingestAskTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ingestCancel = useRef<(() => void) | null>(null);
  const ingestWatching = useRef<Set<string>>(new Set());
  const [iconOpen, setIconOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [noteShare, setNoteShare] = useState<NoteShare | null>(null);
  /** undefined = still resolving for non-owners */
  const [aclRole, setAclRole] = useState<NoteAclRole | null | undefined>(undefined);
  const [aclPeerCount, setAclPeerCount] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Serialize autosaves so overlapping writes don't share a stale baseUpdatedAt. */
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const dirtyRef = useRef(false);
  const knownBodyById = useRef<Map<string, string>>(new Map());
  const lastVersionRef = useRef<{
    noteId: string;
    title: string;
    body: string;
    at: number;
  } | null>(null);
  /** Cloud `updated_at` ms this editor session is based on (for conflict checks). */
  const baseUpdatedAtRef = useRef(0);
  const draftRef = useRef<{
    noteId: string;
    title: string;
    body: string;
    tags: string[];
    folder: string;
    icon: string;
    color: string;
    cover: string;
    parent_id: string;
  } | null>(null);
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  const scrollRestored = useRef<string | null>(null);
  const insertMdRef = useRef<((md: string, opts?: { at?: "cursor" | "end" }) => void) | null>(null);
  const liveRec = useLiveRecording();
  const [liveMode, setLiveMode] = useState<LiveRecordMode>("organize");
  const [liveAudioSource, setLiveAudioSource] = useState<LiveAudioSource>("mic");
  const [liveMenuOpen, setLiveMenuOpen] = useState(false);
  const liveMenuRef = useRef<HTMLDivElement | null>(null);
  const liveOpen = !!(id && liveRec.noteId === id);
  const latest = useRef({
    title: "",
    body: "",
    tags: [] as string[],
    folder: "",
    icon: "",
    color: "",
    cover: "",
    parent_id: "",
  });

  const isOwner = !!note && !!user && note.user_id === user.uid;
  const canEditNote = isOwner || aclRole === "editor";
  const canViewNote = isOwner || aclRole === "editor" || aclRole === "viewer";
  const isAppSurface = !!(note?.app_link?.type && note.app_link.id);
  /** Only open Yjs when this note is actually shared / co-edited — not every private note. */
  const isSharedCollab =
    aclRole === "editor" ||
    aclRole === "viewer" ||
    aclPeerCount > 0 ||
    (noteShare?.enabled === true && noteShare.mode === "edit");
  const collabEnabled =
    !!note &&
    !!user &&
    canViewNote &&
    !isAppSurface &&
    viewMode !== "slides" &&
    isSharedCollab;

  const collab = useNoteCollab({
    noteId: note?.id,
    uid: user?.uid,
    displayName,
    enabled: collabEnabled,
    canWrite: canEditNote && viewMode !== "read",
    seedMarkdown: body,
    seedTitle: title,
    getBodyMd: () => latest.current.body,
    onTitleRemote: (t) => {
      setTitle(t);
      latest.current = { ...latest.current, title: t };
    },
  });
  const collabReady = collab.ready && !!collab.provider;
  const collabReadyRef = useRef(false);
  collabReadyRef.current = collabReady;

  useEffect(() => {
    if (!id || !user) {
      setAclRole(undefined);
      return;
    }
    let cancelled = false;
    void getNoteAclRole(id, user.uid).then((role) => {
      if (!cancelled) setAclRole(role);
    });
    return () => {
      cancelled = true;
    };
  }, [id, user]);

  useEffect(() => {
    if (!id) {
      setAclPeerCount(0);
      return;
    }
    return listenNoteAcl(id, (entries) => {
      setAclPeerCount(entries.length);
    });
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      const n = await getNote(id);
      if (cancelled || !n) return;
      const seeded = takeNoteBodySeed(id);
      const pending = await loadPendingNoteDraft(id);
      // Prefer non-empty seed / pending offline draft / cloud body so we never paint empty over fresh AI notes.
      let bodyMd = (seeded && seeded.trim()) || n.body_md || "";
      let titleMd = n.title;
      let tagsMd = n.tags || [];
      let folderMd = n.folder || "";
      let iconMd = normalizePageIcon(n.icon || "");
      let colorMd = normalizePageColor(n.color);
      let coverMd = n.cover || "";
      let parentMd = n.parent_id || "";
      let fromOffline = false;
      if (pending?.payload) {
        const p = pending.payload;
        if (typeof p.title === "string") titleMd = p.title;
        if (typeof p.body_md === "string") bodyMd = p.body_md;
        if (Array.isArray(p.tags)) tagsMd = p.tags as string[];
        if (typeof p.folder === "string") folderMd = p.folder;
        if (typeof p.icon === "string") iconMd = normalizePageIcon(p.icon);
        if (typeof p.color === "string") colorMd = normalizePageColor(p.color);
        if (typeof p.cover === "string") coverMd = p.cover;
        if (typeof p.parent_id === "string") parentMd = p.parent_id;
        fromOffline = true;
      }
      if (seeded && seeded.trim() && seeded.trim() !== (n.body_md || "").trim() && !pending) {
        void updateNote(id, { body_md: seeded }).catch(() => {});
      }
      baseUpdatedAtRef.current = pending?.baseUpdatedAt ?? n.updated_at.getTime();
      // One-time: move interleaved 逐段+音檔 out of body into props.live_segments.
      let noteForState = n;
      if (migratedSegmentsRef.current !== id) {
        migratedSegmentsRef.current = id;
        const existing = liveSegmentsFromProps(n.props as Record<string, unknown>);
        const mig = migrateInterleavedTranscriptFromBody(bodyMd);
        if (mig.changed && mig.segments.length) {
          const merged = [...existing, ...mig.segments];
          const nextProps = {
            ...((n.props as Record<string, unknown>) || {}),
            [LIVE_SEGMENTS_PROP]: merged,
          };
          bodyMd = mig.body;
          noteForState = { ...n, body_md: bodyMd, props: nextProps };
          void updateNote(id, { body_md: bodyMd, props: nextProps }).catch(() => {});
        }
      }
      setNote(noteForState);
      setTitle(titleMd);
      setBody(bodyMd);
      setTags(tagsMd);
      setFolder(folderMd);
      setIcon(iconMd);
      setColor(colorMd);
      setCover(coverMd);
      setParentId(parentMd);
      setNoteShare(parseNoteShare(n.share));
      const fromCloud = normalizeDeck(n.deck);
      const fromLocal = loadDeckLocal(n.id);
      setDeck(fromCloud || fromLocal);
      knownBodyById.current.set(id, bodyMd);
      lastVersionRef.current = {
        noteId: id,
        title: titleMd,
        body: bodyMd,
        at: 0,
      };
      latest.current = {
        title: titleMd,
        body: bodyMd,
        tags: tagsMd,
        folder: folderMd,
        icon: iconMd,
        color: colorMd,
        cover: coverMd,
        parent_id: parentMd,
      };
      dirtyRef.current = fromOffline;
      draftRef.current = fromOffline
        ? {
            noteId: id,
            title: titleMd,
            body: bodyMd,
            tags: tagsMd,
            folder: folderMd,
            icon: iconMd,
            color: colorMd,
            cover: coverMd,
            parent_id: parentMd,
          }
        : null;
      setDirty(fromOffline);
      setStatus(fromOffline ? "offline" : "idle");
    })();
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  useEffect(() => {
    const onReload = (ev: Event) => {
      const noteId = (ev as CustomEvent<{ noteId?: string }>).detail?.noteId;
      if (!noteId || noteId !== id) return;
      void getNote(noteId).then((n) => {
        if (!n) return;
        baseUpdatedAtRef.current = n.updated_at.getTime();
        setNote(n);
        setNoteShare(parseNoteShare(n.share));
        // Yjs owns body/title while collab is connected.
        if (collabReadyRef.current) {
          setTags(n.tags || []);
          setFolder(n.folder || "");
          setIcon(normalizePageIcon(n.icon || ""));
          setColor(normalizePageColor(n.color));
          setCover(n.cover || "");
          setParentId(n.parent_id || "");
          return;
        }
        setTitle(n.title);
        setBody(n.body_md || "");
        setTags(n.tags || []);
        setFolder(n.folder || "");
        setIcon(normalizePageIcon(n.icon || ""));
        setColor(normalizePageColor(n.color));
        setCover(n.cover || "");
        setParentId(n.parent_id || "");
        knownBodyById.current.set(noteId, n.body_md || "");
        latest.current = {
          title: n.title,
          body: n.body_md || "",
          tags: n.tags || [],
          folder: n.folder || "",
          icon: normalizePageIcon(n.icon || ""),
          color: normalizePageColor(n.color),
          cover: n.cover || "",
          parent_id: n.parent_id || "",
        };
        dirtyRef.current = false;
        draftRef.current = null;
        setDirty(false);
        setStatus("saved");
        setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1800);
      });
    };
    const onBase = (ev: Event) => {
      const detail = (ev as CustomEvent<{ noteId?: string; updatedAt?: number }>).detail;
      if (!detail?.noteId || detail.noteId !== id) return;
      if (typeof detail.updatedAt === "number") baseUpdatedAtRef.current = detail.updatedAt;
    };
    window.addEventListener("albireus:note-reload", onReload);
    window.addEventListener("albireus:note-base", onBase);
    return () => {
      window.removeEventListener("albireus:note-reload", onReload);
      window.removeEventListener("albireus:note-base", onBase);
    };
  }, [id]);

  // Specialty apps own full-screen routes — leave the note shell (iframe) path.
  // Keep note shell when split-view is active so both panes can stay on /notes.
  useEffect(() => {
    if (!note || splitId) return;
    if (!isFullScreenAppLink(note.app_link)) return;
    router.replace(noteOpenHref(note));
  }, [note, splitId, router]);

  // Open live note recorder from capture (?live=1[&liveMode=…][&liveAudio=…][&liveStart=1])
  useEffect(() => {
    return subscribeMeetingAiContext(setMeetingCtxState);
  }, []);

  useEffect(() => {
    rehydrateMeetingAiContext(id || undefined);
  }, [id]);

  useEffect(() => {
    if (!id || !user) return;
    if (searchParams.get("live") !== "1") return;
    const raw = searchParams.get("liveMode");
    const mode: LiveRecordMode =
      raw === "audio" || raw === "transcribe" || raw === "organize" ? raw : "organize";
    const rawSrc = searchParams.get("liveAudio");
    const src: LiveAudioSource =
      rawSrc === "system" || rawSrc === "both" || rawSrc === "mic" ? rawSrc : "mic";
    setLiveMode(mode);
    setLiveAudioSource(src);
    liveRec.startLive({
      uid: user.uid,
      noteId: id,
      mode,
      audioSource: src,
      autoStart: searchParams.get("liveStart") === "1",
    });
    const url = new URL(window.location.href);
    url.searchParams.delete("live");
    url.searchParams.delete("liveMode");
    url.searchParams.delete("liveAudio");
    url.searchParams.delete("liveStart");
    window.history.replaceState({}, "", url.pathname + (url.search || ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, searchParams, user?.uid]);

  useEffect(() => {
    if (!id) return;
    return liveRec.registerNoteInsert(id, (md) => {
      if (insertMdRef.current) insertMdRef.current(md, { at: "end" });
      else {
        const next = `${latest.current.body || ""}${md}`;
        latest.current = { ...latest.current, body: next };
        setBody(next);
        markDirty({ body: next });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, liveRec.registerNoteInsert]);

  useEffect(() => {
    if (!liveMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!liveMenuRef.current?.contains(e.target as Node)) setLiveMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [liveMenuOpen]);

  // Consume research insert handoff (when returning from /research)
  useEffect(() => {
    if (!id) return;
    const flag = searchParams.get("researchInserted");
    if (flag !== "1") return;

    const pending = takeResearchInsert(id);
    void getNote(id).then((n) => {
      if (!n) return;
      let next = n.body_md || "";
      if (pending && !next.includes(pending.trim().slice(0, 80))) {
        next = `${next.trim()}${pending}`;
        void updateNote(id, { body_md: next });
      }
      setBody(next);
      latest.current = { ...latest.current, body: next };
      toast("深度研究已寫入本篇");
    });

    const url = new URL(window.location.href);
    url.searchParams.delete("researchInserted");
    window.history.replaceState({}, "", url.pathname + (url.search || ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, searchParams]);

  useEffect(() => {
    if (!id || !prefsCtx) return;
    prefsCtx.setPrefs((p) => touchRecentId(p, id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    latest.current = { title, body, tags, folder, icon, color, cover, parent_id: parentId };
  }, [title, body, tags, folder, icon, color, cover, parentId]);

  useEffect(() => {
    if (!id) return;
    publishNoteLiveDraft(id, title, body);
    return () => clearNoteLiveDraft(id);
  }, [id, title, body]);

  useEffect(() => {
    if (!id) return;
    const onEdit = (ev: Event) => {
      const detail = (ev as CustomEvent<NoteAiEditEventDetail>).detail;
      if (!detail || detail.noteId !== id) return;
      if (detail.title != null && detail.title.trim()) {
        const nextTitle = detail.title.trim();
        setTitle(nextTitle);
        latest.current = { ...latest.current, title: nextTitle };
      }
      if (detail.bodyMd != null) {
        const nextBody = applyNoteAiEditToBody(latest.current.body || body, {
          mode: detail.mode || "replace",
          bodyMd: detail.bodyMd,
          title: detail.title,
        });
        latest.current = { ...latest.current, body: nextBody };
        setBody(nextBody);
        publishNoteLiveDraft(id, latest.current.title, nextBody);
      }
      markDirty();
    };
    window.addEventListener(NOTE_AI_EDIT_EVENT, onEdit as EventListener);
    return () => window.removeEventListener(NOTE_AI_EDIT_EVENT, onEdit as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, body]);

  useEffect(() => {
    teamFocus.setFocusMode(focusMode);
  }, [focusMode, teamFocus]);

  useEffect(() => {
    if (!note?.id || !isNoteAppSurface(note.app_link)) return;
    try {
      const v = sessionStorage.getItem(`albireus_app_fill_${note.id}`);
      if (v === "0") setAppFill(false);
      else if (v === "1") setAppFill(true);
      else setAppFill(true);
    } catch {
      setAppFill(true);
    }
  }, [note?.id, note?.app_link]);

  const placeMoreMenu = useCallback(() => {
    const el = moreWrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const menuW = Math.max(180, r.width);
    const menuH = moreMenuRef.current?.offsetHeight || 320;
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < menuH + 12 && r.top > spaceBelow;
    const top = openUp ? Math.max(8, r.top - menuH - 6) : r.bottom + 6;
    const left = Math.max(8, Math.min(r.right - menuW, window.innerWidth - menuW - 8));
    setMorePos({ top, left, minWidth: menuW });
  }, []);

  useLayoutEffect(() => {
    if (!moreOpen) {
      setMorePos(null);
      return;
    }
    placeMoreMenu();
    const id = window.requestAnimationFrame(() => placeMoreMenu());
    return () => window.cancelAnimationFrame(id);
  }, [moreOpen, placeMoreMenu, viewMode]);

  useEffect(() => {
    if (!moreOpen && !exportMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (
        moreOpen &&
        !moreWrapRef.current?.contains(t) &&
        !moreMenuRef.current?.contains(t)
      ) {
        setMoreOpen(false);
      }
      if (exportMenuOpen && exportWrapRef.current && !exportWrapRef.current.contains(t)) {
        setExportMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMoreOpen(false);
        setExportMenuOpen(false);
      }
    };
    const onReposition = () => {
      if (moreOpen) placeMoreMenu();
    };
    // capture so editor/stopPropagation inside main can't block dismiss
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [moreOpen, exportMenuOpen, placeMoreMenu]);

  useEffect(() => {
    const { total, checked } = countTaskCheckboxes(body);
    const allDone = total > 0 && checked === total;
    if (allDone && !allCheckedRef.current) {
      fireConfetti();
    }
    allCheckedRef.current = allDone;
  }, [body]);

  useEffect(() => {
    // Prefer user setting when no explicit local override
    try {
      if (localStorage.getItem("cadence_note_aside_open") != null) return;
    } catch {
      /* ignore */
    }
    if (prefsCtx?.prefs.editorShowOutline === false) {
      setAsideOpen(false);
    } else if (prefsCtx?.prefs.editorShowOutline === true && !asideManualRef.current) {
      setAsideOpen(true);
    }
  }, [prefsCtx?.prefs.editorShowOutline]);

  useEffect(() => {
    // Only auto-collapse on true mobile widths; desktop stays open by default
    const mq = window.matchMedia("(max-width: 720px)");
    const apply = () => {
      if (asideManualRef.current) return;
      try {
        if (localStorage.getItem("cadence_note_aside_open") != null) return;
      } catch {
        /* ignore */
      }
      if (mq.matches) setAsideOpen(false);
      else if (prefsCtx?.prefs.editorShowOutline !== false) setAsideOpen(true);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [prefsCtx?.prefs.editorShowOutline]);

  const toggleAside = () => {
    asideManualRef.current = true;
    setAsideOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem("cadence_note_aside_open", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const captureDraft = (noteId: string) => {
    draftRef.current = {
      noteId,
      title: latest.current.title,
      body: latest.current.body,
      tags: [...latest.current.tags],
      folder: latest.current.folder,
      icon: latest.current.icon,
      color: latest.current.color,
      cover: latest.current.cover,
      parent_id: latest.current.parent_id,
    };
  };

  const draftUnchanged = (
    snap: NonNullable<typeof draftRef.current>,
    cur: NonNullable<typeof draftRef.current> | null
  ) => {
    if (!cur || cur.noteId !== snap.noteId) return false;
    return (
      cur.title === snap.title &&
      cur.body === snap.body &&
      cur.folder === snap.folder &&
      cur.icon === snap.icon &&
      cur.color === snap.color &&
      cur.cover === snap.cover &&
      cur.parent_id === snap.parent_id &&
      cur.tags.length === snap.tags.length &&
      cur.tags.every((t, i) => t === snap.tags[i])
    );
  };

  const flushPendingSaveInner = async (opts?: { silent?: boolean; onlyNoteId?: string }) => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const draft = draftRef.current;
    if (!dirtyRef.current || !draft) return;
    if (opts?.onlyNoteId && draft.noteId !== opts.onlyNoteId) return;

    const snap = {
      ...draft,
      tags: [...draft.tags],
    };
    const nextBody = snap.body;
    const known = knownBodyById.current.get(snap.noteId) || "";
    // Never autosave an empty body over a note that already has content (race after AI create).
    if (!nextBody.trim() && known.trim()) {
      dirtyRef.current = false;
      setDirty(false);
      setStatus("idle");
      return;
    }

    const silent = opts?.silent !== false;
    const savingId = snap.noteId;
    setStatus("saving");
    try {
      const inlineTags = extractTagsFromText(nextBody);
      const mergedTags = Array.from(new Set([...snap.tags, ...inlineTags]));
      const result = await saveNoteWithSync(
        savingId,
        {
          title: snap.title,
          ...(collabReadyRef.current ? {} : { body_md: nextBody }),
          tags: mergedTags,
          folder: snap.folder,
          icon: snap.icon,
          color: snap.color || "",
          cover: snap.cover,
          parent_id: snap.parent_id,
        },
        {
          baseUpdatedAt: baseUpdatedAtRef.current || Date.now(),
          label: snap.title,
        }
      );

      if (result.status === "queued") {
        // Keep draft if user typed more while queuing; otherwise park as offline-clean.
        if (draftUnchanged(snap, draftRef.current)) {
          dirtyRef.current = false;
          if (id === savingId) {
            setDirty(false);
            setStatus("offline");
          }
        } else if (id === savingId) {
          setStatus("offline");
        }
        return;
      }

      if (result.status === "cancelled") {
        if (id === savingId) setStatus("dirty");
        return;
      }

      if (result.status === "error") {
        if (id === savingId) {
          setStatus("error");
          setErrorMsg(result.message);
        }
        return;
      }

      if (result.status === "conflict_resolved" && result.kept === "remote") {
        // Editor reloads via albireus:note-reload
        return;
      }

      if (result.status === "saved" || result.status === "conflict_resolved") {
        baseUpdatedAtRef.current = result.updatedAt;
      }

      try {
        const prev =
          lastVersionRef.current?.noteId === savingId ? lastVersionRef.current : null;
        const ver = await maybePushNoteVersion(savingId, snap.title, nextBody, {
          force: !silent,
          previousBody: prev?.body,
          previousTitle: prev?.title,
          lastVersionAt: prev?.at,
        });
        if (ver.written) {
          lastVersionRef.current = {
            noteId: savingId,
            title: snap.title,
            body: nextBody,
            at: ver.at || Date.now(),
          };
        }
      } catch {
        /* best-effort */
      }
      knownBodyById.current.set(savingId, nextBody);
      setNote((n) =>
        n && n.id === savingId
          ? {
              ...n,
              body_md: nextBody,
              title: snap.title,
              updated_at: new Date(result.updatedAt),
            }
          : n
      );

      // If the user kept typing during this save, do not clear dirty / wipe the newer draft.
      if (draftUnchanged(snap, draftRef.current)) {
        dirtyRef.current = false;
        draftRef.current = null;
        if (id === savingId) {
          setTags(mergedTags);
          setDirty(false);
          setStatus("saved");
          setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), silent ? 1800 : 2200);
        }
      } else if (draftRef.current?.noteId === savingId) {
        dirtyRef.current = true;
        if (id === savingId) {
          setDirty(true);
          setStatus("dirty");
        }
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          void flushPendingSave({ silent: true });
        }, 450);
      }
    } catch (e) {
      if (id === savingId) {
        setStatus("error");
        setErrorMsg(e instanceof Error ? e.message : "儲存失敗");
      }
    }
  };

  const flushPendingSave = (opts?: { silent?: boolean; onlyNoteId?: string }) => {
    const job = saveChainRef.current.then(() => flushPendingSaveInner(opts));
    saveChainRef.current = job.catch(() => {
      /* keep chain alive */
    });
    return job;
  };

  const save = async (silent = false) => {
    if (!note) return;
    captureDraft(note.id);
    dirtyRef.current = true;
    await flushPendingSave({ silent, onlyNoteId: note.id });
  };

  const markDirty = (
    patch?: Partial<{
      title: string;
      body: string;
      tags: string[];
      folder: string;
      icon: string;
      color: string;
      cover: string;
      parent_id: string;
    }>
  ) => {
    if (!note) return;
    // Apply patch before captureDraft — React setState is async, so callers that
    // update state in the same tick must pass the new values or autosave snapshots stale data.
    if (patch) {
      latest.current = { ...latest.current, ...patch };
    }
    dirtyRef.current = true;
    captureDraft(note.id);
    setDirty(true);
    setStatus("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const secs = Math.min(30, Math.max(1, prefsCtx?.prefs.autosaveSeconds ?? 5));
    saveTimer.current = setTimeout(() => {
      void flushPendingSave({ silent: true });
    }, secs * 1000);
  };

  const flushPendingSaveRef = useRef(flushPendingSave);
  flushPendingSaveRef.current = flushPendingSave;

  const applyIngestBody = useCallback(
    (nextBody: string, jobId: string) => {
      setBody(nextBody);
      latest.current = { ...latest.current, body: nextBody };
      setNote((n) => (n ? { ...n, source_job_id: jobId, body_md: nextBody } : n));
      markDirty();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const runIngestPipeline = useCallback(
    async (
      mediaList: TranscribableMedia[],
      choice: Exclude<MediaIngestChoice, "embed">
    ) => {
      if (!user || !note || !mediaList.length) return;
      ingestBusy.current = true;
      setIngestError("");

      for (let i = 0; i < mediaList.length; i++) {
        const media = mediaList[i];
        const label =
          mediaList.length > 1 ? `${media.label}（${i + 1}/${mediaList.length}）` : media.label;
        try {
          setIngestStatus(`啟動轉錄：${label}`);
          const jobId = await startTranscriptionJob({
            uid: user.uid,
            getIdToken: () => user.getIdToken(),
            media,
            language: prefsCtx?.prefs.captureLanguage,
            onProgress: (msg, pct) =>
              setIngestStatus(pct != null ? `${msg} ${pct}%` : msg),
          });
          setIngestJobId(jobId);
          setNote((n) => (n ? { ...n, source_job_id: jobId } : n));
          try {
            await updateNote(note.id, { source_job_id: jobId });
          } catch {
            /* ignore */
          }

          const pending: PendingIngest = {
            noteId: note.id,
            jobId,
            choice,
            label: media.label,
            title: title || media.label,
            createdAt: Date.now(),
          };
          upsertPendingIngest(pending);
          toast("轉錄已在背景進行，可離開本頁，完成後會自動寫回");

          if (ingestWatching.current.has(jobId)) continue;
          ingestWatching.current.add(jobId);

          const { promise, cancel } = watchJob(jobId, (j) => {
            if (j.status === "processing") {
              setIngestStatus(`轉錄中 ${j.progress || 0}% · ${media.label}`);
            } else if (j.status === "queued") {
              const ahead = j.queue_ahead ?? 0;
              setIngestStatus(
                ahead > 0 ? `排隊中 · 前面 ${ahead} · ${media.label}` : `排隊中 · ${media.label}`
              );
            }
          });
          ingestCancel.current = cancel;
          setIngestStatus(`轉錄處理中 · ${media.label}`);

          try {
            const job = await promise;
            setIngestStatus("整理逐字稿…");
            const transcript = await loadJobPlainTranscript(job);
            let summary = "";
            if (choice === "transcribe_summarize" && transcript) {
              setIngestStatus("產生 AI 摘要…");
              summary = await summarizeTranscript({
                title: title || media.label,
                transcript,
                assistant: {
                  name: prefsCtx?.prefs.aiAssistantName,
                  style: prefsCtx?.prefs.aiStyle,
                  model: prefsCtx?.prefs.aiModel,
                  grounding: prefsCtx?.prefs.aiGrounding,
                },
              });
            }
            const block = formatIngestBlock({
              label: media.label,
              transcript: transcript || "（無內容）",
              summary: summary || undefined,
              jobId,
            });
            const currentBody = latest.current.body;
            const nextBody = replaceIngestMarker(currentBody, jobId, block);
            applyIngestBody(nextBody, jobId);
            removePendingIngest(jobId);
            toast(summary ? "已寫入逐字稿與 AI 摘要" : "已寫入逐字稿");
            setIngestStatus("");
            setIngestJobId(null);
            setIngestError("");
          } catch (e) {
            setIngestError(e instanceof Error ? e.message : "轉錄失敗");
            setIngestStatus("");
            toast(e instanceof Error ? e.message : "媒體轉錄失敗");
          } finally {
            ingestWatching.current.delete(jobId);
            if (ingestCancel.current === cancel) ingestCancel.current = null;
          }
        } catch (e) {
          setIngestError(e instanceof Error ? e.message : "啟動轉錄失敗");
          toast(e instanceof Error ? e.message : "啟動轉錄失敗");
        }
      }

      ingestBusy.current = false;
      // Only clear banner if nothing left to track
      if (ingestWatching.current.size === 0) {
        setIngestStatus("");
        setIngestJobId(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, note, title, prefsCtx, applyIngestBody]
  );

  const handleTranscribableMedia = useCallback(
    (
      media: TranscribableMedia,
      opts?: { forceChoice?: "transcribe" | "transcribe_summarize" }
    ) => {
      if (!user || !note) return;
      if (opts?.forceChoice) {
        if (ingestBusy.current) {
          ingestQueue.current.push(media);
          toast("已排入下一批轉錄");
          return;
        }
        void runIngestPipeline([media], opts.forceChoice);
        return;
      }
      ingestQueue.current.push(media);
      if (ingestAskTimer.current) clearTimeout(ingestAskTimer.current);
      ingestAskTimer.current = setTimeout(() => {
        void (async () => {
          const batch = ingestQueue.current.splice(0);
          if (!batch.length) return;
          if (ingestBusy.current) {
            ingestQueue.current.push(...batch);
            toast("已排入下一批轉錄");
            return;
          }
          const resolved = await resolveMediaIngestChoice({
            label: batch[0].label,
            count: batch.length,
            defaultPref: prefsCtx?.prefs.mediaIngestDefault || "ask",
          });
          if (!resolved || resolved.choice === "embed") return;
          if (resolved.remember && prefsCtx) {
            prefsCtx.setPrefs({ mediaIngestDefault: resolved.choice });
          }
          await runIngestPipeline(batch, resolved.choice);
        })();
      }, 180);
    },
    [user, note, prefsCtx, runIngestPipeline]
  );

  useEffect(() => {
    if (!user || !note) return;
    const pendings = loadPendingIngests(note.id);
    for (const p of pendings) {
      if (ingestWatching.current.has(p.jobId)) continue;
      ingestWatching.current.add(p.jobId);
      setIngestJobId(p.jobId);
      setIngestStatus(`恢復轉錄追蹤 · ${p.label}`);
      void (async () => {
        try {
          const result = await finalizePendingIngest(p, {
            assistant: {
              name: prefsCtx?.prefs.aiAssistantName,
              style: prefsCtx?.prefs.aiStyle,
              model: prefsCtx?.prefs.aiModel,
              grounding: prefsCtx?.prefs.aiGrounding,
            },
            onProgress: (label) => setIngestStatus(`${label} · ${p.label}`),
          });
          if (result) {
            applyIngestBody(result.body, p.jobId);
            toast(result.summary ? "已寫入逐字稿與 AI 摘要" : "已寫入逐字稿");
          }
          setIngestStatus("");
          setIngestJobId(null);
        } catch (e) {
          setIngestError(e instanceof Error ? e.message : "轉錄失敗");
          setIngestStatus("");
        } finally {
          ingestWatching.current.delete(p.jobId);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, note?.id]);

  // Flush pending edits when leaving this note (tab switch / route change).
  useEffect(() => {
    const noteId = id;
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      void flushPendingSaveRef.current({ silent: true, onlyNoteId: noteId });
    };
  }, [id]);

  useEffect(() => {
    const onHide = () => {
      void flushPendingSaveRef.current({ silent: true });
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") onHide();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVis);
      if (ingestAskTimer.current) clearTimeout(ingestAskTimer.current);
    };
  }, []);

  const runAi = async (action: NoteAiActionId | string, prompt?: string) => {
    if (aiBusy) return;
    const catalog = findCadenceAiAction(action) || findCadenceAiAction(action.replace(/^ai-/, ""));
    const apiAction = catalog?.apiAction || action;
    const meta = NOTE_AI_ACTIONS.find((a) => a.id === action);
    const needsBody = ["summarize", "rewrite", "outline", "expand", "actions", "quiz", "explain"].includes(apiAction);
    if (needsBody && !body.trim()) return;

    setAiBusy(true);
    setAiError("");
    try {
      const pack = buildNoteAiContext({
        title,
        body,
        folder,
        status: note?.status,
        tags,
        relatedTitles: related.map((r) => r.title),
      });
      const res = await aiFetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: apiAction,
          title,
          body,
          context: pack.context,
          prompt: prompt || catalog?.prompt,
          assistant: {
            name: prefsCtx?.prefs.aiAssistantName,
            style: prefsCtx?.prefs.aiStyle,
            model: prefsCtx?.prefs.aiModel,
            grounding: prefsCtx?.prefs.aiGrounding,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI 失敗");
      const text = String(data.text || "").trim();
      if (!text) throw new Error("AI 無回覆");

      const mode = catalog?.insertMode || meta?.mode || "append";
      if (mode === "replace" || meta?.mode === "replace") {
        setBody(text);
        markDirty({ body: text });
      } else if (mode === "cursor" && insertMdRef.current) {
        insertMdRef.current(text);
        markDirty();
      } else {
        const label = catalog?.label || meta?.label || action;
        const next = `${body.trim()}\n\n---\n\n## AI ${label}\n\n${text}`;
        setBody(next);
        markDirty({ body: next });
      }
      toast(`已套用：${catalog?.label || meta?.label || action}`);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI 失敗");
    } finally {
      setAiBusy(false);
    }
  };

  const stats = useMemo(() => computeNoteStats(body), [body]);
  const outline = useMemo(() => extractOutline(body), [body]);
  const liveSegments = useMemo(
    () => liveSegmentsFromProps(note?.props as Record<string, unknown> | undefined),
    [note?.props]
  );
  const related = useMemo(
    () =>
      note
        ? findRelatedNotes(
            { id: note.id, title, body_md: body, tags, folder },
            allNotes,
            6
          )
        : [],
    [note, title, body, tags, folder, allNotes]
  );

  const aiPack = useMemo(
    () =>
      buildNoteAiContext({
        title,
        body,
        folder,
        status: note?.status,
        tags,
        relatedTitles: related.map((r) => r.title),
      }),
    [title, body, folder, note?.status, tags, related]
  );

  const backlinks = useMemo(() => {
    if (!note) return [];
    return findBacklinks(allNotes, { id: note.id, title, body_md: body, tags });
  }, [allNotes, note, title, body, tags]);

  const outbound = useMemo(() => extractWikiLinks(body), [body]);

  useEffect(() => {
    if (!id) return;
    try {
      const m = sessionStorage.getItem(`cadence_view_${id}`);
      if (m === "slides" || m === "write" || m === "read") setViewMode(m);
      if (m === "slides") {
        setAsideOpen(true);
        setAsideTab("outline");
      }
    } catch {
      /* ignore */
    }
  }, [id]);

  useEffect(() => {
    if (!id || !note || (viewMode !== "write" && viewMode !== "read")) return;
    if (scrollRestored.current === id) return;
    if (typeof window !== "undefined" && window.location.hash) {
      scrollRestored.current = id;
      return;
    }
    const el = mainScrollRef.current;
    if (!el) return;
    let top = 0;
    try {
      top = Number(sessionStorage.getItem(`cadence_scroll_${id}`)) || 0;
    } catch {
      top = 0;
    }
    scrollRestored.current = id;
    if (top <= 0) return;
    const t = window.setTimeout(() => {
      if (mainScrollRef.current) mainScrollRef.current.scrollTop = top;
    }, 80);
    return () => window.clearTimeout(t);
  }, [id, note, viewMode]);

  useEffect(() => {
    const el = mainScrollRef.current;
    if (!el || !id) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          sessionStorage.setItem(`cadence_scroll_${id}`, String(el.scrollTop));
        } catch {
          /* ignore */
        }
      }, 200);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (timer) clearTimeout(timer);
    };
  }, [id, note]);

  const setMode = (mode: "write" | "read" | "slides") => {
    setViewMode(mode);
    if (id) {
      try {
        sessionStorage.setItem(`cadence_view_${id}`, mode);
      } catch {
        /* ignore */
      }
    }
  };

  const ensureDeck = (): SlideDeck => {
    if (deck?.slides?.length) return deck;
    const generated = deckFromMarkdown(title, body);
    setDeck(generated);
    if (note) {
      saveDeckLocal(note.id, generated);
      void updateNote(note.id, { deck: generated as unknown as Record<string, unknown> }).catch(
        () => undefined
      );
    }
    return generated;
  };

  const enterSlidesAt = (index?: number) => {
    let next = deck;
    const staleNow = isDeckStale(deck, title, body);
    if (!next?.slides?.length || staleNow) {
      next = deckFromMarkdown(title, body, deck?.theme || "teal");
      onDeckChange(next);
      if (staleNow && deck?.slides?.length) toast("已依筆記更新投影片");
    } else {
      next = ensureDeck();
    }
    const safeIdx =
      typeof index === "number"
        ? Math.max(0, Math.min(index, (next?.slides.length || 1) - 1))
        : null;
    if (safeIdx != null && note) {
      try {
        sessionStorage.setItem(`cadence_slide_idx_${note.id}`, String(safeIdx));
      } catch {
        /* ignore */
      }
      setSlideFocusIndex(safeIdx);
      setSlideFocusNonce((n) => n + 1);
    } else {
      setSlideFocusIndex(null);
    }
    setMode("slides");
    // Keep outline available for jump ↔ slides
    setAsideOpen(true);
    setAsideTab("outline");
  };

  const enterSlides = () => enterSlidesAt();

  const enterWrite = () => {
    setMode("write");
    setSlideFocusIndex(null);
  };

  const enterRead = () => {
    void (async () => {
      if (dirty) await save(true);
      setMode("read");
      setSlideFocusIndex(null);
      setFocusMode(false);
      setIconOpen(false);
      setMoreOpen(false);
    })();
  };

  const findSlideIndexForHeading = (heading: string): number => {
    const sections = splitMarkdownSections(title, body);
    let idx = sections.findIndex((s) => s.title.trim() === heading.trim());
    if (idx < 0) {
      idx = sections.findIndex(
        (s) => s.title.includes(heading) || heading.includes(s.title)
      );
    }
    if (idx >= 0) return idx;
    if (deck?.slides?.length) {
      idx = deck.slides.findIndex((s) =>
        (s.blocks.find((b) => b.role === "title")?.text || "").includes(heading)
      );
      if (idx >= 0) return idx;
    }
    return 0;
  };

  const onDeckChange = (next: SlideDeck) => {
    setDeck(next);
    if (note) {
      saveDeckLocal(note.id, next);
      void updateNote(note.id, { deck: next as unknown as Record<string, unknown> }).catch(() => {
        /* local still ok */
      });
    }
  };

  useEffect(() => {
    if (viewMode !== "slides" || !note) return;
    if (deck?.slides?.length) return;
    const generated = deckFromMarkdown(title, body);
    setDeck(generated);
    saveDeckLocal(note.id, generated);
  }, [viewMode, note, deck, title, body]);

  const linkCandidates = useMemo(() => {
    const q = linkPicker.trim().toLowerCase();
    const list = allNotes.filter((n) => n.id !== note?.id);
    if (!q) return list.slice(0, 8);
    return list.filter((n) => n.title.toLowerCase().includes(q)).slice(0, 8);
  }, [allNotes, linkPicker, note?.id]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty && status !== "saving") return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, status]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (viewMode === "read") return;
        void save(false);
      }
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        if (viewMode === "read") return;
        setFindOpen(true);
      }
      if (mod && e.key === "\\") {
        e.preventDefault();
        toggleAside();
      }
      if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setFocusMode(false);
        openGlobalAiRail();
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFocusMode((v) => !v);
      }
      // Cycle write → read → slides
      if (mod && e.key === ".") {
        e.preventDefault();
        if (viewMode === "write") enterRead();
        else if (viewMode === "read") enterSlides();
        else enterWrite();
      }
      // Toggle reading mode
      if (mod && e.shiftKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        if (viewMode === "read") enterWrite();
        else enterRead();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id, viewMode, deck, title, body]);

  const insertWiki = (noteTitle: string) => {
    const t = noteTitle.trim();
    if (!t) return;
    const next = `${body.trim()}${body.trim() ? "\n\n" : ""}[[${t}]]\n`;
    setBody(next);
    markDirty({ body: next });
    setLinkPicker("");
    toast(`已插入雙向連結 [[${t}]]`);
  };

  const openWikiNote = useCallback(
    async (noteTitle: string, noteId?: string | null) => {
      if (!user) return;
      const idFromHref = (noteId || "").trim();
      if (idFromHref) {
        if (idFromHref === note?.id) {
          toast("已在此筆記");
          setLinkPicker("");
          return;
        }
        if (dirty) await save(false);
        setLinkPicker("");
        router.push(`/notes/${idFromHref}`);
        return;
      }
      const t = noteTitle.trim();
      if (!t) return;
      const hit = findNoteByTitle(
        allNotes.map((n) => ({
          id: n.id,
          title: n.title,
          body_md: n.body_md,
          tags: n.tags,
        })),
        t
      );
      if (hit && hit.id === note?.id) {
        toast("已在此筆記");
        setLinkPicker("");
        return;
      }
      if (hit) {
        if (dirty) await save(false);
        setLinkPicker("");
        router.push(`/notes/${hit.id}`);
        return;
      }
      const ok = await askConfirm({
        title: `尚未有「${t}」`,
        message: "要建立為目前筆記的子頁並開啟嗎？",
        confirmLabel: "建立子頁並開啟",
      });
      if (!ok) return;
      if (dirty) await save(false);
      const id = await createNote(user.uid, t, "", undefined, [], {
        folder: folder || undefined,
        parent_id: note?.id || "",
        status: "backlog",
      });
      setLinkPicker("");
      toast(`已建立子頁「${t}」`);
      router.push(`/notes/${id}`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, allNotes, note?.id, dirty, folder, router]
  );

  const duplicate = async () => {
    if (!user || !note) return;
    const newId = await createNote(
      user.uid,
      `${title || "未命名"}（副本）`,
      body,
      note.source_job_id,
      tags,
      { folder, status: note.status }
    );
    toast("已建立副本");
    router.push(`/notes/${newId}`);
  };

  const remove = async () => {
    if (!note) return;
    if (!(await askConfirm({ title: "刪除此筆記？", message: "此操作無法復原。", danger: true, confirmLabel: "刪除" }))) return;
    await deleteNote(note.id);
    router.push("/library");
  };

  const copyMd = async () => {
    await navigator.clipboard.writeText(`# ${title}\n\n${body}`);
    toast("已複製 Markdown");
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    toast("已複製頁面連結");
  };

  const jumpHeading = (item: HeadingItem) => {
    if (viewMode === "slides") {
      enterSlidesAt(findSlideIndexForHeading(item.text));
      return;
    }
    const root = document.querySelector(".rich-prose");
    if (!root) return;
    const tag = `H${item.level}`;
    const nodes = Array.from(root.querySelectorAll(tag));
    const hit = nodes.find((n) => (n.textContent || "").trim() === item.text.trim());
    hit?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const jumpOrganize = () => {
    const hit = outline.find(
      (h) => h.text.includes("AI 整理") || h.text.startsWith("整理")
    );
    if (hit) {
      jumpHeading(hit);
      return;
    }
    toast("筆記中尚無 AI 整理標題");
  };

  useEffect(() => {
    const onUi = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as
        | { noteId?: string; recording?: boolean; segmentCount?: number }
        | undefined;
      if (!detail?.noteId || detail.noteId !== id) return;
      setLiveRecordingHere(Boolean(detail.recording));
      if (detail.recording) {
        setAsideOpen(true);
        setAsideTab("recording");
        try {
          localStorage.setItem("cadence_note_aside_open", "1");
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener("cadence:live-recording-ui", onUi as EventListener);
    return () => window.removeEventListener("cadence:live-recording-ui", onUi as EventListener);
  }, [id]);

  // Keep sidebar timeline in sync while segments are appended from the recorder.
  useEffect(() => {
    if (!id || !user) return;
    return listenToNote(id, (n) => {
      if (!n) return;
      setNote((prev) => {
        if (!prev || prev.id !== n.id) return prev;
        const a = liveSegmentsFromProps(prev.props as Record<string, unknown>);
        const b = liveSegmentsFromProps(n.props as Record<string, unknown>);
        if (
          a.length === b.length &&
          (a.length === 0 || a[a.length - 1]?.id === b[b.length - 1]?.id)
        ) {
          return prev;
        }
        return { ...prev, props: n.props };
      });
    });
  }, [id, user]);

  // If we land on recording tab but segments were cleared and not recording, fall back.
  useEffect(() => {
    if (asideTab === "recording" && liveSegments.length === 0 && !liveRecordingHere) {
      setAsideTab("outline");
    }
  }, [asideTab, liveSegments.length, liveRecordingHere]);

  const onAsideResize = (px: number) => {
    setAsideWidth(px);
    try {
      localStorage.setItem("cadence_note_aside_w", String(px));
    } catch {
      /* ignore */
    }
  };

  if (loading) return <PageLoading />;
  if (!user) return <p style={{ padding: "2rem" }}>請先登入。</p>;
  if (!note) return <PageLoading label="載入筆記中…" />;
  if (!isOwner && aclRole === undefined) return <PageLoading label="確認權限…" />;
  if (!canViewNote) return <p style={{ padding: "2rem" }}>無權限。</p>;

  const statusLabel =
    viewMode === "read" ? "閱讀模式"
    : collabReady
      ? (collab.status === "saving" ? "即時同步中…"
        : collab.status === "synced" ? "即時共編已連線"
        : collab.status === "offline" ? "離線（重連後同步）"
        : collab.status === "error" ? "共編連線異常"
        : collab.status === "connecting" ? "共編連線中…"
        : status === "dirty" ? "未儲存變更"
          : status === "saving" ? "儲存中…"
            : status === "saved" ? "已自動儲存"
              : "")
    : status === "saving" ? "儲存中…"
      : status === "saved" ? "已自動儲存"
        : status === "offline" ? "已離線儲存，上線後同步"
        : status === "dirty" ? "未儲存變更"
          : status === "error" ? errorMsg
            : "";

  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, "");
    if (!t || tags.includes(t)) return;
    const next = [...tags, t];
    setTags(next);
    setTagInput("");
    markDirty({ tags: next });
  };

  const removeTag = (tag: string) => {
    const next = tags.filter((x) => x !== tag);
    setTags(next);
    markDirty({ tags: next });
  };

  const editorWidth = prefsCtx?.prefs.editorWidth || "medium";
  const widthExtended = editorWidth === "full" || editorWidth === "wide";
  const isAppPage = isNoteAppSurface(note.app_link);
  const toggleAppFill = () => {
    setAppFill((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem(`albireus_app_fill_${note.id}`, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <div
      className={`doc-workspace${focusMode ? " is-focus" : ""}${asideOpen ? " has-aside" : ""}${pageMode ? " is-page" : ""}${viewMode === "slides" ? " is-slides" : ""}${viewMode === "read" ? " is-reading" : ""}${splitId && splitId !== id ? " has-split" : ""}${isAppPage ? " is-app-page" : ""}${isAppPage && appFill ? " is-app-fill" : ""}`}
      style={{ ["--note-aside-w" as string]: `${asideWidth}px` }}
    >
      <div className="doc-chrome">
      <div className={`doc-ribbon${viewMode === "slides" || viewMode === "read" || isAppPage ? " is-hidden" : ""}`} ref={setRibbonHost} />

      <div className="doc-command">
        <nav className="doc-command-path" aria-label="筆記路徑">
          <Link href="/library" className="doc-crumb">知識庫</Link>
          {splitFolderPath(folder).map((seg, i, arr) => {
            const path = arr.slice(0, i + 1).join("/");
            return (
              <span key={path} style={{ display: "contents" }}>
                <span className="doc-crumb-sep">/</span>
                <Link
                  href={`/library?folder=${encodeURIComponent(path)}`}
                  className="doc-crumb"
                >
                  {seg}
                </Link>
              </span>
            );
          })}
          {parentId && (() => {
            const parent = allNotes.find((n) => n.id === parentId);
            return parent ? (
              <>
                <span className="doc-crumb-sep">/</span>
                <Link href={`/notes/${parent.id}`} className="doc-crumb">
                  {parent.icon ? (
                    <>
                      <PageChromeIcon
                        icon={parent.icon}
                        color={parent.color}
                        className="doc-crumb-icon"
                      />{" "}
                    </>
                  ) : null}
                  {parent.title || "上層"}
                </Link>
              </>
            ) : null;
          })()}
          <span className="doc-crumb-sep">/</span>
          <span className="doc-crumb-current">{title || "未命名"}</span>
          {statusLabel ? (
            <span className={`doc-save-pill${status === "error" ? " is-error" : ""}`}>
              {statusLabel}
            </span>
          ) : null}
        </nav>
        <div className="doc-command-bar">
          {!isAppPage ? (
          <div className="doc-view-switch" role="tablist" aria-label="檢視模式">
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "write"}
              className={viewMode === "write" ? "is-on" : ""}
              onClick={enterWrite}
              title="寫作 ⌘."
            >
              寫作
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "read"}
              className={viewMode === "read" ? "is-on" : ""}
              onClick={enterRead}
              title="閱讀 ⌘⇧R"
            >
              閱讀
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "slides"}
              className={viewMode === "slides" ? "is-on" : ""}
              onClick={enterSlides}
              title="簡報 ⌘."
            >
              簡報
            </button>
          </div>
          ) : null}
          {(viewMode === "write" || viewMode === "read") && !isAppPage && prefsCtx ? (
            <div className="doc-view-switch doc-width-switch" role="tablist" aria-label="編輯區寬度">
              <button
                type="button"
                role="tab"
                aria-selected={!widthExtended}
                className={!widthExtended ? "is-on" : ""}
                title="置中寬度（閱讀舒適）"
                onClick={() => prefsCtx.setPrefs({ editorWidth: "medium" })}
              >
                置中
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={widthExtended}
                className={widthExtended ? "is-on" : ""}
                title="延伸兩邊"
                onClick={() => prefsCtx.setPrefs({ editorWidth: "full" })}
              >
                延伸
              </button>
            </div>
          ) : null}
          <div className="doc-command-actions">
          <NotePresence noteId={note.id} />
          {collabReady ? (
            <span
              className={`doc-collab-status${
                collab.status === "saving" ? " is-saving"
                  : collab.status === "error" ? " is-error"
                    : collab.status === "offline" ? " is-offline"
                      : ""
              }`}
            >
              {collab.status === "synced" ? "共編中" : collab.status === "saving" ? "同步中" : collab.status === "connecting" ? "連線中" : collab.status === "offline" ? "離線" : "共編異常"}
            </span>
          ) : null}
          <NoteHuddle noteId={note.id} />
          {!isAppPage && viewMode !== "slides" ? (
            <div className="doc-cmd-wrap" ref={liveMenuRef}>
              <button
                type="button"
                className={`doc-cmd doc-cmd--keep${liveOpen ? " is-on" : ""}`}
                title="即時錄音：麥克風／裝置聲音／兩者 · 純錄製／轉錄／整理"
                aria-expanded={liveMenuOpen}
                onClick={() => setLiveMenuOpen((v) => !v)}
              >
                錄音
              </button>
              {liveMenuOpen ? (
                <div className="doc-cmd-menu doc-cmd-menu--live" role="menu">
                  <div className="doc-cmd-menu-section" role="group" aria-label="聲音來源">
                    <p className="doc-cmd-menu-heading">聲音來源</p>
                    <div className="doc-cmd-menu-chips">
                      {(
                        [
                          ["mic", "麥克風"],
                          ["system", "裝置聲音"],
                          ["both", "兩者"],
                        ] as const
                      ).map(([src, label]) => (
                        <button
                          key={src}
                          type="button"
                          className={`doc-cmd-menu-chip${liveAudioSource === src ? " is-on" : ""}`}
                          title={liveAudioSourceHint(src)}
                          onClick={() => setLiveAudioSource(src)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="doc-cmd-menu-hint">{liveAudioSourceHint(liveAudioSource)}</p>
                  </div>
                  <p className="doc-cmd-menu-heading">錄製方式</p>
                  {(
                    [
                      ["audio", "只留音檔，不轉文字"],
                      ["transcribe", "邊錄邊轉成文字寫入筆記"],
                      ["organize", "轉字後再由 AI 整理重點"],
                    ] as const
                  ).map(([mode, hint]) => (
                    <button
                      key={mode}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setLiveMode(mode);
                        setLiveMenuOpen(false);
                        if (!user || !note) return;
                        liveRec.startLive({
                          uid: user.uid,
                          noteId: note.id,
                          mode,
                          audioSource: liveAudioSource,
                          autoStart: true,
                        });
                      }}
                    >
                      <strong>
                        {liveModeLabel(mode)}
                        <span className="doc-cmd-menu-src">
                          · {liveAudioSourceLabel(liveAudioSource)}
                        </span>
                      </strong>
                      <span>{hint}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {isAppPage ? (
            <button
              type="button"
              className={`doc-cmd doc-cmd--keep${appFill ? " is-on" : ""}`}
              title={appFill ? "顯示標題與屬性" : "站滿內容區"}
              onClick={toggleAppFill}
            >
              {appFill ? "還原頁首" : "站滿畫面"}
            </button>
          ) : null}
          {viewMode === "slides" && slideActions && (
            <>
              {slideActions.busy && <span className="slide-busy">{slideActions.busy}</span>}
              {slideActions.stale && (
                <button type="button" className="doc-cmd is-on" onClick={() => slideActions.sync()}>
                  同步筆記
                </button>
              )}
              <div className="slide-export-wrap" ref={exportWrapRef}>
                <button
                  type="button"
                  className={`doc-cmd${exportMenuOpen ? " is-on" : ""}`}
                  onClick={() => setExportMenuOpen((v) => !v)}
                >
                  匯出
                </button>
                {exportMenuOpen && (
                  <div className="slide-export-menu">
                    <button
                      type="button"
                      onClick={() => {
                        setExportMenuOpen(false);
                        void slideActions.exportPng();
                      }}
                    >
                      目前頁 PNG
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setExportMenuOpen(false);
                        slideActions.exportPdf();
                      }}
                    >
                      全部 PDF
                    </button>
                  </div>
                )}
              </div>
              <button type="button" className="doc-cmd slide-play-btn" onClick={() => slideActions.play()}>
                播放
              </button>
            </>
          )}
          <button
            type="button"
            className={`doc-cmd doc-cmd--keep${(prefsCtx?.prefs.favoriteNoteIds || []).includes(note.id) ? " is-on" : ""}`}
            title="收藏"
            onClick={() => prefsCtx?.setPrefs((p) => toggleFavoriteId(p, note.id))}
          >
            ★
          </button>
          {viewMode === "write" && (
            <button type="button" className="doc-cmd doc-cmd--keep" title="尋找 ⌘F" onClick={() => setFindOpen(true)}>
              尋找
            </button>
          )}
          <button
            type="button"
            className={`doc-cmd doc-cmd--keep${noteShare?.enabled ? " is-on" : ""}`}
            title="分享筆記"
            onClick={() => setShareOpen(true)}
          >
            分享
          </button>
          <button
            type="button"
            className={`doc-cmd doc-cmd--keep${asideOpen ? " is-on" : ""}`}
            title="側欄 ⌘\\"
            onClick={() => toggleAside()}
          >
            {liveSegments.length
              ? `側欄 · 錄音素材 (${liveSegments.length})`
              : "側欄"}
          </button>
          <div className="doc-more-wrap" ref={moreWrapRef}>
            <button type="button" className="doc-cmd doc-cmd--keep" onClick={() => setMoreOpen((v) => !v)}>
              更多
            </button>
            {moreOpen && morePos && typeof document !== "undefined"
              ? createPortal(
                  <div
                    ref={moreMenuRef}
                    className="doc-more-menu doc-more-menu--portal"
                    role="menu"
                    style={{
                      position: "fixed",
                      top: morePos.top,
                      left: morePos.left,
                      minWidth: morePos.minWidth,
                      zIndex: 6000,
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                {[
                  ...(viewMode === "write"
                    ? [
                        {
                          label: "新增子頁面",
                          fn: () => {
                            if (!user) return;
                            void (async () => {
                              const name = await askPrompt("子頁面標題", "未命名子頁");
                              if (name == null) return;
                              const t = name.trim() || "未命名子頁";
                              const id = await createNote(user.uid, t, "", undefined, [], {
                                parent_id: note.id,
                                status: "backlog",
                                folder: folder || "",
                              });
                              const nextBody = `${body.trim()}${body.trim() ? "\n\n" : ""}[[${t}]]\n`;
                              setBody(nextBody);
                              latest.current = { ...latest.current, body: nextBody };
                              try {
                                await updateNote(note.id, {
                                  title: latest.current.title,
                                  body_md: nextBody,
                                  tags: latest.current.tags,
                                  folder: latest.current.folder,
                                  icon: latest.current.icon,
                                  color: latest.current.color || "",
                                  cover: latest.current.cover,
                                  parent_id: latest.current.parent_id,
                                });
                              } catch {
                                markDirty();
                              }
                              toast(`已建立子頁：${t}`);
                              router.push(`/notes/${id}`);
                            })();
                          },
                        },
                        { label: "摘要", fn: () => runAi("summarize") },
                        { label: "抽待辦", fn: () => runAi("actions") },
                        {
                          label: focusMode ? "離開專注" : "專注模式 ⌘⇧F",
                          fn: () => setFocusMode((v) => !v),
                        },
                        {
                          label: "閱讀模式 ⌘⇧R",
                          fn: () => enterRead(),
                        },
                        {
                          label: pageMode ? "關閉頁面模式" : "頁面模式（A4）",
                          fn: () => {
                            setPageMode((v) => {
                              const next = !v;
                              try {
                                localStorage.setItem("cadence_page_mode", next ? "1" : "0");
                              } catch {
                                /* ignore */
                              }
                              return next;
                            });
                          },
                        },
                      ]
                    : []),
                  ...(viewMode === "read"
                    ? [
                        {
                          label: "回到寫作",
                          fn: () => enterWrite(),
                        },
                      ]
                    : []),
                  ...(viewMode === "write"
                    ? [
                        { label: "改寫", fn: () => runAi("rewrite") },
                        { label: "擴寫", fn: () => runAi("expand") },
                        { label: "產出大綱", fn: () => runAi("outline") },
                        { label: "出測驗題", fn: () => runAi("quiz") },
                        { label: "白話說明", fn: () => runAi("explain") },
                        {
                          label: "版本歷史",
                          fn: async () => {
                            setVersionsOpen(true);
                            setVersions(await listNoteVersions(note.id));
                          },
                        },
                      ]
                    : []),
                  { label: "複製 Markdown", fn: () => copyMd() },
                  { label: "複製連結", fn: () => copyLink() },
                  ...(viewMode === "write"
                    ? [
                        {
                          label: "分享為社群模板",
                          fn: () => {
                            if (!user) return;
                            void (async () => {
                              const name =
                                (await askPrompt({
                                  title: "模板名稱",
                                  defaultValue: title || "未命名模板",
                                  placeholder: "顯示在社群商店的名稱",
                                })) || "";
                              if (!name.trim()) return;
                              const description =
                                (await askPrompt({
                                  title: "模板簡介（選填）",
                                  defaultValue: "",
                                  placeholder: "別人會看到的說明",
                                })) ?? "";
                              const pricing = await askChoice({
                                title: "上架方式",
                                message: "選擇免費或收費（收費目前僅標記，尚未開放購買）。",
                                options: [
                                  { id: "free", label: "免費" },
                                  { id: "paid", label: "收費" },
                                ],
                              });
                              if (!pricing) return;
                              try {
                                toast("正在上傳模板…");
                                const { publishNoteAsCommunityTemplate } = await import(
                                  "@/lib/community/publish"
                                );
                                const pack = await publishNoteAsCommunityTemplate({
                                  uid: user.uid,
                                  authorName: displayName || user.email?.split("@")[0] || "匿名",
                                  authorPhoto: photoURL || undefined,
                                  note: {
                                    title,
                                    body_md: body,
                                    icon: icon || undefined,
                                    cover: cover || undefined,
                                    tags,
                                  },
                                  name: name.trim(),
                                  description: description.trim(),
                                  paid: pricing.choice === "paid",
                                });
                                toast("已分享到社群商店「模板」");
                                router.push(`/community/${pack.id}?kind=template`);
                              } catch (e) {
                                toast(e instanceof Error ? e.message : "分享失敗");
                              }
                            })();
                          },
                        },
                        { label: "複製筆記", fn: () => duplicate() },
                      ]
                    : []),
                  { label: "匯出 Markdown", fn: () => downloadMarkdown(title, body) },
                  { label: "匯出 PDF", fn: () => downloadPdfViaPrint(title, body) },
                  { label: "匯出 DOCX", fn: () => { void downloadDocx(title, body); } },
                  { label: "匯出簡報大綱", fn: () => downloadPptOutline(title, body) },
                  ...(viewMode === "write"
                    ? [
                        { label: "手動儲存 ⌘S", fn: () => save(false) },
                        { label: "刪除筆記", fn: () => remove(), danger: true as const },
                      ]
                    : []),
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className={`doc-more-item${"danger" in item && item.danger ? " is-danger" : ""}`}
                    onClick={() => {
                      void item.fn();
                      setMoreOpen(false);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
                  </div>,
                  document.body
                )
              : null}
          </div>
        </div>
        </div>
      </div>
      </div>

      <div className="doc-body-row">
        <div
          ref={mainScrollRef}
          className={`doc-main-stack${splitId && splitId !== id ? " is-split" : ""}${
            splitId && splitId !== id && splitLayout.collapse !== "none"
              ? ` is-collapse-${splitLayout.collapse}`
              : ""
          }`}
          style={
            splitId && splitId !== id && splitLayout.collapse === "none"
              ? ({ ["--split-left" as string]: `${splitLayout.leftPct}%` } as CSSProperties)
              : undefined
          }
        >
        <div className={`doc-page${viewMode === "slides" ? " doc-page--slides" : ""}`}>
          {splitLayout.collapse === "left" && splitId && splitId !== id ? (
            <button
              type="button"
              className="note-split-rail note-split-rail--left"
              title="展開左側主頁"
              aria-label="展開左側主頁"
              onClick={() => setSplitLayout({ ...splitLayout, collapse: "none" })}
            >
              <span>主頁</span>
            </button>
          ) : null}
          {viewMode === "read" && (
            <div className="doc-read-banner">
              <span>閱讀模式 · 內容無法編輯</span>
              <button type="button" className="doc-cmd" onClick={enterWrite}>
                回到寫作
              </button>
            </div>
          )}

          {(viewMode === "write" || viewMode === "read") && <NotePageLog noteId={note.id} />}
          {aiError && viewMode === "write" && <p className="doc-banner-error">{aiError}</p>}
          {(ingestStatus || ingestError || ingestJobId) && viewMode === "write" && (
            <div className={`doc-banner-ingest${ingestError ? " is-error" : ""}`}>
              <div className="doc-banner-ingest-main">
                <span>{ingestError || ingestStatus || "媒體轉錄進行中"}</span>
                <div className="doc-banner-ingest-actions">
                  {ingestJobId && (
                    <Link href={`/job/${ingestJobId}`} className="doc-banner-ingest-link">
                      開啟工作
                    </Link>
                  )}
                  {ingestError && ingestJobId && (
                    <button
                      type="button"
                      className="doc-cmd"
                      onClick={() => {
                        const pendings = loadPendingIngests(note.id).filter(
                          (p) => p.jobId === ingestJobId
                        );
                        setIngestError("");
                        for (const p of pendings) {
                          if (ingestWatching.current.has(p.jobId)) continue;
                          ingestWatching.current.add(p.jobId);
                          void (async () => {
                            try {
                              setIngestStatus(`重試 · ${p.label}`);
                              const result = await finalizePendingIngest(p, {
                                assistant: {
                                  name: prefsCtx?.prefs.aiAssistantName,
                                  style: prefsCtx?.prefs.aiStyle,
                                  model: prefsCtx?.prefs.aiModel,
                                  grounding: prefsCtx?.prefs.aiGrounding,
                                },
                                onProgress: (label) => setIngestStatus(`${label} · ${p.label}`),
                              });
                              if (result) {
                                applyIngestBody(result.body, p.jobId);
                                toast(result.summary ? "已寫入逐字稿與 AI 摘要" : "已寫入逐字稿");
                              }
                              setIngestStatus("");
                              setIngestJobId(null);
                            } catch (e) {
                              setIngestError(e instanceof Error ? e.message : "轉錄失敗");
                              setIngestStatus("");
                            } finally {
                              ingestWatching.current.delete(p.jobId);
                            }
                          })();
                        }
                      }}
                    >
                      重試
                    </button>
                  )}
                  <button
                    type="button"
                    className="doc-cmd"
                    onClick={() => {
                      ingestCancel.current?.();
                      ingestCancel.current = null;
                      setIngestStatus("");
                      setIngestError("");
                      setIngestJobId(null);
                      if (!ingestError) {
                        toast("已改為背景寫入，可繼續編輯或離開本頁");
                      }
                    }}
                  >
                    {ingestError ? "關閉" : "背景繼續"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {viewMode === "write" && versionsOpen && (
            <div className="doc-versions">
              <div className="doc-versions-head">
                <strong>版本歷史</strong>
                <button type="button" className="doc-cmd" onClick={() => setVersionsOpen(false)}>關閉</button>
              </div>
              {versions.length === 0 ? (
                <p className="note-aside-empty">尚無快照。</p>
              ) : versions.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className="doc-version-row"
                  onClick={() => {
                    void (async () => {
                      if (!(await askConfirm("還原此版本？"))) return;
                      setTitle(v.title);
                      setBody(v.body_md);
                      markDirty({ title: v.title, body: v.body_md });
                      setVersionsOpen(false);
                    })();
                  }}
                >
                  <span>{v.title || "（無標題）"}</span>
                  <span>
                    {v.summary ? `${v.summary} · ` : ""}
                    {v.created_at.toLocaleString("zh-TW")}
                  </span>
                </button>
              ))}
            </div>
          )}

          {(viewMode === "write" || viewMode === "read") && cover && (
            <div
              className="doc-cover"
              style={{ backgroundImage: `url(${cover})` }}
              title="封面"
            >
              {viewMode === "write" ? (
                <button
                  type="button"
                  className="doc-cover-clear"
                  onClick={() => {
                    setCover("");
                    markDirty({ cover: "" });
                  }}
                >
                  移除封面
                </button>
              ) : null}
            </div>
          )}

          <div className={`doc-title-row${viewMode === "slides" ? " is-compact" : ""}`}>
            <div className="doc-icon-wrap">
              <button
                type="button"
                className="doc-icon-btn"
                onClick={() => viewMode === "write" && setIconOpen((v) => !v)}
                title={viewMode === "read" ? "頁面圖示" : "頁面圖示與顏色"}
                disabled={viewMode === "read"}
                style={
                  color
                    ? {
                        background: pageColorMeta(color).bg,
                        color: pageColorMeta(color).fg,
                        boxShadow: `inset 0 0 0 1px ${pageColorMeta(color).fg}33`,
                      }
                    : undefined
                }
              >
                <PageChromeIcon
                  icon={icon}
                  color={color || undefined}
                  fallback="description"
                />
              </button>
              {iconOpen && viewMode === "write" && (
                <IconColorPicker
                  mode="note"
                  icon={icon}
                  color={color}
                  onChange={(next) => {
                    const nextIcon = normalizePageIcon(next.icon);
                    const nextColor = normalizePageColor(next.color);
                    setIcon(nextIcon);
                    setColor(nextColor);
                    markDirty({ icon: nextIcon, color: nextColor });
                  }}
                  onClose={() => setIconOpen(false)}
                />
              )}
            </div>
            {viewMode === "read" ? (
              <h1 className="doc-title doc-title--read">{title || "無標題"}</h1>
            ) : (
              <input
                className="doc-title"
                value={title}
                onChange={(e) => {
                  const v = e.target.value;
                  setTitle(v);
                  latest.current = { ...latest.current, title: v };
                  if (collabReady) {
                    collab.setTitle(v);
                    return;
                  }
                  markDirty({ title: v });
                }}
                placeholder="無標題"
                readOnly={viewMode === "slides" || !canEditNote}
              />
            )}
          </div>

          {viewMode === "write" && (
            <>
              <div className="doc-chrome-actions">
                {!cover && (
                  <button
                    type="button"
                    className="doc-cmd"
                    onClick={() => {
                      void (async () => {
                        const url = await askPrompt("封面圖片網址", "https://");
                        if (!url) return;
                        const nextCover = url.trim();
                        setCover(nextCover);
                        markDirty({ cover: nextCover });
                      })();
                    }}
                  >
                    加封面
                  </button>
                )}
              </div>

              <div className="doc-props">
                <input
                  className="doc-prop-input"
                  placeholder="資料夾"
                  value={folder}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFolder(v);
                    markDirty({ folder: v });
                  }}
                />
                {tags.map((t) => (
                  <span key={t} className="badge doc-tag-chip">
                    #{t}
                    <button
                      type="button"
                      className="doc-tag-remove"
                      aria-label={`移除標籤 ${t}`}
                      title="移除標籤"
                      onClick={() => removeTag(t)}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  className="doc-prop-input"
                  placeholder="加標籤…"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                />
                <MenuSelect
                  variant="pill"
                  ariaLabel="筆記狀態"
                  value={note.status === "doing" || note.status === "done" ? note.status : "backlog"}
                  options={NOTE_STATUS_OPTIONS}
                  onChange={(v) => {
                    void updateNote(note.id, { status: v as Note["status"] });
                    setNote({ ...note, status: v as Note["status"] });
                  }}
                />
                <span className="doc-meta-chip">{stats.words} 字 · {stats.readingMins} 分</span>
                {!note.database_id ? (
                  <>
                    <span className="doc-meta-chip" title="建立時間">
                      建立 {note.created_at.toLocaleString("zh-TW")}
                    </span>
                    <span className="doc-meta-chip" title="最後編輯時間">
                      編輯 {note.updated_at.toLocaleString("zh-TW")}
                    </span>
                  </>
                ) : null}
                {note.source_job_id && (
                  <Link href={`/job/${note.source_job_id}`} className="doc-prop-input" style={{ color: "var(--accent-2)" }}>
                    來源逐字稿
                  </Link>
                )}
              </div>

              {note.database_id ? (
                <NoteDbPropertiesPanel
                  note={note}
                  userId={user.uid}
                  onNotePatch={(patch) => {
                    setNote((n) => {
                      if (!n) return n;
                      const next: Note = { ...n, ...patch };
                      if (patch.props) next.props = { ...(n.props || {}), ...patch.props };
                      return next;
                    });
                    if (patch.title != null) {
                      setTitle(patch.title);
                      latest.current = { ...latest.current, title: patch.title };
                    }
                    if (patch.tags) {
                      setTags(patch.tags);
                      latest.current = { ...latest.current, tags: patch.tags };
                    }
                  }}
                />
              ) : null}

            </>
          )}

          {viewMode === "read" && (tags.length > 0 || folder || stats.words > 0 || note.database_id) && (
            <div className="doc-props doc-props--read" aria-label="筆記資訊">
              {folder ? <span className="doc-meta-chip">{folder}</span> : null}
              {tags.map((t) => (
                <span key={t} className="badge">
                  #{t}
                </span>
              ))}
              <span className="doc-meta-chip">{stats.words} 字 · {stats.readingMins} 分</span>
              {!note.database_id ? (
                <>
                  <span className="doc-meta-chip" title="建立時間">
                    建立 {note.created_at.toLocaleString("zh-TW")}
                  </span>
                  <span className="doc-meta-chip" title="最後編輯時間">
                    編輯 {note.updated_at.toLocaleString("zh-TW")}
                  </span>
                </>
              ) : null}
            </div>
          )}

          {viewMode === "read" && note.database_id ? (
            <NoteDbPropertiesPanel
              note={note}
              userId={user.uid}
              readOnly
              onNotePatch={() => {}}
            />
          ) : null}

          {viewMode === "slides" && (
            <div className="doc-slide-back">
              <button type="button" className="doc-cmd" onClick={enterWrite}>
                ← 回寫作
              </button>
              <span>同一則筆記 · 右側大綱可跳投影片</span>
            </div>
          )}

          <div className={`doc-pane doc-pane--write${viewMode === "write" || viewMode === "read" ? " is-active" : ""}`} aria-hidden={viewMode !== "write" && viewMode !== "read"}>
          <div className="doc-editor-shell">
            {note.app_link?.type && note.app_link.id ? (
              <NoteAppSurface
                note={note}
                userId={user.uid}
                onTitleHint={(t) => {
                  if (viewMode === "read") return;
                  setTitle(t);
                  markDirty({ title: t });
                }}
              />
            ) : (
            <>
            <MeetingNoteBar
              noteId={note.id}
              noteTitle={title || note.title}
              uid={user.uid}
              active={
                note.folder === "會議" ||
                (note.tags || []).includes("會議") ||
                meetingCtx?.noteId === note.id
              }
              meetingCtx={meetingCtx}
              onBodyPatched={() => {
                void getNote(note.id).then((n) => {
                  if (!n) return;
                  setBody(n.body_md || "");
                  latest.current = { ...latest.current, body: n.body_md || "" };
                });
              }}
            />
            <RichNoteEditor
              key={collabReady ? `collab-${note.id}` : `local-${note.id}`}
              valueMd={body}
              onChangeMd={(md) => {
                if (viewMode === "read" || !canEditNote) return;
                // Ignore spurious empty updates that would wipe a loaded note via autosave.
                if (!md.trim() && body.trim()) return;
                // Keep latest in sync immediately so captureDraft / ingest write-back
                // don't snapshot a stale body (e.g. YouTube URL not yet in React state).
                latest.current = { ...latest.current, body: md };
                setBody(md);
                if (collabReady) return;
                markDirty();
              }}
              placeholder="輸入文字，空白段按空白鍵或 /ai 呼叫助手…"
              findOpen={findOpen}
              onFindOpenChange={setFindOpen}
              toolbarHost={ribbonHost}
              userId={user.uid}
              noteId={note.id}
              wikiNotes={allNotes}
              pageMode={pageMode}
              noteTitle={title}
              aiContext={aiPack.context}
              insertMdRef={insertMdRef}
              readOnly={viewMode === "read" || !canEditNote}
              collab={collabReady && collab.provider ? { provider: collab.provider } : undefined}
              onOpenAiAssistant={() => {
                setFocusMode(false);
                openGlobalAiRail();
              }}
              onDeepResearchSelection={(selection) => {
                router.push(
                  buildResearchUrl({
                    from: note.id,
                    topic: selection.slice(0, 80).replace(/\s+/g, " "),
                    selection,
                    returnTo: true,
                  })
                );
              }}
              onRunAiAction={(apiAction, prompt) => {
                void runAi(apiAction, prompt);
              }}
              onTranscribableMedia={(media) => {
                void handleTranscribableMedia(media);
              }}
              showEmptyTemplates
              onEmptyTemplate={(tid) => {
                const tpl = noteTemplates.find((t) => t.id === tid) || NOTE_TEMPLATES.find((t) => t.id === tid);
                if (!tpl) return;
                const nextTitle = tpl.title && !title.trim() ? tpl.title : undefined;
                const nextTags = tpl.tags.length
                  ? Array.from(new Set([...tags, ...tpl.tags]))
                  : undefined;
                if (nextTitle) setTitle(nextTitle);
                setBody(tpl.body);
                if (nextTags) setTags(nextTags);
                markDirty({
                  ...(nextTitle ? { title: nextTitle } : {}),
                  body: tpl.body,
                  ...(nextTags ? { tags: nextTags } : {}),
                });
                toast(`已套用範本：${tpl.label}`);
              }}
              onOpenThread={(selection) => setThreadSelection(selection)}
              onOpenWikiNote={(t, id) => void openWikiNote(t, id)}
              onCreateSubpage={async (pageTitle) => {
                if (!user || !note) return null;
                try {
                  const t = pageTitle.trim() || "未命名子頁";
                  const id = await createNote(user.uid, t, "", undefined, [], {
                    parent_id: note.id,
                    status: "backlog",
                    folder: folder || "",
                  });
                  toast(`已建立子頁：${t}`);
                  return { id, title: t };
                } catch (e) {
                  toast(e instanceof Error ? e.message : "建立子頁失敗");
                  return null;
                }
              }}
            />
            </>
            )}
          </div>

          </div>

          <div className={`doc-pane doc-pane--slides${viewMode === "slides" ? " is-active" : ""}`} aria-hidden={viewMode !== "slides"}>
            {deck ? (
              <SlideStudio
                open={viewMode === "slides"}
                noteId={note.id}
                noteTitle={title}
                noteBody={body}
                deck={deck}
                onChange={onDeckChange}
                onBackToWrite={enterWrite}
                onSynced={() => toast("已依筆記更新投影片")}
                onActionsChange={setSlideActions}
                focusIndex={slideFocusIndex}
                focusNonce={slideFocusNonce}
              />
            ) : (
              <p className="slide-loading">正在準備投影片…</p>
            )}
          </div>
        </div>

        {splitId && splitId !== id && (
          <>
            <NoteSplitResizer layout={splitLayout} onChange={setSplitLayout} />
            <NoteSplitPane
              noteId={splitId}
              collapsed={splitLayout.collapse === "right"}
              onExpand={() => setSplitLayout({ ...splitLayout, collapse: "none" })}
              onCollapse={() => setSplitLayout({ ...splitLayout, collapse: "right" })}
              onClose={() => tabs?.setSplit(null)}
            />
          </>
        )}
        </div>

        <NoteAside
          open={asideOpen && !focusMode}
          tab={asideTab}
          onTab={setAsideTab}
          stats={stats}
          outline={outline}
          related={related}
          liveSegments={liveSegments}
          showRecordingTab={liveRecordingHere}
          onJumpOrganize={jumpOrganize}
          outbound={outbound.map((t) => {
            const hit = findNoteByTitle(allNotes, t);
            return hit ? { title: t, href: `/notes/${hit.id}` } : { title: t };
          })}
          backlinks={backlinks.map((n) => ({ id: n.id, title: n.title }))}
          onJumpHeading={jumpHeading}
          linkPicker={linkPicker}
          onLinkPickerChange={setLinkPicker}
          linkCandidates={linkCandidates.map((n) => ({ id: n.id, title: n.title }))}
          onOpenWikiNote={(t, nid) => void openWikiNote(t, nid)}
          onInsertWiki={viewMode === "read" ? () => undefined : insertWiki}
          widthPx={asideWidth}
          onResizeWidth={onAsideResize}
        />
      </div>

      {threadSelection != null && note && (
        <div className="block-thread-overlay">
          <BlockThreadPanel
            noteId={note.id}
            selectionText={threadSelection}
            onClose={() => setThreadSelection(null)}
          />
        </div>
      )}

      {viewMode === "write" && !focusMode && !isAppPage && (
        <ColorSwatchUtility
          onApply={(hex) => {
            const nextColor = normalizePageColor(hex);
            setColor(nextColor);
            markDirty({ color: nextColor });
          }}
        />
      )}

      {user && note && (
        <ShareDialog
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          noteId={note.id}
          ownerId={note.user_id}
          noteTitle={note.title}
          share={noteShare}
          onUpdated={(s) => {
            setNoteShare(s);
            setNote((n) => (n ? { ...n, share: s || undefined } : n));
          }}
        />
      )}
    </div>
  );
}