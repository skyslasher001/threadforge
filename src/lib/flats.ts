// Technical flat drawings (black line art) built straight from garment geometry,
// for tech packs: optional measurement callouts and placed artwork.

import type { Design, Units, View } from "../types";
import { buildGarment, type GarmentGeom } from "../data/garments";
import { fmt, gradedSpec } from "../data/measurements";
import { graphicHeight } from "./checks";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

export function technicalFlatSvg(d: Design, view: View, opts: { dims?: boolean; art?: boolean; units?: Units; previews?: Record<string, string> } = {}): { svg: string; w: number; h: number } {
  const m = gradedSpec(d.base, d.grade, d.previewSize);
  const g: GarmentGeom = buildGarment(d.template, view, m, d.parts);
  const pad = opts.dims ? 3.2 : 1.2;
  const x0 = g.bounds.x0 - pad, y0 = g.bounds.y0 - pad, w = g.bounds.x1 - g.bounds.x0 + pad * 2, h = g.bounds.y1 - g.bounds.y0 + pad * 2;
  const ink = "#111114", seam = "#111114", stitch = "#4a4a52", dim = "#2B59C3";
  const parts: string[] = [];
  const path = (dd: string, fill: string, stroke = ink, sw = 0.05, extra = "") => parts.push(`<path d="${dd}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" ${extra}/>`);
  if (g.hood) path(g.hood, "#ffffff");
  path(g.body, "#ffffff");
  g.ribs.forEach((r) => path(r, "#f1f1f3"));
  if (g.hoodInner) path(g.hoodInner, "#e4e4e8");
  if (g.pocket) path(g.pocket, "#ffffff");
  if (opts.art) {
    for (const a of d.graphics.filter((x) => x.view === view && x.visible)) {
      const ah = graphicHeight(a);
      const href = opts.previews?.[a.id] ?? a.src;
      parts.push(`<g transform="translate(${a.x} ${a.y}) rotate(${a.rotation})"><image href="${href}" x="${-a.w / 2}" y="${-ah / 2}" width="${a.w}" height="${ah}" preserveAspectRatio="none"/></g>`);
    }
  }
  g.seams.forEach((s) => path(s, "none", seam, 0.03));
  g.stitches.forEach((s) => path(s, "none", stitch, 0.025, 'stroke-dasharray="0.13 0.08"'));
  g.cords?.forEach((c) => {
    parts.push(`<circle cx="${c.a[0]}" cy="${c.a[1]}" r="0.2" fill="#fff" stroke="${ink}" stroke-width="0.04"/>`);
    parts.push(`<path d="M ${c.a[0]} ${c.a[1]} L ${c.b[0]} ${c.b[1]}" stroke="${ink}" stroke-width="0.05"/>`);
  });
  if (opts.dims) {
    for (const dl of g.dims) {
      if (m[dl.code] === undefined) continue;
      const ang = Math.atan2(dl.b[1] - dl.a[1], dl.b[0] - dl.a[0]);
      const nx = -Math.sin(ang) * 0.3, ny = Math.cos(ang) * 0.3;
      const rot = ((dl.angle % 360) + 360) % 360;
      const up = rot > 90 && rot < 270 ? dl.angle + 180 : dl.angle;
      parts.push(`<path d="M ${dl.a[0]} ${dl.a[1]} L ${dl.b[0]} ${dl.b[1]} M ${dl.a[0] - nx} ${dl.a[1] - ny} L ${dl.a[0] + nx} ${dl.a[1] + ny} M ${dl.b[0] - nx} ${dl.b[1] - ny} L ${dl.b[0] + nx} ${dl.b[1] + ny}" stroke="${dim}" stroke-width="0.05" fill="none"/>`);
      parts.push(`<g transform="translate(${dl.label[0]} ${dl.label[1]}) rotate(${up})"><rect x="-1.9" y="-0.42" width="3.8" height="0.8" rx="0.2" fill="#fff" stroke="${dim}" stroke-width="0.03"/>` +
        `<text x="0" y="0.2" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="0.55" font-weight="700" fill="${dim}">${esc(dl.code)} ${esc(fmt(m[dl.code], opts.units ?? "in", true))}</text></g>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${w} ${h}" width="${w * 40}" height="${h * 40}">${parts.join("")}</svg>`;
  return { svg, w, h };
}

/** Rasterize an SVG string to a PNG data URL at `pxPerUnit`. */
export async function svgToPng(svg: string, wUnits: number, hUnits: number, pxPerUnit = 60, background = "#ffffff"): Promise<string> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Flat render failed"));
      i.src = url;
    });
    const c = document.createElement("canvas");
    c.width = Math.round(wUnits * pxPerUnit);
    c.height = Math.round(hUnits * pxPerUnit);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}
