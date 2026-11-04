"""Write release notes for a version from CHANGELOG.md. Usage: release_notes.py 0.3.0 out.md"""
import re, sys
version, out = sys.argv[1], sys.argv[2]
log = open("CHANGELOG.md", encoding="utf-8").read()
m = re.search(rf"^## {re.escape(version)}\b.*?$(.*?)(?=^## \d|\Z)", log, re.S | re.M)
section = m.group(1).strip() if m else "See CHANGELOG.md."
title = re.search(rf"^## {re.escape(version)}\s*[—-]?\s*(.*)$", log, re.M)
head = f"""Clothing design and mockup studio for Windows{": " + title.group(1) if title and title.group(1) else ""}.

**Install:** download `THREADFORGE_{version}_x64-setup.exe` below and run it.
Windows SmartScreen may warn because the app isn't code-signed yet: **More info → Run anyway**.

"""
open(out, "w", encoding="utf-8").write(head + section + "\n\nFull history: CHANGELOG.md\n")
