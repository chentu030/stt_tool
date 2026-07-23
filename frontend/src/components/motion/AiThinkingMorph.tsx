"use client";

import { useEffect, useId, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

const DEFAULT_WORDS = ["思考中", "整理脈絡", "組織回覆", "再想一下", "…"];

type Props = {
  words?: string[];
  intervalMs?: number;
  className?: string;
};

/** Compact gooey word-cycle while the AI rail is thinking (Originkit Text Morph–inspired). */
export default function AiThinkingMorph({
  words = DEFAULT_WORDS,
  intervalMs = 1500,
  className = "",
}: Props) {
  const uid = useId().replace(/:/g, "");
  const filterId = `ai-think-goo-${uid}`;
  const [index, setIndex] = useState(0);
  const list = words.length ? words : DEFAULT_WORDS;

  useEffect(() => {
    setIndex(0);
    const t = window.setInterval(() => {
      setIndex((i) => (i + 1) % list.length);
    }, intervalMs);
    return () => window.clearInterval(t);
  }, [list, intervalMs]);

  const word = list[index % list.length];

  return (
    <div
      className={`ai-thinking-morph ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="AI 思考中"
    >
      <svg className="ai-thinking-morph-svg" width="0" height="0" aria-hidden>
        <defs>
          <filter id={filterId}>
            <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 16 -6"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>
      <span className="ai-thinking-morph-dot" aria-hidden />
      <div className="ai-thinking-morph-stage" style={{ filter: `url(#${filterId})` }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={word}
            className="ai-thinking-morph-word"
            initial={{ opacity: 0, y: 10, filter: "blur(8px)", scale: 0.96 }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)", scale: 1 }}
            exit={{ opacity: 0, y: -10, filter: "blur(8px)", scale: 0.96 }}
            transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
          >
            {word}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );
}
