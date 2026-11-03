// Factory tech pack PDF, assembled from the design data. Landscape letter, inches.

import { jsPDF } from "jspdf";
import type { Design, ProcessedGraphic, Units } from "../types";
import { POMS, SIZES, TEMPLATES, fmt, gradedSpec } from "../data/measurements";
import { fabricFor, fiberLabel, ozPerSqYd } from "../data/fabrics";
import { graphicHeight } from "./checks";
import { technicalFlatSvg, svgToPng } from "./flats";
import { INKS, costSheet, hoopFor, printOrder, techpackOf } from "./production";
import { digitizeGraphic, stitchMinutes } from "./imaging";

const W = 11, H = 8.5, M = 0.5;
const ACCENT: [number, number, number] = [43, 89, 195];

const money = (v: number) => `$${v.toFixed(2)}`;
const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

interface Ctx { pdf: jsPDF; d: Design; title: string; pageTitles: string[] }

function header(c: Ctx, page: string) {
  const { pdf, d } = c;
  const tp = techpackOf(d);
  pdf.setFillColor(17, 17, 20).rect(0, 0, W, 0.62, "F");
  pdf.setTextColor(255).setFont("helvetica", "bold").setFontSize(13).text(d.name, M, 0.4);
  pdf.setFont("helvetica", "normal").setFontSize(9).setTextColor(190);
  const meta = [tp.brand, tp.styleNumber && `Style ${tp.styleNumber}`, tp.season, `Rev ${tp.revision || "A"}`].filter(Boolean).join("  ·  ");
  pdf.text(meta, W - M, 0.4, { align: "right" });
  pdf.setTextColor(...ACCENT).setFont("helvetica", "bold").setFontSize(15).text(page, M, 1.05);
  pdf.setTextColor(20);
  c.pageTitles.push(page);
}

function table(pdf: jsPDF, x: number, y: number, cols: { h: string; w: number; align?: "left" | "right" }[], rows: string[][], opts: { size?: number; rowH?: number; zebra?: boolean; highlightCol?: number } = {}) {
  const size = opts.size ?? 8.5, rh = opts.rowH ?? 0.24;
  pdf.setFontSize(size).setFont("helvetica", "bold").setTextColor(90);
  let cx = x;
  for (const col of cols) {
    pdf.text(col.h, col.align === "right" ? cx + col.w - 0.05 : cx + 0.05, y, { align: col.align === "right" ? "right" : "left" });
    cx += col.w;
  }
  const total = cols.reduce((s, c) => s + c.w, 0);
  pdf.setDrawColor(200).setLineWidth(0.01).line(x, y + 0.07, x + total, y + 0.07);
  pdf.setFont("helvetica", "normal").setTextColor(20);
  let yy = y + rh;
  rows.forEach((r, ri) => {
    if (opts.zebra && ri % 2 === 1) pdf.setFillColor(246, 246, 248).rect(x, yy - rh + 0.08, total, rh, "F");
    if (opts.highlightCol !== undefined) {
      const hx = x + cols.slice(0, opts.highlightCol).reduce((s, c) => s + c.w, 0);
      pdf.setFillColor(232, 238, 252).rect(hx, yy - rh + 0.08, cols[opts.highlightCol].w, rh, "F");
    }
    let cx2 = x;
    r.forEach((cell, i) => {
      const col = cols[i];
      const txt = pdf.splitTextToSize(cell ?? "", col.w - 0.1)[0] ?? "";
      pdf.text(txt, col.align === "right" ? cx2 + col.w - 0.05 : cx2 + 0.05, yy, { align: col.align === "right" ? "right" : "left" });
      cx2 += col.w;
    });
    yy += rh;
  });
  return yy;
}

function paragraph(pdf: jsPDF, title: string, body: string, x: number, y: number, w: number) {
  pdf.setFont("helvetica", "bold").setFontSize(10).setTextColor(20).text(title, x, y);
  pdf.setFont("helvetica", "normal").setFontSize(9).setTextColor(50);
  const lines = pdf.splitTextToSize(body || "—", w);
  pdf.text(lines, x, y + 0.24);
  return y + 0.24 + lines.length * 0.16 + 0.25;
}

export async function buildTechPack(d: Design, mockupPng: string | null, processed: Record<string, ProcessedGraphic>, units: Units): Promise<Uint8Array> {
  const pdf = new jsPDF({ unit: "in", format: "letter", orientation: "landscape", compress: true });
  const c: Ctx = { pdf, d, title: d.name, pageTitles: [] };
  const tp = techpackOf(d);
  const t = TEMPLATES[d.template];
  const fab = fabricFor(d, d.fabricId);
  const previews: Record<string, string> = {};
  for (const g of d.graphics) previews[g.id] = g.method === "dtg" ? g.src : processed[g.id]?.preview ?? g.src;

  // 1 — Cover
  header(c, "Overview");
  if (mockupPng) {
    const img = await new Promise<HTMLImageElement>((r) => { const i = new Image(); i.onload = () => r(i); i.src = mockupPng; });
    const maxW = 6.3, maxH = 6.2;
    const k = Math.min(maxW / img.width, maxH / img.height);
    pdf.addImage(mockupPng, "PNG", M, 1.35, img.width * k, img.height * k, undefined, "FAST");
  }
  const parts = d.parts;
  const info: [string, string][] = [
    ["Style name", d.name], ["Style number", tp.styleNumber || "—"], ["Season", tp.season || "—"], ["Brand", tp.brand || "—"], ["Designer", tp.designer || "—"],
    ["Garment", t.name], ["Fit", parts.fit[0].toUpperCase() + parts.fit.slice(1)],
    ["Neckline / sleeve", `${t.hood ? "Hood" : parts.neck === "v" ? "V-neck" : parts.neck === "mock" ? "Mock neck" : "Crew"} / ${parts.sleeve === "setin" ? "Set-in" : parts.sleeve === "raglan" ? "Raglan" : "Drop shoulder"}`],
    ["Pocket", parts.pocket === "none" ? "None" : parts.pocket === "chest" ? "Chest patch" : "Kangaroo"],
    ["Base size", `M (graded XS–3XL)`], ["Body fabric", `${fab.name}`], ["Fiber", fiberLabel(fab)], ["Weight", `${fab.gsm} GSM · ${ozPerSqYd(fab.gsm).toFixed(1)} oz/yd²`],
    ["Decoration", d.graphics.length ? d.graphics.map((g) => g.method === "screen" ? "Screen print" : g.method === "embroidery" ? "Embroidery" : "DTG").filter((v, i, a) => a.indexOf(v) === i).join(", ") : "None"],
    ["Issued", new Date().toLocaleDateString()],
  ];
  let y = 1.45;
  for (const [k, v] of info) {
    pdf.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(110).text(k.toUpperCase(), 7.1, y);
    pdf.setFont("helvetica", "normal").setFontSize(10).setTextColor(20).text(pdf.splitTextToSize(v, 3.3)[0], 7.1, y + 0.17);
    y += 0.42;
  }

  // 2 — Technical flats
  pdf.addPage("letter", "landscape");
  header(c, "Technical flats");
  for (const [i, view] of (["front", "back"] as const).entries()) {
    const f = technicalFlatSvg(d, view, { art: true, previews });
    const png = await svgToPng(f.svg, f.w, f.h, 50);
    const k = Math.min(4.8 / f.w, 6.2 / f.h);
    const x = M + 0.1 + i * 5.1 + (4.8 - f.w * k) / 2;
    pdf.addImage(png, "PNG", x, 1.4, f.w * k, f.h * k, undefined, "FAST");
    pdf.setFontSize(9).setTextColor(110).text(view.toUpperCase(), M + 0.1 + i * 5.1, 7.85);
  }

  // 3 — Measurement diagram
  pdf.addPage("letter", "landscape");
  header(c, "Measurement diagram");
  const fd = technicalFlatSvg(d, "front", { dims: true, units });
  const pd = await svgToPng(fd.svg, fd.w, fd.h, 50);
  const kd = Math.min(6.4 / fd.w, 6.5 / fd.h);
  pdf.addImage(pd, "PNG", M, 1.3, fd.w * kd, fd.h * kd, undefined, "FAST");
  const spec = gradedSpec(d.base, d.grade, "M");
  table(pdf, 7.2, 1.5, [{ h: "POM", w: 0.45 }, { h: "Point of measure", w: 1.85 }, { h: "M", w: 0.9, align: "right" }],
    t.poms.map((code) => [code, POMS[code].name, fmt(spec[code], units)]), { zebra: true });

  // 4 — Spec sheet
  pdf.addPage("letter", "landscape");
  header(c, `Graded spec sheet (${units === "in" ? "inches" : "cm"})`);
  const specs = SIZES.map((s) => gradedSpec(d.base, d.grade, s));
  const cols = [{ h: "POM", w: 0.45 }, { h: "Point of measure", w: 1.7 }, { h: "How to measure", w: 2.6 }, { h: "Tol ±", w: 0.55, align: "right" as const }, { h: "Grade", w: 0.55, align: "right" as const },
    ...SIZES.map((s) => ({ h: s, w: 0.6, align: "right" as const }))];
  table(pdf, M, 1.5, cols, t.poms.map((code) => [code, POMS[code].name, POMS[code].how, fmt(POMS[code].tol, units), fmt(d.grade[code] ?? 0, units), ...specs.map((m) => fmt(m[code], units))]),
    { zebra: true, rowH: 0.3, highlightCol: 5 + SIZES.indexOf("M") });

  // 5 — Bill of materials
  pdf.addPage("letter", "landscape");
  header(c, "Bill of materials");
  const bomEnd = table(pdf, M, 1.5, [{ h: "Category", w: 0.95 }, { h: "Item", w: 2.4 }, { h: "Placement", w: 2.0 }, { h: "Supplier", w: 1.3 }, { h: "Article", w: 0.9 }, { h: "Color", w: 0.8 },
    { h: "Qty", w: 0.75, align: "right" }, { h: "Unit cost", w: 0.65, align: "right" }, { h: "Ext.", w: 0.55, align: "right" }],
    tp.bom.map((b) => [b.category, b.item, b.placement, b.supplier || "—", b.article || "—", b.color || "—", `${b.qty} ${b.unit}`, b.unitCost ? money(b.unitCost) : "—", b.unitCost ? money(b.qty * b.unitCost) : "—"]),
    { zebra: true, rowH: 0.3 });
  pdf.setFontSize(8).setTextColor(110).text("Fabric yardage is an estimate from the flat panel areas plus waste; confirm against your production marker.", M, bomEnd + 0.15);

  // 6 — Colorways
  pdf.addPage("letter", "landscape");
  header(c, "Colorways");
  d.colorways.forEach((cw, i) => {
    const x = M + (i % 4) * 2.5, yy = 1.5 + Math.floor(i / 4) * 2.2;
    pdf.setFillColor(...rgb(cw.body)).setDrawColor(200).rect(x, yy, 2.2, 1.1, "FD");
    pdf.setFillColor(...rgb(cw.trim)).rect(x, yy + 1.1, 2.2, 0.35, "FD");
    pdf.setFont("helvetica", "bold").setFontSize(10).setTextColor(20).text(cw.name, x, yy + 1.7);
    pdf.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(90).text(`Body ${cw.body} · Rib ${cw.trim}`, x, yy + 1.9);
  });

  // 7 — Artwork & decoration
  for (const g of d.graphics) {
    pdf.addPage("letter", "landscape");
    header(c, `Artwork: ${g.name}`);
    const prev = previews[g.id];
    const gh = graphicHeight(g);
    const k = Math.min(3.6 / g.w, 3.6 / gh);
    pdf.setFillColor(242, 242, 245).rect(M, 1.35, 3.8, 3.8, "F");
    try { pdf.addImage(prev, "PNG", M + (3.8 - g.w * k) / 2, 1.35 + (3.8 - gh * k) / 2, g.w * k, gh * k, undefined, "FAST"); } catch { /* unsupported image type */ }
    const pinfo: [string, string][] = [
      ["Location", `${g.view === "front" ? "Front" : "Back"}`],
      ["Finished size", `${fmt(g.w, units, true)} × ${fmt(gh, units, true)}`],
      ["From center", `${fmt(g.x, units, true)} (${g.x === 0 ? "centered" : g.x > 0 ? "toward wearer's left" : "toward wearer's right"})`],
      ["Top below HPS", fmt(g.y - gh / 2, units, true)],
      ["Rotation", `${g.rotation}°`],
      ["Method", g.method === "screen" ? `Screen print · ${INKS[g.ink ?? "plastisol"].name}` : g.method === "embroidery" ? "Embroidery" : "Direct to garment (DTG)"],
    ];
    let yy = 1.45;
    for (const [kk, v] of pinfo) {
      pdf.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(110).text(kk.toUpperCase(), 4.7, yy);
      pdf.setFont("helvetica", "normal").setFontSize(10).setTextColor(20).text(v, 4.7, yy + 0.17);
      yy += 0.42;
    }
    if (g.method === "screen" && processed[g.id]) {
      const steps = printOrder(g, processed[g.id].inks);
      table(pdf, 4.7, yy + 0.1, [{ h: "#", w: 0.3 }, { h: "", w: 0.3 }, { h: "Screen", w: 1.8 }, { h: "Color", w: 0.95 }, { h: "Mesh", w: 0.6, align: "right" }, { h: "Flash", w: 0.6 }],
        steps.map((s, i) => [String(i + 1), "", s.label, s.hex, String(s.mesh), s.flash ? "yes" : ""]));
      steps.forEach((s, i) => pdf.setFillColor(...rgb(s.hex)).setDrawColor(180).rect(5.05, yy + 0.1 + (i + 1) * 0.24 - 0.13, 0.16, 0.16, "FD"));
    } else if (g.method === "embroidery") {
      const dd = await digitizeGraphic(g);
      const hoop = hoopFor(dd.widthMm, dd.heightMm);
      pdf.setFontSize(9.5).setTextColor(20).text(
        `${dd.stitchCount.toLocaleString()} stitches · ${dd.blocks.length} colors · ${dd.trims} trims · ~${stitchMinutes(dd).toFixed(0)} min at 800 spm · ${dd.widthMm.toFixed(0)} × ${dd.heightMm.toFixed(0)} mm · hoop ${hoop ? hoop.name : "oversize"}`,
        4.7, yy + 0.1);
      table(pdf, 4.7, yy + 0.45, [{ h: "Stop", w: 0.45 }, { h: "", w: 0.3 }, { h: "Thread color", w: 1.3 }, { h: "Stitches", w: 0.9, align: "right" }],
        dd.blocks.map((b, i) => [String(i + 1), "", "#" + b.color.toString(16).padStart(6, "0").toUpperCase(), b.stitches.toLocaleString()]));
      dd.blocks.forEach((b, i) => pdf.setFillColor(...rgb("#" + b.color.toString(16).padStart(6, "0"))).setDrawColor(180).rect(5.2, yy + 0.45 + (i + 1) * 0.24 - 0.13, 0.16, 0.16, "FD"));
      pdf.setFontSize(8).setTextColor(110).text("Machine files: DST / PES / EXP exported from THREADFORGE. Match thread colors to your thread chart; sew a test first.", 4.7, 7.6);
    }
  }

  // 8 — Construction, labels, care, packaging
  pdf.addPage("letter", "landscape");
  header(c, "Construction & finishing");
  let yl = paragraph(pdf, "Construction", tp.construction, M, 1.5, 4.8);
  yl = paragraph(pdf, "Labels", tp.labels, M, yl, 4.8);
  let yr = paragraph(pdf, "Care instructions", tp.care, 5.8, 1.5, 4.7);
  yr = paragraph(pdf, "Folding & packaging", tp.packaging, 5.8, yr, 4.7);
  void yl; void yr;

  // 9 — Costing
  pdf.addPage("letter", "landscape");
  header(c, "Costing (per garment)");
  const inksBy: Record<string, { inks: number; stitches?: number }> = {};
  for (const g of d.graphics) inksBy[g.id] = { inks: processed[g.id]?.inks.length ?? g.colors, stitches: processed[g.id]?.stitches };
  const cs = costSheet(d, inksBy);
  const end = table(pdf, M, 1.5, [{ h: "Line", w: 3.2 }, { h: "Basis", w: 4.2 }, { h: "Cost", w: 1.2, align: "right" }],
    cs.lines.map((l) => [l.label, l.note ?? "", money(l.amount)]), { zebra: true, rowH: 0.3 });
  pdf.setFont("helvetica", "bold").setFontSize(11).setTextColor(20);
  const cc = tp.costing;
  [[`Cost of goods`, money(cs.cogs)], [`Wholesale at ${cc.marginPct}% margin`, money(cs.wholesale)], [`Retail at ${cc.retailMultiple}× wholesale`, money(cs.retail)]].forEach(([k, v], i) => {
    pdf.text(k, M, end + 0.35 + i * 0.32);
    pdf.text(v, M + 8.6, end + 0.35 + i * 0.32, { align: "right" });
  });
  if (cs.missing.length) pdf.setFont("helvetica", "normal").setFontSize(9).setTextColor(180, 90, 0).text(`Not set yet: ${cs.missing.join(", ")}.`, M, end + 1.4);

  // 10 — Revisions
  pdf.addPage("letter", "landscape");
  header(c, "Revision log");
  table(pdf, M, 1.5, [{ h: "Rev", w: 0.6 }, { h: "Date", w: 1.4 }, { h: "Change", w: 7.9 }],
    tp.revisions.length ? tp.revisions.map((r) => [r.rev, new Date(r.at).toLocaleDateString(), r.note]) : [[tp.revision || "A", new Date().toLocaleDateString(), "First issue"]], { zebra: true, rowH: 0.3 });

  // footers
  const n = pdf.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    pdf.setPage(i);
    pdf.setFont("helvetica", "normal").setFontSize(8).setTextColor(130);
    pdf.text(`${d.name}${tp.styleNumber ? " · " + tp.styleNumber : ""} · Confidential`, M, H - 0.3);
    pdf.text(`Page ${i} of ${n}`, W - M, H - 0.3, { align: "right" });
  }
  return new Uint8Array(pdf.output("arraybuffer"));
}
