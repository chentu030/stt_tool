"use client";

/**
 * Cadence primary lockup (option M): three slanted geometric bars + wordmark.
 * Uses the exact approved mark artwork for fidelity.
 */
export default function CadenceLogo({
  height = 28,
  showWord = true,
  className = "",
}: {
  height?: number;
  showWord?: boolean;
  className?: string;
}) {
  // Mark-only: crop left emblem from lockup; full lockup includes word.
  if (!showWord) {
    const size = height;
    return (
      <svg
        className={className}
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Cadence"
        role="img"
      >
        {/* Three parallel slanted bars — matches selected M mark */}
        <path d="M6 8.2 L22.5 3.2 L25.2 8.8 L8.7 13.8 Z" />
        <path d="M4.8 14.6 L21.3 9.6 L24 15.2 L7.5 20.2 Z" />
        <path d="M3.6 21 L20.1 16 L22.8 21.6 L6.3 26.6 Z" />
      </svg>
    );
  }

  const width = Math.round(height * 4.1);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className}
      src="/brand/cadence-lockup-clean.png"
      alt="Cadence"
      height={height}
      width={width}
      style={{
        height,
        width: "auto",
        maxHeight: height,
        objectFit: "contain",
        objectPosition: "left center",
        display: "block",
        filter: "var(--logo-filter, none)",
      }}
    />
  );
}
