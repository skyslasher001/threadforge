# Changelog

## 0.5.0 — Phase 5 (pro production + automation)

**Embroidery**
- Satin columns: strokes, rays, rings and curves from 1.2 to 6 mm wide are sewn as satin that follows the shape (center-line tracing, center-run underlay, stitches square to the stroke all the way round). Small lettering stays fill.
- New machine formats: **JEF** (Janome) and **VP3** (Husqvarna Viking / Pfaff), byte-identical to pyembroidery like DST, PES and EXP.

**Brand Kit** (Showcase → Brand kit)
- Brand name, tagline, handle, logo (background removed and trimmed), palette with a primary color, heading and body type, label colors, Made in and RN number. One kit for every project.
- Print-ready labels PDF: woven neck label, care label with fiber, care text and symbols, and a two-sided hang tag with style, colorway, sizes and MSRP, at actual size with crop marks.
- Used automatically by social images (logo band, brand type, palette backgrounds), the line sheet, Present and the tech pack. Logos are recolored where they'd vanish on a background. Palette → colorways in one click.

**Automation**
- **Export everything** (Ctrl+Shift+E): mockups and social images for every colorway, colorway matrix, photo mockups, tech pack, line sheet, spec CSV, embroidery files in any format, film positives, labels and the project, in one ZIP with a manifest.
- **Macros**: record style changes (fabric, fit, colors, colorways, measurements, tech pack settings, artwork method) and an export, then replay them on any design in one undo step, or on a batch of project files.
- **Hot folder** (desktop): drop artwork into a folder and each file becomes a finished design (placed on your template, optional macro) with its deliverables in `THREADFORGE out`.

**Fixes**
- Escape closes the new dialogs; tag chips no longer stretch in tall columns.

## 0.4.0 — Phase 4 (Showcase)

**Showcase mode (key 5)**
- Colorway matrix: every colorway rendered with the real fabric, artwork and drawing; click to apply, "Suggest 4 colorways", labelled matrix PNG.
- 3D viewer: the flat front and back inflated into a lit 3D garment that updates as you edit; orbit, camera presets, three light setups, backdrops, 2048 px snapshot.
- Turntable video: one seamless 360° loop, square / vertical / wide, encoded frame by frame (H.264 MP4, WebM fallback).
- Photo mockups: drop in a photo of a blank garment, drag four corners onto the print area; the artwork is perspective-warped and lit by the photo's own folds and light. Full-size PNG export.
- On-model renders with Higgsfield: prompt builder chips, front/back flat or photo mockup as reference, price shown before every job, job queue with cancel, results saved with the project; animate any still into a 5 or 10 s clip. API key kept in Windows Credential Manager.
- Social exports: Instagram 4:5, square, 9:16 story/reel, 2000 px white store image, with brand line and caption.
- Line sheet PDF: cover, 2/4/6 styles per page (add other .tforge files), fabric, sizes, colorways, wholesale + MSRP once costing is complete, buyer order form.
- Present: full-screen slideshow of the design (title, front, back, colorways, photo mockups, renders, details).

**Other**
- jsPDF 4.2.1 (security fixes).
- Top tabs no longer wrap on narrower windows.

**Testing**
- 24 new headless UI checks for Showcase, including Gate 4 (flat → on-model render + turntable from a cold start), unit tests for the 3D inflate and the photo warp math, and a Rust bridge test against a mock Higgsfield API in CI.

## 0.3.0 — Phase 3 (production) + verification pass

**Production**
- Embroidery auto-digitizer: color-region cleanup, tatami fill with underlay, pull compensation, section decomposition (302 → 16 trims on the test shape), lock stitches, trims and color changes.
- DST, PES (truncated v1 + PEC with thumbnails) and EXP writers, byte-identical to pyembroidery; real stitch preview, stitch-out player, hoop fit.
- Screen print: ink systems, suggested print order with mesh counts, film positives PDF at actual size.
- Tech Pack mode: style info, BOM editor, fabric yardage estimate, costing sheet, construction/care/label/packaging notes, revision log, 10-page PDF.

**Fixes found in verification**
- Oversized / drop-shoulder sweatshirts in 2XL–3XL were wider than the artboard and overlapped the back view. Artboard enlarged; zoom-to-fit and exports now frame the garment.
- The view didn't re-fit when the window resized after launch (found running the real desktop app).
- Measurement cells: leaving a cell committed its rounded display value (silently rounding in cm); Escape committed instead of cancelling; arrow-key nudges didn't refresh the cell.
- Command palette showed only the first 40 commands.
- V-neck print zones started inside the V.

**Testing**
- Geometry sweep of 6,048 garment variants, embroidery byte comparison, 134 + 9 headless UI checks, CI on GitHub with a Windows installer build.

## 0.2.0 — Phases 1 and 2

**Phase 1 — shell and canvas**
- Native Save As / Open dialogs (Tauri dialog + fs plugins); exports and projects go where you choose.
- Crash-safe autosave in the app-data folder (temp-file then replace), recovered on launch when newer than the browser copy.
- Optional signed auto-updater behind a build feature (`npm run build:updater`), with "Check for updates".
- New canvas stroke engine: cached Path2D geometry, per-layer surfaces, incremental drawing, cached-bitmap pan/zoom, GPU-composited SVG movement.
- Layers: add, duplicate, merge down, delete, reorder by drag, hide, lock, opacity, blend; erasers are per layer.
- History: labeled steps, scrub slider, jump to any step, named snapshots with restore.
- Panels: Properties / Layers / History tabs, resizable side panel, hide panels, four workspaces.
- Built-in performance check for Gate 1.

**Phase 2 — design core**
- Fit presets (regular, boxy, oversized, cropped) that rewrite the base spec.
- Swappable parts: crew / V / mock neck, set-in / raglan / drop-shoulder sleeve, chest or kangaroo pocket.
- Five new brush styles: charcoal, watercolor, halftone, riso, chrome (12 total), with live canvas previews.
- QuickShape, Restyle layer, Sketch to flat.
- Lit fabric relief on every fabric; Fabric Scanner for photo swatches with cost and supplier.
- Fit compare: ghost any size over the preview size.

## 0.1.0 — first working slice

- Pro shell: dark glass theme (Midnight / Graphite / Studio Light), accent colors, command palette, focus mode, rebind-ready shortcut map, toasts.
- 60-Second Start: pick garment + color, land on a measured mockup with sample artwork.
- Parametric garments: tee, long-sleeve tee, crewneck, pullover hoodie; front and back views.
- Fabric library (11 fabrics) with real-scale textures, shading, sheen and grain; rib/trim fabric and color.
- Colorways: save, rename, apply from the panel or the bottom strip.
- Measurements: POM spec table, base size + grade rules, XS–3XL, tolerances, in/cm with fractions, validation, live canvas callouts, CSV export.
- Drawing: 7 brush styles with pressure, stabilizer, mirror symmetry, eraser, clip to garment.
- Artwork: drop/paste/pick, print zones with snapping, move/scale/rotate handles, nudging, background removal, copy to other side.
- Print prep: screen-print separations + underbase + film positives; embroidery thread plan, stitch render, stitch count, run time; DTG preview; DPI meter; compatibility checks with one-click fixes.
- Files: autosave, Save/Open .tforge, mockup PNG, films PNG, spec CSV, 120-step undo.
