// Wholesale line sheet PDF: cover, style cards (renders, fabric, sizes, colorways, prices) and an order form.

import { jsPDF } from "jspdf";
import type { Design, ProcessedGraphic } from "../types";
import { SIZES, TEMPLATES } from "../data/measurements";
import { fabricFor, fiberLabel } from "../data/fabrics";
import { costSheet, techpackOf } from "./production";
import { processGraphic } from "./imaging";
import { renderGarment } from "./render";
import { previewsOf } from "../state/showcase";
import { brandKit, brandName, fontOf, logoOn } from "../state/brand";
import { isDark } from "../data/fabrics";
import { loadImage } from "./imaging";

const W = 11, H = 8.5, M = 0.5;
const INK: [number, number, number] = [20, 20, 24];
const SOFT: [number, number, number] = [110, 110, 120];

export interface SheetStyle { design: Design; processed: Record<string, ProcessedGraphic> }
export interface SheetOpts { perPage: 2 | 4 | 6; showBack: boolean; prices: boolean }

export interface StyleFacts {
  name: string; styleNo: string; garment: string; fabric: string; sizes: string; decoration: string;
  wholesale: number | null; retail: number | null; colorways: { name: string; body: string; trim: string }[];
}

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Fill in processed previews for a design opened from a file (screen separations, embroidery). */
export async function processAll(d: Design, have: Record<string, ProcessedGraphic> = {}): Promise<Record<string, ProcessedGraphic>> {
  const out = { ...have };
  for (const g of d.graphics) if (!out[g.id] && g.method !== "dtg") out[g.id] = await processGraphic(g).catch(() => undefined as unknown as ProcessedGraphic);
  return out;
}

export function styleFacts(s: SheetStyle): StyleFacts {
  const d = s.design;
  const tp = techpackOf(d);
  const fab = fabricFor(d, d.fabricId);
  const inks: Record<string, { inks: number; stitches?: number }> = {};
  for (const g of d.graphics) inks[g.id] = { inks: s.processed[g.id]?.inks.length ?? g.colors, stitches: s.processed[g.id]?.stitches };
  const cs = costSheet(d, inks);
  const methods = [...new Set(d.graphics.filter((g) => g.visible).map((g) => (g.method === "screen" ? "Screen print" : g.method === "embroidery" ? "Embroidery" : "DTG")))];
  const cws = d.colorways.length ? d.colorways : [{ id: "x", name: "Main", body: d.bodyColor, trim: d.trimColor }];
  return {
    name: d.name,
    styleNo: tp.styleNumber,
    garment: TEMPLATES[d.template].name,
    fabric: `${fab.name}, ${fab.gsm} GSM, ${fiberLabel(fab)}`,
    sizes: `${SIZES[0]}–${SIZES[SIZES.length - 1]}`,
    decoration: methods.join(" + ") || "Blank",
    // only quote a price once the costing is complete; a partial cost would under-price the style
    wholesale: cs.missing.length ? null : cs.wholesale,
    retail: cs.missing.length ? null : cs.retail,
    colorways: cws.map((c) => ({ name: c.name, body: c.body, trim: c.trim })),
  };
}

async function png(d: Design, processed: Record<string, ProcessedGraphic>, view: "front" | "back", k: number) {
  const r = await renderGarment(d, { view, pxPerInch: k, background: "#FFFFFF", previews: previewsOf(d, processed), shadow: false });
  return { url: r.canvas.toDataURL("image/jpeg", 0.92), w: r.canvas.width, h: r.canvas.height };
}

function footer(pdf: jsPDF, brand: string, season: string, page: number, total: number) {
  pdf.setFont("helvetica", "normal").setFontSize(8).setTextColor(...SOFT);
  pdf.text([brand, season, "Line sheet"].filter(Boolean).join("  ·  "), M, H - 0.3);
  pdf.text(`${page} / ${total}`, W - M, H - 0.3, { align: "right" });
}

const fit = (w: number, h: number, bw: number, bh: number) => { const s = Math.min(bw / w, bh / h); return { w: w * s, h: h * s }; };

export async function buildLineSheet(styles: SheetStyle[], o: SheetOpts, onProgress?: (p: number) => void): Promise<Uint8Array> {
  if (!styles.length) throw new Error("Add at least one style");
  const lead = techpackOf(styles[0].design);
  const brand = brandName(styles[0].design);
  const kit = brandKit();
  const pdfFont = fontOf(kit.headingFont).pdf;
  const coverBg = kit.colors[0]?.hex ?? "#111114";
  const logoAt = async (bg: string) => {
    const url = await logoOn(bg, kit).catch(() => null);
    return url ? await loadImage(url).then((img) => ({ url, w: img.naturalWidth, h: img.naturalHeight })).catch(() => null) : null;
  };
  const coverLogo = await logoAt(coverBg);
  const logo = await logoAt("#FFFFFF");
  const season = lead.season;
  const pdf = new jsPDF({ unit: "in", format: "letter", orientation: "landscape", compress: true });
  pdf.setProperties({ title: `${brand || "Line"} sheet${season ? " " + season : ""}`, creator: "THREADFORGE" });
  const pages = Math.ceil(styles.length / o.perPage);
  const total = 1 + pages + 1;

  // ---- cover ----
  pdf.setFillColor(...rgb(coverBg)).rect(0, 0, W, H, "F");
  const coverInk: [number, number, number] = isDark(coverBg) ? [255, 255, 255] : [20, 20, 24];
  const coverSoft: [number, number, number] = isDark(coverBg) ? [190, 190, 196] : [80, 80, 90];
  const hero = await png(styles[0].design, styles[0].processed, "front", 40);
  const hf = fit(hero.w, hero.h, 5.2, 6.2);
  pdf.setFillColor(255, 255, 255).roundedRect(W - M - 5.6, (H - 6.6) / 2, 5.6, 6.6, 0.12, 0.12, "F");
  pdf.addImage(hero.url, "JPEG", W - M - 2.8 - hf.w / 2, H / 2 - hf.h / 2, hf.w, hf.h);
  if (coverLogo) {
    const lf = fit(coverLogo.w, coverLogo.h, 3.2, 0.8);
    pdf.addImage(coverLogo.url, "PNG", M + 0.1, 0.9, lf.w, lf.h);
  }
  pdf.setTextColor(...coverInk).setFont(pdfFont, "bold").setFontSize(40);
  pdf.text(pdf.splitTextToSize((brand || "Collection").toUpperCase(), 4.4), M + 0.1, 2.4);
  pdf.setFont("helvetica", "normal").setFontSize(16).setTextColor(...coverSoft);
  pdf.text([season, "Line sheet"].filter(Boolean).join("  ·  "), M + 0.1, 3.5);
  if (kit.tagline) pdf.setFontSize(12).text(pdf.splitTextToSize(kit.tagline, 4.4), M + 0.1, 3.85);
  pdf.setFontSize(11).setTextColor(...coverSoft);
  pdf.text(`${styles.length} style${styles.length === 1 ? "" : "s"}  ·  ${styles.reduce((n, s) => n + Math.max(1, s.design.colorways.length), 0)} colorways`, M + 0.1, 4.5);
  pdf.text(new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }), M + 0.1, 4.8);
  if (kit.website) pdf.text(kit.website, M + 0.1, 5.1);
  pdf.setFontSize(8).text(`1 / ${total}`, W - M, H - 0.3, { align: "right" });

  // ---- style pages ----
  const cols = o.perPage === 2 ? 2 : o.perPage === 4 ? 2 : 3;
  const rows = o.perPage === 2 ? 1 : 2;
  const gx = 0.3, gy = 0.3, top = 0.95;
  const cw = (W - M * 2 - gx * (cols - 1)) / cols;
  const ch = (H - top - 0.6 - gy * (rows - 1)) / rows;
  let done = 0;
  for (let p = 0; p < pages; p++) {
    pdf.addPage("letter", "landscape");
    pdf.setFont(pdfFont, "bold").setFontSize(15).setTextColor(...INK);
    pdf.text(brand ? `${brand} — ${season || "Styles"}` : season || "Styles", M, 0.62);
    if (logo) { const lf = fit(logo.w, logo.h, 1.2, 0.4); pdf.addImage(logo.url, "PNG", W - M - lf.w, 0.3, lf.w, lf.h); }
    for (let i = 0; i < o.perPage; i++) {
      const s = styles[p * o.perPage + i];
      if (!s) break;
      const f = styleFacts(s);
      const x = M + (i % cols) * (cw + gx), y = top + Math.floor(i / cols) * (ch + gy);
      pdf.setDrawColor(225).setLineWidth(0.01).roundedRect(x, y, cw, ch, 0.08, 0.08, "S");
      // image area
      const textH = rows === 1 ? 1.9 : 1.55;
      const ih = ch - textH - 0.2;
      const front = await png(s.design, s.processed, "front", rows === 1 ? 44 : 30);
      if (o.showBack) {
        const back = await png(s.design, s.processed, "back", rows === 1 ? 44 : 30);
        const fw = fit(front.w, front.h, cw * 0.62 - 0.2, ih), bw = fit(back.w, back.h, cw * 0.38 - 0.2, ih * 0.62);
        pdf.addImage(front.url, "JPEG", x + 0.12, y + 0.12 + (ih - fw.h) / 2, fw.w, fw.h);
        pdf.addImage(back.url, "JPEG", x + cw - 0.12 - bw.w, y + 0.12 + ih - bw.h, bw.w, bw.h);
        pdf.setFontSize(6.5).setTextColor(...SOFT).text("BACK", x + cw - 0.12 - bw.w / 2, y + 0.12 + ih - bw.h - 0.06, { align: "center" });
      } else {
        const fw = fit(front.w, front.h, cw - 0.24, ih);
        pdf.addImage(front.url, "JPEG", x + (cw - fw.w) / 2, y + 0.12 + (ih - fw.h) / 2, fw.w, fw.h);
      }
      // text block
      let ty = y + ch - textH + 0.12;
      pdf.setDrawColor(235).line(x + 0.12, ty - 0.1, x + cw - 0.12, ty - 0.1);
      pdf.setFont("helvetica", "bold").setFontSize(rows === 1 ? 13 : 11).setTextColor(...INK);
      pdf.text(pdf.splitTextToSize(f.name, cw - 1.6)[0], x + 0.15, ty + 0.12);
      if (o.prices && f.wholesale !== null) {
        pdf.text(`$${f.wholesale.toFixed(2)}`, x + cw - 0.15, ty + 0.12, { align: "right" });
        pdf.setFont("helvetica", "normal").setFontSize(7).setTextColor(...SOFT);
        pdf.text(`WHOLESALE · MSRP $${f.retail!.toFixed(0)}`, x + cw - 0.15, ty + 0.3, { align: "right" });
      }
      pdf.setFont("helvetica", "normal").setFontSize(rows === 1 ? 8.5 : 7.5).setTextColor(...SOFT);
      ty += 0.3;
      const lines = [
        [f.styleNo ? `Style ${f.styleNo}` : "", f.garment].filter(Boolean).join("  ·  "),
        f.fabric,
        `Sizes ${f.sizes}  ·  ${f.decoration}`,
      ];
      for (const l of lines) { pdf.text(pdf.splitTextToSize(l, cw - 0.3)[0], x + 0.15, ty); ty += rows === 1 ? 0.19 : 0.16; }
      // colorway swatches
      ty += 0.04;
      let sx = x + 0.15;
      for (const c of f.colorways.slice(0, rows === 1 ? 8 : cols === 3 ? 4 : 6)) {
        pdf.setFillColor(...rgb(c.body)).rect(sx, ty, 0.18, 0.18, "F");
        pdf.setFillColor(...rgb(c.trim)).rect(sx, ty + 0.13, 0.18, 0.05, "F");
        pdf.setDrawColor(200).rect(sx, ty, 0.18, 0.18, "S");
        pdf.setFontSize(6.5).setTextColor(...INK);
        const label = pdf.splitTextToSize(c.name, 0.62)[0];
        pdf.text(label, sx + 0.23, ty + 0.13);
        sx += 0.23 + Math.min(0.62, pdf.getTextWidth(label)) + 0.14;
        if (sx > x + cw - 0.6) break;
      }
      done++;
      onProgress?.(done / styles.length);
    }
    footer(pdf, brand, season, 2 + p, total);
  }

  // ---- order form ----
  pdf.addPage("letter", "landscape");
  pdf.setFont("helvetica", "bold").setFontSize(15).setTextColor(...INK).text("Order form", M, 0.62);
  pdf.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...SOFT);
  pdf.text("Account ______________________    Buyer ______________________    Ship by ____________    PO # ____________", M, 0.95);
  const colsW = [2.5, 1.6, ...SIZES.map(() => 0.48), 0.6, 0.85, 0.85];
  const heads = ["Style", "Colorway", ...SIZES, "Units", "Wholesale", "Total"];
  let y = 1.35;
  const row = (cells: string[], bold = false) => {
    let x = M;
    pdf.setFont("helvetica", bold ? "bold" : "normal").setFontSize(8).setTextColor(...(bold ? SOFT : INK));
    cells.forEach((c, i) => {
      pdf.text(pdf.splitTextToSize(c, colsW[i] - 0.08)[0] ?? "", i >= 2 ? x + colsW[i] / 2 : x + 0.05, y, { align: i >= 2 ? "center" : "left" });
      x += colsW[i];
    });
    pdf.setDrawColor(215).setLineWidth(0.008).line(M, y + 0.09, M + colsW.reduce((a, b) => a + b, 0), y + 0.09);
    y += 0.28;
  };
  row(heads, true);
  outer: for (const s of styles) {
    const f = styleFacts(s);
    for (const c of f.colorways) {
      if (y > H - 0.8) break outer;
      row([f.name, c.name, ...SIZES.map(() => ""), "", o.prices && f.wholesale !== null ? `$${f.wholesale.toFixed(2)}` : "", ""]);
    }
  }
  footer(pdf, brand, season, total, total);
  return new Uint8Array(pdf.output("arraybuffer"));
}
