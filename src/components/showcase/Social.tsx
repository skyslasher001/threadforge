import { useStore } from "../../state/store";
import { previewsOf, useShow } from "../../state/showcase";
import type { Design } from "../../types";
import { SOCIAL, socialImage, type SocialFormat } from "../../lib/render";
import { isDark } from "../../data/fabrics";
import { techpackOf } from "../../lib/production";
import { download, slug } from "../../lib/exporting";
import { Toggle } from "../Controls";
import { IcDownload } from "../Icons";
import { Busy, canvasToBlob, useAsync, useDesignSig } from "./common";

export const SOCIAL_BGS: [string, string][] = [
  ["Bone", "#EDE9E1"], ["Paper", "#FFFFFF"], ["Concrete", "#BDBAB3"], ["Ink", "#121214"], ["Midnight", "#1A1838"],
  ["Ember", "#FF6A3D"], ["Acid", "#C6FF3D"], ["Ice", "#CFEFF7"], ["Blush", "#F1D3CF"], ["Forest", "#22362A"],
];

function designFor(d: Design, colorwayId: string | null): Design {
  const cw = colorwayId ? d.colorways.find((c) => c.id === colorwayId) : null;
  return cw ? { ...d, bodyColor: cw.body, trimColor: cw.trim } : d;
}

export async function renderSocial(fmt: SocialFormat) {
  const st = useStore.getState();
  const sh = useShow.getState();
  const d = designFor(st.design, sh.socialColorway);
  const bg = fmt.id === "product" ? "#FFFFFF" : sh.socialBg;
  return socialImage(d, {
    format: fmt, background: bg, dark: isDark(bg), showBack: sh.socialBack,
    brand: d.showcase?.brand || techpackOf(d).brand || "", caption: d.showcase?.caption ?? "",
  }, previewsOf(d, st.processed));
}

export function SocialView() {
  const sig = useDesignSig();
  const sh = useShow();
  const showcase = useStore((s) => s.design.showcase);
  const fmt = SOCIAL.find((f) => f.id === sh.socialFormat) ?? SOCIAL[0];
  const key = [sig, fmt.id, sh.socialBg, sh.socialBack, sh.socialColorway, showcase?.brand, showcase?.caption].join("|");
  const img = useAsync(key, async () => (await renderSocial(fmt)).toDataURL("image/png"), 120);
  return (
    <div className="sc-body">
      <div className="sc-toolbar">
        <div className="seg">
          {SOCIAL.map((f) => (
            <button key={f.id} className={f.id === fmt.id ? "on" : ""} onClick={() => sh.set({ socialFormat: f.id })}>{f.name}</button>
          ))}
        </div>
        <div className="spacer" />
        <span className="mono faint small">{fmt.w} × {fmt.h}</span>
        <button className="btn sm" onClick={() => exportSocial(SOCIAL)}>All 4 sizes</button>
        <button className="btn sm primary" onClick={() => exportSocial([fmt])}><IcDownload size={13} /> Export PNG</button>
      </div>
      <div className="sc-preview">
        {img.value && <img className="sc-frame" src={img.value} alt="Social preview" style={{ aspectRatio: `${fmt.w} / ${fmt.h}` }} data-testid="social-preview" />}
        <Busy on={img.busy && !img.value} />
      </div>
    </div>
  );
}

export function SocialPanel() {
  const d = useStore((s) => s.design);
  const live = useStore((s) => s.live);
  const checkpoint = useStore((s) => s.checkpoint);
  const sh = useShow();
  const sc = d.showcase!;
  const setSc = (p: Partial<typeof sc>) => live((x) => ({ ...x, showcase: { ...x.showcase!, ...p } }));
  return (
    <>
      <div className="section">
        <span className="section-title">Background</span>
        <div className="swatches" style={{ gridTemplateColumns: "repeat(10, 1fr)" }}>
          {SOCIAL_BGS.map(([n, c]) => <button key={c} title={n} className={`swatch${sh.socialBg === c ? " on" : ""}`} style={{ background: c }} onClick={() => sh.set({ socialBg: c })} />)}
        </div>
        <span className="faint small">Store product images always use pure white.</span>
      </div>
      <div className="section">
        <label className="field"><span className="label">Brand line</span>
          <input className="input" placeholder={techpackOf(d).brand || "Your brand"} value={sc.brand} onFocus={() => checkpoint("Edit brand")} onChange={(e) => setSc({ brand: e.target.value })} /></label>
        <label className="field"><span className="label">Caption</span>
          <input className="input" placeholder="e.g. Drop 01 · Friday 6pm" value={sc.caption} onFocus={() => checkpoint("Edit caption")} onChange={(e) => setSc({ caption: e.target.value })} /></label>
        <Toggle on={sh.socialBack} onChange={(v) => sh.set({ socialBack: v })} label="Show front and back" />
      </div>
      <div className="section">
        <span className="section-title">Colorway</span>
        <div className="cw-pick">
          <button className={`cw${sh.socialColorway === null ? " on" : ""}`} onClick={() => sh.set({ socialColorway: null })}>
            <span className="pair"><span style={{ background: d.bodyColor }} /><span style={{ background: d.trimColor }} /></span>Working colors
          </button>
          {d.colorways.map((c) => (
            <button key={c.id} className={`cw${sh.socialColorway === c.id ? " on" : ""}`} onClick={() => sh.set({ socialColorway: c.id })}>
              <span className="pair"><span style={{ background: c.body }} /><span style={{ background: c.trim }} /></span>{c.name}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

export async function exportSocial(formats: SocialFormat[]) {
  const st = useStore.getState();
  try {
    let n = 0;
    for (const f of formats) {
      const c = await renderSocial(f);
      const where = await download(await canvasToBlob(c), `${slug(st.design.name)}-${f.id}-${f.w}x${f.h}.png`);
      if (where) n++;
    }
    if (n) st.toast(n === 1 ? `${formats[0].name} exported (${formats[0].w} × ${formats[0].h})` : `${n} social images exported`, "good");
  } catch (e) {
    st.toast(`Export failed: ${(e as Error).message}`, "warn");
  }
}
