"use client";

import ScrambleText from "@/components/motion/ScrambleText";

type Props = {
  /** Shown under the spinner */
  label?: string;
  /** Fill the available main area (default) */
  fill?: boolean;
  className?: string;
};

/**
 * Centered page loader — OriginKit-style orbit + scramble label.
 * Use for auth / route bootstraps instead of corner "載入中…" text.
 */
export default function PageLoading({
  label = "載入中…",
  fill = true,
  className = "",
}: Props) {
  return (
    <div
      className={`page-loading${fill ? " page-loading--fill" : ""} ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="page-loading-orbit" aria-hidden>
        <span className="page-loading-ring" />
        <span className="page-loading-ring page-loading-ring--2" />
        <span className="page-loading-dot page-loading-dot--a" />
        <span className="page-loading-dot page-loading-dot--b" />
        <span className="page-loading-dot page-loading-dot--c" />
        <span className="page-loading-core" />
      </div>
      <ScrambleText words={label} as="p" className="page-loading-label" speed={32} />
    </div>
  );
}
