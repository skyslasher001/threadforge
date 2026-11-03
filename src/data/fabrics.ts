import type { CustomFabric } from "../types";

export type FabricPattern =
  | "jersey"
  | "terry"
  | "fleece"
  | "rib"
  | "mesh"
  | "twill"
  | "denim"
  | "ripstop"
  | "canvas"
  | "photo";

export interface Fabric {
  id: string;
  name: string;
  construction: "Knit" | "Woven";
  gsm: number;
  stretch: "None" | "Low" | "Medium" | "High";
  fiber: { cotton: number; poly: number; nylon: number; elastane: number };
  pattern: FabricPattern;
  scale: number; // texture repeat in inches
  sheen: number; // 0..1 surface sheen for shading
  note: string;
  tile?: string; // scanned fabric texture (custom fabrics)
  costPerYard?: number;
  supplier?: string;
}

export const FABRICS: Fabric[] = [
  { id: "hw-jersey", name: "Heavyweight jersey", construction: "Knit", gsm: 280, stretch: "Low", fiber: { cotton: 100, poly: 0, nylon: 0, elastane: 0 }, pattern: "jersey", scale: 0.16, sheen: 0.15, note: "Boxy, structured tees. Great for screen print and embroidery." },
  { id: "rs-jersey", name: "Ringspun jersey", construction: "Knit", gsm: 165, stretch: "Medium", fiber: { cotton: 100, poly: 0, nylon: 0, elastane: 0 }, pattern: "jersey", scale: 0.12, sheen: 0.2, note: "Soft retail tee. Ideal for DTG; embroidery needs cutaway backing." },
  { id: "cvc-jersey", name: "CVC jersey 60/40", construction: "Knit", gsm: 180, stretch: "Medium", fiber: { cotton: 60, poly: 40, nylon: 0, elastane: 0 }, pattern: "jersey", scale: 0.12, sheen: 0.25, note: "Blend: low shrink, slight heather. Check dye migration on screen prints." },
  { id: "terry", name: "French terry", construction: "Knit", gsm: 360, stretch: "Medium", fiber: { cotton: 100, poly: 0, nylon: 0, elastane: 0 }, pattern: "terry", scale: 0.18, sheen: 0.1, note: "Loopback sweats. Screen print, embroidery and puff all work well." },
  { id: "fleece", name: "Brushed fleece", construction: "Knit", gsm: 400, stretch: "Medium", fiber: { cotton: 80, poly: 20, nylon: 0, elastane: 0 }, pattern: "fleece", scale: 0.6, sheen: 0.05, note: "Classic hoodie fabric. Embroidery and chenille patches shine." },
  { id: "rib", name: "1x1 rib", construction: "Knit", gsm: 240, stretch: "High", fiber: { cotton: 95, poly: 0, nylon: 0, elastane: 5 }, pattern: "rib", scale: 0.1, sheen: 0.15, note: "Cuffs, collars and waistbands." },
  { id: "mesh", name: "Polyester mesh", construction: "Knit", gsm: 140, stretch: "High", fiber: { cotton: 0, poly: 100, nylon: 0, elastane: 0 }, pattern: "mesh", scale: 0.2, sheen: 0.45, note: "Jerseys. Use sublimation for full prints; screen print needs low-cure ink." },
  { id: "twill", name: "Cotton twill", construction: "Woven", gsm: 240, stretch: "None", fiber: { cotton: 100, poly: 0, nylon: 0, elastane: 0 }, pattern: "twill", scale: 0.12, sheen: 0.2, note: "Overshirts, hats, workwear. Embroidery-friendly." },
  { id: "denim", name: "Rigid denim 12 oz", construction: "Woven", gsm: 405, stretch: "None", fiber: { cotton: 100, poly: 0, nylon: 0, elastane: 0 }, pattern: "denim", scale: 0.14, sheen: 0.15, note: "Jackets and jeans. Embroidery, discharge and laser looks." },
  { id: "ripstop", name: "Nylon ripstop", construction: "Woven", gsm: 90, stretch: "None", fiber: { cotton: 0, poly: 0, nylon: 100, elastane: 0 }, pattern: "ripstop", scale: 0.25, sheen: 0.6, note: "Windbreakers. Heat transfer or low-temp inks only." },
  { id: "canvas", name: "Cotton canvas 10 oz", construction: "Woven", gsm: 340, stretch: "None", fiber: { cotton: 100, poly: 0, nylon: 0, elastane: 0 }, pattern: "canvas", scale: 0.1, sheen: 0.1, note: "Chore coats and totes. Screen print and embroidery." },
];

export const fabricById = (id: string) => FABRICS.find((f) => f.id === id) ?? FABRICS[0];

/** Resolve a fabric id against the built-in library and the design's scanned fabrics. */
export function fabricFor(d: { customFabrics?: CustomFabric[] }, id: string): Fabric {
  const c = d.customFabrics?.find((x) => x.id === id);
  if (c) {
    return {
      id: c.id, name: c.name, construction: c.construction, gsm: c.gsm, stretch: c.stretch, fiber: c.fiber,
      pattern: "photo", scale: c.tileInches, sheen: 0.12, note: c.note || "Scanned fabric.", tile: c.tile,
      costPerYard: c.costPerYard, supplier: c.supplier,
    };
  }
  return fabricById(id);
}

export const ozPerSqYd = (gsm: number) => gsm / 33.906;

export function fiberLabel(f: Fabric): string {
  const parts: string[] = [];
  if (f.fiber.cotton) parts.push(`${f.fiber.cotton}% cotton`);
  if (f.fiber.poly) parts.push(`${f.fiber.poly}% polyester`);
  if (f.fiber.nylon) parts.push(`${f.fiber.nylon}% nylon`);
  if (f.fiber.elastane) parts.push(`${f.fiber.elastane}% elastane`);
  return parts.join(" / ");
}

export const SWATCHES = [
  "#F4F1EA", "#E9E4D8", "#C9C3B6", "#8A8A8A", "#3A3A3D", "#141416",
  "#1F2A44", "#2E4A7D", "#6F8FB8", "#2F4A3A", "#5D6B3A", "#A7B38A",
  "#7A1F2B", "#B8322E", "#E0663A", "#E8B04A", "#F2D16B", "#D9A6B4",
  "#5B3A7A", "#9C7FD1", "#6B4A35", "#A57A55", "#D7C2A0", "#FF4FA3",
];

/** Relative luminance, 0..1. */
export function luminance(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export const isDark = (hex: string) => luminance(hex) < 0.18;

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}
