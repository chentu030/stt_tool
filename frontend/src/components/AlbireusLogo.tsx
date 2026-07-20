"use client";

/**
 * Albireus logo — swan mark from logo_albireus.png; wordmark is text.
 */
export default function AlbireusLogo({
  height = 28,
  showWord = true,
  className = "",
}: {
  height?: number;
  showWord?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`albireus-logo${showWord ? " has-word" : ""} ${className}`.trim()}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: showWord ? "0.45rem" : 0,
        height,
        lineHeight: 1,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/logo-mark.png"
        alt={showWord ? "" : "Albireus"}
        height={height}
        width={height}
        style={{
          height,
          width: height,
          objectFit: "contain",
          display: "block",
          filter: "var(--logo-filter, none)",
          flexShrink: 0,
        }}
      />
      {showWord ? (
        <span
          aria-label="Albireus"
          style={{
            fontFamily: '"Space Grotesk", "Outfit", sans-serif',
            fontWeight: 700,
            fontSize: Math.max(14, Math.round(height * 0.58)),
            letterSpacing: "-0.03em",
            color: "var(--text-main)",
            whiteSpace: "nowrap",
          }}
        >
          Albireus
        </span>
      ) : null}
    </span>
  );
}
