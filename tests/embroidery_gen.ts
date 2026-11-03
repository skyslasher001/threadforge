// Digitize a synthetic three-color badge and write DST / EXP / PES plus the raw stitch
// stream, for tests/embroidery_check.py to compare against pyembroidery.
import { writeFileSync, mkdirSync } from "node:fs";
import { digitize, DEFAULTS } from "../src/lib/embroidery/digitize";
import { writeDST, writeEXP, writePES } from "../src/lib/embroidery/formats";

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
writeFileSync(`${out}/stream.json`, JSON.stringify({ name: d.pattern.name, threads: d.pattern.threads, stitches: d.pattern.stitches.map((s) => [s.x, s.y, s.cmd]) }));
console.log(JSON.stringify({ stitches: d.stitchCount, colorChanges: d.colorChanges, trims: d.trims, sizeMm: [d.widthMm, d.heightMm], blocks: d.blocks, ms: Math.round(ms) }));
