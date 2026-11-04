import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore, hasAutosave, newDesign, recoverFromAppData, WORKSPACES, type Mode, type SideTab } from "./state/store";
import type { TemplateId, Tool } from "./types";
import { TEMPLATES } from "./data/measurements";
import { FABRICS, SWATCHES } from "./data/fabrics";
import { BRUSH_STYLES } from "./lib/brushes";
import { cacheKey, demoGraphic, filmSheet, processGraphic } from "./lib/imaging";
import { download, openProject, renderMockupPng, saveProject, slug, specCsv } from "./lib/exporting";
import { addImageFiles, geomFor, makeGraphic, pickImages } from "./lib/graphics";
import { ARTBOARD, artboardX, contentBounds } from "./data/garments";
import { checkForUpdates, isTauri, openFile as nativeOpen } from "./lib/native";
import { runBenchmark } from "./lib/bench";
import { LayersPanel, HistoryPanel } from "./components/SidePanels";
import { TechPackPanel } from "./components/TechPackPanel";
import { ShowcasePanel, ShowcaseView } from "./components/showcase/Showcase";
import { Present } from "./components/showcase/Present";
import { buildTechPack } from "./lib/techpack";
import { saveFile } from "./lib/native";
import { Stage, paintAllViews } from "./components/Stage";
import { BrushPanel, GarmentPanel, GraphicPanel, GraphicsList, MeasurePanel, PrintPanel, TemplateIcon } from "./components/Panels";
import { CommandPalette, type Command } from "./components/Palette";
import {
  IcBrush, IcCommand, IcDownload, IcEraser, IcFilm, IcFit, IcFocus, IcFolder, IcHand, IcImage, IcNeedle, IcPalette, IcPrint,
  IcRedo, IcRuler, IcSave, IcSelect, IcShirt, IcSymmetry, IcTable, IcUndo, IcZones, IcLayers, IcChevron, IcX, IcSparkle,
} from "./components/Icons";

const TOOLS: { id: Tool; label: string; key: string; icon: typeof IcSelect }[] = [
  { id: "select", label: "Select & move", key: "V", icon: IcSelect },
  { id: "brush", label: "Brush", key: "B", icon: IcBrush },
  { id: "eraser", label: "Eraser", key: "E", icon: IcEraser },
  { id: "hand", label: "Pan", key: "H", icon: IcHand },
];

export default function App() {
  // Everything except the camera: panning and zooming must not re-render the whole app.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const s = useStore(useShallow(({ camera, ...rest }) => rest));
  const svgRef = useRef<SVGSVGElement>(null);
  const [menu, setMenu] = useState<"export" | "theme" | "workspace" | null>(null);
  const [perf, setPerf] = useState(false);
  const resizing = useRef<{ x: number; w: number } | null>(null);

  // Desktop: recover the app-data autosave if it's newer than the browser copy (crash recovery).
  useEffect(() => {
    recoverFromAppData().then((ok) => ok && setWelcome(false));
  }, []);
  const [welcome, setWelcome] = useState(() => !hasAutosave());

  // theme + accent on <html>
  useEffect(() => {
    document.documentElement.dataset.theme = s.theme;
    document.documentElement.dataset.accent = s.accent;
  }, [s.theme, s.accent]);

  useEffect(() => {
    document.title = `${s.design.name} — THREADFORGE`;
  }, [s.design.name]);

  // Process graphics for screen / embroidery previews (cached by content + settings).
  useEffect(() => {
    let alive = true;
    for (const g of s.design.graphics) {
      const key = cacheKey(g);
      if (s.processed[g.id]?.key === key) continue;
      processGraphic(g)
        .then((p) => {
          if (!alive) return;
          const cur = useStore.getState().design.graphics.find((x) => x.id === g.id);
          if (cur && cacheKey(cur) === key) useStore.setState((st) => ({ processed: { ...st.processed, [g.id]: p } }));
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [s.design.graphics, s.processed]);

  // ---- actions ----
  const renderMockup = async (pxPerInch = 40) => {
    if (!svgRef.current) throw new Error("Canvas not ready");
    s.set({ selected: null });
    await new Promise((r) => setTimeout(r, 30));
    const d = useStore.getState().design;
    const geoms = { front: geomFor(d, "front"), back: geomFor(d, "back") };
    const crop = contentBounds(geoms, 2.5);
    return renderMockupPng(svgRef.current, pxPerInch, "#F1F1F3", (ctx, k, c) =>
      paintAllViews(ctx, d, geoms, (v) => new DOMMatrix([k, 0, 0, k, (artboardX(v) + ARTBOARD.originX - c.x0) * k, (ARTBOARD.originY - c.y0) * k]), useStore.getState().clip), crop);
  };
  const [tpBusy, setTpBusy] = useState(false);
  const exportTechPack = async () => {
    setTpBusy(true);
    try {
      const st = useStore.getState();
      const mock = await renderMockup(30).catch(() => null);
      const bytes = await buildTechPack(st.design, mock, st.processed, st.units);
      const where = await saveFile(bytes, `${slug(st.design.name)}-techpack.pdf`, [{ name: "PDF", extensions: ["pdf"] }]);
      if (where) st.toast("Tech pack PDF exported", "good");
    } catch (e) {
      useStore.getState().toast(`Tech pack failed: ${(e as Error).message}`, "warn");
    }
    setTpBusy(false);
  };
  const exportMockup = async () => {
    try {
      const png = await renderMockup(40);
      const where = await download(png, `${slug(s.design.name)}-mockup.png`);
      if (where) s.toast("Mockup exported (front + back, 40 px/in)", "good");
    } catch {
      s.toast("Export failed. Try again after the previews finish processing.", "warn");
    }
  };
  const exportCsv = async () => {
    const where = await download(new Blob([specCsv(s.design, s.units)], { type: "text/csv" }), `${slug(s.design.name)}-spec.csv`);
    if (where) s.toast("Spec sheet exported", "good");
  };
  const exportFilms = async () => {
    const g = s.design.graphics.find((x) => x.id === s.selected && x.method === "screen") ?? s.design.graphics.find((x) => x.method === "screen");
    if (!g) return s.toast("No screen-print graphic to separate yet.", "warn");
    const where = await download(await filmSheet(g, g.underbase), `${slug(g.name)}-films.png`);
    if (where) s.toast(`Films exported for ${g.name}`, "good");
  };
  const openFile = async () => {
    const f = await nativeOpen([{ name: "THREADFORGE project", extensions: ["tforge", "json"] }], ".tforge,application/json");
    if (!f) return;
    try {
      useStore.getState().loadDesign(await openProject(new TextDecoder().decode(f.bytes)));
      useStore.getState().toast(`Opened ${f.name}`, "good");
    } catch (e) {
      useStore.getState().toast((e as Error).message, "warn");
    }
  };
  const saveNow = async () => {
    const where = await saveProject(useStore.getState().design);
    if (where) useStore.getState().toast(where === "download" ? "Project saved" : `Saved to ${where}`, "good");
  };
  const benchmark = async () => {
    setPerf(true);
    await new Promise((r) => setTimeout(r, 60));
    await runBenchmark(2000);
  };
  const updates = async () => {
    const r = await checkForUpdates();
    if (r.status === "available") {
      s.toast(`Update ${r.version} found. Installing…`, "good");
      await r.install?.();
    } else if (r.status === "none") s.toast("You're on the latest version.", "good");
    else s.toast(r.message ?? "Couldn't check for updates.", "warn");
  };
  const tab = (t: SideTab) => s.set({ sideTab: t, sideOpen: true });
  const setMode = (m: Mode) => {
    const st = useStore.getState();
    if (st.mode === m) return;
    st.set({ mode: m });
    const wide = (x: Mode) => x === "measure" || x === "techpack";
    if (wide(m) || wide(st.mode)) setTimeout(() => useStore.getState().set({ fitRequest: useStore.getState().fitRequest + 1 }), 240);
  };

  // ---- commands (palette + shortcuts) ----
  const commands: Command[] = useMemo(() => {
    const c: Command[] = [
      ...TOOLS.map((t) => ({ id: `tool-${t.id}`, label: `${t.label} tool`, group: "Tools", keys: t.key, run: () => s.set({ tool: t.id }) })),
      { id: "add-image", label: "Add image / artwork", group: "Artwork", keys: "I", run: () => pickImages() },
      { id: "demo", label: "Place demo graphic", group: "Artwork", run: () => placeDemo() },
      { id: "mode-design", label: "Go to Design", group: "Views", keys: "1", run: () => setMode("design") },
      { id: "mode-print", label: "Go to Print Prep", group: "Views", keys: "2", run: () => setMode("print") },
      { id: "mode-measure", label: "Go to Measurements", group: "Views", keys: "3", run: () => setMode("measure") },
      { id: "mode-techpack", label: "Go to Tech Pack", group: "Views", keys: "4", run: () => setMode("techpack") },
      { id: "mode-showcase", label: "Go to Showcase", group: "Views", keys: "5", run: () => setMode("showcase") },
      { id: "present", label: "Present this design (full screen)", group: "Showcase", run: () => s.set({ presenting: true }) },
      ...(["colorways", "3d", "photo", "social", "linesheet"] as const).map((t) => ({ id: `show-${t}`, label: `Showcase: ${({ colorways: "Colorway matrix", "3d": "3D viewer + turntable", photo: "Photo mockups", social: "Social images", linesheet: "Line sheet PDF" })[t]}`, group: "Showcase", run: () => { setMode("showcase"); s.set({ showTab: t }); } })),
      { id: "export-techpack", label: "Export tech pack PDF", group: "Export", run: exportTechPack },
      { id: "fit", label: "Zoom to fit", group: "Views", keys: "Shift+1", run: () => s.set({ fitRequest: s.fitRequest + 1 }) },
      { id: "focus", label: "Toggle focus mode", group: "Views", keys: "Tab", run: () => s.set({ focus: !s.focus }) },
      { id: "zones", label: "Toggle print zones", group: "Views", keys: "Z", run: () => s.set({ showZones: !s.showZones }) },
      { id: "dims", label: "Toggle measurement callouts", group: "Views", keys: "M", run: () => s.set({ showDims: !s.showDims }) },
      { id: "stitch", label: "Toggle stitch lines", group: "Views", run: () => s.set({ showStitches: !s.showStitches }) },
      { id: "sym", label: "Toggle mirror drawing", group: "Drawing", keys: "X", run: () => s.set({ symmetry: !s.symmetry }) },
      { id: "undo", label: "Undo", group: "Edit", keys: "Ctrl+Z", run: s.undo },
      { id: "redo", label: "Redo", group: "Edit", keys: "Ctrl+Shift+Z", run: s.redo },
      { id: "export-png", label: "Export mockup PNG", group: "Export", keys: "Ctrl+E", run: exportMockup },
      { id: "export-csv", label: "Export spec sheet (CSV)", group: "Export", run: exportCsv },
      { id: "export-films", label: "Export screen-print films", group: "Export", run: exportFilms },
      { id: "save", label: "Save project (.tforge)", group: "File", keys: "Ctrl+S", run: saveNow },
      { id: "layers", label: "Show layers", group: "Panels", keys: "L", run: () => tab("layers") },
      { id: "history", label: "Show history & snapshots", group: "Panels", keys: "Y", run: () => tab("history") },
      { id: "panels", label: "Hide / show panels", group: "Panels", keys: "Ctrl+\\", run: () => s.set({ sideOpen: !s.sideOpen, railOpen: !s.sideOpen }) },
      ...WORKSPACES.map((w) => ({ id: `ws-${w.id}`, label: `Workspace: ${w.name}`, group: "Workspaces", run: () => s.applyWorkspace(w.id) })),
      { id: "bench", label: "Run performance benchmark (2,000 paths)", group: "Diagnostics", run: benchmark },
      { id: "update", label: "Check for updates", group: "App", run: updates },
      { id: "open", label: "Open project", group: "File", keys: "Ctrl+O", run: openFile },
      { id: "new", label: "New design (60-second start)", group: "File", keys: "Ctrl+N", run: () => setWelcome(true) },
      { id: "units", label: `Switch units to ${s.units === "in" ? "centimeters" : "inches"}`, group: "Settings", run: () => s.set({ units: s.units === "in" ? "cm" : "in" }) },
      ...(["midnight", "graphite", "studio"] as const).map((t) => ({ id: `theme-${t}`, label: `Theme: ${t[0].toUpperCase() + t.slice(1)}`, group: "Settings", run: () => s.set({ theme: t }) })),
      ...(["violet", "ember", "acid", "ice"] as const).map((a) => ({ id: `accent-${a}`, label: `Accent: ${a}`, group: "Settings", run: () => s.set({ accent: a }) })),
      ...(Object.keys(TEMPLATES) as TemplateId[]).map((t) => ({ id: `tpl-${t}`, label: TEMPLATES[t].name, group: "Garment", run: () => s.setTemplate(t) })),
      ...FABRICS.filter((f) => f.id !== "rib").map((f) => ({ id: `fab-${f.id}`, label: `Fabric: ${f.name}`, group: `${f.gsm} GSM`, run: () => s.commit((d) => ({ ...d, fabricId: f.id })) })),
      ...s.design.colorways.map((cw) => ({ id: `cw-${cw.id}`, label: `Colorway: ${cw.name}`, group: "Color", run: () => s.commit((d) => ({ ...d, bodyColor: cw.body, trimColor: cw.trim })) })),
      ...BRUSH_STYLES.map((b) => ({ id: `brush-${b.id}`, label: `Brush: ${b.name}`, group: b.pack, run: () => { s.set({ tool: "brush" }); s.setBrush({ style: b.id, size: b.defaults.size, opacity: b.defaults.opacity }); } })),
    ];
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.design.colorways, s.units, s.focus, s.showZones, s.showDims, s.showStitches, s.symmetry, s.fitRequest, s.selected, s.design]);

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select")) return;
      const st = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "k") { e.preventDefault(); st.set({ palette: !st.palette }); return; }
      if (st.palette) return;
      if (mod && k === "z") { e.preventDefault(); e.shiftKey ? st.redo() : st.undo(); return; }
      if (mod && k === "y") { e.preventDefault(); st.redo(); return; }
      if (mod && k === "s") { e.preventDefault(); saveNow(); return; }
      if (mod && e.key === "\\") { e.preventDefault(); const open = !(st.sideOpen && st.railOpen); st.set({ sideOpen: open, railOpen: open }); return; }
      if (mod && k === "o") { e.preventDefault(); openFile(); return; }
      if (mod && k === "e") { e.preventDefault(); exportMockup(); return; }
      if (mod && k === "n") { e.preventDefault(); setWelcome(true); return; }
      if (mod && k === "d" && st.selected) {
        e.preventDefault();
        const g = st.design.graphics.find((x) => x.id === st.selected);
        if (g) { const ng = { ...g, id: Math.random().toString(36).slice(2, 10), x: g.x + 1, y: g.y + 1 }; st.commit((d) => ({ ...d, graphics: [...d.graphics, ng] })); st.set({ selected: ng.id }); }
        return;
      }
      if (mod) return;
      if (e.key === "Tab") { e.preventDefault(); st.set({ focus: !st.focus }); return; }
      if (e.key === "Escape") { st.set({ selected: null, focus: false }); setMenu(null); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && st.selected) { st.removeGraphic(st.selected); return; }
      if (e.shiftKey && e.code === "Digit1") { st.set({ fitRequest: st.fitRequest + 1 }); return; }
      if (st.selected && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const g = st.design.graphics.find((x) => x.id === st.selected)!;
        const step = e.shiftKey ? 1 : 0.125;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        st.updateGraphic(g.id, { x: +(g.x + dx).toFixed(3), y: +(g.y + dy).toFixed(3) });
        return;
      }
      const map: Record<string, () => void> = {
        v: () => st.set({ tool: "select" }),
        b: () => st.set({ tool: "brush" }),
        e: () => st.set({ tool: "eraser" }),
        h: () => st.set({ tool: "hand" }),
        i: () => pickImages(),
        z: () => st.set({ showZones: !st.showZones }),
        m: () => st.set({ showDims: !st.showDims }),
        x: () => st.set({ symmetry: !st.symmetry }),
        l: () => st.set({ sideTab: st.sideTab === "layers" ? "props" : "layers", sideOpen: true }),
        y: () => st.set({ sideTab: st.sideTab === "history" ? "props" : "history", sideOpen: true }),
        "1": () => setMode("design"),
        "2": () => setMode("print"),
        "3": () => setMode("measure"),
        "4": () => setMode("techpack"),
        "5": () => setMode("showcase"),
        "[": () => st.setBrush({ size: Math.max(0.03, +(st.brush.size / 1.25).toFixed(3)) }),
        "]": () => st.setBrush({ size: Math.min(3, +(st.brush.size * 1.25).toFixed(3)) }),
      };
      map[k]?.();
    };
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (files.length) { e.preventDefault(); addImageFiles(files); }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const placeDemo = () => {
    const st = useStore.getState();
    const img = demoGraphic();
    const g = { ...makeGraphic(st.design, "front", img, "Sun badge"), colors: 3 };
    st.commit((d) => ({ ...d, graphics: [...d.graphics, g] }));
    st.set({ selected: g.id, tool: "select" });
  };

  const sel = s.design.graphics.find((g) => g.id === s.selected);
  const side = (() => {
    if (s.sideTab === "layers") return <LayersPanel />;
    if (s.sideTab === "history") return <HistoryPanel />;
    if (s.mode === "measure") return <MeasurePanel />;
    if (s.mode === "techpack") return <TechPackPanel onExport={exportTechPack} busy={tpBusy} />;
    if (s.mode === "showcase") return <ShowcasePanel />;
    if (s.mode === "print") return <PrintPanel />;
    return (
      <>
        {(s.tool === "brush" || s.tool === "eraser") && <BrushPanel />}
        {sel ? <GraphicPanel g={sel} /> : <><GraphicsList /><GarmentPanel /></>}
      </>
    );
  })();

  return (
    <div className={`app${s.focus ? " focus" : ""}${s.sideOpen ? "" : " side-closed"}${s.railOpen ? "" : " rail-closed"}`}
      onPointerMove={(e) => {
        const r = resizing.current;
        if (!r) return;
        s.set({ sideWidth: Math.max(260, Math.min(760, r.w + (r.x - e.clientX))) });
      }}
      onPointerUp={() => { if (resizing.current) { resizing.current = null; s.set({ fitRequest: s.fitRequest + 1 }); } }}>
      {/* ---------------- top bar ---------------- */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><IcShirt size={14} style={{ color: "#fff" }} /></div>
          THREADFORGE
        </div>
        <div className="divider" />
        <input className="project-name" value={s.design.name} onChange={(e) => s.live((d) => ({ ...d, name: e.target.value }))} onFocus={() => s.checkpoint()} aria-label="Project name" />
        <div className="tabs" role="tablist">
          {([["design", "Design", IcShirt], ["print", "Print Prep", IcPrint], ["measure", "Measurements", IcRuler], ["techpack", "Tech Pack", IcTable], ["showcase", "Showcase", IcSparkle]] as const).map(([m, label, Icon]) => (
            <button key={m} className={`tab${s.mode === m ? " on" : ""}`} onClick={() => setMode(m)} role="tab" aria-selected={s.mode === m}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <div className="menu-wrap">
          <button className="btn ghost sm" onClick={() => setMenu(menu === "workspace" ? null : "workspace")} title="Workspaces">
            {WORKSPACES.find((w) => w.id === s.workspace)?.name ?? "Workspace"} <IcChevron size={12} />
          </button>
          {menu === "workspace" && (
            <div className="menu" onMouseLeave={() => setMenu(null)}>
              <div className="mlabel">Workspaces</div>
              {WORKSPACES.map((w) => (
                <button key={w.id} className="mi" onClick={() => { setMenu(null); s.applyWorkspace(w.id); }}>{w.name}{s.workspace === w.id && <span className="kbd">on</span>}</button>
              ))}
              <div className="msep" />
              <button className="mi" onClick={() => { setMenu(null); s.set({ sideOpen: !s.sideOpen, railOpen: !s.sideOpen }); }}>{s.sideOpen ? "Hide panels" : "Show panels"} <span className="kbd">Ctrl \</span></button>
              <button className="mi" onClick={() => { setMenu(null); benchmark(); }}>Run performance benchmark</button>
              {isTauri() && <button className="mi" onClick={() => { setMenu(null); updates(); }}>Check for updates</button>}
            </div>
          )}
        </div>
        <button className="btn ghost sm" onClick={() => s.set({ palette: true })}><IcCommand size={13} /> Search <span className="kbd hide-narrow">Ctrl K</span></button>
        <button className="btn icon ghost" onClick={s.undo} disabled={!s.past.length} title="Undo (Ctrl+Z)"><IcUndo /></button>
        <button className="btn icon ghost" onClick={s.redo} disabled={!s.future.length} title="Redo (Ctrl+Shift+Z)"><IcRedo /></button>
        <div className="seg" title="Units">
          {(["in", "cm"] as const).map((u) => <button key={u} className={s.units === u ? "on" : ""} onClick={() => s.set({ units: u })}>{u}</button>)}
        </div>
        <div className="menu-wrap">
          <button className="btn icon ghost" onClick={() => setMenu(menu === "theme" ? null : "theme")} title="Theme"><IcPalette /></button>
          {menu === "theme" && (
            <div className="menu" onMouseLeave={() => setMenu(null)}>
              <div className="mlabel">Theme</div>
              {(["midnight", "graphite", "studio"] as const).map((t) => (
                <button key={t} className="mi" onClick={() => s.set({ theme: t })}>{t === "studio" ? "Studio Light" : t[0].toUpperCase() + t.slice(1)}{s.theme === t && <span className="kbd">on</span>}</button>
              ))}
              <div className="msep" />
              <div className="mlabel">Accent</div>
              <div className="row" style={{ padding: "4px 10px 8px", gap: 8 }}>
                {([["violet", "#7C5CFF"], ["ember", "#FF6A3D"], ["acid", "#C6FF3D"], ["ice", "#3DD8FF"]] as const).map(([a, c]) => (
                  <button key={a} className={`swatch${s.accent === a ? " on" : ""}`} style={{ background: c, width: 24, height: 24 }} onClick={() => s.set({ accent: a })} title={a} />
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="menu-wrap">
          <button className="btn primary" onClick={() => setMenu(menu === "export" ? null : "export")}><IcDownload size={14} /> Export</button>
          {menu === "export" && (
            <div className="menu" onMouseLeave={() => setMenu(null)}>
              <button className="mi" onClick={() => { setMenu(null); exportMockup(); }}><IcImage size={14} /> Mockup PNG <span className="kbd">Ctrl E</span></button>
              <button className="mi" onClick={() => { setMenu(null); exportCsv(); }}><IcTable size={14} /> Spec sheet CSV</button>
              <button className="mi" onClick={() => { setMenu(null); exportFilms(); }}><IcFilm size={14} /> Screen-print film sheet (PNG)</button>
              <button className="mi" onClick={() => { setMenu(null); exportTechPack(); }}><IcTable size={14} /> Tech pack PDF</button>
              <div className="msep" />
              <button className="mi" onClick={() => { setMenu(null); saveNow(); }}><IcSave size={14} /> Save project <span className="kbd">Ctrl S</span></button>
              <button className="mi" onClick={() => { setMenu(null); openFile(); }}><IcFolder size={14} /> Open project <span className="kbd">Ctrl O</span></button>
            </div>
          )}
        </div>
      </header>

      {/* ---------------- tool rail ---------------- */}
      <nav className="rail">
        {TOOLS.map((t) => (
          <button key={t.id} className={`tool${s.tool === t.id ? " on" : ""}`} onClick={() => s.set({ tool: t.id })} aria-label={t.label}>
            <t.icon size={18} />
            <span className="tip">{t.label} <span className="kbd">{t.key}</span></span>
          </button>
        ))}
        <div className="sep" />
        <button className="tool" onClick={() => pickImages()} aria-label="Add image"><IcImage size={18} /><span className="tip">Add artwork <span className="kbd">I</span></span></button>
        <button className={`tool${s.showZones ? " on" : ""}`} onClick={() => s.set({ showZones: !s.showZones })} aria-label="Print zones"><IcZones size={18} /><span className="tip">Print zones <span className="kbd">Z</span></span></button>
        <button className={`tool${s.showDims ? " on" : ""}`} onClick={() => s.set({ showDims: !s.showDims })} aria-label="Measurements"><IcRuler size={18} /><span className="tip">Measurement callouts <span className="kbd">M</span></span></button>
        <button className={`tool${s.showStitches ? " on" : ""}`} onClick={() => s.set({ showStitches: !s.showStitches })} aria-label="Stitches"><IcNeedle size={18} /><span className="tip">Stitch lines</span></button>
        <button className={`tool${s.symmetry ? " on" : ""}`} onClick={() => s.set({ symmetry: !s.symmetry })} aria-label="Mirror"><IcSymmetry size={18} /><span className="tip">Mirror drawing <span className="kbd">X</span></span></button>
        <div className="spacer" />
        <button className="tool" onClick={() => s.set({ fitRequest: s.fitRequest + 1 })} aria-label="Fit"><IcFit size={18} /><span className="tip">Zoom to fit <span className="kbd">Shift 1</span></span></button>
        <button className="tool" onClick={() => s.set({ focus: true })} aria-label="Focus mode"><IcFocus size={18} /><span className="tip">Focus mode <span className="kbd">Tab</span></span></button>
      </nav>

      <Stage svgRef={svgRef} />
      {s.mode === "showcase" && <ShowcaseView />}

      {/* ---------------- inspector ---------------- */}
      <aside className="side" style={{ width: (s.mode === "measure" || s.mode === "techpack") && s.sideTab === "props" ? Math.max(s.sideWidth, 720) : s.sideWidth }}>
        <div className={`side-resize${resizing.current ? " active" : ""}`} title="Drag to resize"
          onPointerDown={(e) => { e.preventDefault(); resizing.current = { x: e.clientX, w: s.sideWidth }; }} />
        <div className="side-tabs" role="tablist">
          {([["props", s.mode === "measure" ? "Spec" : s.mode === "print" ? "Production" : s.mode === "techpack" ? "Tech pack" : s.mode === "showcase" ? "Showcase" : "Properties"], ["layers", "Layers"], ["history", "History"]] as const).map(([t, label]) => (
            <button key={t} role="tab" aria-selected={s.sideTab === t} className={`side-tab${s.sideTab === t ? " on" : ""}`} onClick={() => tab(t)}>
              {t === "layers" && <IcLayers size={13} />}{label}
              {t === "layers" && <span className="count">{s.design.layers.filter((l) => l.view === s.activeView).length}</span>}
              {t === "history" && <span className="count">{s.past.length}</span>}
            </button>
          ))}
        </div>
        <div className="side-scroll">{side}</div>
      </aside>

      {/* ---------------- bottom bar ---------------- */}
      <footer className="bottombar">
        <span className="faint small" style={{ marginRight: 2 }}>Colorways</span>
        <div className="cw-strip">
          {s.design.colorways.map((c) => (
            <button key={c.id} className={`cw${c.body === s.design.bodyColor && c.trim === s.design.trimColor ? " on" : ""}`}
              onClick={() => s.commit((d) => ({ ...d, bodyColor: c.body, trimColor: c.trim }))}>
              <span className="pair"><span style={{ background: c.body }} /><span style={{ background: c.trim }} /></span>
              {c.name}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <span className="mono small">{s.design.strokes.length} strokes · {s.design.graphics.length} graphics</span>
        <div className="divider" style={{ height: 16 }} />
        <span className="mono small">{TEMPLATES[s.design.template].short} · {s.design.previewSize}</span>
        <div className="divider" style={{ height: 16 }} />
<ZoomReadout />
      </footer>

      {s.presenting && <Present />}
      {s.palette && <CommandPalette commands={commands} onClose={() => s.set({ palette: false })} />}
      {welcome && <Welcome onClose={() => setWelcome(false)} />}
      {perf && (s.bench.running ? <div className="bench-hud">Measuring… 2,000 paths</div> : <PerfDialog onClose={() => setPerf(false)} onRun={benchmark} />)}

      <div className="toasts">
        {s.toasts.map((t) => <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>)}
      </div>
    </div>
  );
}

/** 60-Second Start: garment → color → art, then straight into a finished, measured mockup. */
function Welcome({ onClose }: { onClose: () => void }) {
  const [tpl, setTpl] = useState<TemplateId>("hoodie");
  const [color, setColor] = useState("#3A3A3D");
  const start = (withDemo: boolean) => {
    const st = useStore.getState();
    const d = { ...newDesign(tpl), bodyColor: color, trimColor: color, name: `${TEMPLATES[tpl].short} drop 01` };
    if (withDemo) {
      const img = demoGraphic();
      const g = makeGraphic(d, "front", img, "Sun badge");
      const emb = tpl === "hoodie" || tpl === "crewneck";
      d.graphics = [emb ? { ...g, method: "embroidery", colors: 4, w: 4.5, y: g.y - g.w / 2 + 2.25 } : { ...g, method: "screen", colors: 3 }];
    }
    st.loadDesign(d);
    st.set({ mode: "design", tool: "select", selected: d.graphics[0]?.id ?? null });
    onClose();
  };
  return (
    <div className="scrim" style={{ paddingTop: "8vh" }}>
      <div className="welcome-card">
        <div className="row between">
          <div>
            <h1>Start a new design</h1>
            <div className="muted">Pick a garment and a color. You'll have a measured mockup in under a minute.</div>
          </div>
          {hasAutosave() && <button className="btn ghost" onClick={onClose}>Back to my design</button>}
        </div>
        <div className="welcome-grid">
          {(Object.keys(TEMPLATES) as TemplateId[]).map((t) => (
            <button key={t} className={`card${tpl === t ? " on" : ""}`} onClick={() => setTpl(t)}>
              <TemplateIcon id={t} color={tpl === t ? color : "var(--text-3)"} />
              <span className="name">{TEMPLATES[t].name}</span>
            </button>
          ))}
        </div>
        <div className="field" style={{ marginTop: 18 }}>
          <span className="label">Garment color</span>
          <div className="swatches" style={{ gridTemplateColumns: "repeat(24, 1fr)" }}>
            {SWATCHES.map((c) => <button key={c} className={`swatch${c === color ? " on" : ""}`} style={{ background: c }} onClick={() => setColor(c)} />)}
          </div>
        </div>
        <div className="row" style={{ marginTop: 20, justifyContent: "flex-end" }}>
          <button className="btn" onClick={() => start(false)}>Start blank</button>
          <button className="btn primary" onClick={() => start(true)}>Start with sample artwork</button>
        </div>
      </div>
    </div>
  );
}

/** Gate 1 results: 2,000 drawn paths, pan frame rate, full re-render time and cold start. */
function PerfDialog({ onClose, onRun }: { onClose: () => void; onRun: () => void }) {
  const bench = useStore((s) => s.bench);
  const r = bench.result;
  const rows = r
    ? [
        { k: "Paths on canvas", v: r.paths.toLocaleString(), budget: "2,000", ok: r.paths >= 2000 ? "good" : "bad" },
        { k: "Pan frame rate", v: `${r.panFps} fps`, budget: "120 target · 60 floor", ok: r.panFps >= 115 ? "good" : r.panFps >= 58 ? "warn" : "bad" },
        { k: "Slowest 5% of frames", v: `${r.p95FrameMs} ms`, budget: "≤ 16.7 ms", ok: r.p95FrameMs <= 16.7 ? "good" : r.p95FrameMs <= 33 ? "warn" : "bad" },
        { k: "Add a stroke", v: `${r.addStrokeMs} ms`, budget: "≤ 8 ms", ok: r.addStrokeMs <= 8 ? "good" : r.addStrokeMs <= 16 ? "warn" : "bad" },
        { k: "Full redraw after zoom", v: `${r.fullRenderMs} ms`, budget: "≤ 50 ms (runs once, after you stop)", ok: r.fullRenderMs <= 50 ? "good" : r.fullRenderMs <= 120 ? "warn" : "bad" },
        { k: "Start to first paint", v: `${r.coldStartMs} ms`, budget: "≤ 1,500 ms", ok: r.coldStartMs <= 1500 ? "good" : "warn" },
      ]
    : [];
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && !bench.running && onClose()}>
      <div className="welcome-card" style={{ width: "min(600px, 94vw)" }} role="dialog" aria-label="Performance benchmark">
        <div className="row between">
          <div>
            <h1 style={{ fontSize: 19 }}>Performance check</h1>
            <div className="muted">Draws 2,000 paths, pans for two seconds, then removes them. Your design isn't changed.</div>
          </div>
          {!bench.running && <button className="btn icon ghost" onClick={onClose} aria-label="Close"><IcX /></button>}
        </div>
        {bench.running && <div className="notice good" style={{ marginTop: 16 }}>Running… keep this window in front.</div>}
        {r && (
          <table className="perf-table" style={{ marginTop: 16 }}>
            <thead><tr><th>Metric</th><th style={{ textAlign: "right" }}>Result</th><th>Budget</th><th /></tr></thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.k}><td>{x.k}</td><td className="v">{x.v}</td><td className="faint">{x.budget}</td>
                  <td><span className={`pill ${x.ok}`}>{x.ok === "good" ? "pass" : x.ok === "warn" ? "near" : "miss"}</span></td></tr>
              ))}
            </tbody>
          </table>
        )}
        {r && <div className="faint small" style={{ marginTop: 10 }}>Frame rate is capped by your display's refresh rate: a 60 Hz monitor tops out at 60 fps.</div>}
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <button className="btn" disabled={bench.running} onClick={onRun}>Run again</button>
          <button className="btn primary" disabled={bench.running} onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function ZoomReadout() {
  const scale = useStore((s) => s.camera.s);
  const set = useStore((s) => s.set);
  return (
    <button className="btn sm ghost mono" onClick={() => set({ fitRequest: useStore.getState().fitRequest + 1 })} title="Physical scale: 100% = real size on a 96 DPI screen. Click to fit.">
      {Math.round((scale / 96) * 100)}%
    </button>
  );
}
