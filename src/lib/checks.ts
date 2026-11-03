import type { Design, Graphic, ProcessedGraphic } from "../types";
import { fabricFor, isDark } from "../data/fabrics";
import { POMS, SIZES, gradedSpec } from "../data/measurements";

export interface Check {
  level: "bad" | "warn" | "good";
  text: string;
  fix?: { label: string; patch: Partial<Graphic> };
}

export const graphicHeight = (g: Graphic) => g.w * (g.natH / g.natW);
export const effectiveDpi = (g: Graphic) => g.natW / Math.max(0.01, g.w);

/** Production checks for one placed graphic: resolution, method vs fabric, garment color, embroidery limits. */
export function graphicChecks(g: Graphic, d: Design, p?: ProcessedGraphic): Check[] {
  const out: Check[] = [];
  const fab = fabricFor(d, d.fabricId);
  const dark = isDark(d.bodyColor);
  const dpi = effectiveDpi(g);

  if (g.method !== "embroidery") {
    if (dpi < 150) out.push({ level: "bad", text: `Only ${Math.round(dpi)} DPI at ${g.w.toFixed(1)} in wide. Prints will look soft; aim for 300.`, fix: { label: `Shrink to ${(g.natW / 300).toFixed(1)} in`, patch: { w: +(g.natW / 300).toFixed(2) } } });
    else if (dpi < 300) out.push({ level: "warn", text: `${Math.round(dpi)} DPI at this size. 300 DPI is print-ready.` });
    else out.push({ level: "good", text: `${Math.round(dpi)} DPI at ${g.w.toFixed(1)} in — print-ready.` });
  }

  if (g.method === "screen") {
    if (fab.fiber.nylon >= 50) out.push({ level: "warn", text: "Nylon needs low-cure or nylon-bond ink; standard plastisol can scorch or peel." });
    if (fab.pattern === "mesh") out.push({ level: "warn", text: "Mesh holes break up fine detail. Keep lines above 2 pt and use low-cure ink." });
    if (fab.fiber.poly >= 40) out.push({ level: "warn", text: "Poly blend: use a dye-blocking (low-bleed) ink so the garment dye doesn't migrate into light inks." });
    if (dark && !g.underbase) out.push({ level: "warn", text: "Dark garment: add a white underbase so inks stay bright.", fix: { label: "Add underbase", patch: { underbase: true } } });
    if (!dark && g.underbase) out.push({ level: "warn", text: "Underbase is usually unnecessary on light garments. Removing it saves a screen.", fix: { label: "Remove underbase", patch: { underbase: false } } });
    const screens = (p?.inks.length ?? g.colors) + (g.underbase ? 1 : 0);
    if (screens > 6) out.push({ level: "warn", text: `${screens} screens. Most shops price jumps above 6; try reducing colors.` });
  }

  if (g.method === "dtg") {
    if (fab.fiber.cotton < 50) out.push({ level: "bad", text: `DTG ink bonds to cotton. ${fab.name} is ${fab.fiber.cotton}% cotton, so expect a faded, short-lived print.` });
    if (dark) out.push({ level: "warn", text: "Dark garment: DTG lays a white ink base first (higher cost, stiffer hand)." });
  }

  if (g.method === "embroidery") {
    const h = graphicHeight(g);
    if (g.w < 1.25 || h < 1.25) out.push({ level: "warn", text: "Under 1.25 in: fine details and small text (below 0.25 in) won't stitch cleanly." });
    if (g.w > 12 || h > 12) out.push({ level: "warn", text: "Larger than a 12 x 12 in hoop. Split into hoopings or use a jumbo hoop." });
    if (fab.gsm < 170) out.push({ level: "warn", text: `${fab.gsm} GSM is light: use cutaway stabilizer and lower density to avoid puckering.` });
    if (fab.pattern === "mesh" || fab.pattern === "ripstop") out.push({ level: "warn", text: `${fab.name} puckers easily under dense stitching. Use a lighter fill and topping.` });
    if (g.colors > 8) out.push({ level: "warn", text: "More than 8 thread colors adds color stops and run time." });
    if (p?.stitches && p.stitches > 40000) out.push({ level: "warn", text: `${p.stitches.toLocaleString()} stitches is heavy for one placement; consider appliqué or a patch.` });
  }
  return out;
}

/** Spec-level validation across the size run. */
export function specChecks(d: Design): string[] {
  const issues: string[] = [];
  for (const size of SIZES) {
    const m = gradedSpec(d.base, d.grade, size);
    if (m.G && m.E && m.G > m.E * 1.05) issues.push(`${size}: sleeve opening (G) is wider than the armhole (E).`);
    if (m.H && m.A && m.H > m.A * 1.25) issues.push(`${size}: hem (H) is much wider than chest (A).`);
    if (m.I && m.C && m.I > m.C * 0.6) issues.push(`${size}: neck width (I) is unusually wide for the shoulder (C).`);
    for (const k of Object.keys(m)) {
      const pom = POMS[k];
      if (pom && (m[k] < pom.min || m[k] > pom.max)) issues.push(`${size}: ${pom.name} (${k}) is outside the normal range.`);
    }
  }
  return Array.from(new Set(issues)).slice(0, 8);
}
