import { memo, useMemo, type ReactNode } from "react";
import type { Fabric } from "../data/fabrics";
import { isDark, shade } from "../data/fabrics";
import type { GarmentGeom } from "../data/garments";

// Renders fabric as a real-scale SVG pattern so it reads correctly at any zoom.

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function FabricPattern({ id, fabric, color }: { id: string; fabric: Fabric; color: string }) {
  const s = fabric.scale;
  const dark = "rgba(0,0,0,0.13)";
  const light = isDark(color) ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.22)";
  let body: ReactNode = null;
  let w = s, h = s;
  if (fabric.pattern === "photo" && fabric.tile) {
    return (
      <pattern id={id} patternUnits="userSpaceOnUse" width={s} height={s}>
        <image href={fabric.tile} width={s} height={s} preserveAspectRatio="none" />
      </pattern>
    );
  }
  switch (fabric.pattern) {
    case "jersey":
    case "terry":
      body = (
        <>
          <path d={`M ${s * 0.12} ${s * 0.05} L ${s * 0.5} ${s * 0.95} L ${s * 0.88} ${s * 0.05}`} fill="none" stroke={dark} strokeWidth={s * 0.16} />
          <path d={`M ${s * 0.2} ${s * 0.02} L ${s * 0.5} ${s * 0.75}`} fill="none" stroke={light} strokeWidth={s * 0.07} />
          {fabric.pattern === "terry" && <circle cx={s * 0.5} cy={s * 0.3} r={s * 0.07} fill={dark} />}
        </>
      );
      break;
    case "fleece": {
      w = h = s;
      const r = rng(7);
      body = (
        <>
          {Array.from({ length: 70 }, (_, i) => (
            <circle key={i} cx={r() * s} cy={r() * s} r={s * (0.008 + r() * 0.018)} fill={i % 3 === 0 ? light : "rgba(0,0,0,0.09)"} />
          ))}
        </>
      );
      break;
    }
    case "rib":
      body = (
        <>
          <rect x={0} y={0} width={s * 0.45} height={s} fill="rgba(0,0,0,0.16)" />
          <rect x={s * 0.55} y={0} width={s * 0.12} height={s} fill={light} />
        </>
      );
      break;
    case "mesh":
      body = (
        <>
          <circle cx={s / 2} cy={s / 2} r={s * 0.21} fill={shade(color, -0.45)} />
          <circle cx={s / 2} cy={s / 2} r={s * 0.21} fill="none" stroke={light} strokeWidth={s * 0.05} />
          <circle cx={0} cy={0} r={s * 0.21} fill={shade(color, -0.45)} />
          <circle cx={s} cy={0} r={s * 0.21} fill={shade(color, -0.45)} />
          <circle cx={0} cy={s} r={s * 0.21} fill={shade(color, -0.45)} />
          <circle cx={s} cy={s} r={s * 0.21} fill={shade(color, -0.45)} />
        </>
      );
      break;
    case "twill":
    case "denim":
      body = (
        <>
          <path d={`M ${-s * 0.25} ${s * 0.25} L ${s * 0.25} ${-s * 0.25} M 0 ${s} L ${s} 0 M ${s * 0.75} ${s * 1.25} L ${s * 1.25} ${s * 0.75}`}
            stroke={fabric.pattern === "denim" ? "rgba(255,255,255,0.2)" : dark} strokeWidth={s * 0.28} />
          <path d={`M ${s * 0.25} ${s * 1.25} L ${s * 1.25} ${s * 0.25} M ${-s * 0.25} ${s * 0.75} L ${s * 0.75} ${-s * 0.25}`}
            stroke={fabric.pattern === "denim" ? "rgba(0,0,0,0.18)" : light} strokeWidth={s * 0.12} />
        </>
      );
      break;
    case "ripstop":
      body = (
        <>
          <path d={`M 0 0 H ${s} M 0 0 V ${s}`} stroke="rgba(0,0,0,0.2)" strokeWidth={s * 0.07} />
          <path d={`M ${s * 0.1} ${s * 0.5} H ${s * 0.9}`} stroke={light} strokeWidth={s * 0.05} />
        </>
      );
      break;
    case "canvas":
      body = (
        <>
          <rect x={0} y={0} width={s / 2} height={s / 2} fill={dark} />
          <rect x={s / 2} y={s / 2} width={s / 2} height={s / 2} fill={dark} />
          <rect x={s / 2} y={0} width={s / 2} height={s / 2} fill={light} opacity={0.6} />
        </>
      );
      break;
  }
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width={w} height={h}>
      <rect width={w} height={h} fill={color} />
      {body}
    </pattern>
  );
}

interface Props {
  uid: string;
  geom: GarmentGeom;
  fabric: Fabric;
  trimFabric: Fabric;
  body: string;
  trim: string;
  showStitches?: boolean;
  children?: ReactNode; // decoration layers rendered clipped to the body
  overlay?: ReactNode; // rendered above, clipped to the body (e.g. hood shadow)
  lite?: boolean; // thumbnails: skip expensive filters
  relief?: number; // 0..1 strength of the lit fabric surface
  shadow?: boolean; // drop shadow under the garment (off for 3D textures)
  shading?: number; // 0..1 strength of the painted light/fold shading (3D lights its own)
  outline?: boolean; // dark silhouette line (off for 3D textures, where it would show on the side seam)
}

/** One garment view: fabric, ribs, shading, seams, plus clipped decoration. */
export const GarmentView = memo(function GarmentView({ uid, geom, fabric, trimFabric, body, trim, showStitches = true, children, lite, relief = 0.7, shadow = true, shading = 1, outline = true }: Props) {
  const dk = isDark(body);
  const lineCol = dk ? "rgba(255,255,255,0.22)" : "rgba(15,15,20,0.55)";
  const seamCol = dk ? "rgba(255,255,255,0.18)" : "rgba(15,15,20,0.35)";
  const stitchCol = dk ? "rgba(255,255,255,0.4)" : "rgba(15,15,20,0.45)";
  const lw = 0.06;
  const ids = useMemo(
    () => ({
      fab: `${uid}-fab`, trim: `${uid}-trim`, clip: `${uid}-clip`, sideShade: `${uid}-ss`, vShade: `${uid}-vs`, sheen: `${uid}-sheen`,
    }),
    [uid],
  );
  const b = geom.bounds;
  return (
    <g>
      <defs>
        <FabricPattern id={ids.fab} fabric={fabric} color={body} />
        <FabricPattern id={ids.trim} fabric={trimFabric} color={trim} />
        <clipPath id={ids.clip}>
          <path d={geom.body} />
          {geom.hood && <path d={geom.hood} />}
        </clipPath>
        <linearGradient id={ids.sideShade} x1={b.x0} x2={b.x1} y1={0} y2={0} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#000" stopOpacity={dk ? 0.35 : 0.22} />
          <stop offset="0.22" stopColor="#000" stopOpacity={0.02} />
          <stop offset="0.5" stopColor="#fff" stopOpacity={dk ? 0.04 : 0.08} />
          <stop offset="0.78" stopColor="#000" stopOpacity={0.02} />
          <stop offset="1" stopColor="#000" stopOpacity={dk ? 0.35 : 0.22} />
        </linearGradient>
        <linearGradient id={ids.vShade} x1={0} x2={0} y1={b.y0} y2={b.y1} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity={dk ? 0.06 : 0.12} />
          <stop offset="0.6" stopColor="#000" stopOpacity={0} />
          <stop offset="1" stopColor="#000" stopOpacity={dk ? 0.25 : 0.14} />
        </linearGradient>
        <radialGradient id={ids.sheen} cx="0.5" cy="0.32" r="0.55">
          <stop offset="0" stopColor="#fff" stopOpacity={fabric.sheen * 0.35} />
          <stop offset="1" stopColor="#fff" stopOpacity={0} />
        </radialGradient>
      </defs>

      {/* body */}
      <g filter={lite || !shadow ? undefined : "url(#tf-shadow)"}>
        {geom.hood && <path d={geom.hood} fill={`url(#${ids.fab})`} />}
        <path d={geom.body} fill={`url(#${ids.fab})`} />
      </g>
      {geom.ribs.map((d, i) => (
        <path key={i} d={d} fill={`url(#${ids.trim})`} />
      ))}
      {geom.pocket && <path d={geom.pocket} fill={`url(#${ids.fab})`} stroke={lineCol} strokeWidth={lw} />}

      {/* lit fabric surface (under the artwork, so prints stay true) */}
      {!lite && relief > 0 && (
        // clip on the rect itself: a clipped parent group would isolate the blend and turn it into a flat gray wash
        <rect x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} clipPath={`url(#${ids.clip})`} fill={`url(#${ids.fab})`}
          filter="url(#tf-relief)" opacity={relief} style={{ mixBlendMode: "soft-light", pointerEvents: "none" }} />
      )}

      {/* decoration (strokes + graphics), clipped to the garment */}
      <g clipPath={`url(#${ids.clip})`}>{children}</g>

      {/* hood sits above prints on the front */}
      {geom.hood && geom.hoodInner && (
        <>
          <path d={geom.hood} fill={`url(#${ids.fab})`} />
          <path d={geom.hoodInner} fill={shade(body, dk ? -0.35 : -0.22)} />
          <path d={geom.hoodInner} fill={`url(#${ids.sideShade})`} opacity={0.6} />
        </>
      )}

      {/* shading */}
      <g clipPath={`url(#${ids.clip})`} style={{ pointerEvents: "none" }} opacity={shading}>
        <rect x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} fill={`url(#${ids.sideShade})`} />
        <rect x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} fill={`url(#${ids.vShade})`} />
        <rect x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} fill={`url(#${ids.sheen})`} />
        {!lite &&
          geom.folds.map((f, i) => (
            <path key={i} d={f.d} fill="none" stroke="#000" strokeOpacity={dk ? 0.35 : 0.12} strokeWidth={f.w} strokeLinecap="round" filter="url(#tf-soft)" />
          ))}

      </g>

      {!lite && (
        <rect x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} clipPath={`url(#${ids.clip})`} filter="url(#tf-grain)" opacity={0.9}
          style={{ mixBlendMode: "overlay", pointerEvents: "none" }} />
      )}

      {/* lines */}
      <g fill="none" style={{ pointerEvents: "none" }}>
        {geom.seams.map((d, i) => <path key={i} d={d} stroke={seamCol} strokeWidth={lw * 0.9} />)}
        {geom.ribs.map((d, i) => <path key={i} d={d} stroke={lineCol} strokeWidth={lw * 0.9} />)}
        {showStitches && geom.stitches.map((d, i) => <path key={i} d={d} stroke={stitchCol} strokeWidth={0.035} strokeDasharray="0.14 0.09" />)}
        {outline && geom.hood && <path d={geom.hood} stroke={lineCol} strokeWidth={lw} />}
        {geom.hoodInner && <path d={geom.hoodInner} stroke={lineCol} strokeWidth={lw} />}
        {outline && <path d={geom.body} stroke={lineCol} strokeWidth={lw} strokeLinejoin="round" />}
        {geom.cords?.map((c, i) => (
          <g key={i}>
            <circle cx={c.a[0]} cy={c.a[1]} r={0.22} fill={shade(body, dk ? 0.3 : -0.3)} stroke={lineCol} strokeWidth={0.04} />
            <path d={`M ${c.a[0]} ${c.a[1]} Q ${(c.a[0] + c.b[0]) / 2 + (i ? 0.5 : -0.5)} ${(c.a[1] + c.b[1]) / 2} ${c.b[0]} ${c.b[1]}`}
              stroke={shade(trim, dk ? 0.15 : -0.1)} strokeWidth={0.32} strokeLinecap="round" />
            <path d={`M ${c.b[0]} ${c.b[1] - 0.2} L ${c.b[0]} ${c.b[1] + 0.9}`} stroke={dk ? "#bbb" : "#333"} strokeWidth={0.36} strokeLinecap="round" />
          </g>
        ))}
      </g>
    </g>
  );
});
