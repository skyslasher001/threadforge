import type { Pt, Stroke } from "../types";

// QuickShape (draw and hold to snap) and Sketch-to-Flat (clean technical lines).

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

function pathLength(pts: Pt[]) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  return L;
}

function segDist(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Snap a hand-drawn stroke to a line, ellipse or rectangle. Returns null if it's none of these. */
export function quickShape(pts: Pt[]): { kind: "line" | "ellipse" | "rectangle"; points: Pt[] } | null {
  if (pts.length < 6) return null;
  const L = pathLength(pts);
  if (L < 0.4) return null;
  const a = pts[0], b = pts[pts.length - 1];
  const p = 0.7;
  // Line: every point stays close to the chord.
  const chord = dist(a, b);
  const maxDev = Math.max(...pts.map((q) => segDist(q, a, b)));
  if (chord > L * 0.85 && maxDev < Math.max(0.12, chord * 0.06)) {
    return { kind: "line", points: [{ x: a.x, y: a.y, p }, { x: b.x, y: b.y, p }] };
  }
  // Closed shapes: ends meet.
  if (chord < L * 0.2) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of pts) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
    const w = x1 - x0, h = y1 - y0;
    if (w < 0.2 || h < 0.2) return null;
    // Shoelace area vs bounding box: rectangles fill ~100%, ellipses ~78%.
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const c = pts[i], n = pts[(i + 1) % pts.length];
      area += c.x * n.y - n.x * c.y;
    }
    const fill = Math.abs(area / 2) / (w * h);
    if (fill > 0.88) {
      const c = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
      // doubled corners keep the smoothing pass from rounding them
      return { kind: "rectangle", points: c.flatMap(([x, y]) => [{ x, y, p }, { x, y, p }]) };
    }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const N = 72;
    return {
      kind: "ellipse",
      points: Array.from({ length: N + 1 }, (_, i) => {
        const t = (i / N) * Math.PI * 2;
        return { x: cx + (Math.cos(t) * w) / 2, y: cy + (Math.sin(t) * h) / 2, p };
      }),
    };
  }
  return null;
}

/** Ramer–Douglas–Peucker simplification. */
function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  let idx = 0, max = 0;
  const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], a, b);
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [a, b];
  const left = rdp(pts.slice(0, idx + 1), eps);
  const right = rdp(pts.slice(idx), eps);
  return [...left.slice(0, -1), ...right];
}

/** Chaikin corner cutting for smooth, even curves. */
function chaikin(pts: Pt[], iterations = 2): Pt[] {
  let out = pts;
  for (let k = 0; k < iterations; k++) {
    if (out.length < 3) return out;
    const next: Pt[] = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i], b = out[i + 1];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25, p: 0.7 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75, p: 0.7 });
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

/**
 * Turn rough sketch strokes into clean technical flat lines: simplify the
 * wobble out, smooth evenly, and use one uniform weight.
 */
export function sketchToFlat(strokes: Stroke[], layerId: string, color: string, weight = 0.05): Stroke[] {
  return strokes
    .filter((s) => s.style !== "erase" && s.points.length > 1)
    .map((s) => {
      const simple = rdp(s.points, Math.max(0.04, s.size * 0.25));
      const smooth = chaikin(simple, 2).map((q) => ({ x: +q.x.toFixed(3), y: +q.y.toFixed(3), p: 0.7 }));
      return { ...s, id: Math.random().toString(36).slice(2, 10), layerId, style: "technical" as const, color, size: weight, opacity: 1, points: smooth };
    });
}
