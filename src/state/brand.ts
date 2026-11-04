// Brand Kit: one per user, shared by every project. Saved in the browser and, on desktop,
// in the app-data folder (brandkit.json) so it survives reinstalls of the web view cache.

import { create } from "zustand";
import type { Design } from "../types";
import { techpackOf } from "../lib/production";
import { isTauri } from "../lib/native";
import { luminance } from "../data/fabrics";

export type FontId = "inter" | "grotesk" | "serif" | "mono" | "impact";
export const FONTS: { id: FontId; name: string; css: string; pdf: "helvetica" | "times" | "courier"; weight: number }[] = [
  { id: "inter", name: "Clean sans", css: `"Inter Variable", Inter, "Segoe UI", system-ui, sans-serif`, pdf: "helvetica", weight: 700 },
  { id: "grotesk", name: "Wide grotesk", css: `"Arial Black", "Segoe UI Black", "Inter Variable", sans-serif`, pdf: "helvetica", weight: 900 },
  { id: "serif", name: "Editorial serif", css: `Georgia, "Times New Roman", serif`, pdf: "times", weight: 700 },
  { id: "mono", name: "Utility mono", css: `"JetBrains Mono Variable", "Cascadia Mono", Consolas, monospace`, pdf: "courier", weight: 700 },
  { id: "impact", name: "Condensed impact", css: `Impact, "Haettenschweiler", "Arial Narrow Bold", sans-serif`, pdf: "helvetica", weight: 400 },
];
export const fontOf = (id: FontId) => FONTS.find((f) => f.id === id) ?? FONTS[0];

export interface BrandColor { name: string; hex: string }

export interface BrandKit {
  name: string;
  tagline: string;
  website: string; // site or @handle
  logo: string | null; // trimmed PNG data URL
  logoW: number;
  logoH: number;
  logoLum: number; // mean luminance of the logo's ink, 0..1
  colors: BrandColor[]; // first = primary
  headingFont: FontId;
  bodyFont: FontId;
  labelBg: string; // woven label ground
  labelInk: string;
  madeIn: string;
  rn: string; // RN / CA registration number for care labels
  updatedAt: number;
}

export const EMPTY_KIT: BrandKit = {
  name: "", tagline: "", website: "", logo: null, logoW: 0, logoH: 0, logoLum: 0,
  colors: [{ name: "Ink", hex: "#141418" }, { name: "Bone", hex: "#E9E4D8" }],
  headingFont: "grotesk", bodyFont: "inter", labelBg: "#141418", labelInk: "#F4F1EA", madeIn: "", rn: "", updatedAt: 0,
};

const KEY = "threadforge.brandkit.v1";
const FILE = "brandkit.json";

function loadLocal(): BrandKit {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...EMPTY_KIT, ...JSON.parse(raw) } : EMPTY_KIT;
  } catch {
    return EMPTY_KIT;
  }
}

interface BrandState { kit: BrandKit; set: (p: Partial<BrandKit>) => void; replace: (k: BrandKit) => void }

export const useBrand = create<BrandState>((set, get) => ({
  kit: loadLocal(),
  set: (p) => set({ kit: { ...get().kit, ...p, updatedAt: Date.now() } }),
  replace: (k) => set({ kit: { ...EMPTY_KIT, ...k } }),
}));

let timer = 0;
useBrand.subscribe((s, prev) => {
  if (s.kit === prev.kit) return;
  clearTimeout(timer);
  timer = window.setTimeout(async () => {
    const json = JSON.stringify(useBrand.getState().kit);
    try { localStorage.setItem(KEY, json); } catch { /* the app-data copy still saves */ }
    if (isTauri()) {
      try {
        const fs = await import("@tauri-apps/plugin-fs");
        const baseDir = fs.BaseDirectory.AppData;
        await fs.mkdir("", { baseDir, recursive: true }).catch(() => undefined);
        await fs.writeTextFile(FILE, json, { baseDir });
      } catch { /* best effort */ }
    }
  }, 400);
});

/** Desktop: prefer the app-data copy when it's newer than the browser's. */
export async function loadBrandFromAppData() {
  if (!isTauri()) return;
  try {
    const fs = await import("@tauri-apps/plugin-fs");
    const baseDir = fs.BaseDirectory.AppData;
    if (!(await fs.exists(FILE, { baseDir }))) return;
    const k = JSON.parse(await fs.readTextFile(FILE, { baseDir })) as BrandKit;
    if ((k.updatedAt ?? 0) > useBrand.getState().kit.updatedAt) useBrand.getState().replace(k);
  } catch { /* keep the browser copy */ }
}

/** The brand name for a design: its own override, then the tech pack, then the Brand Kit. */
export const brandName = (d: Design) => d.showcase?.brand || techpackOf(d).brand || useBrand.getState().kit.name;
export const brandKit = () => useBrand.getState().kit;

const tintCache = new Map<string, string>();
/**
 * The logo as it should appear on `bg`: unchanged when it reads well, otherwise recolored in one
 * contrasting ink (a dark logo on a dark cover becomes off-white, and vice versa).
 */
export async function logoOn(bg: string, kit = brandKit()): Promise<string | null> {
  if (!kit.logo) return null;
  const bgLum = luminance(bg);
  if (Math.abs(bgLum - kit.logoLum) > 0.28) return kit.logo;
  const ink = bgLum < 0.4 ? "#F4F1EA" : "#141418";
  const key = `${kit.updatedAt}|${ink}`;
  const hit = tintCache.get(key);
  if (hit) return hit;
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = kit.logo!; });
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = ink;
  g.fillRect(0, 0, c.width, c.height);
  const url = c.toDataURL("image/png");
  tintCache.set(key, url);
  return url;
}
