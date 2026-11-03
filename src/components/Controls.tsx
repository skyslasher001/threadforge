import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Units } from "../types";
import { fmt, parseLen } from "../data/measurements";

export function Slider({ value, min, max, step = 0.01, onChange, onCommit, display }: {
  value: number; min: number; max: number; step?: number; onChange: (v: number) => void; onCommit?: () => void; display?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider">
      <input type="range" min={min} max={max} step={step} value={value}
        style={{ ["--pct" as string]: `${pct}%` }}
        onPointerDown={onCommit}
        onChange={(e) => onChange(parseFloat(e.target.value))} />
      <div className="slider-val">{display ?? value}</div>
    </div>
  );
}

export function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: string }) {
  return (
    <div className="toggle" onClick={() => onChange(!on)} role="switch" aria-checked={on} title={hint}>
      <span>{label}</span>
      <span className={`switch${on ? " on" : ""}`} />
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, full }: { value: T; options: { v: T; l: ReactNode }[]; onChange: (v: T) => void; full?: boolean }) {
  return (
    <div className={`seg${full ? " full" : ""}`}>
      {options.map((o) => (
        <button key={o.v} className={o.v === value ? "on" : ""} onClick={() => onChange(o.v)}>{o.l}</button>
      ))}
    </div>
  );
}

/**
 * Length field: shows inches as fractions or cm; accepts either typed format.
 * Only an actual edit commits (leaving a cell never rounds the stored value);
 * Escape cancels; arrow keys nudge and update the visible text.
 */
export function LenInput({ value, units, onChange, className = "input num", min = 0, max = 99 }: {
  value: number; units: Units; onChange: (inches: number) => void; className?: string; min?: number; max?: number;
}) {
  const [text, setText] = useState(fmt(value, units));
  const textRef = useRef(text);
  const dirty = useRef(false);
  const focused = useRef(false);
  const show = (t: string) => { textRef.current = t; setText(t); };
  useEffect(() => {
    if (!focused.current || !dirty.current) show(fmt(value, units));
  }, [value, units]);
  const commit = () => {
    if (!dirty.current) return;
    dirty.current = false;
    const v = parseLen(textRef.current, units);
    if (v !== null) onChange(Math.max(min, Math.min(max, v)));
    else show(fmt(value, units));
  };
  return (
    <input className={className} value={text}
      onFocus={(e) => { focused.current = true; dirty.current = false; e.currentTarget.select(); }}
      onBlur={() => { commit(); focused.current = false; show(fmt(value, units)); }}
      onChange={(e) => { dirty.current = true; show(e.target.value); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        if (e.key === "Escape") { dirty.current = false; show(fmt(value, units)); (e.currentTarget as HTMLInputElement).blur(); }
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const base = dirty.current ? parseLen(textRef.current, units) ?? value : value;
          dirty.current = false;
          const stepIn = units === "cm" ? (e.shiftKey ? 0.1 : 1) / 2.54 : e.shiftKey ? 0.125 : 0.5;
          const v = +Math.max(min, Math.min(max, base + (e.key === "ArrowUp" ? stepIn : -stepIn))).toFixed(4);
          onChange(v);
          show(fmt(v, units));
        }
      }} />
  );
}

export function ColorChip({ value, onChange, title, onOpen }: { value: string; onChange: (v: string) => void; title?: string; onOpen?: () => void }) {
  return (
    <label className="color-chip" style={{ background: value }} title={title} onClick={onOpen}>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} />
    </label>
  );
}
