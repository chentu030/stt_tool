"use client";

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

/** Flat primary CTA (no shine / motion effects) */
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
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    ...style,
  };

  if (href) {
    return (
      <a
        href={href}
        className={className || "btn"}
        onClick={onClick}
        style={{ ...look, textDecoration: "none" }}
      >
        {children}
      </a>
    );
  }

  return (
    <button
      type={type}
      className={className || "btn"}
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (disabled) return;
        onClick?.();
      }}
      style={look}
    >
      {children}
    </button>
  );
}
