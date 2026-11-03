# Decisions

Choices made where the build prompt was ambiguous or where this first slice deviates from it.

| # | Decision | Why |
| --- | --- | --- |
| 1 | Built a vertical slice across Phases 1–3 instead of Phase 1 alone | Requested: see real mockup value now; later phases deepen each area |
| 2 | Garments stay SVG; drawing moved to a Canvas 2D engine (hardware-accelerated in WebView2) instead of PixiJS/WebGPU | Meets Gate 1 (185 fps / 2,000 paths) without a WebGPU dependency. Garments stay vector for crisp zoom and clean export |
| 3 | Garments are generated from measurements, not drawn | Editing a POM redraws the flat, which is the core promise of the spec |
| 4 | Screen separation uses k-means color quantization; embroidery is a visual stitch simulation with a density estimate (1,800 stitches/sq in of coverage) | Fast, offline, good enough to price and preview. Real digitizing (DST/PES) is Phase 3+ |
| 5 | Background removal is a corner-color flood fill | Works for flat-background art without an AI model; ONNX matting comes with the local-AI work |
| 6 | Native dialogs on desktop, browser download/upload elsewhere | Same UI runs in the .exe, `npm run dev`, and the web preview |
| 7 | Autosave writes to local storage and the app-data folder | Local storage is instant; the app-data copy has no size cap and survives a crash mid-write |
| 8 | Fonts (Inter, JetBrains Mono) are bundled via @fontsource | Works fully offline in the .exe |
| 9 | Demo artwork is generated in code at 2400 px | First launch shows a print-ready separation without shipping image assets |
| 10 | Auto-update is opt-in behind a Cargo feature | A placeholder public key would break the default build; you add your key when you're ready to ship |
| 11 | Layer blend modes mix drawing layers with each other, not with the fabric | Fabric stays vector (SVG) under the canvas; on-screen and exported results match |
| 12 | "Detach a panel to a second monitor" is deferred | Needs multi-window state sync; the resizable, hideable side panel covers the single-screen case |
| 13 | Scanned fabrics keep their photographed color | Tinting a photo misrepresents the real goods; color swatches still drive rib/trim |
| 14 | Fit presets rewrite the base spec rather than layering on top | The spec table always shows the real numbers that go to the factory |
| 15 | Embroidery digitizer is tatami fill only (no satin columns yet) | Fill handles most logo art reliably; satin for narrow shapes and lettering is the next upgrade |
| 16 | PES is written as truncated v1 (PES header + PEC body) | Brother/Baby Lock machines sew from the PEC body; this matches pyembroidery's truncated mode byte-for-byte |
| 17 | JEF / VP3 not exported yet | DST covers commercial machines, PES Brother, EXP Melco/Bernina |
| 18 | Mesh counts, hoop sizes and care text are typical defaults | Shown as suggestions; every value is editable or overridden by the shop |
| 19 | Costing rates start at $0 | No invented prices: the sheet lists which rates you still need to enter |
