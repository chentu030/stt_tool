"use client";

import { useEffect, useState, type CSSProperties } from "react";

type Props = {
  prefix?: string;
  texts: string[];
  prefixColor?: string;
  typedColor?: string;
  cursorColor?: string;
  cursorChar?: string;
  typeMs?: number;
  deleteMs?: number;
  holdMs?: number;
  className?: string;
  style?: CSSProperties;
};

/** OriginKit-inspired Type Writer — rotating phrases with caret */
export default function TypeWriter({
  prefix = "",
  texts,
  prefixColor = "var(--text-muted)",
  typedColor = "var(--accent-2)",
  cursorColor,
  cursorChar = "|",
  typeMs = 55,
  deleteMs = 32,
  holdMs = 1600,
  className,
  style,
}: Props) {
  const [index, setIndex] = useState(0);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"type" | "hold" | "delete">("type");

  useEffect(() => {
    if (!texts.length) return;
    const full = texts[index % texts.length];
    let timer: ReturnType<typeof setTimeout>;

    if (phase === "type") {
      if (text.length < full.length) {
        timer = setTimeout(() => setText(full.slice(0, text.length + 1)), typeMs);
      } else {
        timer = setTimeout(() => setPhase("hold"), holdMs);
      }
    } else if (phase === "hold") {
      timer = setTimeout(() => setPhase("delete"), 80);
    } else {
      if (text.length > 0) {
        timer = setTimeout(() => setText(text.slice(0, -1)), deleteMs);
      } else {
        setIndex((i) => (i + 1) % texts.length);
        setPhase("type");
      }
    }

    return () => clearTimeout(timer);
  }, [texts, index, text, phase, typeMs, deleteMs, holdMs]);

  return (
    <span className={className} style={style}>
      {prefix ? <span style={{ color: prefixColor }}>{prefix}</span> : null}
      <span style={{ color: typedColor }}>{text}</span>
      <span
        aria-hidden
        style={{
          color: cursorColor || typedColor,
          marginLeft: 1,
          animation: "pulse-soft 0.9s ease-in-out infinite alternate",
        }}
      >
        {cursorChar}
      </span>
    </span>
  );
}
