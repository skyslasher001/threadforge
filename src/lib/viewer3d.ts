// Real-time 3D garment viewer: an inflated shell from the flat front/back renders, lit, orbitable,
// with snapshot and turntable video recording. Three.js is loaded on first use to keep start-up fast.

import type * as T from "three";
import { inflate } from "./inflate";

export type LightPreset = "studio" | "warm" | "night";

export interface GarmentTextures {
  front: HTMLCanvasElement;
  back: HTMLCanvasElement; // rendered as seen from behind, same box as front
  box: { x0: number; y0: number; x1: number; y1: number }; // inches, symmetric about x = 0
  pxPerInch: number;
}

export interface Viewer {
  setGarment(t: GarmentTextures): void;
  setLight(p: LightPreset): void;
  setBackdrop(hex: string): void;
  setSpin(on: boolean, turnsPer10s: number): void;
  look(side: "front" | "back" | "left" | "right" | "three-quarter"): void;
  snapshot(size: number): Promise<Blob>;
  record(o: { w: number; h: number; seconds: number }, onProgress: (p: number) => void): Promise<{ blob: Blob; ext: string }>;
  stats(): { triangles: number; fps: number };
  dispose(): void;
}

export const VIDEO_TYPES = [
  { mime: "video/mp4;codecs=avc1.640028", ext: "mp4" },
  { mime: "video/mp4", ext: "mp4" },
  { mime: "video/webm;codecs=vp9", ext: "webm" },
  { mime: "video/webm;codecs=vp8", ext: "webm" },
  { mime: "video/webm", ext: "webm" },
];

export const pickVideoType = () =>
  typeof MediaRecorder === "undefined" ? null : VIDEO_TYPES.find((t) => MediaRecorder.isTypeSupported(t.mime)) ?? null;

const FPS = 30;
const CELL = 0.25;
const MASK_RES = 8; // silhouette samples per inch // inches between mesh vertices
const DEPTH = 4.2; // half thickness of the torso, inches
const REACH = 5.5;

export async function createViewer(host: HTMLElement): Promise<Viewer> {
  const THREE = await import("three");
  const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  const canvas = renderer.domElement;
  canvas.className = "v3d-canvas";
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#E9E7E2");
  const camera = new THREE.PerspectiveCamera(28, 1, 1, 2000);
  camera.position.set(0, 2, 92);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 30;
  controls.maxDistance = 220;
  controls.target.set(0, 0, 0);
  controls.autoRotate = true;

  // ---------- lights ----------
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8580, 1.6);
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0006;
  key.shadow.radius = 14;
  key.shadow.blurSamples = 20;
  const sc = key.shadow.camera as T.OrthographicCamera;
  sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 220;
  const rim = new THREE.DirectionalLight(0xffffff, 1.2);
  const rim2 = new THREE.DirectionalLight(0xffffff, 0);
  scene.add(hemi, key, rim, rim2, key.target);

  // ---------- floor ----------
  const floorMat = new THREE.ShadowMaterial({ opacity: 0.2 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  const blobTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, "rgba(0,0,0,0.5)");
    r.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  scene.add(floor, blob);

  const garment = new THREE.Group();
  scene.add(garment);
  let meshes: T.Mesh[] = [];
  let triangles = 0;

  const setLight = (p: LightPreset) => {
    const L = {
      studio: { hemi: [0xffffff, 0x9a958f, 2.3], key: [0xffffff, 2.0, 18, 70, 45], rim: [0xffffff, 1.4, -30, 25, -45], rim2: [0xffffff, 0.6, 35, 10, -30], floor: 0.16 },
      warm: { hemi: [0xfff1e0, 0x6b5040, 1.7], key: [0xffd2a0, 2.8, 45, 45, 34], rim: [0x9fc4ff, 1.1, -36, 22, -36], rim2: [0xffffff, 0, 0, 0, 0], floor: 0.22 },
      night: { hemi: [0x50507a, 0x101015, 1.1], key: [0xffffff, 1.4, 0, 60, 50], rim: [0x7c5cff, 3.6, -40, 14, -30], rim2: [0x3dd8ff, 3.0, 40, 14, -30], floor: 0.4 },
    }[p];
    hemi.color.setHex(L.hemi[0]); hemi.groundColor.setHex(L.hemi[1]); hemi.intensity = L.hemi[2];
    key.color.setHex(L.key[0]); key.intensity = L.key[1]; key.position.set(L.key[2], L.key[3], L.key[4]);
    rim.color.setHex(L.rim[0]); rim.intensity = L.rim[1]; rim.position.set(L.rim[2], L.rim[3], L.rim[4]);
    rim2.color.setHex(L.rim2[0]); rim2.intensity = L.rim2[1]; rim2.position.set(L.rim2[2], L.rim2[3], L.rim2[4]);
    floorMat.opacity = L.floor;
    dirty = true;
  };

  const texture = (src: HTMLCanvasElement) => {
    // bleed edge colors a few pixels outward so the cut at the silhouette never shows background or a dark fringe
    const c = document.createElement("canvas");
    c.width = src.width; c.height = src.height;
    const g = c.getContext("2d")!;
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = "destination-over";
    for (let r = 1; r <= 4; r++)
      for (let a = 0; a < 8; a++) g.drawImage(src, Math.round(Math.cos((a * Math.PI) / 4) * r), Math.round(Math.sin((a * Math.PI) / 4) * r));
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };

  const setGarment = (t: GarmentTextures) => {
    for (const m of meshes) {
      garment.remove(m);
      m.geometry.dispose();
      const mat = m.material as T.MeshStandardMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
    meshes = [];
    const { box, pxPerInch: k } = t;
    const alpha = (c: HTMLCanvasElement) => c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height);
    const fa = alpha(t.front), ba = alpha(t.back);
    const at = (img: ImageData, x: number, y: number) => {
      const px = Math.floor((x - box.x0) * k), py = Math.floor((y - box.y0) * k);
      if (px < 0 || py < 0 || px >= img.width || py >= img.height) return 0;
      return img.data[(py * img.width + px) * 4 + 3];
    };
    // fine silhouette (front ∪ mirrored back) for the distance field and edge snapping
    const mc = Math.round((box.x1 - box.x0) * MASK_RES), mr = Math.round((box.y1 - box.y0) * MASK_RES);
    const mask = new Uint8Array(mc * mr);
    let minY = Infinity, maxY = -Infinity;
    for (let my = 0; my < mr; my++)
      for (let mx = 0; mx < mc; mx++) {
        const x = box.x0 + (mx + 0.5) / MASK_RES, y = box.y0 + (my + 0.5) / MASK_RES;
        if (at(fa, x, y) > 140 || at(ba, -x, y) > 140) {
          mask[my * mc + mx] = 1;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    const shell = inflate({ mask, maskCols: mc, maskRows: mr, res: MASK_RES, cell: CELL, depth: DEPTH, reach: REACH });
    const cy = (minY + maxY) / 2;
    const W = box.x1 - box.x0, H = box.y1 - box.y0;
    const nv = shell.cols * shell.rows;
    const build = (side: 1 | -1, map: HTMLCanvasElement) => {
      const pos = new Float32Array(nv * 3);
      const uv = new Float32Array(nv * 2);
      for (let i = 0; i < nv; i++) {
        const x = box.x0 + shell.x[i], y = box.y0 + shell.y[i];
        pos[i * 3] = x;
        pos[i * 3 + 1] = -(y - cy);
        pos[i * 3 + 2] = side * shell.z[i];
        // the back texture is drawn as seen from behind: world +x is its -x
        uv[i * 2] = ((side === 1 ? x : -x) - box.x0) / W;
        uv[i * 2 + 1] = 1 - (y - box.y0) / H;
      }
      let index = shell.index;
      if (side === -1) {
        index = new Uint32Array(shell.index);
        for (let j = 0; j < index.length; j += 3) { const a = index[j + 1]; index[j + 1] = index[j + 2]; index[j + 2] = a; }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      g.setIndex(new THREE.BufferAttribute(index, 1));
      g.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ map: texture(map), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
      const m = new THREE.Mesh(g, mat);
      m.castShadow = true;
      m.receiveShadow = false;
      return m;
    };
    meshes = [build(1, t.front), build(-1, t.back)];
    garment.add(...meshes);
    dirty = true;
    triangles = shell.index.length / 3 * 2;
    const floorY = -(maxY - cy) - 1.2;
    floor.position.y = floorY;
    blob.position.y = floorY + 0.02;
    blob.scale.set(W * 0.75, DEPTH * 5, 1);
  };

  // ---------- loop ----------
  let spinSpeed = 1;
  let raf = 0;
  let last = performance.now();
  let frames = 0, fpsT = last, fps = 0;
  let rec = false; // true while the recorder drives frames
  let dirty = true;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (rec) return; // the recorder drives frames itself
    // render on demand: only while the camera moves, spins or something changed
    if (!controls.update(dt) && !dirty) return;
    dirty = false;
    renderer.render(scene, camera);
    frames++;
    if (now - fpsT > 1000) { fps = Math.round((frames * 1000) / (now - fpsT)); frames = 0; fpsT = now; }
  };

  const size = () => {
    if (rec) return;
    const r = host.getBoundingClientRect();
    renderer.setSize(Math.max(1, r.width), Math.max(1, r.height));
    camera.aspect = Math.max(1, r.width) / Math.max(1, r.height);
    camera.updateProjectionMatrix();
    dirty = true;
  };
  const ro = new ResizeObserver(size);
  ro.observe(host);
  size();
  setLight("studio");
  loop();

  const look = (side: "front" | "back" | "left" | "right" | "three-quarter") => {
    const d = camera.position.distanceTo(controls.target);
    const a = { front: 0, back: Math.PI, left: -Math.PI / 2, right: Math.PI / 2, "three-quarter": Math.PI / 5 }[side];
    garment.rotation.y = 0;
    camera.position.set(Math.sin(a) * d, controls.target.y + 2, Math.cos(a) * d);
    camera.lookAt(controls.target);
    dirty = true;
  };

  return {
    setGarment,
    setLight,
    setBackdrop: (hex) => { (scene.background as T.Color).set(hex); dirty = true; },
    setSpin: (on, s) => { controls.autoRotate = on; spinSpeed = s; controls.autoRotateSpeed = 6 * spinSpeed; dirty = true; },
    look,
    snapshot: async (px) => {
      const prev = renderer.getPixelRatio();
      const r = host.getBoundingClientRect();
      renderer.setPixelRatio(1);
      renderer.setSize(px, px, false);
      camera.aspect = 1;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      const out = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Snapshot failed"))), "image/png"));
      renderer.setPixelRatio(prev);
      renderer.setSize(r.width, r.height);
      camera.aspect = r.width / r.height;
      camera.updateProjectionMatrix();
      return out;
    },
    record: async ({ w, h, seconds }, onProgress) => {
      const prevRatio = renderer.getPixelRatio();
      renderer.setPixelRatio(1);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      const start = garment.rotation.y;
      rec = true; // pauses the live loop
      try {
        const frames = Math.round(seconds * FPS);
        const draw = (i: number) => { garment.rotation.y = start + (i / frames) * Math.PI * 2; renderer.render(scene, camera); };
        return (await encodeFrames(canvas, w, h, frames, draw, onProgress)) ?? (await recordRealtime(canvas, frames, draw, onProgress));
      } finally {
        rec = false;
        garment.rotation.y = start;
        renderer.setPixelRatio(prevRatio);
        size();
      }
    },
    stats: () => ({ triangles, fps }),
    dispose: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      for (const m of meshes) { m.geometry.dispose(); const mat = m.material as T.MeshStandardMaterial; mat.map?.dispose(); mat.dispose(); }
      blobTex.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Frame-exact encode with WebCodecs: every frame is rendered at its exact angle and timestamp,
 * so the loop is seamless and the clip is the right length however fast the GPU is.
 * Returns null when WebCodecs can't encode here (the caller falls back to real-time capture).
 */
export async function encodeFrames(canvas: HTMLCanvasElement, w: number, h: number, frames: number, draw: (i: number) => void, onProgress: (p: number) => void): Promise<{ blob: Blob; ext: string } | null> {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") return null;
  const bitrate = Math.round(w * h * FPS * 0.18);
  const candidates = [
    { codec: "avc1.640033", mux: "mp4" as const, muxCodec: "avc" as const },
    { codec: "avc1.4d0033", mux: "mp4" as const, muxCodec: "avc" as const },
    { codec: "vp09.00.40.08", mux: "webm" as const, muxCodec: "V_VP9" },
    { codec: "vp8", mux: "webm" as const, muxCodec: "V_VP8" },
  ];
  let pick: (typeof candidates)[number] | null = null;
  for (const c of candidates) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec: c.codec, width: w, height: h, bitrate, framerate: FPS });
      if (r.supported) { pick = c; break; }
    } catch { /* try the next codec */ }
  }
  if (!pick) return null;
  let addChunk: (c: EncodedVideoChunk, m?: EncodedVideoChunkMetadata) => void;
  let finish: () => Blob;
  if (pick.mux === "mp4") {
    const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({ target, video: { codec: "avc", width: w, height: h, frameRate: FPS }, fastStart: "in-memory" });
    addChunk = (c, m) => muxer.addVideoChunk(c, m);
    finish = () => { muxer.finalize(); return new Blob([target.buffer], { type: "video/mp4" }); };
  } else {
    const { Muxer, ArrayBufferTarget } = await import("webm-muxer");
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({ target, video: { codec: pick.muxCodec, width: w, height: h, frameRate: FPS } });
    addChunk = (c, m) => muxer.addVideoChunk(c, m);
    finish = () => { muxer.finalize(); return new Blob([target.buffer], { type: "video/webm" }); };
  }
  let failure: Error | null = null;
  const enc = new VideoEncoder({ output: (c, m) => addChunk(c, m), error: (e) => { failure = e as Error; } });
  enc.configure({ codec: pick.codec, width: w, height: h, bitrate, framerate: FPS, ...(pick.mux === "mp4" ? { avc: { format: "avc" } } : {}) } as VideoEncoderConfig);
  const us = 1e6 / FPS;
  for (let i = 0; i < frames; i++) {
    if (failure) throw failure;
    draw(i);
    const vf = new VideoFrame(canvas, { timestamp: Math.round(i * us), duration: Math.round(us) });
    enc.encode(vf, { keyFrame: i % (FPS * 2) === 0 });
    vf.close();
    onProgress((i + 1) / frames);
    while (enc.encodeQueueSize > 6) await tick();
    await tick();
  }
  await enc.flush();
  enc.close();
  if (failure) throw failure;
  return { blob: finish(), ext: pick.mux };
}

/** Fallback: capture the canvas in real time with MediaRecorder. */
async function recordRealtime(canvas: HTMLCanvasElement, frames: number, draw: (i: number) => void, onProgress: (p: number) => void): Promise<{ blob: Blob; ext: string }> {
  const type = pickVideoType();
  if (!type || !("captureStream" in canvas)) throw new Error("Video recording isn't supported here");
  const stream = canvas.captureStream(FPS);
  const mr = new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: 12_000_000 });
  const chunks: Blob[] = [];
  mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<void>((res) => (mr.onstop = () => res()));
  mr.start(250);
  const t0 = performance.now(), ms = (frames / FPS) * 1000;
  await new Promise<void>((res) => {
    const step = () => {
      const p = Math.min(1, (performance.now() - t0) / ms);
      draw(Math.round(p * frames));
      onProgress(p);
      if (p < 1) requestAnimationFrame(step);
      else setTimeout(res, 120);
    };
    step();
  });
  mr.stop();
  await done;
  stream.getTracks().forEach((t) => t.stop());
  return { blob: new Blob(chunks, { type: type.mime.split(";")[0] }), ext: type.ext };
}
