import type { ReactNode, SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

const I = (children: ReactNode) =>
  function Icon({ size = 16, ...p }: P) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" {...p}>
        {children}
      </svg>
    );
  };

export const IcSelect = I(<path d="M5 3l14 7-6 2-2 6z" />);
export const IcBrush = I(<><path d="M14 4l6 6-8.5 8.5a3 3 0 01-2 .9L5 20l.6-4.5a3 3 0 01.9-2z" /><path d="M12.5 5.5l6 6" /></>);
export const IcEraser = I(<><path d="M8 20h12" /><path d="M4.6 14.6l9.9-9.9a2 2 0 012.8 0l2 2a2 2 0 010 2.8L11 18l-2 2-4.4-4.6a1 1 0 010-.8z" /><path d="M9 10l5 5" /></>);
export const IcHand = I(<><path d="M8 13V5.5a1.5 1.5 0 013 0V12" /><path d="M11 11V4a1.5 1.5 0 013 0v7" /><path d="M14 11V5.5a1.5 1.5 0 013 0V14" /><path d="M8 12.5l-1.6-1.6a1.6 1.6 0 00-2.3 2.3L8 17c1.6 2 3 3 6 3a5 5 0 005-5v-5a1.5 1.5 0 00-2-1.4" /></>);
export const IcImage = I(<><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></>);
export const IcZones = I(<><rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3 3" /><rect x="8" y="8" width="8" height="6" rx="1" /></>);
export const IcRuler = I(<><path d="M3 17L17 3l4 4L7 21z" /><path d="M7 13l2 2M10 10l2 2M13 7l2 2" /></>);
export const IcNeedle = I(<><path d="M4 20L18 6" /><ellipse cx="19.5" cy="4.5" rx="1.8" ry="1" transform="rotate(-45 19.5 4.5)" /><path d="M5 12c3 0 4 1 4 3s-1 3 2 4 5-1 7-2" strokeDasharray="2 2" /></>);
export const IcSymmetry = I(<><path d="M12 3v18" strokeDasharray="2 2" /><path d="M9 7L4 12l5 5z" /><path d="M15 7l5 5-5 5z" /></>);
export const IcFit = I(<><path d="M4 9V5a1 1 0 011-1h4M15 4h4a1 1 0 011 1v4M20 15v4a1 1 0 01-1 1h-4M9 20H5a1 1 0 01-1-1v-4" /></>);
export const IcFocus = I(<><path d="M3 8V4h4M17 4h4v4M21 16v4h-4M7 20H3v-4" /><circle cx="12" cy="12" r="3" /></>);
export const IcUndo = I(<><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 010 10h-3" /></>);
export const IcRedo = I(<><path d="M15 14l5-5-5-5" /><path d="M20 9H9a5 5 0 000 10h3" /></>);
export const IcDownload = I(<><path d="M12 4v11" /><path d="M7 10l5 5 5-5" /><path d="M5 20h14" /></>);
export const IcFolder = I(<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />);
export const IcSave = I(<><path d="M5 4h11l4 4v11a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z" /><path d="M8 4v5h7V4M8 20v-6h8v6" /></>);
export const IcCommand = I(<path d="M9 6a3 3 0 10-3 3h12a3 3 0 10-3-3v12a3 3 0 103-3H6a3 3 0 103 3z" />);
export const IcPalette = I(<><path d="M12 3a9 9 0 100 18c1.5 0 2-1 2-2s-1-2 0-3 2 0 3 0a4 4 0 004-4c0-5-4-9-9-9z" /><circle cx="7.5" cy="11" r="1.2" /><circle cx="10.5" cy="7" r="1.2" /><circle cx="15" cy="7.5" r="1.2" /></>);
export const IcWarn = I(<><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17v.5" /></>);
export const IcCheck = I(<path d="M5 12.5l4.5 4.5L19 7.5" />);
export const IcTrash = I(<><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" /></>);
export const IcPlus = I(<path d="M12 5v14M5 12h14" />);
export const IcX = I(<path d="M6 6l12 12M18 6L6 18" />);
export const IcEye = I(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>);
export const IcEyeOff = I(<><path d="M3 3l18 18" /><path d="M10.6 5.1A10 10 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4.1M6.6 6.6A16 16 0 002 12s3.5 7 10 7a9.6 9.6 0 004.4-1" /></>);
export const IcShirt = I(<path d="M8 3l-5 3 2 5 3-1v11h8V10l3 1 2-5-5-3c0 2-1.8 3-4 3s-4-1-4-3z" />);
export const IcPrint = I(<><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M7 21h10M12 17v4M6 9h4M14 9h4M6 13h12" /></>);
export const IcSparkle = I(<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />);
export const IcWand = I(<><path d="M4 20L15 9" /><path d="M14 4v2M18 6l-1.4 1.4M20 10h-2M10 6l1.4 1.4M17 13l-1.4-1.4" /></>);
export const IcLayers = I(<><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>);
export const IcChevron = I(<path d="M6 9l6 6 6-6" />);
export const IcSun = I(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>);
export const IcFilm = I(<><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 3v18M16 3v18M4 8h4M4 13h4M16 8h4M16 13h4" /></>);
export const IcTable = I(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 15h18M9 4v16" /></>);
