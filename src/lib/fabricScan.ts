import { loadImage } from "./imaging";

// Fabric Scanner: turn a phone photo of a swatch into a seamless, evenly lit texture tile.

const TILE = 512;

function getPixels(c: HTMLCanvasElement) {
  return c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height);
}

/**
 * 1. Crop the central square (avoids lens falloff and the swatch edge).
 * 2. Flatten lighting by dividing out a heavy blur (removes shadows and hot spots).
 * 3. Make it tile: offset by half and blend the seams with a feathered mask.
 */
export async function scanFabric(src: string, cropPct = 0.72): Promise<{ tile: string; avg: string }> {
  const img = await loadImage(src);
  const side = Math.min(img.naturalWidth, img.naturalHeight) * cropPct;
  const sx = (img.naturalWidth - side) / 2, sy = (img.naturalHeight - side) / 2;

  const base = document.createElement("canvas");
  base.width = base.height = TILE;
  const b = base.getContext("2d", { willReadFrequently: true })!;
  b.drawImage(img, sx, sy, side, side, 0, 0, TILE, TILE);

  // Lighting flatten
  const blur = document.createElement("canvas");
  blur.width = blur.height = TILE;
  const bl = blur.getContext("2d", { willReadFrequently: true })!;
  bl.filter = "blur(48px)";
  // pad with mirrored copies so the blur doesn't darken the edges
  bl.drawImage(base, -TILE, 0); bl.drawImage(base, TILE, 0); bl.drawImage(base, 0, -TILE); bl.drawImage(base, 0, TILE);
  bl.drawImage(base, 0, 0);
  const px = getPixels(base), lo = getPixels(blur);
  let mr = 0, mg = 0, mb = 0;
  const n = TILE * TILE;
  for (let i = 0; i < n; i++) { mr += lo.data[i * 4]; mg += lo.data[i * 4 + 1]; mb += lo.data[i * 4 + 2]; }
  mr /= n; mg /= n; mb /= n;
  for (let i = 0; i < n; i++) {
    px.data[i * 4] = Math.min(255, (px.data[i * 4] / Math.max(8, lo.data[i * 4])) * mr);
    px.data[i * 4 + 1] = Math.min(255, (px.data[i * 4 + 1] / Math.max(8, lo.data[i * 4 + 1])) * mg);
    px.data[i * 4 + 2] = Math.min(255, (px.data[i * 4 + 2] / Math.max(8, lo.data[i * 4 + 2])) * mb);
    px.data[i * 4 + 3] = 255;
  }
  b.putImageData(px, 0, 0);

  // Seamless: shifted copy (seams now in the middle) with the unshifted image feathered over the center.
  const out = document.createElement("canvas");
  out.width = out.height = TILE;
  const o = out.getContext("2d")!;
  const h = TILE / 2;
  o.drawImage(base, h, h, h, h, 0, 0, h, h);
  o.drawImage(base, 0, h, h, h, h, 0, h, h);
  o.drawImage(base, h, 0, h, h, 0, h, h, h);
  o.drawImage(base, 0, 0, h, h, h, h, h, h);
  const mask = document.createElement("canvas");
  mask.width = mask.height = TILE;
  const m = mask.getContext("2d")!;
  const g = m.createRadialGradient(h, h, TILE * 0.18, h, h, TILE * 0.5);
  g.addColorStop(0, "rgba(0,0,0,1)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  m.fillStyle = g;
  m.fillRect(0, 0, TILE, TILE);
  m.globalCompositeOperation = "source-in";
  m.drawImage(base, 0, 0);
  o.drawImage(mask, 0, 0);

  const avg = "#" + [mr, mg, mb].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
  return { tile: out.toDataURL("image/jpeg", 0.9), avg };
}
