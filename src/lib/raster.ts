import type { BlendMode, Layer, Pt, Stroke } from "../types";

// Canvas stroke engine. Strokes are stored as vector points in inches and drawn
// with Path2D objects cached per stroke, so a pan or zoom never rebuilds geometry.
// Each layer renders into its own scratch surface (so erasers only cut their own
// layer), then composites with its opacity and blend mode.

const pathCache = new WeakMap<Stroke, Path2D>();
const fillCache = new WeakMap<Stroke, Path2D>();
const bboxCache = new WeakMap<Stroke, [number, number, number, number]>();

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function polylinePath(points: Pt[]): Path2D {
  const p = new Path2D();
  if (!points.length) return p;
  p.moveTo(points[0].x, points[0].y);
  if (points.length === 1) {
    p.lineTo(points[0].x + 0.001, points[0].y);
    return p;
  }
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    p.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
  }
  const last = points[points.length - 1];
  p.lineTo(last.x, last.y);
  return p;
}

function taperedPath(points: Pt[], size: number): Path2D {
  const p = new Path2D();
  const n = points.length;
  if (n < 2) {
    const q = points[0];
    if (q) p.arc(q.x, q.y, size * 0.5 * (0.3 + 0.9 * q.p), 0, Math.PI * 2);
    return p;
  }
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
    let dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const taper = Math.min(1, i / 4, (n - 1 - i) / 6) * 0.7 + 0.3;
    const w = size * 0.5 * (0.25 + 0.95 * points[i].p) * taper;
    left.push([points[i].x - dy * w, points[i].y + dx * w]);
    right.push([points[i].x + dy * w, points[i].y - dx * w]);
  }
  const all = [...left, ...right.reverse()];
  p.moveTo(all[0][0], all[0][1]);
  for (let i = 1; i < all.length; i++) p.lineTo(all[i][0], all[i][1]);
  p.closePath();
  return p;
}

function sprayPath(s: Stroke): Path2D {
  const p = new Path2D();
  const rand = rng(s.seed);
  const R = s.size * 1.2;
  for (const q of s.points) {
    const count = Math.round(10 + 22 * q.p);
    for (let k = 0; k < count; k++) {
      const a = rand() * Math.PI * 2;
      const r = R * Math.sqrt(rand()) * (0.5 + q.p * 0.6);
      const dr = s.size * (0.02 + rand() * 0.045);
      const x = q.x + Math.cos(a) * r, y = q.y + Math.sin(a) * r;
      p.moveTo(x + dr, y);
      p.arc(x, y, dr, 0, Math.PI * 2);
    }
  }
  return p;
}

const linePath = (s: Stroke) => {
  let p = pathCache.get(s);
  if (!p) { p = polylinePath(s.points); pathCache.set(s, p); }
  return p;
};

export function strokeBBox(s: Stroke): [number, number, number, number] {
  let b = bboxCache.get(s);
  if (!b) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of s.points) { if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y; if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y; }
    const pad = s.size * 3;
    b = [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
    bboxCache.set(s, b);
  }
  return b;
}

// ---- textures (cached by kind + color) ----
const texCache = new Map<string, HTMLCanvasElement>();
function texture(kind: "grain" | "coarse" | "dots" | "riso", color: string): HTMLCanvasElement {
  const key = `${kind}|${color}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  const N = kind === "dots" || kind === "riso" ? 16 : 64;
  c.width = c.height = N;
  const ctx = c.getContext("2d")!;
  if (kind === "dots" || kind === "riso") {
    ctx.fillStyle = color;
    const r = kind === "riso" ? 5.2 : 4.4;
    for (const [x, y] of [[0, 0], [N, 0], [0, N], [N, N], [N / 2, N / 2]]) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  } else {
    const img = ctx.createImageData(N, N);
    const n = parseInt(color.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const rand = rng(kind === "grain" ? 3 : 9);
    for (let i = 0; i < N * N; i++) {
      const v = rand();
      const a = kind === "grain" ? (v > 0.35 ? 140 + v * 115 : v * 120) : v > 0.55 ? 255 : v * 90;
      img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
  }
  texCache.set(key, c);
  return c;
}

function pattern(ctx: CanvasRenderingContext2D, tex: HTMLCanvasElement, unitsPerTexel: number): CanvasPattern {
  const p = ctx.createPattern(tex, "repeat")!;
  p.setTransform(new DOMMatrix().scale(unitsPerTexel));
  return p;
}

/**
 * Draw one stroke. The context transform maps inches to device pixels;
 * `k` is device pixels per inch (for blur radii and screen-space grain).
 */
export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, k: number) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.globalAlpha = s.opacity;
  const path = () => linePath(s);
  switch (s.style) {
    case "technical":
      ctx.lineWidth = s.size;
      ctx.stroke(path());
      break;
    case "marker":
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = s.opacity * 0.55;
      ctx.lineCap = "square";
      ctx.lineWidth = s.size * 1.4;
      ctx.stroke(path());
      break;
    case "ink": {
      let p = fillCache.get(s);
      if (!p) { p = taperedPath(s.points, s.size); fillCache.set(s, p); }
      ctx.fill(p);
      break;
    }
    case "pencil":
      ctx.strokeStyle = pattern(ctx, texture("grain", s.color), 1 / k);
      ctx.globalAlpha = s.opacity * 0.9;
      ctx.lineWidth = s.size * 0.7;
      ctx.stroke(path());
      break;
    case "charcoal":
      ctx.strokeStyle = pattern(ctx, texture("coarse", s.color), 1.6 / k);
      ctx.globalAlpha = s.opacity * 0.85;
      ctx.lineWidth = s.size * 1.3;
      ctx.stroke(path());
      ctx.globalAlpha = s.opacity * 0.25;
      ctx.filter = `blur(${Math.max(0.5, s.size * 0.25 * k)}px)`;
      ctx.stroke(path());
      break;
    case "spray": {
      let p = fillCache.get(s);
      if (!p) { p = sprayPath(s); fillCache.set(s, p); }
      ctx.fill(p);
      break;
    }
    case "airbrush":
      ctx.filter = `blur(${Math.max(0.5, s.size * 0.35 * k)}px)`;
      ctx.globalAlpha = s.opacity * 0.5;
      ctx.lineWidth = s.size * 1.6;
      ctx.stroke(path());
      break;
    case "neon":
      ctx.shadowColor = s.color;
      ctx.shadowBlur = Math.max(2, s.size * 3 * k);
      ctx.lineWidth = s.size * 1.2;
      ctx.stroke(path());
      ctx.stroke(path());
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#ffffff";
      ctx.globalAlpha = s.opacity * 0.85;
      ctx.lineWidth = s.size * 0.45;
      ctx.stroke(path());
      break;
    case "watercolor":
      ctx.globalCompositeOperation = "multiply";
      ctx.filter = `blur(${Math.max(0.5, s.size * 0.12 * k)}px)`;
      ctx.globalAlpha = s.opacity * 0.3;
      ctx.lineWidth = s.size * 2.2;
      ctx.stroke(path());
      ctx.filter = "none";
      ctx.globalAlpha = s.opacity * 0.22; // pigment pooling at the wet edge
      ctx.lineWidth = s.size * 2.3;
      ctx.stroke(path());
      ctx.globalCompositeOperation = "destination-out";
      ctx.globalAlpha = 0.12;
      ctx.lineWidth = s.size * 1.9;
      ctx.stroke(path());
      ctx.globalCompositeOperation = "multiply";
      ctx.strokeStyle = pattern(ctx, texture("grain", s.color), 1.2 / k);
      ctx.globalAlpha = s.opacity * 0.18;
      ctx.lineWidth = s.size * 2;
      ctx.stroke(path());
      break;
    case "halftone":
      ctx.strokeStyle = pattern(ctx, texture("dots", s.color), 0.07 / 16); // ~14 LPI dot screen at real size
      ctx.lineWidth = s.size * 1.6;
      ctx.stroke(path());
      break;
    case "riso":
      ctx.globalCompositeOperation = "multiply";
      ctx.strokeStyle = pattern(ctx, texture("riso", s.color), 0.1 / 16);
      ctx.globalAlpha = s.opacity * 0.9;
      ctx.lineWidth = s.size * 1.6;
      ctx.stroke(path());
      ctx.translate(s.size * 0.12, s.size * 0.08); // misregistration
      ctx.strokeStyle = s.color;
      ctx.globalAlpha = s.opacity * 0.28;
      ctx.stroke(path());
      break;
    case "chrome": {
      const [x0, y0, , y1] = strokeBBox(s);
      const g = ctx.createLinearGradient(x0, y0, x0, y1);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.32, "#c9d1dc");
      g.addColorStop(0.5, s.color);
      g.addColorStop(0.56, "#2c313a");
      g.addColorStop(0.78, "#e9eef6");
      g.addColorStop(1, "#59606c");
      ctx.strokeStyle = g;
      ctx.lineWidth = s.size * 1.3;
      ctx.stroke(path());
      ctx.translate(0, -s.size * 0.18);
      ctx.strokeStyle = "#ffffff";
      ctx.globalAlpha = s.opacity * 0.7;
      ctx.lineWidth = s.size * 0.18;
      ctx.stroke(path());
      break;
    }
    case "erase":
      ctx.globalCompositeOperation = "destination-out";
      ctx.globalAlpha = 1;
      ctx.lineWidth = s.size * 1.6;
      ctx.stroke(path());
      break;
  }
  ctx.restore();
}

const BLEND: Record<BlendMode, GlobalCompositeOperation> = {
  normal: "source-over",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
};

export interface ViewPaint {
  layers: Layer[]; // bottom to top, already filtered to this view
  strokes: Stroke[]; // this view
  transform: DOMMatrix; // inches -> device px
  clip?: Path2D; // garment outline in inches
}

let scratch: HTMLCanvasElement | null = null;

/** Composite every visible layer of one view onto `target`. */
export function paintView(target: CanvasRenderingContext2D, v: ViewPaint, cull?: { w: number; h: number }) {
  const W = target.canvas.width, H = target.canvas.height;
  if (!scratch) scratch = document.createElement("canvas");
  if (scratch.width !== W || scratch.height !== H) { scratch.width = W; scratch.height = H; }
  const sctx = scratch.getContext("2d")!;
  const k = v.transform.a;
  const byLayer = new Map<string, Stroke[]>();
  for (const s of v.strokes) {
    const arr = byLayer.get(s.layerId);
    arr ? arr.push(s) : byLayer.set(s.layerId, [s]);
  }
  // visible window in inches, for culling
  const inv = v.transform.inverse();
  const tl = inv.transformPoint(new DOMPoint(0, 0));
  const br = inv.transformPoint(new DOMPoint(cull?.w ?? W, cull?.h ?? H));
  for (const layer of v.layers) {
    if (!layer.visible) continue;
    const list = byLayer.get(layer.id);
    if (!list?.length) continue;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, W, H);
    sctx.setTransform(v.transform);
    for (const s of list) {
      const b = strokeBBox(s);
      if (s.style !== "erase" && (b[2] < tl.x || b[0] > br.x || b[3] < tl.y || b[1] > br.y)) continue;
      drawStroke(sctx, s, k);
    }
    target.save();
    if (v.clip) {
      target.setTransform(v.transform);
      target.clip(v.clip);
    }
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalAlpha = layer.opacity;
    target.globalCompositeOperation = BLEND[layer.blend];
    target.drawImage(scratch, 0, 0);
    target.restore();
  }
}

export function garmentClip(body: string, hood?: string): Path2D {
  const p = new Path2D(body);
  if (hood) p.addPath(new Path2D(hood));
  return p;
}

/** Draw strokes onto a layer surface (no clear), skipping strokes outside the visible window. */
export function drawLayerStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], transform: DOMMatrix, W: number, H: number) {
  const k = transform.a;
  const inv = transform.inverse();
  const tl = inv.transformPoint(new DOMPoint(0, 0));
  const br = inv.transformPoint(new DOMPoint(W, H));
  ctx.setTransform(transform);
  for (const s of strokes) {
    const b = strokeBBox(s);
    if (s.style !== "erase" && (b[2] < tl.x || b[0] > br.x || b[3] < tl.y || b[1] > br.y)) continue;
    drawStroke(ctx, s, k);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** Composite one rendered layer surface onto the target with its opacity, blend mode and garment clip. */
export function compositeLayer(target: CanvasRenderingContext2D, surface: HTMLCanvasElement, layer: Layer, transform: DOMMatrix, clip?: Path2D) {
  target.save();
  if (clip) {
    target.setTransform(transform);
    target.clip(clip);
  }
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.globalAlpha = layer.opacity;
  target.globalCompositeOperation = BLEND[layer.blend];
  target.drawImage(surface, 0, 0);
  target.restore();
}
