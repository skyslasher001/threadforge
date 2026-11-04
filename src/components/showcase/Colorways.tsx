import { uid, useStore } from "../../state/store";
import { previewsOf, renderSig, useShow } from "../../state/showcase";
import type { Colorway, Design, ProcessedGraphic } from "../../types";
import { renderGarment, renderPair } from "../../lib/render";
import { suggestColorways } from "../../lib/color";
import { download, slug } from "../../lib/exporting";
import { ColorChip, Seg } from "../Controls";
import { IcDownload, IcX } from "../Icons";
import { Busy, canvasToBlob, useAsync } from "./common";
import { paletteToColorways } from "./BrandKit";

const cache = new Map<string, string>();

async function colorwayThumb(d: Design, processed: Record<string, ProcessedGraphic>, cw: Colorway, back: boolean, k = 14): Promise<string> {
  const key = `${renderSig(d, processed)}|${cw.body}|${cw.trim}|${back}|${k}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const o = { body: cw.body, trim: cw.trim, pxPerInch: k * (window.devicePixelRatio > 1 ? 2 : 1), background: null, previews: previewsOf(d, processed) };
  const c = back ? await renderPair(d, o, 1) : (await renderGarment(d, { ...o, view: "front" })).canvas;
  const url = c.toDataURL("image/png");
  if (cache.size > 120) cache.clear();
  cache.set(key, url);
  return url;
}

export function ColorwayMatrix() {
  const d = useStore((s) => s.design);
  const processed = useStore((s) => s.processed);
  const commit = useStore((s) => s.commit);
  const back = useShow((s) => s.matrixBack);
  const setShow = useShow((s) => s.set);
  const sig = renderSig(d, processed);
  const key = `${sig}|${back}|${d.colorways.map((c) => c.body + c.trim).join(",")}`;
  const thumbs = useAsync(key, async () => {
    const out: Record<string, string> = {};
    for (const cw of d.colorways) out[cw.id] = await colorwayThumb(d, processed, cw, back);
    return out;
  });
  const isOn = (c: Colorway) => c.body === d.bodyColor && c.trim === d.trimColor;
  const suggest = () => {
    const ideas = suggestColorways(d.bodyColor, d.trimColor).filter((s) => !d.colorways.some((c) => c.body === s.body && c.trim === s.trim));
    commit((x) => ({ ...x, colorways: [...x.colorways, ...ideas.map((s) => ({ id: uid(), ...s }))] }), "Suggest colorways");
    useStore.getState().toast(`${ideas.length} colorway ideas added`, "good");
  };
  const addCurrent = () => commit((x) => ({ ...x, colorways: [...x.colorways, { id: uid(), name: `Colorway ${x.colorways.length + 1}`, body: x.bodyColor, trim: x.trimColor }] }), "Save colorway");
  return (
    <div className="sc-body">
      <div className="sc-toolbar">
        <Seg value={back ? "pair" : "front"} options={[{ v: "front", l: "Front" }, { v: "pair", l: "Front + back" }]} onChange={(v) => setShow({ matrixBack: v === "pair" })} />
        <div className="spacer" />
        <button className="btn sm" onClick={addCurrent}>Save current colors</button>
        <button className="btn sm" onClick={suggest} data-testid="suggest-colorways">Suggest 4 colorways</button>
        <button className="btn sm" onClick={paletteToColorways} title="One colorway per Brand Kit color">From Brand Kit</button>
        <button className="btn sm primary" onClick={() => exportMatrix(useStore.getState().design, useStore.getState().processed, back)}><IcDownload size={13} /> Matrix PNG</button>
      </div>
      <div className={`cw-matrix${back ? " pair" : ""}`} data-testid="cw-matrix">
        {d.colorways.map((c) => (
          <div key={c.id} className={`cw-card${isOn(c) ? " on" : ""}`} onClick={() => commit((x) => ({ ...x, bodyColor: c.body, trimColor: c.trim }), `Colorway: ${c.name}`)} title="Click to make this the working colorway">
            <div className="cw-art">{thumbs.value?.[c.id] ? <img src={thumbs.value[c.id]} alt={c.name} draggable={false} /> : <span className="spinner" />}</div>
            <div className="cw-foot">
              <span className="pair"><span style={{ background: c.body }} /><span style={{ background: c.trim }} /></span>
              <span className="cw-name">{c.name}</span>
              <span className="mono faint small">{c.body}{c.trim !== c.body ? ` / ${c.trim}` : ""}</span>
            </div>
          </div>
        ))}
        {!d.colorways.length && <div className="faint" style={{ padding: 40 }}>No colorways yet. Save the current colors or ask for suggestions.</div>}
      </div>
      <Busy on={thumbs.busy && !thumbs.value} />
    </div>
  );
}

export function ColorwayPanel() {
  const d = useStore((s) => s.design);
  const commit = useStore((s) => s.commit);
  const live = useStore((s) => s.live);
  const checkpoint = useStore((s) => s.checkpoint);
  const upd = (id: string, p: Partial<Colorway>) => live((x) => ({ ...x, colorways: x.colorways.map((k) => (k.id === id ? { ...k, ...p } : k)) }));
  return (
    <>
      <div className="section">
        <div className="section-head"><span className="section-title">Colorway matrix</span><span className="faint small">{d.colorways.length}</span></div>
        <span className="faint small">Every colorway rendered with the real fabric, artwork and drawing. Click a card to make it the working colors. Edit body and trim here.</span>
      </div>
      <div className="section">
        {d.colorways.map((c) => (
          <div key={c.id} className="row" style={{ gap: 6 }}>
            <ColorChip value={c.body} title="Body" onOpen={() => checkpoint("Edit colorway")} onChange={(v) => upd(c.id, { body: v })} />
            <ColorChip value={c.trim} title="Trim" onOpen={() => checkpoint("Edit colorway")} onChange={(v) => upd(c.id, { trim: v })} />
            <input className="input" style={{ flex: 1, minWidth: 0 }} value={c.name} onFocus={() => checkpoint("Rename colorway")} onChange={(e) => upd(c.id, { name: e.target.value })} />
            <button className="btn icon sm ghost danger" title="Delete colorway" onClick={() => commit((x) => ({ ...x, colorways: x.colorways.filter((k) => k.id !== c.id) }), "Delete colorway")}><IcX size={12} /></button>
          </div>
        ))}
      </div>
    </>
  );
}

/** Print-ready sheet with every colorway, labelled. */
export async function matrixCanvas(d: Design, processed: Record<string, ProcessedGraphic>, back: boolean): Promise<HTMLCanvasElement | null> {
  const cells = [];
  for (const cw of d.colorways) {
    const o = { body: cw.body, trim: cw.trim, pxPerInch: 22, background: null, previews: previewsOf(d, processed) };
    cells.push({ cw, c: back ? await renderPair(d, o, 1) : (await renderGarment(d, { ...o, view: "front" })).canvas });
  }
  if (!cells.length) return null;
  const cols = Math.min(back ? 2 : 4, cells.length);
  const rows = Math.ceil(cells.length / cols);
  const cw = Math.max(...cells.map((x) => x.c.width)), ch = Math.max(...cells.map((x) => x.c.height));
  const pad = 60, label = 90, head = 170;
  const c = document.createElement("canvas");
  c.width = cols * (cw + pad) + pad;
  c.height = head + rows * (ch + label + pad) + pad / 2;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#F1F1F3";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#141418";
  ctx.font = `700 54px "Inter Variable", Inter, "Segoe UI", sans-serif`;
  ctx.fillText(d.name, pad, 92);
  ctx.fillStyle = "#6a6a74";
  ctx.font = `500 26px "Inter Variable", Inter, "Segoe UI", sans-serif`;
  ctx.fillText(`${d.colorways.length} colorways · ${d.previewSize} sample`, pad, 134);
  cells.forEach(({ cw: k, c: img }, i) => {
    const x = pad + (i % cols) * (cw + pad), y = head + Math.floor(i / cols) * (ch + label + pad);
    ctx.drawImage(img, x + (cw - img.width) / 2, y + (ch - img.height) / 2);
    ctx.fillStyle = k.body; ctx.fillRect(x + 4, y + ch + 22, 34, 34);
    ctx.fillStyle = k.trim; ctx.fillRect(x + 42, y + ch + 22, 34, 34);
    ctx.strokeStyle = "rgba(0,0,0,0.15)"; ctx.strokeRect(x + 4, y + ch + 22, 72, 34);
    ctx.fillStyle = "#141418"; ctx.font = `650 28px "Inter Variable", Inter, sans-serif`;
    ctx.fillText(k.name, x + 92, y + ch + 46);
    ctx.fillStyle = "#6a6a74"; ctx.font = `500 20px "JetBrains Mono Variable", monospace`;
    ctx.fillText(k.trim === k.body ? k.body : `${k.body} / ${k.trim}`, x + 92, y + ch + 76);
  });
  return c;
}

export async function exportMatrix(d: Design, processed: Record<string, ProcessedGraphic>, back: boolean) {
  const st = useStore.getState();
  try {
    const c = await matrixCanvas(d, processed, back);
    if (!c) return st.toast("Add a colorway first.", "warn");
    const where = await download(await canvasToBlob(c), `${slug(d.name)}-colorways.png`);
    if (where) st.toast(`Colorway matrix exported (${d.colorways.length} colorways)`, "good");
  } catch (e) {
    st.toast(`Matrix export failed: ${(e as Error).message}`, "warn");
  }
}
