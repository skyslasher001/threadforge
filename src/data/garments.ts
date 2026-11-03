import type { Parts, TemplateId, View } from "../types";
import { TEMPLATES } from "./measurements";

// Parametric flat geometry. Everything is generated from the spec, so
// editing a measurement redraws the garment. Units: inches.

type P = [number, number];

export interface Zone {
  id: string;
  name: string;
  x: number; // center
  y: number;
  w: number;
  h: number;
}

export interface DimLine {
  code: string;
  a: P;
  b: P;
  label: P; // label anchor
  angle: number; // label rotation in degrees
}

export interface GarmentGeom {
  body: string; // outline incl. sleeves (and hood on back view)
  ribs: string[]; // rib parts (cuffs, hem band, collar)
  hood?: string; // front hood surround
  hoodInner?: string; // visible hood lining
  pocket?: string;
  seams: string[]; // structural seam lines (solid, thin)
  stitches: string[]; // topstitch / coverstitch (dashed)
  cords?: { a: P; b: P }[];
  folds: { d: string; w: number }[]; // soft shading folds
  zones: Zone[];
  dims: DimLine[];
  bounds: { x0: number; y0: number; x1: number; y1: number };
  center: { chestY: number; hemY: number };
}

const f = (n: number) => +n.toFixed(3);
const pt = (p: P) => `${f(p[0])} ${f(p[1])}`;
const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
const mul = (a: P, k: number): P => [a[0] * k, a[1] * k];
const mirror = (p: P): P => [-p[0], p[1]];
const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export const defaultParts = (template: TemplateId): Parts => ({
  neck: "crew",
  sleeve: "setin",
  pocket: template === "hoodie" ? "kangaroo" : "none",
  fit: "regular",
});

export function buildGarment(template: TemplateId, view: View, m: Record<string, number>, parts: Parts = defaultParts(template)): GarmentGeom {
  const t = TEMPLATES[template];
  const neckStyle = t.hood ? "crew" : parts.neck;
  const slope = 1.25;
  const cw = m.A / 2;
  const L = m.B;
  const sw = m.C / 2;
  const sl = m.D;
  const hx = m.H / 2;
  const nx = m.I / 2;
  const rawDrop = view === "front" ? m.J : m.JB;
  const drop = neckStyle === "mock" ? Math.min(rawDrop, 1.25) : rawDrop;
  const vNeck = neckStyle === "v" && view === "front";
  const vDepth = drop + 2.75;
  const dropShoulder = parts.sleeve === "drop";
  const uaY = slope + m.E * 0.9 + (dropShoulder ? 1.5 : 0);
  const th = (t.sleeveAngle * Math.PI) / 180;
  const dir: P = [Math.cos(th), Math.sin(th)];
  const perp: P = [-Math.sin(th), Math.cos(th)];
  const out: P = [Math.sin(th), -Math.cos(th)]; // outward normal of sleeve top edge

  const NS: P = [nx, 0];
  const SP: P = dropShoulder ? [sw + 2, slope + 0.7] : [sw, slope];
  const T: P = add(SP, mul(dir, sl));
  const B: P = add(T, mul(perp, m.G));
  const UA: P = [cw, uaY];
  const HEM: P = [hx, L];

  const neck = (dx: number, dy: number) =>
    vNeck
      ? `L ${pt([0, vDepth + dy])} L ${pt([nx + dx, 0])}`
      : `C ${pt([-nx - dx, (drop + dy) * 0.6])} ${pt([-(nx + dx) * 0.55, drop + dy])} ${pt([0, drop + dy])} ` +
    `C ${pt([(nx + dx) * 0.55, drop + dy])} ${pt([nx + dx, (drop + dy) * 0.6])} ${pt([nx + dx, 0])}`;

  // Armhole curve control, bowing toward the body.
  const ahCtl: P = [SP[0] - 0.6, SP[1] + (uaY - SP[1]) * 0.65];

  const body =
    `M ${pt(mirror(NS))} ${neck(0, 0)} L ${pt(SP)} L ${pt(T)} L ${pt(B)} L ${pt(UA)} ` +
    `Q ${pt([cw + 0.15, (uaY + L) / 2])} ${pt(HEM)} L ${pt(mirror(HEM))} ` +
    `Q ${pt([-cw - 0.15, (uaY + L) / 2])} ${pt(mirror(UA))} L ${pt(mirror(B))} L ${pt(mirror(T))} L ${pt(mirror(SP))} Z`;

  const ribs: string[] = [];
  const seams: string[] = [];
  const stitches: string[] = [];
  const folds: { d: string; w: number }[] = [];

  // Shoulder + armhole seams.
  for (const s of [1, -1]) {
    const m2 = (p: P): P => (s === 1 ? p : mirror(p));
    if (parts.sleeve === "raglan") {
      // Raglan seam runs from the neckline diagonally to the underarm.
      const start: P = [nx * 0.92, Math.min(drop, 1.2) * 0.35 + 0.2];
      seams.push(`M ${pt(m2(start))} Q ${pt(m2([cw - 1.4, uaY * 0.42]))} ${pt(m2(UA))}`);
      stitches.push(`M ${pt(m2([start[0] + 0.22, start[1] + 0.05]))} Q ${pt(m2([cw - 1.15, uaY * 0.42]))} ${pt(m2([UA[0] + 0.05, UA[1] - 0.3]))}`);
    } else {
      seams.push(`M ${pt(m2(NS))} L ${pt(m2(SP))}`);
      seams.push(`M ${pt(m2(SP))} Q ${pt(m2(ahCtl))} ${pt(m2(UA))}`);
    }
  }

  // Cuffs.
  for (const s of [1, -1]) {
    const m2 = (p: P): P => (s === 1 ? p : mirror(p));
    if (t.ribCuff) {
      const k = m.K1 ?? 2.5;
      const T2 = add(T, mul(dir, -k));
      const B2 = add(B, mul(dir, -k));
      ribs.push(`M ${pt(m2(T2))} L ${pt(m2(T))} L ${pt(m2(B))} L ${pt(m2(B2))} Z`);
      stitches.push(`M ${pt(m2(add(T2, mul(dir, -0.15))))} L ${pt(m2(add(B2, mul(dir, -0.15))))}`);
    } else {
      stitches.push(`M ${pt(m2(add(T, mul(dir, -1))))} L ${pt(m2(add(B, mul(dir, -1))))}`);
    }
    // Sleeve fold for shading.
    const mid = lerp(SP, T, 0.45);
    folds.push({ d: `M ${pt(m2(add(mid, mul(perp, 1.2))))} Q ${pt(m2(add(lerp(SP, T, 0.65), mul(perp, 2.2))))} ${pt(m2(add(lerp(SP, T, 0.85), mul(perp, 1.6))))}`, w: 0.9 });
  }

  // Hem.
  let hemTop = L;
  if (t.ribHem) {
    const k = m.K2 ?? 2.5;
    hemTop = L - k;
    const tt = (hemTop - uaY) / (L - uaY);
    const side = cw + (hx - cw) * tt;
    ribs.push(`M ${pt([-side, hemTop])} L ${pt([side, hemTop])} L ${pt(HEM)} L ${pt(mirror(HEM))} Z`);
    stitches.push(`M ${pt([-side + 0.1, hemTop - 0.15])} L ${pt([side - 0.1, hemTop - 0.15])}`);
  } else {
    stitches.push(`M ${pt([-hx + 0.1, L - 1])} L ${pt([hx - 0.1, L - 1])}`);
  }

  // Collar (not on hoodie front, where the hood covers it).
  const k3 = m.K3 ?? 0.875;
  let collarTop = 0;
  if (!t.hood && neckStyle === "mock") {
    const hgt = 2.25;
    collarTop = -hgt;
    ribs.push(
      `M ${pt([-nx - 0.25, 0.35])} L ${pt([-nx + 0.15, -hgt + 0.2])} Q ${pt([0, -hgt - 0.35])} ${pt([nx - 0.15, -hgt + 0.2])} ` +
        `L ${pt([nx + 0.25, 0.35])} Q ${pt([0, drop + 0.7])} ${pt([-nx - 0.25, 0.35])} Z`,
    );
    stitches.push(`M ${pt([-nx - 0.1, 0.05])} Q ${pt([0, drop + 0.35])} ${pt([nx + 0.1, 0.05])}`);
    seams.push(`M ${pt([-nx + 0.05, -hgt * 0.45])} Q ${pt([0, -hgt * 0.45 - 0.25])} ${pt([nx - 0.05, -hgt * 0.45])}`);
  } else if (vNeck) {
    const sx = nx + k3 * 0.8;
    const sy = (slope * (sx - nx)) / (sw - nx);
    const vb = vDepth + k3 * 1.5;
    ribs.push(`M ${pt([-nx, 0])} L ${pt([0, vDepth])} L ${pt([nx, 0])} L ${pt([sx, sy])} L ${pt([0, vb])} L ${pt([-sx, sy])} Z`);
    stitches.push(`M ${pt([-sx - 0.12, sy + 0.12])} L ${pt([0, vb + 0.18])} L ${pt([sx + 0.12, sy + 0.12])}`);
    seams.push(`M ${pt([0, vDepth])} L ${pt([0, vb])}`);
  } else if (!t.hood) {
    const sx = nx + k3 * 0.8;
    const sy = (slope * (sx - nx)) / (sw - nx);
    const ndx = sx - nx;
    ribs.push(
      `M ${pt(mirror(NS))} ${neck(0, 0)} L ${pt([sx, sy])} ` +
        `C ${pt([sx, (drop + k3) * 0.6])} ${pt([sx * 0.55, drop + k3])} ${pt([0, drop + k3])} ` +
        `C ${pt([-sx * 0.55, drop + k3])} ${pt([-sx, (drop + k3) * 0.6])} ${pt([-sx, sy])} Z`,
    );
    stitches.push(`M ${pt([-nx - ndx - 0.1, sy + 0.1])} ${neck(ndx + 0.1, k3 + 0.15).replace(/^C/, "C")}`);
  }

  // Hood.
  let hood: string | undefined;
  let hoodInner: string | undefined;
  let cords: { a: P; b: P }[] | undefined;
  let topY = -1;
  if (t.hood) {
    const hh = m.HD ?? 14;
    const top = -(hh - 2);
    topY = top;
    const bx = nx + 1.6;
    const by = (slope * 1.6) / (sw - nx);
    const outer =
      `M ${pt([-bx, by])} C ${pt([-(nx + 3.4), -hh * 0.36])} ${pt([-(nx + 1.4), top])} ${pt([0, top])} ` +
      `C ${pt([nx + 1.4, top])} ${pt([nx + 3.4, -hh * 0.36])} ${pt([bx, by])}`;
    if (view === "front") {
      hood = `${outer} L ${pt([nx - 0.1, 0.4])} L ${pt([0.5, drop])} L ${pt([-0.5, drop])} L ${pt([-(nx - 0.1), 0.4])} Z`;
      hoodInner =
        `M ${pt([-(nx - 0.1), 0.4])} C ${pt([-(nx + 0.6), -hh * 0.3])} ${pt([-(nx - 1.4), top + 1.6])} ${pt([0, top + 1.6])} ` +
        `C ${pt([nx - 1.4, top + 1.6])} ${pt([nx + 0.6, -hh * 0.3])} ${pt([nx - 0.1, 0.4])} L ${pt([0.5, drop])} L ${pt([-0.5, drop])} Z`;
      cords = [
        { a: [-1.4, drop - 0.9], b: [-1.7, drop + 8.5] },
        { a: [1.4, drop - 0.9], b: [1.9, drop + 8] },
      ];
    } else {
      hood = `${outer} L ${pt([nx, 0])} L ${pt([-nx, 0])} Z`;
      seams.push(`M ${pt([0, top])} L ${pt([0, 0.6])}`);
    }
  }

  // Kangaroo pocket.
  let pocket: string | undefined;
  if (parts.pocket === "kangaroo" && view === "front") {
    const P = m.P ?? 11;
    const py = hemTop - 8.5;
    const pb = hemTop - 0.25;
    pocket =
      `M ${pt([-P * 0.34, py])} L ${pt([P * 0.34, py])} Q ${pt([P * 0.43, py + 2.6])} ${pt([P * 0.5, py + 6])} ` +
      `L ${pt([P * 0.5, pb])} L ${pt([-P * 0.5, pb])} L ${pt([-P * 0.5, py + 6])} Q ${pt([-P * 0.43, py + 2.6])} ${pt([-P * 0.34, py])} Z`;
    stitches.push(
      `M ${pt([-P * 0.34 + 0.15, py + 0.2])} L ${pt([P * 0.34 - 0.15, py + 0.2])} Q ${pt([P * 0.43 - 0.18, py + 2.6])} ${pt([P * 0.5 - 0.18, py + 6])} L ${pt([P * 0.5 - 0.18, pb])}`,
      `M ${pt([-P * 0.5 + 0.18, pb])} L ${pt([-P * 0.5 + 0.18, py + 6])} Q ${pt([-P * 0.43 + 0.18, py + 2.6])} ${pt([-P * 0.34 + 0.15, py + 0.2])}`,
    );
  }

  // Chest patch pocket (wearer's left).
  if (parts.pocket === "chest" && view === "front") {
    const w = 4.5, h = 5.25, cx = cw * 0.5, yT = Math.max(drop, vNeck ? 3 : drop) + 4.25;
    const xl = cx - w / 2, xr = cx + w / 2;
    pocket = `M ${pt([xl, yT])} L ${pt([xr, yT])} L ${pt([xr, yT + h - 0.6])} L ${pt([cx, yT + h])} L ${pt([xl, yT + h - 0.6])} Z`;
    const i = 0.2;
    stitches.push(
      `M ${pt([xl + i, yT + 0.1])} L ${pt([xl + i, yT + h - 0.6 - i * 0.4])} L ${pt([cx, yT + h - i])} L ${pt([xr - i, yT + h - 0.6 - i * 0.4])} L ${pt([xr - i, yT + 0.1])}`,
      `M ${pt([xl + 0.08, yT + 0.75])} L ${pt([xr - 0.08, yT + 0.75])}`,
    );
  }

  // Body folds for shading.
  folds.push({ d: `M ${pt([-cw + 1.2, uaY + 1])} Q ${pt([-cw + 2.4, uaY + 6])} ${pt([-cw + 1.6, uaY + 11])}`, w: 1.1 });
  folds.push({ d: `M ${pt([cw - 1.2, uaY + 1])} Q ${pt([cw - 2.4, uaY + 6])} ${pt([cw - 1.6, uaY + 11])}`, w: 1.1 });
  folds.push({ d: `M ${pt([-hx + 2, L - 3])} Q ${pt([0, L - 1.6])} ${pt([hx - 2, L - 3])}`, w: 0.8 });

  // Print zones.
  const zones: Zone[] = [];
  const zTop = (vNeck ? vDepth + 1.25 : drop) + (view === "front" ? 3 : 3.5);
  if (view === "front") {
    const maxH = t.pocket ? hemTop - 9.5 - zTop : Math.min(14, L - zTop - 4);
    zones.push({ id: "full-front", name: "Full front", x: 0, y: zTop + maxH / 2, w: Math.min(12, cw * 2 - 4), h: maxH });
    zones.push({ id: "center-chest", name: "Center chest", x: 0, y: zTop + 2.5, w: Math.min(10, cw * 2 - 6), h: 5 });
    zones.push({ id: "left-chest", name: "Left chest", x: cw * 0.48, y: zTop + 2.25, w: 4, h: 4 });
    // Sleeve print, along the sleeve.
    const sc = add(lerp(SP, T, t.ribCuff ? 0.4 : 0.5), mul(perp, Math.min(m.G, 7) * 0.5 + (t.ribCuff ? 1.2 : 0)));
    zones.push({ id: "sleeve", name: "Right sleeve", x: -sc[0], y: sc[1], w: 3, h: 3 });
  } else {
    zones.push({ id: "upper-back", name: "Upper back", x: 0, y: zTop + 2, w: Math.min(12, cw * 2 - 5), h: 4 });
    const fh = Math.min(16, (t.ribHem ? hemTop : L) - zTop - 3);
    zones.push({ id: "full-back", name: "Full back", x: 0, y: zTop + 1 + fh / 2, w: Math.min(13, cw * 2 - 4), h: fh });
  }

  // Dimension callouts.
  const chestY = uaY + 1;
  const dims: DimLine[] = [
    { code: "A", a: [-cw, chestY], b: [cw, chestY], label: [0, chestY - 0.5], angle: 0 },
    { code: "B", a: [-nx - 0.8, 0], b: [-nx - 0.8, L], label: [-nx - 1.3, L * 0.62], angle: -90 },
    { code: "H", a: [-hx, L + 1.6], b: [hx, L + 1.6], label: [0, L + 1.1], angle: 0 },
  ];
  const sa = add(SP, mul(out, 1.3));
  const sb = add(T, mul(out, 1.3));
  const sMid = lerp(sa, sb, 0.5);
  dims.push({ code: "D", a: sa, b: sb, label: add(sMid, mul(out, 0.55)), angle: t.sleeveAngle });
  const ga = add(T, mul(dir, 1.3));
  const gb = add(B, mul(dir, 1.3));
  dims.push({ code: "G", a: ga, b: gb, label: add(lerp(ga, gb, 0.5), mul(dir, 0.6)), angle: t.sleeveAngle - 90 });
  if (!(t.hood && view === "front")) {
    const cy = t.hood ? topY - 1.2 : -1.8;
    dims.push({ code: "C", a: [-sw, cy], b: [sw, cy], label: [0, cy - 0.5], angle: 0 });
  }

  const xs = [T[0], B[0], cw, hx, sw].map(Math.abs);
  const maxX = Math.max(...xs) + 0.5;
  return {
    body,
    ribs,
    hood,
    hoodInner,
    pocket,
    seams,
    stitches,
    cords,
    folds,
    zones,
    dims,
    bounds: { x0: -maxX, y0: Math.min(topY, collarTop - 0.5, -2.5) - 0.5, x1: maxX, y1: Math.max(L, B[1]) + 2.5 },
    center: { chestY, hemY: L },
  };
}

// Artboard layout in world inches.
// Sized for the largest variant (3XL, oversized, drop shoulder, long sleeves; 3XL hood).
// tests/geometry.test.ts fails if any variant no longer fits.
export const ARTBOARD = { w: 66, h: 57, originX: 33, originY: 17, gap: 4 };
export const artboardX = (view: View) => (view === "front" ? 0 : ARTBOARD.w + ARTBOARD.gap);

/** World-space box around both garment views, for zoom-to-fit and export cropping. */
export function contentBounds(geoms: Record<View, GarmentGeom>, margin = 2) {
  const f = geoms.front.bounds, b = geoms.back.bounds;
  return {
    x0: artboardX("front") + ARTBOARD.originX + f.x0 - margin,
    x1: artboardX("back") + ARTBOARD.originX + b.x1 + margin,
    y0: ARTBOARD.originY + Math.min(f.y0, b.y0) - margin,
    y1: ARTBOARD.originY + Math.max(f.y1, b.y1) + margin,
  };
}
