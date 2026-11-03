"""
End-to-end test of the THREADFORGE UI in headless Chrome.

Usage:  python3 tests/e2e.py <path-to-dist-single/index.html> <out-dir> [chrome-path]
Every check runs even if an earlier one fails; the script exits 1 if any check failed.
"""
import asyncio, json, math, os, struct, sys, zlib
from playwright.async_api import async_playwright

HTML, OUT = sys.argv[1], sys.argv[2]
CHROME = sys.argv[3] if len(sys.argv) > 3 else None
os.makedirs(OUT, exist_ok=True)
results = []


def png(path, w=1200, h=900):
    """Write a test artwork PNG (three flat colors on white) without external libraries."""
    rows = []
    for y in range(h):
        row = bytearray([0])
        for x in range(w):
            dx, dy = x - w / 2, y - h / 2
            r = math.hypot(dx, dy)
            if r < 160: c = (224, 102, 58)
            elif r < 300: c = (20, 20, 24)
            elif abs(dx) < 420 and abs(dy) < 330: c = (242, 209, 107)
            else: c = (255, 255, 255)
            row += bytes(c)
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 6)
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", raw) + chunk(b"IEND", b""))


ART = os.path.join(OUT, "test-art.png")
png(ART)


async def main():
    async with async_playwright() as p:
        kw = {"args": ["--no-sandbox"]}
        if CHROME: kw["executable_path"] = CHROME
        browser = await p.chromium.launch(**kw)
        ctx = await browser.new_context(viewport={"width": 1480, "height": 920}, accept_downloads=True)
        pg = await ctx.new_page()
        errors = []
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        async def state(expr):
            return await pg.evaluate(f"(() => {{ const s = window.__threadforge.store.getState(); return {expr}; }})()")

        async def check(name, fn):
            before = len(errors)
            # Release focus from inputs/dropdowns so keyboard shortcuts reach the app, as a click on the canvas would.
            await pg.evaluate("document.activeElement && document.activeElement.blur && document.activeElement.blur()")
            try:
                ok = await fn()
                if ok is False: raise AssertionError("returned False")
                if len(errors) > before: raise AssertionError("console errors: " + " | ".join(errors[before:])[:300])
                results.append((name, True, ""))
            except Exception as e:  # keep going
                results.append((name, False, str(e)[:300]))
                await pg.screenshot(path=os.path.join(OUT, f"fail-{len(results):02d}.png"))

        async def stage_point(fx, fy):
            b = await pg.locator(".stage").bounding_box()
            return b["x"] + b["width"] * fx, b["y"] + b["height"] * fy

        async def draw(fx, fy, n=24, hold=0, dx=5, wobble=3):
            x, y = await stage_point(fx, fy)
            await pg.mouse.move(x, y); await pg.mouse.down()
            for i in range(n): await pg.mouse.move(x + i * dx, y + math.sin(i / 2) * wobble, steps=2)
            if hold: await pg.wait_for_timeout(hold)
            await pg.mouse.up(); await pg.wait_for_timeout(60)

        async def front_point(ix, iy):
            """Screen point for garment coordinates (inches) on the front view."""
            return await pg.evaluate(f"""(() => {{
              const s = window.__threadforge.store.getState(); const c = s.camera;
              const r = document.querySelector('.stage').getBoundingClientRect();
              return [r.left + c.x + (33 + {ix}) * c.s, r.top + c.y + (17 + {iy}) * c.s];
            }})()""")

        await pg.goto("file://" + HTML)
        await pg.wait_for_timeout(700)

        # ---------- start flows ----------
        await check("welcome dialog on first launch", lambda: pg.locator(".welcome-card").is_visible())
        for tpl, label in [("tee", "Classic Tee"), ("longsleeve", "Long Sleeve Tee"), ("crewneck", "Crewneck Sweatshirt"), ("hoodie", "Pullover Hoodie")]:
            async def start(tpl=tpl, label=label):
                if not await pg.locator(".welcome-card").is_visible():
                    await pg.keyboard.press("Control+n"); await pg.wait_for_timeout(200)
                await pg.click(f".welcome-card >> text={label}")
                await pg.click("text=Start with sample artwork"); await pg.wait_for_timeout(900)
                t = await state("s.design.template"); g = await state("s.design.graphics.length")
                return t == tpl and g == 1
            await check(f"start {tpl} with sample artwork", start)

        # ---------- parts ----------
        await pg.keyboard.press("Control+n"); await pg.wait_for_timeout(200)
        await pg.click(".welcome-card >> text=Classic Tee"); await pg.click("text=Start blank"); await pg.wait_for_timeout(500)
        for grp, label, key, val in [("Fit", "Boxy", "fit", "boxy"), ("Neckline", "V-neck", "neck", "v"), ("Neckline", "Mock", "neck", "mock"),
                                     ("Sleeve", "Raglan", "sleeve", "raglan"), ("Sleeve", "Drop shoulder", "sleeve", "drop"), ("Pocket", "Chest", "pocket", "chest"),
                                     ("Fit", "Oversized", "fit", "oversized"), ("Fit", "Regular", "fit", "regular")]:
            async def part(grp=grp, label=label, key=key, val=val):
                await pg.locator(".field", has=pg.locator(f".label:text-is('{grp}')")).locator(f"button:text-is('{label}')").click()
                return await state(f"s.design.parts.{key}") == val
            await check(f"part {grp} = {label}", part)
        await check("boxy/regular fit rewrites chest spec", lambda: _eq(state("s.design.base.A"), 21))

        # ---------- brushes ----------
        await pg.keyboard.press("b"); await pg.wait_for_timeout(150)
        styles = await pg.locator(".brush-card .nm").all_inner_texts()
        await check("12 brush styles listed", lambda: _true(len(styles) == 12))
        for i, name in enumerate(styles):
            async def brush(i=i, name=name):
                n0 = await state("s.design.strokes.length")
                await pg.locator(".brush-card").nth(i).click()
                await draw(0.12 + (i % 3) * 0.06, 0.45 + (i // 3) * 0.06, n=16)
                return await state("s.design.strokes.length") == n0 + 1
            await check(f"draw with {name}", brush)

        async def canvas_has_ink():
            return await pg.evaluate("""(() => { const c = document.querySelectorAll('.layer-canvas')[0];
              const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
              for (let i = 3; i < d.length; i += 4 * 16) if (d[i] > 0) n++; return n > 200; })()""")
        await pg.wait_for_timeout(250)
        await check("stroke canvas shows ink", canvas_has_ink)

        async def symmetry():
            await pg.keyboard.press("x")
            n0 = await state("s.design.strokes.length")
            await draw(0.2, 0.62, n=12)
            await pg.keyboard.press("x")
            return await state("s.design.strokes.length") == n0 + 2
        await check("mirror drawing adds a mirrored stroke", symmetry)

        async def quickshape():
            await pg.locator(".brush-card").first.click()
            x, y = await stage_point(0.25, 0.55)
            await pg.mouse.move(x, y); await pg.mouse.down()
            for t in range(26): await pg.mouse.move(x + math.cos(t / 12 * math.pi) * 40 - 40, y + math.sin(t / 12 * math.pi) * 40, steps=2)
            await pg.wait_for_timeout(700); await pg.mouse.up()
            pts = await state("s.design.strokes[s.design.strokes.length-1].points.length")
            return pts == 73  # 72-segment ellipse
        await check("QuickShape snaps a circle to an ellipse", quickshape)

        async def eraser():
            n0 = await state("s.design.strokes.length")
            await pg.keyboard.press("e"); await draw(0.12, 0.45, n=20); await pg.keyboard.press("b")
            return await state("s.design.strokes[s.design.strokes.length-1].style") == "erase" and await state("s.design.strokes.length") == n0 + 1
        await check("eraser stroke on active layer", eraser)

        # ---------- layers ----------
        await pg.keyboard.press("l"); await pg.wait_for_timeout(200)
        async def add_layer():
            n0 = await state("s.design.layers.filter(l => l.view === 'front').length")
            await pg.click("text=New layer")
            return await state("s.design.layers.filter(l => l.view === 'front').length") == n0 + 1
        await check("add layer", add_layer)

        async def rename():
            await pg.locator(".layer-row.on .layer-name").dblclick()
            await pg.keyboard.press("Control+a"); await pg.keyboard.type("Ink pass"); await pg.keyboard.press("Enter")
            return await state("s.layerFor('front').name") == "Ink pass"
        await check("rename layer", rename)

        async def draw_on_new_layer():
            await pg.keyboard.press("b")
            await draw(0.18, 0.5, n=14)
            lid = await state("s.layerFor('front').id")
            return await state(f"s.design.strokes[s.design.strokes.length-1].layerId") == lid
        await check("new strokes land on the active layer", draw_on_new_layer)

        async def hidden_blocks_drawing():
            await pg.locator(".layer-row.on button[title='Hide layer']").click()
            n0 = await state("s.design.strokes.length")
            await draw(0.18, 0.55, n=10)
            ok = await state("s.design.strokes.length") == n0 and await state("s.layerFor('front').visible") is False
            await pg.locator(".layer-row.on button[title='Show layer']").click()
            return ok
        await check("hidden layer blocks drawing (with warning)", hidden_blocks_drawing)

        async def locked_blocks_drawing():
            await pg.locator(".layer-row.on button[title='Lock layer']").click()
            n0 = await state("s.design.strokes.length")
            await draw(0.18, 0.55, n=10)
            ok = await state("s.design.strokes.length") == n0
            await pg.locator(".layer-row.on button[title='Unlock layer']").click()
            return ok
        await check("locked layer blocks drawing", locked_blocks_drawing)

        async def duplicate():
            n0 = await state("s.design.strokes.length"); k = await state("s.design.strokes.filter(x => x.layerId === s.layerFor('front').id).length")
            await pg.click(".section >> button:text-is('Duplicate')")
            return await state("s.design.strokes.length") == n0 + k
        await check("duplicate layer copies strokes", duplicate)

        async def merge():
            n0 = await state("s.design.layers.length"); s0 = await state("s.design.strokes.length")
            await pg.click("text=Merge down")
            return await state("s.design.layers.length") == n0 - 1 and await state("s.design.strokes.length") == s0
        await check("merge down keeps strokes", merge)

        async def opacity_blend():
            await pg.click(".field >> button:text-is('Multiply')")
            return await state("s.layerFor('front').blend") == "multiply"
        await check("layer blend mode", opacity_blend)

        async def reorder():
            await pg.click("text=New layer")
            ids0 = await state("s.design.layers.filter(l => l.view === 'front').map(l => l.id)")
            rows = pg.locator(".layer-row")
            await rows.nth(0).drag_to(rows.nth(await rows.count() - 1))
            ids1 = await state("s.design.layers.filter(l => l.view === 'front').map(l => l.id)")
            return ids0 != ids1 and sorted(ids0) == sorted(ids1)
        await check("drag to reorder layers", reorder)

        async def delete_layer():
            n0 = await state("s.design.layers.length")
            await pg.locator(".section", has=pg.locator("text=New layer")).locator("button.danger").click()
            return await state("s.design.layers.length") == n0 - 1
        await check("delete layer", delete_layer)

        # ---------- history ----------
        await pg.keyboard.press("y"); await pg.wait_for_timeout(200)
        async def undo_redo():
            n = await state("s.past.length")
            await pg.keyboard.press("Control+z"); await pg.keyboard.press("Control+z")
            a = await state("s.past.length")
            await pg.keyboard.press("Control+Shift+z")
            b = await state("s.past.length")
            return a == n - 2 and b == n - 1
        await check("undo / redo", undo_redo)

        async def jump():
            await pg.locator(".history-item").last.click()  # oldest
            ok = await state("s.past.length") == 0
            await pg.locator(".history-item").first.click()  # newest
            return ok and await state("s.future.length") == 0
        await check("jump to any history step", jump)

        async def snapshots():
            await pg.fill("#snap-name", "before cleanup")
            await pg.click(".section >> button:text-is('Save')")
            strokes = await state("s.design.strokes.length")
            await pg.keyboard.press("y"); await pg.keyboard.press("b")
            await draw(0.2, 0.5, n=10)
            await pg.keyboard.press("y"); await pg.wait_for_timeout(150)
            await pg.click("button:text-is('Restore')")
            return await state("s.design.strokes.length") == strokes
        await check("save and restore a snapshot", snapshots)

        # ---------- sketch to flat / restyle ----------
        await pg.click(".side-tab >> text=Properties"); await pg.keyboard.press("b"); await pg.wait_for_timeout(150)
        async def sketch_to_flat():
            await pg.keyboard.press("l"); await pg.click(".layer-row >> nth=-1"); await pg.click(".side-tab >> text=Properties")
            n0 = await state("s.design.layers.length")
            await pg.click("text=Sketch to flat")
            return await state("s.design.layers.length") == n0 + 1 and await state("s.layerFor('front').name") == "Flat lines"
        await check("sketch to flat creates a clean layer", sketch_to_flat)

        async def restyle():
            await pg.select_option("select[aria-label='Restyle as']", "chrome")
            await pg.click("button:text-is('Restyle')")
            return await state("s.design.strokes.filter(x => x.layerId === s.layerFor('front').id).every(x => x.style === 'chrome')")
        await check("restyle a layer", restyle)

        # ---------- artwork ----------
        await pg.keyboard.press("v")
        async def add_art():
            async with pg.expect_file_chooser() as fc:
                await pg.click("button[aria-label='Add image']")
            await (await fc.value).set_files(ART)
            await pg.wait_for_timeout(1200)
            return await state("s.design.graphics.length") >= 1 and await state("s.selected") is not None
        await check("add artwork from file", add_art)

        async def move_art():
            g = await state("s.design.graphics.find(g => g.id === s.selected)")
            x, y = await front_point(g["x"], g["y"])
            await pg.mouse.move(x, y); await pg.mouse.down(); await pg.mouse.move(x + 60, y + 40, steps=6); await pg.mouse.up()
            g2 = await state("s.design.graphics.find(g => g.id === s.selected)")
            return abs(g2["x"] - g["x"]) > 0.5
        await check("drag artwork", move_art)

        async def scale_art():
            w0 = await state("s.design.graphics.find(g => g.id === s.selected).w")
            h = pg.locator("[data-handle='scale']").nth(2)
            b = await h.bounding_box()
            await pg.mouse.move(b["x"] + 4, b["y"] + 4); await pg.mouse.down(); await pg.mouse.move(b["x"] + 40, b["y"] + 40, steps=6); await pg.mouse.up()
            return await state("s.design.graphics.find(g => g.id === s.selected).w") > w0
        await check("resize artwork with handle", scale_art)

        async def rotate_art():
            b = await pg.locator("[data-handle='rotate']").bounding_box()
            await pg.mouse.move(b["x"] + 6, b["y"] + 6); await pg.mouse.down(); await pg.mouse.move(b["x"] + 90, b["y"] + 30, steps=6); await pg.mouse.up()
            return abs(await state("s.design.graphics.find(g => g.id === s.selected).rotation")) > 5
        await check("rotate artwork with handle", rotate_art)

        async def snap_zone():
            await pg.click("button:text-is('Center chest')")
            g = await state("s.design.graphics.find(g => g.id === s.selected)")
            return g["rotation"] == 0 and g["x"] == 0
        await check("snap artwork to a print zone", snap_zone)

        for label, method in [("Embroidery", "embroidery"), ("DTG", "dtg"), ("Screen print", "screen")]:
            async def set_method(label=label, method=method):
                await pg.click(f".seg >> button:text-is('{label}')"); await pg.wait_for_timeout(500)
                return await state("s.design.graphics.find(g => g.id === s.selected).method") == method
            await check(f"decoration method {label}", set_method)

        async def screens_listed():
            await pg.wait_for_timeout(800)
            return await state("(s.processed[s.selected]?.inks.length ?? 0) >= 2")
        await check("screen separation computes inks", screens_listed)

        async def remove_bg():
            src0 = await state("s.design.graphics.find(g => g.id === s.selected).src.length")
            await pg.click("text=Remove background"); await pg.wait_for_timeout(1200)
            return await state("s.design.graphics.find(g => g.id === s.selected).src.length") != src0
        await check("remove background", remove_bg)

        async def copy_back():
            n0 = await state("s.design.graphics.length")
            await pg.click("text=Copy to back")
            return await state("s.design.graphics.length") == n0 + 1 and await state("s.design.graphics[s.design.graphics.length-1].view") == "back"
        await check("copy artwork to back", copy_back)

        async def delete_key():
            n0 = await state("s.design.graphics.length")
            await pg.keyboard.press("Delete")
            return await state("s.design.graphics.length") == n0 - 1
        await check("delete artwork with Delete key", delete_key)

        # ---------- measurements ----------
        await pg.keyboard.press("3"); await pg.wait_for_timeout(400)
        async def edit_fraction():
            cell = pg.locator(".spec tbody tr").first.locator("input").first
            await cell.fill("22 3/8"); await cell.press("Enter"); await pg.wait_for_timeout(150)
            return abs(await state("s.design.base.A") - 22.375) < 1e-6
        await check("edit chest with a fraction", edit_fraction)

        async def edit_cm():
            await pg.click(".section .seg >> button:text-is('cm')")
            cell = pg.locator(".spec tbody tr").nth(1).locator("input").first
            await cell.fill("76.2"); await cell.press("Enter"); await pg.wait_for_timeout(150)
            got = await state("s.design.base.B")
            ok = abs(got - 30.0) < 1e-3
            if not ok: print("DEBUG cm:", got, await state("s.units"), await cell.input_value(), await pg.locator(".spec tbody tr").nth(1).inner_text())
            await pg.click(".section .seg >> button:text-is('in')")
            return ok
        await check("edit length in centimeters", edit_cm)

        async def no_silent_rounding():
            await pg.click(".section .seg >> button:text-is('cm')")
            before = await state("JSON.stringify(s.design.base)")
            inputs = pg.locator(".spec tbody input")
            await inputs.first.focus()
            for _ in range(8): await pg.keyboard.press("Tab")
            await pg.evaluate("document.activeElement.blur()"); await pg.wait_for_timeout(100)
            after = await state("JSON.stringify(s.design.base)")
            await pg.click(".section .seg >> button:text-is('in')")
            return before == after
        await check("tabbing through cells never rounds stored values", no_silent_rounding)

        async def escape_cancels():
            cell = pg.locator(".spec tbody tr").nth(2).locator("input").first
            v0 = await state("s.design.base.C")
            await cell.fill("40"); await cell.press("Escape"); await pg.wait_for_timeout(100)
            return await state("s.design.base.C") == v0 and await cell.input_value() != "40"
        await check("Escape cancels a cell edit", escape_cancels)

        async def arrow_nudge():
            cell = pg.locator(".spec tbody tr").nth(2).locator("input").first
            v0 = await state("s.design.base.C")
            await cell.focus(); await pg.keyboard.press("ArrowUp"); await pg.wait_for_timeout(80)
            shown = await cell.input_value()
            await pg.keyboard.press("Escape")
            return abs(await state("s.design.base.C") - (v0 + 0.5)) < 1e-6 and shown != ""
        await check("arrow keys nudge by 1/2 in and update the cell", arrow_nudge)

        async def compare():
            await pg.select_option("#compare-size", "XL"); await pg.wait_for_timeout(200)
            return await state("s.compareSize") == "XL"
        await check("fit compare ghost", compare)

        async def csv():
            async with pg.expect_download() as d:
                await pg.click(".section >> button:has-text('CSV')")
            path = os.path.join(OUT, "spec.csv"); await (await d.value).save_as(path)
            text = open(path).read()
            return "22 3/8" in text and "Chest width" in text
        await check("spec CSV export", csv)
        await pg.select_option("#compare-size", "")

        # ---------- export / save / open ----------
        await pg.keyboard.press("1")
        async def mockup():
            async with pg.expect_download() as d:
                await pg.keyboard.press("Control+e")
            path = os.path.join(OUT, "mockup.png"); await (await d.value).save_as(path)
            return os.path.getsize(path) > 50_000
        await check("mockup PNG export", mockup)

        async def save_open():
            sk, gr, ly = await state("s.design.strokes.length"), await state("s.design.graphics.length"), await state("s.design.layers.length")
            async with pg.expect_download() as d:
                await pg.keyboard.press("Control+s")
            path = os.path.join(OUT, "project.tforge"); await (await d.value).save_as(path)
            await pg.keyboard.press("Control+n"); await pg.click(".welcome-card >> text=Pullover Hoodie"); await pg.click("text=Start blank")
            async with pg.expect_file_chooser() as fc:
                await pg.keyboard.press("Control+o")
            await (await fc.value).set_files(path); await pg.wait_for_timeout(600)
            return (await state("s.design.strokes.length"), await state("s.design.graphics.length"), await state("s.design.layers.length")) == (sk, gr, ly)
        await check("save project and open it again", save_open)

        # ---------- palette: run every safe command ----------
        await pg.keyboard.press("Control+k"); await pg.wait_for_timeout(150)
        labels = await pg.locator(".palette .item > span:first-child").all_inner_texts()
        await pg.keyboard.press("Escape")
        skip = ("Add image", "Open project", "Save project", "New design", "benchmark", "Check for updates", "Export")
        ran = 0
        for label in labels:
            if any(k.lower() in label.lower() for k in skip): continue
            async def run(label=label):
                await pg.keyboard.press("Control+k"); await pg.keyboard.type(label); await pg.wait_for_timeout(40)
                await pg.keyboard.press("Enter"); await pg.wait_for_timeout(120)
                await pg.keyboard.press("Escape")
                return True
            await check(f"command: {label}", run); ran += 1
        await check("palette lists commands", lambda: _true(ran > 40))

        # ---------- panels ----------
        async def resize_panel():
            w0 = await state("s.sideWidth")
            b = await pg.locator(".side-resize").bounding_box()
            await pg.mouse.move(b["x"] + 3, b["y"] + 200); await pg.mouse.down(); await pg.mouse.move(b["x"] - 80, b["y"] + 200, steps=5); await pg.mouse.up()
            return await state("s.sideWidth") > w0
        await check("resize side panel", resize_panel)

        async def hide_panels():
            await pg.keyboard.press("Control+Backslash")
            hidden = await state("!s.sideOpen")
            await pg.keyboard.press("Control+Backslash")
            return hidden and await state("s.sideOpen")
        await check("hide and show panels", hide_panels)

        # ---------- migration of an old v0.1 autosave ----------
        async def migrate():
            old = {"name": "Old", "template": "tee", "fabricId": "hw-jersey", "trimFabricId": "rib", "bodyColor": "#E9E4D8", "trimColor": "#E9E4D8",
                   "colorways": [], "base": {"A": 21, "B": 29, "C": 19, "D": 8.5, "E": 9.5, "G": 7.25, "H": 21, "I": 7.5, "J": 3.75, "JB": 1, "K3": 0.875},
                   "grade": {"A": 2}, "previewSize": "M", "graphics": [],
                   "strokes": [{"id": "s1", "view": "front", "style": "ink", "color": "#000", "size": 0.2, "opacity": 1, "seed": 1, "points": [{"x": 0, "y": 5, "p": .5}, {"x": 2, "y": 6, "p": .5}]}]}
            await pg.evaluate(f"localStorage.setItem('threadforge.autosave.v1', {json.dumps(json.dumps(old))})")
            await pg.reload(); await pg.wait_for_timeout(900)
            return await state("s.design.name") == "Old" and await state("s.design.strokes[0].layerId === s.design.layers[0].id") and await state("s.design.parts.neck") == "crew"
        await check("old v0.1 autosave migrates", migrate)

        # ---------- benchmark ----------
        async def bench():
            await pg.keyboard.press("Control+k"); await pg.keyboard.type("benchmark"); await pg.keyboard.press("Enter")
            await pg.wait_for_timeout(5500)
            rows = await pg.locator(".perf-table tbody tr").count()
            restored = await state("s.design.name") == "Old"
            return rows >= 6 and restored
        await check("benchmark runs and leaves the design untouched", bench)

        await pg.screenshot(path=os.path.join(OUT, "final.png"))
        await browser.close()


async def _eq(coro, v):
    return (await coro) == v


async def _true(v):
    return v

asyncio.run(main())
passed = sum(1 for r in results if r[1])
for name, ok, msg in results:
    if not ok: print(f"FAIL  {name}: {msg}")
print(f"\n{passed}/{len(results)} checks passed")
sys.exit(0 if passed == len(results) else 1)
