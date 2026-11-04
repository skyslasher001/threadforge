// "Export everything": every deliverable for a design (optionally per colorway) in one ZIP.

import type { Design, ProcessedGraphic, Units } from "../types";
import { previewsOf } from "../state/showcase";
import { brandKit } from "../state/brand";
import { renderPair, socialImage, SOCIAL } from "./render";
import { buildTechPack } from "./techpack";
import { buildLineSheet, processAll } from "./linesheet";
import { specCsv, slug } from "./exporting";
import { digitizeGraphic } from "./imaging";
import { EMB_WRITERS, type EmbFormat } from "./embroidery/formats";
import { filmsPdf } from "./films";
import { labelData, labelsPdf } from "./labels";
import { techpackOf } from "./production";
import { isDark } from "../data/fabrics";
import { brandName } from "../state/brand";
import { matrixCanvas } from "../components/showcase/Colorways";
import { compositePhoto } from "../components/showcase/PhotoMockups";
import type { ZipEntry } from "./zip";

export interface BundleOpts {
  colorways: "all" | "working";
  mockups: boolean;
  social: string[]; // SOCIAL format ids
  socialBg: string;
  matrix: boolean;
  techpack: boolean;
  linesheet: boolean;
  spec: boolean;
  embroidery: EmbFormat[];
  films: boolean;
  labels: boolean;
  photos: boolean;
  project: boolean;
}

export const DEFAULT_BUNDLE: BundleOpts = {
  colorways: "all", mockups: true, social: ["post", "story", "product"], socialBg: "#EDE9E1", matrix: true, techpack: true,
  linesheet: true, spec: true, embroidery: ["dst", "pes"], films: true, labels: true, photos: true, project: true,
};

const blobBytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
const png = (c: HTMLCanvasElement) => new Promise<Uint8Array>((res, rej) => c.toBlob((b) => (b ? blobBytes(b).then(res, rej) : rej(new Error("encode failed"))), "image/png"));
const text = (s: string) => new TextEncoder().encode(s);

/** Count of files a bundle will contain (shown before exporting). */
export function bundlePlan(d: Design, o: BundleOpts): { label: string; count: number }[] {
  const cws = o.colorways === "all" && d.colorways.length ? d.colorways.length : 1;
  const emb = d.graphics.filter((g) => g.visible && g.method === "embroidery").length;
  const scr = d.graphics.filter((g) => g.visible && g.method === "screen").length;
  const photos = d.showcase?.photos.length ?? 0;
  return [
    { label: "Mockups (front + back)", count: o.mockups ? cws : 0 },
    { label: "Social images", count: o.social.length * cws },
    { label: "Colorway matrix", count: o.matrix && d.colorways.length ? 1 : 0 },
    { label: "Tech pack PDF", count: o.techpack ? 1 : 0 },
    { label: "Line sheet PDF", count: o.linesheet ? 1 : 0 },
    { label: "Spec sheet CSV", count: o.spec ? 1 : 0 },
    { label: "Embroidery files", count: emb * o.embroidery.length },
    { label: "Film positives PDF", count: o.films ? scr : 0 },
    { label: "Labels PDF", count: o.labels ? 1 : 0 },
    { label: "Photo mockups", count: o.photos ? photos : 0 },
    { label: "Project file", count: o.project ? 1 : 0 },
  ].filter((x) => x.count > 0);
}

export async function buildBundle(d: Design, processedIn: Record<string, ProcessedGraphic>, units: Units, o: BundleOpts, onStep: (label: string, p: number) => void = () => undefined): Promise<ZipEntry[]> {
  const root = slug(d.name);
  const out: ZipEntry[] = [];
  const add = (path: string, data: Uint8Array) => out.push({ path: `${root}/${path}`, data });
  const processed = await processAll(d, processedIn);
  const pv = previewsOf(d, processed);
  const cws = o.colorways === "all" && d.colorways.length ? d.colorways : [{ id: "working", name: "working", body: d.bodyColor, trim: d.trimColor }];
  const steps = bundlePlan(d, o).reduce((a, s) => a + s.count, 0) || 1;
  let done = 0;
  const step = (label: string) => onStep(label, Math.min(0.99, done++ / steps));

  for (const cw of cws) {
    const v: Design = { ...d, bodyColor: cw.body, trimColor: cw.trim };
    const name = slug(cw.name);
    if (o.mockups) {
      step(`Mockup · ${cw.name}`);
      add(`mockups/${name}-front-back.png`, await png(await renderPair(v, { pxPerInch: 40, background: "#F1F1F3", previews: pv }, 2)));
    }
    for (const id of o.social) {
      const f = SOCIAL.find((x) => x.id === id);
      if (!f) continue;
      step(`${f.name} · ${cw.name}`);
      const bg = f.id === "product" ? "#FFFFFF" : o.socialBg;
      const kit = brandKit();
      add(`social/${name}-${f.id}-${f.w}x${f.h}.png`, await png(await socialImage(v, { format: f, background: bg, dark: isDark(bg), showBack: false, brand: brandName(v), caption: v.showcase?.caption ?? "", logo: kit }, pv)));
    }
  }
  if (o.matrix && d.colorways.length) {
    step("Colorway matrix");
    const c = await matrixCanvas(d, processed, false);
    if (c) add(`mockups/colorway-matrix.png`, await png(c));
  }
  if (o.techpack) {
    step("Tech pack");
    const mock = (await renderPair(d, { pxPerInch: 30, background: "#F1F1F3", previews: pv }, 2)).toDataURL("image/png");
    add(`docs/${root}-techpack.pdf`, await buildTechPack(d, mock, processed, units));
  }
  if (o.linesheet) {
    step("Line sheet");
    add(`docs/${root}-line-sheet.pdf`, await buildLineSheet([{ design: d, processed }], { perPage: 4, showBack: true, prices: true }));
  }
  if (o.spec) {
    step("Spec sheet");
    add(`docs/${root}-spec.csv`, text(specCsv(d, units)));
  }
  for (const g of d.graphics.filter((x) => x.visible)) {
    if (g.method === "embroidery" && o.embroidery.length) {
      step(`Digitizing ${g.name}`);
      const dg = await digitizeGraphic(g);
      for (const f of o.embroidery) add(`production/embroidery/${slug(g.name)}.${f}`, EMB_WRITERS[f](dg.pattern));
      done += o.embroidery.length - 1;
    }
    if (g.method === "screen" && o.films) {
      step(`Films · ${g.name}`);
      add(`production/films/${slug(g.name)}-films.pdf`, await filmsPdf(g, techpackOf(d).styleNumber));
    }
  }
  if (o.labels) {
    step("Labels");
    add(`brand/labels.pdf`, await labelsPdf(labelData(d, brandKit())));
  }
  if (o.photos) for (const p of d.showcase?.photos ?? []) {
    step(`Photo · ${p.name}`);
    add(`photos/${slug(p.name)}.png`, await png(await compositePhoto(d, processed, p)));
  }
  if (o.project) {
    step("Project file");
    add(`${root}.tforge`, text(JSON.stringify({ app: "THREADFORGE", schema: 2, savedAt: new Date().toISOString(), design: d })));
  }
  const listing = out.map((e) => `  ${e.path.slice(root.length + 1)}  (${(e.data.length / 1024).toFixed(0)} KB)`).join("\n");
  add("README.txt", text(`${d.name} — exported by THREADFORGE on ${new Date().toLocaleString()}\n\n${out.length} files:\n${listing}\n\nEmbroidery files are auto-digitized: sew a test before production.\nFilm positives print at 100% (no scaling).\n`));
  onStep("Done", 1);
  return out;
}
