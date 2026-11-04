// Digitize a synthetic three-color badge and write DST / EXP / PES plus the raw stitch
// stream, for tests/embroidery_check.py to compare against pyembroidery.
import { writeFileSync, mkdirSync } from "node:fs";
import { digitize, DEFAULTS } from "../src/lib/embroidery/digitize";
import { writeDST, writeEXP, writeJEF, writePES, writeVP3 } from "../src/lib/embroidery/formats";

const out = process.argv[2] ?? "tests/out";
mkdirSync(out, { recursive: true });
const W = 360, H = 300;
const labels = new Int16Array(W * H).fill(-1);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const r = Math.hypot(x - W / 2, y - H / 2);
  labels[y * W + x] = r < 60 ? 0 : r < 120 ? 1 : Math.abs(x - W / 2) < 170 && Math.abs(y - H / 2) < 140 ? 2 : -1;
}
const t0 = performance.now();
const d = digitize({ w: W, h: H, labels, colors: [0xe0663a, 0x141418, 0xf2d16b] }, { ...DEFAULTS, widthMm: 101.6, name: "TFTEST" });
const ms = performance.now() - t0;
writeFileSync(`${out}/test.dst`, writeDST(d.pattern));
writeFileSync(`${out}/test.exp`, writeEXP(d.pattern));
writeFileSync(`${out}/test.pes`, writePES(d.pattern));
writeFileSync(`${out}/test.jef`, writeJEF(d.pattern, "20261104120000"));
writeFileSync(`${out}/test.vp3`, writeVP3(d.pattern));
writeFileSync(`${out}/stream.json`, JSON.stringify({ name: d.pattern.name, threads: d.pattern.threads, stitches: d.pattern.stitches.map((s) => [s.x, s.y, s.cmd]) }));
console.log(JSON.stringify({ stitches: d.stitchCount, colorChanges: d.colorChanges, trims: d.trims, sizeMm: [d.widthMm, d.heightMm], blocks: d.blocks, ms: Math.round(ms) }));

// ---- second design: thin strokes (satin columns) next to a solid shape (tatami) ----
{
  const W2 = 400, H2 = 200, lab = new Int16Array(W2 * H2).fill(-1);
  const px = 120 / W2; // 120 mm wide design -> 0.3 mm per px
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
    const i = y * W2 + x;
    if (Math.hypot(x - 320, y - 100) < 60) lab[i] = 0; // 36 mm disk: tatami
    if (x > 20 && x < 240 && Math.abs(y - 40) < 6) lab[i] = 1; // 3.6 mm bar: satin
    const rr = Math.hypot(x - 110, y - 125);
    if (rr > 45 && rr < 55) lab[i] = 1; // 3 mm ring: satin
    if (x > 30 && x < 45 && y > 80 && y < 190) lab[i] = 2; // 4.5 mm upright: satin
  }
  const d2 = digitize({ w: W2, h: H2, labels: lab, colors: [0x2b59c3, 0xf2f2f2, 0xe0663a] }, { ...DEFAULTS, widthMm: W2 * px, name: "TFSATIN" });
  mkdirSync(`${out}/satin`, { recursive: true });
  writeFileSync(`${out}/satin/test.dst`, writeDST(d2.pattern));
  writeFileSync(`${out}/satin/test.exp`, writeEXP(d2.pattern));
  writeFileSync(`${out}/satin/test.pes`, writePES(d2.pattern));
  writeFileSync(`${out}/satin/test.jef`, writeJEF(d2.pattern, "20261104120000"));
  writeFileSync(`${out}/satin/test.vp3`, writeVP3(d2.pattern));
  writeFileSync(`${out}/satin/stream.json`, JSON.stringify({ name: d2.pattern.name, threads: d2.pattern.threads, stitches: d2.pattern.stitches.map((s) => [s.x, s.y, s.cmd]) }));
  if (d2.satinShapes !== 3) throw new Error(`expected 3 satin shapes, got ${d2.satinShapes}`);
  if (d.satinShapes !== 0) throw new Error(`badge should be all tatami, got ${d.satinShapes} satin shapes`);
  // satin stitches cross the stroke: inside the bar, stitch lengths match its 3.6 mm width
  const st = d2.pattern.stitches;
  const bar: number[] = [];
  for (let i = 1; i < st.length; i++) {
    const a = st[i - 1], b = st[i];
    if (a.cmd !== 0 || b.cmd !== 0) continue;
    const mx = (a.x + b.x) / 2 / 10 / px + W2 / 2, my = (a.y + b.y) / 2 / 10 / px + H2 / 2;
    if (mx > 40 && mx < 220 && Math.abs(my - 40) < 6) bar.push(Math.hypot(b.x - a.x, b.y - a.y) / 10);
  }
  const across = bar.filter((l) => l > 2.8 && l < 4.6).length / bar.length;
  if (across < 0.75) throw new Error(`satin bar: only ${(across * 100).toFixed(0)}% of stitches span the column`);
  console.log(JSON.stringify({ satin: d2.satinShapes, stitches: d2.stitchCount, trims: d2.trims, barStitchesAcross: +(across * 100).toFixed(1) }));
}
