import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import type { Graphic, InkType } from "../types";
import { digitizeGraphic, stitchMinutes } from "../lib/imaging";
import { renderStitches, type Digitized } from "../lib/embroidery/digitize";
import { EMB_WRITERS, type EmbFormat } from "../lib/embroidery/formats";
import { filmsPdf } from "../lib/films";
import { HOOPS, INKS, hoopFor, printOrder } from "../lib/production";
import { saveFile } from "../lib/native";
import { slug } from "../lib/exporting";
import { graphicHeight } from "../lib/checks";
import { Slider } from "./Controls";
import { IcDownload, IcFilm } from "./Icons";

/** Screen print: ink system, suggested print order with mesh, actual-size film PDF. */
export function ScreenTools({ g }: { g: Graphic }) {
  const p = useStore((s) => s.processed[g.id]);
  const update = useStore((s) => s.updateGraphic);
  const toast = useStore((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const ink: InkType = g.ink ?? "plastisol";
  const steps = p ? printOrder(g, p.inks) : [];
  return (
    <div className="section">
      <div className="section-head"><span className="section-title">Screen print setup</span><span className="faint small">{steps.length} screens</span></div>
      <div className="field">
        <span className="label">Ink</span>
        <select id="ink-type" className="input" value={ink} onChange={(e) => update(g.id, { ink: e.target.value as InkType })}>
          {(Object.keys(INKS) as InkType[]).map((k) => <option key={k} value={k}>{INKS[k].name}</option>)}
        </select>
        <span className="faint small" style={{ lineHeight: 1.4 }}>{INKS[ink].note} Typical mesh {INKS[ink].mesh[0]}–{INKS[ink].mesh[1]}.</span>
      </div>
      {steps.length > 0 && (
        <div className="field">
          <span className="label">Suggested print order</span>
          {steps.map((st, i) => (
            <div key={i} className="ink-row" style={{ gridTemplateColumns: "18px 18px 1fr auto" }}>
              <span className="mono faint">{i + 1}</span>
              <span className="ink-dot" style={{ background: st.hex }} />
              <span>{st.label} <span className="mono faint">{st.hex}</span>{st.flash && <span className="faint"> · flash</span>}</span>
              <span className="mono faint">{st.mesh} mesh</span>
            </div>
          ))}
          <span className="faint small">Your printer may change the order for their press.</span>
        </div>
      )}
      <button className="btn sm primary" disabled={busy} onClick={async () => {
        setBusy(true);
        try {
          const bytes = await filmsPdf(g, useStore.getState().design.techpack?.styleNumber ?? "");
          const where = await saveFile(bytes, `${slug(g.name)}-films.pdf`, [{ name: "PDF", extensions: ["pdf"] }]);
          if (where) toast("Film PDF saved. Print at 100% on film.", "good");
        } catch (e) {
          toast(`Couldn't build films: ${(e as Error).message}`, "warn");
        }
        setBusy(false);
      }}><IcFilm size={13} /> {busy ? "Building films…" : "Films PDF (actual size)"}</button>
    </div>
  );
}

/** Embroidery: real stitch stats, hoop fit, machine files, stitch-out player. */
export function EmbroideryTools({ g }: { g: Graphic }) {
  const toast = useStore((s) => s.toast);
  const [d, setD] = useState<Digitized | null>(null);
  const [upto, setUpto] = useState(1);
  const canvas = useRef<HTMLCanvasElement>(null);
  const key = `${g.src.length}|${g.colors}|${g.w.toFixed(2)}`;

  useEffect(() => {
    let alive = true;
    setD(null);
    digitizeGraphic(g).then((r) => { if (alive) { setD(r); setUpto(1); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !d) return;
    const wMm = g.w * 25.4, hMm = graphicHeight(g) * 25.4;
    const pxPerMm = Math.min(6, 560 / Math.max(wMm, hMm));
    const src = renderStitches(d, pxPerMm, { wMm, hMm }, Math.round(upto * d.stitchCount));
    c.width = src.width; c.height = src.height;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0);
  }, [d, upto, g]);

  const save = async (fmt: EmbFormat) => {
    if (!d) return;
    const bytes = EMB_WRITERS[fmt](d.pattern);
    const where = await saveFile(bytes, `${slug(g.name)}.${fmt}`, [{ name: `${fmt.toUpperCase()} embroidery`, extensions: [fmt] }]);
    if (where) toast(`${fmt.toUpperCase()} saved (${d.stitchCount.toLocaleString()} stitches). Test-sew before production.`, "good");
  };

  const hoop = d ? hoopFor(d.widthMm, d.heightMm) : null;
  return (
    <div className="section">
      <div className="section-head"><span className="section-title">Embroidery file</span><span className="faint small">{d ? `${d.widthMm.toFixed(0)} × ${d.heightMm.toFixed(0)} mm` : "Digitizing…"}</span></div>
      {d && (
        <>
          <div className="stat-grid">
            <div className="stat"><div className="v">{(d.stitchCount / 1000).toFixed(1)}k</div><div className="k">stitches</div></div>
            <div className="stat"><div className="v">{stitchMinutes(d).toFixed(0)}m</div><div className="k">run @ 800 spm</div></div>
            <div className="stat"><div className="v">{d.trims}</div><div className="k">trims</div></div>
            <div className="stat"><div className="v">{d.satinShapes}</div><div className="k">satin shapes</div></div>
          </div>
          <div className={`notice ${hoop ? "good" : "bad"}`}>
            {hoop ? `Fits a ${hoop.name} hoop (${hoop.w} × ${hoop.h} mm field).` : `Larger than a ${HOOPS[HOOPS.length - 1].name} hoop. Shrink it or split into hoopings.`}
          </div>
          <div className="field">
            <span className="label">Stitch-out preview · {Math.round(upto * d.stitchCount).toLocaleString()} of {d.stitchCount.toLocaleString()}</span>
            <div className="thumb" style={{ width: "100%", height: 180, borderRadius: 9 }}>
              <canvas ref={canvas} style={{ maxWidth: "100%", maxHeight: 176 }} />
            </div>
            <Slider value={upto} min={0} max={1} step={0.005} onChange={setUpto} display={`${Math.round(upto * 100)}%`} />
          </div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <button className="btn sm primary" onClick={() => save("dst")}><IcDownload size={13} /> DST</button>
            <button className="btn sm" onClick={() => save("pes")}>PES</button>
            <button className="btn sm" onClick={() => save("exp")}>EXP</button>
            <button className="btn sm" onClick={() => save("jef")}>JEF</button>
            <button className="btn sm" onClick={() => save("vp3")}>VP3</button>
          </div>
          <span className="faint small" style={{ lineHeight: 1.4 }}>
            Tatami fill at 0.4 mm with underlay and pull compensation; strokes and lettering up to 6 mm wide sew as satin columns that follow the curve. DST for commercial machines, PES for Brother / Baby Lock, EXP for Melco / Bernina, JEF for Janome, VP3 for Husqvarna Viking / Pfaff. Auto-digitized files: always sew a test first.
          </span>
        </>
      )}
    </div>
  );
}
