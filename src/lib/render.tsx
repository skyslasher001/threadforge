// Offscreen rendering of any design / colorway / side without touching the stage.
// Used by the colorway matrix, social exports, 3D textures, line sheets and AI renders.

import { renderToStaticMarkup } from "react-dom/server";
import type { Design, Graphic, View } from "../types";
import { buildGarment, type GarmentGeom } from "../data/garments";
import { gradedSpec } from "../data/measurements";
import { fabricFor } from "../data/fabrics";
import { GarmentView } from "../components/Garment";
import { SvgFilters } from "./brushes";
import { graphicHeight } from "./checks";
import { garmentClip, paintView } from "./raster";

export interface RenderOpts {
  view: View;
  body?: string;
  trim?: string;
  pxPerInch?: number;
  background?: string | null; // null = transparent
  margin?: number; // inches around the garment
  previews?: Record<string, string>; // processed decoration previews by graphic id
  stitches?: boolean;
  box?: { x0: number; y0: number; x1: number; y1: number }; // fixed render window in inches (overrides margin)
  shadow?: boolean;
  shading?: number;
  outline?: boolean;
}

export interface Rendered {
  canvas: HTMLCanvasElement;
  geom: GarmentGeom;
  /** inches -> canvas px for this render (garment coordinates) */
  toPx: (x: number, y: number) => [number, number];
}

function graphicEl(g: Graphic, src: string) {
  const h = graphicHeight(g);
  const filter = g.method === "embroidery" ? "url(#tf-shadow)" : g.method === "screen" ? "url(#tf-print)" : undefined;
  return (
    <g key={g.id} transform={`translate(${g.x} ${g.y}) rotate(${g.rotation})`}>
      <image href={src} x={-g.w / 2} y={-h / 2} width={g.w} height={h} preserveAspectRatio="none" filter={filter} opacity={g.method === "dtg" ? 0.93 : g.method === "screen" ? 0.97 : 1} />
    </g>
  );
}

let seq = 0;

export async function renderGarment(d: Design, o: RenderOpts): Promise<Rendered> {
  const k = o.pxPerInch ?? 30;
  const m = gradedSpec(d.base, d.grade, d.previewSize);
  const geom = buildGarment(d.template, o.view, m, d.parts);
  const margin = o.margin ?? 1.5;
  const b = o.box ?? { x0: geom.bounds.x0 - margin, y0: geom.bounds.y0 - margin, x1: geom.bounds.x1 + margin, y1: geom.bounds.y1 + margin };
  const x0 = b.x0, y0 = b.y0, w = b.x1 - b.x0, h = b.y1 - b.y0;
  const uid = `off${++seq}`;
  const graphics = d.graphics.filter((g) => g.view === o.view && g.visible);
  const svg = renderToStaticMarkup(
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`${x0} ${y0} ${w} ${h}`} width={Math.round(w * k)} height={Math.round(h * k)}>
      <SvgFilters />
      <GarmentView uid={uid} geom={geom} fabric={fabricFor(d, d.fabricId)} trimFabric={fabricFor(d, d.trimFabricId)}
        body={o.body ?? d.bodyColor} trim={o.trim ?? d.trimColor} showStitches={o.stitches ?? true}
        shadow={o.shadow ?? true} shading={o.shading ?? 1} outline={o.outline ?? true}>
        {graphics.map((g) => graphicEl(g, g.method === "dtg" ? g.src : o.previews?.[g.id] ?? g.src))}
      </GarmentView>
    </svg>,
  );
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Garment render failed"));
      i.src = url;
    });
    const c = document.createElement("canvas");
    c.width = Math.round(w * k);
    c.height = Math.round(h * k);
    const ctx = c.getContext("2d")!;
    if (o.background) { ctx.fillStyle = o.background; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.drawImage(img, 0, 0, c.width, c.height);
    // drawing layers, clipped to the garment like the stage
    const layer = document.createElement("canvas");
    layer.width = c.width; layer.height = c.height;
    paintView(layer.getContext("2d")!, {
      layers: d.layers.filter((l) => l.view === o.view),
      strokes: d.strokes.filter((s) => s.view === o.view),
      transform: new DOMMatrix([k, 0, 0, k, -x0 * k, -y0 * k]),
      clip: garmentClip(geom.body, geom.hood),
    });
    ctx.drawImage(layer, 0, 0);
    return { canvas: c, geom, toPx: (x, y) => [(x - x0) * k, (y - y0) * k] };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Front and back side by side on one canvas. */
export async function renderPair(d: Design, o: Omit<RenderOpts, "view">, gapIn = 2): Promise<HTMLCanvasElement> {
  const f = await renderGarment(d, { ...o, view: "front" });
  const b = await renderGarment(d, { ...o, view: "back" });
  const k = o.pxPerInch ?? 30;
  const c = document.createElement("canvas");
  c.width = f.canvas.width + b.canvas.width + Math.round(gapIn * k);
  c.height = Math.max(f.canvas.height, b.canvas.height);
  const ctx = c.getContext("2d")!;
  if (o.background) { ctx.fillStyle = o.background; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.drawImage(f.canvas, 0, (c.height - f.canvas.height) / 2);
  ctx.drawImage(b.canvas, f.canvas.width + gapIn * k, (c.height - b.canvas.height) / 2);
  return c;
}

export const toPng = (c: HTMLCanvasElement) => c.toDataURL("image/png");

// ---------------- social and store exports ----------------

export interface SocialFormat { id: string; name: string; w: number; h: number; note: string }
export const SOCIAL: SocialFormat[] = [
  { id: "post", name: "Instagram post", w: 1080, h: 1350, note: "4:5 feed" },
  { id: "square", name: "Square post", w: 1080, h: 1080, note: "1:1" },
  { id: "story", name: "Story / Reel / TikTok", w: 1080, h: 1920, note: "9:16" },
  { id: "product", name: "Store product image", w: 2000, h: 2000, note: "white background" },
];

export interface SocialOpts { format: SocialFormat; background: string; caption: string; brand: string; showBack: boolean; dark: boolean }

/** Compose the garment (front, or front + back) on a branded background at the platform's size. */
export async function socialImage(d: Design, o: SocialOpts, previews: Record<string, string>): Promise<HTMLCanvasElement> {
  const { w, h } = o.format;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = o.background;
  ctx.fillRect(0, 0, w, h);
  if (o.format.id !== "product") {
    const g = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.max(w, h) * 0.7);
    g.addColorStop(0, o.dark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.5)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  const art = o.showBack ? await renderPair(d, { pxPerInch: 40, background: null, previews }, 1) : (await renderGarment(d, { view: "front", pxPerInch: 40, background: null, previews })).canvas;
  const textSpace = o.caption || o.brand ? (o.format.id === "story" ? 380 : 220) : 0;
  const pad = o.format.id === "product" ? 0.06 : 0.08;
  const s = Math.min((w * (1 - pad * 2)) / art.width, (h * (1 - pad * 2) - textSpace) / art.height);
  const aw = art.width * s, ah = art.height * s;
  const ay = (h - textSpace - ah) / 2 + (o.format.id === "story" ? 60 : 0);
  // soft floor shadow
  ctx.save();
  ctx.filter = "blur(24px)";
  ctx.fillStyle = o.dark ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.16)";
  ctx.beginPath();
  ctx.ellipse(w / 2, ay + ah * 0.98, aw * 0.36, 26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.drawImage(art, (w - aw) / 2, ay, aw, ah);
  const ink = o.dark ? "#F4F4F6" : "#141418";
  if (o.brand) {
    ctx.fillStyle = ink;
    ctx.font = `800 ${Math.round(w * 0.028)}px Inter, "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(o.brand.toUpperCase().split("").join(" "), w / 2, h - textSpace + textSpace * 0.42);
  }
  if (o.caption) {
    ctx.fillStyle = o.dark ? "rgba(244,244,246,0.75)" : "rgba(20,20,24,0.7)";
    ctx.font = `500 ${Math.round(w * 0.034)}px Inter, "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(o.caption, w / 2, h - textSpace + textSpace * (o.brand ? 0.72 : 0.5));
  }
  return c;
}
