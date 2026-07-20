"use client";

import { useMemo } from "react";
import { markdownToDisplayHtml } from "@/lib/mdHtml";

/** Renders assistant/user chat text with Markdown + KaTeX. */
export default function AiMarkdown({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const html = useMemo(() => markdownToDisplayHtml(text || ""), [text]);
  if (!text?.trim()) return null;
  return (
    <div
      className={`note-ai-md ${className}`.trim()}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
