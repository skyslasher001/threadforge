// Perspective warp of flat artwork onto a photo, with the photo's own light and folds showing through.
// The math (homography) is pure and unit-tested; composite() works on ImageData.

export type Quad = [number, number][]; // TL, TR, BR, BL
export type H = number[]; // 3x3 row-major, h[8] = 1

/** Homography mapping the four `src` points onto the four `dst` points (DLT, 8x8 solve). */
export function homography(src: Quad, dst: Quad): H {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  // Gaussian elimination with partial pivoting
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) throw new Error("Corners are collinear");
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      if (!f) continue;
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return [...h, 1];
}

export function apply(h: H, x: number, y: number): [number, number] {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

export function invert(h: H): H {
  const [a, b, c, d, e, f, g, i, j] = h;
  const A = e * j - f * i, B = -(d * j - f * g), C = d * i - e * g;
  const det = a * A + b * B + c * C;
  const m = [A, -(b * j - c * i), b * f - c * e, B, a * j - c * g, -(a * f - c * d), C, -(a * i - b * g), a * e - b * d].map((v) => v / det);
  return m.map((v) => v / m[8]);
}

/** True when the quad is convex and wound consistently (a usable print area). */
export function convex(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4], [cx, cy] = q[(i + 2) % 4];
    const z = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (Math.abs(z) < 1e-9) return false;
    const s = Math.sign(z);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

export interface CompositeOpts {
  shading: number; // 0..1
  opacity: number; // 0..1
}

/**
 * Warp `art` (a flat print area) into `quad` on `photo`, modulating it by the photo's local
 * brightness so folds and light read through the print. Writes into `photo` in place.
 * `scale` maps quad coordinates (full-size photo pixels) onto this ImageData.
 */
export function composite(photo: ImageData, art: ImageData, quad: Quad, o: CompositeOpts, scale = 1) {
  const q = quad.map(([x, y]) => [x * scale, y * scale]) as Quad;
  const W = art.width, Hh = art.height;
  const inv = invert(homography([[0, 0], [W, 0], [W, Hh], [0, Hh]], q));
  const x0 = Math.max(0, Math.floor(Math.min(...q.map((p) => p[0])))), x1 = Math.min(photo.width - 1, Math.ceil(Math.max(...q.map((p) => p[0]))));
  const y0 = Math.max(0, Math.floor(Math.min(...q.map((p) => p[1])))), y1 = Math.min(photo.height - 1, Math.ceil(Math.max(...q.map((p) => p[1]))));
  if (x1 < x0 || y1 < y0) return;
  const P = photo.data, A = art.data, pw = photo.width;
  const lum = (i: number) => 0.2126 * P[i] + 0.7152 * P[i + 1] + 0.0722 * P[i + 2];
  // mean brightness of the fabric under the print area
  let sum = 0, n = 0;
  for (let y = y0; y <= y1; y += 2)
    for (let x = x0; x <= x1; x += 2) {
      const [u, v] = apply(inv, x + 0.5, y + 0.5);
      if (u < 0 || v < 0 || u >= W || v >= Hh) continue;
      sum += lum((y * pw + x) * 4); n++;
    }
  const mean = Math.max(8, n ? sum / n : 128);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const [u, v] = apply(inv, x + 0.5, y + 0.5);
      if (u < -0.5 || v < -0.5 || u > W - 0.5 || v > Hh - 0.5) continue;
      // bilinear sample of the artwork
      const fx = Math.max(0, Math.min(W - 1.001, u - 0.5)), fy = Math.max(0, Math.min(Hh - 1.001, v - 0.5));
      const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const i00 = (iy * W + ix) * 4, i10 = i00 + 4, i01 = i00 + W * 4, i11 = i01 + 4;
      const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
      const a = (A[i00 + 3] * w00 + A[i10 + 3] * w10 + A[i01 + 3] * w01 + A[i11 + 3] * w11) / 255;
      if (a <= 0.003) continue;
      const pi = (y * pw + x) * 4;
      const shade = Math.pow(Math.max(0.05, Math.min(1.7, lum(pi) / mean)), o.shading);
      const al = a * o.opacity;
      for (let c = 0; c < 3; c++) {
        // premultiplied sample, un-premultiplied by the coverage
        const s = (A[i00 + c] * A[i00 + 3] * w00 + A[i10 + c] * A[i10 + 3] * w10 + A[i01 + c] * A[i01 + 3] * w01 + A[i11 + c] * A[i11 + 3] * w11) / (a * 255);
        const lit = shade <= 1 ? s * shade : s + (255 - s) * (shade - 1) * 0.6;
        P[pi + c] = P[pi + c] * (1 - al) + lit * al;
      }
    }
}
