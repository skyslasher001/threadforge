// Auto-digitizer: color regions -> machine stitches.
//
// Each thread color becomes one color block, sewn largest area first:
//   1. lock stitches to tie in
//   2. tatami underlay (sparse rows across the fill direction) to stabilize the fabric
//   3. tatami fill (0.4 mm rows, staggered 3.5 mm stitches, serpentine)
//   4. lock stitches, trim, color change
// Narrow shapes (strokes, lettering, outlines up to 6 mm wide) are sewn as satin columns instead:
// a center-run underlay, then one stitch edge to edge per 0.35 mm row, perpendicular to the stroke.
// Rows are extended slightly at both ends (pull compensation). Short hops between
// runs are sewn as travel stitches; longer hops become jumps, with trims over 12 mm.
// Units: 0.1 mm, x right, y down, origin at the design center.

import { COLOR_CHANGE, END, JUMP, STITCH, TRIM, type Cmd, type EmbPattern, type Stitch } from "./formats";
import { edgeDistance } from "../inflate";

export interface Regions {
  w: number; // label grid size (px)
  h: number;
  labels: Int16Array; // color index per px, -1 = empty
  colors: number[]; // 0xRRGGBB per color index
}

export interface DigitizeSettings {
  widthMm: number; // finished design width
  density: number; // fill row spacing in mm (0.4 typical)
  stitchMm: number; // max fill stitch length in mm
  underlay: boolean;
  pullCompMm: number;
  satin: boolean; // sew narrow shapes as satin columns
  satinMaxMm: number; // widest shape sewn as satin
  name: string;
}

type Run = [number, number, number, number, number, number]; // x0, y0, x1, y1 (px), u0, u1 (along-row)

export const DEFAULTS: Omit<DigitizeSettings, "widthMm" | "name"> = { density: 0.4, stitchMm: 3.5, underlay: true, pullCompMm: 0.15, satin: true, satinMaxMm: 6 };

const SATIN_SPACING = 3.5; // 0.1 mm between satin rows
const SATIN_LONGEST = 80; // 0.1 mm: a longer satin stitch is split (snag risk)

const ANGLES = [45, -45, 0, 90, 30, -30, 60, -60];
const MAX_MOVE = 121; // DST limit per axis, 12.1 mm
const TRAVEL_MAX = 30; // sew hops up to 3 mm
const TRIM_OVER = 120; // trim jumps longer than 12 mm

export interface Digitized {
  pattern: EmbPattern;
  stitchCount: number;
  satinShapes: number; // shapes sewn as satin columns
  colorChanges: number;
  trims: number;
  widthMm: number;
  heightMm: number;
  blocks: { color: number; stitches: number }[];
}

/**
 * Clean color regions before stitching: fold tiny colors (anti-aliasing fringes, < 2.5% of
 * the art) into their neighbors, then a 3x3 majority filter to remove speckles.
 * Fragments like these otherwise turn into hundreds of trims.
 */
export function cleanRegions(r: Regions): Regions {
  const { w, h } = r;
  let lab = Int16Array.from(r.labels);
  const counts = new Array(r.colors.length).fill(0);
  let opaque = 0;
  for (const l of lab) if (l >= 0) { counts[l]++; opaque++; }
  const minor = new Set(counts.map((n, i) => (n > 0 && n < opaque * 0.025 ? i : -1)).filter((i) => i >= 0));
  const majorityAt = (src: Int16Array, x: number, y: number, skip: Set<number>) => {
    const tally = new Map<number, number>();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const l = src[yy * w + xx];
      if (skip.has(l)) continue;
      tally.set(l, (tally.get(l) ?? 0) + 1);
    }
    let best = -1, bestN = -1;
    tally.forEach((n, l) => { if (n > bestN) { bestN = n; best = l; } });
    return { best, bestN };
  };
  if (minor.size && minor.size < counts.filter((n) => n > 0).length) {
    for (let pass = 0; pass < 4; pass++) {
      const next = Int16Array.from(lab);
      let left = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!minor.has(lab[i])) continue;
        const { best } = majorityAt(lab, x, y, minor);
        if (best !== -1 || pass === 3) next[i] = best; else left++;
      }
      lab = next;
      if (!left) break;
    }
  }
  const out = Int16Array.from(lab);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const { best, bestN } = majorityAt(lab, x, y, new Set());
    if (bestN >= 5) out[y * w + x] = best;
  }
  return { ...r, labels: out };
}

export function digitize(input: Regions, s: DigitizeSettings): Digitized {
  const r = cleanRegions(input);
  const unit = (s.widthMm * 10) / r.w; // 0.1 mm per pixel
  const cx = r.w / 2, cy = r.h / 2;
  const out: Stitch[] = [];
  let px = 0, py = 0; // needle position (0.1 mm)

  const emit = (x: number, y: number, cmd: Cmd) => {
    out.push({ x: Math.round(x), y: Math.round(y), cmd });
    if (cmd === STITCH || cmd === JUMP) { px = Math.round(x); py = Math.round(y); }
  };
  // move in steps no longer than the format limit
  const moveTo = (x: number, y: number, cmd: Cmd) => {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x - px), Math.abs(y - py)) / MAX_MOVE));
    for (let i = 1; i <= n; i++) emit(px + (x - px) / (n - i + 1), py + (y - py) / (n - i + 1), cmd);
  };
  const lock = () => {
    const x = px, y = py;
    emit(x + 3, y, STITCH); emit(x, y, STITCH); emit(x + 3, y, STITCH); emit(x, y, STITCH);
  };
  const travel = (x: number, y: number) => {
    const d = Math.hypot(x - px, y - py);
    if (d <= TRAVEL_MAX) { if (d > 0) emit(x, y, STITCH); return; }
    if (d > TRIM_OVER) { lock(); emit(px, py, TRIM); }
    moveTo(x, y, JUMP);
  };

  type Pred = (i: number) => boolean;
  const inside = (pred: Pred, gx: number, gy: number) => {
    const ix = Math.floor(gx), iy = Math.floor(gy);
    return ix >= 0 && iy >= 0 && ix < r.w && iy < r.h && pred(iy * r.w + ix);
  };

  // coverage order: biggest regions first (they sit under the details)
  const counts = new Array(r.colors.length).fill(0);
  for (let i = 0; i < r.labels.length; i++) if (r.labels[i] >= 0) counts[r.labels[i]]++;
  const order = counts.map((n, i) => ({ n, i })).filter((o) => o.n > 0).sort((a, b) => b.n - a.n);

  /** Rows of inside-runs across the region at `angle`, spacing in 0.1 mm. */
  const rows = (pred: Pred, angleDeg: number, spacing: number, compMm = s.pullCompMm) => {
    const a = (angleDeg * Math.PI) / 180;
    const dx = Math.cos(a), dy = Math.sin(a); // along the row
    const nx = -dy, ny = dx; // across rows
    const halfDiag = Math.hypot(r.w, r.h) / 2;
    const step = 0.5; // sample every half pixel
    const rowStepPx = spacing / unit;
    const comp = (compMm * 10) / unit;
    const minRun = 8 / unit; // skip slivers under 0.8 mm
    const result: Run[][] = [];
    for (let t = -halfDiag; t <= halfDiag; t += rowStepPx) {
      const ox = cx + nx * t, oy = cy + ny * t;
      const runs: Run[] = [];
      let start: number | null = null;
      for (let u = -halfDiag; u <= halfDiag + step; u += step) {
        const isIn = u <= halfDiag && inside(pred, ox + dx * u, oy + dy * u);
        if (isIn && start === null) start = u;
        if (!isIn && start !== null) {
          const end = u - step;
          if (end - start >= minRun) {
            const u0 = start - comp, u1 = end + comp;
            runs.push([ox + dx * u0, oy + dy * u0, ox + dx * u1, oy + dy * u1, u0, u1]);
          }
          start = null;
        }
      }
      if (runs.length) result.push(runs);
    }
    return result;
  };

  const toUnits = (gx: number, gy: number): [number, number] => [(gx - cx) * unit, (gy - cy) * unit];

  /**
   * Split rows of runs into sections that can each be sewn without leaving the shape:
   * a run continues the section whose run on the previous row overlaps it.
   * Shapes with holes or arms become a few sections instead of a jump on every row.
   */
  const sections = (rowList: Run[][]) => {
    const done: Run[][] = [];
    let open: { runs: Run[]; last: Run }[] = [];
    for (const runs of rowList) {
      const next: { runs: Run[]; last: Run }[] = [];
      const used = new Set<number>();
      for (const run of runs) {
        const k = open.findIndex((sec, i) => !used.has(i) && Math.min(sec.last[5], run[5]) - Math.max(sec.last[4], run[4]) > 0);
        if (k >= 0) {
          used.add(k);
          open[k].runs.push(run);
          next.push({ runs: open[k].runs, last: run });
        } else {
          next.push({ runs: [run], last: run });
        }
      }
      open.forEach((sec, i) => { if (!used.has(i)) done.push(sec.runs); });
      open = next;
    }
    open.forEach((sec) => done.push(sec.runs));
    return done;
  };

  const sewRows = (rowList: Run[][], stitchLen: number, stagger: boolean) => {
    let secs = sections(rowList);
    // sew the nearest unsewn section next
    const ordered: Run[][] = [];
    while (secs.length) {
      let best = 0, bestD = Infinity;
      secs.forEach((sec, i) => {
        const [x, y] = toUnits(sec[0][0], sec[0][1]);
        const dd = Math.hypot(x - px, y - py);
        if (dd < bestD) { bestD = dd; best = i; }
      });
      ordered.push(secs[best]);
      secs = secs.filter((_, i) => i !== best);
    }
    let ri = 0;
    const runLen = (run: Run) => Math.hypot(run[2] - run[0], run[3] - run[1]) * unit;
    for (const sec of ordered.filter((sec) => sec.reduce((a, run) => a + runLen(run), 0) >= 40)) sec.forEach((run, j) => {
      ri++;
      const rev = j % 2 === 1;
      {
        let [ax, ay] = toUnits(run[0], run[1]);
        let [bx, by] = toUnits(run[2], run[3]);
        if (rev) [ax, ay, bx, by] = [bx, by, ax, ay];
        travel(ax, ay);
        if (out.length === 0 || px !== Math.round(ax) || py !== Math.round(ay)) emit(ax, ay, STITCH);
        const len = Math.hypot(bx - ax, by - ay);
        const phase = stagger ? ((ri % 4) / 4) * stitchLen : 0;
        let d = phase > 0 ? phase : stitchLen;
        while (d < len - stitchLen * 0.3) {
          emit(ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len, STITCH);
          d += stitchLen;
        }
        emit(bx, by, STITCH);
      }
    });
  };

  /** Connected shapes of one color (4-connected), with their widest point and main direction. */
  const shapes = (c: number) => {
    const comp = new Int32Array(r.w * r.h).fill(-1);
    const list: { id: number; px: number[]; widthMm: number; angle: number; spanMm: number }[] = [];
    const mask = new Uint8Array(r.w * r.h);
    for (let i = 0; i < mask.length; i++) mask[i] = r.labels[i] === c ? 1 : 0;
    const dist = edgeDistance(r.w, r.h, mask, 1);
    for (let i0 = 0; i0 < mask.length; i0++) {
      if (!mask[i0] || comp[i0] >= 0) continue;
      const id = list.length, px: number[] = [], stack = [i0];
      comp[i0] = id;
      let maxD = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      while (stack.length) {
        const i = stack.pop()!;
        px.push(i);
        const x = i % r.w, y = (i - x) / r.w;
        sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
        if (dist[i] > maxD) maxD = dist[i];
        for (const j of [i - 1, i + 1, i - r.w, i + r.w]) {
          if (j < 0 || j >= mask.length || !mask[j] || comp[j] >= 0) continue;
          if ((j === i - 1 && x === 0) || (j === i + 1 && x === r.w - 1)) continue;
          comp[j] = id;
          stack.push(j);
        }
      }
      const n = px.length, mx = sx / n, my = sy / n;
      const cxx = sxx / n - mx * mx, cyy = syy / n - my * my, cxy = sxy / n - mx * my;
      const major = 0.5 * Math.atan2(2 * cxy, cxx - cyy); // radians, along the shape
      // distance is to the pixel edge, so the widest stroke is about 2 * maxD - 1 px
      list.push({ id, px, widthMm: (Math.max(1, 2 * maxD - 1) * unit) / 10, angle: (major * 180) / Math.PI, spanMm: (Math.max(bx1 - bx0, by1 - by0) + 1) * unit / 10 });
    }
    return { comp, list, dist };
  };

  /**
   * Satin columns follow the stroke: thin the shape to its center line, trace each branch,
   * then at every 0.35 mm along it stitch from edge to edge across the local stroke direction.
   * Curves and rings stay perpendicular all the way round.
   */
  const sewSatin = (paths: [number, number][][], own: Pred, dist: Float32Array) => {
    for (const path of paths) {
      const pts = resample(smooth(path, 4), SATIN_SPACING / unit);
      if (pts.length < 3) continue;
      const halfAt = (x: number, y: number) => {
        const ix = Math.floor(x), iy = Math.floor(y);
        return ix >= 0 && iy >= 0 && ix < r.w && iy < r.h ? dist[iy * r.w + ix] : 1;
      };
      const comp = (Math.max(s.pullCompMm, 0.2) * 10) / unit;
      const reach = ((s.satinMaxMm * 10) / unit) * 1.2;
      const edge = (x: number, y: number, nx: number, ny: number) => {
        // never reach past ~1.5x the local half-width: a wrong normal can't throw a spike along the stroke
        const cap = Math.min(reach, halfAt(x, y) * 1.5 + 0.5);
        let d = 0;
        while (d < cap && inside(own, x + nx * (d + 0.25), y + ny * (d + 0.25))) d += 0.25;
        return d + 0.5; // to the pixel edge
      };
      const cols: { l: [number, number]; r: [number, number]; c: [number, number] }[] = [];
      for (let k = 0; k < pts.length; k++) {
        const a0 = pts[Math.max(0, k - 4)], a1 = pts[Math.min(pts.length - 1, k + 4)];
        let tx = a1[0] - a0[0], ty = a1[1] - a0[1];
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl; ty /= tl;
        const nx = -ty, ny = tx;
        const [x, y] = pts[k];
        const dl = edge(x, y, nx, ny) + comp, dr = edge(x, y, -nx, -ny) + comp;
        cols.push({ l: toUnits(x + nx * dl, y + ny * dl), r: toUnits(x - nx * dr, y - ny * dr), c: toUnits(x, y) });
      }
      const start = cols[0].c;
      travel(start[0], start[1]);
      if (px !== Math.round(start[0]) || py !== Math.round(start[1])) emit(start[0], start[1], STITCH);
      if (s.underlay) {
        // center run out, satin back over it
        let acc = 0;
        for (let k = 1; k < cols.length; k++) {
          acc += Math.hypot(cols[k].c[0] - cols[k - 1].c[0], cols[k].c[1] - cols[k - 1].c[1]);
          if (acc >= 20 || k === cols.length - 1) { emit(cols[k].c[0], cols[k].c[1], STITCH); acc = 0; }
        }
      }
      const seq = s.underlay ? cols.slice().reverse() : cols;
      let [lx, ly] = [px, py];
      seq.forEach((col, k) => {
        const [x, y] = k % 2 === 0 ? col.l : col.r;
        const len = Math.hypot(x - lx, y - ly);
        const parts = Math.max(1, Math.ceil(len / SATIN_LONGEST));
        for (let q = 1; q <= parts; q++) emit(lx + ((x - lx) * q) / parts, ly + ((y - ly) * q) / parts, STITCH);
        [lx, ly] = [x, y];
      });
    }
  };

  const blocks: { color: number; stitches: number }[] = [];
  const threads: number[] = [];
  let satinShapes = 0;
  order.forEach((o, bi) => {
    const before = out.filter((x) => x.cmd === STITCH).length;
    const angle = ANGLES[bi % ANGLES.length];
    const { comp, list, dist } = shapes(o.i);
    const centerCache = new Map<number, [number, number][][]>();
    const satin = new Set(
      s.satin
        ? list
            .filter((sh) => {
              const areaMm2 = (sh.px.length * unit * unit) / 100;
              // narrow, and long enough to be a stroke: small dots and blobs sew better as fill
              // satin needs a real column: 1.2-6 mm wide and at least 8 mm long. Small lettering (under ~8 mm)
              // sews more legibly as fill from an auto-digitizer; it needs a dedicated lettering tool for satin.
              if (!(sh.widthMm <= s.satinMaxMm && sh.widthMm >= 1.2 && sh.spanMm >= 8 && areaMm2 / (sh.widthMm * sh.widthMm) >= 2)) return false;
              // a clean column: at most 3 branches (bar, ray, ring, simple curve), each well longer than it is wide.
              // Complex small shapes (tiny lettering) keep fill; a lettering tool can satin those later.
              const wPx = (sh.widthMm * 10) / unit;
              const paths = centerLines(sh.px, r.w, Math.max(2, wPx * 1.2));
              const ok = paths.length >= 1 && paths.length <= 3 && paths.every((pa) => pa.length >= wPx * 1.5);
              if (ok) centerCache.set(sh.id, paths);
              return ok;
            })
            .map((sh) => sh.id)
        : [],
    );
    const isFill: Pred = (i) => r.labels[i] === o.i && !satin.has(comp[i]);
    const fill = satin.size === list.length ? [] : rows(isFill, angle, s.density * 10);
    if (!fill.length && !satin.size) return;
    if (threads.length) {
      lock();
      emit(px, py, TRIM);
      emit(px, py, COLOR_CHANGE);
    }
    threads.push(r.colors[o.i]);
    let tied = false;
    if (fill.length) {
      const first = fill[0][0];
      const [fx, fy] = toUnits(first[0], first[1]);
      moveTo(fx, fy, JUMP);
      lock();
      tied = true;
      if (s.underlay && o.n * unit * unit > 400) sewRows(rows(isFill, angle + 90, 20), 30, false);
      sewRows(fill, s.stitchMm * 10, true);
    }
    for (const sh of list) {
      if (!satin.has(sh.id)) continue;
      const own: Pred = (i) => comp[i] === sh.id;
      if (!tied) {
        const i0 = sh.px[0], [fx, fy] = toUnits((i0 % r.w) + 0.5, Math.floor(i0 / r.w) + 0.5);
        moveTo(fx, fy, JUMP);
        lock();
        tied = true;
      }
      sewSatin(centerCache.get(sh.id)!, own, dist);
      satinShapes++;
    }
    blocks.push({ color: r.colors[o.i], stitches: out.filter((x) => x.cmd === STITCH).length - before });
  });
  if (out.length) { lock(); emit(px, py, TRIM); }
  emit(px, py, END);

  // drop zero-length jumps the stepper can leave behind
  const stitches = out.filter((st, i) => !(st.cmd === JUMP && i > 0 && st.x === out[i - 1].x && st.y === out[i - 1].y && out[i - 1].cmd === JUMP));
  const [x0, y0, x1, y1] = stitches.reduce((b, p) => [Math.min(b[0], p.x), Math.min(b[1], p.y), Math.max(b[2], p.x), Math.max(b[3], p.y)], [Infinity, Infinity, -Infinity, -Infinity]);
  return {
    pattern: { name: s.name, stitches, threads },
    stitchCount: stitches.filter((x) => x.cmd === STITCH).length,
    satinShapes,
    colorChanges: stitches.filter((x) => x.cmd === COLOR_CHANGE).length,
    trims: stitches.filter((x) => x.cmd === TRIM).length,
    widthMm: stitches.length ? (x1 - x0) / 10 : 0,
    heightMm: stitches.length ? (y1 - y0) / 10 : 0,
    blocks,
  };
}

/** Draw the real stitch path as thread: shadow, body and a sheen highlight per stitch. */
export function renderStitches(d: Digitized, pxPerMm: number, box: { wMm: number; hMm: number }, upto = Infinity): HTMLCanvasElement {
  const st = d.pattern.stitches;
  // canvas covers the placed artwork box (centered origin) so the preview lines up with the art
  const x0 = -box.wMm * 5 - 2 / (pxPerMm / 10), y0 = -box.hMm * 5 - 2 / (pxPerMm / 10);
  const k = pxPerMm / 10;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(box.wMm * pxPerMm) + 4);
  c.height = Math.max(1, Math.ceil(box.hMm * pxPerMm) + 4);
  const ctx = c.getContext("2d")!;
  ctx.lineCap = "round";
  const tw = Math.max(0.6, 0.38 * pxPerMm); // ~0.38 mm thread
  let color = 0, prev: Stitch | null = null, sewn = 0;
  const hex = (n: number, f = 1) => `rgb(${Math.min(255, ((n >> 16) & 255) * f)},${Math.min(255, ((n >> 8) & 255) * f)},${Math.min(255, (n & 255) * f)})`;
  const thr = d.pattern.threads;
  for (const s of st) {
    if (s.cmd === COLOR_CHANGE) { color++; prev = null; continue; }
    if (s.cmd !== STITCH) { prev = null; continue; }
    if (prev && sewn < upto) {
      const ax = (prev.x - x0) * k + 2, ay = (prev.y - y0) * k + 2, bx = (s.x - x0) * k + 2, by = (s.y - y0) * k + 2;
      const t = thr[color] ?? 0x888888;
      ctx.strokeStyle = hex(t, 0.6); ctx.lineWidth = tw * 1.35;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.strokeStyle = hex(t); ctx.lineWidth = tw;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.lineWidth = tw * 0.3;
      ctx.beginPath(); ctx.moveTo(ax + (bx - ax) * 0.2, ay + (by - ay) * 0.2 - tw * 0.15); ctx.lineTo(ax + (bx - ax) * 0.6, ay + (by - ay) * 0.6 - tw * 0.15); ctx.stroke();
      sewn++;
    }
    prev = s;
  }
  return c;
}

// ---------------- center lines for satin ----------------

type P2 = [number, number];

/** Zhang-Suen thinning of one shape, traced into branches (pixel-center points). Spurs shorter than `minSpur` px are dropped. */
export function centerLines(pixels: number[], gridW: number, minSpur: number): P2[][] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of pixels) { const x = i % gridW, y = (i - x) / gridW; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const W = x1 - x0 + 3, H = y1 - y0 + 3; // 1 px border
  const m = new Uint8Array(W * H);
  for (const i of pixels) { const x = i % gridW, y = (i - x) / gridW; m[(y - y0 + 1) * W + (x - x0 + 1)] = 1; }
  const nb = (i: number) => [m[i - W], m[i - W + 1], m[i + 1], m[i + W + 1], m[i + W], m[i + W - 1], m[i - 1], m[i - W - 1]];
  for (let changed = true; changed; ) {
    changed = false;
    for (const step of [0, 1]) {
      const del: number[] = [];
      for (let y = 1; y < H - 1; y++)
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          if (!m[i]) continue;
          const p = nb(i);
          const b = p.reduce((a, v) => a + v, 0);
          if (b < 2 || b > 6) continue;
          let a = 0;
          for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) % 8]) a++;
          if (a !== 1) continue;
          if (step === 0 ? p[0] * p[2] * p[4] || p[2] * p[4] * p[6] : p[0] * p[2] * p[6] || p[0] * p[4] * p[6]) continue;
          del.push(i);
        }
      for (const i of del) m[i] = 0;
      if (del.length) changed = true;
    }
  }
  const offs = [-W, -W + 1, 1, W + 1, W, W - 1, -1, -W - 1];
  // branch structure by 0->1 transitions around a pixel: 1 = end, 2 = on a line (incl. staircase corners), 3+ = junction
  const deg = (i: number) => {
    const p = offs.map((o) => m[i + o]);
    if (!p.some(Boolean)) return 0;
    let t = 0;
    for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) % 8]) t++;
    return t;
  };
  const pt = (i: number): P2 => [(i % W) + x0 - 1 + 0.5, Math.floor(i / W) + y0 - 1 + 0.5];
  const seen = new Set<string>();
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  const walk = (from: number, next: number) => {
    const path = [from, next];
    seen.add(key(from, next));
    let prev = from, cur = next;
    while (deg(cur) === 2) {
      // of the unvisited neighbours, step to the one farthest from where we came from
      const cand = offs.map((o) => cur + o).filter((j) => m[j] && j !== prev && !seen.has(key(cur, j)) && !path.includes(j) || (j === from && path.length > 3 && m[j]));
      if (!cand.length) break;
      const d2 = (a: number, b: number) => ((a % W) - (b % W)) ** 2 + (Math.floor(a / W) - Math.floor(b / W)) ** 2;
      const n = cand.reduce((b, j) => (d2(j, prev) > d2(b, prev) ? j : b));
      for (const j of offs.map((o) => cur + o)) if (m[j] && j !== n) seen.add(key(cur, j)); // the corner shortcut is the same line
      seen.add(key(cur, n));
      path.push(n);
      prev = cur; cur = n;
      if (n === from) break; // closed loop
    }
    return path;
  };
  const branches: number[][] = [];
  const nodes: number[] = [];
  for (let i = 0; i < m.length; i++) if (m[i] && deg(i) !== 2) nodes.push(i);
  for (const n of nodes) for (const o of offs) { const j = n + o; if (m[j] && !seen.has(key(n, j))) branches.push(walk(n, j)); }
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || deg(i) !== 2) continue;
    const j = offs.map((o) => i + o).find((k) => m[k] && !seen.has(key(i, k)));
    if (j !== undefined) branches.push(walk(i, j)); // rings: loops with no end
  }
  const isEnd = (i: number) => deg(i) <= 1;
  const longest = Math.max(...branches.map((b) => b.length), 0);
  const kept = branches.length > 1
    ? branches.filter((b) => b.length >= 4 || b.length === longest).filter((b) => b.length >= minSpur || !(isEnd(b[0]) || isEnd(b[b.length - 1])))
    : branches;
  // drop branches that just shadow a longer one (staircase corners around junction clusters)
  const out: P2[][] = [];
  const taken = new Set<number>();
  for (const b of (kept.length ? kept : branches).filter((q) => q.length >= 2).sort((a, c) => c.length - a.length)) {
    const near = b.filter((i) => offs.some((o) => taken.has(i + o)) || taken.has(i)).length;
    if (out.length && near / b.length > 0.6) continue;
    b.forEach((i) => taken.add(i));
    out.push(b.map(pt));
  }
  return out;
}

/** Moving-average smoothing (keeps the end points). */
export function smooth(p: P2[], k: number): P2[] {
  if (p.length < 3) return p;
  const closed = p.length > 3 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1];
  return p.map((q, i) => {
    if (!closed && (i === 0 || i === p.length - 1)) return q;
    let sx = 0, sy = 0, n = 0;
    for (let d = -k; d <= k; d++) {
      let j = i + d;
      if (closed) j = (j + p.length - 1) % (p.length - 1);
      else if (j < 0 || j >= p.length) continue;
      sx += p[j][0]; sy += p[j][1]; n++;
    }
    return [sx / n, sy / n];
  });
}

/** Evenly spaced points along a polyline. */
export function resample(p: P2[], step: number): P2[] {
  if (p.length < 2) return p;
  const out: P2[] = [p[0]];
  let carry = 0;
  for (let i = 1; i < p.length; i++) {
    const [ax, ay] = p[i - 1], [bx, by] = p[i];
    const len = Math.hypot(bx - ax, by - ay);
    let d = step - carry;
    while (d <= len) { out.push([ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len]); d += step; }
    carry = len - (d - step);
  }
  return out;
}
