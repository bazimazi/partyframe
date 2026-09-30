/**
 * Confetti for the shared screen.
 *
 * A fixed, pointer-transparent canvas that bursts once when `active` turns
 * true and cleans itself up when the particles have fallen out of view. Pure
 * canvas, no dependency, and nothing at all when the viewer prefers reduced
 * motion.
 */

import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  spin: number;
  width: number;
  height: number;
  color: string;
}

const DEFAULT_COLORS = [
  "#ff5d5d",
  "#ffb020",
  "#ffe14d",
  "#54d66a",
  "#3fc7d4",
  "#5b8cff",
  "#b579ff",
  "#ff6fc4",
];

export function Confetti({
  active,
  colors = DEFAULT_COLORS,
  count = 180,
  durationMs = 4500,
}: {
  active: boolean;
  colors?: readonly string[];
  count?: number;
  durationMs?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!active || !canvas) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    const width = () => canvas.width / dpr;
    const particles: Particle[] = Array.from({ length: count }, (_, i) => {
      const fromLeft = i % 2 === 0;
      return {
        x: fromLeft ? -10 : width() + 10,
        y: window.innerHeight * (0.35 + Math.random() * 0.3),
        vx: (fromLeft ? 1 : -1) * (6 + Math.random() * 9),
        vy: -(9 + Math.random() * 9),
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.3,
        width: 6 + Math.random() * 6,
        height: 8 + Math.random() * 10,
        color: colors[Math.floor(Math.random() * colors.length)] ?? "#ffffff",
      };
    });

    const started = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const elapsed = now - started;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width(), canvas.height / dpr);
      let alive = false;
      for (const p of particles) {
        p.vy += 0.35;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.spin;
        if (p.y < canvas.height / dpr + 20) alive = true;
        context.save();
        context.translate(p.x, p.y);
        context.rotate(p.rotation);
        context.fillStyle = p.color;
        context.globalAlpha =
          elapsed > durationMs - 800 ? Math.max(0, (durationMs - elapsed) / 800) : 1;
        context.fillRect(-p.width / 2, -p.height / 2, p.width, p.height);
        context.restore();
      }
      if (alive && elapsed < durationMs) {
        frame = requestAnimationFrame(step);
      } else {
        context.clearRect(0, 0, width(), canvas.height / dpr);
      }
    };
    frame = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      context.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [active, colors, count, durationMs]);

  return <canvas ref={canvasRef} className="confetti" aria-hidden="true" />;
}
