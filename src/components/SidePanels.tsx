import { useState } from "react";
import { useStore, uid } from "../state/store";
import type { BlendMode, Layer, View } from "../types";
import { Seg, Slider } from "./Controls";
import { IcEye, IcEyeOff, IcLayers, IcPlus, IcTrash } from "./Icons";

const BLENDS: BlendMode[] = ["normal", "multiply", "screen", "overlay"];

function LockIcon({ on }: { on: boolean }) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d={on ? "M8 11V8a4 4 0 018 0v3" : "M8 11V8a4 4 0 017.5-2"} />
    </svg>
  );
}

export function LayersPanel() {
  const d = useStore((s) => s.design);
  const view = useStore((s) => s.activeView);
  const activeLayer = useStore((s) => s.activeLayer);
  const selected = useStore((s) => s.selected);
  const commit = useStore((s) => s.commit);
  const live = useStore((s) => s.live);
  const checkpoint = useStore((s) => s.checkpoint);
  const set = useStore((s) => s.set);
  const update = useStore((s) => s.updateGraphic);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const layers = d.layers.filter((l) => l.view === view);
  const shown = [...layers].reverse(); // top of stack first
  const active = layers.find((l) => l.id === activeLayer[view]) ?? layers[layers.length - 1];
  const counts = new Map<string, number>();
  d.strokes.forEach((s) => counts.set(s.layerId, (counts.get(s.layerId) ?? 0) + 1));

  const patch = (id: string, p: Partial<Layer>, label = "Layer") => commit((x) => ({ ...x, layers: x.layers.map((l) => (l.id === id ? { ...l, ...p } : l)) }), label);
  const setActive = (id: string) => set({ activeLayer: { ...useStore.getState().activeLayer, [view]: id } });

  const addLayer = () => {
    const id = `${view}-${uid()}`;
    const n = layers.length + 1;
    commit((x) => {
      const idx = x.layers.findIndex((l) => l.id === active?.id);
      const next = [...x.layers];
      next.splice(idx + 1, 0, { id, view, name: `Layer ${n}`, visible: true, locked: false, opacity: 1, blend: "normal" });
      return { ...x, layers: next };
    }, "Add layer");
    setActive(id);
  };

  const removeLayer = (l: Layer) => {
    if (layers.length <= 1) return;
    commit((x) => ({ ...x, layers: x.layers.filter((k) => k.id !== l.id), strokes: x.strokes.filter((s) => s.layerId !== l.id) }), `Delete layer: ${l.name}`);
    const rest = layers.filter((k) => k.id !== l.id);
    setActive(rest[rest.length - 1].id);
  };

  const duplicate = (l: Layer) => {
    const id = `${view}-${uid()}`;
    commit((x) => {
      const idx = x.layers.findIndex((k) => k.id === l.id);
      const next = [...x.layers];
      next.splice(idx + 1, 0, { ...l, id, name: `${l.name} copy` });
      const copies = x.strokes.filter((s) => s.layerId === l.id).map((s) => ({ ...s, id: uid(), layerId: id }));
      return { ...x, layers: next, strokes: [...x.strokes, ...copies] };
    }, "Duplicate layer");
    setActive(id);
  };

  const mergeDown = (l: Layer) => {
    const idx = layers.findIndex((k) => k.id === l.id);
    if (idx <= 0) return;
    const below = layers[idx - 1];
    commit((x) => ({ ...x, layers: x.layers.filter((k) => k.id !== l.id), strokes: x.strokes.map((s) => (s.layerId === l.id ? { ...s, layerId: below.id } : s)) }), "Merge down");
    setActive(below.id);
  };

  const reorder = (from: string, to: string) => {
    if (from === to) return;
    commit((x) => {
      const others = x.layers.filter((l) => l.view !== view);
      const mine = x.layers.filter((l) => l.view === view);
      const a = mine.findIndex((l) => l.id === from), b = mine.findIndex((l) => l.id === to);
      const [m] = mine.splice(a, 1);
      mine.splice(b, 0, m);
      return { ...x, layers: [...others, ...mine] };
    }, "Reorder layers");
  };

  const graphics = d.graphics.filter((g) => g.view === view);

  return (
    <>
      <div className="section">
        <div className="section-head">
          <span className="section-title">Layers</span>
          <Seg value={view} onChange={(v: View) => set({ activeView: v })} options={[{ v: "front", l: "Front" }, { v: "back", l: "Back" }]} />
        </div>
        <div className="layer-list" role="list">
          {shown.map((l) => (
            <div key={l.id} role="listitem" draggable
              className={`layer-row${l.id === active?.id ? " on" : ""}${overId === l.id && dragId !== l.id ? " over" : ""}`}
              onClick={() => setActive(l.id)}
              onDragStart={(e) => { setDragId(l.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", l.id); }}
              onDragOver={(e) => { e.preventDefault(); setOverId(l.id); }}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              onDrop={(e) => { e.preventDefault(); if (dragId) reorder(dragId, l.id); setDragId(null); setOverId(null); }}>
              <button className="btn icon sm ghost" title={l.visible ? "Hide layer" : "Show layer"} onClick={(e) => { e.stopPropagation(); patch(l.id, { visible: !l.visible }, l.visible ? "Hide layer" : "Show layer"); }}>
                {l.visible ? <IcEye size={14} /> : <IcEyeOff size={14} />}
              </button>
              <div className="layer-swatch" style={{ opacity: l.visible ? 1 : 0.4 }}><IcLayers size={13} /></div>
              {renaming === l.id ? (
                <input autoFocus className="input" style={{ flex: 1, height: 24 }} defaultValue={l.name}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => { patch(l.id, { name: e.target.value.trim() || l.name }, "Rename layer"); setRenaming(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur(); }} />
              ) : (
                <span className="layer-name" onDoubleClick={() => setRenaming(l.id)} title="Double-click to rename">{l.name}</span>
              )}
              <span className="mono faint small">{counts.get(l.id) ?? 0}</span>
              <button className={`btn icon sm ghost${l.locked ? " locked" : ""}`} title={l.locked ? "Unlock layer" : "Lock layer"} onClick={(e) => { e.stopPropagation(); patch(l.id, { locked: !l.locked }, l.locked ? "Unlock layer" : "Lock layer"); }}>
                <LockIcon on={l.locked} />
              </button>
            </div>
          ))}
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          <button className="btn sm" onClick={addLayer}><IcPlus size={13} /> New layer</button>
          {active && <button className="btn sm" onClick={() => duplicate(active)}>Duplicate</button>}
          {active && <button className="btn sm" disabled={layers.indexOf(active) === 0} onClick={() => mergeDown(active)}>Merge down</button>}
          {active && <button className="btn sm danger" disabled={layers.length <= 1} onClick={() => removeLayer(active)}><IcTrash size={13} /></button>}
        </div>
        {active && (
          <>
            <div className="field"><span className="label">Opacity · {active.name}</span>
              <Slider value={active.opacity} min={0} max={1} step={0.01} onCommit={() => checkpoint("Layer opacity")}
                onChange={(v) => live((x) => ({ ...x, layers: x.layers.map((l) => (l.id === active.id ? { ...l, opacity: v } : l)) }))}
                display={`${Math.round(active.opacity * 100)}%`} /></div>
            <div className="field"><span className="label">Blend</span>
              <Seg full value={active.blend} onChange={(b) => patch(active.id, { blend: b }, "Blend mode")} options={BLENDS.map((b) => ({ v: b, l: b[0].toUpperCase() + b.slice(1) }))} /></div>
          </>
        )}
        <span className="faint small">Drag rows to reorder. Blend modes mix drawing layers with each other.</span>
      </div>

      <div className="section">
        <div className="section-head"><span className="section-title">Artwork on the {view}</span><span className="faint small">{graphics.length}</span></div>
        {!graphics.length && <span className="faint small">No artwork on this side yet.</span>}
        {graphics.map((g) => (
          <div key={g.id} className={`list-item${selected === g.id ? " on" : ""}`} onClick={() => set({ selected: g.id, tool: "select" })}>
            <button className="btn icon sm ghost" onClick={(e) => { e.stopPropagation(); update(g.id, { visible: !g.visible }); }}>{g.visible ? <IcEye size={14} /> : <IcEyeOff size={14} />}</button>
            <div className="thumb" style={{ width: 28, height: 28 }}><img src={g.src} alt="" /></div>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</span>
            <span className="faint small">{g.method === "screen" ? "Screen" : g.method === "embroidery" ? "Embroidery" : "DTG"}</span>
          </div>
        ))}
        <div className="list-item" style={{ cursor: "default" }}>
          <span className="btn icon sm ghost" style={{ pointerEvents: "none" }}><LockIcon on /></span>
          <span className="muted" style={{ flex: 1 }}>Garment base</span>
          <span className="faint small">fabric + shading</span>
        </div>
      </div>
    </>
  );
}

export function HistoryPanel() {
  const past = useStore((s) => s.past);
  const future = useStore((s) => s.future);
  const design = useStore((s) => s.design);
  const snapshots = useStore((s) => s.snapshots);
  const jumpTo = useStore((s) => s.jumpTo);
  const commit = useStore((s) => s.commit);
  const set = useStore((s) => s.set);
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState("");

  // timeline item i = state i; labels describe the action that produced it
  const items = [
    { label: "Opened", i: 0 },
    ...past.map((e, i) => ({ label: e.label, i: i + 1 })),
    ...future.map((e, i) => ({ label: e.label, i: past.length + 1 + i })),
  ];
  const current = past.length;
  const total = items.length - 1;

  return (
    <>
      <div className="section">
        <div className="section-head"><span className="section-title">History</span><span className="faint small mono">{current}/{total}</span></div>
        <Slider value={current} min={0} max={Math.max(1, total)} step={1} onChange={(v) => jumpTo(Math.round(v))} display={`${current}`} />
        <div className="history-list">
          {[...items].reverse().map((it) => (
            <button key={it.i} className={`history-item${it.i === current ? " on" : ""}${it.i > current ? " future" : ""}`} onClick={() => jumpTo(it.i)}>
              <span className="dot" />
              <span>{it.label}</span>
              <span className="mono faint small" style={{ marginLeft: "auto" }}>{it.i}</span>
            </button>
          ))}
        </div>
        <span className="faint small">Click a step or drag the slider to scrub. Making a change after stepping back discards the greyed-out steps.</span>
      </div>

      <div className="section">
        <div className="section-head"><span className="section-title">Snapshots</span><span className="faint small">{snapshots.length}</span></div>
        <div className="row">
          <input id="snap-name" className="input" style={{ flex: 1 }} placeholder="e.g. v2 cropped sleeve" value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.nextSibling as HTMLButtonElement)?.click()} />
          <button className="btn sm primary" onClick={() => {
            const n = name.trim() || `Snapshot ${snapshots.length + 1}`;
            set({ snapshots: [{ id: uid(), name: n, at: Date.now(), d: design }, ...snapshots] });
            setName("");
            toast(`Saved snapshot “${n}”`, "good");
          }}>Save</button>
        </div>
        {!snapshots.length && <span className="faint small">Name a version to branch from it later. Restoring is undoable.</span>}
        {snapshots.map((s) => (
          <div key={s.id} className="list-item" style={{ cursor: "default" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 12 }}>{s.name}</div>
              <div className="faint small">{new Date(s.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · {s.d.strokes.length} strokes · {s.d.graphics.length} graphics</div>
            </div>
            <button className="btn sm" onClick={() => { commit(() => s.d, `Restore: ${s.name}`); toast(`Restored “${s.name}”`, "good"); }}>Restore</button>
            <button className="btn icon sm ghost danger" title="Delete snapshot" onClick={() => set({ snapshots: snapshots.filter((x) => x.id !== s.id) })}><IcTrash size={13} /></button>
          </div>
        ))}
      </div>
    </>
  );
}
