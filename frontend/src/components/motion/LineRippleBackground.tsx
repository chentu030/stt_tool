"use client";

import { useEffect, useRef, type CSSProperties } from "react";

type Props = {
  count?: number;
  movement?: number;
  resolution?: number;
  hover?: boolean;
  force?: number;
  strokeColor?: string;
  backgroundColor?: string;
  className?: string;
  style?: CSSProperties;
};

/** OriginKit-inspired Line Ripple Background — cursor-reactive flow field */
export default function LineRippleBackground({
  count = 48,
  movement = 22,
  resolution = 14,
  hover = true,
  force = 3.5,
  strokeColor = "rgba(20, 184, 166, 0.35)",
  backgroundColor = "transparent",
  className,
  style,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouse = useRef({ x: -9999, y: -9999 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let raf = 0;
    let t = 0;

    const lines = Array.from({ length: count }, () => ({
      x: Math.random(),
      y: Math.random(),
      phase: Math.random() * Math.PI * 2,
    }));

    const resize = () => {
      const parent = canvas.parentElement;
      w = parent?.clientWidth || window.innerWidth;
      h = parent?.clientHeight || window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const onLeave = () => {
      mouse.current = { x: -9999, y: -9999 };
    };

    const noise = (x: number, y: number) => {
      return Math.sin(x * 1.7 + t) * Math.cos(y * 1.3 - t * 0.7);
    };

    const draw = () => {
      t += movement * 0.00035;
      ctx.clearRect(0, 0, w, h);
      if (backgroundColor !== "transparent") {
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.1;
      ctx.lineCap = "round";

      for (const line of lines) {
        let x = line.x * w;
        let y = line.y * h;
        const angle = noise(line.x * 4 + line.phase, line.y * 4) * Math.PI;
        let dx = Math.cos(angle);
        let dy = Math.sin(angle);

        if (hover) {
          const mx = mouse.current.x - x;
          const my = mouse.current.y - y;
          const dist = Math.hypot(mx, my) || 1;
          if (dist < 140) {
            const push = ((140 - dist) / 140) * force * 0.08;
            dx += (mx / dist) * push;
            dy += (my / dist) * push;
          }
        }

        const len = resolution * 1.8;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + dx * len, y + dy * len);
        ctx.stroke();

        line.x = (line.x + dx * 0.0012 + 1) % 1;
        line.y = (line.y + dy * 0.0012 + 1) % 1;
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener("resize", resize);
    if (hover) {
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerleave", onLeave);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, [count, movement, resolution, hover, force, strokeColor, backgroundColor]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: hover ? "auto" : "none",
        ...style,
      }}
    />
  );
}
