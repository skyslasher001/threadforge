"""
Phase 3 end-to-end checks: embroidery files, actual-size film PDF and tech pack PDF,
produced through the real UI and validated with pyembroidery and pypdf.
Usage: python3 tests/e2e_phase3.py <dist-single/index.html> <out-dir> [chrome]
"""
import asyncio, os, sys
from playwright.async_api import async_playwright
import pyembroidery
from pypdf import PdfReader

HTML, OUT = sys.argv[1], sys.argv[2]
CHROME = sys.argv[3] if len(sys.argv) > 3 else None
os.makedirs(OUT, exist_ok=True)
results = []

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
                results.append((name, False, str(e)[:300])); await pg.screenshot(path=f"{OUT}/fail-{len(results)}.png")
        async def download(click, name):
            async with pg.expect_download(timeout=60000) as d:
                await click()
            path = f"{OUT}/{name}"; await (await d.value).save_as(path); return path

        await pg.goto("file://" + HTML); await pg.wait_for_timeout(700)
        await pg.click(".welcome-card >> text=Pullover Hoodie"); await pg.click("text=Start with sample artwork"); await pg.wait_for_timeout(2500)

        async def emb_panel():
            await pg.wait_for_selector("text=Embroidery file", timeout=20000)
            await pg.wait_for_selector(".stat-grid >> nth=-1", timeout=20000)
            return await pg.locator("text=hoop").first.is_visible()
        await check("embroidery panel shows stats and hoop", emb_panel)

        for fmt in ("dst", "pes", "exp", "jef", "vp3"):
            async def emb(fmt=fmt):
                path = await download(lambda: pg.click(f"button:text-is('{fmt.upper()}')"), f"badge.{fmt}")
                pat = pyembroidery.read(path)
                st = sum(1 for s in pat.stitches if (s[2] & 0xFF) == pyembroidery.STITCH)
                bx = pat.bounds(); w = (bx[2] - bx[0]) / 10
                if st < 2000 or not (100 < w < 125): raise AssertionError(f"{st} stitches, {w:.1f} mm wide")
                return f"{st:,} stitches, {w:.1f} mm wide, {pat.count_color_changes()} color changes"
            await check(f"{fmt.upper()} export reads back in pyembroidery", emb)

        async def player():
            await pg.locator(".section", has=pg.locator("text=Stitch-out preview")).locator("input[type=range]").fill("0.5")
            await pg.wait_for_timeout(300)
            return " of " in (await pg.locator("text=Stitch-out preview").inner_text()).lower()
        await check("stitch-out player", player)

        # screen print graphic
        await pg.click(".seg >> button:text-is('Screen print')"); await pg.wait_for_timeout(1200)
        async def ink():
            await pg.select_option("#ink-type", "water")
            return await pg.locator("text=Suggested print order").is_visible()
        await check("ink type + print order", ink)

        async def films():
            path = await download(lambda: pg.click("text=Films PDF (actual size)"), "films.pdf")
            r = PdfReader(path)
            g = await pg.evaluate("(() => { const s = window.__threadforge.store.getState(); return s.design.graphics[0]; })()")
            w_in = float(r.pages[0].mediabox.width) / 72
            if not (abs(w_in - max(8.5, g["w"] + 2.5)) < 0.05): raise AssertionError(f"page {w_in} in wide")
            img = r.pages[0].images[0]
            return f"{len(r.pages)} screens, page {w_in:.2f} in wide, film image {img.image.size}"
        await check("film PDF at actual size, one page per screen", films)

        # tech pack
        await pg.keyboard.press("4"); await pg.wait_for_timeout(500)
        async def tp_fields():
            await pg.fill("#tp-styleNumber", "TF-0042"); await pg.fill("#tp-season", "FW26"); await pg.fill("#cost-laborCMT", "6.5")
            return await pg.evaluate("window.__threadforge.store.getState().design.techpack.styleNumber") == "TF-0042"
        await check("tech pack fields", tp_fields)

        async def techpack():
            path = await download(lambda: pg.click("text=Export tech pack PDF"), "techpack.pdf")
            r = PdfReader(path)
            text = "\n".join(pg_.extract_text() for pg_ in r.pages)
            for must in ("TF-0042", "Graded spec sheet", "Bill of materials", "Chest width", "Costing", "Revision log", "Construction"):
                if must not in text: raise AssertionError(f"missing '{must}'")
            return f"{len(r.pages)} pages"
        await check("tech pack PDF content", techpack)
        await b.close()

asyncio.run(main())
for name, ok, msg in results:
    print(("PASS  " if ok else "FAIL  ") + name + (f": {msg}" if msg else ""))
print(f"\n{sum(1 for r in results if r[1])}/{len(results)} checks passed")
sys.exit(0 if all(r[1] for r in results) else 1)
