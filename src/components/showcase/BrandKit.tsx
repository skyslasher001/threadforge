import { uid, useStore } from "../../state/store";
import { FONTS, fontOf, logoOn, useBrand, type BrandKit as Kit, type FontId } from "../../state/brand";
import { drawLabel, labelData, labelsPdf, LABELS, type LabelKind } from "../../lib/labels";
import { loadImage, removeBackground } from "../../lib/imaging";
import { openFile, saveFile } from "../../lib/native";
import { slug } from "../../lib/exporting";
import { colorName } from "../../lib/color";
import { isDark } from "../../data/fabrics";
import { ColorChip } from "../Controls";
import { IcDownload, IcImage, IcTrash, IcX } from "../Icons";
import { useAsync } from "./common";

/** Trim transparent edges and cap the size so the kit stays light. */
async function prepareLogo(src: string, knockOut: boolean): Promise<{ src: string; w: number; h: number; lum: number }> {
  const img = await loadImage(knockOut ? await removeBackground(src) : src);
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1, lum = 0, n = 0;
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (d[i + 3] > 12) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (d[i + 3] > 200) { lum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255; n++; }
      }
    }
  if (x1 < 0) throw new Error("The logo is empty after removing the background");
  const w = x1 - x0 + 1, h = y1 - y0 + 1, s = Math.min(1, 1200 / Math.max(w, h));
  const o = document.createElement("canvas");
  o.width = Math.round(w * s); o.height = Math.round(h * s);
  o.getContext("2d")!.drawImage(c, x0, y0, w, h, 0, 0, o.width, o.height);
  return { src: o.toDataURL("image/png"), w: o.width, h: o.height, lum: n ? lum / n : 0 };
}

export async function importLogo(knockOut = true) {
  const f = await openFile([{ name: "Logo", extensions: ["png", "jpg", "jpeg", "webp", "svg"] }], "image/*");
  if (!f) return;
  const ext = f.name.toLowerCase().split(".").pop();
  const type = ext === "svg" ? "image/svg+xml" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  const url = URL.createObjectURL(new Blob([f.bytes as BlobPart], { type }));
  try {
    const l = await prepareLogo(url, knockOut && type !== "image/svg+xml");
    useBrand.getState().set({ logo: l.src, logoW: l.w, logoH: l.h, logoLum: l.lum });
    useStore.getState().toast("Logo added to your Brand Kit", "good");
  } catch (e) {
    useStore.getState().toast((e as Error).message || "Couldn't read that logo", "warn");
  } finally {
    URL.revokeObjectURL(url);
  }
}

const KINDS: LabelKind[] = ["neck", "care", "tagFront", "tagBack"];

export function BrandView() {
  const kit = useBrand((s) => s.kit);
  const d = useStore((s) => s.design);
  const head = fontOf(kit.headingFont), body = fontOf(kit.bodyFont);
  const key = JSON.stringify([kit, d.name, d.previewSize, d.fabricId, d.bodyColor, d.trimColor, d.colorways, d.techpack?.costing]);
  const labels = useAsync(key, async () => {
    const L = labelData(d, kit);
    const out: Record<string, string> = {};
    for (const k of KINDS) out[k] = (await drawLabel(k, L, 150)).toDataURL("image/png");
    return out;
  }, 150);
  const primary = kit.colors[0]?.hex ?? "#141418";
  const heroLogo = useAsync(`${kit.updatedAt}|${primary}`, () => logoOn(primary, kit), 0);
  return (
    <div className="sc-body">
      <div className="sc-toolbar">
        <span className="muted small">Your Brand Kit is shared by every project: social images, line sheets, Present, tech packs and labels use it.</span>
        <div className="spacer" />
        <button className="btn sm primary" onClick={exportLabels}><IcDownload size={13} /> Labels PDF</button>
      </div>
      <div className="brand-board" data-testid="brand-board">
        <div className="brand-hero" style={{ background: primary, color: isDark(primary) ? "#F4F1EA" : "#141418" }}>
          {kit.logo ? (heroLogo.value ? <img src={heroLogo.value} alt="Logo" className="brand-logo" data-testid="brand-logo" /> : <span className="spinner" />) : <button className="brand-drop" onClick={() => importLogo()}><IcImage size={22} /> Add your logo</button>}
          <div>
            <div className="brand-name" style={{ fontFamily: head.css, fontWeight: head.weight }}>{kit.name || "Your brand"}</div>
            <div className="brand-tag" style={{ fontFamily: body.css }}>{kit.tagline || "Add a tagline in the panel"}</div>
            {kit.website && <div className="brand-web mono">{kit.website}</div>}
          </div>
        </div>
        <div className="brand-palette">
          {kit.colors.map((c, i) => (
            <div key={i} className="brand-sw" style={{ background: c.hex, color: isDark(c.hex) ? "#F4F1EA" : "#141418" }}>
              <b>{c.name}</b><span className="mono">{c.hex}</span>{i === 0 && <i>Primary</i>}
            </div>
          ))}
        </div>
        <div className="brand-type">
          <div><span className="faint small">Headings · {head.name}</span><div style={{ fontFamily: head.css, fontWeight: head.weight, fontSize: 34, lineHeight: 1.05 }}>DROP 01 — {kit.name || "BRAND"}</div></div>
          <div><span className="faint small">Body · {body.name}</span><div style={{ fontFamily: body.css, fontSize: 15, lineHeight: 1.5, maxWidth: 520 }}>Heavyweight fleece, garment dyed and cut boxy. Embroidered chest badge, ribbed cuffs and hem.</div></div>
        </div>
        <div className="brand-labels">
          {KINDS.map((k) => (
            <figure key={k} style={{ width: LABELS[k].w * 74 }}>
              {labels.value ? <img src={labels.value[k]} alt={LABELS[k].name} data-testid={`label-${k}`} style={{ width: LABELS[k].w * 74, height: LABELS[k].h * 74 }} /> : <div className="spinner" />}
              <figcaption className="faint small">{LABELS[k].name}<br />{LABELS[k].w} × {LABELS[k].h} in</figcaption>
            </figure>
          ))}
        </div>
      </div>
    </div>
  );
}

export function BrandPanel() {
  const kit = useBrand((s) => s.kit);
  const set = useBrand((s) => s.set);
  const d = useStore((s) => s.design);
  const field = (label: string, k: keyof Kit, placeholder: string) => (
    <label className="field"><span className="label">{label}</span>
      <input className="input" value={String(kit[k] ?? "")} placeholder={placeholder} onChange={(e) => set({ [k]: e.target.value } as Partial<Kit>)} /></label>
  );
  const updColor = (i: number, p: Partial<Kit["colors"][number]>) => set({ colors: kit.colors.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  const fromDesign = () => {
    const have = new Set(kit.colors.map((c) => c.hex.toUpperCase()));
    const add = [d.bodyColor, d.trimColor, ...d.colorways.flatMap((c) => [c.body, c.trim])]
      .map((h) => h.toUpperCase()).filter((h, i, a) => a.indexOf(h) === i && !have.has(h)).slice(0, 10 - kit.colors.length);
    set({ colors: [...kit.colors, ...add.map((hex) => ({ name: colorName(hex), hex }))] });
  };
  return (
    <>
      <div className="section">
        <span className="section-title">Identity</span>
        {field("Brand name", "name", "e.g. Ember Wolf")}
        {field("Tagline", "tagline", "One line for tags and covers")}
        {field("Website or handle", "website", "@yourbrand")}
        <div className="row" style={{ gap: 6 }}>
          <button className="btn sm" onClick={() => importLogo(true)}>{kit.logo ? "Replace logo" : "Add logo"}</button>
          <button className="btn sm ghost" onClick={() => importLogo(false)} title="Keep the logo's own background">Add as-is</button>
          {kit.logo && <button className="btn sm ghost danger" onClick={() => set({ logo: null, logoW: 0, logoH: 0 })}><IcTrash size={12} /></button>}
        </div>
        <span className="faint small">PNG, JPG or SVG. A flat background is removed automatically; labels print the logo in one color.</span>
      </div>
      <div className="section">
        <div className="section-head"><span className="section-title">Palette</span>
          <button className="btn sm ghost" onClick={fromDesign} disabled={kit.colors.length >= 10}>From this design</button></div>
        {kit.colors.map((c, i) => (
          <div key={i} className="row" style={{ gap: 6 }}>
            <ColorChip value={c.hex} onChange={(v) => updColor(i, { hex: v })} />
            <input className="input" style={{ flex: 1, minWidth: 0 }} value={c.name} onChange={(e) => updColor(i, { name: e.target.value })} />
            {i > 0 && <button className="btn sm ghost" title="Make primary" onClick={() => set({ colors: [c, ...kit.colors.filter((_, j) => j !== i)] })}>★</button>}
            <button className="btn icon sm ghost danger" title="Remove" onClick={() => set({ colors: kit.colors.filter((_, j) => j !== i) })}><IcX size={12} /></button>
          </div>
        ))}
        {kit.colors.length < 10 && <button className="btn sm" onClick={() => set({ colors: [...kit.colors, { name: "New color", hex: "#7C5CFF" }] })}>Add color</button>}
        <button className="btn sm ghost" data-testid="palette-colorways" onClick={() => paletteToColorways()}>Add palette as colorways</button>
      </div>
      <div className="section">
        <span className="section-title">Type</span>
        {(["headingFont", "bodyFont"] as const).map((k) => (
          <label key={k} className="field"><span className="label">{k === "headingFont" ? "Headings" : "Body"}</span>
            <select className="input" value={kit[k]} onChange={(e) => set({ [k]: e.target.value as FontId })}>
              {FONTS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select></label>
        ))}
      </div>
      <div className="section">
        <span className="section-title">Labels</span>
        <div className="row" style={{ gap: 6 }}>
          <span className="small muted" style={{ flex: 1 }}>Woven label ground / ink</span>
          <ColorChip value={kit.labelBg} onChange={(v) => set({ labelBg: v })} />
          <ColorChip value={kit.labelInk} onChange={(v) => set({ labelInk: v })} />
        </div>
        {field("Made in", "madeIn", "e.g. USA")}
        {field("RN / CA number", "rn", "For US care labels")}
      </div>
    </>
  );
}

export function paletteToColorways() {
  const st = useStore.getState();
  const kit = useBrand.getState().kit;
  const have = new Set(st.design.colorways.map((c) => c.body.toUpperCase() + c.trim.toUpperCase()));
  const add = kit.colors.filter((c) => !have.has(c.hex.toUpperCase() + c.hex.toUpperCase())).map((c) => ({ id: uid(), name: c.name, body: c.hex.toUpperCase(), trim: c.hex.toUpperCase() }));
  if (!add.length) return st.toast("Every palette color is already a colorway", "warn");
  st.commit((x) => ({ ...x, colorways: [...x.colorways, ...add] }), "Colorways from Brand Kit");
  st.toast(`${add.length} colorways added from your palette`, "good");
}

export async function exportLabels() {
  const st = useStore.getState();
  const kit = useBrand.getState().kit;
  try {
    const bytes = await labelsPdf(labelData(st.design, kit));
    const where = await saveFile(bytes, `${slug(kit.name || st.design.name)}-labels.pdf`, [{ name: "PDF", extensions: ["pdf"] }]);
    if (where) st.toast("Labels PDF exported (actual size)", "good");
  } catch (e) {
    st.toast(`Labels failed: ${(e as Error).message}`, "warn");
  }
}
