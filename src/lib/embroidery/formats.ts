// Machine embroidery file writers: DST (Tajima), EXP (Melco), PES (Brother, PEC body), JEF (Janome), VP3 (Husqvarna Viking / Pfaff).
// Encodings follow pyembroidery (MIT License, (c) Tatarize and contributors) and are
// checked byte-for-byte against it in tests/embroidery_check.py.
//
// Input is a normalized stitch stream in 0.1 mm units, x right, y down:
// every STITCH/JUMP move is at most 121 units on each axis (DST's limit).

import { JEF_THREADS, PEC_BLANK, PEC_THREADS } from "./pecTables";

export const STITCH = 0, JUMP = 1, TRIM = 2, COLOR_CHANGE = 5, END = 4;
export type Cmd = typeof STITCH | typeof JUMP | typeof TRIM | typeof COLOR_CHANGE | typeof END;

export interface Stitch { x: number; y: number; cmd: Cmd }
export interface EmbPattern {
  name: string;
  stitches: Stitch[];
  threads: number[]; // 0xRRGGBB per color block, in sewing order
}

class Bytes {
  protected buf = new Uint8Array(4096);
  len = 0;
  private grow(n: number) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const b = new Uint8Array(cap);
    b.set(this.buf.subarray(0, this.len));
    this.buf = b;
  }
  u8(...v: number[]) { this.grow(v.length); for (const x of v) this.buf[this.len++] = x & 0xff; }
  u16le(v: number) { this.u8(v & 0xff, (v >> 8) & 0xff); }
  u24le(v: number) { this.u8(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff); }
  u24be(v: number) { this.u8((v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff); }
  ascii(s: string) { for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i) & 0x7f); }
  setU24le(pos: number, v: number) { this.buf[pos] = v & 0xff; this.buf[pos + 1] = (v >> 8) & 0xff; this.buf[pos + 2] = (v >> 16) & 0xff; }
  bytes() { return this.buf.slice(0, this.len); }
}

const pad = (s: string, n: number, right = false) => (right ? s.padStart(n, " ") : s.padEnd(n, " "));
const num = (v: number, n: number) => pad(String(v), n, true);

export function bounds(st: Stitch[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of st) { if (s.x > x1) x1 = s.x; if (s.x < x0) x0 = s.x; if (s.y > y1) y1 = s.y; if (s.y < y0) y0 = s.y; }
  return st.length ? [x0, y0, x1, y1] : [0, 0, 0, 0];
}

/** Python-style round (half to even) so deltas match the reference exactly. */
function pyRound(v: number) {
  const r = Math.round(v);
  return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

function* deltas(st: Stitch[]) {
  let xx = 0, yy = 0;
  for (const s of st) {
    const dx = pyRound(s.x - xx), dy = pyRound(s.y - yy);
    xx += dx; yy += dy;
    yield { dx, dy, cmd: s.cmd };
  }
}

// ---------------- DST ----------------

const bit = (b: number) => 1 << b;

function dstRecord(x: number, y: number, flags: number): [number, number, number] {
  y = -y;
  let b0 = 0, b1 = 0, b2 = 0;
  if (flags === JUMP) b2 += bit(7);
  if (flags === STITCH || flags === JUMP) {
    b2 += bit(0) + bit(1);
    if (x > 40) { b2 += bit(2); x -= 81; }
    if (x < -40) { b2 += bit(3); x += 81; }
    if (x > 13) { b1 += bit(2); x -= 27; }
    if (x < -13) { b1 += bit(3); x += 27; }
    if (x > 4) { b0 += bit(2); x -= 9; }
    if (x < -4) { b0 += bit(3); x += 9; }
    if (x > 1) { b1 += bit(0); x -= 3; }
    if (x < -1) { b1 += bit(1); x += 3; }
    if (x > 0) { b0 += bit(0); x -= 1; }
    if (x < 0) { b0 += bit(1); x += 1; }
    if (x !== 0) throw new Error("DST: x move too long");
    if (y > 40) { b2 += bit(5); y -= 81; }
    if (y < -40) { b2 += bit(4); y += 81; }
    if (y > 13) { b1 += bit(5); y -= 27; }
    if (y < -13) { b1 += bit(4); y += 27; }
    if (y > 4) { b0 += bit(5); y -= 9; }
    if (y < -4) { b0 += bit(4); y += 9; }
    if (y > 1) { b1 += bit(7); y -= 3; }
    if (y < -1) { b1 += bit(6); y += 3; }
    if (y > 0) { b0 += bit(7); y -= 1; }
    if (y < 0) { b0 += bit(6); y += 1; }
    if (y !== 0) throw new Error("DST: y move too long");
  } else if (flags === COLOR_CHANGE) {
    b2 = 0b11000011;
  } else if (flags === END) {
    b2 = 0b11110011;
  }
  return [b0, b1, b2];
}

export function writeDST(p: EmbPattern): Uint8Array {
  const f = new Bytes();
  const [x0, y0, x1, y1] = bounds(p.stitches);
  const colorChanges = p.stitches.filter((s) => s.cmd === COLOR_CHANGE).length;
  f.ascii(`LA:${pad(p.name, 16)}\r`);
  f.ascii(`ST:${num(p.stitches.length, 7)}\r`);
  f.ascii(`CO:${num(colorChanges, 3)}\r`);
  f.ascii(`+X:${num(Math.abs(Math.trunc(x1)), 5)}\r`);
  f.ascii(`-X:${num(Math.abs(Math.trunc(x0)), 5)}\r`);
  f.ascii(`+Y:${num(Math.abs(Math.trunc(y1)), 5)}\r`);
  f.ascii(`-Y:${num(Math.abs(Math.trunc(y0)), 5)}\r`);
  const last = p.stitches[p.stitches.length - 1];
  const ax = last ? Math.trunc(last.x) : 0, ay = last ? -Math.trunc(last.y) : 0;
  f.ascii(ax >= 0 ? `AX:+${num(ax, 5)}\r` : `AX:-${num(Math.abs(ax), 5)}\r`);
  f.ascii(ay >= 0 ? `AY:+${num(ay, 5)}\r` : `AY:-${num(Math.abs(ay), 5)}\r`);
  f.ascii(`MX:+${num(0, 5)}\r`);
  f.ascii(`MY:+${num(0, 5)}\r`);
  f.ascii(`PD:${pad("******", 6, true)}\r`);
  f.u8(0x1a);
  while (f.len < 512) f.u8(0x20);
  for (const { dx, dy, cmd } of deltas(p.stitches)) {
    if (cmd === TRIM) {
      // Tajima trim: three zero-sum jumps
      f.u8(...dstRecord(2, 2, JUMP));
      f.u8(...dstRecord(-4, -4, JUMP));
      f.u8(...dstRecord(2, 2, JUMP));
    } else {
      f.u8(...dstRecord(dx, dy, cmd));
    }
  }
  return f.bytes();
}

// ---------------- EXP ----------------

export function writeEXP(p: EmbPattern): Uint8Array {
  const f = new Bytes();
  for (const { dx, dy, cmd } of deltas(p.stitches)) {
    if (cmd === STITCH) f.u8(dx & 0xff, -dy & 0xff);
    else if (cmd === JUMP) f.u8(0x80, 0x04, dx & 0xff, -dy & 0xff);
    else if (cmd === TRIM) f.u8(0x80, 0x80, 0x07, 0x00);
    else if (cmd === COLOR_CHANGE) f.u8(0x80, 0x01, 0x00, 0x00);
  }
  return f.bytes();
}

// ---------------- PES (truncated v1: header + PEC body) ----------------

function redMeanDistance(a: number, b: number) {
  const r1 = (a >> 16) & 255, g1 = (a >> 8) & 255, b1 = a & 255;
  const r2 = (b >> 16) & 255, g2 = (b >> 8) & 255, b2 = b & 255;
  const rm = pyRound((r1 + r2) / 2);
  const r = r1 - r2, g = g1 - g2, bl = b1 - b2;
  return (((512 + rm) * r * r) >> 8) + 4 * g * g + (((767 - rm) * bl * bl) >> 8);
}

function nearestIndex(color: number, values: readonly (number | null)[]) {
  let best: number | null = null, bestD = Infinity;
  values.forEach((t, i) => {
    if (t === null) return;
    const d = redMeanDistance(color, t);
    if (d <= bestD) { bestD = d; best = i; }
  });
  return best;
}

/** Map each thread to a distinct PEC palette slot (first come, first served). */
export function pecPalette(threads: number[]): number[] {
  const avail = [...PEC_THREADS];
  const chart: (number | null)[] = new Array(avail.length).fill(null);
  for (const t of Array.from(new Set(threads))) {
    const i = nearestIndex(t, avail);
    if (i === null) break;
    avail[i] = null;
    chart[i] = t;
  }
  return threads.map((t) => nearestIndex(t, chart) ?? 0);
}

function pecValue(f: Bytes, value: number, long = false, flag = 0) {
  if (!long && value > -64 && value < 63) f.u8(value & 0x7f);
  else {
    let v = value & 0x0fff;
    v |= 0x8000;
    v |= flag << 8;
    f.u8((v >> 8) & 0xff, v & 0xff);
  }
}

function markBit(g: number[], x: number, y: number, stride = 6) {
  const i = y * stride + Math.trunc(x / 8);
  if (i < 0 || i >= g.length || x < 0) return;
  g[i] |= 1 << (x % 8);
}

function drawScaled(ext: [number, number, number, number], pts: Stitch[], g: number[], stride: number, buffer = 5) {
  const [l, t, r, b] = ext;
  const dw = r - l || 1, dh = b - t || 1;
  const gw = stride * 8, gh = g.length / stride;
  const scale = Math.min((gw - buffer) / dw, (gh - buffer) / dh);
  const tx = -((r + l) / 2) * scale + gw / 2;
  const ty = -((b + t) / 2) * scale + gh / 2;
  for (const p of pts) {
    const x = Math.floor(p.x * scale + tx), y = Math.floor(p.y * scale + ty);
    if (y * stride + Math.trunc(x / 8) < g.length) markBit(g, x, y, stride);
  }
}

export function writePES(p: EmbPattern): Uint8Array {
  const f = new Bytes();
  f.ascii("#PES0001");
  f.u8(0x16, ...new Array(13).fill(0));
  const ext = bounds(p.stitches);

  // PEC header
  f.ascii(`LA:${pad(p.name.slice(0, 8), 16)}\r`);
  f.u8(0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0xff, 0x00);
  f.u8(6, 38); // icon stride (48 / 8) and height
  const idx = pecPalette(p.threads);
  if (idx.length) {
    f.u8(...new Array(12).fill(0x20));
    f.u8(idx.length - 1, ...idx);
  } else {
    f.u8(0x20, 0x20, 0x20, 0x20, 0x64, 0x20, 0x00, 0x20, 0x00, 0x20, 0x20, 0x20, 0xff);
  }
  for (let i = idx.length; i < 463; i++) f.u8(0x20);

  // PEC stitch block
  const start = f.len;
  f.u8(0x00, 0x00);
  f.u24le(0);
  f.u8(0x31, 0xff, 0xf0);
  f.u16le(pyRound(ext[2] - ext[0]));
  f.u16le(pyRound(ext[3] - ext[1]));
  f.u16le(0x1e0);
  f.u16le(0x1b0);
  let colorTwo = true, jumping = true, init = true;
  for (const { dx, dy, cmd } of deltas(p.stitches)) {
    if (cmd === STITCH) {
      if (jumping) { if (dx !== 0 && dy !== 0) { pecValue(f, 0); pecValue(f, 0); } jumping = false; }
      pecValue(f, dx); pecValue(f, dy);
    } else if (cmd === JUMP) {
      jumping = true;
      const flag = init ? 0x10 : 0x20; // jump at the start, trim-jump afterwards
      pecValue(f, dx, true, flag); pecValue(f, dy, true, flag);
    } else if (cmd === COLOR_CHANGE) {
      if (jumping) { pecValue(f, 0); pecValue(f, 0); jumping = false; }
      f.u8(0xfe, 0xb0, colorTwo ? 0x02 : 0x01);
      colorTwo = !colorTwo;
    } else if (cmd === END) {
      f.u8(0xff);
      break;
    }
    init = false;
  }
  f.setU24le(start + 2, f.len - start);

  // PEC thumbnails: whole design, then one per color block
  const all = [...PEC_BLANK];
  const sewn = p.stitches.filter((s) => s.cmd === STITCH);
  drawScaled(ext, sewn, all, 6, 4);
  f.u8(...all);
  let blockStart = 0;
  const blocks: Stitch[][] = [];
  p.stitches.forEach((s, i) => {
    if (s.cmd === COLOR_CHANGE) { blocks.push(p.stitches.slice(blockStart, i + 1)); blockStart = i + 1; }
  });
  if (blockStart !== p.stitches.length) blocks.push(p.stitches.slice(blockStart));
  for (const b of blocks) {
    const g = [...PEC_BLANK];
    drawScaled(ext, b.filter((s) => s.cmd === STITCH), g, 6);
    f.u8(...g);
  }
  return f.bytes();
}

// ---------------- JEF (Janome) ----------------

const writeI32le = (f: Bytes, v: number) => f.u8(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
const writeI32be = (f: Bytes, v: number) => f.u8((v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
const writeI16be = (f: Bytes, v: number) => f.u8((v >> 8) & 0xff, v & 0xff);

function jefHoop(w: number, h: number) {
  if (w < 500 && h < 500) return 1; // 50 x 50
  if (w < 1260 && h < 1100) return 3; // 126 x 110
  if (w < 1400 && h < 2000) return 2; // 140 x 200
  if (w < 2000 && h < 2000) return 4; // 200 x 200
  return 0; // 110 x 110
}

const jefDate = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** Janome JEF. `date` is the 14-digit YYYYMMDDHHMMSS stamp (defaults to now). */
export function writeJEF(p: EmbPattern, date = jefDate()): Uint8Array {
  const f = new Bytes();
  // thread palette: nearest JEF chart color, with neighbouring blocks kept distinguishable
  const chart = [...JEF_THREADS];
  const palette: number[] = [];
  let lastIndex: number | null = null, lastThread: number | null = null, ti = 0;
  for (const s of p.stitches) {
    if (s.cmd === COLOR_CHANGE || ti === 0) {
      const thread = p.threads[ti++] ?? 0;
      let idx = nearestIndex(thread, chart)!;
      if (lastIndex === idx && lastThread !== thread) {
        const keep = chart[idx];
        chart[idx] = null;
        const second = nearestIndex(thread, chart)!;
        chart[idx] = keep;
        idx = second;
      }
      palette.push(idx);
      lastIndex = idx;
      lastThread = thread;
    }
  }
  const colorCount = palette.length;
  writeI32le(f, 0x74 + colorCount * 8);
  writeI32le(f, 0x14);
  f.ascii(date);
  f.u8(0, 0);
  writeI32le(f, colorCount);
  let points = 1;
  for (const s of p.stitches) {
    if (s.cmd === STITCH) points += 1;
    else if (s.cmd === JUMP || s.cmd === COLOR_CHANGE) points += 2;
    else if (s.cmd === END) break;
  }
  writeI32le(f, points);
  const [x0, y0, x1, y1] = bounds(p.stitches);
  const w = pyRound(x1 - x0), h = pyRound(y1 - y0);
  writeI32le(f, jefHoop(w, h));
  const hw = pyRound(w / 2), hh = pyRound(h / 2);
  writeI32le(f, hw); writeI32le(f, hh); writeI32le(f, hw); writeI32le(f, hh);
  const edge = (ex: number, ey: number) => {
    if (Math.min(ex, ey) >= 0) { writeI32le(f, ex); writeI32le(f, ey); writeI32le(f, ex); writeI32le(f, ey); }
    else for (let i = 0; i < 4; i++) writeI32le(f, -1);
  };
  edge(550 - hw, 550 - hh); // 110 x 110
  edge(250 - hw, 250 - hh); // 50 x 50
  edge(700 - hw, 1000 - hh); // 140 x 200
  edge(700 - hw, 1000 - hh); // custom
  for (const t of palette) writeI32le(f, t);
  for (let i = 0; i < colorCount; i++) writeI32le(f, 0x0d);
  for (const { dx, dy, cmd } of deltas(p.stitches)) {
    if (cmd === STITCH) f.u8(dx & 0xff, -dy & 0xff);
    else if (cmd === COLOR_CHANGE) f.u8(0x80, 0x01, dx & 0xff, -dy & 0xff);
    else if (cmd === JUMP) f.u8(0x80, 0x02, dx & 0xff, -dy & 0xff);
    else if (cmd === END) break;
    // trims: JEF machines trim on long jumps, matching pyembroidery's default (no trim command)
  }
  f.u8(0x80, 0x10);
  return f.bytes();
}

// ---------------- VP3 (Husqvarna Viking / Pfaff) ----------------

/** Python int(): truncate toward zero. */
const pyInt = Math.trunc;

function vp3Str16(f: Bytes, s: string) {
  writeI16be(f, s.length * 2);
  for (let i = 0; i < s.length; i++) writeI16be(f, s.charCodeAt(i));
}
function vp3Str8(f: Bytes, s: string) {
  writeI16be(f, s.length);
  f.ascii(s);
}

class Patchable extends Bytes {
  /** Fill a 4-byte big-endian length at `at`: bytes from after the field to the current end. */
  patch(at: number) {
    const v = this.len - at - 4, b = this.buf;
    b[at] = (v >>> 24) & 0xff; b[at + 1] = (v >>> 16) & 0xff; b[at + 2] = (v >>> 8) & 0xff; b[at + 3] = v & 0xff;
  }
}

export function writeVP3(p: EmbPattern): Uint8Array {
  const f = new Patchable();
  const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
  f.ascii("%vsm%");
  f.u8(0);
  vp3Str16(f, "Produced by     Software Ltd");
  f.u8(0x00, 0x02, 0x00);
  const endFile = f.len;
  writeI32be(f, 0);
  vp3Str16(f, "");
  // color blocks split at COLOR_CHANGE (the change stitch starts the next block)
  const blocks: { st: Stitch[]; thread: number }[] = [];
  let last = 0, ti = 0;
  p.stitches.forEach((s, i) => {
    if (s.cmd !== COLOR_CHANGE) return;
    blocks.push({ st: p.stitches.slice(last, i), thread: p.threads[ti++] ?? 0 });
    last = i;
  });
  blocks.push({ st: p.stitches.slice(last), thread: p.threads[ti++] ?? 0 });
  const [x0, y0, x1, y1] = bounds(p.stitches);
  writeI32be(f, pyInt(x1 * 100));
  writeI32be(f, pyInt(y0 * -100));
  writeI32be(f, pyInt(x0 * 100));
  writeI32be(f, pyInt(y1 * -100));
  const ends = p.stitches.filter((s) => s.cmd === END).length;
  writeI32be(f, p.stitches.length - ends);
  f.u8(0, blocks.length, 12, 0);
  f.u8(1); // one design
  // design block
  f.u8(0x00, 0x03, 0x00);
  const endDesign = f.len;
  writeI32be(f, 0);
  const w = x1 - x0, h = y1 - y0, hw = w / 2, hh = h / 2;
  const cx = x1 - hw, cy = y1 - hh;
  writeI32be(f, pyInt(cx) * 100);
  writeI32be(f, pyInt(cy) * -100);
  f.u8(0, 0, 0);
  writeI32be(f, pyInt(hw) * -100);
  writeI32be(f, pyInt(hw) * 100);
  writeI32be(f, pyInt(hh) * -100);
  writeI32be(f, pyInt(hh) * 100);
  writeI32be(f, pyInt(w) * 100);
  writeI32be(f, pyInt(h) * 100);
  vp3Str16(f, "");
  f.u8(0x64, 0x64);
  writeI32be(f, 4096); writeI32be(f, 0); writeI32be(f, 0); writeI32be(f, 4096);
  f.ascii("xxPP"); f.u8(0x01, 0x00);
  vp3Str16(f, "Produced by     Software Ltd");
  writeI16be(f, blocks.length);
  blocks.forEach(({ st, thread }, bi) => {
    f.u8(0x00, 0x05, 0x00);
    const endBlock = f.len;
    writeI32be(f, 0);
    let fx = 0, fy = 0, lx = 0, ly = 0;
    if (st.length) {
      fx = bi === 0 ? 0 : st[0].x; fy = bi === 0 ? 0 : st[0].y;
      lx = st[st.length - 1].x; ly = st[st.length - 1].y;
    }
    writeI32be(f, pyInt(fx - cx) * 100);
    writeI32be(f, pyInt(-(fy - cy)) * 100);
    // thread: single color, Rayon 40wt, no catalog/brand, hex as description
    f.u8(0x01, 0x00);
    f.u24be(thread);
    f.u8(0x00, 0x00, 0x00, 0x05, 0x28);
    vp3Str8(f, ""); vp3Str8(f, hex(thread)); vp3Str8(f, "");
    writeI32be(f, pyInt(lx - fx) * 100);
    writeI32be(f, pyInt(-(ly - fy)) * 100);
    // stitches
    f.u8(0x00, 0x01, 0x00);
    const endSt = f.len;
    writeI32be(f, 0);
    f.u8(0x0a, 0xf6, 0x00);
    let px = fx, py = fy;
    for (const s of st) {
      if (s.cmd === END) { f.u8(0x80, 0x03); break; }
      if (s.cmd === COLOR_CHANGE || s.cmd === JUMP) continue;
      if (s.cmd === TRIM) { f.u8(0x80, 0x03); continue; }
      const dx = pyInt(s.x - px), dy = pyInt(s.y - py);
      px += dx; py += dy;
      if (dx >= -127 && dx <= 127 && dy >= -127 && dy <= 127) f.u8(dx & 0xff, dy & 0xff);
      else { f.u8(0x80, 0x01); writeI16be(f, dx); writeI16be(f, dy); f.u8(0x80, 0x02); }
    }
    f.patch(endSt);
    f.u8(0);
    f.patch(endBlock);
  });
  f.patch(endDesign);
  f.patch(endFile);
  return f.bytes();
}

export type EmbFormat = "dst" | "pes" | "exp" | "jef" | "vp3";
export const EMB_WRITERS: Record<EmbFormat, (p: EmbPattern) => Uint8Array> = { dst: writeDST, pes: writePES, exp: writeEXP, jef: (p) => writeJEF(p), vp3: writeVP3 };
