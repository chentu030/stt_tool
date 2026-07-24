/** Shared AI multimodal attachments for rail + popup composers. */

export type AiAttachmentKind = "image" | "pdf" | "file";

export type AiAttachment = {
  id: string;
  kind: AiAttachmentKind;
  name: string;
  mimeType: string;
  /** Raw base64 without data: prefix */
  data: string;
  size: number;
  /** Object URL for image preview (revoke on remove) */
  previewUrl?: string;
};

export type AiAttachmentPayload = {
  name: string;
  mimeType: string;
  data: string;
  kind?: AiAttachmentKind;
};

export const AI_ATTACH_MAX_FILES = 6;
export const AI_ATTACH_MAX_BYTES = 8 * 1024 * 1024; // 8MB each
export const AI_ATTACH_ACCEPT =
  "image/png,image/jpeg,image/jpg,image/webp,image/gif,application/pdf";

const IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

function uid() {
  return `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function classifyAiMime(mime: string, name = ""): AiAttachmentKind | null {
  const m = (mime || "").toLowerCase();
  const n = name.toLowerCase();
  if (IMAGE_MIME.has(m) || /\.(png|jpe?g|webp|gif)$/i.test(n)) return "image";
  if (m === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  return null;
}

export function revokeAiAttachment(att: AiAttachment) {
  if (att.previewUrl) {
    try {
      URL.revokeObjectURL(att.previewUrl);
    } catch {
      /* ignore */
    }
  }
}

export function revokeAiAttachments(list: AiAttachment[]) {
  for (const a of list) revokeAiAttachment(a);
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || "");
      const i = raw.indexOf(",");
      resolve(i >= 0 ? raw.slice(i + 1) : raw);
    };
    reader.onerror = () => reject(new Error("讀取檔案失敗"));
    reader.readAsDataURL(file);
  });
}

export type AddAttachmentsResult = {
  next: AiAttachment[];
  added: AiAttachment[];
  errors: string[];
};

/** Validate + convert Files into attachments; enforces limits. */
export async function appendAiAttachments(
  current: AiAttachment[],
  files: FileList | File[]
): Promise<AddAttachmentsResult> {
  const list = Array.from(files || []);
  const errors: string[] = [];
  const added: AiAttachment[] = [];
  let next = [...current];

  for (const file of list) {
    if (next.length >= AI_ATTACH_MAX_FILES) {
      errors.push(`最多 ${AI_ATTACH_MAX_FILES} 個附件`);
      break;
    }
    const kind = classifyAiMime(file.type, file.name);
    if (!kind) {
      errors.push(`不支援：${file.name || "檔案"}（請用圖片或 PDF）`);
      continue;
    }
    if (file.size > AI_ATTACH_MAX_BYTES) {
      errors.push(`${file.name || "檔案"}超過 8MB`);
      continue;
    }
    try {
      const data = await readFileAsBase64(file);
      const mimeType =
        file.type ||
        (kind === "pdf" ? "application/pdf" : "image/png");
      const att: AiAttachment = {
        id: uid(),
        kind,
        name: file.name || (kind === "pdf" ? "文件.pdf" : "圖片.png"),
        mimeType,
        data,
        size: file.size,
        previewUrl: kind === "image" ? URL.createObjectURL(file) : undefined,
      };
      next = [...next, att];
      added.push(att);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "讀取失敗");
    }
  }

  return { next, added, errors };
}

export function toAttachmentPayloads(list: AiAttachment[]): AiAttachmentPayload[] {
  return list.map((a) => ({
    name: a.name,
    mimeType: a.mimeType,
    data: a.data,
    kind: a.kind,
  }));
}

export function attachmentSourceLabel(a: AiAttachment | AiAttachmentPayload): string {
  const name = a.name || (a.kind === "pdf" ? "PDF" : "圖片");
  return name.length > 28 ? `${name.slice(0, 28)}…` : name;
}
