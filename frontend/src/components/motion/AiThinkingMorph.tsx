"use client";

import { useEffect, useId, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

const DEFAULT_WORDS = ["思考中", "整理脈絡", "組織回覆", "再想一下", "…"];

type Props = {
  words?: string[];
  intervalMs?: number;
  className?: string;
};

/** Tiny wireframe globe spinner (Originkit Globe–inspired, CSS/SVG only). */
function ThinkingGlobe({ filterId }: { filterId: string }) {
  return (
    <span className="ai-thinking-globe" aria-hidden>
      <svg className="ai-thinking-globe-svg" viewBox="0 0 32 32" width="18" height="18">
        <defs>
          <clipPath id={`${filterId}-clip`}>
            <circle cx="16" cy="16" r="13.2" />
          </clipPath>
          <linearGradient id={`${filterId}-shine`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
            <stop offset="55%" stopColor="var(--accent)" stopOpacity="0.12" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.28" />
          </linearGradient>
        </defs>
        <circle
          cx="16"
          cy="16"
          r="13.2"
          fill={`url(#${filterId}-shine)`}
          stroke="var(--accent)"
          strokeWidth="1.15"
          strokeOpacity="0.85"
        />
        <g clipPath={`url(#${filterId}-clip)`}>
          <g className="ai-thinking-globe-spin">
            {/* Meridians */}
            <ellipse cx="16" cy="16" rx="5" ry="13" fill="none" stroke="var(--accent)" strokeWidth="0.7" strokeOpacity="0.45" />
            <ellipse cx="16" cy="16" rx="9.5" ry="13" fill="none" stroke="var(--accent)" strokeWidth="0.7" strokeOpacity="0.4" />
            <ellipse cx="16" cy="16" rx="13" ry="13" fill="none" stroke="var(--accent)" strokeWidth="0.55" strokeOpacity="0.28" />
            {/* Continents (abstract blobs) */}
            <path
              d="M7 11c2.2-1.4 4.8-1.1 6.4.6 1.2 1.3 2.8 1.6 4.3.9 1.6-.7 3.4-.3 4.6 1.1.8.9 1.1 2.2.5 3.3-1.1 2-3.6 2.6-5.5 1.4-1.4-.9-3.1-.8-4.4.2-1.6 1.2-3.8 1-5.1-.5-1-.9-1.2-2.4-.5-3.5.5-.9 1.6-1.7 2.7-2.1z"
              fill="var(--accent)"
              fillOpacity="0.22"
            />
            <path
              d="M10 21.5c1.6-.4 3.2.1 4.2 1.3.9 1.1 2.4 1.5 3.7 1 1.5-.6 3.2-.2 4.2 1 .6.7.6 1.8 0 2.5-1.4 1.5-3.8 1.4-5.1-.2-.9-1.1-2.5-1.4-3.7-.7-1.4.8-3.2.5-4.3-.7-.7-.8-.7-2.1.1-2.8.7-.6 1.7-.8 2.9-.4z"
              fill="var(--accent)"
              fillOpacity="0.18"
            />
            {/* Duplicate strip for seamless spin feel */}
            <g transform="translate(26 0)">
              <ellipse cx="16" cy="16" rx="5" ry="13" fill="none" stroke="var(--accent)" strokeWidth="0.7" strokeOpacity="0.35" />
              <ellipse cx="16" cy="16" rx="9.5" ry="13" fill="none" stroke="var(--accent)" strokeWidth="0.7" strokeOpacity="0.3" />
              <path
                d="M7 11c2.2-1.4 4.8-1.1 6.4.6 1.2 1.3 2.8 1.6 4.3.9 1.6-.7 3.4-.3 4.6 1.1.8.9 1.1 2.2.5 3.3-1.1 2-3.6 2.6-5.5 1.4-1.4-.9-3.1-.8-4.4.2-1.6 1.2-3.8 1-5.1-.5-1-.9-1.2-2.4-.5-3.5.5-.9 1.6-1.7 2.7-2.1z"
                fill="var(--accent)"
                fillOpacity="0.16"
              />
            </g>
          </g>
          {/* Latitudes stay fixed */}
          <ellipse cx="16" cy="16" rx="13" ry="4.2" fill="none" stroke="var(--accent)" strokeWidth="0.65" strokeOpacity="0.35" />
          <ellipse cx="16" cy="10" rx="11.2" ry="2.6" fill="none" stroke="var(--accent)" strokeWidth="0.55" strokeOpacity="0.28" />
          <ellipse cx="16" cy="22" rx="11.2" ry="2.6" fill="none" stroke="var(--accent)" strokeWidth="0.55" strokeOpacity="0.28" />
        </g>
        <circle cx="11" cy="10" r="2.2" fill="#fff" fillOpacity="0.18" />
      </svg>
    </span>
  );
}

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
      <ThinkingGlobe filterId={filterId} />
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
