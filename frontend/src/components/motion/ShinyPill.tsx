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
  disabled?: boolean;
};

/** Soft shiny CTA inspired by OriginKit Shiny Pill */
export default function ShinyPill({
  children,
  className,
  style,
  href,
  onClick,
  type = "button",
  disabled,
}: Props) {
  const look: CSSProperties = {
    position: "relative",
    overflow: "hidden",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    ...style,
  };

  const shine = (
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
  );

  if (href) {
    return (
      <motion.a
        href={href}
        className={className || "btn"}
        onClick={onClick}
        whileHover={disabled ? undefined : { scale: 1.03, y: -1 }}
        whileTap={disabled ? undefined : { scale: 0.98 }}
        style={{ ...look, textDecoration: "none" }}
      >
        {shine}
        <span style={{ position: "relative", zIndex: 1 }}>{children}</span>
      </motion.a>
    );
  }

  return (
    <motion.button
      type={type}
      className={className || "btn"}
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (disabled) return;
        onClick?.();
      }}
      whileHover={disabled ? undefined : { scale: 1.03, y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      style={look}
    >
      {shine}
      <span style={{ position: "relative", zIndex: 1 }}>{children}</span>
    </motion.button>
  );
}
