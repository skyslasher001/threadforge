import { memo, type ReactElement } from "react";
import type { BrushStyle, Pt, Stroke } from "../types";

export const BRUSH_STYLES: { id: BrushStyle; pack: string; name: string; hint: string; defaults: { size: number; opacity: number } }[] = [
  { id: "technical", pack: "Technical Flat", name: "Tech pen", hint: "Uniform line for factory flats", defaults: { size: 0.08, opacity: 1 } },
  { id: "ink", pack: "Ink & Wash", name: "Brush pen", hint: "Pressure-tapered ink line", defaults: { size: 0.3, opacity: 1 } },
  { id: "marker", pack: "Fashion Croquis", name: "Alcohol marker", hint: "Translucent, layers darker", defaults: { size: 0.45, opacity: 0.85 } },
  { id: "pencil", pack: "Pencil & Charcoal", name: "Graphite 4B", hint: "Grainy sketch line", defaults: { size: 0.12, opacity: 0.9 } },
  { id: "charcoal", pack: "Pencil & Charcoal", name: "Charcoal", hint: "Coarse, smudgy tone", defaults: { size: 0.3, opacity: 0.9 } },
  { id: "watercolor", pack: "Watercolor / Gouache", name: "Watercolor", hint: "Soft wash with a pooled wet edge", defaults: { size: 0.45, opacity: 0.9 } },
  { id: "spray", pack: "Graffiti & Street", name: "Spray can", hint: "Scatter with soft edges", defaults: { size: 0.6, opacity: 0.9 } },
  { id: "airbrush", pack: "Airbrush & Chrome", name: "Soft airbrush", hint: "Feathered gradient strokes", defaults: { size: 1.1, opacity: 0.45 } },
  { id: "chrome", pack: "Airbrush & Chrome", name: "Chrome", hint: "Y2K metallic gradient with a highlight", defaults: { size: 0.4, opacity: 1 } },
  { id: "halftone", pack: "Risograph & Halftone", name: "Halftone", hint: "Print dot screen at real size", defaults: { size: 0.6, opacity: 1 } },
  { id: "riso", pack: "Risograph & Halftone", name: "Riso", hint: "Coarse dots with misregistration", defaults: { size: 0.6, opacity: 0.95 } },
  { id: "neon", pack: "Neon & Glitch", name: "Neon tube", hint: "Glowing light line", defaults: { size: 0.22, opacity: 1 } },
];

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const n3 = (v: number) => Math.round(v * 1000) / 1000;

export function polyline(points: Pt[]): string {
  if (!points.length) return "";
  if (points.length === 1) return `M ${n3(points[0].x)} ${n3(points[0].y)} l 0.001 0`;
  let d = `M ${n3(points[0].x)} ${n3(points[0].y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    d += ` Q ${n3(a.x)} ${n3(a.y)} ${n3((a.x + b.x) / 2)} ${n3((a.y + b.y) / 2)}`;
  }
  const last = points[points.length - 1];
  d += ` L ${n3(last.x)} ${n3(last.y)}`;
  return d;
}

/** Filled outline whose width follows pen pressure (tapered ends). */
function taperedOutline(points: Pt[], size: number): string {
  if (points.length < 2) {
    const p = points[0];
    const r = size * 0.5 * (0.3 + 0.9 * (p?.p ?? 0.5));
    return p ? `M ${p.x - r} ${p.y} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0` : "";
  }
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
    let dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const taper = Math.min(1, i / 4, (n - 1 - i) / 6) * 0.7 + 0.3;
    const w = size * 0.5 * (0.25 + 0.95 * points[i].p) * taper;
    left.push([points[i].x - dy * w, points[i].y + dx * w]);
    right.push([points[i].x + dy * w, points[i].y - dx * w]);
  }
  const all = [...left, ...right.reverse()];
  return "M " + all.map(([x, y]) => `${n3(x)} ${n3(y)}`).join(" L ") + " Z";
}

export const StrokeView = memo(function StrokeView({ s }: { s: Stroke }) {
  const d = s.style === "ink" || s.style === "spray" ? "" : polyline(s.points);
  switch (s.style) {
    case "technical":
      return <path d={d} fill="none" stroke={s.color} strokeWidth={s.size} strokeLinecap="round" strokeLinejoin="round" opacity={s.opacity} />;
    case "marker":
      return (
        <path d={d} fill="none" stroke={s.color} strokeWidth={s.size * 1.4} strokeLinecap="square" strokeLinejoin="round"
          opacity={s.opacity * 0.55} style={{ mixBlendMode: "multiply" }} />
      );
    case "ink":
      return <path d={taperedOutline(s.points, s.size)} fill={s.color} opacity={s.opacity} />;
    case "pencil":
      return (
        <path d={d} fill="none" stroke={s.color} strokeWidth={s.size * 0.7} strokeLinecap="round" strokeLinejoin="round"
          opacity={s.opacity * 0.85} filter="url(#tf-pencil)" />
      );
    case "airbrush":
      return <path d={d} fill="none" stroke={s.color} strokeWidth={s.size * 1.6} strokeLinecap="round" strokeLinejoin="round" opacity={s.opacity * 0.5} filter="url(#tf-air)" />;
    case "neon":
      return (
        <g>
          <path d={d} fill="none" stroke={s.color} strokeWidth={s.size * 3.2} strokeLinecap="round" strokeLinejoin="round" opacity={0.55 * s.opacity} filter="url(#tf-glow)" />
          <path d={d} fill="none" stroke={s.color} strokeWidth={s.size * 1.2} strokeLinecap="round" strokeLinejoin="round" opacity={s.opacity} />
          <path d={d} fill="none" stroke="#ffffff" strokeWidth={s.size * 0.45} strokeLinecap="round" strokeLinejoin="round" opacity={0.85 * s.opacity} />
        </g>
      );
    case "spray": {
      const rand = rng(s.seed);
      const dots: ReactElement[] = [];
      const R = s.size * 1.2;
      for (let i = 0; i < s.points.length; i++) {
        const p = s.points[i];
        const count = Math.round(10 + 22 * p.p);
        for (let k = 0; k < count; k++) {
          const a = rand() * Math.PI * 2;
          const r = R * Math.sqrt(rand()) * (0.5 + p.p * 0.6);
          dots.push(<circle key={`${i}-${k}`} cx={n3(p.x + Math.cos(a) * r)} cy={n3(p.y + Math.sin(a) * r)} r={n3(s.size * (0.02 + rand() * 0.045))} />);
        }
      }
      return <g fill={s.color} opacity={s.opacity}>{dots}</g>;
    }
    case "erase":
      return <path d={d} fill="none" stroke="#000" strokeWidth={s.size * 1.6} strokeLinecap="round" strokeLinejoin="round" />;
  }
  return null;
});

/** Shared SVG filters used by the brush styles and the garment render. */
export function SvgFilters() {
  return (
    <defs>
      <filter id="tf-pencil" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="9" numOctaves="2" seed="3" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="0.06" xChannelSelector="R" yChannelSelector="G" result="d" />
        <feComponentTransfer in="n" result="grain"><feFuncA type="table" tableValues="0 1 0.2 1" /></feComponentTransfer>
        <feComposite in="d" in2="grain" operator="in" />
      </filter>
      <filter id="tf-air" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="0.35" />
      </filter>
      <filter id="tf-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="0.3" />
      </filter>
      <filter id="tf-soft" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="0.45" />
      </filter>
      <filter id="tf-shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="0.9" />
        <feOffset dx="0" dy="0.7" result="b" />
        <feComponentTransfer><feFuncA type="linear" slope="0.45" /></feComponentTransfer>
        <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id="tf-grain" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="3.2" numOctaves="2" seed="11" />
        <feColorMatrix type="saturate" values="0" />
        <feComponentTransfer><feFuncA type="table" tableValues="0 0.16" /></feComponentTransfer>
      </filter>
      <filter id="tf-relief" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        {/* Emboss of the fabric's own weave: kernel sums to zero + 0.5 bias, so flat areas stay neutral and only the texture is lit. */}
        <feColorMatrix type="saturate" values="0" result="g" />
        <feConvolveMatrix in="g" order="3" kernelMatrix="-1 -1 0 -1 0 1 0 1 1" divisor="1" bias="0.5" preserveAlpha="true" />
      </filter>
      <filter id="tf-print" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="4" numOctaves="1" seed="5" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="0.03" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </defs>
  );
}
