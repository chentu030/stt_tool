import { detectMediaKind, uploadNoteMedia, updateNote } from "@/lib/firebase";
import { formatFileSize } from "@/lib/mdHtml";

/** Markdown snippets compatible with mdHtml.ts round-trip. */
export function mediaMarkdownForFile(url: string, file: File): string {
  const name = file.name || "file";
  const kind = detectMediaKind(file);
  const lower = name.toLowerCase();

  if (kind === "image") {
    return `\n\n![${name}](${url})\n\n`;
  }
  if (kind === "audio") {
    return `\n\n![audio|${name}](${url})\n\n`;
  }
  if (kind === "video") {
    return `\n\n![video|${name}](${url})\n\n`;
  }
  if (lower.endsWith(".pdf")) {
    return `\n\n[embed|pdf|${name}](${url})\n\n`;
  }
  if (/\.(ppt|pptx)$/i.test(lower)) {
    return `\n\n[embed|ppt|${name}](${url})\n\n`;
  }
  const size = formatFileSize(file.size);
  return `\n\n[file|${name}|${size}](${url})\n\n`;
}

export async function appendMediaToNote(
  uid: string,
  noteId: string,
  file: File,
  currentBody: string
): Promise<{ body_md: string; url: string }> {
  const { url } = await uploadNoteMedia(uid, noteId, file);
  const body_md = `${currentBody || ""}${mediaMarkdownForFile(url, file)}`;
  await updateNote(noteId, { body_md });
  return { body_md, url };
}

export function titleFromFileName(name: string): string {
  return name.replace(/\.[^/.]+$/, "").trim() || "未命名附件";
}
