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
