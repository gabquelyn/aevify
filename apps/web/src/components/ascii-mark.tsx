"use client";

import { useEffect, useRef } from "react";

/**
 * The hero artwork: a 3D "A" (the Aevify mark) drawn entirely from text characters,
 * dissolving at the top into streams of payment data. Inspired by the OKX Build X hero,
 * re-coloured for a light theme: grey glyphs, light-blue highlights on the lit face.
 *
 * How it works:
 * 1. Draw the extruded "A" into a tiny offscreen canvas (one pixel per character cell).
 *    The front face goes in the red channel, the extruded side in the green channel,
 *    each with a brightness gradient that stands in for lighting.
 * 2. Read that back and turn each cell into a glyph: denser glyphs for brighter cells.
 * 3. Add payment-data streams above the shape and scanline streaks to its left.
 * 4. Re-roll a few glyphs on a timer so it feels alive (skipped for reduced motion).
 */

const CELL_W = 7;
const CELL_H = 11;
const FONT = `10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

/** Glyphs ordered from light to dense ink. */
const RAMP = " .·:-=+x*o0D8#@";
const HEX = "0123456789abcdef";
const TOKENS = [
  "0x4a9f", "25.00", "tUSD8", "PAID", "0x7c21", "3.50", "44005", "0xe8b0",
  "settled", "12.75", "0x19d3", "webhook", "0xa04f", "99.00", "refund", "0x5b6e",
  "PAID", "1.20", "tUSD8", "0xd2c4", "agent", "40.00", "0x88f1", "confirmed",
];

/** Colours (RGB) from the Aevify palette. */
const SKY_500: RGB = [14, 165, 233];
const SKY_300: RGB = [125, 211, 252];
const SLATE_300: RGB = [203, 213, 225];
const SLATE_400: RGB = [148, 163, 184];
const SLATE_500: RGB = [100, 116, 139];
const SLATE_700: RGB = [51, 65, 85];

type RGB = [number, number, number];
type Kind = "front" | "side" | "stream" | "scan";
type Cell = { col: number; row: number; kind: Kind; level: number; ch: string; fill: string };

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function rgba([r, g, b]: RGB, alpha: number): string {
  return `rgba(${r | 0},${g | 0},${b | 0},${alpha.toFixed(3)})`;
}

/** Small seeded PRNG so the layout is stable between resizes. */
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Trace the "A" (outer outline plus the triangular counter) in a w x h box. */
function traceA(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const P = (px: number, py: number): [number, number] => [x + px * w, y + py * h];
  const outer = [P(0, 1), P(0.38, 0), P(0.62, 0), P(1, 1), P(0.76, 1), P(0.66, 0.72), P(0.34, 0.72), P(0.24, 1)];
  const counter = [P(0.5, 0.24), P(0.61, 0.56), P(0.39, 0.56)];
  ctx.beginPath();
  for (const poly of [outer, counter]) {
    poly.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.closePath();
  }
}

function buildCells(width: number, height: number): Cell[] {
  const cols = Math.floor(width / CELL_W);
  const rows = Math.floor(height / CELL_H);
  if (cols < 10 || rows < 10) return [];

  const rand = mulberry32(44005);
  const grid: (Cell | null)[] = new Array(cols * rows).fill(null);

  // Geometry in real pixels. The A sits on the right, bleeding off the bottom.
  const aH = height * 0.8;
  const aW = aH * 0.88;
  const aX = width - aW - Math.max(24, width * 0.06);
  const aY = height * 0.16;
  const depth = aW * 0.16;
  const dir = { x: -0.78, y: 0.62 }; // extrude toward lower-left
  const skew = -0.14; // slight lean for a dimensional feel

  // 1. Render the lighting map: one offscreen pixel per character cell.
  const off = document.createElement("canvas");
  off.width = cols;
  off.height = rows;
  const octx = off.getContext("2d", { willReadFrequently: true });
  if (!octx) return [];
  octx.scale(1 / CELL_W, 1 / CELL_H);
  octx.transform(1, 0, skew, 1, -skew * (aY + aH), 0);

  const steps = 28;
  for (let i = steps; i >= 1; i--) {
    const d = (i / steps) * depth;
    const g = 110 + 120 * (1 - i / steps); // nearer slices are brighter
    octx.fillStyle = `rgb(0,${g | 0},0)`;
    traceA(octx, aX + dir.x * d, aY + dir.y * d, aW, aH);
    octx.fill("evenodd");
  }
  const light = octx.createLinearGradient(aX + aW, aY, aX, aY + aH);
  light.addColorStop(0, "rgb(255,0,0)");
  light.addColorStop(0.55, "rgb(150,0,0)");
  light.addColorStop(1, "rgb(70,0,0)");
  octx.fillStyle = light;
  traceA(octx, aX, aY, aW, aH);
  octx.fill("evenodd");

  const { data } = octx.getImageData(0, 0, cols, rows);

  // 2. Turn lit cells into glyphs. The top of the A dissolves away.
  const dissolveStart = aY / CELL_H;
  const dissolveEnd = (aY + aH * 0.3) / CELL_H;
  let shapeTopRow = rows;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = (row * cols + col) * 4;
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const a = (data[i + 3] ?? 0) / 255;
      if (a < 0.12 || (r < 30 && g < 30)) continue;

      if (row < dissolveEnd) {
        const keep = Math.max(0, (row - dissolveStart) / (dissolveEnd - dissolveStart));
        if (rand() > keep * keep + 0.05) continue;
      }

      shapeTopRow = Math.min(shapeTopRow, row);
      const isFront = r >= g;
      // Brightness from the lighting map, plus a little grain so the face isn't flat.
      const t = Math.min(1, Math.max(0, ((isFront ? r : g) / 255) * a + (rand() - 0.5) * 0.18));

      if (isFront) {
        const level = Math.min(RAMP.length - 1, 4 + Math.round(t * 10));
        // Mostly grey; only the most brightly lit area picks up the light-blue accent.
        const color = t > 0.74 ? mix(SKY_300, SKY_500, (t - 0.74) / 0.26) : mix(SLATE_400, SLATE_700, t / 0.74);
        grid[row * cols + col] = {
          col, row, kind: "front", level,
          ch: RAMP[level] ?? "#",
          fill: rgba(color, 0.55 + 0.45 * t),
        };
      } else {
        const level = Math.min(RAMP.length - 1, 2 + Math.round(t * 6));
        grid[row * cols + col] = {
          col, row, kind: "side", level,
          ch: RAMP[level] ?? ":",
          fill: rgba(mix(SLATE_300, SLATE_500, t), 0.45 + 0.4 * t),
        };
      }
    }
  }

  // 3. Payment-data streams rising off the top of the A.
  const streamBottom = Math.min(rows - 1, Math.floor(dissolveEnd));
  const minCol = Math.max(0, Math.floor((aX - aW * 0.15) / CELL_W));
  for (let row = 0; row <= streamBottom; row++) {
    if (rand() > 0.62) continue;
    let col = minCol + Math.floor(rand() * Math.max(1, cols * 0.35));
    const text = Array.from({ length: 4 + Math.floor(rand() * 8) }, () => TOKENS[Math.floor(rand() * TOKENS.length)]).join(" ");
    const fade = 0.12 + 0.5 * (row / Math.max(1, streamBottom));
    for (const ch of text) {
      if (col >= cols) break;
      const idx = row * cols + col;
      if (ch !== " " && !grid[idx]) {
        grid[idx] = { col, row, kind: "stream", level: 0, ch, fill: rgba(SLATE_400, fade * (0.6 + 0.4 * rand())) };
      }
      col++;
    }
  }

  // 4. Scanline streaks trailing off the left edge of the shape.
  for (let row = shapeTopRow; row < rows; row++) {
    if (rand() > 0.14) continue;
    let left = -1;
    for (let col = 0; col < cols; col++) {
      const c = grid[row * cols + col];
      if (c && (c.kind === "front" || c.kind === "side")) {
        left = col;
        break;
      }
    }
    if (left < 2) continue;
    const len = 6 + Math.floor(rand() * 28);
    for (let k = 1; k <= len && left - k >= 0; k++) {
      const idx = row * cols + (left - k);
      if (grid[idx]) continue;
      grid[idx] = {
        col: left - k, row, kind: "scan", level: 0,
        ch: rand() > 0.5 ? "-" : "·",
        fill: rgba(SLATE_300, 0.75 * (1 - k / len)),
      };
    }
  }

  return grid.filter((c): c is Cell => c !== null);
}

function drawCell(ctx: CanvasRenderingContext2D, cell: Cell, clear: boolean) {
  const x = cell.col * CELL_W;
  const y = cell.row * CELL_H;
  if (clear) ctx.clearRect(x, y, CELL_W, CELL_H);
  ctx.fillStyle = cell.fill;
  ctx.fillText(cell.ch, x, y);
}

function rerollGlyph(cell: Cell, rand: () => number) {
  if (cell.kind === "stream") {
    if (/[0-9a-f]/.test(cell.ch)) cell.ch = HEX[Math.floor(rand() * HEX.length)] ?? cell.ch;
    return;
  }
  if (cell.kind === "scan") return;
  const lo = cell.kind === "front" ? 4 : 2;
  const next = Math.min(RAMP.length - 1, Math.max(lo, cell.level + (rand() > 0.5 ? 1 : -1)));
  cell.ch = RAMP[next] ?? cell.ch;
}

export function AsciiMark({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !parent || !ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rand = mulberry32(8);
    let cells: Cell[] = [];
    let visible = true;
    let frame = 0;

    const render = () => {
      const { width, height } = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = FONT;
      ctx.textBaseline = "top";
      ctx.clearRect(0, 0, width, height);
      cells = buildCells(width, height);
      for (const cell of cells) drawCell(ctx, cell, false);
    };

    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(render);
    });
    resizeObserver.observe(parent);

    const visibilityObserver = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    visibilityObserver.observe(canvas);

    const timer = reduceMotion
      ? undefined
      : window.setInterval(() => {
          if (!visible || document.hidden || cells.length === 0) return;
          const count = Math.max(8, Math.floor(cells.length * 0.012));
          for (let i = 0; i < count; i++) {
            const cell = cells[Math.floor(rand() * cells.length)];
            if (!cell) continue;
            rerollGlyph(cell, rand);
            drawCell(ctx, cell, true);
          }
        }, 110);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      if (timer) window.clearInterval(timer);
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
