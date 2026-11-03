"""
Verify THREADFORGE's DST / EXP / PES writers against pyembroidery (pip install pyembroidery).

1. Byte-for-byte: feed the same stitch stream to pyembroidery's format writers.
2. Read-back: open each file with pyembroidery's readers and compare stitches, colors, size.
3. Machine limits: every move fits the DST record (<= 12.1 mm per axis).
Usage: python3 tests/embroidery_check.py <dir written by tests/embroidery_gen.ts>
"""
import io, json, sys
import pyembroidery
from pyembroidery import EmbPattern, EmbThread
import importlib
DstWriter = importlib.import_module("pyembroidery.DstWriter")
ExpWriter = importlib.import_module("pyembroidery.ExpWriter")
PesWriter = importlib.import_module("pyembroidery.PesWriter")

d = sys.argv[1]
data = json.load(open(f"{d}/stream.json"))
fails = []

def pattern():
    p = EmbPattern()
    for x, y, c in data["stitches"]:
        p.stitches.append([x, y, c])
    for col in data["threads"]:
        t = EmbThread(); t.color = col; p.threadlist.append(t)
    p.metadata("name", data["name"])
    return p

for ext, writer, settings in [("dst", DstWriter, None), ("exp", ExpWriter, None), ("pes", PesWriter, {"truncated": True, "version": 1})]:
    buf = io.BytesIO()
    writer.write(pattern(), buf, settings)
    ref = buf.getvalue()
    mine = open(f"{d}/test.{ext}", "rb").read()
    if ref == mine:
        print(f"{ext.upper()}: byte-identical to pyembroidery ({len(mine):,} bytes)")
    else:
        first = next((i for i in range(min(len(ref), len(mine))) if ref[i] != mine[i]), min(len(ref), len(mine)))
        fails.append(f"{ext}: differs at byte {first} (mine {len(mine)}, ref {len(ref)})")

stream = data["stitches"]
n_st = sum(1 for s in stream if s[2] == 0)
n_cc = sum(1 for s in stream if s[2] == 5)
for ext in ("dst", "exp", "pes"):
    p = pyembroidery.read(f"{d}/test.{ext}")
    if p is None:
        fails.append(f"{ext}: pyembroidery could not read it"); continue
    st = sum(1 for s in p.stitches if (s[2] & 0xFF) == pyembroidery.STITCH)
    cc = p.count_color_changes()
    b = p.bounds()
    w, h = (b[2] - b[0]) / 10, (b[3] - b[1]) / 10
    print(f"{ext.upper()} read back: {st:,} stitches, {cc} color changes, {w:.1f} x {h:.1f} mm, {len(p.threadlist)} threads")
    if abs(st - n_st) > n_st * 0.01: fails.append(f"{ext}: stitch count {st} vs {n_st}")
    if ext != "exp" and cc != n_cc: fails.append(f"{ext}: color changes {cc} vs {n_cc}")

px = py = 0
for x, y, c in stream:
    if c in (0, 1) and (abs(x - px) > 121 or abs(y - py) > 121):
        fails.append(f"move too long at {x},{y}"); break
    if c in (0, 1): px, py = x, y

print("\n" + ("ALL EMBROIDERY CHECKS PASSED" if not fails else "FAILURES:\n" + "\n".join(fails)))
sys.exit(1 if fails else 0)
