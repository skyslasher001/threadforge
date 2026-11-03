// Auto-digitizer: color regions -> machine stitches.
//
// Each thread color becomes one color block, sewn largest area first:
//   1. lock stitches to tie in
//   2. tatami underlay (sparse rows across the fill direction) to stabilize the fabric
//   3. tatami fill (0.4 mm rows, staggered 3.5 mm stitches, serpentine)
//   4. lock stitches, trim, color change
// Rows are extended slightly at both ends (pull compensation). Short hops between
// runs are sewn as travel stitches; longer hops become jumps, with trims over 12 mm.
// Units: 0.1 mm, x right, y down, origin at the design center.

import { COLOR_CHANGE, END, JUMP, STITCH, TRIM, type Cmd, type EmbPattern, type Stitch } from "./formats";

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
  name: string;
}

type Run = [number, number, number, number, number, number]; // x0, y0, x1, y1 (px), u0, u1 (along-row)

export const DEFAULTS: Omit<DigitizeSettings, "widthMm" | "name"> = { density: 0.4, stitchMm: 3.5, underlay: true, pullCompMm: 0.15 };

const ANGLES = [45, -45, 0, 90, 30, -30, 60, -60];
const MAX_MOVE = 121; // DST limit per axis, 12.1 mm
const TRAVEL_MAX = 30; // sew hops up to 3 mm
const TRIM_OVER = 120; // trim jumps longer than 12 mm

export interface Digitized {
  pattern: EmbPattern;
  stitchCount: number;
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

  const inside = (c: number, gx: number, gy: number) => {
    const ix = Math.floor(gx), iy = Math.floor(gy);
    return ix >= 0 && iy >= 0 && ix < r.w && iy < r.h && r.labels[iy * r.w + ix] === c;
  };

  // coverage order: biggest regions first (they sit under the details)
  const counts = new Array(r.colors.length).fill(0);
  for (let i = 0; i < r.labels.length; i++) if (r.labels[i] >= 0) counts[r.labels[i]]++;
  const order = counts.map((n, i) => ({ n, i })).filter((o) => o.n > 0).sort((a, b) => b.n - a.n);

  /** Rows of inside-runs across the region at `angle`, spacing in 0.1 mm. */
  const rows = (c: number, angleDeg: number, spacing: number) => {
    const a = (angleDeg * Math.PI) / 180;
    const dx = Math.cos(a), dy = Math.sin(a); // along the row
    const nx = -dy, ny = dx; // across rows
    const halfDiag = Math.hypot(r.w, r.h) / 2;
    const step = 0.5; // sample every half pixel
    const rowStepPx = spacing / unit;
    const comp = (s.pullCompMm * 10) / unit;
    const minRun = 8 / unit; // skip slivers under 0.8 mm
    const result: Run[][] = [];
    for (let t = -halfDiag; t <= halfDiag; t += rowStepPx) {
      const ox = cx + nx * t, oy = cy + ny * t;
      const runs: Run[] = [];
      let start: number | null = null;
      for (let u = -halfDiag; u <= halfDiag + step; u += step) {
        const isIn = u <= halfDiag && inside(c, ox + dx * u, oy + dy * u);
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

  const blocks: { color: number; stitches: number }[] = [];
  const threads: number[] = [];
  order.forEach((o, bi) => {
    const before = out.filter((x) => x.cmd === STITCH).length;
    const angle = ANGLES[bi % ANGLES.length];
    const fill = rows(o.i, angle, s.density * 10);
    if (!fill.length) return;
    if (threads.length) {
      lock();
      emit(px, py, TRIM);
      emit(px, py, COLOR_CHANGE);
    }
    threads.push(r.colors[o.i]);
    const first = fill[0][0];
    const [fx, fy] = toUnits(first[0], first[1]);
    moveTo(fx, fy, JUMP);
    lock();
    if (s.underlay && o.n * unit * unit > 400) sewRows(rows(o.i, angle + 90, 20), 30, false);
    sewRows(fill, s.stitchMm * 10, true);
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
