import { useMemo, useState } from "react";
import { useStore, uid } from "../state/store";
import type { BomRow, Costing, TechPack } from "../types";
import { costSheet, defaultBom, defaultTechPack, fabricYards, techpackOf } from "../lib/production";
import { IcDownload, IcPlus, IcTrash, IcX } from "./Icons";

const CATS: BomRow["category"][] = ["Fabric", "Trim", "Label", "Thread", "Packaging", "Decoration"];

export function TechPackPanel({ onExport, busy }: { onExport: () => void; busy: boolean }) {
  const d = useStore((s) => s.design);
  const processed = useStore((s) => s.processed);
  const commit = useStore((s) => s.commit);
  const live = useStore((s) => s.live);
  const checkpoint = useStore((s) => s.checkpoint);
  const tp = techpackOf(d);
  const [rev, setRev] = useState("");

  // Text edits apply live; one undo step per field focus.
  const setTP = (p: Partial<TechPack>, history = false, label = "Tech pack") => {
    const fn = (x: typeof d) => ({ ...x, techpack: { ...techpackOf(x), ...p } });
    history ? commit(fn, label) : live(fn);
  };
  const setCost = (p: Partial<Costing>) => setTP({ costing: { ...tp.costing, ...p } });
  const setRow = (id: string, p: Partial<BomRow>) => setTP({ bom: tp.bom.map((b) => (b.id === id ? { ...b, ...p } : b)) });

  const inksBy = useMemo(() => {
    const o: Record<string, { inks: number; stitches?: number }> = {};
    for (const g of d.graphics) o[g.id] = { inks: processed[g.id]?.inks.length ?? g.colors, stitches: processed[g.id]?.stitches };
    return o;
  }, [d.graphics, processed]);
  const cs = costSheet(d, inksBy);
  const yards = fabricYards(d);
  const num = (v: string) => Math.max(0, parseFloat(v) || 0);
  const field = (label: string, key: keyof TechPack, placeholder = "") => (
    <div className="field">
      <span className="label">{label}</span>
      <input id={`tp-${key}`} className="input" value={(tp[key] as string) ?? ""} placeholder={placeholder}
        onFocus={() => checkpoint(`Edit ${label.toLowerCase()}`)} onChange={(e) => setTP({ [key]: e.target.value } as Partial<TechPack>)} />
    </div>
  );
  const note = (label: string, key: "construction" | "care" | "labels" | "packaging") => (
    <div className="field">
      <div className="row between"><span className="label">{label}</span>
        <button className="btn sm ghost" onClick={() => setTP({ [key]: defaultTechPack(d)[key] }, true, `Reset ${label.toLowerCase()}`)}>Reset</button></div>
      <textarea id={`tp-${key}`} className="input" style={{ height: key === "construction" ? 150 : 84, padding: 8, resize: "vertical", lineHeight: 1.45 }}
        value={tp[key]} onFocus={() => checkpoint(`Edit ${label.toLowerCase()}`)} onChange={(e) => setTP({ [key]: e.target.value })} />
    </div>
  );
  const rate = (label: string, key: keyof Costing, prefix = "$", suffix = "") => (
    <label className="field small"><span className="label">{label}</span>
      <div className="row" style={{ gap: 4 }}>
        {prefix && <span className="faint mono">{prefix}</span>}
        <input id={`cost-${key}`} className="input num" style={{ width: "100%" }} value={tp.costing[key]} onFocus={() => checkpoint("Edit costing")} onChange={(e) => setCost({ [key]: num(e.target.value) } as Partial<Costing>)} />
        {suffix && <span className="faint small">{suffix}</span>}
      </div>
    </label>
  );

  return (
    <>
      <div className="section">
        <div className="section-head">
          <span className="section-title">Tech pack</span>
          <button className="btn primary" onClick={onExport} disabled={busy}><IcDownload size={14} /> {busy ? "Building PDF…" : "Export tech pack PDF"}</button>
        </div>
        <span className="faint small">Ten pages: overview, flats, measurement diagram, graded spec, BOM, colorways, artwork, construction, costing, revisions. Everything is pulled from this design.</span>
        <div className="grid2" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          {field("Style number", "styleNumber", "TF-0001")}
          {field("Season", "season", "FW26")}
          {field("Revision", "revision", "A")}
          {field("Brand", "brand")}
          {field("Designer", "designer")}
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <span className="section-title">Bill of materials</span>
          <div className="row">
            <button className="btn sm ghost" onClick={() => setTP({ bom: defaultBom(d) }, true, "Rebuild BOM")}>Rebuild from garment</button>
            <button className="btn sm" onClick={() => setTP({ bom: [...tp.bom, { id: uid(), item: "New item", category: "Trim", supplier: "", article: "", color: "", qty: 1, unit: "pc", unitCost: 0, placement: "" }] }, true, "Add BOM line")}><IcPlus size={13} /> Line</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="spec bom">
            <thead><tr><th>Category</th><th style={{ textAlign: "left" }}>Item</th><th style={{ textAlign: "left" }}>Placement</th><th style={{ textAlign: "left" }}>Supplier</th><th>Qty</th><th>Unit</th><th>Unit $</th><th>Ext.</th><th /></tr></thead>
            <tbody>
              {tp.bom.map((b) => (
                <tr key={b.id}>
                  <td><select className="cell-in" style={{ width: 92 }} value={b.category} onChange={(e) => setRow(b.id, { category: e.target.value as BomRow["category"] })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></td>
                  <td><input className="cell-in" style={{ width: 170, textAlign: "left", fontFamily: "var(--font)" }} value={b.item} onFocus={() => checkpoint("Edit BOM")} onChange={(e) => setRow(b.id, { item: e.target.value })} /></td>
                  <td><input className="cell-in" style={{ width: 130, textAlign: "left", fontFamily: "var(--font)" }} value={b.placement} onFocus={() => checkpoint("Edit BOM")} onChange={(e) => setRow(b.id, { placement: e.target.value })} /></td>
                  <td><input className="cell-in" style={{ width: 96, textAlign: "left", fontFamily: "var(--font)" }} value={b.supplier} onFocus={() => checkpoint("Edit BOM")} onChange={(e) => setRow(b.id, { supplier: e.target.value })} /></td>
                  <td><input className="cell-in grade" value={b.qty} onFocus={() => checkpoint("Edit BOM")} onChange={(e) => setRow(b.id, { qty: num(e.target.value) })} /></td>
                  <td><input className="cell-in grade" style={{ width: 52 }} value={b.unit} onChange={(e) => setRow(b.id, { unit: e.target.value })} /></td>
                  <td><input className="cell-in grade" value={b.unitCost} onFocus={() => checkpoint("Edit BOM")} onChange={(e) => setRow(b.id, { unitCost: num(e.target.value) })} /></td>
                  <td>{b.unitCost ? `$${(b.qty * b.unitCost).toFixed(2)}` : "—"}</td>
                  <td><button className="btn icon sm ghost danger" title="Remove line" onClick={() => setTP({ bom: tp.bom.filter((x) => x.id !== b.id) }, true, "Remove BOM line")}><IcX size={12} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <span className="faint small">Body fabric estimate for size M: <span className="mono">{yards} yd</span> at {tp.costing.fabricWidthIn} in usable width with {tp.costing.wastePct}% waste. Confirm against your marker.</span>
      </div>

      <div className="section">
        <div className="section-head"><span className="section-title">Costing</span><span className="faint small">your shop's rates</span></div>
        <div className="grid2" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          {rate("Labor (CMT)", "laborCMT")}
          {rate("Screen setup", "screenSetup", "$", "/screen")}
          {rate("Print / color", "printPerColor")}
          {rate("Embroidery", "embroideryPer1k", "$", "/1k st")}
          {rate("DTG / print", "dtgPerPrint")}
          {rate("Run quantity", "runQty", "", "pcs")}
          {rate("Margin", "marginPct", "", "%")}
          {rate("Retail ×", "retailMultiple", "", "")}
          {rate("Fabric width", "fabricWidthIn", "", "in")}
          {rate("Waste", "wastePct", "", "%")}
        </div>
        <table className="perf-table">
          <tbody>
            {cs.lines.map((l, i) => <tr key={i}><td>{l.label}<div className="faint small">{l.note}</div></td><td className="v">${l.amount.toFixed(2)}</td></tr>)}
            <tr><td><b>Cost of goods</b></td><td className="v"><b>${cs.cogs.toFixed(2)}</b></td></tr>
            <tr><td>Wholesale at {tp.costing.marginPct}% margin</td><td className="v">${cs.wholesale.toFixed(2)}</td></tr>
            <tr><td>Retail at {tp.costing.retailMultiple}× wholesale</td><td className="v">${cs.retail.toFixed(2)}</td></tr>
          </tbody>
        </table>
        {cs.missing.length > 0 && <div className="notice warn">Add {cs.missing.join(", ")} to complete the costing.</div>}
      </div>

      <div className="section">
        <div className="section-head"><span className="section-title">Construction & finishing</span></div>
        {note("Construction", "construction")}
        {note("Care instructions", "care")}
        {note("Labels", "labels")}
        {note("Folding & packaging", "packaging")}
      </div>

      <div className="section">
        <div className="section-head"><span className="section-title">Revision log</span><span className="faint small">Rev {tp.revision || "A"}</span></div>
        <div className="row">
          <input id="rev-note" className="input" style={{ flex: 1 }} placeholder="What changed? e.g. sleeve length +1/2 in after fit sample" value={rev} onChange={(e) => setRev(e.target.value)} />
          <button className="btn sm primary" disabled={!rev.trim()} onClick={() => {
            const next = String.fromCharCode(Math.min(90, (tp.revision || "A").toUpperCase().charCodeAt(0) + 1));
            setTP({ revision: next, revisions: [...tp.revisions, { id: uid(), at: Date.now(), rev: next, note: rev.trim() }] }, true, "Add revision");
            setRev("");
          }}>Log revision</button>
        </div>
        {[...tp.revisions].reverse().map((r) => (
          <div key={r.id} className="list-item" style={{ cursor: "default" }}>
            <span className="mono" style={{ color: "var(--accent)", fontWeight: 600 }}>{r.rev}</span>
            <span style={{ flex: 1 }}>{r.note}</span>
            <span className="faint small">{new Date(r.at).toLocaleDateString()}</span>
            <button className="btn icon sm ghost danger" title="Delete entry" onClick={() => setTP({ revisions: tp.revisions.filter((x) => x.id !== r.id) }, true, "Delete revision")}><IcTrash size={12} /></button>
          </div>
        ))}
      </div>
    </>
  );
}
