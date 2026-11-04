import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { uid, useStore } from "../../state/store";
import { previewsOf, useShow } from "../../state/showcase";
import type { Design, PhotoMockup, ProcessedGraphic, View } from "../../types";
import { renderArtwork, renderGarment } from "../../lib/render";
import { composite, convex, type Quad } from "../../lib/warp";
import { geomFor } from "../../lib/graphics";
import { loadImage } from "../../lib/imaging";
import { openFile } from "../../lib/native";
import { download, slug } from "../../lib/exporting";
import { Seg, Slider } from "../Controls";
import { IcDownload, IcImage, IcTrash } from "../Icons";
import { Busy, canvasToBlob, fitBox, useAsync, useDesignSig, useSize } from "./common";

const PREVIEW_MAX = 1400;
const imgCache = new Map<string, Promise<HTMLImageElement>>();
const photoImage = (p: PhotoMockup) => {
  let v = imgCache.get(p.id);
  if (!v) { v = loadImage(p.photo); imgCache.set(p.id, v); }
  return v;
};

const zoneBox = (d: Design, view: View, zoneId: string) => {
  const zones = geomFor(d, view).zones;
  const z = zones.find((x) => x.id === zoneId) ?? zones[0];
  return { z, box: { x0: z.x - z.w / 2, y0: z.y - z.h / 2, x1: z.x + z.w / 2, y1: z.y + z.h / 2 } };
};

/** Photo with the design's artwork warped onto it, at most `maxSide` px on the long side. */
export async function compositePhoto(d: Design, processed: Record<string, ProcessedGraphic>, p: PhotoMockup, maxSide = Infinity): Promise<HTMLCanvasElement> {
  const img = await photoImage(p);
  const sc = Math.min(1, maxSide / Math.max(p.w, p.h));
  const c = document.createElement("canvas");
  c.width = Math.round(p.w * sc);
  c.height = Math.round(p.h * sc);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const { z, box } = zoneBox(d, p.view, p.zone);
  const q = p.quad;
  const quadW = Math.max(Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]), Math.hypot(q[2][0] - q[3][0], q[2][1] - q[3][1])) * sc;
  const k = Math.max(16, Math.min(160, (quadW * 1.4) / z.w));
  const art = await renderArtwork(d, p.view, box, k, previewsOf(d, processed));
  const photo = ctx.getImageData(0, 0, c.width, c.height);
  composite(photo, art.getContext("2d")!.getImageData(0, 0, art.width, art.height), q, { shading: p.shading, opacity: p.opacity }, sc);
  ctx.putImageData(photo, 0, 0);
  return c;
}

const defaultQuad = (w: number, h: number, aspect: number): Quad => {
  const qw = w * 0.32, qh = Math.min(h * 0.4, qw * aspect);
  const cx = w / 2, cy = h * 0.42;
  return [[cx - qw / 2, cy - qh / 2], [cx + qw / 2, cy - qh / 2], [cx + qw / 2, cy + qh / 2], [cx - qw / 2, cy + qh / 2]];
};

async function shrink(src: string, max = 2400): Promise<{ src: string; w: number; h: number }> {
  const img = await loadImage(src);
  const sc = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * sc);
  c.height = Math.round(img.naturalHeight * sc);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return { src: c.toDataURL("image/jpeg", 0.9), w: c.width, h: c.height };
}

function addPhoto(p: Omit<PhotoMockup, "id">) {
  const st = useStore.getState();
  const id = uid();
  st.commit((d) => ({ ...d, showcase: { ...d.showcase!, photos: [...d.showcase!.photos, { ...p, id }] } }), "Add photo mockup");
  useShow.getState().set({ photoId: id });
}

export async function addPhotoFromFile() {
  const f = await openFile([{ name: "Photo", extensions: ["jpg", "jpeg", "png", "webp"] }], "image/*");
  if (!f) return;
  const ext = f.name.toLowerCase().split(".").pop();
  const type = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  const url = URL.createObjectURL(new Blob([f.bytes as BlobPart], { type }));
  try {
    const img = await shrink(url);
    const d = useStore.getState().design;
    const view: View = "front";
    const { z } = zoneBox(d, view, "full-front");
    addPhoto({ name: f.name.replace(/\.[^.]+$/, ""), photo: img.src, w: img.w, h: img.h, quad: defaultQuad(img.w, img.h, z.h / z.w), view, zone: z.id, shading: 0.8, opacity: 1 });
  } catch {
    useStore.getState().toast("Couldn't read that photo.", "warn");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A studio-style photo of the blank garment (no artwork), with the print area pre-marked. */
export async function addSamplePhoto() {
  const d0 = useStore.getState().design;
  const blank: Design = { ...d0, graphics: [], strokes: [], bodyColor: "#DAD7D0", trimColor: "#DAD7D0" };
  const k = 34;
  const r = await renderGarment(blank, { view: "front", pxPerInch: k, background: null, margin: 2.5 });
  const W = Math.round(r.canvas.width * 1.15), H = Math.round(r.canvas.height * 1.2);
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#BEB8AE"); g.addColorStop(1, "#8E887F");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const ox = (W - r.canvas.width) / 2, oy = (H - r.canvas.height) * 0.4;
  ctx.drawImage(r.canvas, ox, oy);
  // a little sensor noise so it reads as a photo
  const id = ctx.getImageData(0, 0, W, H);
  for (let i = 0; i < id.data.length; i += 4) { const n = (Math.random() - 0.5) * 9; id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n; }
  ctx.putImageData(id, 0, 0);
  const { z, box } = zoneBox(d0, "front", "full-front");
  const P = (x: number, y: number): [number, number] => { const [px, py] = r.toPx(x, y); return [px + ox, py + oy]; };
  addPhoto({
    name: "Studio sample", photo: c.toDataURL("image/jpeg", 0.9), w: W, h: H, view: "front", zone: z.id, shading: 0.8, opacity: 1,
    quad: [P(box.x0, box.y0), P(box.x1, box.y0), P(box.x1, box.y1), P(box.x0, box.y1)],
  });
}

const useActivePhoto = () => {
  const photos = useStore((s) => s.design.showcase?.photos ?? []);
  const id = useShow((s) => s.photoId);
  return photos.find((p) => p.id === id) ?? photos[0] ?? null;
};

const updPhoto = (id: string, p: Partial<PhotoMockup>) =>
  useStore.getState().live((d) => ({ ...d, showcase: { ...d.showcase!, photos: d.showcase!.photos.map((x) => (x.id === id ? { ...x, ...p } : x)) } }));

export function PhotoView() {
  const p = useActivePhoto();
  usePhotoCleanup();
  if (!p)
    return (
      <div className="sc-body">
        <div className="sc-empty">
          <IcImage size={30} />
          <h3>Put your design on a real photo</h3>
          <p className="muted">Shoot a blank garment flat or on a model, add the photo, then drag four corners onto the print area. The artwork follows the fabric's light and folds.</p>
          <div className="row">
            <button className="btn primary" onClick={addPhotoFromFile}>Add garment photo</button>
            <button className="btn" onClick={addSamplePhoto} data-testid="sample-photo">Use a sample photo</button>
          </div>
        </div>
      </div>
    );
  return <PhotoEditor p={p} />;
}

function PhotoEditor({ p }: { p: PhotoMockup }) {
  const sig = useDesignSig();
  const [guides, setGuides] = useState(true);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const key = `${sig}|${p.id}|${p.quad.flat().map((v) => v.toFixed(1)).join(",")}|${p.view}|${p.zone}|${p.shading}|${p.opacity}`;
  const out = useAsync(key, async () => {
    const st = useStore.getState();
    const c = await compositePhoto(st.design, st.processed, p, PREVIEW_MAX);
    return c.toDataURL("image/jpeg", 0.9);
  }, 30);
  const toPhoto = (e: RPointerEvent) => {
    const m = svg.current!.getScreenCTM()!.inverse();
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return [Math.max(0, Math.min(p.w, pt.x)), Math.max(0, Math.min(p.h, pt.y))] as [number, number];
  };
  const r = Math.max(p.w, p.h) / 90;
  const [area, size] = useSize<HTMLDivElement>();
  const fit = fitBox(p.w, p.h, Math.max(1, size.w - 44), Math.max(1, size.h - 44));
  return (
    <div className="sc-body">
      <div className="sc-toolbar">
        <span className="muted small">Drag the four corners onto the print area. Shift+drag a corner to move the whole area.</span>
        <div className="spacer" />
        <button className={`btn sm${guides ? "" : " primary"}`} onClick={() => setGuides(!guides)}>{guides ? "Hide guides" : "Show guides"}</button>
        <button className="btn sm primary" onClick={() => exportPhoto(p)}><IcDownload size={13} /> Export PNG</button>
      </div>
      <div className="sc-preview" ref={area}>
        <div className="photo-stage" style={{ width: fit.w, height: fit.h }}>
          {out.value && <img src={out.value} alt={p.name} draggable={false} data-testid="photo-result" />}
          <svg ref={svg} viewBox={`0 0 ${p.w} ${p.h}`} className="photo-guides" style={{ opacity: guides ? 1 : 0 }}
            onPointerMove={(e) => {
              const i = drag.current;
              if (i === null) return;
              const pt = toPhoto(e);
              let q = p.quad.map((v) => [...v]) as Quad;
              if (e.shiftKey) {
                const dx = pt[0] - q[i][0], dy = pt[1] - q[i][1];
                q = q.map(([x, y]) => [x + dx, y + dy]) as Quad;
              } else q[i] = pt;
              if (convex(q)) updPhoto(p.id, { quad: q });
            }}
            onPointerUp={() => { drag.current = null; }}>
            <polygon points={p.quad.map((v) => v.join(",")).join(" ")} fill="none" stroke="var(--accent)" strokeWidth={r / 4} strokeDasharray={`${r} ${r / 1.5}`} vectorEffect="non-scaling-stroke" />
            {p.quad.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={r} className="photo-handle" data-corner={i}
                onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture(e.pointerId); useStore.getState().checkpoint("Move print corners"); drag.current = i; }} />
            ))}
          </svg>
        </div>
        <Busy on={out.busy && !out.value} />
      </div>
    </div>
  );
}

export function PhotoPanel() {
  const d = useStore((s) => s.design);
  const commit = useStore((s) => s.commit);
  const checkpoint = useStore((s) => s.checkpoint);
  const p = useActivePhoto();
  const set = useShow((s) => s.set);
  const photos = d.showcase?.photos ?? [];
  return (
    <>
      <div className="section">
        <div className="section-head"><span className="section-title">Photo mockups</span>
          <div className="row" style={{ gap: 4 }}>
            <button className="btn sm" onClick={addPhotoFromFile}>Add photo</button>
            <button className="btn sm ghost" onClick={addSamplePhoto}>Sample</button>
          </div>
        </div>
        <div className="photo-list">
          {photos.map((x) => (
            <button key={x.id} className={`photo-thumb${p?.id === x.id ? " on" : ""}`} onClick={() => set({ photoId: x.id })} title={x.name}>
              <img src={x.photo} alt={x.name} />
            </button>
          ))}
          {!photos.length && <span className="faint small">No photos yet.</span>}
        </div>
      </div>
      {p && (
        <div className="section">
          <input className="input" value={p.name} onFocus={() => checkpoint("Rename photo")} onChange={(e) => updPhoto(p.id, { name: e.target.value })} />
          <div className="field"><span className="label">Artwork from</span>
            <Seg full value={p.view} options={[{ v: "front", l: "Front" }, { v: "back", l: "Back" }]}
              onChange={(v) => { checkpoint("Photo side"); updPhoto(p.id, { view: v, zone: v === "front" ? "full-front" : "full-back" }); }} /></div>
          <label className="field"><span className="label">Corners mark this print area</span>
            <select className="input" value={p.zone} onChange={(e) => { checkpoint("Photo print area"); updPhoto(p.id, { zone: e.target.value }); }}>
              {geomFor(d, p.view).zones.map((z) => <option key={z.id} value={z.id}>{z.name} ({z.w.toFixed(1)} × {z.h.toFixed(1)} in)</option>)}
            </select></label>
          <div className="field"><span className="label">Fabric shading through the print</span>
            <Slider value={p.shading} min={0} max={1.5} step={0.05} onCommit={() => checkpoint("Photo shading")} onChange={(v) => updPhoto(p.id, { shading: v })} display={`${Math.round(p.shading * 100)}%`} /></div>
          <div className="field"><span className="label">Print opacity</span>
            <Slider value={p.opacity} min={0.2} max={1} step={0.01} onCommit={() => checkpoint("Photo opacity")} onChange={(v) => updPhoto(p.id, { opacity: v })} display={`${Math.round(p.opacity * 100)}%`} /></div>
          <div className="row">
            <button className="btn sm" onClick={() => { const { z } = zoneBox(d, p.view, p.zone); checkpoint("Reset corners"); updPhoto(p.id, { quad: defaultQuad(p.w, p.h, z.h / z.w) }); }}>Reset corners</button>
            <div className="spacer" />
            <button className="btn sm ghost danger" onClick={() => { commit((x) => ({ ...x, showcase: { ...x.showcase!, photos: x.showcase!.photos.filter((k) => k.id !== p.id) } }), "Delete photo"); set({ photoId: null }); }}><IcTrash size={13} /> Delete</button>
          </div>
          <span className="faint small">{p.w} × {p.h} px photo. Export renders at full size.</span>
        </div>
      )}
    </>
  );
}

export async function exportPhoto(p: PhotoMockup) {
  const st = useStore.getState();
  try {
    const c = await compositePhoto(st.design, st.processed, p);
    const where = await download(await canvasToBlob(c), `${slug(st.design.name)}-${slug(p.name)}.png`);
    if (where) st.toast(`Photo mockup exported (${c.width} × ${c.height})`, "good");
  } catch (e) {
    st.toast(`Export failed: ${(e as Error).message}`, "warn");
  }
}

export function usePhotoCleanup() {
  const photos = useStore((s) => s.design.showcase?.photos);
  useEffect(() => {
    const ids = new Set(photos?.map((p) => p.id));
    for (const k of imgCache.keys()) if (!ids.has(k)) imgCache.delete(k);
  }, [photos]);
}
