"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

const DEFAULT_WORDS = ["思考中…", "整理脈絡…", "組織回覆…", "再想一下…", "幾乎完成…"];

type Props = {
  words?: string[];
  intervalMs?: number;
  className?: string;
};

/** Orbiting spark — cooler than a tiny globe, CSS-only. */
function ThinkingOrb() {
  return (
    <span className="ai-thinking-orb" aria-hidden>
      <span className="ai-thinking-orb-ring ai-thinking-orb-ring--a" />
      <span className="ai-thinking-orb-ring ai-thinking-orb-ring--b" />
      <span className="ai-thinking-orb-core">
        <span className="ai-thinking-orb-spark" />
      </span>
      <span className="ai-thinking-orb-dot ai-thinking-orb-dot--1" />
      <span className="ai-thinking-orb-dot ai-thinking-orb-dot--2" />
      <span className="ai-thinking-orb-dot ai-thinking-orb-dot--3" />
    </span>
  );
}

/** Word-cycle while the AI rail is thinking. */
export default function AiThinkingMorph({
  words = DEFAULT_WORDS,
  intervalMs = 1600,
  className = "",
}: Props) {
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
      aria-label={word}
    >
      <ThinkingOrb />
      <div className="ai-thinking-morph-stage">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={word}
            className="ai-thinking-morph-word"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            {word}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );
}
