// Runs Higgsfield jobs: submit, poll until done, then keep the result with the project.
// Jobs survive an app restart: anything still queued is picked up again on launch.

import { uid, useStore } from "../state/store";
import type { AiRender } from "../types";
import { hf, MOTION_MODEL } from "./higgsfield";
import { putMedia } from "./media";

const TERMINAL = new Set(["completed", "failed", "nsfw", "canceled"]);
const tracking = new Set<string>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const patch = (id: string, p: Partial<AiRender>) => useStore.getState().setRenders((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
const find = (id: string) => useStore.getState().design.showcase?.renders.find((r) => r.id === id);

async function toDataUrl(bytes: Uint8Array, type: string): Promise<string> {
  const blob = new Blob([bytes as BlobPart], { type });
  if (blob.size < 2_500_000) {
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });
  }
  // keep project files reasonable: large stills are stored as high-quality JPEG
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = bmp.width; c.height = bmp.height;
  c.getContext("2d")!.drawImage(bmp, 0, 0);
  return c.toDataURL("image/jpeg", 0.92);
}

const sniff = (b: Uint8Array) =>
  b[0] === 0x89 && b[1] === 0x50 ? "image/png" : b[0] === 0xff && b[1] === 0xd8 ? "image/jpeg" : b[0] === 0x52 && b[8] === 0x57 ? "image/webp"
  : b[0] === 0x1a && b[1] === 0x45 ? "video/webm" : "video/mp4";

/** Submit a job (price already shown to the user) and start tracking it. */
export async function submitJob(o: { kind: "image" | "video"; model: string; body: object; prompt: string; usd?: string; parentId?: string; poster?: string }): Promise<string> {
  const id = uid();
  const rec: AiRender = { id, kind: o.kind, model: o.model, prompt: o.prompt, status: "queued", createdAt: Date.now(), usd: o.usd, parentId: o.parentId, mock: hf().demo, src: o.poster };
  useStore.getState().setRenders((rs) => [rec, ...rs]);
  try {
    const job = await hf().submit(o.model, o.body, `tf-${id}-${Date.now().toString(36)}`);
    patch(id, { requestId: job.request_id, status: job.status });
    track(id);
  } catch (e) {
    patch(id, { status: "failed", error: (e as Error).message });
  }
  return id;
}

export async function cancelJob(id: string) {
  const r = find(id);
  if (!r?.requestId || TERMINAL.has(r.status)) return;
  try {
    await hf().cancel(r.requestId);
    patch(id, { status: "canceled" });
  } catch (e) {
    useStore.getState().toast(`Couldn't cancel: ${(e as Error).message}`, "warn");
  }
}

export function track(id: string) {
  if (tracking.has(id)) return;
  tracking.add(id);
  (async () => {
    let wait = 1200, errors = 0;
    try {
      for (;;) {
        const r = find(id);
        if (!r || !r.requestId || TERMINAL.has(r.status)) return;
        let job;
        try {
          job = await hf().status(r.requestId);
          errors = 0;
        } catch (e) {
          if (++errors >= 6) { patch(id, { status: "failed", error: (e as Error).message }); return; }
          await sleep(wait * 2);
          continue;
        }
        if (job.status !== r.status && job.status !== "completed") patch(id, { status: job.status, error: job.error });
        if (job.status === "completed") {
          const url = r.kind === "video" ? job.video?.url : job.images?.[0]?.url;
          if (!url) { patch(id, { status: "failed", error: "Finished without a result" }); return; }
          const bytes = await hf().download(url);
          if (r.kind === "video") {
            const key = `render-${id}`;
            await putMedia(key, new Blob([bytes as BlobPart], { type: sniff(bytes) }));
            patch(id, { status: "completed", videoKey: key });
          } else {
            patch(id, { status: "completed", src: await toDataUrl(bytes, sniff(bytes)) });
          }
          useStore.getState().toast(r.kind === "video" ? "Motion clip ready" : "On-model render ready", "good");
          return;
        }
        if (TERMINAL.has(job.status)) {
          if (job.status === "nsfw") patch(id, { error: "Higgsfield's content filter blocked this result. Credits are usually refunded." });
          return;
        }
        await sleep(wait);
        wait = Math.min(6000, wait * 1.35);
      }
    } catch (e) {
      patch(id, { status: "failed", error: (e as Error).message });
    } finally {
      tracking.delete(id);
    }
  })();
}

/** On launch: keep following jobs that were still running when the app closed. */
export function resumeJobs() {
  for (const r of useStore.getState().design.showcase?.renders ?? []) if (r.requestId && !TERMINAL.has(r.status)) track(r.id);
}

export const isMotion = (r: AiRender) => r.model === MOTION_MODEL.path;
