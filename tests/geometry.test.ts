// Sweep every template x neckline x sleeve x pocket x fit x size x view and check the
// generated flat geometry is finite, closed and sensibly bounded.
import { ARTBOARD, buildGarment } from "../src/data/garments";
import { SIZES, TEMPLATES, fitBase, gradedSpec } from "../src/data/measurements";
import type { FitPreset, Neckline, PocketStyle, SleeveStyle, TemplateId, View } from "../src/types";

let checked = 0;
const failures: string[] = [];
const nums = (d: string) => (d.match(/-?\d+(\.\d+)?(e-?\d+)?|NaN|Infinity/g) ?? []);
for (const t of Object.keys(TEMPLATES) as TemplateId[]) {
  for (const fit of ["regular", "boxy", "oversized", "cropped"] as FitPreset[]) {
    const base = fitBase(t, fit);
    for (const neck of ["crew", "v", "mock"] as Neckline[]) {
      for (const sleeve of ["setin", "raglan", "drop"] as SleeveStyle[]) {
        for (const pocket of ["none", "chest", "kangaroo"] as PocketStyle[]) {
          for (const size of SIZES) {
            for (const view of ["front", "back"] as View[]) {
              const m = gradedSpec(base, TEMPLATES[t].grade, size);
              const g = buildGarment(t, view, m, { neck, sleeve, pocket, fit });
              const id = `${t}/${fit}/${neck}/${sleeve}/${pocket}/${size}/${view}`;
              const paths = [g.body, ...g.ribs, g.hood ?? "", g.hoodInner ?? "", g.pocket ?? "", ...g.seams, ...g.stitches];
              for (const p of paths) {
                for (const n of nums(p)) if (!isFinite(Number(n))) failures.push(`${id}: non-finite number in path`);
              }
              if (!g.body.startsWith("M") || !g.body.trim().endsWith("Z")) failures.push(`${id}: body path not closed`);
              const b = g.bounds;
              if (!(b.x1 > b.x0 && b.y1 > b.y0)) failures.push(`${id}: empty bounds`);
              if (b.x1 > ARTBOARD.originX - 0.5 || -b.x0 > ARTBOARD.originX - 0.5) failures.push(`${id}: wider than the artboard (${b.x1.toFixed(1)} in half-width)`);
              if (b.y0 < -ARTBOARD.originY + 0.5 || b.y1 > ARTBOARD.h - ARTBOARD.originY - 0.5) failures.push(`${id}: taller than the artboard (${b.y0.toFixed(1)}..${b.y1.toFixed(1)})`);
              for (const z of g.zones) {
                if (![z.x, z.y, z.w, z.h].every(isFinite) || z.w <= 0 || z.h <= 0) failures.push(`${id}: bad zone ${z.id} ${JSON.stringify(z)}`);
              }
              checked++;
            }
          }
        }
      }
    }
  }
}
console.log(`geometry: ${checked} variants checked, ${failures.length} failures`);
if (failures.length) {
  console.log(Array.from(new Set(failures)).slice(0, 30).join("\n"));
  process.exit(1);
}

// ---------- 3D inflate: closed shell, snapped to the silhouette ----------
{
  const { inflate, profile } = await import("../src/lib/inflate");
  // a 20 x 12 in rectangle inside a 24 x 16 in mask at 8 px/in
  const res = 8, mc = 24 * res, mr = 16 * res;
  const mask = new Uint8Array(mc * mr);
  for (let y = 2 * res; y < 14 * res; y++) for (let x = 2 * res; x < 22 * res; x++) mask[y * mc + x] = 1;
  const sh = inflate({ mask, maskCols: mc, maskRows: mr, res, cell: 0.25, depth: 4, reach: 5 });
  let maxZ = 0, edgeOk = true, offEdge = 0;
  for (let i = 0; i < sh.x.length; i++) {
    maxZ = Math.max(maxZ, sh.z[i]);
    const x = sh.x[i], y = sh.y[i];
    const out = x < 2 || x > 22 || y < 2 || y > 14;
    if (out && sh.z[i] !== 0) edgeOk = false;
    // every vertex used by a triangle lies inside or within half a mask pixel of the edge
    const dx = Math.max(2 - x, 0, x - 22), dy = Math.max(2 - y, 0, y - 14);
    if (Math.hypot(dx, dy) > 0.5 / res + 1e-4 && sh.z[i] === 0 && Array.prototype.includes.call(sh.index, i)) offEdge++;
  }
  if (!(maxZ > 3.5 && maxZ <= 4)) throw new Error(`inflate depth ${maxZ}`);
  if (!edgeOk) throw new Error("outside vertex lifted off the flat");
  if (offEdge) throw new Error(`${offEdge} edge vertices not snapped to the silhouette`);
  if (profile(0, 4, 5) !== 0 || Math.abs(profile(5, 4, 5) - 4) > 1e-9) throw new Error("profile ends");
  console.log(`inflate: ${sh.index.length / 3} triangles, depth ${maxZ.toFixed(2)} in, edge snapped`);
}

// ---------- photo warp: homography maps the print rectangle exactly onto the four corners ----------
{
  const { homography, apply, invert, convex } = await import("../src/lib/warp");
  const src: [number, number][] = [[0, 0], [400, 0], [400, 300], [0, 300]];
  const dst: [number, number][] = [[120, 80], [530, 140], [500, 470], [90, 420]];
  const h = homography(src, dst);
  for (let i = 0; i < 4; i++) {
    const [x, y] = apply(h, src[i][0], src[i][1]);
    if (Math.hypot(x - dst[i][0], y - dst[i][1]) > 1e-6) throw new Error(`corner ${i} maps to ${x},${y}`);
  }
  const [bx, by] = apply(invert(h), ...apply(h, 173, 211));
  if (Math.hypot(bx - 173, by - 211) > 1e-6) throw new Error("inverse homography");
  if (!convex(dst) || convex([[0, 0], [10, 10], [10, 0], [0, 10]])) throw new Error("convexity check");
  console.log("warp: homography corners exact, inverse round-trips, bow-tie quads rejected");
}
