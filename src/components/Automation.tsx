import { useState } from "react";
import { useStore } from "../state/store";
import { useShow } from "../state/showcase";
import { buildBundle, bundlePlan, DEFAULT_BUNDLE, type BundleOpts } from "../lib/bundle";
import { applySteps, describe, noteBundle, startRecording, stopRecording, useMacros, type Macro } from "../lib/macros";
import { zip, type ZipEntry } from "../lib/zip";
import { isTauri, openFiles, saveFile } from "../lib/native";
import { OUT_DIR, pickHotFolder, startHot, stopHot, tauriFolder, useHot, type HotSettings } from "../lib/hotfolder";
import { geomFor } from "../lib/graphics";
import { openProject, slug } from "../lib/exporting";
import { migrate } from "../state/store";
import { processAll } from "../lib/linesheet";
import { SOCIAL } from "../lib/render";
import type { EmbFormat } from "../lib/embroidery/formats";
import { Toggle } from "./Controls";
import { IcDownload, IcTrash, IcX } from "./Icons";

const OPTS_KEY = "threadforge.bundle.v1";
const loadOpts = (): BundleOpts => {
  try { return { ...DEFAULT_BUNDLE, ...JSON.parse(localStorage.getItem(OPTS_KEY) ?? "{}") }; } catch { return DEFAULT_BUNDLE; }
};
const EMB: EmbFormat[] = ["dst", "pes", "exp", "jef", "vp3"];

/** Save a bundle (or several) as one ZIP. */
async function saveZip(entries: ZipEntry[], name: string) {
  return saveFile(zip(entries), name, [{ name: "ZIP archive", extensions: ["zip"] }]);
}

export async function runBundle(o: BundleOpts, onStep?: (l: string, p: number) => void) {
  const st = useStore.getState();
  noteBundle(o);
  const entries = await buildBundle(st.design, st.processed, st.units, { ...o, socialBg: useShow.getState().socialBg }, onStep);
  const where = await saveZip(entries, `${slug(st.design.name)}-delivery.zip`);
  if (where) st.toast(`Exported ${entries.length} files in one ZIP`, "good");
  return entries.length;
}

export function BundleDialog({ onClose }: { onClose: () => void }) {
  const d = useStore((s) => s.design);
  const [o, setO] = useState<BundleOpts>(loadOpts);
  const [prog, setProg] = useState<{ label: string; p: number } | null>(null);
  const set = (p: Partial<BundleOpts>) => setO((x) => { const n = { ...x, ...p }; try { localStorage.setItem(OPTS_KEY, JSON.stringify(n)); } catch { /* fine */ } return n; });
  const plan = bundlePlan(d, o);
  const total = plan.reduce((a, b) => a + b.count, 0);
  const toggleIn = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const go = async () => {
    setProg({ label: "Starting…", p: 0 });
    try {
      await runBundle(o, (label, p) => setProg({ label, p }));
      onClose();
    } catch (e) {
      useStore.getState().toast(`Export failed: ${(e as Error).message}`, "warn");
      setProg(null);
    }
  };
  const box = (k: keyof BundleOpts, label: string) => <Toggle on={!!o[k]} onChange={(v) => set({ [k]: v } as Partial<BundleOpts>)} label={label} />;
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && !prog && onClose()}>
      <div className="welcome-card auto-card" role="dialog" aria-label="Export everything">
        <div className="row between">
          <div><h1 style={{ fontSize: 19 }}>Export everything</h1><div className="muted">Every deliverable for {d.name}, in one ZIP.</div></div>
          {!prog && <button className="btn icon ghost" onClick={onClose} aria-label="Close"><IcX /></button>}
        </div>
        <div className="auto-grid">
          <div className="auto-col">
            <span className="label">Colorways</span>
            <div className="seg full">
              <button className={o.colorways === "all" ? "on" : ""} onClick={() => set({ colorways: "all" })}>All {d.colorways.length}</button>
              <button className={o.colorways === "working" ? "on" : ""} onClick={() => set({ colorways: "working" })}>Working colors only</button>
            </div>
            {box("mockups", "Mockups (front + back)")}
            {box("matrix", "Colorway matrix")}
            {box("photos", "Photo mockups")}
            <span className="label" style={{ marginTop: 6 }}>Social images</span>
            <div className="chips">{SOCIAL.map((f) => <button key={f.id} className={`chip${o.social.includes(f.id) ? " on" : ""}`} onClick={() => set({ social: toggleIn(o.social, f.id) })}>{f.name}</button>)}</div>
          </div>
          <div className="auto-col">
            {box("techpack", "Tech pack PDF")}
            {box("linesheet", "Line sheet PDF")}
            {box("spec", "Spec sheet CSV")}
            {box("films", "Film positives (screen print)")}
            {box("labels", "Labels + hang tag PDF")}
            {box("project", "Project file (.tforge)")}
            <span className="label" style={{ marginTop: 6 }}>Embroidery files</span>
            <div className="chips">{EMB.map((f) => <button key={f} className={`chip${o.embroidery.includes(f) ? " on" : ""}`} onClick={() => set({ embroidery: toggleIn(o.embroidery, f) })}>{f.toUpperCase()}</button>)}</div>
          </div>
        </div>
        <div className="auto-plan">{plan.map((p) => <span key={p.label}><b>{p.count}</b> {p.label}</span>)}</div>
        {prog && (
          <div className="auto-prog"><div className="bar"><i style={{ width: `${Math.round(prog.p * 100)}%` }} /></div><span className="small muted" data-testid="bundle-progress">{prog.label}</span></div>
        )}
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
          <button className="btn" disabled={!!prog} onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!!prog || !total} onClick={go} data-testid="bundle-go"><IcDownload size={14} /> Export {total} files</button>
        </div>
      </div>
    </div>
  );
}

// ---------------- macros ----------------

export function MacrosDialog({ onClose }: { onClose: () => void }) {
  const { macros, recording, set } = useMacros();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const st = () => useStore.getState();

  const runHere = async (m: Macro) => {
    st().commit((d) => applySteps(d, m.steps), `Macro: ${m.name}`);
    st().toast(`Ran "${m.name}" on ${st().design.name}`, "good");
    const b = m.steps.find((s) => s.kind === "bundle");
    if (b && b.kind === "bundle") { setBusy("Exporting…"); try { await runBundle(b.opts); } finally { setBusy(null); } }
  };

  const runOnFiles = async (m: Macro) => {
    const files = await openFiles([{ name: "THREADFORGE project", extensions: ["tforge", "json"] }], ".tforge,application/json");
    if (!files.length) return;
    const entries: ZipEntry[] = [];
    const b = m.steps.find((s) => s.kind === "bundle");
    for (const [i, f] of files.entries()) {
      setBusy(`${i + 1} / ${files.length}: ${f.name}`);
      try {
        const out = applySteps(migrate(await openProject(new TextDecoder().decode(f.bytes))), m.steps);
        const base = slug(out.name);
        entries.push({ path: `${base}.tforge`, data: new TextEncoder().encode(JSON.stringify({ app: "THREADFORGE", schema: 2, savedAt: new Date().toISOString(), design: out })) });
        if (b && b.kind === "bundle") {
          const processed = await processAll(out);
          entries.push(...(await buildBundle(out, processed, st().units, b.opts)));
        }
      } catch (e) {
        st().toast(`${f.name}: ${(e as Error).message}`, "warn");
      }
    }
    setBusy(null);
    if (!entries.length) return;
    const where = await saveZip(entries, `${slug(m.name)}-batch.zip`);
    if (where) st().toast(`"${m.name}" ran on ${files.length} project${files.length === 1 ? "" : "s"}`, "good");
  };

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="welcome-card auto-card" role="dialog" aria-label="Macros">
        <div className="row between">
          <div><h1 style={{ fontSize: 19 }}>Macros</h1><div className="muted">Record style changes once, replay them on any design or a whole batch of projects.</div></div>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close"><IcX /></button>
        </div>
        <div className="section" style={{ padding: "14px 0", borderBottom: "1px solid var(--line)" }}>
          {recording ? (
            <div className="row">
              <span className="rec-dot" /> <b>Recording</b><span className="muted small">Change fabric, fit, colors, colorways, measurements, artwork method… then stop.</span>
              <div className="spacer" />
              <input className="input" placeholder="Name this macro" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 200 }} data-testid="macro-name" />
              <button className="btn primary" onClick={() => { const m = stopRecording(name); setName(""); st().toast(m ? `Saved macro "${m.name}" (${m.steps.length} step${m.steps.length === 1 ? "" : "s"})` : "Nothing changed, so no macro was saved", m ? "good" : "warn"); }} data-testid="macro-stop">Stop and save</button>
            </div>
          ) : (
            <div className="row">
              <button className="btn primary" onClick={() => { startRecording(); onClose(); st().toast("Recording. Make your changes, then press Stop in the top bar.", "good"); }} data-testid="macro-record">● Record new macro</button>
              <span className="muted small">Records the difference between now and when you stop. Name, artwork pixels and drawings never change.</span>
            </div>
          )}
        </div>
        <div className="macro-list">
          {!macros.length && <div className="faint" style={{ padding: 20 }}>No macros yet.</div>}
          {macros.map((m) => (
            <div key={m.id} className="macro" data-testid="macro">
              <div className="row between">
                <input className="input macro-name" value={m.name} onChange={(e) => set({ macros: macros.map((x) => (x.id === m.id ? { ...x, name: e.target.value } : x)) })} />
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn sm primary" disabled={!!busy} onClick={() => runHere(m)} data-testid="macro-run">Run on this design</button>
                  <button className="btn sm" disabled={!!busy} onClick={() => runOnFiles(m)}>Run on files…</button>
                  <button className="btn icon sm ghost danger" title="Delete" onClick={() => set({ macros: macros.filter((x) => x.id !== m.id) })}><IcTrash size={13} /></button>
                </div>
              </div>
              <ul>{describe(m.steps).map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
          ))}
        </div>
        {busy && <div className="auto-prog"><span className="spinner" /> <span className="small muted">{busy}</span></div>}
      </div>
    </div>
  );
}

/** Top-bar pill while a macro is recording. */
export function RecordingPill() {
  const recording = useMacros((s) => s.recording);
  const [name, setName] = useState("");
  if (!recording) return null;
  return (
    <div className="rec-pill" data-testid="rec-pill">
      <span className="rec-dot" /> REC
      <input className="input" placeholder="Macro name" value={name} onChange={(e) => setName(e.target.value)} />
      <button className="btn sm primary" onClick={() => { const m = stopRecording(name); setName(""); useStore.getState().toast(m ? `Saved macro "${m.name}"` : "Nothing changed, so no macro was saved", m ? "good" : "warn"); }}>Stop</button>
      <button className="btn sm ghost" title="Discard" onClick={() => useMacros.getState().set({ recording: null })}><IcX size={12} /></button>
    </div>
  );
}

// ---------------- hot folder ----------------

const LAST_DIR = "threadforge.hotfolder.dir";

export function HotFolderDialog({ onClose }: { onClose: () => void }) {
  const hot = useHot();
  const d = useStore((s) => s.design);
  const macros = useMacros((s) => s.macros);
  const [s, setS] = useState<HotSettings>(hot.settings);
  const desktop = isTauri();
  const last = (() => { try { return localStorage.getItem(LAST_DIR); } catch { return null; } })();
  const zones = geomFor(d, s.view).zones;
  const set = (p: Partial<HotSettings>) => setS((x) => ({ ...x, ...p }));
  const setB = (p: Partial<BundleOpts>) => setS((x) => ({ ...x, bundle: { ...x.bundle, ...p } }));
  const toggleIn = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const start = async (resume = false) => {
    const folder = resume && last ? tauriFolder(last) : await pickHotFolder();
    if (!folder) return;
    try { localStorage.setItem(LAST_DIR, folder.label); } catch { /* fine */ }
    startHot(folder, useStore.getState().design, s);
    useStore.getState().toast(`Watching ${folder.label}`, "good");
  };
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="welcome-card auto-card" role="dialog" aria-label="Hot folder">
        <div className="row between">
          <div><h1 style={{ fontSize: 19 }}>Hot folder</h1><div className="muted">Drop artwork into a folder; each file becomes a finished design and its deliverables in <span className="mono">{OUT_DIR}</span>.</div></div>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close"><IcX /></button>
        </div>
        {!desktop && <div className="notice warn" style={{ marginTop: 12 }}>Hot folders need the desktop app (a browser can't watch a folder).</div>}
        <div className="auto-grid">
          <div className="auto-col">
            <span className="label">Template</span>
            <span className="small muted">This design ({d.name}): garment, fabric, colors, colorways and measurements. Its artwork is replaced by each dropped file.</span>
            <span className="label" style={{ marginTop: 6 }}>Place artwork</span>
            <div className="seg full">{(["front", "back"] as const).map((v) => <button key={v} className={s.view === v ? "on" : ""} onClick={() => set({ view: v, zone: v === "front" ? "full-front" : "full-back" })}>{v === "front" ? "Front" : "Back"}</button>)}</div>
            <select className="input" value={s.zone} onChange={(e) => set({ zone: e.target.value })}>{zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select>
            <div className="seg full">{(["screen", "embroidery", "dtg"] as const).map((m) => <button key={m} className={s.method === m ? "on" : ""} onClick={() => set({ method: m })}>{m === "screen" ? "Screen print" : m === "embroidery" ? "Embroidery" : "DTG"}</button>)}</div>
            <label className="row small muted" style={{ gap: 8 }}>Colors / threads <input className="input num" type="number" min={1} max={12} value={s.colors} onChange={(e) => set({ colors: Math.max(1, Math.min(12, +e.target.value || 1)) })} /></label>
            <label className="field"><span className="label">Then run macro</span>
              <select className="input" value={s.macroId ?? ""} onChange={(e) => set({ macroId: e.target.value || null })}>
                <option value="">None</option>{macros.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select></label>
          </div>
          <div className="auto-col">
            <span className="label">Write for each file</span>
            <div className="chips">
              {([["mockups", "Mockup"], ["techpack", "Tech pack"], ["spec", "Spec CSV"], ["films", "Films"], ["linesheet", "Line sheet"], ["labels", "Labels"], ["project", "Project"]] as const).map(([k, l]) => (
                <button key={k} className={`chip${s.bundle[k] ? " on" : ""}`} onClick={() => setB({ [k]: !s.bundle[k] } as Partial<BundleOpts>)}>{l}</button>
              ))}
            </div>
            <div className="chips">{SOCIAL.map((f) => <button key={f.id} className={`chip${s.bundle.social.includes(f.id) ? " on" : ""}`} onClick={() => setB({ social: toggleIn(s.bundle.social, f.id) })}>{f.name}</button>)}</div>
            <div className="chips">{EMB.map((f) => <button key={f} className={`chip${s.bundle.embroidery.includes(f) ? " on" : ""}`} onClick={() => setB({ embroidery: toggleIn(s.bundle.embroidery, f) })}>{f.toUpperCase()}</button>)}</div>
            <div className="seg full">
              <button className={s.bundle.colorways === "working" ? "on" : ""} onClick={() => setB({ colorways: "working" })}>Working colors</button>
              <button className={s.bundle.colorways === "all" ? "on" : ""} onClick={() => setB({ colorways: "all" })}>Every colorway</button>
            </div>
          </div>
        </div>
        <div className="hot-log" data-testid="hot-log">
          {!hot.items.length && <span className="faint small">{hot.running ? "Watching… drop a PNG, JPG, WebP or SVG into the folder." : "Not running."}</span>}
          {hot.items.map((it) => (
            <div key={it.name} className="row small" data-status={it.status}>
              <span className={`pill ${it.status === "done" ? "good" : it.status === "failed" ? "warn" : ""}`}>{it.status}</span>
              <span className="grow mono">{it.name}</span>
              <span className="faint">{it.status === "done" ? `${it.files} files · ${((it.ms ?? 0) / 1000).toFixed(1)} s` : it.error ?? ""}</span>
            </div>
          ))}
        </div>
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
          {hot.running ? (
            <><span className="small muted grow mono">{hot.folder?.label}</span><button className="btn" onClick={() => stopHot()}>Stop watching</button></>
          ) : (
            <>
              {desktop && last && <button className="btn" onClick={() => start(true)} title={last}>Resume last folder</button>}
              <button className="btn primary" disabled={!desktop} onClick={() => start(false)}>Choose folder and start</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function HotPill({ onOpen }: { onOpen: () => void }) {
  const running = useHot((s) => s.running);
  const working = useHot((s) => s.items.filter((i) => i.status === "working" || i.status === "waiting").length);
  if (!running) return null;
  return <button className="hot-pill" onClick={onOpen} data-testid="hot-pill"><span className="hot-dot" /> Hot folder{working ? ` · ${working} in progress` : ""}</button>;
}
