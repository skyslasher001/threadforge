import { useState } from "react";
import { useStore, uid } from "../state/store";
import type { CustomFabric } from "../types";
import { scanFabric } from "../lib/fabricScan";
import { readImageFile } from "../lib/imaging";
import { Seg, Slider } from "./Controls";
import { IcImage, IcX } from "./Icons";

/** Photo of a swatch -> seamless texture -> a fabric with real specs, saved into the project. */
export function FabricScanner({ onClose }: { onClose: () => void }) {
  const commit = useStore((s) => s.commit);
  const toast = useStore((s) => s.toast);
  const [src, setSrc] = useState<string | null>(null);
  const [tile, setTile] = useState<string | null>(null);
  const [crop, setCrop] = useState(0.72);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    name: "", construction: "Knit" as CustomFabric["construction"], gsm: 280, stretch: "Medium" as CustomFabric["stretch"],
    cotton: 100, poly: 0, nylon: 0, elastane: 0, tileInches: 3, costPerYard: 0, supplier: "", note: "",
  });
  const total = f.cotton + f.poly + f.nylon + f.elastane;

  const process = async (s: string, c = crop) => {
    setBusy(true);
    try {
      const r = await scanFabric(s, c);
      setTile(r.tile);
    } catch {
      toast("Couldn't read that photo. Try a JPG or PNG.", "warn");
    }
    setBusy(false);
  };

  const pick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const img = await readImageFile(file);
      setSrc(img.src);
      if (!f.name) setF((x) => ({ ...x, name: file.name.replace(/\.[a-z0-9]+$/i, "") }));
      process(img.src);
    };
    input.click();
  };

  const save = () => {
    if (!tile) return;
    const fabric: CustomFabric = {
      id: `custom-${uid()}`,
      name: f.name.trim() || "Scanned fabric",
      construction: f.construction,
      gsm: f.gsm,
      stretch: f.stretch,
      fiber: { cotton: f.cotton, poly: f.poly, nylon: f.nylon, elastane: f.elastane },
      tile,
      tileInches: f.tileInches,
      costPerYard: f.costPerYard,
      supplier: f.supplier.trim(),
      note: f.note.trim(),
    };
    commit((d) => ({ ...d, customFabrics: [...d.customFabrics, fabric], fabricId: fabric.id }), `Add fabric: ${fabric.name}`);
    toast(`${fabric.name} added and applied`, "good");
    onClose();
  };

  const num = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: Math.max(0, parseFloat(v) || 0) }));

  return (
    <div className="scrim" style={{ paddingTop: "6vh" }} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="welcome-card" style={{ width: "min(820px, 94vw)" }} role="dialog" aria-label="Scan fabric">
        <div className="row between">
          <div>
            <h1 style={{ fontSize: 19 }}>Scan a fabric</h1>
            <div className="muted">Photograph a flat swatch in even light. The scanner evens out the lighting and makes it tile seamlessly.</div>
          </div>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close"><IcX /></button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 20, marginTop: 18 }}>
          <div className="field">
            <div style={{
              width: 260, height: 260, borderRadius: 12, border: "1px solid var(--line-2)", overflow: "hidden", display: "grid", placeItems: "center",
              background: tile ? `url(${tile}) 0 0 / ${Math.round(260 / 3)}px` : "var(--raised)",
            }}>
              {!tile && (
                <button className="btn" onClick={pick} disabled={busy}><IcImage size={14} /> Choose swatch photo</button>
              )}
            </div>
            <span className="faint small">{tile ? "Preview repeats the tile 3×3 so you can spot seams." : "JPG or PNG, at least 1000 px."}</span>
            {src && (
              <>
                <span className="label">Crop</span>
                <Slider value={crop} min={0.3} max={1} step={0.02} onChange={setCrop} onCommit={undefined} display={`${Math.round(crop * 100)}%`} />
                <div className="row">
                  <button className="btn sm" onClick={() => process(src, crop)} disabled={busy}>{busy ? "Processing…" : "Re-process"}</button>
                  <button className="btn sm ghost" onClick={pick}>Different photo</button>
                </div>
              </>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="field"><span className="label">Name</span><input id="fab-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Garment-dyed fleece, sage" /></div>
            <div className="grid2">
              <div className="field"><span className="label">Construction</span>
                <Seg full value={f.construction} onChange={(v) => setF({ ...f, construction: v })} options={[{ v: "Knit", l: "Knit" }, { v: "Woven", l: "Woven" }]} /></div>
              <div className="field"><span className="label">Weight (GSM)</span><input id="fab-gsm" className="input num" style={{ width: "100%" }} value={f.gsm} onChange={(e) => num("gsm", e.target.value)} /></div>
            </div>
            <div className="field"><span className="label">Stretch</span>
              <Seg full value={f.stretch} onChange={(v) => setF({ ...f, stretch: v })} options={(["None", "Low", "Medium", "High"] as const).map((v) => ({ v, l: v }))} /></div>
            <div className="field"><span className="label">Fiber content (%) {total !== 100 && <span style={{ color: "var(--warn)" }}>· adds to {total}, should be 100</span>}</span>
              <div className="grid2" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
                {(["cotton", "poly", "nylon", "elastane"] as const).map((k) => (
                  <label key={k} className="field small faint">{k === "poly" ? "polyester" : k}
                    <input id={`fab-${k}`} className="input num" style={{ width: "100%" }} value={f[k]} onChange={(e) => num(k, e.target.value)} /></label>
                ))}
              </div>
            </div>
            <div className="grid2" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              <div className="field"><span className="label">Tile size (in)</span><input id="fab-tile" className="input num" style={{ width: "100%" }} value={f.tileInches} onChange={(e) => num("tileInches", e.target.value)} /></div>
              <div className="field"><span className="label">Cost / yard ($)</span><input id="fab-cost" className="input num" style={{ width: "100%" }} value={f.costPerYard} onChange={(e) => num("costPerYard", e.target.value)} /></div>
              <div className="field"><span className="label">Supplier</span><input id="fab-sup" className="input" value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} /></div>
            </div>
            <div className="field"><span className="label">Notes</span><input id="fab-note" className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Shrinkage, hand feel, MOQ…" /></div>
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 4 }}>
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn primary" onClick={save} disabled={!tile || total !== 100}>Add fabric</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
