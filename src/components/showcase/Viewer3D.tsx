import { useEffect, useRef, useState } from "react";
import { useStore } from "../../state/store";
import { previewsOf, useShow } from "../../state/showcase";
import type { Design, ProcessedGraphic } from "../../types";
import { renderGarment } from "../../lib/render";
import { geomFor } from "../../lib/graphics";
import { createViewer, pickVideoType, type GarmentTextures, type Viewer } from "../../lib/viewer3d";
import { download, slug } from "../../lib/exporting";
import { Seg, Toggle } from "../Controls";
import { IcDownload } from "../Icons";
import { Busy, useDesignSig } from "./common";
import { SOCIAL_BGS } from "./Social";

const TEX_PX = 32;

/** Front and back renders on one symmetric window, ready to wrap the 3D shell. */
export async function garmentTextures(d: Design, processed: Record<string, ProcessedGraphic>): Promise<GarmentTextures> {
  const f = geomFor(d, "front").bounds, b = geomFor(d, "back").bounds;
  const X = Math.max(Math.abs(f.x0), Math.abs(f.x1), Math.abs(b.x0), Math.abs(b.x1)) + 1;
  const box = { x0: -X, x1: X, y0: Math.min(f.y0, b.y0) - 1, y1: Math.max(f.y1, b.y1) + 1 };
  const o = { box, pxPerInch: TEX_PX, background: null, shadow: false, shading: 0.35, outline: false, previews: previewsOf(d, processed) };
  const front = (await renderGarment(d, { ...o, view: "front" })).canvas;
  const back = (await renderGarment(d, { ...o, view: "back" })).canvas;
  return { front, back, box, pxPerInch: TEX_PX };
}

let active: Viewer | null = null;
/** The live viewer, if the 3D tab is open (used by the AI tab and tests). */
export const activeViewer = () => active;

export const REC_FORMATS = [
  { id: "square", name: "Square 1080", w: 1080, h: 1080 },
  { id: "vertical", name: "Vertical 1080×1920", w: 1080, h: 1920 },
  { id: "wide", name: "Wide 1920×1080", w: 1920, h: 1080 },
];

export function Viewer3DView() {
  const host = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [building, setBuilding] = useState(true);
  const [stats, setStats] = useState({ triangles: 0, fps: 0 });
  const sig = useDesignSig();
  const sh = useShow();

  useEffect(() => {
    let v: Viewer | null = null;
    let alive = true;
    createViewer(host.current!)
      .then((x) => { if (!alive) return x.dispose(); v = x; active = x; setViewer(x); })
      .catch((e: Error) => setFailed(e.message || "WebGL isn't available on this computer"));
    return () => { alive = false; v?.dispose(); if (active === v) active = null; };
  }, []);

  useEffect(() => {
    if (!viewer) return;
    let alive = true;
    setBuilding(true);
    const t = setTimeout(async () => {
      const st = useStore.getState();
      const tex = await garmentTextures(st.design, st.processed);
      if (!alive) return;
      viewer.setGarment(tex);
      setBuilding(false);
    }, 80);
    return () => { alive = false; clearTimeout(t); };
  }, [viewer, sig]);

  useEffect(() => { viewer?.setSpin(sh.spin && sh.recording === null, sh.spinSpeed); }, [viewer, sh.spin, sh.spinSpeed, sh.recording]);
  useEffect(() => { viewer?.setLight(sh.light); }, [viewer, sh.light]);
  useEffect(() => { viewer?.setBackdrop(sh.backdrop); }, [viewer, sh.backdrop]);
  useEffect(() => {
    if (!viewer) return;
    const i = setInterval(() => setStats(viewer.stats()), 1000);
    return () => clearInterval(i);
  }, [viewer]);

  return (
    <div className="sc-body">
      <div className="sc-toolbar">
        <div className="seg">
          {(["front", "three-quarter", "left", "back"] as const).map((s) => (
            <button key={s} onClick={() => { useShow.getState().set({ spin: false }); viewer?.look(s); }}>{s === "three-quarter" ? "¾" : s[0].toUpperCase() + s.slice(1)}</button>
          ))}
        </div>
        <Seg value={sh.light} options={[{ v: "studio", l: "Studio" }, { v: "warm", l: "Golden" }, { v: "night", l: "Neon night" }]} onChange={(v) => sh.set({ light: v })} />
        <div className="spacer" />
        <span className="mono faint small" data-testid="v3d-stats">{stats.triangles.toLocaleString()} tris · {stats.fps} fps</span>
        <button className="btn sm" disabled={!viewer || building} onClick={() => snapshot(viewer!)}>Snapshot PNG</button>
        <button className="btn sm primary" disabled={!viewer || building || sh.recording !== null} onClick={() => recordTurntable(viewer!)}>
          <IcDownload size={13} /> {sh.recording !== null ? `Recording ${Math.round(sh.recording * 100)}%` : "Record turntable"}
        </button>
      </div>
      <div className="v3d" ref={host} data-testid="v3d">
        {failed && <div className="notice warn" style={{ margin: 24 }}>3D needs WebGL: {failed}</div>}
        {sh.recording !== null && <div className="v3d-rec"><span className="dot" /> REC {Math.round(sh.recording * 100)}%</div>}
        <Busy on={!failed && (!viewer || building)} />
        <div className="v3d-hint faint small">Drag to orbit · scroll to zoom · right-drag to pan</div>
      </div>
    </div>
  );
}

export function Viewer3DPanel() {
  const sh = useShow();
  const type = pickVideoType();
  return (
    <>
      <div className="section">
        <div className="section-head"><span className="section-title">3D viewer</span></div>
        <span className="faint small">Your flat front and back, inflated into a lit 3D garment. It updates as you edit: artwork, drawing, fabric and colors carry over.</span>
        <Toggle on={sh.spin} onChange={(v) => sh.set({ spin: v })} label="Auto-spin" />
        <div className="field"><span className="label">Spin speed</span>
          <Seg full value={String(sh.spinSpeed)} options={[{ v: "0.5", l: "Slow" }, { v: "1", l: "Normal" }, { v: "2", l: "Fast" }]} onChange={(v) => sh.set({ spinSpeed: +v })} /></div>
      </div>
      <div className="section">
        <span className="section-title">Backdrop</span>
        <div className="swatches" style={{ gridTemplateColumns: "repeat(10, 1fr)" }}>
          {[["Studio", "#E9E7E2"] as [string, string], ...SOCIAL_BGS.filter(([, c]) => c !== "#EDE9E1")].map(([n, c]) => (
            <button key={c} title={n} className={`swatch${sh.backdrop === c ? " on" : ""}`} style={{ background: c }} onClick={() => sh.set({ backdrop: c })} />
          ))}
        </div>
      </div>
      <div className="section">
        <span className="section-title">Turntable video</span>
        <div className="field"><span className="label">Format</span>
          <Seg full value={sh.recFormat} options={REC_FORMATS.map((f) => ({ v: f.id, l: f.name.split(" ")[0] }))} onChange={(v) => sh.set({ recFormat: v })} /></div>
        <div className="field"><span className="label">Length of one turn</span>
          <Seg full value={String(sh.recSeconds)} options={[{ v: "4", l: "4 s" }, { v: "6", l: "6 s" }, { v: "10", l: "10 s" }]} onChange={(v) => sh.set({ recSeconds: +v })} /></div>
        <span className="faint small">{type ? `Saves ${type.ext.toUpperCase()} at ${REC_FORMATS.find((f) => f.id === sh.recFormat)!.name.split(" ").pop()}, 30 fps, one seamless loop.` : "Video recording isn't available in this browser."}</span>
      </div>
    </>
  );
}

async function snapshot(v: Viewer) {
  const st = useStore.getState();
  try {
    const where = await download(await v.snapshot(2048), `${slug(st.design.name)}-3d.png`);
    if (where) st.toast("3D snapshot exported (2048 × 2048)", "good");
  } catch (e) {
    st.toast(`Snapshot failed: ${(e as Error).message}`, "warn");
  }
}

export async function recordTurntable(v: Viewer) {
  const st = useStore.getState();
  const sh = useShow.getState();
  const f = REC_FORMATS.find((x) => x.id === sh.recFormat) ?? REC_FORMATS[0];
  sh.set({ recording: 0 });
  try {
    let lastP = 0;
    const { blob, ext } = await v.record({ w: f.w, h: f.h, seconds: sh.recSeconds }, (p) => {
      if (p - lastP > 0.02 || p === 1) { lastP = p; useShow.getState().set({ recording: p }); }
    });
    useShow.getState().set({ recording: null });
    const where = await download(blob, `${slug(st.design.name)}-turntable-${f.w}x${f.h}.${ext}`);
    if (where) st.toast(`Turntable saved (${ext.toUpperCase()}, ${(blob.size / 1e6).toFixed(1)} MB)`, "good");
  } catch (e) {
    useShow.getState().set({ recording: null });
    st.toast(`Recording failed: ${(e as Error).message}`, "warn");
  }
}
