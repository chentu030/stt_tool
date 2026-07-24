"use client";

import { useCallback, useRef, useState, type DragEvent, type ClipboardEvent } from "react";
import {
  AI_ATTACH_ACCEPT,
  AI_ATTACH_MAX_FILES,
  appendAiAttachments,
  revokeAiAttachment,
  revokeAiAttachments,
  type AiAttachment,
} from "@/lib/aiAttachments";

type UseAiAttachmentsOpts = {
  onError?: (msg: string) => void;
};

export function useAiAttachments(opts?: UseAiAttachmentsOpts) {
  const [attachments, setAttachments] = useState<AiAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const clearAttachments = useCallback(() => {
    setAttachments((prev) => {
      revokeAiAttachments(prev);
      return [];
    });
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const hit = prev.find((a) => a.id === id);
      if (hit) revokeAiAttachment(hit);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const onErrorRef = useRef(opts?.onError);
  onErrorRef.current = opts?.onError;

  const addFiles = useCallback(async (files: FileList | File[] | null | undefined) => {
    if (!files || (files as FileList).length === 0) return;
    const prev = await new Promise<AiAttachment[]>((resolve) => {
      setAttachments((p) => {
        resolve(p);
        return p;
      });
    });
    const { next, errors } = await appendAiAttachments(prev, files);
    setAttachments(next);
    if (errors.length) onErrorRef.current?.(errors[0]);
  }, []);

  const openPicker = useCallback(() => {
    fileRef.current?.click();
  }, []);

  const onDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current += 1;
    if (e.dataTransfer?.types?.includes("Files")) setDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  }, []);

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepth.current = 0;
      setDragOver(false);
      void addFiles(e.dataTransfer?.files);
    },
    [addFiles]
  );

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items?.length) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === "file") {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        e.preventDefault();
        void addFiles(files);
      }
    },
    [addFiles]
  );

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept={AI_ATTACH_ACCEPT}
      multiple
      hidden
      onChange={(e) => {
        void addFiles(e.target.files);
        e.target.value = "";
      }}
    />
  );

  return {
    attachments,
    setAttachments,
    dragOver,
    clearAttachments,
    removeAttachment,
    addFiles,
    openPicker,
    onDragEnter,
    onDragLeave,
    onDragOver,
    onDrop,
    onPaste,
    fileInput,
    maxFiles: AI_ATTACH_MAX_FILES,
  };
}

type ChipsProps = {
  attachments: AiAttachment[];
  onRemove: (id: string) => void;
  disabled?: boolean;
};

export function AiAttachmentChips({ attachments, onRemove, disabled }: ChipsProps) {
  if (!attachments.length) return null;
  return (
    <div className="cadence-ai-attach-chips" aria-label="附件">
      {attachments.map((a) => (
        <div key={a.id} className="cadence-ai-attach-chip">
          {a.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.previewUrl} alt="" className="cadence-ai-attach-thumb" />
          ) : (
            <span className="cadence-ai-attach-icon">{a.kind === "pdf" ? "PDF" : "檔"}</span>
          )}
          <span className="cadence-ai-attach-name" title={a.name}>
            {a.name}
          </span>
          <button
            type="button"
            className="cadence-ai-attach-x"
            disabled={disabled}
            aria-label={`移除 ${a.name}`}
            onClick={() => onRemove(a.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
