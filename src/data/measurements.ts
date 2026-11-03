import type { TemplateId, Units } from "../types";

export const SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL"] as const;
export const BASE_SIZE = "M";

export interface Pom {
  code: string;
  name: string;
  how: string;
  tol: number; // tolerance +/- inches
  min: number;
  max: number;
}

const ALL: Record<string, Pom> = {
  A: { code: "A", name: "Chest width", how: "1 in below armhole, side to side, laid flat", tol: 0.5, min: 14, max: 36 },
  B: { code: "B", name: "Body length", how: "High point shoulder (HPS) to hem", tol: 0.5, min: 18, max: 40 },
  C: { code: "C", name: "Shoulder width", how: "Shoulder seam to shoulder seam", tol: 0.375, min: 13, max: 30 },
  D: { code: "D", name: "Sleeve length", how: "Shoulder seam to cuff edge", tol: 0.375, min: 4, max: 32 },
  E: { code: "E", name: "Armhole", how: "Straight, shoulder point to underarm", tol: 0.25, min: 6, max: 14 },
  G: { code: "G", name: "Sleeve opening", how: "Edge to edge at cuff, relaxed", tol: 0.25, min: 2.5, max: 12 },
  H: { code: "H", name: "Hem width", how: "Side to side at hem, relaxed", tol: 0.5, min: 14, max: 36 },
  I: { code: "I", name: "Neck width", how: "Seam to seam at HPS", tol: 0.25, min: 5, max: 12 },
  J: { code: "J", name: "Front neck drop", how: "HPS line to front neck seam", tol: 0.125, min: 1, max: 8 },
  JB: { code: "JB", name: "Back neck drop", how: "HPS line to back neck seam", tol: 0.125, min: 0.25, max: 3 },
  K1: { code: "K1", name: "Cuff rib height", how: "Rib seam to cuff edge", tol: 0.125, min: 0.5, max: 5 },
  K2: { code: "K2", name: "Hem rib height", how: "Rib seam to hem edge", tol: 0.125, min: 0.5, max: 5 },
  K3: { code: "K3", name: "Collar rib height", how: "Neck seam to collar edge", tol: 0.125, min: 0.375, max: 2.5 },
  HD: { code: "HD", name: "Hood height", how: "Neck seam at HPS to top of hood", tol: 0.5, min: 10, max: 18 },
  P: { code: "P", name: "Pocket width", how: "Kangaroo pocket, bottom edge", tol: 0.25, min: 7, max: 16 },
};

export interface TemplateSpec {
  id: TemplateId;
  name: string;
  short: string;
  poms: string[];
  base: Record<string, number>;
  grade: Record<string, number>;
  sleeveAngle: number; // degrees below horizontal in the flat
  ribCuff: boolean;
  ribHem: boolean;
  hood: boolean;
  pocket: boolean;
}

export const TEMPLATES: Record<TemplateId, TemplateSpec> = {
  tee: {
    id: "tee",
    name: "Classic Tee",
    short: "Tee",
    poms: ["A", "B", "C", "D", "E", "G", "H", "I", "J", "JB", "K3"],
    base: { A: 21, B: 29, C: 19, D: 8.5, E: 9.5, G: 7.25, H: 21, I: 7.5, J: 3.75, JB: 1, K3: 0.875 },
    grade: { A: 2, B: 1, C: 1, D: 0.5, E: 0.75, G: 0.5, H: 2, I: 0.25, J: 0.125, JB: 0, K3: 0 },
    sleeveAngle: 30,
    ribCuff: false,
    ribHem: false,
    hood: false,
    pocket: false,
  },
  longsleeve: {
    id: "longsleeve",
    name: "Long Sleeve Tee",
    short: "Long sleeve",
    poms: ["A", "B", "C", "D", "E", "G", "H", "I", "J", "JB", "K1", "K3"],
    base: { A: 21, B: 29, C: 19, D: 24.5, E: 9.5, G: 4, H: 21, I: 7.5, J: 3.5, JB: 1, K1: 2, K3: 0.875 },
    grade: { A: 2, B: 1, C: 1, D: 0.5, E: 0.75, G: 0.25, H: 2, I: 0.25, J: 0.125, JB: 0, K1: 0, K3: 0 },
    sleeveAngle: 58,
    ribCuff: true,
    ribHem: false,
    hood: false,
    pocket: false,
  },
  crewneck: {
    id: "crewneck",
    name: "Crewneck Sweatshirt",
    short: "Crewneck",
    poms: ["A", "B", "C", "D", "E", "G", "H", "I", "J", "JB", "K1", "K2", "K3"],
    base: { A: 23, B: 27.5, C: 21, D: 24, E: 10.5, G: 4, H: 20, I: 7.5, J: 3, JB: 1, K1: 2.75, K2: 2.75, K3: 1.25 },
    grade: { A: 2, B: 1, C: 1, D: 0.5, E: 0.75, G: 0.25, H: 2, I: 0.25, J: 0.125, JB: 0, K1: 0, K2: 0, K3: 0 },
    sleeveAngle: 56,
    ribCuff: true,
    ribHem: true,
    hood: false,
    pocket: false,
  },
  hoodie: {
    id: "hoodie",
    name: "Pullover Hoodie",
    short: "Hoodie",
    poms: ["A", "B", "C", "D", "E", "G", "H", "I", "J", "JB", "K1", "K2", "HD", "P"],
    base: { A: 23, B: 27.5, C: 21, D: 24.5, E: 10.5, G: 4, H: 20, I: 8, J: 3, JB: 1, K1: 2.75, K2: 2.75, HD: 14, P: 11 },
    grade: { A: 2, B: 1, C: 1, D: 0.5, E: 0.75, G: 0.25, H: 2, I: 0.25, J: 0.125, JB: 0, K1: 0, K2: 0, HD: 0.5, P: 0.5 },
    sleeveAngle: 56,
    ribCuff: true,
    ribHem: true,
    hood: true,
    pocket: true,
  },
};

export const POMS = ALL;

/** Measurements for any size, from base-size values and per-step grade rules. */
export function gradedSpec(
  base: Record<string, number>,
  grade: Record<string, number>,
  size: string,
): Record<string, number> {
  const step = SIZES.indexOf(size as (typeof SIZES)[number]) - SIZES.indexOf(BASE_SIZE);
  const out: Record<string, number> = {};
  for (const k of Object.keys(base)) out[k] = Math.max(0.25, base[k] + (grade[k] ?? 0) * step);
  return out;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** Inches to a fraction string to the nearest 1/8, or cm with one decimal. */
export function fmt(inches: number, units: Units, withUnit = false): string {
  if (units === "cm") return `${(inches * 2.54).toFixed(1)}${withUnit ? " cm" : ""}`;
  const sign = inches < 0 ? "-" : "";
  const eighths = Math.round(Math.abs(inches) * 8);
  const whole = Math.floor(eighths / 8);
  const rem = eighths % 8;
  let s = rem === 0 ? `${whole}` : `${whole ? whole + " " : ""}${rem / gcd(rem, 8)}/${8 / gcd(rem, 8)}`;
  if (!whole && !rem) s = "0";
  return `${sign}${s}${withUnit ? '"' : ""}`;
}

/** Parse a user-typed value in the active unit back to inches. Accepts "21 1/2", "21.5", "3/8". */
export function parseLen(text: string, units: Units): number | null {
  const t = text.trim().replace(/["”]|in$|cm$/g, "").trim();
  if (!t) return null;
  let v: number;
  const mixed = t.match(/^(\d+(?:\.\d+)?)\s+(\d+)\/(\d+)$/);
  const frac = t.match(/^(\d+)\/(\d+)$/);
  if (mixed) v = parseFloat(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3]);
  else if (frac) v = parseInt(frac[1]) / parseInt(frac[2]);
  else v = parseFloat(t);
  if (!isFinite(v)) return null;
  return units === "cm" ? v / 2.54 : v;
}

// ---- Fit presets: offsets from the template's regular base size (inches) ----
import type { FitPreset } from "../types";

const FIT_DELTAS: Record<FitPreset, { short: Record<string, number>; long: Record<string, number> }> = {
  regular: { short: {}, long: {} },
  boxy: {
    short: { A: 2, B: -1.5, C: 2, H: 2, D: 0.5, E: 0.75, G: 0.5 },
    long: { A: 2, B: -1.5, C: 2, H: 2, E: 0.75 },
  },
  oversized: {
    short: { A: 4, B: 2, C: 4, H: 4, D: 1, E: 1.5, G: 1, I: 0.25 },
    long: { A: 4, B: 2, C: 4, H: 4, D: -1, E: 1.5, G: 0.25, I: 0.25 },
  },
  cropped: {
    short: { A: 1.5, B: -6, C: 1, H: 1.5 },
    long: { A: 1.5, B: -6, C: 1, H: 1.5 },
  },
};

export const FIT_LABELS: Record<FitPreset, string> = { regular: "Regular", boxy: "Boxy", oversized: "Oversized", cropped: "Cropped" };

export function fitBase(template: TemplateId, fit: FitPreset): Record<string, number> {
  const t = TEMPLATES[template];
  const deltas = template === "tee" ? FIT_DELTAS[fit].short : FIT_DELTAS[fit].long;
  const out = { ...t.base };
  for (const [k, v] of Object.entries(deltas)) if (out[k] !== undefined) out[k] = +(out[k] + v).toFixed(3);
  return out;
}
