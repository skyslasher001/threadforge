# THREADFORGE — clothing design & mockup studio

Windows desktop app (Tauri 2 + React + TypeScript) for designing garments, placing artwork,
and prepping it for screen printing and embroidery.

## Build the Windows .exe (one-time setup, ~15 minutes)

1. **Install Node.js 20 or newer** — https://nodejs.org (LTS installer, defaults are fine).
2. **Install Rust** — https://rustup.rs → run `rustup-init.exe`, accept the defaults.
   It will offer to install the *Visual Studio C++ Build Tools*; say yes
   (needs the "Desktop development with C++" workload).
3. **WebView2** is already on Windows 10/11. Nothing to do.
4. Unzip this folder, open **PowerShell** inside it, then run:

```powershell
npm install
npm run tauri build
```

The first build downloads Rust crates and takes 5–10 minutes; later builds are fast.

Your installers land in:

- `src-tauri\target\release\bundle\nsis\THREADFORGE_0.4.0_x64-setup.exe`  ← run this one
- `src-tauri\target\release\bundle\msi\THREADFORGE_0.4.0_x64_en-US.msi`
- the bare app: `src-tauri\target\release\threadforge.exe`

### Day-to-day development

```powershell
npm run tauri dev     # native window with hot reload
npm run dev           # same UI in a browser at http://localhost:1420
```

### Or let GitHub build it

Every push to `main` runs the tests and builds the Windows installer on GitHub's Windows machines
(`.github/workflows/build.yml`). Download it from the run's **Artifacts** (`THREADFORGE-windows`).
When a push carries a new version number, the build also publishes GitHub Release `vX.Y.Z`
with the `.exe` and `.msi` attached: see [Releases](https://github.com/skyslasher001/threadforge/releases).

## Higgsfield on-model renders (optional)

1. In your Higgsfield account, create an API key. You get a **key ID** and a **secret**.
2. In THREADFORGE: Showcase (5) → **On-model render** → paste both in the side panel → Save key.
   The key goes to Windows Credential Manager (entry "THREADFORGE Higgsfield"), never into project files.
3. Pick a reference (front flat, back flat or a photo mockup), tap the chips, press **Check price**.
   The Generate button shows the price; nothing is charged until you press it.
4. Open a finished still to **Animate** it into a 5 or 10 second clip (also priced first).

Stills are saved inside the `.tforge` project. Clips are several MB, so they stay on this computer;
use **Save clip** to keep a copy. In the browser preview (`npm run dev`) the tab runs a labelled demo
with placeholder results and no API calls.

## Enable auto-update (optional)

The default build has no updater, so it always compiles. To ship signed updates:

1. Generate a signing key once: `npx tauri signer generate -w threadforge.key`
   Keep `threadforge.key` private. Never commit it.
2. Open `src-tauri\tauri.updater.conf.json`:
   paste the contents of `threadforge.key.pub` into `pubkey`, and set `endpoints`
   to where you'll host `latest.json` (a GitHub Release works).
3. Build with the key in your environment:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content .\threadforge.key -Raw
npm run build:updater
```

4. Upload the installer, its `.sig` file and a `latest.json` to your endpoint.
   In the app: Workspaces menu → **Check for updates**.

## What's in this build (v0.4 — Phases 1 to 4)

| Area | What works |
| --- | --- |
| Shell | Native Save As / Open dialogs, crash-safe autosave in the app-data folder with recovery on launch, optional signed auto-update |
| UI | Dark glass UI, 3 themes, 4 accents, command palette (Ctrl+K), focus mode (Tab), Properties / Layers / History tabs, resizable side panel, hide panels (Ctrl+\\), 4 workspaces |
| Canvas | Stroke engine on canvas with cached paths, GPU-composited pan/zoom, per-layer surfaces with incremental drawing, built-in 2,000-path benchmark |
| Layers | Per-side drawing layers: add, duplicate, merge down, delete, drag to reorder, hide, lock, opacity, blend mode; erasers cut only their own layer |
| History | Labeled undo/redo (150 steps), scrub slider, click any step, named snapshots you can restore |
| Garments | Parametric tee, long-sleeve, crewneck, hoodie; fit presets (regular, boxy, oversized, cropped); crew / V / mock necklines; set-in / raglan / drop-shoulder sleeves; chest or kangaroo pocket; rib parts, hood, drawcords, seams, coverstitch |
| Fabrics | 11 fabrics with real-scale knit/woven textures and lit surface relief; GSM ↔ oz, fiber content; **Fabric Scanner** turns a swatch photo into an evenly lit seamless texture saved with GSM, fiber, stretch, cost/yard and supplier |
| Measurements | POM table per garment, editable base size + grade rules, XS–3XL size run, tolerances, inches (1/8 fractions) or cm, live redraw, validation, callouts, fit compare (ghost any size over the preview), CSV export |
| Drawing | 12 brush styles (tech pen, brush pen, marker, graphite, charcoal, watercolor, spray, airbrush, halftone, riso, chrome, neon), pen pressure, stabilizer, QuickShape (hold to snap a line, ellipse or box), mirror, eraser, clip-to-garment, **Restyle** a layer into another style, **Sketch to flat** cleanup |
| Artwork | Drop / paste / pick images, auto-fit to print zones, drag / scale / rotate, snap to zones + center, arrow-key nudging, background removal |
| Screen print | Color separation, underbase, ink system (plastisol, water-based, discharge, puff, metallic, glitter), suggested print order with mesh counts, **film positives PDF at actual size** (one page per screen, registration marks, 1 in check bar) |
| Embroidery | **Auto-digitizer**: region cleanup, tatami fill (0.4 mm) with underlay and pull compensation, shape sections to minimize trims, lock stitches; real stitch preview and stitch-out player; hoop fit; **DST, PES and EXP files** byte-identical to pyembroidery's encoders |
| Tech pack | Tech Pack mode: style info, BOM editor with fabric yardage estimate, costing sheet (your rates, margin, retail), construction/care/labels/packaging notes, revision log; **10-page PDF** (overview, flats, measurement diagram, graded spec, BOM, colorways, artwork, construction, costing, revisions) |
| Showcase | **Colorway matrix** (live renders, suggestions, matrix PNG); **3D viewer** with lights, backdrops and snapshot; **turntable video** (seamless loop, MP4/WebM, square / vertical / wide); **photo mockups** (four-corner perspective warp lit by the photo's folds); **Higgsfield on-model renders** and motion clips with price-first jobs; **social exports** (4:5, 1:1, 9:16, 2000 px store image); **line sheet PDF** with order form; full-screen **Present** |
| Checks | DPI meter, fabric/method compatibility, screen count, hoop size, stitch density, with one-click fixes |
| Files | Autosave + crash recovery, Save/Open `.tforge`, mockup PNG (front + back), films PNG, spec CSV, labeled undo/redo (150 steps) |

## Keyboard

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| V | Select | Ctrl+K | Command palette |
| B | Brush | Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| E | Eraser | Ctrl+S / Ctrl+O | Save / open project |
| H or Space | Pan | Ctrl+E | Export mockup PNG |
| I | Add image | Ctrl+D | Duplicate graphic |
| Z | Print zones | Ctrl+N | New design |
| M | Measurement callouts | Delete | Delete graphic |
| X | Mirror drawing | Arrows (+Shift) | Nudge 1/8 in (1 in) |
| [ / ] | Brush size | Shift+1 | Zoom to fit |
| L | Layers tab | Y | History tab |
| Ctrl+\\ | Hide / show panels | Hold pen still | QuickShape snap |
| 1 / 2 / 3 / 4 / 5 | Design / Print Prep / Measurements / Tech Pack / Showcase | Tab | Focus mode |
| ← → Space | Next / previous slide (Present) | Esc | Exit Present |

## Gate results (measured in this build)

| Gate | Result |
| --- | --- |
| Gate 1: 120 fps with 2,000 paths | 185 fps panning 2,000 paths, slowest 5% of frames 8.7 ms, adding a stroke 2–7 ms (CPU-only test machine, refresh cap off). Run it yourself: Ctrl+K → "benchmark". |
| Gate 1: cold start under 1.5 s | First canvas paint 150–250 ms after the page loads. Add WebView2 start-up on Windows; time the installed .exe once to confirm. |
| Gate 2: graded, fabric-assigned hoodie in under 5 min | 12 actions: hoodie → color → French terry → boxy fit → chest 24 1/2 → grade 2 1/2 → preview L → export spec CSV |

| Gate 3: a shop can produce from the files with no rework | DST/PES/EXP byte-identical to pyembroidery and read back with the right stitch count, colors and size; film PDF pages measure exactly art size + margins at 300 DPI; tech pack carries graded spec, BOM, placement and print/thread sequences. A real test-sew and film output at a shop is still the final check. |
| Gate 4: one design flat → on-model render and turntable in under 3 min | Measured from a cold start on a CPU-only test machine: 130 s total, with the on-model still ready at 29 s and a 4-second 1080 × 1080 turntable encoded on software rendering (a GPU makes the turntable step take a few seconds). The render step used the demo backend; with a live key add Higgsfield's queue and render time. |

## Tests

```bash
npm test          # typecheck, 6,048 garment variants, 3D inflate + photo warp math, embroidery files vs pyembroidery
npm run test:e2e  # 176 UI checks in headless Chrome (pip install playwright pyembroidery "pypdf[image]")
tests/hf_bridge.sh  # Rust Higgsfield bridge against a mock API (needs Rust)
```

## Not built yet (Phase 5)

Brand Kit, macros, hot folder, cloth-simulated 3D drape from real pattern pieces,
JEF/VP3 embroidery formats and satin-column digitizing. See `DECISIONS.md` and `CHANGELOG.md`.
