import type { Design, Units } from "../types";
import { POMS, SIZES, TEMPLATES, fmt, gradedSpec } from "../data/measurements";
import { ARTBOARD } from "../data/garments";

export interface Crop { x0: number; y0: number; x1: number; y1: number }
import { fabricFor, fiberLabel } from "../data/fabrics";
import { saveFile, type FileFilter } from "./native";

const FILTERS: Record<string, FileFilter> = {
  png: { name: "PNG image", extensions: ["png"] },
  csv: { name: "Spreadsheet (CSV)", extensions: ["csv"] },
  tforge: { name: "THREADFORGE project", extensions: ["tforge"] },
};

/** Save through the native Save As dialog on desktop, or download in a browser. Returns null if cancelled. */
export function download(data: Blob | string, filename: string): Promise<string | null> {
  const ext = filename.split(".").pop()!.toLowerCase();
  return saveFile(data, filename, FILTERS[ext] ? [FILTERS[ext]] : undefined);
}

export const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "design";

/** Render both artboards (front + back) to a PNG at `pxPerInch`, without UI overlays. */
export async function renderMockupPng(
  svg: SVGSVGElement,
  pxPerInch = 40,
  background = "#F1F1F3",
  paint?: (ctx: CanvasRenderingContext2D, pxPerInch: number, crop: Crop) => void,
  crop: Crop = { x0: 0, y0: 0, x1: ARTBOARD.w * 2 + ARTBOARD.gap, y1: ARTBOARD.h },
): Promise<string> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll(".no-export").forEach((n) => n.remove());
  const world = clone.querySelector("#tf-world");
  world?.setAttribute("transform", "");
  const W = crop.x1 - crop.x0;
  const H = crop.y1 - crop.y0;
  clone.setAttribute("viewBox", `${crop.x0} ${crop.y0} ${W} ${H}`);
  clone.setAttribute("width", String(Math.round(W * pxPerInch)));
  clone.setAttribute("height", String(Math.round(H * pxPerInch)));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.removeAttribute("class");
  clone.removeAttribute("style");
  const xml = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Render failed"));
      i.src = url;
    });
    const c = document.createElement("canvas");
    c.width = Math.round(W * pxPerInch);
    c.height = Math.round(H * pxPerInch);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    if (paint) {
      // Drawing layers are canvas-rendered; composite them on their own surface like the stage does.
      const layer = document.createElement("canvas");
      layer.width = c.width;
      layer.height = c.height;
      paint(layer.getContext("2d")!, pxPerInch, crop);
      ctx.drawImage(layer, 0, 0);
    }
    return c.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Graded spec sheet as CSV (opens in Excel / Sheets). */
export function specCsv(d: Design, units: Units): string {
  const t = TEMPLATES[d.template];
  const fab = fabricFor(d, d.fabricId);
  const rows: string[][] = [];
  rows.push([`${d.name} — ${t.name}`]);
  rows.push([`Fabric: ${fab.name} (${fab.gsm} GSM, ${fiberLabel(fab)})`]);
  rows.push([`Units: ${units === "in" ? "inches" : "centimeters"}`]);
  rows.push([]);
  rows.push(["Code", "Point of measure", "How to measure", "Tol +/-", "Grade", ...SIZES]);
  const specs = SIZES.map((s) => gradedSpec(d.base, d.grade, s));
  for (const code of t.poms) {
    const pom = POMS[code];
    rows.push([
      code,
      pom.name,
      pom.how,
      fmt(pom.tol, units),
      fmt(d.grade[code] ?? 0, units),
      ...specs.map((m) => fmt(m[code], units)),
    ]);
  }
  return rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n");
}

export function saveProject(d: Design): Promise<string | null> {
  const payload = JSON.stringify({ app: "THREADFORGE", schema: 2, savedAt: new Date().toISOString(), design: d });
  return download(new Blob([payload], { type: "application/json" }), `${slug(d.name)}.tforge`);
}

export async function openProject(file: File | string): Promise<Design> {
  const text = typeof file === "string" ? file : await file.text();
  const data = JSON.parse(text);
  const d = data?.design ?? data;
  if (!d || !d.template || !d.base || !Array.isArray(d.graphics)) throw new Error("That file isn't a THREADFORGE project.");
  return d as Design;
}
