// Turns a flat garment silhouette into a closed, softly inflated 3D shell (front + back surfaces).
// Pure math, no DOM: unit-tested in tests/geometry.test.ts.

export interface InflateInput {
  mask: Uint8Array; // fine silhouette mask, 1 = garment
  maskCols: number;
  maskRows: number;
  res: number; // mask pixels per inch
  cell: number; // inches between mesh vertices (mesh is coarser than the mask)
  depth: number; // max half-thickness, inches
  reach: number; // distance from the edge (inches) at which the full depth is reached
}

export interface Shell {
  cols: number;
  rows: number;
  x: Float32Array; // vertex positions in inches from the mask's top-left
  y: Float32Array;
  z: Float32Array; // half-thickness, 0 on the silhouette
  index: Uint32Array; // triangles over cells that touch the garment
}

/** Two-pass chamfer distance transform (3-4 weights): distance from each inside pixel to the outside, in `unit`s. */
export function edgeDistance(cols: number, rows: number, inside: Uint8Array, unit: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(cols * rows);
  for (let i = 0; i < d.length; i++) d[i] = inside[i] ? INF : 0;
  const a = unit, b = unit * Math.SQRT2;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (!d[i]) continue;
      let v = d[i];
      v = Math.min(v, x > 0 ? d[i - 1] + a : a); // the border counts as outside
      if (y > 0) {
        v = Math.min(v, d[i - cols] + a);
        if (x > 0) v = Math.min(v, d[i - cols - 1] + b);
        if (x < cols - 1) v = Math.min(v, d[i - cols + 1] + b);
      } else v = Math.min(v, a);
      d[i] = v;
    }
  }
  for (let y = rows - 1; y >= 0; y--) {
    for (let x = cols - 1; x >= 0; x--) {
      const i = y * cols + x;
      if (!d[i]) continue;
      let v = d[i];
      v = Math.min(v, x < cols - 1 ? d[i + 1] + a : a);
      if (y < rows - 1) {
        v = Math.min(v, d[i + cols] + a);
        if (x < cols - 1) v = Math.min(v, d[i + cols + 1] + b);
        if (x > 0) v = Math.min(v, d[i + cols - 1] + b);
      } else v = Math.min(v, a);
      d[i] = v;
    }
  }
  return d;
}

/** Elliptical profile: steep at the edge, flat in the middle, like a garment on a form. */
export const profile = (dist: number, depth: number, reach: number) => {
  if (dist <= 0) return 0;
  const t = Math.min(1, dist / reach);
  return depth * Math.sqrt(1 - (1 - t) * (1 - t));
};

export function inflate(o: InflateInput): Shell {
  const { mask, maskCols: mc, maskRows: mr, res, cell } = o;
  const px = 1 / res;
  // distance (inches) measured to the pixel edge, then blurred so chamfer facets don't show in the lighting
  const raw = edgeDistance(mc, mr, mask, px);
  const dist = new Float32Array(raw.length);
  for (let y = 0; y < mr; y++)
    for (let x = 0; x < mc; x++) {
      const i = y * mc + x;
      if (!mask[i]) continue;
      let s = 0, n = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= mc || yy >= mr) { n++; continue; }
          s += raw[yy * mc + xx]; n++;
        }
      dist[i] = Math.max(px * 0.5, s / n - px * 0.5);
    }
  const sample = (x: number, y: number) => {
    // bilinear on pixel centres
    const fx = x * res - 0.5, fy = y * res - 0.5;
    const x0 = Math.max(0, Math.min(mc - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(mr - 1, Math.floor(fy)));
    const x1 = Math.min(mc - 1, x0 + 1), y1 = Math.min(mr - 1, y0 + 1);
    const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0));
    const v = (xx: number, yy: number) => dist[yy * mc + xx];
    return (v(x0, y0) * (1 - tx) + v(x1, y0) * tx) * (1 - ty) + (v(x0, y1) * (1 - tx) + v(x1, y1) * tx) * ty;
  };
  const isIn = (x: number, y: number) => {
    const ix = Math.floor(x * res), iy = Math.floor(y * res);
    return ix >= 0 && iy >= 0 && ix < mc && iy < mr && mask[iy * mc + ix] === 1;
  };

  const cols = Math.floor(((mc - 1) / res) / cell) + 1;
  const rows = Math.floor(((mr - 1) / res) / cell) + 1;
  const n = cols * rows;
  const X = new Float32Array(n), Y = new Float32Array(n), Z = new Float32Array(n);
  const inside = new Uint8Array(n);
  for (let gy = 0; gy < rows; gy++)
    for (let gx = 0; gx < cols; gx++) {
      const i = gy * cols + gx;
      X[i] = gx * cell;
      Y[i] = gy * cell;
      inside[i] = isIn(X[i], Y[i]) ? 1 : 0;
    }
  // vertices just outside the garment are pulled onto its edge, so the shell closes exactly on the silhouette
  const used = new Uint8Array(n);
  for (let gy = 0; gy < rows - 1; gy++)
    for (let gx = 0; gx < cols - 1; gx++) {
      const a = gy * cols + gx, b = a + 1, c = a + cols, d = c + 1;
      if (inside[a] || inside[b] || inside[c] || inside[d]) used[a] = used[b] = used[c] = used[d] = 1;
    }
  const R = Math.ceil(cell * 1.5 * res);
  for (let i = 0; i < n; i++) {
    if (inside[i]) { Z[i] = profile(sample(X[i], Y[i]), o.depth, o.reach); continue; }
    if (!used[i]) continue;
    const cx = Math.floor(X[i] * res), cy = Math.floor(Y[i] * res);
    let best = Infinity, bx = 0, by = 0;
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const xx = cx + dx, yy = cy + dy;
        if (xx < 0 || yy < 0 || xx >= mc || yy >= mr || !mask[yy * mc + xx]) continue;
        const dd = dx * dx + dy * dy;
        if (dd < best) { best = dd; bx = xx; by = yy; }
      }
    if (best === Infinity) continue;
    // the nearest inside pixel's outer edge, on the side facing this vertex
    const tx = (bx + 0.5) / res, ty = (by + 0.5) / res;
    const vx = X[i] - tx, vy = Y[i] - ty, len = Math.hypot(vx, vy) || 1;
    X[i] = tx + (vx / len) * px * 0.5;
    Y[i] = ty + (vy / len) * px * 0.5;
    Z[i] = 0;
  }
  const idx: number[] = [];
  for (let gy = 0; gy < rows - 1; gy++)
    for (let gx = 0; gx < cols - 1; gx++) {
      const a = gy * cols + gx, b = a + 1, c = a + cols, d = c + 1;
      if (!(inside[a] + inside[b] + inside[c] + inside[d])) continue;
      // split along the diagonal joining the inside pair, so an outside corner sits alone in one triangle
      if (inside[a] + inside[d] >= inside[b] + inside[c]) idx.push(a, c, d, a, d, b);
      else idx.push(a, c, b, b, c, d);
    }
  return { cols, rows, x: X, y: Y, z: Z, index: new Uint32Array(idx) };
}
