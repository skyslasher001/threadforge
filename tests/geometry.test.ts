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
