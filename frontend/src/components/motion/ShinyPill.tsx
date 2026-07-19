"use client";

import { motion } from "motion/react";
import { CSSProperties, ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  href?: string;
  onClick?: () => void;
  type?: "button" | "submit";
};

/** Soft shiny CTA inspired by OriginKit Shiny Pill */
export default function ShinyPill({ children, className, style, href, onClick, type = "button" }: Props) {
  const inner = (
    <motion.span
      className={className || "btn"}
      onClick={href ? undefined : onClick}
      whileHover={{ scale: 1.03, y: -1 }}
      whileTap={{ scale: 0.98 }}
      style={{
        position: "relative",
        overflow: "hidden",
        display: "inline-flex",
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(110deg, transparent 25%, rgba(255,255,255,0.35) 45%, transparent 65%)",
          backgroundSize: "200% 100%",
          animation: "shimmer 2.4s ease-in-out infinite",
          pointerEvents: "none",
        }}
      />
      <span style={{ position: "relative", zIndex: 1 }}>{children}</span>
    </motion.span>
  );

  if (href) {
    return (
      <a href={href} style={{ display: "inline-flex", textDecoration: "none" }} onClick={onClick}>
        {inner}
      </a>
    );
  }

  return (
    <button type={type} onClick={onClick} style={{ border: "none", background: "transparent", padding: 0 }}>
      {inner}
    </button>
  );
}
