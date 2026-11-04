"""
Phase 4 (Showcase) end-to-end checks through the real UI: colorway matrix, social exports,
3D viewer + turntable, photo mockups, line sheet, present mode and the Higgsfield flow (mock mode).
Usage: python3 tests/e2e_phase4.py <dist-single/index.html> <out-dir> [chrome]
"""
import asyncio, os, shutil, subprocess, sys, time
from playwright.async_api import async_playwright
from PIL import Image
from pypdf import PdfReader

HTML, OUT = sys.argv[1], sys.argv[2]
CHROME = sys.argv[3] if len(sys.argv) > 3 else None
HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT, exist_ok=True)
results = []

async def main():
    async with async_playwright() as p:
        kw = {"args": ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]}
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
                try: await pg.screenshot(path=f"{OUT}/p4-fail-{len(results)}.png", timeout=90000)
                except Exception: pass
        async def download(click, name, timeout=60000):
            async with pg.expect_download(timeout=timeout) as d:
                await click()
            path = f"{OUT}/{name}"; await (await d.value).save_as(path); return path
        state = lambda js: pg.evaluate(f"(() => {{ const s = window.__threadforge.store.getState(); return {js}; }})()")
        async def tab(label):
            await pg.click(f".sc-tab:text-is('{label}')"); await pg.wait_for_timeout(400)

        await pg.goto("file://" + HTML); await pg.wait_for_timeout(700)
        await pg.click(".welcome-card >> text=Pullover Hoodie"); await pg.click("text=Start with sample artwork"); await pg.wait_for_timeout(2500)
        t0 = time.time()

        async def enter():
            await pg.keyboard.press("5"); await pg.wait_for_selector("[data-testid=showcase]", timeout=5000)
            return await state("s.mode") == "showcase"
        await check("5 opens Showcase mode", enter)

        # ---------------- colorways ----------------
        async def matrix():
            await pg.wait_for_function("document.querySelectorAll('.cw-card img').length >= 4", timeout=20000)
            n = await pg.locator(".cw-card img").count()
            ok = await pg.evaluate("[...document.querySelectorAll('.cw-card img')].every(i => i.naturalWidth > 100)")
            if not ok: raise AssertionError("blank thumbnail")
            return f"{n} colorways rendered"
        await check("colorway matrix renders every colorway", matrix)

        async def suggest():
            before = await state("s.design.colorways.length")
            await pg.click("[data-testid=suggest-colorways]")
            await pg.wait_for_function(f"document.querySelectorAll('.cw-card img').length >= {before + 1}", timeout=20000)
            after = await state("s.design.colorways.length")
            return f"{before} -> {after}" if after > before else False
        await check("suggest colorways adds rendered ideas", suggest)

        async def apply_cw():
            await pg.locator(".cw-card").nth(1).click(); await pg.wait_for_timeout(200)
            body, cw = await state("[s.design.bodyColor, s.design.colorways[1].body]")
            return body == cw
        await check("click a card applies that colorway", apply_cw)

        async def matrix_png():
            path = await download(lambda: pg.click("text=Matrix PNG"), "matrix.png")
            im = Image.open(path); return f"{im.size[0]}x{im.size[1]}"
        await check("matrix PNG export", matrix_png)
        await pg.screenshot(path=f"{OUT}/p4-matrix.png", timeout=90000)

        # ---------------- social ----------------
        await tab("Social")
        sizes = {"Instagram post": (1080, 1350), "Square post": (1080, 1080), "Story / Reel / TikTok": (1080, 1920), "Store product image": (2000, 2000)}
        async def social_preview():
            await pg.wait_for_selector("[data-testid=social-preview]", timeout=20000)
            w, h = await pg.evaluate("(() => { const i = document.querySelector('[data-testid=social-preview]'); return [i.naturalWidth, i.naturalHeight]; })()")
            return f"{w}x{h}" if (w, h) == (1080, 1350) else False
        await check("social preview at Instagram size", social_preview)

        async def social_all():
            got_dl = []
            def on_dl(dl): got_dl.append(dl)
            pg.on("download", on_dl)
            await pg.click("text=All 4 sizes")
            for _ in range(120):
                if len(got_dl) >= 4: break
                await pg.wait_for_timeout(250)
            pg.remove_listener("download", on_dl)
            paths = []
            for dl in got_dl:
                pth = f"{OUT}/{dl.suggested_filename}"; await dl.save_as(pth); paths.append(pth)
            got = sorted(Image.open(x).size for x in paths)
            want = sorted(sizes.values())
            if got != want: raise AssertionError(f"{got}")
            return ", ".join(f"{w}x{h}" for w, h in got)
        await check("export all 4 social sizes at exact pixel sizes", social_all)

        async def product_white():
            im = Image.open(next(f"{OUT}/{x}" for x in os.listdir(OUT) if "-product-2000x2000" in x)).convert("RGB")
            return im.getpixel((4, 4)) == (255, 255, 255) and im.getpixel((1000, 1000)) != (255, 255, 255)
        await check("store image: pure white background, garment centered", product_white)

        await pg.screenshot(path=f"{OUT}/p4-social.png", timeout=90000)


        # ---------------- photo mockups ----------------
        await tab("Photo mockups")
        async def photo_sample():
            await pg.click("[data-testid=sample-photo]")
            await pg.wait_for_selector("[data-testid=photo-result]", timeout=20000)
            await pg.wait_for_timeout(600)
            p = await state("s.design.showcase.photos[0]")
            return f"{p['w']}x{p['h']} photo, print area {p['zone']}"
        await check("sample photo with print area marked", photo_sample)

        async def photo_warp():
            # the artwork changes pixels inside the quad and leaves the rest of the photo alone
            res = await pg.evaluate("""(async () => {
              const s = window.__threadforge.store.getState(); const p = s.design.showcase.photos[0];
              const load = (u) => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = u; });
              const a = await load(p.photo), b = await load(document.querySelector('[data-testid=photo-result]').src);
              const px = (img, x, y) => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
                const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(Math.round(x * img.naturalWidth / p.w), Math.round(y * img.naturalHeight / p.h), 1, 1).data; };
              const q = p.quad; let changed = 0, same = 0;
              const g = s.design.graphics[0];
              // sample a grid inside the quad and the photo corners
              for (let i = 1; i < 10; i++) for (let j = 1; j < 10; j++) {
                const u = i / 10, v = j / 10;
                const x = (q[0][0] * (1 - u) + q[1][0] * u) * (1 - v) + (q[3][0] * (1 - u) + q[2][0] * u) * v;
                const y = (q[0][1] * (1 - u) + q[1][1] * u) * (1 - v) + (q[3][1] * (1 - u) + q[2][1] * u) * v;
                const d1 = px(a, x, y), d2 = px(b, x, y);
                if (Math.abs(d1[0] - d2[0]) + Math.abs(d1[1] - d2[1]) + Math.abs(d1[2] - d2[2]) > 30) changed++;
              }
              for (const [x, y] of [[5, 5], [p.w - 5, 5], [5, p.h - 5], [p.w - 5, p.h - 5]]) {
                const d1 = px(a, x, y), d2 = px(b, x, y);
                if (Math.abs(d1[0] - d2[0]) + Math.abs(d1[1] - d2[1]) + Math.abs(d1[2] - d2[2]) < 30) same++;
              }
              return [changed, same];
            })()""")
            if res[0] < 1 or res[1] != 4: raise AssertionError(f"changed {res[0]}, untouched corners {res[1]}/4")
            return f"{res[0]} of 81 samples in the print area carry artwork, photo outside untouched"
        await check("artwork warped into the print area only", photo_warp)

        async def photo_drag():
            before = await state("s.design.showcase.photos[0].quad[2]")
            h = pg.locator(".photo-handle[data-corner='2']"); bb = await h.bounding_box()
            await pg.mouse.move(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2); await pg.mouse.down()
            await pg.mouse.move(bb["x"] + 40, bb["y"] + 30, steps=6); await pg.mouse.up(); await pg.wait_for_timeout(500)
            after = await state("s.design.showcase.photos[0].quad[2]")
            await pg.keyboard.press("Control+z"); await pg.wait_for_timeout(200)
            undone = await state("s.design.showcase.photos[0].quad[2]")
            if not (after[0] > before[0] + 5 and abs(undone[0] - before[0]) < 0.01): raise AssertionError(f"{before} -> {after} -> undo {undone}")
            return f"corner moved {after[0]-before[0]:.0f}, {after[1]-before[1]:.0f} px; undo restores"
        await check("drag a corner, undo restores it", photo_drag)

        async def photo_export():
            path = await download(lambda: pg.click(".sc-toolbar >> text=Export PNG"), "photo.png")
            p = await state("s.design.showcase.photos[0]")
            return f"{Image.open(path).size}" if Image.open(path).size == (p["w"], p["h"]) else False
        await check("photo mockup exports at full photo size", photo_export)
        await pg.screenshot(path=f"{OUT}/p4-photo.png", timeout=90000)


        # ---------------- line sheet ----------------
        await tab("Line sheet")
        async def sheet_preview():
            await pg.wait_for_selector("[data-testid=sheet-page] img", timeout=20000)
            return f"{await pg.locator('[data-testid=sheet-page]').count()} style page(s)"
        await check("line sheet preview", sheet_preview)

        async def sheet_add_style():
            # save this project, rename it, then add the saved file as a second style
            proj = await download(lambda: pg.keyboard.press("Control+s"), "style-a.tforge")
            import json
            data = json.load(open(proj)); dd = data.get("design", data); dd["name"] = "Second style"; dd["template"] = "tee"
            path2 = f"{OUT}/style-b.tforge"; json.dump(data, open(path2, "w"))
            async with pg.expect_file_chooser() as fc:
                await pg.click("text=Add style file")
            await (await fc.value).set_files(path2)
            await pg.wait_for_function("document.querySelectorAll('[data-testid=sheet-page] .sheet-card').length === 2", timeout=30000)
            return "2 styles on the sheet"
        await check("add a second style from a project file", sheet_add_style)

        async def sheet_pdf():
            path = await download(lambda: pg.click("text=Line sheet PDF"), "linesheet.pdf")
            r = PdfReader(path); txt = "\n".join(p.extract_text() or "" for p in r.pages)
            name = await state("s.design.name")
            ok = len(r.pages) == 3 and name in txt and "Second style" in txt and "Order form" in txt and "3XL" in txt
            if not ok: raise AssertionError(f"{len(r.pages)} pages; text: {txt[:200]!r}")
            w, h = float(r.pages[1].mediabox.width) / 72, float(r.pages[1].mediabox.height) / 72
            return f"{len(r.pages)} pages ({w:.1f} x {h:.1f} in): cover, styles, order form"
        await check("line sheet PDF: cover, both styles, order form", sheet_pdf)

        # ---------------- present ----------------
        async def present():
            await pg.click("[data-testid=present-btn]")
            await pg.wait_for_selector(".present-dots button", timeout=30000)
            n = await pg.locator(".present-dots button").count()
            await pg.wait_for_timeout(300)
            await pg.keyboard.press("ArrowRight"); await pg.keyboard.press("ArrowRight"); await pg.wait_for_timeout(700)
            label = await pg.inner_text(".present-bar .mono")
            await pg.screenshot(path=f"{OUT}/p4-present.png", timeout=90000)
            await pg.keyboard.press("Escape"); await pg.wait_for_timeout(300)
            gone = await pg.locator("[data-testid=present]").count() == 0
            if n < 5 or not label.startswith("3 /") or not gone: raise AssertionError(f"{n} slides, label {label!r}, closed {gone}")
            return f"{n} slides (title, front, back, colorways, photo, details), arrows + Esc"
        await check("present mode: slides, keyboard, exit", present)

        # ---------------- 3D ----------------
        # CI has no GPU (software GL): keep the viewer still so it only renders on change
        await pg.evaluate("window.__threadforge.show.getState().set({ spin: false })")
        await tab("3D")
        async def three_d():
            await pg.wait_for_function("(() => { const t = document.querySelector('[data-testid=v3d-stats]'); return t && parseInt(t.textContent.replace(/,/g, '')) > 1000; })()", timeout=30000)
            await pg.wait_for_timeout(800)
            path = f"{OUT}/p4-3d.png"; await pg.locator("[data-testid=v3d]").screenshot(path=path, timeout=90000)
            im = Image.open(path).convert("L"); w, h = im.size
            px = [im.getpixel((x, y)) for x in range(0, w, 7) for y in range(0, h, 7)]
            mean = sum(px) / len(px); var = sum((v - mean) ** 2 for v in px) / len(px)
            if var < 200: raise AssertionError(f"flat image, variance {var:.0f}")
            return (await pg.inner_text("[data-testid=v3d-stats]")) + f", pixel variance {var:.0f}"
        await check("3D viewer builds a lit mesh from the flats", three_d)

        async def three_back():
            await pg.click(".sc-toolbar button:text-is('Back')"); await pg.wait_for_timeout(500)
            await pg.locator("[data-testid=v3d]").screenshot(path=f"{OUT}/p4-3d-back.png", timeout=90000)
            return await pg.evaluate("window.__threadforge.show.getState().spin") is False
        await check("camera presets stop the spin and turn to the back", three_back)

        async def turntable():
            await pg.click(".section .seg button:text-is('4 s')")
            # software GL in CI renders ~1 fps at 1080p: record a 2-second turn (60 frames) to keep the suite quick
            await pg.evaluate("window.__threadforge.show.getState().set({ recSeconds: 2 })")
            t = time.time()
            path = await download(lambda: pg.click("text=Record turntable"), "turntable", timeout=300000)
            took = time.time() - t
            size = os.path.getsize(path)
            head = open(path, "rb").read(64)
            kind = "webm" if head[:4] == b"\x1aE\xdf\xa3" else "mp4" if b"ftyp" in head[:12] else "?"
            if size < 50_000 or kind == "?": raise AssertionError(f"{size} bytes, {head[:12]!r}")
            info = f"{kind}, {size/1e6:.1f} MB, recorded in {took:.1f} s"
            if shutil.which("ffprobe"):
                out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=width,height,nb_read_frames", "-of", "csv=p=0", path], capture_output=True, text=True).stdout.strip()
                w, h, n = (int(x) for x in out.split(",")[:3])
                if (w, h) != (1080, 1080) or n != 60: raise AssertionError(f"ffprobe: {out}")
                info += f", {w}x{h}, {n} frames"
            return info
        await check("turntable records one full turn to video", turntable)
        print(f"\nShowcase flow took {time.time() - t0:.1f} s")
        await b.close()

asyncio.run(main())
for name, ok, info in results:
    print(("PASS " if ok else "FAIL ") + " " + name + (": " + info if info else ""))
passed = sum(1 for r in results if r[1])
print(f"\n{passed}/{len(results)} checks passed")
sys.exit(0 if passed == len(results) else 1)
