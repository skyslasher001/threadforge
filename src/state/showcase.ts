// View settings for Showcase mode (not part of the design file, not in undo history).

import { create } from "zustand";
import type { Design, ProcessedGraphic } from "../types";

export interface ShowState {
  // colorway matrix
  matrixBack: boolean;
  // social
  socialFormat: string;
  socialBg: string;
  socialBack: boolean;
  socialColorway: string | null; // colorway id, null = current colors
  // 3D
  spin: boolean;
  spinSpeed: number; // turns per 10 s
  light: "studio" | "warm" | "night";
  recording: number | null; // 0..1 progress
  // photo mockups
  photoId: string | null;
  // line sheet
  sheetStyles: { name: string; design: Design }[];
  sheetPerPage: 2 | 4 | 6;
  // AI
  chips: Record<string, string>;
  extra: string;
  set: (p: Partial<ShowState>) => void;
}

export const useShow = create<ShowState>((set) => ({
  matrixBack: false,
  socialFormat: "post",
  socialBg: "#EDE9E1",
  socialBack: false,
  socialColorway: null,
  spin: true,
  spinSpeed: 1,
  light: "studio",
  recording: null,
  photoId: null,
  sheetStyles: [],
  sheetPerPage: 4,
  chips: {},
  extra: "",
  set: (p) => set(p),
}));

/** Cheap signature of everything that changes how a garment renders (skips image bytes). */
export function renderSig(d: Design, processed: Record<string, ProcessedGraphic>): string {
  const last = d.strokes[d.strokes.length - 1];
  return JSON.stringify([
    d.template, d.parts, d.base, d.grade, d.previewSize, d.fabricId, d.trimFabricId, d.bodyColor, d.trimColor,
    d.customFabrics.map((f) => f.id), d.layers.map((l) => [l.id, l.visible, l.opacity, l.blend]),
    d.strokes.length, last?.id, last?.points.length,
    d.graphics.map((g) => [g.id, g.view, g.x, g.y, g.w, g.rotation, g.method, g.colors, g.visible, g.src.length, processed[g.id]?.key]),
  ]);
}

export const previewsOf = (d: Design, processed: Record<string, ProcessedGraphic>) => {
  const p: Record<string, string> = {};
  for (const g of d.graphics) p[g.id] = g.method === "dtg" ? g.src : processed[g.id]?.preview ?? g.src;
  return p;
};
