// Macros: record what you change on one design, replay it on others (or a whole folder of projects).
// A recording is the difference between the design when you pressed Record and when you pressed Stop,
// limited to style-level settings, plus any "Export everything" you ran while recording.

import { create } from "zustand";
import type { Design, Graphic } from "../types";
import { migrate, uid, useStore } from "../state/store";
import { FABRICS } from "../data/fabrics";
import { TEMPLATES } from "../data/measurements";
import { isTauri } from "./native";
import { techpackOf } from "./production";
import type { BundleOpts } from "./bundle";

/** Design fields a macro may carry. Name, artwork pixels and drawing stay with each design. */
export const MACRO_FIELDS = ["template", "parts", "fabricId", "trimFabricId", "bodyColor", "trimColor", "colorways", "base", "grade", "previewSize", "customFabrics", "techpack"] as const;
type MacroField = (typeof MACRO_FIELDS)[number];
const GRAPHIC_PROPS = ["method", "colors", "ink", "underbase", "w", "rotation"] as const;
type GraphicProp = (typeof GRAPHIC_PROPS)[number];

export type MacroStep =
  | { kind: "fields"; values: Partial<Pick<Design, MacroField>> }
  | { kind: "graphics"; props: Partial<Pick<Graphic, GraphicProp>> }
  | { kind: "bundle"; opts: BundleOpts };

export interface Macro { id: string; name: string; steps: MacroStep[]; createdAt: number }

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function diffSteps(a: Design, b: Design): MacroStep[] {
  const steps: MacroStep[] = [];
  const values: Partial<Pick<Design, MacroField>> = {};
  for (const f of MACRO_FIELDS) if (!same(a[f], b[f])) (values as Record<string, unknown>)[f] = structuredClone(b[f]);
  if (values.techpack) {
    // style identity stays with each design: never copy a style number or revision log
    const { styleNumber: _s, revisions: _r, ...shared } = values.techpack;
    void _s; void _r;
    values.techpack = shared as Design["techpack"];
  }
  if (Object.keys(values).length) steps.push({ kind: "fields", values });
  // artwork settings changed the same way on every graphic that changed
  const props: Partial<Pick<Graphic, GraphicProp>> = {};
  for (const gb of b.graphics) {
    const ga = a.graphics.find((g) => g.id === gb.id);
    if (!ga) continue;
    for (const p of GRAPHIC_PROPS) if (!same(ga[p], gb[p])) (props as Record<string, unknown>)[p] = gb[p];
  }
  if (Object.keys(props).length) steps.push({ kind: "graphics", props });
  return steps;
}

export function applySteps(d: Design, steps: MacroStep[]): Design {
  let out = migrate(structuredClone(d));
  for (const s of steps) {
    if (s.kind === "fields") {
      const v = structuredClone(s.values);
      const techpack = v.techpack ? { ...techpackOf(out), ...v.techpack } : out.techpack;
      out = { ...out, ...v, techpack };
    }
    if (s.kind === "graphics") out = { ...out, graphics: out.graphics.map((g) => ({ ...g, ...s.props })) };
  }
  return out;
}

/** Plain-language list of what a macro does. */
export function describe(steps: MacroStep[]): string[] {
  const out: string[] = [];
  for (const s of steps) {
    if (s.kind === "bundle") { out.push("Export everything (ZIP)"); continue; }
    if (s.kind === "graphics") {
      const p = s.props;
      const bits = [p.method && ({ screen: "screen print", embroidery: "embroidery", dtg: "DTG" })[p.method], p.colors && `${p.colors} colors`, p.ink && `${p.ink} ink`, p.w && `${p.w.toFixed(2)} in wide`, p.underbase !== undefined && (p.underbase ? "underbase on" : "underbase off"), p.rotation !== undefined && `${p.rotation}°`].filter(Boolean);
      out.push(`Artwork → ${bits.join(", ")}`);
      continue;
    }
    const v = s.values;
    if (v.template) out.push(`Garment → ${TEMPLATES[v.template].name}`);
    if (v.parts) out.push(`Fit and parts → ${v.parts.fit}, ${v.parts.neck} neck, ${v.parts.sleeve} sleeve, ${v.parts.pocket} pocket`);
    if (v.fabricId) out.push(`Fabric → ${FABRICS.find((f) => f.id === v.fabricId)?.name ?? "custom fabric"}`);
    if (v.trimFabricId) out.push(`Trim fabric → ${FABRICS.find((f) => f.id === v.trimFabricId)?.name ?? "custom"}`);
    if (v.bodyColor || v.trimColor) out.push(`Colors → body ${v.bodyColor ?? "unchanged"}, trim ${v.trimColor ?? "unchanged"}`);
    if (v.colorways) out.push(`Colorways → ${v.colorways.length}: ${v.colorways.map((c) => c.name).join(", ")}`);
    if (v.base || v.grade) out.push("Measurements → base size and grade rules");
    if (v.previewSize) out.push(`Preview size → ${v.previewSize}`);
    if (v.customFabrics) out.push(`Custom fabrics → ${v.customFabrics.length}`);
    if (v.techpack) out.push("Tech pack → style info, BOM, costing and notes");
  }
  return out.length ? out : ["(no changes recorded)"];
}

// ---------------- library + recorder ----------------

const KEY = "threadforge.macros.v1";
const FILE = "macros.json";

function load(): Macro[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}

interface MacroState {
  macros: Macro[];
  recording: { start: Design; extra: MacroStep[] } | null;
  set: (p: Partial<MacroState>) => void;
}

export const useMacros = create<MacroState>((set) => ({ macros: load(), recording: null, set: (p) => set(p) }));

useMacros.subscribe(async (s, prev) => {
  if (s.macros === prev.macros) return;
  const json = JSON.stringify(s.macros);
  try { localStorage.setItem(KEY, json); } catch { /* app-data copy below */ }
  if (isTauri()) {
    try {
      const fs = await import("@tauri-apps/plugin-fs");
      const baseDir = fs.BaseDirectory.AppData;
      await fs.writeTextFile(FILE, json, { baseDir });
    } catch { /* best effort */ }
  }
});

export async function loadMacrosFromAppData() {
  if (!isTauri() || useMacros.getState().macros.length) return;
  try {
    const fs = await import("@tauri-apps/plugin-fs");
    const baseDir = fs.BaseDirectory.AppData;
    if (await fs.exists(FILE, { baseDir })) useMacros.getState().set({ macros: JSON.parse(await fs.readTextFile(FILE, { baseDir })) });
  } catch { /* none saved */ }
}

export function startRecording() {
  useMacros.getState().set({ recording: { start: structuredClone(useStore.getState().design), extra: [] } });
}

/** Called by "Export everything" so a recording can include the export. */
export function noteBundle(opts: BundleOpts) {
  const r = useMacros.getState().recording;
  if (r) useMacros.getState().set({ recording: { ...r, extra: [...r.extra.filter((s) => s.kind !== "bundle"), { kind: "bundle", opts: structuredClone(opts) }] } });
}

export function stopRecording(name: string): Macro | null {
  const r = useMacros.getState().recording;
  useMacros.getState().set({ recording: null });
  if (!r) return null;
  const steps = [...diffSteps(r.start, useStore.getState().design), ...r.extra];
  if (!steps.length) return null;
  const m: Macro = { id: uid(), name: name.trim() || `Macro ${useMacros.getState().macros.length + 1}`, steps, createdAt: Date.now() };
  useMacros.getState().set({ macros: [m, ...useMacros.getState().macros] });
  return m;
}
