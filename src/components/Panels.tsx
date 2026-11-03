import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, uid } from "../state/store";
import type { BrushStyle, DecorationMethod, FitPreset, Graphic, Parts, TemplateId } from "../types";
import { FABRICS, SWATCHES, fabricFor, fiberLabel, isDark, ozPerSqYd, type Fabric } from "../data/fabrics";
import { BASE_SIZE, FIT_LABELS, POMS, SIZES, TEMPLATES, fitBase, fmt, gradedSpec } from "../data/measurements";
import { buildGarment, defaultParts } from "../data/garments";
import { BRUSH_STYLES } from "../lib/brushes";
import { drawStroke } from "../lib/raster";
import { sketchToFlat } from "../lib/shapes";
import { FabricScanner } from "./FabricScanner";
import { EmbroideryTools, ScreenTools } from "./ProductionTools";
import { graphicChecks, graphicHeight, effectiveDpi, specChecks } from "../lib/checks";
import { filmSheet, removeBackground } from "../lib/imaging";
import { download, slug, specCsv } from "../lib/exporting";
import { geomFor, makeGraphic, pickImages } from "../lib/graphics";
import { FabricPattern } from "./Garment";
import { ColorChip, LenInput, Seg, Slider, Toggle } from "./Controls";
import { IcCheck, IcFilm, IcImage, IcPlus, IcTable, IcTrash, IcWand, IcWarn, IcX } from "./Icons";

// ---------------------------------------------------------------- shared bits

export function TemplateIcon({ id, color = "currentColor" }: { id: TemplateId; color?: string }) {
  const g = useMemo(() => buildGarment(id, "front", TEMPLATES[id].base, defaultParts(id)), [id]);
  const b = g.bounds;
  return (
    <svg viewBox={`${b.x0} ${b.y0} ${b.x1 - b.x0} ${b.y1 - b.y0}`} style={{ width: "100%", height: 64 }}>
      {g.hood && <path d={g.hood} fill={color} stroke="var(--text-3)" strokeWidth={0.35} />}
      <path d={g.body} fill={color} stroke="var(--text-3)" strokeWidth={0.35} strokeLinejoin="round" />
      {g.ribs.map((d, i) => <path key={i} d={d} fill={color} opacity={0.7} />)}
      {g.hoodInner && <path d={g.hoodInner} fill="#000" opacity={0.35} />}
    </svg>
  );
}

function FabricSwatch({ fabric, color }: { fabric: Fabric; color: string }) {
  const pid = `sw-${fabric.id}-${color.slice(1)}`;
  return (
    <svg viewBox="0 0 1.4 1.4" width="100%" height="100%" preserveAspectRatio="none">
      <defs><FabricPattern id={pid} fabric={fabric.pattern === "photo" ? { ...fabric, scale: 1.4 } : { ...fabric, scale: fabric.scale * 1.6 }} color={color} /></defs>
      <rect width={1.4} height={1.4} fill={`url(#${pid})`} />
    </svg>
  );
}

function Notice({ level, children, action }: { level: "bad" | "warn" | "good"; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className={`notice ${level}`}>
      {level === "good" ? <IcCheck size={14} /> : <IcWarn size={14} />}
      <div style={{ flex: 1 }}>{children}{action && <div style={{ marginTop: 6 }}>{action}</div>}</div>
    </div>
  );
}

// ---------------------------------------------------------------- garment

export function GarmentPanel() {
  const d = useStore((s) => s.design);
  const commit = useStore((s) => s.commit);
  const live = useStore((s) => s.live);
  const checkpoint = useStore((s) => s.checkpoint);
  const setTemplate = useStore((s) => s.setTemplate);
  const [target, setTarget] = useState<"body" | "trim">("body");
  const [scan, setScan] = useState(false);
  const tpl = TEMPLATES[d.template];
  const fab = fabricFor(d, d.fabricId);
  const hasTrim = tpl.ribCuff || tpl.ribHem || !tpl.hood;
  const color = target === "body" ? d.bodyColor : d.trimColor;
  const setColor = (c: string, history = true) => {
    const fn = (x: typeof d) => (target === "body" ? { ...x, bodyColor: c, ...(x.bodyColor === x.trimColor ? { trimColor: c } : {}) } : { ...x, trimColor: c });
    history ? commit(fn, "Color") : live(fn);
  };
  const setParts = (p: Partial<Parts>, label: string) => commit((x) => ({ ...x, parts: { ...x.parts, ...p } }), label);
  const allFabrics: Fabric[] = [...d.customFabrics.map((c) => fabricFor(d, c.id)), ...FABRICS.filter((f) => f.id !== "rib")];
  return (
    <>
      <div className="section">
        <div className="section-head"><span className="section-title">Garment</span><span className="faint small">{tpl.name}</span></div>
        <div className="grid2" style={{ gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
          {(Object.keys(TEMPLATES) as TemplateId[]).map((t) => (
            <button key={t} className={`card${d.template === t ? " on" : ""}`} style={{ padding: 6, alignItems: "center", gap: 4 }} onClick={() => setTemplate(t)} title={TEMPLATES[t].name}>
              <TemplateIcon id={t} color={d.template === t ? "var(--accent)" : "var(--text-3)"} />
              <span className="meta" style={{ color: d.template === t ? "var(--text)" : undefined }}>{TEMPLATES[t].short}</span>
            </button>
          ))}
        </div>
        <div className="field">
          <span className="label">Fit</span>
          <Seg full value={d.parts.fit} onChange={(fit) => commit((x) => ({
            ...x,
            base: fitBase(x.template, fit),
            parts: { ...x.parts, fit, sleeve: fit === "oversized" ? "drop" : x.parts.sleeve === "drop" ? "setin" : x.parts.sleeve },
          }), `Fit: ${FIT_LABELS[fit]}`)} options={(Object.keys(FIT_LABELS) as FitPreset[]).map((f) => ({ v: f, l: FIT_LABELS[f] }))} />
        </div>
        {!tpl.hood && (
          <div className="field">
            <span className="label">Neckline</span>
            <Seg full value={d.parts.neck} onChange={(neck) => setParts({ neck }, "Neckline")} options={[{ v: "crew", l: "Crew" }, { v: "v", l: "V-neck" }, { v: "mock", l: "Mock" }]} />
          </div>
        )}
        <div className="field">
          <span className="label">Sleeve</span>
          <Seg full value={d.parts.sleeve} onChange={(sleeve) => setParts({ sleeve }, "Sleeve style")} options={[{ v: "setin", l: "Set-in" }, { v: "raglan", l: "Raglan" }, { v: "drop", l: "Drop shoulder" }]} />
        </div>
        <div className="field">
          <span className="label">Pocket</span>
          <Seg full value={d.parts.pocket} onChange={(pocket) => setParts({ pocket }, "Pocket")}
            options={[{ v: "none", l: "None" }, { v: "chest", l: "Chest" }, ...(d.template === "hoodie" || d.template === "crewneck" ? [{ v: "kangaroo" as const, l: "Kangaroo" }] : [])]} />
        </div>
        <div className="field">
          <span className="label">Preview size</span>
          <Seg full value={d.previewSize} onChange={(v) => commit((x) => ({ ...x, previewSize: v }), `Preview ${v}`)}
            options={SIZES.map((s) => ({ v: s, l: s }))} />
        </div>
      </div>

      <div className="section">
        <div className="section-head"><span className="section-title">Color</span>
          {hasTrim && <Seg value={target} onChange={setTarget} options={[{ v: "body", l: "Body" }, { v: "trim", l: "Rib / trim" }]} />}
        </div>
        <div className="color-row">
          <ColorChip value={color} onChange={(c) => setColor(c, false)} onOpen={() => checkpoint("Color")} title="Custom color" />
          <input className="input mono" style={{ width: 92 }} value={color}
            onChange={(e) => /^#[0-9a-fA-F]{6}$/.test(e.target.value) && setColor(e.target.value.toUpperCase())} />
          <span className="faint small">{fab.pattern === "photo" && target === "body" ? "Scanned fabric keeps its own color" : isDark(color) ? "Dark garment" : "Light garment"}</span>
        </div>
        <div className="swatches">
          {SWATCHES.map((c) => (
            <button key={c} className={`swatch${c === color ? " on" : ""}`} style={{ background: c }} onClick={() => setColor(c)} title={c} />
          ))}
        </div>
      </div>

      <div className="section">
        <div className="section-head"><span className="section-title">Fabric</span>
          <button className="btn sm ghost" onClick={() => setScan(true)}><IcPlus size={13} /> Scan fabric</button></div>
        <div className="fabric-list">
          {allFabrics.map((f) => (
            <button key={f.id} className={`fabric-item${f.id === d.fabricId ? " on" : ""}`} onClick={() => commit((x) => ({ ...x, fabricId: f.id }), `Fabric: ${f.name}`)}>
              <div className="sw"><FabricSwatch fabric={f} color={d.bodyColor} /></div>
              <div>
                <div className="nm">{f.name}{f.pattern === "photo" && <span className="faint"> · scanned</span>}</div>
                <div className="mt">{f.construction} · {fiberLabel(f)}{f.costPerYard ? ` · $${f.costPerYard.toFixed(2)}/yd` : ""}</div>
              </div>
              <span className="mono faint small">{f.gsm}</span>
            </button>
          ))}
        </div>
        <div className="faint small" style={{ lineHeight: 1.45 }}>
          <span className="mono">{fab.gsm} GSM · {ozPerSqYd(fab.gsm).toFixed(1)} oz/yd²</span> · stretch {fab.stretch.toLowerCase()}{fab.supplier ? ` · ${fab.supplier}` : ""}. {fab.note}
        </div>
      </div>

      <ColorwaysSection />
      {scan && <FabricScanner onClose={() => setScan(false)} />}
    </>
  );
}

function ColorwaysSection() {
  const d = useStore((s) => s.design);
  const commit = useStore((s) => s.commit);
  return (
    <div className="section">
      <div className="section-head">
        <span className="section-title">Colorways</span>
        <button className="btn sm ghost" onClick={() => commit((x) => ({ ...x, colorways: [...x.colorways, { id: uid(), name: `Colorway ${x.colorways.length + 1}`, body: x.bodyColor, trim: x.trimColor }] }), "Save colorway")}>
          <IcPlus size={13} /> Save current
        </button>
      </div>
      {d.colorways.map((c) => {
        const on = c.body === d.bodyColor && c.trim === d.trimColor;
        return (
          <div key={c.id} className={`list-item${on ? " on" : ""}`} onClick={() => commit((x) => ({ ...x, bodyColor: c.body, trimColor: c.trim }), `Colorway: ${c.name}`)}>
            <div className="cw" style={{ padding: 0, border: 0, background: "none" }}>
              <div className="pair"><div style={{ background: c.body }} /><div style={{ background: c.trim }} /></div>
            </div>
            <input className="input" style={{ flex: 1, height: 26, background: "transparent", borderColor: "transparent" }} value={c.name}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => commit((x) => ({ ...x, colorways: x.colorways.map((k) => (k.id === c.id ? { ...k, name: e.target.value } : k)) }), "Rename colorway")} />
            <button className="btn icon sm ghost danger" title="Delete colorway" onClick={(e) => { e.stopPropagation(); commit((x) => ({ ...x, colorways: x.colorways.filter((k) => k.id !== c.id) }), "Delete colorway"); }}>
              <IcX size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- brush

/** Small live preview drawn with the real stroke engine. */
function BrushPreview({ style, color }: { style: BrushStyle; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = 130 * dpr; c.height = 28 * dpr;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    const def = BRUSH_STYLES.find((b) => b.id === style)!;
    const k = 15 * dpr; // px per inch in the preview
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const pts = Array.from({ length: 26 }, (_, i) => ({ x: 0.5 + i * 0.3, y: 0.95 + Math.sin(i / 3.6) * 0.42, p: 0.35 + Math.sin((i / 25) * Math.PI) * 0.6 }));
    drawStroke(ctx, { id: "pv", view: "front", layerId: "pv", style, color, size: Math.min(0.42, def.defaults.size * 1.05), opacity: def.defaults.opacity, points: pts, seed: 4 }, k);
  }, [style, color]);
  return <canvas ref={ref} style={{ width: "100%", height: 28 }} />;
}

export function BrushPanel() {
  const brush = useStore((s) => s.brush);
  const setBrush = useStore((s) => s.setBrush);
  const tool = useStore((s) => s.tool);
  const symmetry = useStore((s) => s.symmetry);
  const clip = useStore((s) => s.clip);
  const units = useStore((s) => s.units);
  const set = useStore((s) => s.set);
  const commit = useStore((s) => s.commit);
  const toast = useStore((s) => s.toast);
  const activeView = useStore((s) => s.activeView);
  const layer = useStore((s) => s.layerFor(s.activeView));
  const layerStrokes = useStore((s) => s.design.strokes.filter((x) => x.layerId === layer?.id).length);
  const [restyle, setRestyle] = useState<BrushStyle>("marker");
  const ink = BRUSH_STYLES.find((b) => b.id === brush.style)!;
  const isLight = useStore((s) => !isDark(s.design.bodyColor));

  const toFlat = () => {
    if (!layer) return;
    const st = useStore.getState();
    const src = st.design.strokes.filter((s) => s.layerId === layer.id);
    const id = `${activeView}-flat-${uid()}`;
    const out = sketchToFlat(src, id, isLight ? "#16161A" : "#F4F4F6");
    if (!out.length) return toast("Draw a rough sketch on this layer first.", "warn");
    commit((d) => ({
      ...d,
      layers: [...d.layers.map((l) => (l.id === layer.id ? { ...l, visible: false } : l)), { id, view: activeView, name: "Flat lines", visible: true, locked: false, opacity: 1, blend: "normal" }],
      strokes: [...d.strokes, ...out],
    }), "Sketch to flat");
    set({ activeLayer: { ...st.activeLayer, [activeView]: id } });
    toast(`Cleaned ${out.length} strokes into “Flat lines”. The sketch layer is hidden, not deleted.`, "good");
  };

  return (
    <div className="section">
      <div className="section-head"><span className="section-title">{tool === "eraser" ? "Eraser" : "Brush"}</span><span className="faint small">{tool === "eraser" ? `Erases “${layer?.name}” only` : ink.pack}</span></div>
      {tool === "brush" && (
        <>
          <div className="brush-grid">
            {BRUSH_STYLES.map((b) => (
              <button key={b.id} className={`brush-card${b.id === brush.style ? " on" : ""}`} title={b.hint}
                onClick={() => setBrush({ style: b.id, size: b.defaults.size, opacity: b.defaults.opacity })}>
                <BrushPreview style={b.id} color={brush.color === "#111114" ? "#E8E8EE" : brush.color} />
                <span className="nm">{b.name}</span>
                <span className="pack">{b.pack}</span>
              </button>
            ))}
          </div>
          <div className="color-row">
            <ColorChip value={brush.color} onChange={(c) => setBrush({ color: c })} title="Brush color" />
            <div className="swatches" style={{ gridTemplateColumns: "repeat(8, 1fr)", flex: 1 }}>
              {["#111114", "#F4F1EA", "#E0663A", "#F2D16B", "#B8322E", "#2E4A7D", "#3DD8FF", "#FF4FA3"].map((c) => (
                <button key={c} className={`swatch${c === brush.color ? " on" : ""}`} style={{ background: c }} onClick={() => setBrush({ color: c })} />
              ))}
            </div>
          </div>
        </>
      )}
      <div className="field"><span className="label">Size</span>
        <Slider value={brush.size} min={0.03} max={3} step={0.01} onChange={(v) => setBrush({ size: v })} display={fmt(brush.size, units, true)} /></div>
      {tool === "brush" && (
        <>
          <div className="field"><span className="label">Opacity</span>
            <Slider value={brush.opacity} min={0.05} max={1} onChange={(v) => setBrush({ opacity: v })} display={`${Math.round(brush.opacity * 100)}%`} /></div>
          <div className="field"><span className="label">Stabilizer</span>
            <Slider value={brush.stabilizer} min={0} max={100} step={1} onChange={(v) => setBrush({ stabilizer: v })} display={`${brush.stabilizer}`} /></div>
          <Toggle on={brush.quickShape} onChange={(v) => setBrush({ quickShape: v })} label="QuickShape: hold at the end to snap" hint="Draw a line, circle or box and keep the pen still" />
        </>
      )}
      <Toggle on={symmetry} onChange={(v) => set({ symmetry: v })} label={<>Mirror across center <span className="kbd">X</span></>} />
      <Toggle on={clip} onChange={(v) => set({ clip: v })} label="Keep inside garment" />

      <div className="field">
        <span className="label">Layer tools · {layer?.name} ({layerStrokes})</span>
        <button className="btn sm" disabled={!layerStrokes} onClick={toFlat}><IcWand size={13} /> Sketch to flat</button>
        <div className="row">
          <select className="input" style={{ flex: 1 }} value={restyle} onChange={(e) => setRestyle(e.target.value as BrushStyle)} aria-label="Restyle as">
            {BRUSH_STYLES.map((b) => <option key={b.id} value={b.id}>{b.pack}</option>)}
          </select>
          <button className="btn sm" disabled={!layerStrokes} onClick={() => {
            commit((d) => ({ ...d, strokes: d.strokes.map((s) => (s.layerId === layer?.id && s.style !== "erase" ? { ...s, style: restyle } : s)) }), "Restyle layer");
            toast(`Restyled “${layer?.name}” as ${BRUSH_STYLES.find((b) => b.id === restyle)!.pack}`, "good");
          }}>Restyle</button>
        </div>
        <button className="btn sm danger" disabled={!layerStrokes} onClick={() => commit((d) => ({ ...d, strokes: d.strokes.filter((s) => s.layerId !== layer?.id) }), "Clear layer")}>
          <IcTrash size={13} /> Clear “{layer?.name}”
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- graphic

const METHODS: { v: DecorationMethod; l: string }[] = [
  { v: "screen", l: "Screen print" },
  { v: "embroidery", l: "Embroidery" },
  { v: "dtg", l: "DTG" },
];

export function GraphicPanel({ g }: { g: Graphic }) {
  const d = useStore((s) => s.design);
  const units = useStore((s) => s.units);
  const p = useStore((s) => s.processed[g.id]);
  const update = useStore((s) => s.updateGraphic);
  const checkpoint = useStore((s) => s.checkpoint);
  const remove = useStore((s) => s.removeGraphic);
  const commit = useStore((s) => s.commit);
  const toast = useStore((s) => s.toast);
  const set = useStore((s) => s.set);
  const [busy, setBusy] = useState(false);
  const zones = useMemo(() => geomFor(d, g.view).zones, [d, g.view]);
  const checks = graphicChecks(g, d, p);
  const dpi = effectiveDpi(g);
  const h = graphicHeight(g);
  const stale = p && !p.key.startsWith(`${g.id}|${g.method}|${g.colors}|`);

  return (
    <>
      <div className="section">
        <div className="section-head">
          <span className="section-title">Graphic</span>
          <span className="faint small">{g.view === "front" ? "Front" : "Back"} · {g.natW}×{g.natH}px</span>
        </div>
        <div className="row">
          <div className="thumb" style={{ width: 52, height: 52 }}><img src={p?.preview ?? g.src} alt="" /></div>
          <input className="input" style={{ flex: 1 }} value={g.name} onChange={(e) => update(g.id, { name: e.target.value })} />
        </div>
        <div className="field"><span className="label">Decoration</span>
          <Seg full value={g.method} onChange={(m) => update(g.id, { method: m, colors: m === "embroidery" ? Math.min(g.colors, 6) : g.colors })} options={METHODS} />
        </div>
        {g.method !== "dtg" && (
          <div className="field"><span className="label">{g.method === "screen" ? "Ink colors" : "Thread colors"}</span>
            <Slider value={g.colors} min={1} max={g.method === "screen" ? 10 : 12} step={1} onCommit={checkpoint}
              onChange={(v) => update(g.id, { colors: v }, false)} display={`${g.colors}`} />
          </div>
        )}
        {g.method === "screen" && <Toggle on={g.underbase} onChange={(v) => update(g.id, { underbase: v })} label="White underbase" hint="Prints white first so colors pop on dark fabric" />}
      </div>

      <div className="section">
        <div className="section-head"><span className="section-title">Size & placement</span></div>
        <div className="grid2">
          <div className="field"><span className="label">Width</span><LenInput value={g.w} units={units} min={0.5} max={24} onChange={(v) => update(g.id, { w: +v.toFixed(3) })} className="input num" /></div>
          <div className="field"><span className="label">Height</span><div className="input num" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", color: "var(--text-2)" }}>{fmt(h, units)}</div></div>
          <div className="field"><span className="label">From center</span><LenInput value={g.x} units={units} min={-20} max={20} onChange={(v) => update(g.id, { x: +v.toFixed(3) })} /></div>
          <div className="field"><span className="label">Below HPS</span><LenInput value={g.y - h / 2} units={units} min={-14} max={40} onChange={(v) => update(g.id, { y: +(v + h / 2).toFixed(3) })} /></div>
        </div>
        <div className="field"><span className="label">Rotation</span>
          <Slider value={g.rotation} min={-180} max={180} step={1} onCommit={checkpoint} onChange={(v) => update(g.id, { rotation: v }, false)} display={`${g.rotation}°`} /></div>
        <div className="field"><span className="label">Snap to zone</span>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {zones.map((z) => (
              <button key={z.id} className="btn sm" onClick={() => {
                const aspect = g.natH / g.natW;
                let w = Math.min(z.w, g.w);
                if (w * aspect > z.h) w = z.h / aspect;
                if (z.id === "full-front" || z.id === "full-back") { w = z.w; if (w * aspect > z.h) w = z.h / aspect; }
                update(g.id, { x: z.x, y: z.y - z.h / 2 + (w * aspect) / 2, w: +w.toFixed(2), rotation: 0 });
                set({ showZones: true });
                setTimeout(() => useStore.getState().set({ showZones: false }), 1200);
              }}>{z.name}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-head"><span className="section-title">Production check</span>
          {g.method !== "embroidery" && <span className="mono small" style={{ color: dpi >= 300 ? "var(--good)" : dpi >= 150 ? "var(--warn)" : "var(--bad)" }}>{Math.round(dpi)} DPI</span>}
        </div>
        {g.method !== "embroidery" && (
          <div className="meter"><div style={{ width: `${Math.min(100, (dpi / 300) * 100)}%`, background: dpi >= 300 ? "var(--good)" : dpi >= 150 ? "var(--warn)" : "var(--bad)" }} /></div>
        )}
        {checks.map((c, i) => (
          <Notice key={i} level={c.level} action={c.fix && <button className="btn sm" onClick={() => update(g.id, c.fix!.patch)}>{c.fix.label}</button>}>{c.text}</Notice>
        ))}
        {g.method !== "dtg" && p && !stale && (
          <div className="field">
            <span className="label">{g.method === "screen" ? `Screens (${p.inks.length + (g.underbase ? 1 : 0)})` : `Threads (${p.inks.length})`}</span>
            {g.method === "screen" && g.underbase && (
              <div className="ink-row"><span className="ink-dot" style={{ background: "#FFFFFF" }} /><span>White underbase</span><span className="mono faint">base</span></div>
            )}
            {p.inks.map((k, i) => (
              <div key={i} className="ink-row"><span className="ink-dot" style={{ background: k.hex }} /><span className="mono">{k.hex}</span><span className="mono faint">{Math.round(k.coverage * 100)}%</span></div>
            ))}
          </div>
        )}
        {(stale || (!p && g.method !== "dtg")) && <span className="faint small">Processing preview…</span>}
      </div>

      {g.method === "screen" && <ScreenTools g={g} />}
      {g.method === "embroidery" && <EmbroideryTools g={g} />}

      <div className="section">
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          <button className="btn sm" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              const src = await removeBackground(g.src);
              update(g.id, { src });
              toast("Background removed", "good");
            } catch { toast("Couldn't remove the background", "warn"); }
            setBusy(false);
          }}><IcWand size={13} /> Remove background</button>
          <button className="btn sm" onClick={() => {
            const other = g.view === "front" ? "back" : "front";
            const ng = makeGraphic(d, other, { src: g.src, w: g.natW, h: g.natH }, g.name);
            commit((x) => ({ ...x, graphics: [...x.graphics, { ...ng, method: g.method, colors: g.colors, underbase: g.underbase }] }));
            set({ selected: ng.id });
          }}>Copy to {g.view === "front" ? "back" : "front"}</button>
          {g.method === "screen" && (
            <button className="btn sm" onClick={async () => download(await filmSheet(g, g.underbase), `${slug(g.name)}-films.png`)}><IcFilm size={13} /> Film sheet PNG</button>
          )}
          <button className="btn sm danger" onClick={() => remove(g.id)}><IcTrash size={13} /> Delete</button>
        </div>
      </div>
    </>
  );
}

export function GraphicsList() {
  const d = useStore((s) => s.design);
  const selected = useStore((s) => s.selected);
  const processed = useStore((s) => s.processed);
  const set = useStore((s) => s.set);
  const update = useStore((s) => s.updateGraphic);
  const remove = useStore((s) => s.removeGraphic);
  return (
    <div className="section">
      <div className="section-head"><span className="section-title">Artwork</span>
        <button className="btn sm ghost" onClick={() => pickImages()}><IcImage size={13} /> Add image</button></div>
      {!d.graphics.length && <span className="faint small">Drop an image on the garment, paste one with Ctrl+V, or click Add image.</span>}
      {d.graphics.map((g) => (
        <div key={g.id} className={`list-item${selected === g.id ? " on" : ""}`} onClick={() => set({ selected: g.id, tool: "select", activeView: g.view })}>
          <div className="thumb"><img src={processed[g.id]?.preview ?? g.src} alt="" /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</div>
            <div className="faint small">{g.view} · {METHODS.find((m) => m.v === g.method)!.l} · {g.w.toFixed(1)} in</div>
          </div>
          <button className="btn icon sm ghost" title={g.visible ? "Hide" : "Show"} onClick={(e) => { e.stopPropagation(); update(g.id, { visible: !g.visible }); }}>
            <span style={{ opacity: g.visible ? 1 : 0.4 }}>{g.visible ? "●" : "○"}</span>
          </button>
          <button className="btn icon sm ghost danger" title="Delete" onClick={(e) => { e.stopPropagation(); remove(g.id); }}><IcTrash size={13} /></button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- print prep

export function PrintPanel() {
  const d = useStore((s) => s.design);
  const processed = useStore((s) => s.processed);
  const set = useStore((s) => s.set);
  const selected = useStore((s) => s.selected);
  const fab = fabricFor(d, d.fabricId);
  const totals = d.graphics.reduce(
    (a, g) => {
      const p = processed[g.id];
      if (g.method === "screen") a.screens += (p?.inks.length ?? g.colors) + (g.underbase ? 1 : 0);
      if (g.method === "embroidery") a.stitches += p?.stitches ?? 0;
      if (g.method === "dtg") a.dtg += 1;
      return a;
    },
    { screens: 0, stitches: 0, dtg: 0 },
  );
  const sel = d.graphics.find((g) => g.id === selected);
  return (
    <>
      <div className="section">
        <div className="section-head"><span className="section-title">Production summary</span><span className="faint small">{fab.name}</span></div>
        <div className="stat-grid">
          <div className="stat"><div className="v">{d.graphics.length}</div><div className="k">placements</div></div>
          <div className="stat"><div className="v">{totals.screens}</div><div className="k">screens</div></div>
          <div className="stat"><div className="v">{totals.stitches ? `${(totals.stitches / 1000).toFixed(1)}k` : "0"}</div><div className="k">stitches</div></div>
        </div>
        {!d.graphics.length && <span className="faint small">Add artwork to see separations, thread plans and production checks.</span>}
        {d.graphics.map((g) => {
          const p = processed[g.id];
          const issues = graphicChecks(g, d, p).filter((c) => c.level !== "good");
          return (
            <div key={g.id} className={`list-item${selected === g.id ? " on" : ""}`} onClick={() => set({ selected: g.id, activeView: g.view })} style={{ alignItems: "flex-start" }}>
              <div className="thumb" style={{ width: 46, height: 46 }}><img src={p?.preview ?? g.src} alt="" /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 12 }}>{g.name}</div>
                <div className="faint small">{METHODS.find((m) => m.v === g.method)!.l} · {g.view} · {g.w.toFixed(1)}×{graphicHeight(g).toFixed(1)} in</div>
                <div className="row" style={{ gap: 3, marginTop: 5, flexWrap: "wrap" }}>
                  {g.method === "screen" && g.underbase && <span className="ink-dot" style={{ width: 12, height: 12, background: "#fff" }} />}
                  {p?.inks.map((k, i) => <span key={i} className="ink-dot" style={{ width: 12, height: 12, background: k.hex }} />)}
                </div>
              </div>
              <span className="mono small" style={{ color: issues.some((c) => c.level === "bad") ? "var(--bad)" : issues.length ? "var(--warn)" : "var(--good)" }}>
                {issues.length ? `${issues.length} flag${issues.length > 1 ? "s" : ""}` : "ready"}
              </span>
            </div>
          );
        })}
      </div>
      {sel && <GraphicPanel g={sel} />}
    </>
  );
}

// ---------------------------------------------------------------- measurements

export function MeasurePanel() {
  const d = useStore((s) => s.design);
  const units = useStore((s) => s.units);
  const commit = useStore((s) => s.commit);
  const set = useStore((s) => s.set);
  const compareSize = useStore((s) => s.compareSize);
  const t = TEMPLATES[d.template];
  const specs = useMemo(() => SIZES.map((s) => gradedSpec(d.base, d.grade, s)), [d.base, d.grade]);
  const issues = useMemo(() => specChecks(d), [d]);
  return (
    <>
      <div className="section">
        <div className="section-head">
          <span className="section-title">Spec sheet · {t.name}</span>
          <div className="row">
            <Seg value={units} onChange={(u) => set({ units: u })} options={[{ v: "in", l: "in" }, { v: "cm", l: "cm" }]} />
            <button className="btn sm" onClick={() => download(new Blob([specCsv(d, units)], { type: "text/csv" }), `${slug(d.name)}-spec.csv`)}><IcTable size={13} /> CSV</button>
          </div>
        </div>
        <div className="faint small" style={{ lineHeight: 1.45 }}>
          Edit the base size ({BASE_SIZE}) and grade per size. The flat redraws live; click a size column to preview it on the canvas.
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="spec">
            <thead>
              <tr>
                <th>POM</th><th style={{ textAlign: "left" }}></th><th>Tol ±</th><th>{BASE_SIZE}</th><th>Grade</th>
                {SIZES.map((s) => (
                  <th key={s} className={s === d.previewSize ? "cur" : ""} style={{ cursor: "pointer" }} onClick={() => commit((x) => ({ ...x, previewSize: s }))}>{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.poms.map((code) => {
                const pom = POMS[code];
                return (
                  <tr key={code} title={pom.how}>
                    <td className="code">{code}</td>
                    <td className="pom">{pom.name}</td>
                    <td>{fmt(pom.tol, units)}</td>
                    <td className="base">
                      <LenInput className="cell-in" value={d.base[code]} units={units} min={pom.min} max={pom.max}
                        onChange={(v) => commit((x) => ({ ...x, base: { ...x.base, [code]: +v.toFixed(4) } }))} />
                    </td>
                    <td>
                      <LenInput className="cell-in grade" value={d.grade[code] ?? 0} units={units} min={-3} max={3}
                        onChange={(v) => commit((x) => ({ ...x, grade: { ...x.grade, [code]: +v.toFixed(4) } }))} />
                    </td>
                    {specs.map((m, i) => (
                      <td key={i} className={SIZES[i] === d.previewSize ? "cur" : ""}>{fmt(m[code], units)}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="row between">
          <span className="muted">Fit compare: ghost another size over {d.previewSize}</span>
          <select id="compare-size" className="input" value={compareSize ?? ""} onChange={(e) => set({ compareSize: e.target.value || null })}>
            <option value="">Off</option>
            {SIZES.filter((x) => x !== d.previewSize).map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        {issues.length ? issues.map((x, i) => <Notice key={i} level="warn">{x}</Notice>) : <Notice level="good">Grade rules are consistent across XS–3XL.</Notice>}
        <div className="row">
          <button className="btn sm" onClick={() => commit((x) => ({ ...x, base: { ...t.base }, grade: { ...t.grade } }))}>Reset to template defaults</button>
          <span className="faint small">Hover a row for how to measure.</span>
        </div>
      </div>
    </>
  );
}

