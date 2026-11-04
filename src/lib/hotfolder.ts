// Hot folder: drop artwork into a folder and THREADFORGE turns each file into finished deliverables.
// For every new image it places the art on a template design, optionally runs a macro, then writes
// the "Export everything" files into <folder>/THREADFORGE out/<artwork>/.

import { create } from "zustand";
import type { DecorationMethod, Design, View } from "../types";
import { migrate, useStore } from "../state/store";
import { makeGraphic } from "./graphics";
import { applySteps, useMacros } from "./macros";
import { buildBundle, DEFAULT_BUNDLE, type BundleOpts } from "./bundle";
import { processAll } from "./linesheet";
import { isTauri } from "./native";
import { loadImage } from "./imaging";

export const OUT_DIR = "THREADFORGE out";
const IMAGE = /\.(png|jpe?g|webp|svg)$/i;

/** Folder access; the desktop app uses the fs plugin, tests use an in-memory folder. */
export interface FolderIO {
  label: string;
  list(): Promise<{ name: string; size: number }[]>; // files directly in the folder
  read(name: string): Promise<Uint8Array>;
  write(path: string, data: Uint8Array): Promise<void>; // path relative to the folder, "/" separated
  readText(path: string): Promise<string | null>;
}

export function tauriFolder(dir: string): FolderIO {
  const sep = dir.includes("\\") ? "\\" : "/";
  const join = (p: string) => [dir.replace(/[\\/]+$/, ""), ...p.split("/")].join(sep);
  return {
    label: dir,
    list: async () => {
      const fs = await import("@tauri-apps/plugin-fs");
      const out: { name: string; size: number }[] = [];
      for (const e of await fs.readDir(dir)) {
        if (!e.isFile || !IMAGE.test(e.name)) continue;
        const st = await fs.stat(join(e.name)).catch(() => null);
        if (st) out.push({ name: e.name, size: st.size });
      }
      return out;
    },
    read: async (name) => (await import("@tauri-apps/plugin-fs")).readFile(join(name)),
    write: async (path, data) => {
      const fs = await import("@tauri-apps/plugin-fs");
      const parts = path.split("/");
      if (parts.length > 1) await fs.mkdir(join(parts.slice(0, -1).join("/")), { recursive: true }).catch(() => undefined);
      await fs.writeFile(join(path), data);
    },
    readText: async (path) => {
      const fs = await import("@tauri-apps/plugin-fs");
      try { return (await fs.exists(join(path))) ? await fs.readTextFile(join(path)) : null; } catch { return null; }
    },
  };
}

export function memoryFolder(label = "memory"): FolderIO & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    label, files,
    list: async () => [...files.entries()].filter(([k]) => !k.includes("/") && IMAGE.test(k)).map(([name, b]) => ({ name, size: b.length })),
    read: async (n) => files.get(n)!,
    write: async (p, d) => { files.set(p, d); },
    readText: async (p) => (files.has(p) ? new TextDecoder().decode(files.get(p)) : null),
  };
}

export interface HotSettings {
  view: View;
  zone: string;
  method: DecorationMethod;
  colors: number;
  macroId: string | null;
  bundle: BundleOpts;
}

export interface HotItem { name: string; status: "waiting" | "working" | "done" | "failed"; files?: number; error?: string; at: number; ms?: number }

interface HotState {
  folder: FolderIO | null;
  running: boolean;
  template: Design | null;
  settings: HotSettings;
  items: HotItem[];
  set: (p: Partial<HotState>) => void;
}

export const DEFAULT_HOT: HotSettings = {
  view: "front", zone: "full-front", method: "screen", colors: 4, macroId: null,
  bundle: { ...DEFAULT_BUNDLE, colorways: "working", social: ["post", "product"], linesheet: false, labels: false, photos: false },
};

export const useHot = create<HotState>((set) => ({ folder: null, running: false, template: null, settings: DEFAULT_HOT, items: [], set: (p) => set(p) }));

const ledgerPath = `${OUT_DIR}/.processed.json`;
const sizes = new Map<string, number>();
let timer = 0;
let busy = false;

const mime = (n: string) => (/\.png$/i.test(n) ? "image/png" : /\.svg$/i.test(n) ? "image/svg+xml" : /\.webp$/i.test(n) ? "image/webp" : "image/jpeg");

async function toImage(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes as BlobPart], { type: mime(name) });
  const src = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  const img = await loadImage(src);
  return { src, w: img.naturalWidth, h: img.naturalHeight };
}

/** One artwork file -> a finished design and its deliverables. */
export async function processArtwork(io: FolderIO, name: string, template: Design, s: HotSettings): Promise<number> {
  const img = await toImage(await io.read(name), name);
  const base = name.replace(/\.[^.]+$/, "");
  let d: Design = migrate(structuredClone(template));
  d = { ...d, name: base, graphics: [], strokes: [] };
  const g = { ...makeGraphic(d, s.view, img, base, undefined, s.zone), method: s.method, colors: s.colors };
  d = { ...d, graphics: [g] };
  const macro = s.macroId ? useMacros.getState().macros.find((m) => m.id === s.macroId) : null;
  if (macro) d = applySteps(d, macro.steps);
  const processed = await processAll(d);
  const entries = await buildBundle(d, processed, useStore.getState().units, s.bundle);
  // bundle paths start with "<design>/": keep that as the per-artwork folder
  for (const e of entries) await io.write(`${OUT_DIR}/${e.path}`, e.data);
  return entries.length;
}

async function loadLedger(io: FolderIO): Promise<Record<string, number>> {
  try { return JSON.parse((await io.readText(ledgerPath)) ?? "{}"); } catch { return {}; }
}

/** One poll: anything new and finished copying (same size twice in a row) gets processed. */
export async function scanOnce(): Promise<void> {
  const st = useHot.getState();
  if (!st.folder || !st.template || busy) return;
  busy = true;
  try {
    const io = st.folder;
    const ledger = await loadLedger(io);
    for (const f of await io.list()) {
      if (ledger[f.name] === f.size) continue;
      if (sizes.get(f.name) !== f.size) { sizes.set(f.name, f.size); upsert({ name: f.name, status: "waiting", at: Date.now() }); continue; }
      const t0 = performance.now();
      upsert({ name: f.name, status: "working", at: Date.now() });
      try {
        const n = await processArtwork(io, f.name, useHot.getState().template!, useHot.getState().settings);
        ledger[f.name] = f.size;
        await io.write(ledgerPath, new TextEncoder().encode(JSON.stringify(ledger, null, 1)));
        upsert({ name: f.name, status: "done", files: n, at: Date.now(), ms: performance.now() - t0 });
        useStore.getState().toast(`Hot folder: ${f.name} → ${n} files`, "good");
      } catch (e) {
        ledger[f.name] = f.size; // don't retry a broken file forever; drop it in again to retry
        await io.write(ledgerPath, new TextEncoder().encode(JSON.stringify(ledger, null, 1))).catch(() => undefined);
        upsert({ name: f.name, status: "failed", error: (e as Error).message, at: Date.now() });
      }
      if (!useHot.getState().running) break;
    }
  } finally {
    busy = false;
  }
}

function upsert(it: HotItem) {
  const items = useHot.getState().items.filter((x) => x.name !== it.name);
  useHot.getState().set({ items: [it, ...items].slice(0, 200) });
}

export function startHot(folder: FolderIO, template: Design, settings: HotSettings, intervalMs = 2500) {
  stopHot();
  sizes.clear();
  useHot.getState().set({ folder, template: structuredClone(template), settings, running: true });
  const tick = async () => {
    if (!useHot.getState().running) return;
    await scanOnce().catch(() => undefined);
    timer = window.setTimeout(tick, intervalMs);
  };
  tick();
}

export function stopHot() {
  clearTimeout(timer);
  useHot.getState().set({ running: false });
}

export async function pickHotFolder(): Promise<FolderIO | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const dir = await open({ directory: true, recursive: true, multiple: false, title: "Choose a hot folder" });
  return typeof dir === "string" ? tauriFolder(dir) : null;
}
