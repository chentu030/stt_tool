/**
 * Cadence brand lockup — geometric mark + wordmark (option M).
 * Inspired by Behance logofolio geometry: sharp mark, clean grotesque type.
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
  const markSize = height;
  const wordWidth = showWord ? height * 4.6 : 0;
  const gap = showWord ? height * 0.35 : 0;
  const width = markSize + gap + wordWidth;

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Cadence"
      role="img"
    >
      <defs>
        <linearGradient id="cadenceMarkGrad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#0369A1" />
          <stop offset="45%" stopColor="#0D9488" />
          <stop offset="100%" stopColor="#34D399" />
        </linearGradient>
      </defs>

      {/* Geometric mark: three angled bars forming a C-like cadence emblem */}
      <g transform={`translate(0, 0) scale(${markSize / 32})`}>
        <path
          d="M22 4.5C16.2 2.8 9.8 4.2 6.2 8.6C2.2 13.4 2.4 20.6 6.8 25.2C10.6 29.2 16.4 30.6 21.6 28.8"
          stroke="url(#cadenceMarkGrad)"
          strokeWidth="3.2"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M18.5 10.5H27"
          stroke="url(#cadenceMarkGrad)"
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        <path
          d="M17 16H29"
          stroke="url(#cadenceMarkGrad)"
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        <path
          d="M18.5 21.5H25.5"
          stroke="url(#cadenceMarkGrad)"
          strokeWidth="3.2"
          strokeLinecap="round"
        />
      </g>

      {showWord && (
        <text
          x={markSize + gap}
          y={height * 0.72}
          fill="currentColor"
          fontFamily="'Space Grotesk', 'Outfit', system-ui, sans-serif"
          fontSize={height * 0.62}
          fontWeight="700"
          letterSpacing="-0.04em"
        >
          Cadence
        </text>
      )}
    </svg>
  );
}
