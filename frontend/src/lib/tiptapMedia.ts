import { Node, mergeAttributes } from "@tiptap/core";
import { noteAudioNodeView } from "@/lib/tiptapNoteAudio";
import type { TranscribableMedia } from "@/lib/noteMediaIngest";
import type { NoteAudioTranscribeOpts } from "@/lib/tiptapNoteAudio";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    noteAudio: {
      setNoteAudio: (attrs: { src: string; title?: string }) => ReturnType;
    };
    noteVideo: {
      setNoteVideo: (attrs: { src: string; title?: string }) => ReturnType;
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
    };
  },
  parseHTML() {
    return [{ tag: "video[data-note-video]" }, { tag: "video.rich-video" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "video",
      mergeAttributes(HTMLAttributes, {
        controls: "true",
        class: "rich-video",
        "data-note-video": "1",
        preload: "metadata",
      }),
    ];
  },
  addCommands() {
    return {
      setNoteVideo:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs,
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
