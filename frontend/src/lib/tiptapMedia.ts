import { Node, mergeAttributes } from "@tiptap/core";
import { noteAudioNodeView } from "@/lib/tiptapNoteAudio";
import { noteVideoNodeView } from "@/lib/tiptapNoteVideo";
import type { TranscribableMedia } from "@/lib/noteMediaIngest";
import type { NoteAudioTranscribeOpts } from "@/lib/tiptapNoteAudio";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    noteAudio: {
      setNoteAudio: (attrs: { src: string; title?: string }) => ReturnType;
    };
    noteVideo: {
      setNoteVideo: (attrs: { src: string; title?: string; loop?: boolean }) => ReturnType;
    };
    noteFile: {
      setNoteFile: (attrs: { href: string; name: string; size?: string }) => ReturnType;
    };
  }
  interface Storage {
    noteAudio: {
      requestTranscribe:
        | null
        | ((media: TranscribableMedia, opts?: NoteAudioTranscribeOpts) => void);
    };
  }
}

export const NoteAudio = Node.create({
  name: "noteAudio",
  group: "block",
  atom: true,
  draggable: true,
  addStorage() {
    return {
      requestTranscribe: null as
        | null
        | ((media: TranscribableMedia, opts?: NoteAudioTranscribeOpts) => void),
    };
  },
  addAttributes() {
    return {
      src: { default: null },
      title: { default: null },
    };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-note-audio-wrap]",
        getAttrs: (el) => {
          const audio = (el as HTMLElement).querySelector("audio");
          if (!audio) return false;
          return {
            src: audio.getAttribute("src"),
            title: audio.getAttribute("title"),
          };
        },
      },
      { tag: "audio[data-note-audio]" },
      { tag: "audio.rich-audio" },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "audio",
      mergeAttributes(HTMLAttributes, {
        controls: "true",
        class: "rich-audio",
        "data-note-audio": "1",
        preload: "metadata",
      }),
    ];
  },
  addNodeView() {
    return noteAudioNodeView();
  },
  addCommands() {
    return {
      setNoteAudio:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs,
          }),
    };
  },
});
export const NoteVideo = Node.create({
  name: "noteVideo",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      title: { default: null },
      /** Default on — user can turn off from the video chrome. */
      loop: {
        default: true,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-loop") !== "0",
        renderHTML: (attrs) =>
          attrs.loop === false
            ? { "data-loop": "0" }
            : { "data-loop": "1", loop: "loop" },
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-note-video-wrap]",
        getAttrs: (el) => {
          const video = (el as HTMLElement).querySelector("video");
          if (!video) return false;
          const loopAttr = (el as HTMLElement).getAttribute("data-loop");
          return {
            src: video.getAttribute("src"),
            title: video.getAttribute("title"),
            loop: loopAttr !== "0",
          };
        },
      },
      {
        tag: "video[data-note-video]",
        getAttrs: (el) => {
          const v = el as HTMLVideoElement;
          return {
            src: v.getAttribute("src"),
            title: v.getAttribute("title"),
            loop: v.getAttribute("data-loop") !== "0",
          };
        },
      },
      {
        tag: "video.rich-video",
        getAttrs: (el) => {
          const v = el as HTMLVideoElement;
          return {
            src: v.getAttribute("src"),
            title: v.getAttribute("title"),
            loop: v.getAttribute("data-loop") !== "0",
          };
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const loopOn = HTMLAttributes.loop !== false && HTMLAttributes["data-loop"] !== "0";
    const { loop: _loopAttr, ...rest } = HTMLAttributes as Record<string, unknown>;
    return [
      "video",
      mergeAttributes(rest, {
        controls: "true",
        class: "rich-video",
        "data-note-video": "1",
        "data-loop": loopOn ? "1" : "0",
        preload: "metadata",
        playsinline: "true",
        ...(loopOn ? { loop: "loop" } : {}),
      }),
    ];
  },
  addNodeView() {
    return noteVideoNodeView();
  },
  addCommands() {
    return {
      setNoteVideo:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { loop: true, ...attrs },
          }),
    };
  },
});

export const NoteFile = Node.create({
  name: "noteFile",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      href: { default: null },
      name: { default: "檔案" },
      size: { default: null },
    };
  },
  parseHTML() {
    return [
      {
        tag: "a[data-note-file]",
        getAttrs: (el) => {
          const a = el as HTMLAnchorElement;
          return {
            href: a.getAttribute("href"),
            name: a.getAttribute("data-name") || a.textContent || "檔案",
            size: a.getAttribute("data-size"),
          };
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const name = HTMLAttributes.name || "檔案";
    const size = HTMLAttributes.size ? ` · ${HTMLAttributes.size}` : "";
    return [
      "a",
      mergeAttributes(
        {
          href: HTMLAttributes.href,
          class: "rich-file",
          "data-note-file": "1",
          "data-name": name,
          "data-size": HTMLAttributes.size || "",
          target: "_blank",
          rel: "noopener noreferrer",
        },
        { href: HTMLAttributes.href }
      ),
      `📎 ${name}${size}`,
    ];
  },
  addCommands() {
    return {
      setNoteFile:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs,
          }),
    };
  },
});
