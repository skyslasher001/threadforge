import { useState } from "react";
import { uid, useStore, migrate } from "../../state/store";
import { previewsOf, renderSig, useShow } from "../../state/showcase";
import type { Design, ProcessedGraphic } from "../../types";
import { buildLineSheet, processAll, styleFacts, type SheetStyle } from "../../lib/linesheet";
import { renderGarment } from "../../lib/render";
import { techpackOf } from "../../lib/production";
import { openProject, slug } from "../../lib/exporting";
import { openFile, saveFile } from "../../lib/native";
import { Seg, Toggle } from "../Controls";
import { IcDownload, IcX } from "../Icons";
import { Busy, useAsync } from "./common";

const thumbCache = new Map<string, string>();
async function thumb(d: Design, processed: Record<string, ProcessedGraphic>, view: "front" | "back") {
  const key = `${renderSig(d, processed)}|${view}`;
  const hit = thumbCache.get(key);
  if (hit) return hit;
  const c = (await renderGarment(d, { view, pxPerInch: 16, background: null, previews: previewsOf(d, processed), shadow: false })).canvas.toDataURL("image/png");
  if (thumbCache.size > 80) thumbCache.clear();
  thumbCache.set(key, c);
  return c;
}

/** Current design first, then styles added from other project files. */
export function sheetStyles(): SheetStyle[] {
  const st = useStore.getState();
  return [{ design: st.design, processed: st.processed }, ...useShow.getState().sheetStyles];
}

export function LineSheetView() {
  const d = useStore((s) => s.design);
  const processed = useStore((s) => s.processed);
  const sh = useShow();
  const styles: SheetStyle[] = [{ design: d, processed }, ...sh.sheetStyles];
  const key = styles.map((s) => renderSig(s.design, s.processed)).join("#") + sh.sheetBack;
  const imgs = useAsync(key, async () => {
    const out: { front: string; back: string }[] = [];
    for (const s of styles) out.push({ front: await thumb(s.design, s.processed, "front"), back: sh.sheetBack ? await thumb(s.design, s.processed, "back") : "" });
    return out;
  }, 120);
  const tp = techpackOf(d);
  const brand = tp.brand || d.showcase?.brand || "";
  const pages: SheetStyle[][] = [];
  for (let i = 0; i < styles.length; i += sh.sheetPerPage) pages.push(styles.slice(i, i + sh.sheetPerPage));
  const cols = sh.sheetPerPage === 6 ? 3 : 2;
  return (
    <div className="sc-body">
      <div className="sc-toolbar">
        <Seg value={String(sh.sheetPerPage)} options={[{ v: "2", l: "2 per page" }, { v: "4", l: "4 per page" }, { v: "6", l: "6 per page" }]} onChange={(v) => sh.set({ sheetPerPage: +v as 2 | 4 | 6 })} />
        <div className="spacer" />
        <span className="mono faint small">{styles.length} style{styles.length === 1 ? "" : "s"} · {pages.length + 2} pages</span>
        <button className="btn sm primary" onClick={exportLineSheet}><IcDownload size={13} /> Line sheet PDF</button>
      </div>
      <div className="sheet-scroll">
        {pages.map((pg, pi) => (
          <div key={pi} className="sheet-page" data-testid="sheet-page">
            <div className="sheet-head">{brand ? `${brand} — ${tp.season || "Styles"}` : tp.season || "Styles"}</div>
            <div className="sheet-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${sh.sheetPerPage === 2 ? 1 : 2}, 1fr)` }}>
              {pg.map((s, i) => {
                const f = styleFacts(s);
                const im = imgs.value?.[pi * sh.sheetPerPage + i];
                return (
                  <div key={i} className="sheet-card">
                    <div className="sheet-art">
                      {im && <img src={im.front} alt="" className="front" />}
                      {im?.back && <img src={im.back} alt="" className="back" />}
                    </div>
                    <div className="sheet-facts">
                      <div className="row between"><b>{f.name}</b>{sh.sheetPrices && f.wholesale !== null && <b>${f.wholesale.toFixed(2)}</b>}</div>
                      <span>{[f.styleNo && `Style ${f.styleNo}`, f.garment].filter(Boolean).join(" · ")}</span>
                      <span>{f.fabric}</span>
                      <span>Sizes {f.sizes} · {f.decoration}</span>
                      <div className="sheet-sw">{f.colorways.slice(0, 6).map((c) => <i key={c.name + c.body} title={c.name} style={{ background: `linear-gradient(${c.body} 70%, ${c.trim} 70%)` }} />)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="sheet-foot">{pi + 2} / {pages.length + 2}</div>
          </div>
        ))}
        <Busy on={imgs.busy && !imgs.value} />
      </div>
    </div>
  );
}

export function LineSheetPanel() {
  const d = useStore((s) => s.design);
  const sh = useShow();
  const [busy, setBusy] = useState(false);
  const f = styleFacts({ design: d, processed: useStore.getState().processed });
  const add = async () => {
    const file = await openFile([{ name: "THREADFORGE project", extensions: ["tforge", "json"] }], ".tforge,application/json");
    if (!file) return;
    setBusy(true);
    try {
      const design = migrate(await openProject(new TextDecoder().decode(file.bytes)));
      const processed = await processAll(design);
      useShow.getState().set({ sheetStyles: [...useShow.getState().sheetStyles, { id: uid(), design, processed }] });
      useStore.getState().toast(`${design.name} added to the line sheet`, "good");
    } catch (e) {
      useStore.getState().toast((e as Error).message, "warn");
    }
    setBusy(false);
  };
  return (
    <>
      <div className="section">
        <div className="section-head"><span className="section-title">Styles</span>
          <button className="btn sm" onClick={add} disabled={busy}>{busy ? "Adding…" : "Add style file"}</button></div>
        <div className="list-item on"><span className="grow">{d.name}</span><span className="faint small">this design</span></div>
        {sh.sheetStyles.map((s) => (
          <div key={s.id} className="list-item">
            <span className="grow">{s.design.name}</span>
            <button className="btn icon sm ghost danger" title="Remove from line sheet" onClick={() => sh.set({ sheetStyles: sh.sheetStyles.filter((x) => x.id !== s.id) })}><IcX size={12} /></button>
          </div>
        ))}
        <span className="faint small">Add other saved designs (.tforge) to build a full collection. They stay in this session only.</span>
      </div>
      <div className="section">
        <Toggle on={sh.sheetBack} onChange={(v) => sh.set({ sheetBack: v })} label="Show back view" />
        <Toggle on={sh.sheetPrices} onChange={(v) => sh.set({ sheetPrices: v })} label="Wholesale + MSRP" />
        {sh.sheetPrices && f.wholesale === null && <div className="notice warn">Prices show once costing is complete in Tech Pack (rates for fabric, labor and decoration).</div>}
        <span className="faint small">Cover, style pages and a buyer order form with every colorway × size. Brand and season come from the Tech Pack.</span>
      </div>
    </>
  );
}

export async function exportLineSheet() {
  const st = useStore.getState();
  const sh = useShow.getState();
  try {
    const bytes = await buildLineSheet(sheetStyles(), { perPage: sh.sheetPerPage, showBack: sh.sheetBack, prices: sh.sheetPrices });
    const where = await saveFile(bytes, `${slug(techpackOf(st.design).brand || st.design.name)}-line-sheet.pdf`, [{ name: "PDF", extensions: ["pdf"] }]);
    if (where) st.toast("Line sheet PDF exported", "good");
  } catch (e) {
    st.toast(`Line sheet failed: ${(e as Error).message}`, "warn");
  }
}
