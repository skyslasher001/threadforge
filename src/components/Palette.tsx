import { useEffect, useMemo, useRef, useState } from "react";

export interface Command {
  id: string;
  label: string;
  group: string;
  keys?: string;
  run: () => void;
}

function score(q: string, text: string): number {
  if (!q) return 1;
  const t = text.toLowerCase();
  const s = q.toLowerCase();
  if (t.startsWith(s)) return 3;
  if (t.includes(s)) return 2;
  // subsequence match
  let i = 0;
  for (const ch of t) if (ch === s[i]) i++;
  return i === s.length ? 1 : 0;
}

export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const results = useMemo(
    () => commands.map((c) => ({ c, s: score(q, `${c.label} ${c.group}`) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.c).slice(0, 300),
    [q, commands],
  );
  useEffect(() => setI(0), [q]);
  useEffect(() => {
    list.current?.querySelector(".item.on")?.scrollIntoView({ block: "nearest" });
  }, [i]);
  const run = (c?: Command) => {
    if (!c) return;
    onClose();
    setTimeout(c.run, 0);
  };
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <input autoFocus placeholder="Search tools, garments, fabrics, colors, exports…" value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(results.length - 1, x + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
            if (e.key === "Enter") run(results[i]);
            if (e.key === "Escape") onClose();
          }} />
        <div className="items" ref={list}>
          {results.map((c, n) => (
            <div key={c.id} className={`item${n === i ? " on" : ""}`} onMouseMove={() => setI(n)} onClick={() => run(c)}>
              <span>{c.label}</span>
              <span className="grp">{c.group}</span>
              {c.keys && <span className="kbd">{c.keys}</span>}
            </div>
          ))}
          {!results.length && <div className="empty">No matches for “{q}”</div>}
        </div>
      </div>
    </div>
  );
}
