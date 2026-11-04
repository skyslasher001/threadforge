import { useEffect, useRef, useState } from "react";
import { useStore } from "../../state/store";
import { renderSig } from "../../state/showcase";

/** Run an async render whenever `key` changes; keeps the last good result while the next one runs. */
export function useAsync<T>(key: string, fn: () => Promise<T>, delay = 60): { value: T | null; busy: boolean; error: string | null } {
  const [state, setState] = useState<{ value: T | null; busy: boolean; error: string | null }>({ value: null, busy: true, error: null });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, busy: true }));
    const t = setTimeout(() => {
      fnRef.current()
        .then((value) => alive && setState({ value, busy: false, error: null }))
        .catch((e: Error) => alive && setState((s) => ({ ...s, busy: false, error: e.message })));
    }, delay);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [key, delay]);
  return state;
}

/** Signature of the current design's look; re-render when it changes. */
export function useDesignSig() {
  const d = useStore((s) => s.design);
  const processed = useStore((s) => s.processed);
  return renderSig(d, processed);
}

export function Busy({ on }: { on: boolean }) {
  return on ? <div className="sc-busy"><span className="spinner" /> Rendering…</div> : null;
}

export const canvasToBlob = (c: HTMLCanvasElement, type = "image/png", q = 0.92) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Could not encode image"))), type, q));

/** Fit a w×h box inside W×H. */
export const fitBox = (w: number, h: number, W: number, H: number) => {
  const s = Math.min(W / w, H / h);
  return { w: w * s, h: h * s, s };
};
