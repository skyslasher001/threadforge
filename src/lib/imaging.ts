import type { Graphic, ProcessedGraphic } from "../types";
import { DEFAULTS as DIGITIZE_DEFAULTS, digitize, renderStitches, type Digitized } from "./embroidery/digitize";

// Image processing for print and embroidery previews. Runs on downscaled
// copies so it stays well under a second for typical artwork.

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read that image"));
    img.src = src;
  });
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

const hex = (r: number, g: number, b: number) =>
  "#" + ((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1).toUpperCase();

export interface Quantized {
  w: number;
  h: number;
  labels: Int16Array; // -1 = transparent
  centers: [number, number, number][];
  counts: number[];
  opaque: number;
}

export async function quantize(src: string, k: number, maxSide = 520): Promise<Quantized> {
  const img = await loadImage(src);
  const sc = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * sc));
  const h = Math.max(1, Math.round(img.naturalHeight * sc));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;

  const idx: number[] = [];
  for (let i = 0; i < w * h; i++) if (px[i * 4 + 3] > 110) idx.push(i);
  const rand = rng(17 + k);
  const sample = idx.length > 24000 ? Array.from({ length: 24000 }, () => idx[Math.floor(rand() * idx.length)]) : idx;

  // k-means++ seeding
  const centers: [number, number, number][] = [];
  if (sample.length) {
    const first = sample[Math.floor(rand() * sample.length)];
    centers.push([px[first * 4], px[first * 4 + 1], px[first * 4 + 2]]);
    while (centers.length < k) {
      let total = 0;
      const d2 = sample.map((p) => {
        let best = Infinity;
        for (const cc of centers) {
          const dr = px[p * 4] - cc[0], dg = px[p * 4 + 1] - cc[1], db = px[p * 4 + 2] - cc[2];
          best = Math.min(best, dr * dr + dg * dg + db * db);
        }
        total += best;
        return best;
      });
      if (total === 0) break;
      let r = rand() * total;
      let pick = sample[0];
      for (let i = 0; i < sample.length; i++) {
        r -= d2[i];
        if (r <= 0) { pick = sample[i]; break; }
      }
      centers.push([px[pick * 4], px[pick * 4 + 1], px[pick * 4 + 2]]);
    }
    for (let it = 0; it < 10; it++) {
      const acc = centers.map(() => [0, 0, 0, 0]);
      for (const p of sample) {
        const ci = nearest(px[p * 4], px[p * 4 + 1], px[p * 4 + 2], centers);
        acc[ci][0] += px[p * 4]; acc[ci][1] += px[p * 4 + 1]; acc[ci][2] += px[p * 4 + 2]; acc[ci][3]++;
      }
      acc.forEach((a, i) => { if (a[3]) centers[i] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
    }
  }

  const labels = new Int16Array(w * h).fill(-1);
  const counts = centers.map(() => 0);
  for (const p of idx) {
    const ci = nearest(px[p * 4], px[p * 4 + 1], px[p * 4 + 2], centers);
    labels[p] = ci;
    counts[ci]++;
  }
  return { w, h, labels, centers, counts, opaque: idx.length };
}

function nearest(r: number, g: number, b: number, cs: [number, number, number][]) {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < cs.length; i++) {
    const dr = r - cs[i][0], dg = g - cs[i][1], db = b - cs[i][2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}

export async function processGraphic(g: Graphic): Promise<ProcessedGraphic> {
  const key = cacheKey(g);
  if (g.method === "dtg") {
    return { key, preview: g.src, inks: [] };
  }
  const q = await quantize(g.src, Math.max(1, Math.min(10, g.colors)));
  const order = q.counts.map((n, i) => ({ n, i })).filter((o) => o.n > 0).sort((a, b) => b.n - a.n);
  const inks = order.map((o) => ({ hex: hex(...q.centers[o.i]), coverage: o.n / Math.max(1, q.opaque) }));

  if (g.method === "screen") {
    const c = document.createElement("canvas");
    c.width = q.w; c.height = q.h;
    const ctx = c.getContext("2d")!;
    const out = ctx.createImageData(q.w, q.h);
    const rand = rng(99);
    for (let i = 0; i < q.labels.length; i++) {
      const l = q.labels[i];
      if (l < 0) continue;
      const n = (rand() - 0.5) * 10; // ink grain
      out.data[i * 4] = clamp(q.centers[l][0] + n);
      out.data[i * 4 + 1] = clamp(q.centers[l][1] + n);
      out.data[i * 4 + 2] = clamp(q.centers[l][2] + n);
      out.data[i * 4 + 3] = 245;
    }
    ctx.putImageData(out, 0, 0);
    return { key, preview: c.toDataURL("image/png"), inks };
  }

  // Embroidery: run the real digitizer and draw its stitch path.
  const d = await digitizeGraphic(g);
  const hMm = g.w * 25.4 * (g.natH / g.natW);
  const pxPerMm = Math.min(10, 1400 / (g.w * 25.4));
  const c = renderStitches(d, pxPerMm, { wMm: g.w * 25.4, hMm });
  const total = Math.max(1, d.stitchCount);
  return {
    key,
    preview: c.toDataURL("image/png"),
    inks: d.blocks.map((b) => ({ hex: "#" + b.color.toString(16).padStart(6, "0").toUpperCase(), coverage: b.stitches / total })),
    stitches: d.stitchCount,
    stitchMinutes: stitchMinutes(d),
  };
}

/** Machine time at 800 stitches/min plus thread changes and trims. */
export const stitchMinutes = (d: Digitized) => d.stitchCount / 800 + d.colorChanges * 0.5 + d.trims * 0.1;

const digitizedCache = new Map<string, Digitized>();

/** Digitize a placed graphic into machine stitches (cached by artwork, colors and size). */
export async function digitizeGraphic(g: Graphic): Promise<Digitized> {
  const key = `${g.src.length}|${g.colors}|${g.w.toFixed(2)}|${g.name}`;
  const hit = digitizedCache.get(key);
  if (hit) return hit;
  const widthMm = g.w * 25.4;
  const q = await quantize(g.src, Math.max(1, Math.min(12, g.colors)), Math.round(Math.min(900, Math.max(400, widthMm * 3.2))));
  const d = digitize(
    { w: q.w, h: q.h, labels: q.labels, colors: q.centers.map(([r, gg, b]) => (Math.round(r) << 16) | (Math.round(gg) << 8) | Math.round(b)) },
    { ...DIGITIZE_DEFAULTS, widthMm, name: g.name.slice(0, 16) || "THREADFORGE" },
  );
  digitizedCache.set(key, d);
  if (digitizedCache.size > 12) digitizedCache.delete(digitizedCache.keys().next().value!);
  return d;
}

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

export const cacheKey = (g: Graphic) => `${g.id}|${g.method}|${g.colors}|${g.src.length}|${g.method === "embroidery" ? g.w.toFixed(2) : ""}`;

/** Separated film positives on one sheet: one tile per screen, black on white, with registration marks. */
export async function filmSheet(g: Graphic, underbase: boolean): Promise<string> {
  const q = await quantize(g.src, Math.max(1, Math.min(10, g.colors)), 900);
  const order = q.counts.map((n, i) => ({ n, i })).filter((o) => o.n > 0).sort((a, b) => b.n - a.n);
  const films: { name: string; test: (l: number) => boolean }[] = [];
  if (underbase) films.push({ name: "White underbase", test: (l) => l >= 0 });
  order.forEach((o, n) => films.push({ name: `Screen ${n + 1}  ${hex(...q.centers[o.i])}`, test: (l) => l === o.i }));

  const tile = 520, pad = 40, head = 46;
  const cols = Math.min(3, films.length);
  const rows = Math.ceil(films.length / cols);
  const c = document.createElement("canvas");
  c.width = cols * (tile + pad) + pad;
  c.height = rows * (tile + pad + head) + pad + 50;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#000";
  ctx.font = "600 22px Inter, system-ui, sans-serif";
  ctx.fillText(`${g.name} — film positives (${films.length} screens) — print at ${g.w.toFixed(2)} in wide`, pad, 40);

  const sc = Math.min((tile - 60) / q.w, (tile - 60) / q.h);
  films.forEach((film, n) => {
    const col = n % cols, row = Math.floor(n / cols);
    const ox = pad + col * (tile + pad), oy = 60 + pad + row * (tile + pad + head);
    ctx.fillStyle = "#000";
    ctx.font = "600 17px Inter, system-ui, sans-serif";
    ctx.fillText(film.name, ox, oy + 20);
    const ty = oy + head;
    ctx.strokeStyle = "#bbb";
    ctx.strokeRect(ox, ty, tile, tile);
    const img = ctx.createImageData(q.w, q.h);
    for (let i = 0; i < q.labels.length; i++) {
      const on = film.test(q.labels[i]);
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = on ? 0 : 255;
      img.data[i * 4 + 3] = 255;
    }
    const tmp = document.createElement("canvas");
    tmp.width = q.w; tmp.height = q.h;
    tmp.getContext("2d")!.putImageData(img, 0, 0);
    const dw = q.w * sc, dh = q.h * sc;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, ox + (tile - dw) / 2, ty + (tile - dh) / 2, dw, dh);
    // registration marks
    for (const [mx, my] of [[ox + 16, ty + 16], [ox + tile - 16, ty + 16], [ox + 16, ty + tile - 16], [ox + tile - 16, ty + tile - 16]]) {
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(mx, my, 7, 0, Math.PI * 2); ctx.moveTo(mx - 12, my); ctx.lineTo(mx + 12, my); ctx.moveTo(mx, my - 12); ctx.lineTo(mx, my + 12); ctx.stroke();
    }
  });
  return c.toDataURL("image/png");
}

/** Trim transparent / near-white background edges. */
export async function readImageFile(file: File): Promise<{ src: string; w: number; h: number }> {
  const src = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error("Could not read file"));
    r.readAsDataURL(file);
  });
  const img = await loadImage(src);
  // Keep files light: cap long side at 3000 px.
  const max = 3000;
  if (Math.max(img.naturalWidth, img.naturalHeight) <= max) return { src, w: img.naturalWidth, h: img.naturalHeight };
  const sc = max / Math.max(img.naturalWidth, img.naturalHeight);
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * sc);
  c.height = Math.round(img.naturalHeight * sc);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return { src: c.toDataURL("image/png"), w: c.width, h: c.height };
}

/** Remove a flat background color sampled from the corners (simple, fast). */
export async function removeBackground(src: string, tolerance = 38): Promise<string> {
  const img = await loadImage(src);
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const p = d.data;
  const W = c.width, H = c.height;
  const corners = [0, W - 1, (H - 1) * W, H * W - 1];
  let r = 0, g = 0, b = 0;
  corners.forEach((i) => { r += p[i * 4]; g += p[i * 4 + 1]; b += p[i * 4 + 2]; });
  r /= 4; g /= 4; b /= 4;
  // flood fill from edges
  const seen = new Uint8Array(W * H);
  const stack: number[] = [];
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
  const t2 = tolerance * tolerance * 3;
  while (stack.length) {
    const i = stack.pop()!;
    if (seen[i]) continue;
    seen[i] = 1;
    const dr = p[i * 4] - r, dg = p[i * 4 + 1] - g, db = p[i * 4 + 2] - b;
    if (p[i * 4 + 3] < 20 || dr * dr + dg * dg + db * db < t2) {
      p[i * 4 + 3] = 0;
      const x = i % W;
      if (x > 0) stack.push(i - 1);
      if (x < W - 1) stack.push(i + 1);
      if (i >= W) stack.push(i - W);
      if (i < W * (H - 1)) stack.push(i + W);
    }
  }
  ctx.putImageData(d, 0, 0);
  return c.toDataURL("image/png");
}

/** A built-in demo graphic so print prep has something to show on first launch. */
export function demoGraphic(): { src: string; w: number; h: number } {
  const S = 900;
  const OUT = 2400; // print-ready: 300 DPI at 8 in
  const c = document.createElement("canvas");
  c.width = OUT; c.height = OUT;
  const ctx = c.getContext("2d")!;
  ctx.scale(OUT / S, OUT / S);
  const cx = S / 2, cy = S / 2;
  // outer ring
  ctx.fillStyle = "#E0663A";
  ctx.beginPath(); ctx.arc(cx, cy, 420, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#141416";
  ctx.beginPath(); ctx.arc(cx, cy, 370, 0, Math.PI * 2); ctx.fill();
  // sun rays
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = "#F2D16B";
  for (let i = 0; i < 16; i++) {
    ctx.rotate((Math.PI * 2) / 16);
    ctx.beginPath(); ctx.moveTo(-18, -150); ctx.lineTo(0, -330); ctx.lineTo(18, -150); ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = "#F2D16B";
  ctx.beginPath(); ctx.arc(cx, cy, 140, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#E0663A";
  ctx.beginPath(); ctx.arc(cx, cy, 96, 0, Math.PI * 2); ctx.fill();
  // ring text
  ctx.fillStyle = "#F4F1EA";
  ctx.font = "800 54px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const text = "• FORGED IN HEAT • MADE TO LAST ";
  const chars = text.split("");
  ctx.save();
  ctx.translate(cx, cy);
  const step = (Math.PI * 2) / chars.length;
  chars.forEach((ch, i) => {
    ctx.save();
    ctx.rotate(i * step);
    ctx.translate(0, -395);
    ctx.fillStyle = "#141416";
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  });
  ctx.restore();
  return { src: c.toDataURL("image/png"), w: OUT, h: OUT };
}
