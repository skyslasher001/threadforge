import { useStore, uid, type BenchResult } from "../state/store";
import type { BrushStyle, Layer, Stroke, View } from "../types";
import { renderStats } from "../components/Stage";

const frame = () => new Promise<number>((r) => requestAnimationFrame(r));

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Gate 1 benchmark: 2,000 drawn paths, then measure pan frame times and a full re-render. Leaves the design untouched. */
export async function runBenchmark(paths = 2000): Promise<BenchResult> {
  const st = useStore.getState();
  const orig = st.design, past = st.past, future = st.future, cam = st.camera;
  const rand = rng(42);
  const styles: BrushStyle[] = ["technical", "ink", "marker", "pencil", "technical", "ink"];
  const layers: Layer[] = (["front", "back"] as View[]).map((view) => ({ id: `bench-${view}-${uid()}`, view, name: "Benchmark", visible: true, locked: false, opacity: 1, blend: "normal" }));
  const strokes: Stroke[] = Array.from({ length: paths }, (_, i) => {
    const view: View = i % 2 ? "back" : "front";
    const x0 = (rand() - 0.5) * 20, y0 = 2 + rand() * 24;
    const a = rand() * Math.PI * 2;
    return {
      id: `b${i}`, view, layerId: layers[i % 2].id, style: styles[i % styles.length], color: ["#16161A", "#E0663A", "#2E4A7D", "#B8322E"][i % 4],
      size: 0.06 + rand() * 0.2, opacity: 0.9, seed: i,
      points: Array.from({ length: 32 }, (_, k) => ({ x: x0 + Math.cos(a) * k * 0.18 + Math.sin(k / 3) * 0.4, y: y0 + Math.sin(a) * k * 0.18 + Math.cos(k / 4) * 0.4, p: 0.4 + 0.5 * Math.sin(k / 10) })),
    };
  });

  useStore.setState({ bench: { running: true, result: null }, design: { ...orig, layers: [...orig.layers, ...layers], strokes: [...orig.strokes, ...strokes] } });
  await frame();
  await frame();
  const fullRenderMs = renderStats.lastFullMs;
  // One more stroke on top of 2,000: should only draw the new stroke.
  const extra: Stroke = { ...strokes[0], id: "b-extra", seed: 99999 };
  const cur = useStore.getState().design;
  useStore.setState({ design: { ...cur, strokes: [...cur.strokes, extra] } });
  await frame();
  const addStrokeMs = renderStats.lastFullMs;

  // Pan for ~2 seconds and record every frame interval.
  const times: number[] = [];
  let last = await frame();
  const start = last;
  let t = 0;
  while (last - start < 2000) {
    t++;
    const c = useStore.getState().camera;
    useStore.setState({ camera: { ...c, x: cam.x + Math.sin(t / 18) * 180, y: cam.y + Math.cos(t / 23) * 60 } });
    const now = await frame();
    times.push(now - last);
    last = now;
  }
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const sorted = [...times].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? mean;

  const result: BenchResult = {
    paths,
    panFps: Math.round(1000 / mean),
    p95FrameMs: +p95.toFixed(1),
    fullRenderMs: +fullRenderMs.toFixed(1),
    addStrokeMs: +addStrokeMs.toFixed(1),
    coldStartMs: Math.round(renderStats.firstPaintAt),
  };
  useStore.setState({ design: orig, past, future, camera: cam, bench: { running: false, result } });
  return result;
}
