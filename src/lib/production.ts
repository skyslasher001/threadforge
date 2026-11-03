// Production rules shared by print prep, embroidery and the tech pack.
// Mesh counts and hoop sizes are typical starting points; shops adjust to their own setups.

import type { BomRow, Costing, Design, Graphic, InkType, TechPack } from "../types";
import { TEMPLATES, gradedSpec } from "../data/measurements";
import { fabricFor, luminance } from "../data/fabrics";
import { uid } from "../state/store";

export const INKS: Record<InkType, { name: string; mesh: [number, number]; note: string }> = {
  plastisol: { name: "Plastisol", mesh: [110, 160], note: "Most forgiving; cures with heat, sits on top of the fabric." },
  water: { name: "Water-based", mesh: [156, 230], note: "Soft hand; dries in the screen, keep printing moving. Best on cotton." },
  discharge: { name: "Discharge", mesh: [156, 200], note: "Removes the garment dye; needs dischargeable 100% cotton and activator." },
  puff: { name: "Puff", mesh: [86, 110], note: "Rises when cured; keep shapes bold, avoid fine lines." },
  metallic: { name: "Metallic", mesh: [86, 125], note: "Flake inks need an open mesh to pass through." },
  glitter: { name: "Glitter", mesh: [40, 86], note: "Very coarse mesh; best on simple, solid shapes." },
};

/** Suggested mesh: the fine end of the range for small art, the open end for large solid shapes. */
export function suggestedMesh(ink: InkType, g: Graphic) {
  const [lo, hi] = INKS[ink].mesh;
  return g.w < 4 ? hi : g.w > 10 ? lo : Math.round((lo + hi) / 2 / 5) * 5;
}

export interface PrintStep { label: string; hex: string; mesh: number; flash: boolean }

/** Suggested print order: underbase and flash, then light to dark, a white highlight last. Printers may reorder. */
export function printOrder(g: Graphic, inks: { hex: string }[]): PrintStep[] {
  const ink = g.ink ?? "plastisol";
  const mesh = suggestedMesh(ink, g);
  const steps: PrintStep[] = [];
  if (g.underbase) steps.push({ label: "White underbase", hex: "#FFFFFF", mesh: Math.max(110, INKS[ink].mesh[0]), flash: true });
  const sorted = [...inks].sort((a, b) => luminance(b.hex) - luminance(a.hex));
  const whites = sorted.filter((i) => luminance(i.hex) > 0.85);
  const rest = sorted.filter((i) => luminance(i.hex) <= 0.85);
  for (const i of rest) steps.push({ label: INKS[ink].name, hex: i.hex, mesh, flash: false });
  for (const i of whites) steps.push({ label: g.underbase ? "Highlight white" : INKS[ink].name, hex: i.hex, mesh, flash: false });
  return steps;
}

export const HOOPS = [
  { name: "4 × 4 in", w: 100, h: 100 },
  { name: "5 × 7 in", w: 130, h: 180 },
  { name: "6 × 10 in", w: 160, h: 260 },
  { name: "8 × 8 in", w: 200, h: 200 },
  { name: "12 × 12 in", w: 300, h: 300 },
];

/** Smallest common hoop whose sewing field fits the design (either orientation), with a 5 mm margin. */
export function hoopFor(wMm: number, hMm: number) {
  return HOOPS.find((h) => (wMm + 10 <= h.w && hMm + 10 <= h.h) || (wMm + 10 <= h.h && hMm + 10 <= h.w)) ?? null;
}

// ---------------- tech pack defaults ----------------

export function careText(d: Design) {
  const f = fabricFor(d, d.fabricId).fiber;
  const lines = ["Machine wash cold, inside out, with like colors.", "Do not bleach.", "Tumble dry low or hang dry.", "Do not iron decoration.", "Do not dry clean."];
  if (f.cotton >= 90) lines.push("Expect slight shrinkage on first wash (100% cotton).");
  if (f.nylon >= 50) lines[2] = "Hang dry. Do not tumble dry.";
  return lines.join("\n");
}

export function constructionText(d: Design) {
  const t = TEMPLATES[d.template];
  const lines = [
    "Shoulder seams: 4-thread overlock, taped.",
    d.parts.sleeve === "raglan" ? "Raglan seams: 4-thread overlock, coverstitched." : "Armholes: 4-thread overlock.",
    "Side seams: 4-thread overlock.",
    t.ribCuff ? "Cuffs: 1x1 rib, overlocked to sleeve." : "Sleeve hems: 1 in twin-needle coverstitch.",
    t.ribHem ? "Hem: 1x1 rib band, overlocked, coverstitched." : "Bottom hem: 1 in twin-needle coverstitch.",
  ];
  if (t.hood) lines.push("Hood: lined self fabric, center seam, metal eyelets with flat drawcord.");
  else if (d.parts.neck === "v") lines.push("Neck: 1x1 rib V-neck with mitered center, coverstitched.");
  else if (d.parts.neck === "mock") lines.push("Neck: folded 1x1 rib mock collar, coverstitched.");
  else lines.push("Neck: 1x1 rib collar, coverstitched, back neck tape.");
  if (d.parts.pocket === "kangaroo") lines.push("Kangaroo pocket: self fabric, coverstitched edges, bartacks at openings.");
  if (d.parts.pocket === "chest") lines.push("Chest pocket: self fabric patch, double-needle topstitch, bartacks at top corners.");
  lines.push("Stitches per inch: 12–14 on seams.");
  return lines.join("\n");
}

const COST0: Costing = { fabricWidthIn: 60, wastePct: 15, screenSetup: 0, printPerColor: 0, embroideryPer1k: 0, dtgPerPrint: 0, laborCMT: 0, runQty: 50, marginPct: 50, retailMultiple: 2 };

export function defaultBom(d: Design): BomRow[] {
  const t = TEMPLATES[d.template];
  const fab = fabricFor(d, d.fabricId);
  const row = (p: Partial<BomRow>): BomRow => ({ id: uid(), item: "", category: "Trim", supplier: "", article: "", color: "", qty: 1, unit: "pc", unitCost: 0, placement: "", ...p });
  const rows: BomRow[] = [
    row({ item: `${fab.name}, ${fab.gsm} GSM`, category: "Fabric", supplier: fab.supplier ?? "", color: d.bodyColor, qty: fabricYards(d), unit: "yd", unitCost: fab.costPerYard ?? 0, placement: "Body" }),
  ];
  if (t.ribCuff || t.ribHem || !t.hood) rows.push(row({ item: "1x1 rib", category: "Fabric", color: d.trimColor, qty: 0.15, unit: "yd", placement: t.ribHem ? "Collar, cuffs, hem" : "Collar" }));
  rows.push(row({ item: "Sewing thread, matched", category: "Thread", color: d.bodyColor, qty: 1, unit: "garment", placement: "All seams" }));
  rows.push(row({ item: "Main label", category: "Label", placement: "Center back neck" }));
  rows.push(row({ item: "Care / content label", category: "Label", placement: "Left side seam, 3 in above hem" }));
  rows.push(row({ item: "Size label", category: "Label", placement: "Under main label" }));
  if (t.hood) {
    rows.push(row({ item: "Flat drawcord, 54 in", category: "Trim", color: d.trimColor, placement: "Hood" }));
    rows.push(row({ item: "Metal eyelets", category: "Trim", qty: 2, placement: "Hood opening" }));
  }
  rows.push(row({ item: "Hang tag + fastener", category: "Packaging", placement: "Left armhole" }));
  rows.push(row({ item: "Polybag, self-seal", category: "Packaging", placement: "Folded garment" }));
  return rows;
}

export function defaultTechPack(d: Design): TechPack {
  return {
    styleNumber: "", season: "", brand: "", designer: "", revision: "A",
    construction: constructionText(d), care: careText(d),
    labels: "Main label at center back neck. Care label at left side seam. Size label under main label.",
    packaging: "Fold to 10 × 12 in, tissue between folds, polybag with size sticker.",
    bom: defaultBom(d), costing: { ...COST0 }, revisions: [],
  };
}

export const techpackOf = (d: Design): TechPack => d.techpack ?? defaultTechPack(d);

/**
 * Fabric per garment for the base size, in yards: flat panel areas plus seam allowance and waste,
 * across the usable fabric width. An estimate for costing; confirm with a real marker.
 */
export function fabricYards(d: Design, size = "M"): number {
  const m = gradedSpec(d.base, d.grade, size);
  const t = TEMPLATES[d.template];
  const sa = 1; // seam allowance per edge, inches
  const panels = 2 * (m.A + 2 * sa) * (m.B + 2 * sa); // front + back
  const sleeveW = Math.max(m.G, m.E * 1.9) + 2 * sa;
  const sleeves = 2 * sleeveW * (m.D + 2 * sa);
  const hood = t.hood ? 2 * ((m.HD ?? 14) + 2) * 13 : 0;
  const pocket = d.parts.pocket === "kangaroo" ? ((m.P ?? 11) + 2) * 10 : d.parts.pocket === "chest" ? 6 * 7 : 0;
  const c = d.techpack?.costing ?? COST0;
  const area = (panels + sleeves + hood + pocket) * (1 + c.wastePct / 100);
  return +(area / (c.fabricWidthIn * 36)).toFixed(2);
}

export interface CostLine { label: string; amount: number; note?: string }

export function costSheet(d: Design, inksByGraphic: Record<string, { inks: number; stitches?: number }>): { lines: CostLine[]; cogs: number; wholesale: number; retail: number; missing: string[] } {
  const tp = techpackOf(d);
  const c = tp.costing;
  const lines: CostLine[] = [];
  const missing: string[] = [];
  const fabricRows = tp.bom.filter((b) => b.category === "Fabric");
  const otherRows = tp.bom.filter((b) => b.category !== "Fabric");
  const fabric = fabricRows.reduce((s, b) => s + b.qty * b.unitCost, 0);
  const trims = otherRows.reduce((s, b) => s + b.qty * b.unitCost, 0);
  if (fabricRows.some((b) => !b.unitCost)) missing.push("fabric price per yard");
  lines.push({ label: "Fabric", amount: fabric, note: fabricRows.map((b) => `${b.qty} ${b.unit} × $${b.unitCost.toFixed(2)}`).join(", ") });
  lines.push({ label: "Trims, labels, packaging", amount: trims, note: `${otherRows.length} BOM lines` });
  let deco = 0;
  for (const g of d.graphics) {
    const info = inksByGraphic[g.id];
    if (g.method === "screen") {
      const screens = (info?.inks ?? g.colors) + (g.underbase ? 1 : 0);
      const setup = (screens * c.screenSetup) / Math.max(1, c.runQty);
      const run = screens * c.printPerColor;
      deco += setup + run;
      lines.push({ label: `Screen print: ${g.name}`, amount: setup + run, note: `${screens} screens, setup spread over ${c.runQty}` });
      if (!c.printPerColor) missing.push("screen print rates");
    } else if (g.method === "embroidery") {
      const st = info?.stitches ?? 0;
      const amt = (st / 1000) * c.embroideryPer1k;
      deco += amt;
      lines.push({ label: `Embroidery: ${g.name}`, amount: amt, note: `${st.toLocaleString()} stitches` });
      if (!c.embroideryPer1k) missing.push("embroidery rate per 1,000 stitches");
    } else {
      deco += c.dtgPerPrint;
      lines.push({ label: `DTG: ${g.name}`, amount: c.dtgPerPrint });
      if (!c.dtgPerPrint) missing.push("DTG price per print");
    }
  }
  lines.push({ label: "Cut, make, trim (labor)", amount: c.laborCMT });
  if (!c.laborCMT) missing.push("labor (CMT)");
  const cogs = fabric + trims + deco + c.laborCMT;
  const wholesale = c.marginPct >= 100 ? cogs : cogs / (1 - c.marginPct / 100);
  return { lines, cogs, wholesale, retail: wholesale * c.retailMultiple, missing: Array.from(new Set(missing)) };
}
