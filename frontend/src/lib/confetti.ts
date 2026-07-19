/**
 * Lightweight CSS confetti burst — no external dependency.
 * Fires a handful of colored pieces from the top of the viewport that fall and fade.
 */

const COLORS = ["#0D9488", "#14B8A6", "#0369A1", "#EA580C", "#DB2777", "#7C3AED", "#65A30D"];

export function fireConfetti(pieceCount = 60) {
  if (typeof document === "undefined") return;
  const host = document.createElement("div");
  host.className = "tm-confetti-host";
  document.body.appendChild(host);

  for (let i = 0; i < pieceCount; i++) {
    const piece = document.createElement("span");
    piece.className = "tm-confetti-piece";
    const left = Math.random() * 100;
    const delay = Math.random() * 0.35;
    const duration = 1.6 + Math.random() * 1.1;
    const rotate = Math.random() * 360;
    const drift = (Math.random() - 0.5) * 140;
    const size = 6 + Math.random() * 6;
    const color = COLORS[i % COLORS.length];
    piece.style.left = `${left}vw`;
    piece.style.width = `${size}px`;
    piece.style.height = `${size * 0.4}px`;
    piece.style.background = color;
    piece.style.animationDelay = `${delay}s`;
    piece.style.animationDuration = `${duration}s`;
    piece.style.setProperty("--tm-rotate", `${rotate}deg`);
    piece.style.setProperty("--tm-drift", `${drift}px`);
    host.appendChild(piece);
  }

  setTimeout(() => host.remove(), 3200);
}
