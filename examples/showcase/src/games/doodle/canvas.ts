/**
 * Stroke rendering shared by the TV and the drawer's phone.
 *
 * Strokes live in a 1000×1000 space; the canvas is scaled to whatever square
 * it occupies. Round caps and joins turn a jittery touch path into something
 * that looks intentional.
 */

import { CANVAS_SIZE, PALETTE, WIDTHS, type Stroke } from "./game.js";

export function paintStrokes(
  context: CanvasRenderingContext2D,
  strokes: readonly Stroke[],
  size: number,
): void {
  const scale = size / CANVAS_SIZE;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const stroke of strokes) paintStroke(context, stroke, scale);
}

export function paintStroke(
  context: CanvasRenderingContext2D,
  stroke: Stroke,
  scale: number,
): void {
  const points = stroke.p;
  if (points.length < 2) return;
  context.strokeStyle = PALETTE[stroke.c] ?? PALETTE[0];
  context.lineWidth = (WIDTHS[stroke.w] ?? WIDTHS[1]) * scale;
  context.beginPath();
  context.moveTo(points[0]! * scale, points[1]! * scale);
  if (points.length === 2) {
    // A tap: draw a dot rather than nothing.
    context.lineTo(points[0]! * scale + 0.01, points[1]! * scale);
  }
  for (let i = 2; i < points.length; i += 2) {
    context.lineTo(points[i]! * scale, points[i + 1]! * scale);
  }
  context.stroke();
}

/** Sizes a canvas to its CSS box at device resolution. Returns the CSS size. */
export function fitCanvas(canvas: HTMLCanvasElement): number {
  const size = Math.floor(Math.min(canvas.clientWidth, canvas.clientHeight) || canvas.clientWidth);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pixels = Math.max(1, Math.floor(size * dpr));
  if (canvas.width !== pixels || canvas.height !== pixels) {
    canvas.width = pixels;
    canvas.height = pixels;
  }
  const context = canvas.getContext("2d");
  context?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return size;
}
