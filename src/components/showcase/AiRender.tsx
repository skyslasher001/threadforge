import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../../state/store";
import { previewsOf, useShow } from "../../state/showcase";
import type { AiRender as Render } from "../../types";
import { renderGarment } from "../../lib/render";
import { hf, MOTION_MODEL, motionBody, STILL_MODEL, stillBody } from "../../lib/higgsfield";
import { cancelJob, submitJob } from "../../lib/aijobs";
import { getMedia } from "../../lib/media";
import { download, slug } from "../../lib/exporting";
import { Seg } from "../Controls";
import { IcDownload, IcSparkle, IcTrash, IcX } from "../Icons";
import { canvasToBlob, useDesignSig } from "./common";
import { compositePhoto } from "./PhotoMockups";

// ---------------- prompt builder ----------------

export const CHIPS: { id: string; label: string; options: [string, string][] }[] = [
  { id: "shot", label: "Shot", options: [
    ["On-model studio", "A professional fashion photo of a model wearing"],
    ["Street lookbook", "A candid streetwear lookbook photo of a model wearing"],
    ["Editorial", "A high-fashion editorial photo of a model wearing"],
    ["Flat lay", "A styled overhead flat-lay product photo of"],
    ["Ghost mannequin", "An e-commerce ghost-mannequin product photo of"],
  ] },
  { id: "model", label: "Model", options: [["Any", ""], ["Woman", "The model is a woman."], ["Man", "The model is a man."], ["Two models", "Two models, one wearing the garment."]] },
  { id: "setting", label: "Setting", options: [
    ["Seamless studio", "Seamless light-grey studio backdrop."], ["City street", "On a city street with shallow depth of field."],
    ["Concrete loft", "In a sunlit concrete loft."], ["Rooftop", "On a rooftop at golden hour."], ["Desert", "In open desert under a clear sky."],
    ["Neon night", "At night under neon signs, wet pavement reflections."],
  ] },
  { id: "light", label: "Light", options: [["Soft box", "Soft, even softbox lighting."], ["Hard flash", "Direct hard flash, crisp shadows."], ["Golden hour", "Warm low golden-hour sun."], ["Overcast", "Soft overcast daylight."]] },
  { id: "frame", label: "Framing", options: [["Full body", "Full-body framing."], ["Waist up", "Framed from the waist up."], ["Detail", "Close-up on the artwork and fabric detail."]] },
];

export const KEEP = "Keep the garment exactly as in the reference image: same cut, color, fabric, graphics, text, placement and proportions. Photorealistic fabric texture with natural fit and folds.";
export const NEGATIVE = "altered logo, changed graphic, misspelled text, extra text, distorted print, wrong garment color, extra limbs, warped hands, low quality, blurry";

const defaults: Record<string, string> = { shot: "On-model studio", model: "Any", setting: "Seamless studio", light: "Soft box", frame: "Waist up" };

export function buildPrompt(chips: Record<string, string>, garment: string, extra: string): string {
  const pick = (id: string) => {
    const c = CHIPS.find((x) => x.id === id)!;
    return (c.options.find((o) => o[0] === (chips[id] ?? defaults[id])) ?? c.options[0])[1];
  };
  const product = ["Flat lay", "Ghost mannequin"].includes(chips.shot ?? defaults.shot);
  return [
    `${pick("shot")} the ${garment} shown in the reference image.`,
    product ? "" : pick("model"),
    pick("setting"), pick("light"), product ? "" : pick("frame"),
    KEEP, extra.trim(),
  ].filter(Boolean).join(" ");
}

export const MOTIONS: [string, string][] = [
  ["Slow turn", "The model slowly turns to show the garment from the side, smooth and natural."],
  ["Walk to camera", "The model walks slowly toward the camera, fabric moving naturally."],
  ["Wind in fabric", "A gentle breeze moves the fabric; subtle natural movement."],
  ["Push-in", "Slow cinematic push-in toward the artwork on the garment."],
];

// ---------------- sources ----------------

interface Source { id: string; label: string; render: () => Promise<HTMLCanvasElement> }

function useSources(): Source[] {
  const d = useStore((s) => s.design);
  return useMemo(() => {
    const st = () => useStore.getState();
    const flat = (view: "front" | "back") => async () => {
      const x = st();
      return (await renderGarment(x.design, { view, pxPerInch: 40, background: "#FFFFFF", previews: previewsOf(x.design, x.processed), margin: 2 })).canvas;
    };
    return [
      { id: "front", label: "Front flat", render: flat("front") },
      { id: "back", label: "Back flat", render: flat("back") },
      ...(d.showcase?.photos ?? []).map((p) => ({ id: `photo-${p.id}`, label: p.name, render: () => compositePhoto(st().design, st().processed, p, 2048) })),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.showcase?.photos]);
}

const pngBytes = async (c: HTMLCanvasElement) => new Uint8Array(await (await canvasToBlob(c, "image/png")).arrayBuffer());
const dataUrlBytes = async (u: string) => new Uint8Array(await (await fetch(u)).arrayBuffer());
const garmentWord = (t: string) => ({ tee: "t-shirt", longsleeve: "long-sleeve t-shirt", crewneck: "crewneck sweatshirt", hoodie: "pullover hoodie" } as Record<string, string>)[t] ?? "garment";

// ---------------- main view ----------------

export function AiView() {
  const d = useStore((s) => s.design);
  const sig = useDesignSig();
  const sh = useShow();
  const sources = useSources();
  const [source, setSource] = useState("front");
  const [resolution, setResolution] = useState<"1k" | "2k">("2k");
  const [aspect, setAspect] = useState("3:4");
  const [quote, setQuote] = useState<{ key: string; url: string; usd: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [open, setOpen] = useState<Render | null>(null);
  const renders = d.showcase?.renders ?? [];
  const prompt = buildPrompt(sh.chips, garmentWord(d.template), sh.extra);
  const params = { prompt, negative: NEGATIVE, resolution, aspect };
  const srcKey = `${sig}|${source}`;
  const quoteKey = JSON.stringify([srcKey, params]);
  const backend = hf();

  useEffect(() => { backend.hasKey().then(setHasKey).catch(() => setHasKey(false)); }, [backend, sh.keyVersion]);

  const uploaded = useRef<{ key: string; url: string } | null>(null);
  const prepare = async () => {
    setBusy("Uploading reference…");
    try {
      let url = uploaded.current?.key === srcKey ? uploaded.current.url : null;
      if (!url) {
        const s = sources.find((x) => x.id === source) ?? sources[0];
        url = await backend.upload(await pngBytes(await s.render()), "image/png");
        uploaded.current = { key: srcKey, url };
      }
      setBusy("Getting price…");
      const usd = await backend.estimate(STILL_MODEL.path, stillBody(params, url));
      setQuote({ key: quoteKey, url, usd });
    } catch (e) {
      useStore.getState().toast((e as Error).message, "warn");
    }
    setBusy(null);
  };
  const generate = async () => {
    if (!quote || quote.key !== quoteKey) return;
    setBusy("Submitting…");
    await submitJob({ kind: "image", model: STILL_MODEL.path, body: stillBody(params, quote.url), prompt, usd: quote.usd });
    setQuote(null);
    setBusy(null);
  };
  const quoted = quote?.key === quoteKey;

  return (
    <div className="sc-body ai">
      <div className="ai-compose">
        <div className="ai-row">
          <span className="ai-label">Reference</span>
          <div className="seg">{sources.map((s) => <button key={s.id} className={s.id === source ? "on" : ""} onClick={() => setSource(s.id)}>{s.label}</button>)}</div>
        </div>
        {CHIPS.map((c) => (
          <div key={c.id} className="ai-row">
            <span className="ai-label">{c.label}</span>
            <div className="chips">
              {c.options.map(([label]) => {
                const on = (sh.chips[c.id] ?? defaults[c.id]) === label;
                return <button key={label} className={`chip${on ? " on" : ""}`} onClick={() => sh.set({ chips: { ...sh.chips, [c.id]: label } })}>{label}</button>;
              })}
            </div>
          </div>
        ))}
        <div className="ai-row">
          <span className="ai-label">Add</span>
          <input className="input" style={{ flex: 1 }} placeholder="Anything else: styling, mood, props…" value={sh.extra} onChange={(e) => sh.set({ extra: e.target.value })} />
        </div>
        <div className="ai-row">
          <span className="ai-label">Output</span>
          <Seg value={resolution} options={[{ v: "1k", l: "1K" }, { v: "2k", l: "2K" }]} onChange={setResolution} />
          <div className="seg">{STILL_MODEL.aspects.map((a) => <button key={a} className={a === aspect ? "on" : ""} onClick={() => setAspect(a)}>{a}</button>)}</div>
        </div>
        <div className="ai-prompt mono" data-testid="ai-prompt">{prompt}</div>
        <div className="ai-go">
          {backend.demo && <span className="pill warn">Demo mode</span>}
          <span className="faint small">{STILL_MODEL.name} via Higgsfield · billed to your Higgsfield account</span>
          <div className="spacer" />
          {hasKey === false && !backend.demo ? (
            <button className="btn primary" onClick={() => useStore.getState().set({ sideTab: "props", sideOpen: true })}>Add API key in the panel →</button>
          ) : quoted ? (
            <button className="btn primary" disabled={!!busy} onClick={generate} data-testid="ai-generate"><IcSparkle size={14} /> Generate · ${quote!.usd}</button>
          ) : (
            <button className="btn primary" disabled={!!busy || hasKey === false} onClick={prepare} data-testid="ai-price">{busy ?? "Check price"}</button>
          )}
        </div>
      </div>
      <div className="ai-results" data-testid="ai-results">
        {!renders.length && <div className="faint" style={{ padding: 30, textAlign: "center" }}>Renders appear here. Each one is saved in this project, and clips stay on this computer.</div>}
        {renders.map((r) => <RenderCard key={r.id} r={r} onOpen={() => setOpen(r)} />)}
      </div>
      {open && <Lightbox r={renders.find((x) => x.id === open.id) ?? open} onClose={() => setOpen(null)} />}
    </div>
  );
}

const STATUS: Record<string, string> = { queued: "Queued", in_progress: "Rendering", completed: "Done", failed: "Failed", nsfw: "Blocked", canceled: "Canceled", estimating: "Pricing" };

function useVideoUrl(r: Render) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!r.videoKey) return;
    let u: string | null = null;
    getMedia(r.videoKey).then((b) => { if (b) { u = URL.createObjectURL(b); setUrl(u); } });
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [r.videoKey]);
  return url;
}

function RenderCard({ r, onOpen }: { r: Render; onOpen: () => void }) {
  const video = useVideoUrl(r);
  const running = r.status === "queued" || r.status === "in_progress";
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - r.createdAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [running, r.createdAt]);
  return (
    <div className={`ai-card ${r.status}`} data-testid="ai-card" data-status={r.status} data-kind={r.kind}>
      <div className="ai-media" onClick={() => r.status === "completed" && onOpen()}>
        {r.kind === "video" && video ? <video src={video} poster={r.src} muted loop autoPlay playsInline /> : r.src ? <img src={r.src} alt="" /> : null}
        {running && <div className="ai-run"><span className="spinner" /> {STATUS[r.status]} · {elapsed}s</div>}
        {(r.status === "failed" || r.status === "nsfw") && <div className="ai-err">{r.error ?? "Failed"}</div>}
      </div>
      <div className="ai-meta">
        <span className={`pill ${r.status === "completed" ? "good" : running ? "" : "warn"}`}>{r.kind === "video" ? "Clip" : "Still"} · {STATUS[r.status] ?? r.status}</span>
        {r.mock && <span className="pill warn">Demo</span>}
        {r.usd && <span className="mono faint small">${r.usd}</span>}
        <div className="spacer" />
        {running && <button className="btn icon sm ghost" title="Cancel" onClick={() => cancelJob(r.id)}><IcX size={12} /></button>}
        {r.status === "completed" && <button className="btn icon sm ghost" title="Save" onClick={() => saveRender(r)}><IcDownload size={13} /></button>}
        {!running && <button className="btn icon sm ghost danger" title="Delete" onClick={() => useStore.getState().setRenders((rs) => rs.filter((x) => x.id !== r.id))}><IcTrash size={13} /></button>}
      </div>
    </div>
  );
}

function Lightbox({ r, onClose }: { r: Render; onClose: () => void }) {
  const video = useVideoUrl(r);
  const [motion, setMotion] = useState(MOTIONS[0][0]);
  const [duration, setDuration] = useState<5 | 10>(5);
  const [aspect, setAspect] = useState<string>("9:16");
  const [quote, setQuote] = useState<{ key: string; url: string; usd: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const prompt = MOTIONS.find((m) => m[0] === motion)![1] + " " + KEEP;
  const params = { prompt, duration, aspect, sound: false };
  const key = JSON.stringify(params);
  const backend = hf();
  const price = async () => {
    setBusy("Uploading still…");
    try {
      const url = quote?.url ?? (await backend.upload(await dataUrlBytes(r.src!), r.src!.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png"));
      setBusy("Getting price…");
      setQuote({ key, url, usd: await backend.estimate(MOTION_MODEL.path, motionBody(params, url)) });
    } catch (e) {
      useStore.getState().toast((e as Error).message, "warn");
    }
    setBusy(null);
  };
  const animate = async () => {
    if (!quote) return;
    await submitJob({ kind: "video", model: MOTION_MODEL.path, body: motionBody(params, quote.url), prompt, usd: quote.usd, parentId: r.id, poster: r.src });
    onClose();
  };
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ai-lightbox">
        <div className="ai-lb-media">{r.kind === "video" && video ? <video src={video} controls autoPlay loop playsInline /> : <img src={r.src} alt="" />}</div>
        <div className="ai-lb-side">
          <div className="row between"><b>{r.kind === "video" ? "Motion clip" : "On-model render"}</b><button className="btn icon ghost" onClick={onClose}><IcX /></button></div>
          <div className="faint small" style={{ lineHeight: 1.5 }}>{r.prompt}</div>
          <button className="btn" onClick={() => saveRender(r)}><IcDownload size={13} /> Save {r.kind === "video" ? "clip" : "image"}</button>
          {r.kind === "image" && (
            <div className="section" style={{ padding: "12px 0 0", border: 0 }}>
              <span className="section-title">Animate with {MOTION_MODEL.name}</span>
              <div className="chips">{MOTIONS.map(([m]) => <button key={m} className={`chip${m === motion ? " on" : ""}`} onClick={() => setMotion(m)}>{m}</button>)}</div>
              <Seg full value={String(duration)} options={[{ v: "5", l: "5 s" }, { v: "10", l: "10 s" }]} onChange={(v) => setDuration(+v as 5 | 10)} />
              <Seg full value={aspect} options={MOTION_MODEL.aspects.map((a) => ({ v: a, l: a }))} onChange={setAspect} />
              {quote?.key === key ? (
                <button className="btn primary" onClick={animate} data-testid="ai-animate"><IcSparkle size={14} /> Animate · ${quote.usd}</button>
              ) : (
                <button className="btn primary" disabled={!!busy} onClick={price} data-testid="ai-animate-price">{busy ?? "Check price"}</button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

async function saveRender(r: Render) {
  const st = useStore.getState();
  const base = `${slug(st.design.name)}-${r.kind === "video" ? "clip" : "render"}-${r.id}`;
  try {
    if (r.kind === "video" && r.videoKey) {
      const b = await getMedia(r.videoKey);
      if (!b) throw new Error("Clip not found on this computer");
      const where = await download(b, `${base}.${b.type.includes("webm") ? "webm" : "mp4"}`);
      if (where) st.toast("Clip saved", "good");
    } else if (r.src) {
      const where = await download(r.src, `${base}.${r.src.startsWith("data:image/jpeg") ? "jpg" : "png"}`);
      if (where) st.toast("Render saved", "good");
    }
  } catch (e) {
    st.toast((e as Error).message, "warn");
  }
}

// ---------------- side panel: key ----------------

export function AiPanel() {
  const backend = hf();
  const sh = useShow();
  const [has, setHas] = useState<boolean | null>(null);
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { backend.hasKey().then(setHas).catch(() => setHas(false)); }, [backend, sh.keyVersion]);
  const renders = useStore((s) => s.design.showcase?.renders ?? []);
  const spent = renders.filter((r) => r.status === "completed" && r.usd && !r.mock).reduce((a, r) => a + parseFloat(r.usd!), 0);
  const save = async () => {
    setErr(null);
    try {
      await backend.setKey(id, secret);
      setId(""); setSecret("");
      sh.set({ keyVersion: sh.keyVersion + 1 });
      useStore.getState().toast("API key saved to Windows Credential Manager", "good");
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <>
      <div className="section">
        <div className="section-head"><span className="section-title">Higgsfield</span>
          {backend.demo ? <span className="pill warn">Demo</span> : has ? <span className="pill good">Connected</span> : <span className="pill">No key</span>}</div>
        {backend.demo ? (
          <div className="notice warn">Demo mode: this browser preview has no safe place for an API key, so renders here are placeholders and nothing is charged. The desktop app uses your Higgsfield account.</div>
        ) : has ? (
          <>
            <span className="faint small">Your key is stored in Windows Credential Manager, never in project files. Jobs are billed to your Higgsfield account; every job shows its price first.</span>
            <button className="btn sm ghost danger" onClick={async () => { await backend.clearKey(); sh.set({ keyVersion: sh.keyVersion + 1 }); }}>Remove key</button>
          </>
        ) : (
          <>
            <span className="faint small">Create a key in your Higgsfield account (API keys), then paste the key ID and secret. It's stored in Windows Credential Manager.</span>
            <input className="input" placeholder="Key ID" value={id} onChange={(e) => setId(e.target.value)} autoComplete="off" spellCheck={false} />
            <input className="input" placeholder="Secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} />
            {err && <div className="notice warn">{err}</div>}
            <button className="btn primary sm" disabled={!id || !secret} onClick={save}>Save key</button>
          </>
        )}
      </div>
      <div className="section">
        <span className="section-title">Models</span>
        <span className="faint small"><b>{STILL_MODEL.name}</b> turns your flat or photo mockup into on-model and lookbook stills while keeping the artwork. <b>{MOTION_MODEL.name}</b> animates a finished still into a 5 or 10 second clip.</span>
        <div className="row between small"><span className="faint">Renders in this project</span><span className="mono">{renders.length}</span></div>
        <div className="row between small"><span className="faint">Spent on completed jobs</span><span className="mono">${spent.toFixed(2)}</span></div>
      </div>
    </>
  );
}
