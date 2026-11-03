import { create } from "zustand";
import type {
  AccentId, BrushStyle, Design, Graphic, Layer, ProcessedGraphic, TemplateId, ThemeId, Tool, Units, View,
} from "../types";
import { TEMPLATES } from "../data/measurements";
import { readAppAutosave, writeAppAutosave } from "../lib/native";

export type Mode = "design" | "print" | "measure" | "techpack";
export type SideTab = "props" | "layers" | "history";

export interface Brush {
  style: BrushStyle;
  color: string;
  size: number; // inches
  opacity: number;
  stabilizer: number; // 0..100
  quickShape: boolean;
}

export interface Camera {
  x: number; // screen px of world origin
  y: number;
  s: number; // px per inch
}

interface Toast {
  id: number;
  text: string;
  tone: "info" | "good" | "warn";
}

export interface HistoryEntry {
  d: Design;
  label: string; // the action applied after `d` (undo stack) / that produced `d` (redo stack)
}

export interface Snapshot {
  id: string;
  name: string;
  at: number;
  d: Design;
}

export interface Workspace {
  id: string;
  name: string;
  mode: Mode;
  tool: Tool;
  sideTab: SideTab;
  sideWidth: number;
  showDims: boolean;
  showZones: boolean;
}

export const WORKSPACES: Workspace[] = [
  { id: "sketch", name: "Sketching", mode: "design", tool: "brush", sideTab: "props", sideWidth: 300, showDims: false, showZones: false },
  { id: "layout", name: "Artwork layout", mode: "design", tool: "select", sideTab: "props", sideWidth: 316, showDims: false, showZones: true },
  { id: "print", name: "Print prep", mode: "print", tool: "select", sideTab: "props", sideWidth: 340, showDims: false, showZones: true },
  { id: "measure", name: "Measuring", mode: "measure", tool: "select", sideTab: "props", sideWidth: 720, showDims: true, showZones: false },
];

interface State {
  design: Design;
  past: HistoryEntry[];
  future: HistoryEntry[];
  snapshots: Snapshot[];
  tool: Tool;
  mode: Mode;
  brush: Brush;
  symmetry: boolean;
  clip: boolean;
  showDims: boolean;
  showZones: boolean;
  showStitches: boolean;
  compareSize: string | null;
  units: Units;
  theme: ThemeId;
  accent: AccentId;
  selected: string | null;
  activeView: View;
  activeLayer: Record<View, string>;
  sideTab: SideTab;
  sideWidth: number;
  sideOpen: boolean;
  railOpen: boolean;
  workspace: string;
  palette: boolean;
  focus: boolean;
  camera: Camera;
  fitRequest: number;
  processed: Record<string, ProcessedGraphic>;
  toasts: Toast[];
  bench: { running: boolean; result: BenchResult | null };

  commit: (fn: (d: Design) => Design, label?: string) => void;
  live: (fn: (d: Design) => Design) => void;
  checkpoint: (label?: string) => void;
  undo: () => void;
  redo: () => void;
  jumpTo: (index: number) => void;
  set: (p: Partial<State>) => void;
  setBrush: (p: Partial<Brush>) => void;
  setTemplate: (t: TemplateId) => void;
  updateGraphic: (id: string, p: Partial<Graphic>, history?: boolean) => void;
  removeGraphic: (id: string) => void;
  toast: (text: string, tone?: Toast["tone"]) => void;
  loadDesign: (d: Design) => void;
  applyWorkspace: (id: string) => void;
  layerFor: (view: View) => Layer;
}

export interface BenchResult {
  paths: number;
  panFps: number;
  p95FrameMs: number;
  fullRenderMs: number;
  addStrokeMs: number;
  coldStartMs: number;
}

export const uid = () => Math.random().toString(36).slice(2, 10);

export function defaultLayers(): Layer[] {
  return (["front", "back"] as View[]).map((view) => ({
    id: `${view}-sketch-${uid()}`, view, name: "Sketch", visible: true, locked: false, opacity: 1, blend: "normal",
  }));
}

export function newDesign(template: TemplateId = "tee"): Design {
  const t = TEMPLATES[template];
  return {
    name: "Untitled drop",
    template,
    parts: { neck: "crew", sleeve: template === "tee" ? "setin" : "setin", pocket: template === "hoodie" ? "kangaroo" : "none", fit: "regular" },
    layers: defaultLayers(),
    customFabrics: [],
    fabricId: template === "hoodie" || template === "crewneck" ? "fleece" : "hw-jersey",
    trimFabricId: "rib",
    bodyColor: "#E9E4D8",
    trimColor: "#E9E4D8",
    colorways: [
      { id: uid(), name: "Bone", body: "#E9E4D8", trim: "#E9E4D8" },
      { id: uid(), name: "Washed black", body: "#2A2A2D", trim: "#2A2A2D" },
      { id: uid(), name: "Navy / bone", body: "#1F2A44", trim: "#E9E4D8" },
      { id: uid(), name: "Brick", body: "#B8322E", trim: "#7A1F2B" },
    ],
    base: { ...t.base },
    grade: { ...t.grade },
    previewSize: "M",
    strokes: [],
    graphics: [],
  };
}

/** Bring older project files up to the current schema. */
export function migrate(raw: Design): Design {
  const d = { ...raw } as Design;
  if (!d.parts) d.parts = { neck: "crew", sleeve: "setin", pocket: d.template === "hoodie" ? "kangaroo" : "none", fit: "regular" };
  if (!d.customFabrics) d.customFabrics = [];
  if (!d.layers || !d.layers.length) d.layers = defaultLayers();
  for (const v of ["front", "back"] as View[]) {
    if (!d.layers.some((l) => l.view === v)) d.layers = [...d.layers, ...defaultLayers().filter((l) => l.view === v)];
  }
  const first = (v: View) => d.layers.find((l) => l.view === v)!.id;
  d.strokes = (d.strokes ?? []).map((s) => (s.layerId && d.layers.some((l) => l.id === s.layerId) ? s : { ...s, layerId: first(s.view) }));
  d.graphics = d.graphics ?? [];
  return d;
}

const AUTOSAVE_KEY = "threadforge.autosave.v1";
const PREFS_KEY = "threadforge.prefs.v2";

function loadSaved(): { d: Design; at: number } | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const d = (parsed.design ?? parsed) as Design;
    return d && d.template && d.base ? { d: migrate(d), at: parsed.savedAt ?? 0 } : null;
  } catch {
    return null;
  }
}

function loadPrefs(): Partial<State> {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const HISTORY_MAX = 150;
let toastId = 1;
const saved = loadSaved();
const initial = saved?.d ?? newDesign("tee");

const firstLayers = (d: Design): Record<View, string> => ({
  front: d.layers.find((l) => l.view === "front")!.id,
  back: d.layers.find((l) => l.view === "back")!.id,
});

export const useStore = create<State>((set, get) => ({
  design: initial,
  past: [],
  future: [],
  snapshots: [],
  tool: "select",
  mode: "design",
  brush: { style: "ink", color: "#111114", size: 0.25, opacity: 1, stabilizer: 45, quickShape: true },
  symmetry: false,
  clip: true,
  showDims: false,
  showZones: false,
  showStitches: true,
  compareSize: null,
  units: "in",
  theme: "midnight",
  accent: "violet",
  selected: null,
  activeView: "front",
  activeLayer: firstLayers(initial),
  sideTab: "props",
  sideWidth: 316,
  sideOpen: true,
  railOpen: true,
  workspace: "layout",
  palette: false,
  focus: false,
  camera: { x: 0, y: 0, s: 8 },
  fitRequest: 1,
  processed: {},
  toasts: [],
  bench: { running: false, result: null },
  ...loadPrefs(),

  commit: (fn, label = "Edit") => {
    const { design, past } = get();
    const next = fn(design);
    if (next === design) return;
    set({ design: next, past: [...past, { d: design, label }].slice(-HISTORY_MAX), future: [] });
  },
  live: (fn) => set({ design: fn(get().design) }),
  checkpoint: (label = "Edit") => {
    const { design, past } = get();
    set({ past: [...past, { d: design, label }].slice(-HISTORY_MAX), future: [] });
  },
  undo: () => {
    const { past, design, future } = get();
    if (!past.length) return;
    const e = past[past.length - 1];
    set({ design: e.d, past: past.slice(0, -1), future: [{ d: design, label: e.label }, ...future] });
  },
  redo: () => {
    const { past, design, future } = get();
    if (!future.length) return;
    const e = future[0];
    set({ design: e.d, past: [...past, { d: design, label: e.label }], future: future.slice(1) });
  },
  jumpTo: (index) => {
    // index 0 = oldest state, past.length = current
    let cur = get().past.length;
    while (cur > index && get().past.length) { get().undo(); cur--; }
    while (cur < index && get().future.length) { get().redo(); cur++; }
  },
  set: (p) => set(p as State),
  setBrush: (p) => set({ brush: { ...get().brush, ...p } }),
  setTemplate: (template) => {
    const t = TEMPLATES[template];
    get().commit((d) => ({
      ...d,
      template,
      base: { ...t.base },
      grade: { ...t.grade },
      parts: { ...d.parts, fit: "regular", pocket: template === "hoodie" ? "kangaroo" : d.parts.pocket === "kangaroo" ? "none" : d.parts.pocket, neck: template === "hoodie" ? "crew" : d.parts.neck },
      fabricId: template === "hoodie" || template === "crewneck"
        ? (["fleece", "terry"].includes(d.fabricId) || d.fabricId.startsWith("custom") ? d.fabricId : "fleece")
        : (["fleece", "terry"].includes(d.fabricId) ? "hw-jersey" : d.fabricId),
    }), `Garment: ${t.name}`);
    set({ fitRequest: get().fitRequest + 1 });
  },
  updateGraphic: (id, p, history = true) => {
    const fn = (d: Design) => ({ ...d, graphics: d.graphics.map((g) => (g.id === id ? { ...g, ...p } : g)) });
    if (history) get().commit(fn, "Edit graphic");
    else get().live(fn);
  },
  removeGraphic: (id) => {
    get().commit((d) => ({ ...d, graphics: d.graphics.filter((g) => g.id !== id) }), "Delete graphic");
    if (get().selected === id) set({ selected: null });
  },
  toast: (text, tone = "info") => {
    const id = toastId++;
    set({ toasts: [...get().toasts, { id, text, tone }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 3400);
  },
  loadDesign: (raw) => {
    const d = migrate(raw);
    set({ design: d, past: [], future: [], selected: null, processed: {}, activeLayer: firstLayers(d), fitRequest: get().fitRequest + 1 });
  },
  applyWorkspace: (id) => {
    const w = WORKSPACES.find((x) => x.id === id);
    if (!w) return;
    set({ workspace: id, mode: w.mode, tool: w.tool, sideTab: w.sideTab, sideWidth: w.sideWidth, showDims: w.showDims, showZones: w.showZones, sideOpen: true, railOpen: true });
    setTimeout(() => set({ fitRequest: get().fitRequest + 1 }), 240);
  },
  layerFor: (view) => {
    const { design, activeLayer } = get();
    return design.layers.find((l) => l.id === activeLayer[view] && l.view === view) ?? design.layers.filter((l) => l.view === view).slice(-1)[0];
  },
}));

// ---- Autosave: local storage (instant) + app data folder on desktop (crash recovery) ----
let saveTimer: number | undefined;
let warned = false;
useStore.subscribe((s, prev) => {
  if (s.design !== prev.design) {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      const json = JSON.stringify({ app: "THREADFORGE", schema: 2, savedAt: Date.now(), design: useStore.getState().design });
      try {
        localStorage.setItem(AUTOSAVE_KEY, json);
      } catch {
        if (!warned) {
          warned = true;
          useStore.getState().toast("Browser autosave is full (large images). Desktop autosave and Save project still work.", "warn");
        }
      }
      void writeAppAutosave(json);
    }, 900);
  }
  if (s.units !== prev.units || s.theme !== prev.theme || s.accent !== prev.accent || s.brush !== prev.brush || s.sideWidth !== prev.sideWidth) {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ units: s.units, theme: s.theme, accent: s.accent, brush: s.brush, sideWidth: s.sideWidth }));
    } catch {
      /* preferences are a convenience */
    }
  }
});

/** On desktop, recover the newer of the two autosaves (e.g. after a crash or a full local store). */
export async function recoverFromAppData(): Promise<boolean> {
  const text = await readAppAutosave();
  if (!text) return false;
  try {
    const parsed = JSON.parse(text);
    const at = parsed.savedAt ?? 0;
    if (parsed.design && at > (saved?.at ?? 0) + 1000) {
      useStore.getState().loadDesign(parsed.design);
      useStore.getState().toast(`Recovered your work from ${new Date(at).toLocaleString()}`, "good");
      return true;
    }
  } catch {
    /* ignore unreadable autosave */
  }
  return false;
}

export const hasAutosave = () => {
  try {
    return !!localStorage.getItem(AUTOSAVE_KEY);
  } catch {
    return false;
  }
};
