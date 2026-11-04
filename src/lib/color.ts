// Small color toolkit for colorway suggestions and naming.

export function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

const NAMED: [string, string][] = [
  ["Bone", "#E9E4D8"], ["Off white", "#F4F1EA"], ["Optic white", "#FAFAFA"], ["Heather grey", "#B9B9B4"], ["Concrete", "#8E8C87"],
  ["Charcoal", "#3F3F42"], ["Washed black", "#2A2A2D"], ["Jet", "#141416"], ["Navy", "#1F2A44"], ["Slate blue", "#5A6E8C"],
  ["Sky", "#9CC3E0"], ["Cobalt", "#2B4FB8"], ["Forest", "#2E4A36"], ["Olive", "#6B6B3A"], ["Sage", "#A3B09A"], ["Mint", "#BFE3CF"],
  ["Acid lime", "#C6FF3D"], ["Butter", "#F2E3A0"], ["Mustard", "#C9A13B"], ["Rust", "#A8502F"], ["Brick", "#B8322E"],
  ["Cherry", "#8E1B2A"], ["Burgundy", "#5E1E2B"], ["Blush", "#E9C2BE"], ["Hot pink", "#E2457E"], ["Lilac", "#BBA8D8"],
  ["Plum", "#4E2B48"], ["Sand", "#CDB894"], ["Khaki", "#A8996F"], ["Mocha", "#6A4E3D"], ["Espresso", "#3B2A22"], ["Orange", "#E86A2B"],
];

const dist = (a: string, b: string) => {
  const [h1, s1, l1] = hexToHsl(a), [h2, s2, l2] = hexToHsl(b);
  const dh = Math.min(Math.abs(h1 - h2), 360 - Math.abs(h1 - h2)) / 180;
  return dh * dh * Math.min(s1, s2) * 2 + (s1 - s2) ** 2 + (l1 - l2) ** 2 * 2.2;
};

/** Closest everyday garment-color name. */
export function colorName(hex: string): string {
  let best = NAMED[0];
  for (const n of NAMED) if (dist(hex, n[1]) < dist(hex, best[1])) best = n;
  return best[0];
}

/** Four colorway ideas built from a body color: tonal, contrast trim, inverse and a neighbouring hue. */
export function suggestColorways(body: string, trim: string): { name: string; body: string; trim: string }[] {
  const [h, s, l] = hexToHsl(body);
  const out: { name: string; body: string; trim: string }[] = [];
  const tonal = hslToHex(h, s * 0.9, l > 0.5 ? l - 0.22 : l + 0.16);
  out.push({ name: `${colorName(body)} tonal`, body, trim: tonal });
  const comp = hslToHex(h + 180, Math.max(0.35, Math.min(0.7, s + 0.2)), l > 0.5 ? 0.32 : 0.62);
  out.push({ name: `${colorName(body)} / ${colorName(comp)}`, body, trim: comp });
  const inv = l > 0.5 ? "#2A2A2D" : "#E9E4D8";
  out.push({ name: `${colorName(inv)} / ${colorName(trim === body ? inv : trim)}`, body: inv, trim: trim === body ? inv : trim });
  const ana = hslToHex(h + 32, s < 0.12 ? 0.32 : s, l);
  out.push({ name: colorName(ana), body: ana, trim: ana });
  return out;
}
