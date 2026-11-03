// Screen-print film positives as a PDF at actual size: one page per screen, black on
// white, registration marks, a 1 in check bar and the print order. Print at 100%.

import { jsPDF } from "jspdf";
import type { Graphic } from "../types";
import { quantize } from "./imaging";
import { INKS, printOrder } from "./production";
import { graphicHeight } from "./checks";

const hex = (r: number, g: number, b: number) =>
  "#" + ((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1).toUpperCase();

export async function filmsPdf(g: Graphic, styleLabel = ""): Promise<Uint8Array> {
  const wIn = g.w, hIn = graphicHeight(g);
  // ~300 DPI at print size, capped for memory on very large prints
  const maxSide = Math.min(2400, Math.round(Math.max(wIn, hIn) * 300));
  const q = await quantize(g.src, Math.max(1, Math.min(10, g.colors)), maxSide);
  const order = q.counts.map((n, i) => ({ n, i })).filter((o) => o.n > 0);
  const inks = order.map((o) => ({ hex: hex(...q.centers[o.i]), idx: o.i }));
  const steps = printOrder(g, inks);
  const margin = 1.25;
  const pw = Math.max(8.5, wIn + margin * 2), ph = Math.max(11, hIn + margin * 2 + 1);
  const pdf = new jsPDF({ unit: "in", format: [pw, ph], orientation: pw > ph ? "landscape" : "portrait", compress: true });
  const dpi = q.w / wIn;

  steps.forEach((step, n) => {
    if (n > 0) pdf.addPage([pw, ph], pw > ph ? "landscape" : "portrait");
    const ink = inks.find((i) => i.hex === step.hex);
    const test = step.label === "White underbase" ? (l: number) => l >= 0 : (l: number) => l === ink?.idx;
    const c = document.createElement("canvas");
    c.width = q.w; c.height = q.h;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(q.w, q.h);
    for (let i = 0; i < q.labels.length; i++) {
      const on = test(q.labels[i]);
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = on ? 0 : 255;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const x = (pw - wIn) / 2, y = margin + 0.6;
    pdf.addImage(c.toDataURL("image/png"), "PNG", x, y, wIn, hIn, undefined, "FAST");

    // header
    pdf.setFont("helvetica", "bold").setFontSize(12).setTextColor(0);
    pdf.text(`${g.name} — screen ${n + 1} of ${steps.length}`, margin, 0.6);
    pdf.setFont("helvetica", "normal").setFontSize(9);
    pdf.text(`${step.label} ${step.hex} · ${INKS[g.ink ?? "plastisol"].name} · suggested mesh ${step.mesh}${step.flash ? " · flash after" : ""}`, margin, 0.82);
    pdf.text(`Print size ${wIn.toFixed(2)} × ${hIn.toFixed(2)} in · ${Math.round(dpi)} DPI · PRINT AT 100%, DO NOT SCALE${styleLabel ? " · " + styleLabel : ""}`, margin, 1.0);

    // registration marks at the art corners + center top/bottom
    pdf.setLineWidth(0.01).setDrawColor(0);
    const marks: [number, number][] = [[x - 0.4, y - 0.4], [x + wIn + 0.4, y - 0.4], [x - 0.4, y + hIn + 0.4], [x + wIn + 0.4, y + hIn + 0.4], [x + wIn / 2, y - 0.4], [x + wIn / 2, y + hIn + 0.4]];
    for (const [mx, my] of marks) {
      pdf.circle(mx, my, 0.12);
      pdf.line(mx - 0.2, my, mx + 0.2, my);
      pdf.line(mx, my - 0.2, mx, my + 0.2);
    }
    // 1 inch check bar
    const by = Math.min(ph - 0.5, y + hIn + 0.85);
    pdf.setFillColor(0, 0, 0).rect(margin, by, 1, 0.08, "F");
    pdf.setFontSize(7).text("1 in — measure to confirm 100% scale", margin + 1.1, by + 0.07);
  });
  return new Uint8Array(pdf.output("arraybuffer"));
}
