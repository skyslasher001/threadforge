// Brand labels drawn from the Brand Kit: woven neck label, care label and a two-sided hang tag.
// One canvas renderer serves the on-screen previews and the print PDF (actual size, crop marks).

import { jsPDF } from "jspdf";
import type { Design } from "../types";
import { fontOf, type BrandKit } from "../state/brand";
import { isDark } from "../data/fabrics";
import { fabricFor, fiberLabel } from "../data/fabrics";
import { SIZES, TEMPLATES } from "../data/measurements";
import { careText, costSheet } from "./production";
import { loadImage } from "./imaging";

export type LabelKind = "neck" | "care" | "tagFront" | "tagBack";
export const LABELS: Record<LabelKind, { name: string; w: number; h: number }> = {
  neck: { name: "Woven neck label", w: 2, h: 1 },
  care: { name: "Care label", w: 1.25, h: 3 },
  tagFront: { name: "Hang tag · front", w: 2, h: 3.5 },
  tagBack: { name: "Hang tag · back", w: 2, h: 3.5 },
};

export interface LabelData {
  kit: BrandKit;
  size: string;
  fiber: string;
  care: string[];
  style: string;
  garment: string;
  colorway: string;
  sizes: string;
  price: string | null;
}

export function labelData(d: Design, kit: BrandKit): LabelData {
  const inks: Record<string, { inks: number }> = {};
  for (const g of d.graphics) inks[g.id] = { inks: g.colors };
  const cs = costSheet(d, inks);
  const cw = d.colorways.find((c) => c.body === d.bodyColor && c.trim === d.trimColor);
  return {
    kit, size: d.previewSize,
    fiber: fiberLabel(fabricFor(d, d.fabricId)),
    care: careText(d).split("\n").slice(0, 5),
    style: d.name, garment: TEMPLATES[d.template].name,
    colorway: cw?.name ?? d.bodyColor,
    sizes: `${SIZES[0]}–${SIZES[SIZES.length - 1]}`,
    price: cs.missing.length ? null : `$${Math.round(cs.retail)}`,
  };
}

const logoCache = new Map<string, Promise<HTMLImageElement>>();
const logoImg = (src: string) => {
  let p = logoCache.get(src);
  if (!p) { p = loadImage(src); logoCache.set(src, p); }
  return p;
};

/** Logo recolored to one ink (woven labels and tags print a single color). */
async function tintedLogo(src: string, ink: string, w: number, h: number) {
  const img = await logoImg(src);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0, c.width, c.height);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = ink;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

function fitText(g: CanvasRenderingContext2D, text: string, font: (px: number) => string, maxW: number, px: number) {
  let s = px;
  g.font = font(s);
  while (s > 6 && g.measureText(text).width > maxW) { s -= 1; g.font = font(s); }
  return s;
}

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const t = line ? `${line} ${word}` : word;
    if (g.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t;
  }
  if (line) out.push(line);
  return out;
}

/** Simple ISO-style care symbols: wash 30, no bleach, tumble low, cool iron, no dry clean. */
function careSymbols(g: CanvasRenderingContext2D, x: number, y: number, s: number, ink: string) {
  g.save();
  g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = Math.max(1, s * 0.06); g.lineJoin = "round";
  const gap = s * 1.25;
  // wash tub
  g.beginPath(); g.moveTo(x, y + s * 0.25); g.lineTo(x + s * 0.12, y + s); g.lineTo(x + s * 0.88, y + s); g.lineTo(x + s, y + s * 0.25); g.stroke();
  g.beginPath(); g.moveTo(x, y + s * 0.25); g.quadraticCurveTo(x + s * 0.25, y + s * 0.1, x + s * 0.5, y + s * 0.25); g.quadraticCurveTo(x + s * 0.75, y + s * 0.4, x + s, y + s * 0.25); g.stroke();
  g.font = `700 ${s * 0.38}px Inter, sans-serif`; g.textAlign = "center"; g.fillText("30", x + s * 0.5, y + s * 0.8);
  // no bleach
  x += gap;
  g.beginPath(); g.moveTo(x + s * 0.5, y); g.lineTo(x + s, y + s); g.lineTo(x, y + s); g.closePath(); g.stroke();
  g.beginPath(); g.moveTo(x + s * 0.1, y + s * 0.15); g.lineTo(x + s * 0.9, y + s); g.moveTo(x + s * 0.9, y + s * 0.15); g.lineTo(x + s * 0.1, y + s); g.stroke();
  // tumble dry low
  x += gap;
  g.strokeRect(x, y, s, s); g.beginPath(); g.arc(x + s / 2, y + s / 2, s * 0.36, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(x + s / 2, y + s / 2, s * 0.07, 0, Math.PI * 2); g.fill();
  // iron low
  x += gap;
  g.beginPath(); g.moveTo(x, y + s * 0.9); g.lineTo(x + s, y + s * 0.9); g.lineTo(x + s * 0.92, y + s * 0.35); g.lineTo(x + s * 0.3, y + s * 0.35); g.quadraticCurveTo(x + s * 0.05, y + s * 0.5, x, y + s * 0.9); g.stroke();
  g.beginPath(); g.arc(x + s * 0.55, y + s * 0.65, s * 0.06, 0, Math.PI * 2); g.fill();
  // no dry clean
  x += gap;
  g.beginPath(); g.arc(x + s / 2, y + s / 2, s * 0.45, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(x + s * 0.1, y + s * 0.1); g.lineTo(x + s * 0.9, y + s * 0.9); g.moveTo(x + s * 0.9, y + s * 0.1); g.lineTo(x + s * 0.1, y + s * 0.9); g.stroke();
  g.restore();
}

export async function drawLabel(kind: LabelKind, L: LabelData, ppi: number): Promise<HTMLCanvasElement> {
  const spec = LABELS[kind];
  const W = Math.round(spec.w * ppi), H = Math.round(spec.h * ppi);
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const k = L.kit;
  const head = fontOf(k.headingFont), body = fontOf(k.bodyFont);
  const hf = (px: number) => `${head.weight} ${px}px ${head.css}`;
  const bf = (w: number) => (px: number) => `${w} ${px}px ${body.css}`;
  const name = k.name || "Your brand";
  g.textAlign = "center";
  g.textBaseline = "middle";

  const brandMark = async (cx: number, cy: number, maxW: number, maxH: number, ink: string) => {
    if (k.logo && k.logoW && k.logoH) {
      const s = Math.min(maxW / k.logoW, maxH / k.logoH);
      const t = await tintedLogo(k.logo, ink, k.logoW * s, k.logoH * s);
      g.drawImage(t, cx - t.width / 2, cy - t.height / 2);
    } else {
      g.fillStyle = ink;
      fitText(g, name.toUpperCase(), hf, maxW, maxH * 0.7);
      g.fillText(name.toUpperCase(), cx, cy);
    }
  };

  if (kind === "neck") {
    g.fillStyle = k.labelBg; g.fillRect(0, 0, W, H);
    // woven texture
    g.globalAlpha = 0.07; g.fillStyle = isDark(k.labelBg) ? "#fff" : "#000";
    for (let y = 0; y < H; y += Math.max(2, ppi / 60)) g.fillRect(0, y, W, Math.max(1, ppi / 200));
    g.globalAlpha = 1;
    // fold allowance lines (sewn into the seam)
    g.strokeStyle = k.labelInk; g.globalAlpha = 0.25; g.setLineDash([ppi * 0.04, ppi * 0.04]); g.lineWidth = Math.max(1, ppi / 150);
    g.beginPath(); g.moveTo(ppi * 0.25, 0); g.lineTo(ppi * 0.25, H); g.moveTo(W - ppi * 0.25, 0); g.lineTo(W - ppi * 0.25, H); g.stroke();
    g.setLineDash([]); g.globalAlpha = 1;
    await brandMark(W / 2, H * 0.44, W - ppi * 0.7, H * 0.5, k.labelInk);
    g.fillStyle = k.labelInk;
    g.font = bf(700)(H * 0.15);
    g.fillText(L.size, W / 2, H * 0.84);
  } else if (kind === "care") {
    const ink = "#202024";
    g.fillStyle = "#FBFAF6"; g.fillRect(0, 0, W, H);
    let y = ppi * 0.22;
    g.fillStyle = ink;
    fitText(g, name.toUpperCase(), hf, W - ppi * 0.2, ppi * 0.13);
    g.fillText(name.toUpperCase(), W / 2, y);
    y += ppi * 0.2;
    g.font = bf(700)(ppi * 0.1);
    g.fillText(`SIZE ${L.size}`, W / 2, y);
    y += ppi * 0.2;
    g.font = bf(600)(ppi * 0.085);
    for (const line of wrap(g, L.fiber.toUpperCase(), W - ppi * 0.22)) { g.fillText(line, W / 2, y); y += ppi * 0.12; }
    y += ppi * 0.08;
    const s = ppi * 0.16;
    careSymbols(g, (W - (s * 1.25 * 4 + s)) / 2, y, s, ink);
    y += s + ppi * 0.18;
    g.font = bf(500)(ppi * 0.072);
    for (const t of L.care) for (const line of wrap(g, t, W - ppi * 0.22)) { if (y > H - ppi * 0.45) break; g.fillText(line, W / 2, y); y += ppi * 0.1; }
    g.font = bf(700)(ppi * 0.075);
    if (k.madeIn) g.fillText(`MADE IN ${k.madeIn.toUpperCase()}`, W / 2, H - ppi * 0.28);
    if (k.rn) g.fillText(`RN ${k.rn}`, W / 2, H - ppi * 0.15);
  } else if (kind === "tagFront") {
    const bg = k.colors[0]?.hex ?? "#141418";
    const ink = isDark(bg) ? "#F4F1EA" : "#141418";
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    await brandMark(W / 2, H * 0.47, W * 0.72, H * 0.3, ink);
    g.fillStyle = ink;
    if (k.tagline) {
      g.font = bf(500)(ppi * 0.1);
      wrap(g, k.tagline, W * 0.8).slice(0, 2).forEach((line, i) => g.fillText(line, W / 2, H * 0.76 + i * ppi * 0.14));
    }
    if (k.website) { g.font = bf(600)(ppi * 0.08); g.globalAlpha = 0.75; g.fillText(k.website, W / 2, H * 0.92); g.globalAlpha = 1; }
    // string hole
    g.globalCompositeOperation = "destination-out";
    g.beginPath(); g.arc(W / 2, ppi * 0.28, ppi * 0.085, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = "source-over";
  } else {
    const ink = "#16161A";
    g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, W, H);
    const acc = k.colors[0]?.hex ?? "#141418";
    g.fillStyle = acc; g.fillRect(0, H - ppi * 0.12, W, ppi * 0.12);
    let y = ppi * 0.62;
    g.fillStyle = ink;
    fitText(g, name.toUpperCase(), hf, W - ppi * 0.3, ppi * 0.16);
    g.fillText(name.toUpperCase(), W / 2, y);
    y += ppi * 0.45;
    const row = (label: string, value: string) => {
      g.textAlign = "left"; g.fillStyle = "#77777F"; g.font = bf(600)(ppi * 0.065);
      g.fillText(label.toUpperCase(), ppi * 0.2, y);
      g.fillStyle = ink; g.font = bf(600)(ppi * 0.1);
      const line = wrap(g, value, W - ppi * 0.4)[0] ?? "";
      g.fillText(line, ppi * 0.2, y + ppi * 0.14);
      y += ppi * 0.38;
    };
    row("Style", L.style);
    row("Garment", L.garment);
    row("Colorway", L.colorway);
    row("Sizes", L.sizes);
    g.textAlign = "center";
    if (L.price) { g.fillStyle = ink; g.font = hf(ppi * 0.24); g.fillText(L.price, W / 2, H - ppi * 0.62); }
    if (k.website) { g.fillStyle = "#77777F"; g.font = bf(500)(ppi * 0.075); g.fillText(k.website, W / 2, H - ppi * 0.3); }
    g.globalCompositeOperation = "destination-out";
    g.beginPath(); g.arc(W / 2, ppi * 0.28, ppi * 0.085, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = "source-over";
  }
  return c;
}

/** Print sheet: every label at actual size with crop marks, on US Letter. */
export async function labelsPdf(L: LabelData): Promise<Uint8Array> {
  const pdf = new jsPDF({ unit: "in", format: "letter", orientation: "portrait" });
  pdf.setProperties({ title: `${L.kit.name || "Brand"} labels`, creator: "THREADFORGE" });
  pdf.setFont("helvetica", "bold").setFontSize(14).setTextColor(20);
  pdf.text(`${L.kit.name || "Brand"} — labels and hang tag`, 0.5, 0.6);
  pdf.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(110);
  pdf.text("Actual size. Cut on the crop marks. Woven label: weave the artwork in one color; fold allowance 1/4 in each end.", 0.5, 0.82);
  const place: [LabelKind, number, number][] = [["neck", 0.6, 1.3], ["care", 5.6, 1.3], ["tagFront", 0.6, 2.9], ["tagBack", 3.1, 2.9]];
  for (const [kind, x, y] of place) {
    const spec = LABELS[kind];
    const c = await drawLabel(kind, L, 450);
    pdf.addImage(c.toDataURL("image/png"), "PNG", x, y, spec.w, spec.h, undefined, "FAST");
    pdf.setDrawColor(0).setLineWidth(0.006);
    const m = 0.12, gap = 0.04;
    for (const [cx, cy] of [[x, y], [x + spec.w, y], [x, y + spec.h], [x + spec.w, y + spec.h]] as [number, number][]) {
      const sx = cx === x ? -1 : 1, sy = cy === y ? -1 : 1;
      pdf.line(cx + sx * gap, cy, cx + sx * (gap + m), cy);
      pdf.line(cx, cy + sy * gap, cx, cy + sy * (gap + m));
    }
    pdf.setFontSize(7.5).setTextColor(110).text(`${spec.name} · ${spec.w} × ${spec.h} in`, x, y + spec.h + 0.25);
  }
  return new Uint8Array(pdf.output("arraybuffer"));
}
