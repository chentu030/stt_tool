"use client";

/**
 * Cadence logo — uses the designer-provided SVGs.
 * - logo-word.svg : mark + Cadence wordmark
 * - logo-mark.svg : mark only
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
  // Aspect: word lockup ~541×118 ≈ 4.58:1 ; mark ~170×172 ≈ 1:1
  const src = showWord ? "/brand/logo-word.svg" : "/brand/logo-mark.svg";
  const width = showWord ? Math.round(height * (541 / 118)) : height;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className}
      src={src}
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
        // Black artwork → light on dark theme
        filter: "var(--logo-filter, none)",
      }}
    />
  );
}
