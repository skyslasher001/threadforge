import type { Design, Graphic, View } from "../types";
import { buildGarment } from "../data/garments";
import { gradedSpec } from "../data/measurements";
import { isDark } from "../data/fabrics";
import { uid, useStore } from "../state/store";
import { readImageFile } from "./imaging";

export function geomFor(d: Design, view: View) {
  return buildGarment(d.template, view, gradedSpec(d.base, d.grade, d.previewSize), d.parts);
}

/** Fit an image into a print zone and return a new Graphic. */
export function makeGraphic(
  d: Design,
  view: View,
  img: { src: string; w: number; h: number },
  name: string,
  at?: { x: number; y: number },
  zoneId?: string,
): Graphic {
  const zones = geomFor(d, view).zones;
  const zone = zones.find((z) => z.id === zoneId) ?? zones.find((z) => z.id === (view === "front" ? "center-chest" : "full-back")) ?? zones[0];
  const aspect = img.h / img.w;
  let w = zone.w;
  if (w * aspect > zone.h) w = zone.h / aspect;
  if (zone.id === "center-chest") w = Math.min(zone.w, Math.max(w, 8));
  w = Math.min(w, zone.w);
  const y = at ? at.y : zone.y - zone.h / 2 + (w * aspect) / 2;
  return {
    id: uid(),
    view,
    name: name.replace(/\.[a-z0-9]+$/i, "") || "Graphic",
    src: img.src,
    natW: img.w,
    natH: img.h,
    x: at ? at.x : zone.x,
    y,
    w: +w.toFixed(2),
    rotation: 0,
    method: "screen",
    colors: 4,
    underbase: isDark(d.bodyColor),
    visible: true,
  };
}

export async function addImageFiles(files: File[] | FileList, view?: View, at?: { x: number; y: number }) {
  const st = useStore.getState();
  const list = Array.from(files).filter((f) => /^image\//.test(f.type));
  if (!list.length) {
    st.toast("Drop a PNG, JPG, WEBP or SVG image.", "warn");
    return;
  }
  for (const file of list) {
    try {
      const img = await readImageFile(file);
      const v = view ?? st.activeView;
      const g = makeGraphic(useStore.getState().design, v, img, file.name, at);
      useStore.getState().commit((d) => ({ ...d, graphics: [...d.graphics, g] }));
      useStore.getState().set({ selected: g.id, tool: "select", activeView: v });
      if (Math.max(img.w, img.h) < 1200) useStore.getState().toast(`${file.name} is ${img.w}px wide — fine for small placements, soft at full size.`, "warn");
      else useStore.getState().toast(`Placed ${file.name} on the ${v}`, "good");
    } catch (e) {
      useStore.getState().toast((e as Error).message, "warn");
    }
  }
}

export function pickImages(view?: View) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp,image/svg+xml,image/gif";
  input.multiple = true;
  input.onchange = () => input.files && addImageFiles(input.files, view);
  input.click();
}
