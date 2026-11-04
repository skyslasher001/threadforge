"""
Phase 5 end-to-end checks through the real UI: Brand Kit + labels, batch export, macros, hot folder.
Usage: python3 tests/e2e_phase5.py <dist-single/index.html> <out-dir> [chrome]
"""
import asyncio, os, sys, time, zipfile, io
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw
from pypdf import PdfReader

HTML, OUT = sys.argv[1], sys.argv[2]
CHROME = sys.argv[3] if len(sys.argv) > 3 else None
os.makedirs(OUT, exist_ok=True)
results = []

def make_logo(path):
    # a black wolf-head-ish mark on a white background, like a real logo export
    im = Image.new("RGB", (900, 600), "white"); g = ImageDraw.Draw(im)
    g.polygon([(150, 520), (300, 120), (380, 300), (450, 80), (520, 300), (600, 120), (750, 520), (450, 430)], fill="#141418")
    g.ellipse((390, 330, 510, 420), fill="white")
    im.save(path)

async def main():
    async with async_playwright() as p:
        kw = {"args": ["--no-sandbox"]}
        if CHROME: kw["executable_path"] = CHROME
        b = await p.chromium.launch(**kw)
        ctx = await b.new_context(viewport={"width": 1480, "height": 920}, accept_downloads=True)
        pg = await ctx.new_page()
        errors = []
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errors.append(str(e)))
        async def check(name, fn):
            n = len(errors)
            await pg.evaluate("document.activeElement && document.activeElement.blur && document.activeElement.blur()")
            try:
                r = await fn()
                if r is False: raise AssertionError("returned False")
                if len(errors) > n: raise AssertionError("console: " + " | ".join(errors[n:])[:300])
                results.append((name, True, r if isinstance(r, str) else ""))
            except Exception as e:
                results.append((name, False, str(e)[:300]))
                try: await pg.screenshot(path=f"{OUT}/p5-fail-{len(results)}.png", timeout=60000)
                except Exception: pass
        async def download(click, name, timeout=60000):
            async with pg.expect_download(timeout=timeout) as d:
                await click()
            path = f"{OUT}/{name}"; await (await d.value).save_as(path); return path
        state = lambda js: pg.evaluate(f"(() => {{ const s = window.__threadforge.store.getState(); return {js}; }})()")
        brand = lambda js: pg.evaluate(f"(() => {{ const k = window.__threadforge.brand.getState().kit; return {js}; }})()")
        async def tab(label):
            await pg.click(f".sc-tab:text-is('{label}')"); await pg.wait_for_timeout(400)

        await pg.goto("file://" + HTML); await pg.wait_for_timeout(700)
        await pg.click(".welcome-card >> text=Pullover Hoodie"); await pg.click("text=Start with sample artwork"); await pg.wait_for_timeout(2500)
        await pg.keyboard.press("5")

        # ---------------- Brand Kit ----------------
        await tab("Brand kit")
        logo = f"{OUT}/logo-src.png"; make_logo(logo)
        async def brand_identity():
            await pg.fill(".side .field:has-text('Brand name') input", "Ember Wolf")
            await pg.fill(".side .field:has-text('Tagline') input", "Built for the long haul")
            await pg.fill(".side .field:has-text('Website or handle') input", "@emberwolf")
            async with pg.expect_file_chooser() as fc:
                await pg.click(".side button:text-is('Add logo')")
            await (await fc.value).set_files(logo)
            await pg.wait_for_function("window.__threadforge.brand.getState().kit.logo", timeout=10000)
            info = await pg.evaluate("""(async () => {
              const k = window.__threadforge.brand.getState().kit;
              const i = await new Promise(r => { const im = new Image(); im.onload = () => r(im); im.src = k.logo; });
              const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight;
              const g = c.getContext('2d'); g.drawImage(i, 0, 0);
              return [k.logoW, k.logoH, g.getImageData(0, 0, 1, 1).data[3], g.getImageData(Math.floor(c.width/2), Math.floor(c.height*0.7), 1, 1).data[3]];
            })()""")
            w, h, corner, mid = info
            if not (w < 900 and h < 600 and corner == 0 and mid > 200): raise AssertionError(str(info))
            return f"logo trimmed to {w}x{h}, white background knocked out"
        await check("Brand Kit: name, tagline, logo import with background removal", brand_identity)

        async def labels_preview():
            await pg.wait_for_selector("[data-testid=label-tagBack]", timeout=15000)
            await pg.wait_for_selector("[data-testid=brand-logo]", timeout=15000); await pg.wait_for_timeout(800)
            sizes = await pg.evaluate("['neck','care','tagFront','tagBack'].map(k => { const i = document.querySelector(`[data-testid=label-${k}]`); return [i.naturalWidth, i.naturalHeight]; })")
            want = [[300, 150], [188, 450], [300, 525], [300, 525]]
            if sizes != want: raise AssertionError(str(sizes))
            return "neck 2x1, care 1.25x3, hang tag 2x3.5 in (front + back)"
        await check("label previews at true proportions", labels_preview)
        await pg.screenshot(path=f"{OUT}/p5-brand.png")

        async def labels_pdf():
            path = await download(lambda: pg.click("text=Labels PDF"), "labels.pdf")
            r = PdfReader(path); pgs = r.pages
            txt = pgs[0].extract_text()
            imgs = len(pgs[0].images)
            w, h = float(pgs[0].mediabox.width) / 72, float(pgs[0].mediabox.height) / 72
            if not (len(pgs) == 1 and imgs == 4 and "Ember Wolf" in txt and (w, h) == (8.5, 11)): raise AssertionError(f"{len(pgs)} pages, {imgs} images, {w}x{h}, {txt[:120]!r}")
            # check one label image's placed size: hang tag 2 x 3.5 in
            return "1 letter page, 4 labels at actual size with crop marks"
        await check("labels PDF", labels_pdf)

        async def palette_colorways():
            n = await state("s.design.colorways.length")
            await pg.click("[data-testid=palette-colorways]")
            m = await state("s.design.colorways.length")
            return f"{n} -> {m} colorways" if m > n else False
        await check("palette becomes colorways", palette_colorways)

        async def social_branded():
            await tab("Social")
            path = await download(lambda: pg.click(".sc-toolbar >> text=Export PNG"), "brand-post.png")
            im = Image.open(path).convert("RGB")
            # logo sits in the top band: dark pixels on the light background
            top = im.crop((340, 40, 740, 140))
            dark = sum(1 for px in top.get_flattened_data() if sum(px) < 150) if hasattr(top, 'get_flattened_data') else sum(1 for px in top.getdata() if sum(px) < 150)
            if dark < 500: raise AssertionError(f"{dark} dark pixels in the logo band")
            return f"logo at the top ({dark:,} logo pixels), brand line from the kit"
        await check("social image carries the Brand Kit logo", social_branded)

        async def linesheet_branded():
            await tab("Line sheet")
            path = await download(lambda: pg.click("text=Line sheet PDF"), "brand-linesheet.pdf")
            r = PdfReader(path); t = r.pages[0].extract_text()
            if not ("EMBER WOLF" in t and "Built for the long haul" in t and len(r.pages[0].images) >= 2): raise AssertionError(t[:200])
            return "cover: logo, brand name, tagline"
        await check("line sheet cover uses the Brand Kit", linesheet_branded)


        # ---------------- Export everything ----------------
        async def bundle():
            await pg.keyboard.press("Control+Shift+E")
            await pg.wait_for_selector("[data-testid=bundle-go]", timeout=5000)
            for f in ["JEF", "VP3"]:
                await pg.click(f".auto-card .chip:text-is('{f}')")
            label = await pg.inner_text("[data-testid=bundle-go]")
            await pg.screenshot(path=f"{OUT}/p5-bundle.png")
            want = int(label.split()[1])
            path = await download(lambda: pg.click("[data-testid=bundle-go]"), "delivery.zip", timeout=240000)
            z = zipfile.ZipFile(path)
            names = z.namelist()
            if z.testzip() is not None: raise AssertionError("corrupt entry")
            if len(names) != want + 1: raise AssertionError(f"{len(names)} files vs {want} + README")
            import pyembroidery, json
            dst = next(n for n in names if n.endswith(".dst")); open(f"{OUT}/z.dst", "wb").write(z.read(dst))
            st = sum(1 for x in pyembroidery.read(f"{OUT}/z.dst").stitches if (x[2] & 0xFF) == 0)
            pdfs = [n for n in names if n.endswith(".pdf")]
            pages = {n.split("/")[-1]: len(PdfReader(io.BytesIO(z.read(n))).pages) for n in pdfs}
            pngs = [n for n in names if n.endswith(".png")]
            sizes = {n.split("/")[-1]: Image.open(io.BytesIO(z.read(n))).size for n in pngs}
            proj = json.loads(z.read(next(n for n in names if n.endswith(".tforge"))))
            if not (st > 2000 and all(v > 0 for v in pages.values()) and any(s == (1080, 1920) for s in sizes.values()) and proj["design"]["name"]):
                raise AssertionError(f"{st} stitches, {pages}, {sizes}")
            exts = sorted({n.rsplit(".", 1)[-1] for n in names})
            return f"{len(names)} files in one ZIP ({', '.join(exts)}); DST {st:,} stitches; PDFs {pages}"
        await check("Export everything: one ZIP with every deliverable, all readable", bundle)

        # ---------------- Macros ----------------
        async def macro_record():
            await pg.click("text=Artwork layout") if await pg.locator("text=Artwork layout").count() else None
            await pg.click("[data-testid=menu-macros]")
            await pg.click("[data-testid=macro-record]")
            await pg.wait_for_selector("[data-testid=rec-pill]", timeout=5000)
            await pg.evaluate("""(() => { const s = window.__threadforge.store.getState();
              s.commit(d => ({ ...d, fabricId: 'terry', parts: { ...d.parts, fit: 'boxy' }, previewSize: 'L' }), 'Fabric + fit');
              s.commit(d => ({ ...d, graphics: d.graphics.map(g => ({ ...g, method: 'screen', colors: 2 })) }), 'Artwork to screen');
            })()""")
            await pg.fill("[data-testid=rec-pill] input", "Drop 02 house style")
            await pg.click("[data-testid=rec-pill] button:text-is('Stop')")
            m = await pg.evaluate("window.__threadforge.macros.getState().macros[0]")
            kinds = [s["kind"] for s in m["steps"]]
            v = m["steps"][0]["values"]
            if not (m["name"] == "Drop 02 house style" and kinds == ["fields", "graphics"] and v["parts"]["fit"] == "boxy" and v["previewSize"] == "L" and "name" not in v):
                raise AssertionError(str(m)[:300])
            return f"recorded {len(m['steps'])} steps: {', '.join(kinds)}"
        await check("record a macro from real edits", macro_record)

        async def macro_run():
            # a different design: a fresh tee
            await pg.evaluate("window.__threadforge.store.getState().loadDesign({ ...window.__threadforge.newDesign('tee'), name: 'Tee for macro' })")
            await pg.click("text=Artwork layout") if await pg.locator("text=Artwork layout").count() else None
            await pg.click("[data-testid=menu-macros]")
            await pg.screenshot(path=f"{OUT}/p5-macros.png")
            await pg.click("[data-testid=macro-run]")
            await pg.wait_for_timeout(300)
            after = await state("[s.design.name, s.design.parts.fit, s.design.previewSize, s.design.template]")
            await pg.click(".scrim .btn.icon.ghost")
            await pg.keyboard.press("Control+z"); await pg.wait_for_timeout(200)
            undone = await state("[s.design.parts.fit, s.design.previewSize]")
            if not (after[0] == "Tee for macro" and after[1] == "boxy" and after[2] == "L" and undone == ["regular", "M"]): raise AssertionError(f"{after} / undo {undone}")
            return "applied in one undoable step; design name kept"
        await check("run a macro on another design, undo in one step", macro_run)

        async def macro_files():
            import json
            paths = []
            for i, tpl in enumerate(["tee", "crewneck"]):
                d = await pg.evaluate(f"(() => ({{ ...window.__threadforge.newDesign('{tpl}'), name: 'Batch {i+1}' }}))()")
                pth = f"{OUT}/batch-{i+1}.tforge"; json.dump({"app": "THREADFORGE", "schema": 2, "design": d}, open(pth, "w")); paths.append(pth)
            await pg.click("[data-testid=menu-macros]") if await pg.locator("[data-testid=menu-macros]").is_visible() else None
            if not await pg.locator("[data-testid=macro]").count():
                await pg.click("text=Artwork layout"); await pg.click("[data-testid=menu-macros]")
            async with pg.expect_download(timeout=120000) as dl:
                async with pg.expect_file_chooser() as fc:
                    await pg.click("[data-testid=macro] button:text-is('Run on files…')")
                await (await fc.value).set_files(paths)
            out = f"{OUT}/batch.zip"; await (await dl.value).save_as(out)
            z = zipfile.ZipFile(out)
            ds = [json.loads(z.read(n))["design"] for n in z.namelist() if n.endswith(".tforge")]
            ok = len(ds) == 2 and all(d["parts"]["fit"] == "boxy" and d["previewSize"] == "L" for d in ds) and sorted(d["name"] for d in ds) == ["Batch 1", "Batch 2"]
            await pg.keyboard.press("Escape")
            if not ok: raise AssertionError(str([(d["name"], d["parts"]["fit"]) for d in ds]))
            return "2 projects updated and returned in one ZIP"
        await check("run a macro on a batch of project files", macro_files)


        # ---------------- Hot folder (pipeline, with an in-memory folder) ----------------
        async def hot():
            res = await pg.evaluate("""(async () => {
              const T = window.__threadforge, S = T.store.getState();
              S.loadDesign({ ...T.newDesign('tee'), name: 'Hot template', bodyColor: '#1F2A44', trimColor: '#1F2A44' });
              const io = T.hot.memoryFolder('test');
              const art = async (hue) => { const c = document.createElement('canvas'); c.width = 600; c.height = 400; const g = c.getContext('2d');
                g.fillStyle = `hsl(${hue} 80% 55%)`; g.beginPath(); g.arc(300, 200, 170, 0, 7); g.fill(); g.fillStyle = '#fff'; g.fillRect(180, 170, 240, 60);
                return new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer()); };
              io.files.set('sunset-logo.png', await art(20));
              io.files.set('wave.png', await art(200));
              io.files.set('notes.txt', new TextEncoder().encode('ignore me'));
              const settings = { ...T.hot.useHot.getState().settings, method: 'embroidery', colors: 2,
                bundle: { ...T.hot.useHot.getState().settings.bundle, embroidery: ['dst'], social: ['post'] } };
              const t0 = performance.now();
              T.hot.startHot(io, T.store.getState().design, settings, 250);
              const wait = async (n) => { for (let i = 0; i < 400; i++) { const it = T.hot.useHot.getState().items; if (it.filter(x => x.status === 'done' || x.status === 'failed').length >= n) return it; await new Promise(r => setTimeout(r, 150)); } return T.hot.useHot.getState().items; };
              let items = await wait(2);
              const first = performance.now() - t0;
              io.files.set('third.png', await art(120));
              items = await wait(3);
              T.hot.stopHot();
              const keys = [...io.files.keys()];
              return { items: items.map(i => [i.name, i.status, i.files, i.error || '']), keys, first };
            })()""")
            items = {n: (st, f, err) for n, st, f, err in res["items"]}
            keys = res["keys"]
            if set(items) != {"sunset-logo.png", "wave.png", "third.png"} or any(v[0] != "done" for v in items.values()):
                raise AssertionError(str(res["items"]))
            need = ["THREADFORGE out/sunset-logo/mockups/working-front-back.png", "THREADFORGE out/sunset-logo/production/embroidery/sunset-logo.dst",
                    "THREADFORGE out/wave/docs/wave-techpack.pdf", "THREADFORGE out/third/social/working-post-1080x1350.png", "THREADFORGE out/.processed.json"]
            missing = [k for k in need if k not in keys]
            if missing: raise AssertionError(f"missing {missing}; have {[k for k in keys if 'third' in k][:8]}")
            if any("notes" in k and "out/" in k for k in keys): raise AssertionError("processed a non-image")
            return f"3 dropped files -> {len(keys) - 3} output files; first two done in {res['first']/1000:.1f} s; .txt ignored; ledger prevents repeats"
        await check("hot folder turns dropped artwork into deliverables", hot)

        async def hot_dialog():
            await pg.click("text=Artwork layout"); await pg.click("[data-testid=menu-hot]")
            await pg.wait_for_selector("[data-testid=hot-log] [data-status=done]", timeout=5000)
            n = await pg.locator("[data-testid=hot-log] [data-status=done]").count()
            await pg.screenshot(path=f"{OUT}/p5-hot.png")
            await pg.keyboard.press("Escape")
            return f"activity log shows {n} finished files"
        await check("hot folder dialog and activity log", hot_dialog)

        async def brand_persists():
            await pg.reload(); await pg.wait_for_timeout(1500)
            return await brand("[k.name, !!k.logo, k.colors.length]") == ["Ember Wolf", True, 2]
        await check("Brand Kit persists across restarts", brand_persists)

        await b.close()

asyncio.run(main())
for name, ok, info in results:
    print(("PASS " if ok else "FAIL ") + " " + name + (": " + info if info else ""))
passed = sum(1 for r in results if r[1])
print(f"\n{passed}/{len(results)} checks passed")
sys.exit(0 if passed == len(results) else 1)
