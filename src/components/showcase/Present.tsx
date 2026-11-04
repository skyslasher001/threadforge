import { useEffect, useRef, useState } from "react";
import { useStore } from "../../state/store";
import { previewsOf } from "../../state/showcase";
import type { Design, ProcessedGraphic } from "../../types";
import { renderGarment, renderPair } from "../../lib/render";
import { styleFacts } from "../../lib/linesheet";
import { techpackOf } from "../../lib/production";
import { brandKit, brandName, fontOf, logoOn } from "../../state/brand";
import { isDark } from "../../data/fabrics";
import { compositePhoto } from "./PhotoMockups";
import { IcX } from "../Icons";

export interface Slide {
  id: string;
  kind: "title" | "hero" | "grid" | "facts";
  title: string;
  sub?: string;
  img?: string;
  grid?: { img: string; label: string; sw: [string, string] }[];
  facts?: [string, string][];
  bg: string;
  logo?: string;
  font?: string;
}

/** Everything worth showing about this design, in presentation order. */
export async function buildSlides(d: Design, processed: Record<string, ProcessedGraphic>): Promise<Slide[]> {
  const pv = previewsOf(d, processed);
  const tp = techpackOf(d);
  const brand = brandName(d);
  const kit = brandKit();
  const studio = isDark(d.bodyColor) ? "#E9E7E2" : "#1A1A1F";
  const url = (c: HTMLCanvasElement) => c.toDataURL("image/png");
  const slides: Slide[] = [];
  const front = url((await renderGarment(d, { view: "front", pxPerInch: 40, background: null, previews: pv })).canvas);
  const titleBg = kit.colors[0]?.hex && kit.name ? kit.colors[0].hex : "#0E0E12";
  slides.push({ id: "title", kind: "title", title: d.name, sub: [brand, tp.season].filter(Boolean).join(" · "), img: front, bg: titleBg, logo: (await logoOn(titleBg, kit)) ?? undefined, font: fontOf(kit.headingFont).css });
  slides.push({ id: "front", kind: "hero", title: "Front", img: front, bg: studio });
  slides.push({ id: "back", kind: "hero", title: "Back", img: url((await renderGarment(d, { view: "back", pxPerInch: 40, background: null, previews: pv })).canvas), bg: studio });
  if (d.colorways.length > 1) {
    const grid = [];
    for (const c of d.colorways.slice(0, 8))
      grid.push({ img: url((await renderGarment(d, { view: "front", pxPerInch: 18, background: null, previews: pv, body: c.body, trim: c.trim })).canvas), label: c.name, sw: [c.body, c.trim] as [string, string] });
    slides.push({ id: "colorways", kind: "grid", title: `${d.colorways.length} colorways`, grid, bg: "#121216" });
  }
  for (const p of d.showcase?.photos ?? [])
    slides.push({ id: `photo-${p.id}`, kind: "hero", title: p.name, img: (await compositePhoto(d, processed, p, 2200)).toDataURL("image/jpeg", 0.92), bg: "#0B0B0E" });
  for (const r of d.showcase?.renders ?? [])
    if (r.status === "completed" && r.src && r.kind === "image") slides.push({ id: `ai-${r.id}`, kind: "hero", title: "On-model render", img: r.src, bg: "#0B0B0E" });
  const f = styleFacts({ design: d, processed });
  slides.push({
    id: "facts", kind: "facts", title: "Details", bg: "#0E0E12",
    img: url(await renderPair(d, { pxPerInch: 18, background: null, previews: pv }, 1)),
    facts: [
      ["Garment", f.garment], ["Fabric", f.fabric], ["Sizes", f.sizes], ["Decoration", f.decoration],
      ["Colorways", f.colorways.map((c) => c.name).join(", ")],
      ...(f.wholesale !== null ? ([["Wholesale", `$${f.wholesale.toFixed(2)}`], ["MSRP", `$${f.retail!.toFixed(0)}`]] as [string, string][]) : []),
    ],
  });
  return slides;
}

export function Present() {
  const set = useStore((s) => s.set);
  const [slides, setSlides] = useState<Slide[] | null>(null);
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(false);
  const [idle, setIdle] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const idleT = useRef(0);
  const close = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    set({ presenting: false });
  };
  useEffect(() => {
    const st = useStore.getState();
    buildSlides(st.design, st.processed).then(setSlides).catch((e: Error) => { st.toast(`Present failed: ${e.message}`, "warn"); set({ presenting: false }); });
    root.current?.requestFullscreen?.().catch(() => undefined);
    // leaving full screen (e.g. the system Esc) ends the presentation
    let wasFull = false;
    const onFs = () => { if (document.fullscreenElement) wasFull = true; else if (wasFull) close(); };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const n = slides?.length ?? 0;
  const go = (k: number) => setI((x) => Math.max(0, Math.min(n - 1, x + k)));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(-1); }
      else if (e.key === "Home") setI(0);
      else if (e.key === "End") setI(n - 1);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);
  useEffect(() => {
    if (!auto || !n) return;
    const t = setInterval(() => setI((x) => (x + 1) % n), 4500);
    return () => clearInterval(t);
  }, [auto, n]);
  const s = slides?.[i];
  return (
    <div ref={root} className={`present${idle ? " idle" : ""}`} data-testid="present" style={{ background: s?.bg ?? "#0B0B0E" }}
      onPointerMove={() => { setIdle(false); clearTimeout(idleT.current); idleT.current = window.setTimeout(() => setIdle(true), 2200); }}
      onClick={(e) => { if ((e.target as HTMLElement).closest("button")) return; go(e.clientX > window.innerWidth / 3 ? 1 : -1); }}>
      {!slides && <div className="present-load"><span className="spinner" /> Preparing slides…</div>}
      {slides?.map((x, k) => (
        <div key={x.id} className={`slide ${x.kind}${k === i ? " on" : ""}`} aria-hidden={k !== i} style={{ color: isDark(x.bg) ? "#F4F4F6" : "#141418" }}>
          {x.kind === "title" && (
            <>
              <div className="slide-copy">
                {x.logo && <img className="slide-logo" src={x.logo} alt="" />}
                <div className="eyebrow">{x.sub || "New design"}</div><h1 style={{ fontFamily: x.font }}>{x.title}</h1>
              </div>
              <img src={x.img} alt="" />
            </>
          )}
          {x.kind === "hero" && <><img src={x.img} alt={x.title} /><div className="slide-cap">{x.title}</div></>}
          {x.kind === "grid" && (
            <>
              <h2>{x.title}</h2>
              <div className="slide-grid">
                {x.grid!.map((g) => <figure key={g.label + g.sw[0]}><img src={g.img} alt={g.label} /><figcaption><i style={{ background: g.sw[0] }} /><i style={{ background: g.sw[1] }} />{g.label}</figcaption></figure>)}
              </div>
            </>
          )}
          {x.kind === "facts" && (
            <>
              <img src={x.img} alt="" />
              <dl>{x.facts!.map(([k2, v]) => <div key={k2}><dt>{k2}</dt><dd>{v}</dd></div>)}</dl>
            </>
          )}
        </div>
      ))}
      <div className="present-bar">
        <span className="mono">{n ? `${i + 1} / ${n}` : ""}</span>
        <div className="present-dots">{slides?.map((x, k) => <button key={x.id} className={k === i ? "on" : ""} onClick={() => setI(k)} aria-label={`Slide ${k + 1}`} />)}</div>
        <button className="btn sm ghost" onClick={() => setAuto(!auto)}>{auto ? "Pause" : "Auto-play"}</button>
        <button className="btn sm ghost" onClick={close} aria-label="Exit presentation"><IcX size={13} /> Esc</button>
      </div>
    </div>
  );
}
