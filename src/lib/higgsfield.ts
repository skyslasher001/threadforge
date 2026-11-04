// Higgsfield client. In the desktop app every call goes through the Rust bridge (src-tauri/src/higgsfield.rs),
// which holds the key in Windows Credential Manager. In a plain browser there's no safe place for a key,
// so a clearly-labelled demo backend runs instead: same flow, placeholder results, no charges.

import { isTauri } from "./native";
import { encodeFrames } from "./viewer3d";

export type HfStatus = "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";
export interface HfJob { status: HfStatus; request_id: string; images?: { url: string }[]; video?: { url: string }; error?: string }

export interface HfBackend {
  demo: boolean;
  hasKey(): Promise<boolean>;
  setKey(id: string, secret: string): Promise<void>;
  clearKey(): Promise<void>;
  upload(bytes: Uint8Array, contentType: string): Promise<string>;
  estimate(model: string, body: object): Promise<string>; // USD
  submit(model: string, body: object, idempotencyKey: string): Promise<HfJob>;
  status(requestId: string): Promise<HfJob>;
  cancel(requestId: string): Promise<void>;
  download(url: string): Promise<Uint8Array>;
}

// ---------------- models ----------------

export const STILL_MODEL = {
  path: "alibaba/qwen-image-3/edit",
  name: "Qwen Image 3 Edit",
  aspects: ["1:1", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9"] as const,
};
export const MOTION_MODEL = {
  path: "kling-video/v2.6/pro/image-to-video",
  name: "Kling 2.6 Pro",
  aspects: ["9:16", "1:1", "16:9"] as const,
};

export interface StillParams { prompt: string; negative: string; resolution: "1k" | "2k"; aspect: string; seed?: number }
export const stillBody = (p: StillParams, imageUrl: string) => ({
  prompt: p.prompt,
  image_urls: [imageUrl],
  resolution: p.resolution,
  aspect_ratio: p.aspect,
  negative_prompt: p.negative || undefined,
  seed: p.seed,
  prompt_extend: false, // keep the garment exactly as described
});

export interface MotionParams { prompt: string; duration: 5 | 10; aspect: string; sound: boolean }
export const motionBody = (p: MotionParams, imageUrl: string) => ({
  prompt: p.prompt,
  image_url: imageUrl,
  duration: p.duration,
  aspect_ratio: p.aspect,
  sound: p.sound ? "on" : "off",
  cfg_scale: 0.5,
});

// ---------------- desktop backend (Rust bridge) ----------------

async function invoke<T>(cmd: string, args?: Record<string, unknown> | Uint8Array, headers?: Record<string, string>): Promise<T> {
  const { invoke: inv } = await import("@tauri-apps/api/core");
  try {
    return await inv<T>(cmd, args as never, headers ? { headers } : undefined);
  } catch (e) {
    throw new Error(typeof e === "string" ? e : (e as Error).message ?? String(e));
  }
}

const desktop: HfBackend = {
  demo: false,
  hasKey: () => invoke<boolean>("hf_key_status"),
  setKey: (id, secret) => invoke("hf_set_key", { id, secret }),
  clearKey: () => invoke("hf_clear_key"),
  upload: (bytes, contentType) => invoke<string>("hf_upload", bytes, { "x-content-type": contentType }),
  estimate: async (model, body) => String((await invoke<{ usd: string }>("hf_estimate", { model, body })).usd),
  submit: (model, body, idempotencyKey) => invoke<HfJob>("hf_submit", { model, body, idempotencyKey }),
  status: (requestId) => invoke<HfJob>("hf_status", { requestId }),
  cancel: (requestId) => invoke("hf_cancel", { requestId }),
  download: async (url) => new Uint8Array(await invoke<ArrayBuffer>("hf_download", { url })),
};

// ---------------- demo backend (browser / tests) ----------------

const demoFiles = new Map<string, Blob>();
const demoJobs = new Map<string, { at: number; model: string; body: Record<string, unknown>; canceled?: boolean; out?: string }>();
let demoKey = true; // the demo needs no key
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DEMO_MS = 1600;

async function demoStill(src: Blob, prompt: string): Promise<Blob> {
  const img = await createImageBitmap(src);
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 1280;
  const g = c.getContext("2d")!;
  const bg = g.createLinearGradient(0, 0, 0, c.height);
  bg.addColorStop(0, "#d9d4cb"); bg.addColorStop(1, "#8f897f");
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  const s = Math.min((c.width * 0.8) / img.width, (c.height * 0.72) / img.height);
  g.save();
  g.shadowColor = "rgba(0,0,0,0.35)"; g.shadowBlur = 50; g.shadowOffsetY = 24;
  g.drawImage(img, (c.width - img.width * s) / 2, c.height * 0.1, img.width * s, img.height * s);
  g.restore();
  g.fillStyle = "rgba(0,0,0,0.55)"; g.fillRect(0, c.height - 120, c.width, 120);
  g.fillStyle = "#fff"; g.font = "700 30px Inter, sans-serif"; g.fillText("DEMO RENDER · no API call was made", 36, c.height - 70);
  g.font = "400 20px Inter, sans-serif"; g.fillStyle = "rgba(255,255,255,0.75)";
  g.fillText(prompt.slice(0, 90) + (prompt.length > 90 ? "…" : ""), 36, c.height - 36);
  return new Promise((res) => c.toBlob((b) => res(b!), "image/png"));
}

async function demoClip(src: Blob): Promise<Blob> {
  const img = await createImageBitmap(src);
  const c = document.createElement("canvas");
  c.width = 480; c.height = 600;
  const g = c.getContext("2d")!;
  const frames = 48;
  const draw = (i: number) => {
    const z = 1 + (i / frames) * 0.12;
    g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height);
    const s = Math.max(c.width / img.width, c.height / img.height) * z;
    g.drawImage(img, (c.width - img.width * s) / 2, (c.height - img.height * s) / 2, img.width * s, img.height * s);
  };
  const out = await encodeFrames(c, c.width, c.height, frames, draw, () => undefined);
  if (!out) throw new Error("This browser can't encode video");
  return out.blob;
}

const demo: HfBackend = {
  demo: true,
  hasKey: async () => demoKey,
  setKey: async () => { demoKey = true; },
  clearKey: async () => { demoKey = false; },
  upload: async (bytes, contentType) => {
    const url = `demo://upload/${demoFiles.size + 1}`;
    demoFiles.set(url, new Blob([bytes as BlobPart], { type: contentType }));
    return url;
  },
  estimate: async (model, body) => {
    await sleep(150);
    const b = body as Record<string, unknown>;
    if (model === MOTION_MODEL.path) return (b.duration === 10 ? 0.7 : 0.35).toFixed(3);
    return b.resolution === "2k" ? "0.094" : "0.047";
  },
  submit: async (model, body) => {
    await sleep(120);
    const id = `demo-${Math.random().toString(36).slice(2, 10)}`;
    demoJobs.set(id, { at: performance.now(), model, body: body as Record<string, unknown> });
    return { status: "queued", request_id: id };
  },
  status: async (id) => {
    const j = demoJobs.get(id);
    if (!j) throw new Error("Unknown request");
    if (j.canceled) return { status: "canceled", request_id: id };
    const t = performance.now() - j.at;
    if (t < DEMO_MS * 0.3) return { status: "queued", request_id: id };
    if (t < DEMO_MS) return { status: "in_progress", request_id: id };
    if (!j.out) {
      const srcUrl = (j.model === MOTION_MODEL.path ? j.body.image_url : (j.body.image_urls as string[])[0]) as string;
      const src = demoFiles.get(srcUrl);
      if (!src) return { status: "failed", request_id: id, error: "Source image missing" };
      const blob = j.model === MOTION_MODEL.path ? await demoClip(src) : await demoStill(src, String(j.body.prompt ?? ""));
      j.out = `demo://result/${id}`;
      demoFiles.set(j.out, blob);
    }
    return j.model === MOTION_MODEL.path ? { status: "completed", request_id: id, video: { url: j.out } } : { status: "completed", request_id: id, images: [{ url: j.out }] };
  },
  cancel: async (id) => { const j = demoJobs.get(id); if (j) j.canceled = true; },
  download: async (url) => {
    const b = demoFiles.get(url);
    if (!b) throw new Error("Result expired");
    return new Uint8Array(await b.arrayBuffer());
  },
};

export const hf = (): HfBackend => (isTauri() ? desktop : demo);
