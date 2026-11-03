// Core data model. All garment-space coordinates are in INCHES,
// origin at the high point shoulder line, x = 0 on center front/back.

export type View = "front" | "back";
export type Units = "in" | "cm";
export type Tool = "select" | "brush" | "eraser" | "hand";
export type TemplateId = "tee" | "longsleeve" | "crewneck" | "hoodie";
export type DecorationMethod = "screen" | "embroidery" | "dtg";
export type InkType = "plastisol" | "water" | "discharge" | "puff" | "metallic" | "glitter";
export type BrushStyle =
  | "technical" | "marker" | "ink" | "spray" | "pencil" | "neon" | "airbrush"
  | "watercolor" | "charcoal" | "halftone" | "riso" | "chrome";
export type BlendMode = "normal" | "multiply" | "screen" | "overlay";
export type Neckline = "crew" | "v" | "mock";
export type SleeveStyle = "setin" | "raglan" | "drop";
export type PocketStyle = "none" | "chest" | "kangaroo";
export type FitPreset = "regular" | "boxy" | "oversized" | "cropped";
export type ThemeId = "midnight" | "graphite" | "studio";
export type AccentId = "violet" | "ember" | "acid" | "ice";

export interface Pt {
  x: number;
  y: number;
  p: number; // pen pressure 0..1
}

export interface Layer {
  id: string;
  view: View;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blend: BlendMode;
}

export interface Stroke {
  id: string;
  view: View;
  layerId: string;
  style: BrushStyle | "erase";
  color: string;
  size: number; // inches
  opacity: number;
  points: Pt[];
  seed: number;
}

export interface Graphic {
  id: string;
  view: View;
  name: string;
  src: string; // original data URL
  natW: number;
  natH: number;
  x: number; // center, inches
  y: number;
  w: number; // placed width, inches
  rotation: number; // degrees
  method: DecorationMethod;
  colors: number; // ink / thread count for screen + embroidery
  underbase: boolean;
  visible: boolean;
  ink?: InkType; // screen print ink system
}

export interface Colorway {
  id: string;
  name: string;
  body: string;
  trim: string;
}

export interface Parts {
  neck: Neckline;
  sleeve: SleeveStyle;
  pocket: PocketStyle;
  fit: FitPreset;
}

export interface CustomFabric {
  id: string;
  name: string;
  construction: "Knit" | "Woven";
  gsm: number;
  stretch: "None" | "Low" | "Medium" | "High";
  fiber: { cotton: number; poly: number; nylon: number; elastane: number };
  tile: string; // seamless texture data URL
  tileInches: number; // real-world size of one tile
  costPerYard: number;
  supplier: string;
  note: string;
}

export interface BomRow {
  id: string;
  item: string;
  category: "Fabric" | "Trim" | "Label" | "Thread" | "Packaging" | "Decoration";
  supplier: string;
  article: string;
  color: string;
  qty: number; // per garment
  unit: string; // yd, pc, m, cone
  unitCost: number; // USD
  placement: string;
}

export interface Costing {
  fabricWidthIn: number; // usable fabric width
  wastePct: number;
  screenSetup: number; // per screen, per run
  printPerColor: number; // per print, per color
  embroideryPer1k: number; // per 1,000 stitches
  dtgPerPrint: number;
  laborCMT: number; // cut, make, trim per garment
  runQty: number; // order quantity for spreading setup costs
  marginPct: number; // target wholesale margin
  retailMultiple: number;
}

export interface Revision {
  id: string;
  at: number;
  rev: string;
  note: string;
}

export interface TechPack {
  styleNumber: string;
  season: string;
  brand: string;
  designer: string;
  revision: string;
  construction: string;
  care: string;
  labels: string;
  packaging: string;
  bom: BomRow[];
  costing: Costing;
  revisions: Revision[];
}

export interface Design {
  name: string;
  techpack?: TechPack;
  template: TemplateId;
  parts: Parts;
  layers: Layer[];
  customFabrics: CustomFabric[];
  fabricId: string;
  trimFabricId: string;
  bodyColor: string;
  trimColor: string;
  colorways: Colorway[];
  base: Record<string, number>; // base-size measurements (inches) keyed by POM code
  grade: Record<string, number>; // grade per size step (inches)
  previewSize: string;
  strokes: Stroke[];
  graphics: Graphic[];
}

export interface ProcessedGraphic {
  key: string; // cache key: id + method + colors + src length
  preview: string; // data URL of the decorated look
  inks: { hex: string; coverage: number }[];
  stitches?: number;
  stitchMinutes?: number;
}
