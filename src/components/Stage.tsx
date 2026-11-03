import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useStore, uid } from "../state/store";
import type { Design, Graphic, Pt, Stroke, View } from "../types";
import { ARTBOARD, artboardX, buildGarment, contentBounds, type GarmentGeom } from "../data/garments";
import { fabricFor } from "../data/fabrics";
import { fmt, gradedSpec } from "../data/measurements";
import { GarmentView } from "./Garment";
import { SvgFilters } from "../lib/brushes";
import { compositeLayer, drawLayerStrokes, drawStroke, garmentClip, paintView } from "../lib/raster";
import { addImageFiles, geomFor } from "../lib/graphics";
import { graphicHeight } from "../lib/checks";
import { quickShape } from "../lib/shapes";

const VIEWS: View[] = ["front", "back"];
const brushScale: Record<string, number> = {
  technical: 1, ink: 1, marker: 1.4, pencil: 0.7, charcoal: 1.3, spray: 2.4, airbrush: 1.6, neon: 1.2, erase: 1.6,
  watercolor: 2.2, halftone: 1.6, riso: 1.6, chrome: 1.3,
};

type Drag =
  | { kind: "pan"; sx: number; sy: number; cx: number; cy: number }
  | { kind: "draw"; view: View; pid: number }
  | { kind: "move"; id: string; view: View; ox: number; oy: number }
  | { kind: "scale"; id: string; view: View; w0: number; d0: number }
  | { kind: "rotate"; id: string; view: View };

/** Render statistics read by the in-app benchmark. */
export const renderStats = { lastFullMs: 0, fullRenders: 0, firstPaintAt: 0 };

/** Inches -> device-pixel matrix for one view at a given camera. */
export function viewMatrix(view: View, cam: { x: number; y: number; s: number }, dpr: number) {
  return new DOMMatrix([
    cam.s * dpr, 0, 0, cam.s * dpr,
    (cam.x + (artboardX(view) + ARTBOARD.originX) * cam.s) * dpr,
    (cam.y + ARTBOARD.originY * cam.s) * dpr,
  ]);
}

/** Paint every view's drawing layers (used by the stage and by PNG export). */
export function paintAllViews(ctx: CanvasRenderingContext2D, d: Design, geoms: Record<View, GarmentGeom>, matrix: (v: View) => DOMMatrix, clip: boolean, cull?: { w: number; h: number }) {
  for (const v of VIEWS) {
    paintView(ctx, {
      layers: d.layers.filter((l) => l.view === v),
      strokes: d.strokes.filter((s) => s.view === v),
      transform: matrix(v),
      clip: clip ? garmentClip(geoms[v].body, geoms[v].hood) : undefined,
    }, cull);
  }
}

export function Stage({ svgRef }: { svgRef: RefObject<SVGSVGElement | null> }) {
  const design = useStore((s) => s.design);
  const camera = useStore((s) => s.camera);
  const tool = useStore((s) => s.tool);
  const symmetry = useStore((s) => s.symmetry);
  const clip = useStore((s) => s.clip);
  const showDims = useStore((s) => s.showDims);
  const showZones = useStore((s) => s.showZones);
  const showStitches = useStore((s) => s.showStitches);
  const compareSize = useStore((s) => s.compareSize);
  const units = useStore((s) => s.units);
  const selected = useStore((s) => s.selected);
  const processed = useStore((s) => s.processed);
  const fitRequest = useStore((s) => s.fitRequest);
  const mode = useStore((s) => s.mode);
  const set = useStore((s) => s.set);

  const wrap = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draftRef2 = useRef<HTMLCanvasElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const space = useRef(false);
  const holdTimer = useRef<number | undefined>(undefined);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [draft, setDraft] = useState<Stroke | null>(null);
  const [guides, setGuides] = useState<{ view: View; x?: number; zone?: string } | null>(null);
  const [dropping, setDropping] = useState(false);
  const [panning, setPanning] = useState(false);
  const draftRef = useRef<Stroke | null>(null);
  // Camera baked into the SVG. While the live camera moves, the SVGs are moved with a
  // GPU-composited CSS transform and only re-rasterized once the camera settles.
  const [svgCam, setSvgCam] = useState(camera);
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  const spec = useMemo(() => gradedSpec(design.base, design.grade, design.previewSize), [design.base, design.grade, design.previewSize]);
  const geoms = useMemo(
    () => ({ front: geomFor(design, "front"), back: geomFor(design, "back") }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [design.template, design.parts, spec],
  );
  const ghosts = useMemo(() => {
    if (!compareSize || compareSize === design.previewSize) return null;
    const m = gradedSpec(design.base, design.grade, compareSize);
    return { front: buildGarment(design.template, "front", m, design.parts), back: buildGarment(design.template, "back", m, design.parts) };
  }, [compareSize, design.base, design.grade, design.previewSize, design.template, design.parts]);
  const geomsRef = useRef(geoms);
  geomsRef.current = geoms;
  const fabric = fabricFor(design, design.fabricId);
  const trimFabric = fabricFor(design, design.trimFabricId);

  // ---- sizing & fit ----
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    // Frame the garments themselves, not the empty artboard around them.
    const c = contentBounds(geomsRef.current, 3);
    const W = c.x1 - c.x0, H = c.y1 - c.y0;
    const pad = 36;
    const s = Math.max(1.5, Math.min((size.w - pad * 2) / W, (size.h - pad * 2 - 20) / H));
    set({ camera: { s, x: (size.w - W * s) / 2 - c.x0 * s, y: (size.h - H * s) / 2 - c.y0 * s + 10 } });
  }, [size, set]);

  // Keep the garments framed when the window or panels resize, until the user pans or zooms.
  const autoFit = useRef(true);
  useEffect(() => {
    if (size.w < 50) return;
    autoFit.current = true;
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitRequest]);
  useEffect(() => {
    if (size.w > 50 && autoFit.current) fit();
  }, [size, fit]);

  // ---- canvas stroke rendering: full render when content changes, cheap blit while the camera moves ----
  const cache = useRef<{ canvas: HTMLCanvasElement; cam: { x: number; y: number; s: number }; key: unknown[] } | null>(null);
  const idle = useRef<number | undefined>(undefined);
  const contentKey = [design.strokes, design.layers, clip, geoms, size.w, size.h];

  // One surface per drawing layer. Appending strokes draws only the new ones; anything
  // else (undo, erase history, camera change) redraws just the affected layer.
  const layerSurfaces = useRef(new Map<string, { canvas: HTMLCanvasElement; drawn: Stroke[]; cam: { x: number; y: number; s: number } }>());

  const fullRender = useCallback(() => {
    const vis = canvasRef.current;
    if (!vis) return;
    const W = Math.round(size.w * dpr), H = Math.round(size.h * dpr);
    if (!cache.current) cache.current = { canvas: document.createElement("canvas"), cam: camera, key: [] };
    const c = cache.current.canvas;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const t0 = performance.now();
    const ctx = c.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const st = useStore.getState();
    const cam = st.camera;
    const d = st.design;
    const surfaces = layerSurfaces.current;
    const live = new Set<string>();
    const byLayer = new Map<string, Stroke[]>();
    for (const sk of d.strokes) {
      const arr = byLayer.get(sk.layerId);
      arr ? arr.push(sk) : byLayer.set(sk.layerId, [sk]);
    }
    for (const v of VIEWS) {
      const m = viewMatrix(v, cam, dpr);
      const clipPath = st.clip ? garmentClip(geoms[v].body, geoms[v].hood) : undefined;
      for (const layer of d.layers) {
        if (layer.view !== v || !layer.visible) continue;
        const list = byLayer.get(layer.id) ?? [];
        if (!list.length) continue;
        live.add(layer.id);
        let e = surfaces.get(layer.id);
        if (!e) { e = { canvas: document.createElement("canvas"), drawn: [], cam: { x: NaN, y: NaN, s: NaN } }; surfaces.set(layer.id, e); }
        const sizeChanged = e.canvas.width !== W || e.canvas.height !== H;
        if (sizeChanged) { e.canvas.width = W; e.canvas.height = H; }
        const lctx = e.canvas.getContext("2d")!;
        const sameCam = e.cam.x === cam.x && e.cam.y === cam.y && e.cam.s === cam.s;
        const prefix = !sizeChanged && sameCam && e.drawn.length <= list.length && e.drawn.every((x, i) => list[i] === x);
        if (prefix) {
          if (list.length > e.drawn.length) drawLayerStrokes(lctx, list.slice(e.drawn.length), m, W, H);
        } else {
          lctx.setTransform(1, 0, 0, 1, 0, 0);
          lctx.clearRect(0, 0, W, H);
          drawLayerStrokes(lctx, list, m, W, H);
        }
        e.drawn = list;
        e.cam = cam;
        compositeLayer(ctx, e.canvas, layer, m, clipPath);
      }
    }
    for (const id of [...surfaces.keys()]) if (!live.has(id)) surfaces.delete(id);
    cache.current.cam = cam;
    cache.current.key = contentKey;
    if (vis.width !== W || vis.height !== H) { vis.width = W; vis.height = H; }
    const vctx = vis.getContext("2d")!;
    vctx.setTransform(1, 0, 0, 1, 0, 0);
    vctx.clearRect(0, 0, W, H);
    vctx.drawImage(c, 0, 0);
    renderStats.lastFullMs = performance.now() - t0;
    renderStats.fullRenders++;
    if (!renderStats.firstPaintAt) renderStats.firstPaintAt = performance.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoms, size, dpr]);

  // content changed -> full render now
  useEffect(() => {
    fullRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, contentKey);

  // camera changed -> transform the cached bitmap now, full render once the camera settles
  useEffect(() => {
    const vis = canvasRef.current, ch = cache.current;
    if (!vis || !ch) return;
    const r = camera.s / ch.cam.s;
    const ctx = vis.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, vis.width, vis.height);
    ctx.drawImage(ch.canvas, (camera.x - ch.cam.x * r) * dpr, (camera.y - ch.cam.y * r) * dpr, ch.canvas.width * r, ch.canvas.height * r);
    window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => {
      fullRender();
      setSvgCam(useStore.getState().camera);
    }, 110);
  }, [camera, dpr, fullRender]);

  // draft stroke on its own canvas
  useEffect(() => {
    const c = draftRef2.current;
    if (!c) return;
    const W = Math.round(size.w * dpr), H = Math.round(size.h * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!draft) return;
    const m = viewMatrix(draft.view, camera, dpr);
    ctx.save();
    if (clip) { ctx.setTransform(m); ctx.clip(garmentClip(geoms[draft.view].body, geoms[draft.view].hood)); }
    ctx.setTransform(m);
    const show = draft.style === "erase" ? { ...draft, style: "technical" as const, color: "#ff4d6d", size: draft.size * 1.6, opacity: 0.45 } : draft;
    drawStroke(ctx, show, m.a);
    if (symmetry) drawStroke(ctx, { ...show, points: show.points.map((p) => ({ ...p, x: -p.x })) }, m.a);
    ctx.restore();
  }, [draft, camera, size, dpr, clip, symmetry, geoms]);

  // ---- helpers ----
  const toWorld = (cx: number, cy: number) => {
    const r = wrap.current!.getBoundingClientRect();
    const cam = useStore.getState().camera;
    return { x: (cx - r.left - cam.x) / cam.s, y: (cy - r.top - cam.y) / cam.s };
  };
  const viewAt = (wx: number): View => (wx < ARTBOARD.w + ARTBOARD.gap / 2 ? "front" : "back");
  const toLocal = (wx: number, wy: number, view: View) => ({ x: wx - artboardX(view) - ARTBOARD.originX, y: wy - ARTBOARD.originY });

  // ---- wheel zoom ----
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      autoFit.current = false;
      const cam = useStore.getState().camera;
      const r = el.getBoundingClientRect();
      if (e.shiftKey && !e.ctrlKey) {
        set({ camera: { ...cam, x: cam.x - e.deltaY - e.deltaX } });
        return;
      }
      const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016));
      const s = Math.max(1.5, Math.min(140, cam.s * k));
      const px = e.clientX - r.left, py = e.clientY - r.top;
      set({ camera: { s, x: px - ((px - cam.x) / cam.s) * s, y: py - ((py - cam.y) / cam.s) * s } });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [set]);

  // ---- space-to-pan ----
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target as HTMLElement).closest("input,textarea")) {
        space.current = true;
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && (space.current = false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const moveCursor = (e: React.PointerEvent) => {
    const el = cursor.current;
    if (!el) return;
    const st = useStore.getState();
    if (st.tool !== "brush" && st.tool !== "eraser") return;
    const r = wrap.current!.getBoundingClientRect();
    const style = st.tool === "eraser" ? "erase" : st.brush.style;
    const d = Math.max(4, st.brush.size * (brushScale[style] ?? 1) * st.camera.s);
    el.style.left = `${e.clientX - r.left}px`;
    el.style.top = `${e.clientY - r.top}px`;
    el.style.width = el.style.height = `${d}px`;
    el.style.display = "block";
  };

  const armHold = () => {
    window.clearTimeout(holdTimer.current);
    const st = useStore.getState();
    if (st.tool !== "brush" || !st.brush.quickShape) return;
    holdTimer.current = window.setTimeout(() => {
      const cur = draftRef.current;
      if (!cur || !drag.current || drag.current.kind !== "draw") return;
      const shaped = quickShape(cur.points);
      if (!shaped) return;
      const next = { ...cur, points: shaped.points };
      draftRef.current = next;
      setDraft(next);
      useStore.getState().toast(`Snapped to ${shaped.kind}`, "info");
    }, 480);
  };

  // ---- pointer ----
  const onPointerDown = (e: React.PointerEvent) => {
    const st = useStore.getState();
    const target = e.target as Element;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);

    if (e.button === 1 || space.current || st.tool === "hand") {
      drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, cx: st.camera.x, cy: st.camera.y };
      autoFit.current = false;
      setPanning(true);
      return;
    }
    if (e.button !== 0) return;
    const w = toWorld(e.clientX, e.clientY);
    const view = viewAt(w.x);
    const local = toLocal(w.x, w.y, view);

    if (st.tool === "brush" || st.tool === "eraser") {
      const layer = st.layerFor(view);
      if (!layer) return;
      if (layer.locked) { st.toast(`“${layer.name}” is locked. Unlock it in Layers to draw.`, "warn"); return; }
      if (!layer.visible) { st.toast(`“${layer.name}” is hidden. Show it in Layers to draw.`, "warn"); return; }
      const s: Stroke = {
        id: uid(),
        view,
        layerId: layer.id,
        style: st.tool === "eraser" ? "erase" : st.brush.style,
        color: st.brush.color,
        size: st.brush.size,
        opacity: st.brush.opacity,
        points: [{ x: local.x, y: local.y, p: e.pointerType === "pen" ? e.pressure || 0.5 : 0.6 }],
        seed: Math.floor(Math.random() * 1e6),
      };
      draftRef.current = s;
      setDraft(s);
      drag.current = { kind: "draw", view, pid: e.pointerId };
      set({ activeView: view });
      armHold();
      return;
    }

    const handle = target.closest("[data-handle]")?.getAttribute("data-handle");
    if (handle && st.selected) {
      const g = st.design.graphics.find((x) => x.id === st.selected);
      if (g) {
        const lp = toLocal(w.x, w.y, g.view);
        st.checkpoint(handle === "rotate" ? "Rotate graphic" : "Resize graphic");
        if (handle === "rotate") drag.current = { kind: "rotate", id: g.id, view: g.view };
        else drag.current = { kind: "scale", id: g.id, view: g.view, w0: g.w, d0: Math.max(0.1, Math.hypot(lp.x - g.x, lp.y - g.y)) };
        return;
      }
    }
    const gid = target.closest("[data-gid]")?.getAttribute("data-gid");
    if (gid) {
      const g = st.design.graphics.find((x) => x.id === gid);
      if (g) {
        st.checkpoint("Move graphic");
        set({ selected: gid, activeView: g.view });
        const lp = toLocal(w.x, w.y, g.view);
        drag.current = { kind: "move", id: gid, view: g.view, ox: lp.x - g.x, oy: lp.y - g.y };
        return;
      }
    }
    set({ selected: null, activeView: view });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    moveCursor(e);
    const d = drag.current;
    if (!d) return;
    const st = useStore.getState();
    if (d.kind === "pan") {
      set({ camera: { ...st.camera, x: d.cx + e.clientX - d.sx, y: d.cy + e.clientY - d.sy } });
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    if (d.kind === "draw") {
      const cur = draftRef.current;
      if (!cur) return;
      const events = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [e.nativeEvent];
      const pts = cur.points.slice();
      const k = (st.brush.stabilizer / 100) * 0.88;
      let moved = false;
      for (const ev of events) {
        const ww = toWorld(ev.clientX, ev.clientY);
        const lp = toLocal(ww.x, ww.y, d.view);
        const prev = pts[pts.length - 1];
        const nx = prev.x + (lp.x - prev.x) * (1 - k);
        const ny = prev.y + (lp.y - prev.y) * (1 - k);
        if (Math.hypot(nx - prev.x, ny - prev.y) < 0.025) continue;
        const p = ev.pointerType === "pen" ? ev.pressure || 0.5 : Math.max(0.35, Math.min(1, 0.95 - Math.hypot(nx - prev.x, ny - prev.y) * 0.9));
        pts.push({ x: nx, y: ny, p });
        moved = true;
      }
      if (moved) {
        const next = { ...cur, points: pts };
        draftRef.current = next;
        setDraft(next);
        armHold();
      }
      return;
    }
    const g = st.design.graphics.find((x) => x.id === (d as { id: string }).id);
    if (!g) return;
    const lp = toLocal(w.x, w.y, d.view);
    if (d.kind === "move") {
      let x = lp.x - d.ox, y = lp.y - d.oy;
      let guideX: number | undefined;
      let zoneHit: string | undefined;
      if (!e.altKey) {
        const z = geoms[d.view].zones.find((z) => Math.abs(z.x - x) < 0.5 && Math.abs(z.y - z.h / 2 + graphicHeight(g) / 2 - y) < 0.5);
        if (z) {
          x = z.x;
          y = z.y - z.h / 2 + graphicHeight(g) / 2;
          zoneHit = z.id;
        } else if (Math.abs(x) < 0.35) {
          x = 0;
          guideX = 0;
        }
      }
      setGuides({ view: d.view, x: guideX, zone: zoneHit });
      st.updateGraphic(g.id, { x: +x.toFixed(3), y: +y.toFixed(3) }, false);
    } else if (d.kind === "scale") {
      const dist = Math.hypot(lp.x - g.x, lp.y - g.y);
      const w2 = Math.max(0.5, Math.min(24, (d.w0 * dist) / d.d0));
      st.updateGraphic(g.id, { w: +w2.toFixed(2) }, false);
    } else if (d.kind === "rotate") {
      let a = (Math.atan2(lp.y - g.y, lp.x - g.x) * 180) / Math.PI + 90;
      if (e.shiftKey) a = Math.round(a / 15) * 15;
      if (Math.abs(a) < 3) a = 0;
      st.updateGraphic(g.id, { rotation: +(((a + 540) % 360) - 180).toFixed(1) }, false);
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    window.clearTimeout(holdTimer.current);
    setPanning(false);
    setGuides(null);
    if (d?.kind === "draw") {
      const s = draftRef.current;
      draftRef.current = null;
      setDraft(null);
      if (!s || !s.points.length) return;
      const st = useStore.getState();
      const add: Stroke[] = [s];
      if (st.symmetry) add.push({ ...s, id: uid(), points: s.points.map((p: Pt) => ({ ...p, x: -p.x })) });
      st.commit((dd) => ({ ...dd, strokes: [...dd.strokes, ...add] }), s.style === "erase" ? "Erase" : "Brush stroke");
    }
  };

  // ---- drop ----
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    if (!e.dataTransfer.files.length) return;
    const w = toWorld(e.clientX, e.clientY);
    const view = viewAt(w.x);
    const lp = toLocal(w.x, w.y, view);
    const inside = Math.abs(lp.x) < 16 && lp.y > -2 && lp.y < 32;
    addImageFiles(e.dataTransfer.files, view, inside ? lp : undefined);
  };

  const graphicsLayer = useMemo(() => {
    const out: Record<View, React.ReactElement> = { front: <></>, back: <></> };
    for (const v of VIEWS) {
      out[v] = <>{design.graphics.filter((g) => g.view === v && g.visible).map((g) => <GraphicView key={g.id} g={g} preview={processed[g.id]?.preview} />)}</>;
    }
    return out;
  }, [design.graphics, processed]);

  const s = svgCam.s;
  const px = (n: number) => n / s;
  const r = camera.s / svgCam.s;
  const cssMove: React.CSSProperties = {
    transformOrigin: "0 0",
    transform: r === 1 && camera.x === svgCam.x && camera.y === svgCam.y ? undefined : `translate(${camera.x - svgCam.x * r}px, ${camera.y - svgCam.y * r}px) scale(${r})`,
  };
  const sel = design.graphics.find((g) => g.id === selected);
  const zonesVisible = (v: View) => showZones || (guides && guides.view === v) || (mode === "print" && sel?.view === v);
  const dimsVisible = showDims || mode === "measure";
  const world = `translate(${svgCam.x} ${svgCam.y}) scale(${s})`;

  return (
    <div
      ref={wrap}
      className={`stage tool-${space.current ? "hand" : tool}${panning ? " panning" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => cursor.current && (cursor.current.style.display = "none")}
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer.types).includes("Files")) return;
        e.preventDefault();
        if (!dropping) setDropping(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropping(false);
      }}
      onDrop={onDrop}
    >
      {/* garments + artwork (vector) */}
      <svg ref={svgRef} className="world" xmlns="http://www.w3.org/2000/svg" style={cssMove}>
        <SvgFilters />
        <g id="tf-world" transform={world}>
          {VIEWS.map((v) => (
            <g key={v} transform={`translate(${artboardX(v)} 0)`}>
              <rect className="no-export" x={0} y={0} width={ARTBOARD.w} height={ARTBOARD.h} rx={1.2} fill="var(--artboard)" stroke="var(--line-2)" strokeWidth={px(1)} />
              <text className="no-export" x={0.2} y={-px(10)} fontSize={px(11)} fill="var(--text-3)" fontWeight={650} letterSpacing={px(1.2)} fontFamily="Inter Variable, Inter, sans-serif">
                {v.toUpperCase()} · {design.previewSize}{ghosts ? ` vs ${compareSize}` : ""}
              </text>
              <g transform={`translate(${ARTBOARD.originX} ${ARTBOARD.originY})`}>
                <GarmentView uid={`g-${v}`} geom={geoms[v]} fabric={fabric} trimFabric={trimFabric} body={design.bodyColor} trim={design.trimColor} showStitches={showStitches}>
                  {clip ? graphicsLayer[v] : null}
                </GarmentView>
                {!clip && graphicsLayer[v]}
              </g>
            </g>
          ))}
        </g>
      </svg>

      {/* drawing layers (canvas engine) */}
      <canvas ref={canvasRef} className="layer-canvas" style={{ width: size.w, height: size.h }} />
      <canvas ref={draftRef2} className="layer-canvas" style={{ width: size.w, height: size.h }} />

      {/* overlays: zones, measurements, selection */}
      <svg className="world overlay" xmlns="http://www.w3.org/2000/svg" style={cssMove}>
        <g transform={world}>
          {VIEWS.map((v) => (
            <g key={v} transform={`translate(${artboardX(v) + ARTBOARD.originX} ${ARTBOARD.originY})`}>
              {ghosts && (
                <g pointerEvents="none">
                  <path d={ghosts[v].body} fill="none" stroke="var(--accent)" strokeWidth={px(1.5)} strokeDasharray={`${px(6)} ${px(4)}`} />
                  {ghosts[v].hood && <path d={ghosts[v].hood} fill="none" stroke="var(--accent)" strokeWidth={px(1.2)} strokeDasharray={`${px(6)} ${px(4)}`} />}
                </g>
              )}
              {symmetry && (tool === "brush" || tool === "eraser") && (
                <line x1={0} x2={0} y1={-14} y2={44} stroke="var(--accent)" strokeOpacity={0.5} strokeWidth={px(1)} strokeDasharray={`${px(5)} ${px(4)}`} />
              )}
              {zonesVisible(v) && <Zones geom={geoms[v]} px={px} hot={guides?.zone} />}
              {guides && guides.view === v && guides.x !== undefined && (
                <line x1={0} x2={0} y1={-14} y2={44} stroke="var(--accent)" strokeWidth={px(1)} />
              )}
              {dimsVisible && <Dims geom={geoms[v]} spec={spec} units={units} px={px} />}
              {sel && sel.view === v && tool === "select" && <Selection g={sel} px={px} />}
            </g>
          ))}
        </g>
      </svg>
      <div ref={cursor} className="brush-cursor" style={{ display: "none" }} />
      {dropping && <div className="dropzone">Drop artwork to place it on the garment</div>}
    </div>
  );
}

function GraphicView({ g, preview }: { g: Graphic; preview?: string }) {
  const h = graphicHeight(g);
  const src = g.method === "dtg" ? g.src : preview ?? g.src;
  const filter = g.method === "embroidery" ? "url(#tf-shadow)" : g.method === "screen" ? "url(#tf-print)" : undefined;
  return (
    <g transform={`translate(${g.x} ${g.y}) rotate(${g.rotation})`} data-gid={g.id} style={{ cursor: "move" }}>
      <image href={src} x={-g.w / 2} y={-h / 2} width={g.w} height={h} preserveAspectRatio="none" filter={filter}
        opacity={g.method === "dtg" ? 0.93 : g.method === "screen" ? 0.97 : 1} />
      <rect x={-g.w / 2} y={-h / 2} width={g.w} height={h} fill="transparent" />
    </g>
  );
}

function Selection({ g, px }: { g: Graphic; px: (n: number) => number }) {
  const h = graphicHeight(g);
  const hs = px(9);
  const corners: [number, number][] = [[-g.w / 2, -h / 2], [g.w / 2, -h / 2], [g.w / 2, h / 2], [-g.w / 2, h / 2]];
  return (
    <g transform={`translate(${g.x} ${g.y}) rotate(${g.rotation})`}>
      <rect x={-g.w / 2} y={-h / 2} width={g.w} height={h} fill="none" stroke="var(--accent)" strokeWidth={px(1.5)} />
      <line x1={0} x2={0} y1={-h / 2} y2={-h / 2 - px(22)} stroke="var(--accent)" strokeWidth={px(1.5)} />
      <circle data-handle="rotate" cx={0} cy={-h / 2 - px(26)} r={px(6)} fill="#fff" stroke="var(--accent)" strokeWidth={px(1.5)} style={{ cursor: "grab", pointerEvents: "all" }} />
      {corners.map(([x, y], i) => (
        <rect key={i} data-handle="scale" x={x - hs / 2} y={y - hs / 2} width={hs} height={hs} rx={px(2)} fill="#fff" stroke="var(--accent)" strokeWidth={px(1.5)}
          style={{ cursor: i % 2 ? "nesw-resize" : "nwse-resize", pointerEvents: "all" }} />
      ))}
      <text x={0} y={h / 2 + px(18)} textAnchor="middle" fontSize={px(11)} fill="var(--accent)" fontFamily="JetBrains Mono Variable, monospace" fontWeight={600}>
        {g.w.toFixed(2)} × {h.toFixed(2)} in
      </text>
    </g>
  );
}

function Zones({ geom, px, hot }: { geom: GarmentGeom; px: (n: number) => number; hot?: string }) {
  return (
    <g>
      {geom.zones.map((z) => (
        <g key={z.id}>
          <rect x={z.x - z.w / 2} y={z.y - z.h / 2} width={z.w} height={z.h} rx={px(3)}
            fill={hot === z.id ? "var(--accent-soft)" : "rgba(124,92,255,0.04)"} stroke="var(--accent)" strokeOpacity={hot === z.id ? 1 : 0.55}
            strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} />
          <text x={z.x - z.w / 2 + px(4)} y={z.id.startsWith("full") ? z.y + z.h / 2 - px(5) : z.y - z.h / 2 + px(12)} fontSize={px(10)} fill="var(--accent)" fontFamily="Inter Variable, sans-serif" fontWeight={600}>
            {z.name} · {z.w}×{+z.h.toFixed(1)}
          </text>
        </g>
      ))}
    </g>
  );
}

function Dims({ geom, spec, units, px }: { geom: GarmentGeom; spec: Record<string, number>; units: "in" | "cm"; px: (n: number) => number }) {
  return (
    <g>
      {geom.dims.map((d) => {
        if (spec[d.code] === undefined) return null;
        const ang = Math.atan2(d.b[1] - d.a[1], d.b[0] - d.a[0]);
        const nx = -Math.sin(ang) * px(5), ny = Math.cos(ang) * px(5);
        const rot = ((d.angle % 360) + 360) % 360;
        const upright = rot > 90 && rot < 270 ? d.angle + 180 : d.angle;
        return (
          <g key={d.code}>
            <path d={`M ${d.a[0]} ${d.a[1]} L ${d.b[0]} ${d.b[1]} M ${d.a[0] - nx} ${d.a[1] - ny} L ${d.a[0] + nx} ${d.a[1] + ny} M ${d.b[0] - nx} ${d.b[1] - ny} L ${d.b[0] + nx} ${d.b[1] + ny}`}
              stroke="var(--accent)" strokeWidth={px(1.25)} fill="none" />
            <g transform={`translate(${d.label[0]} ${d.label[1]}) rotate(${upright})`}>
              <rect x={-px(34)} y={-px(9)} width={px(68)} height={px(16)} rx={px(4)} fill="var(--panel-solid)" stroke="var(--accent-line)" strokeWidth={px(1)} />
              <text x={0} y={px(3.5)} textAnchor="middle" fontSize={px(10.5)} fontFamily="JetBrains Mono Variable, monospace" fill="var(--text)" fontWeight={600}>
                {d.code} {fmt(spec[d.code], units, true)}
              </text>
            </g>
          </g>
        );
      })}
    </g>
  );
}
