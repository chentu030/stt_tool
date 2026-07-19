"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

const GLITCH = "!<>-_\\/[]{}—=+*^?#________";

type Props = {
  words: string;
  as?: "h1" | "h2" | "h3" | "p" | "span";
  className?: string;
  style?: CSSProperties;
  /** ms per reveal step */
  speed?: number;
  color?: string;
};

/** ScrambleText — cinematic character reveal */
export default function ScrambleText({
  words,
  as: Tag = "span",
  className,
  style,
  speed = 28,
  color,
}: Props) {
  const target = words;
  const [display, setDisplay] = useState("");

  const chars = useMemo(() => target.split(""), [target]);

  useEffect(() => {
    let frame = 0;
    let raf = 0;
    let last = 0;
    const total = chars.length;

    const tick = (t: number) => {
      if (!last) last = t;
      if (t - last < speed) {
        raf = requestAnimationFrame(tick);
        return;
      }
      last = t;
      frame += 1;
      const reveal = Math.min(total, Math.floor(frame / 1.2));
      const next = chars
        .map((ch, i) => {
          if (ch === " " || ch === "\n") return ch;
          if (i < reveal) return ch;
          return GLITCH[Math.floor(Math.random() * GLITCH.length)];
        })
        .join("");
      setDisplay(next);
      if (reveal < total) raf = requestAnimationFrame(tick);
      else setDisplay(target);
    };

    setDisplay("");
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [chars, speed, target]);

  return (
    <Tag className={className} style={{ color, ...style }}>
      {display || "\u00A0"}
    </Tag>
  );
}
