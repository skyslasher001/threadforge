// Native file access when running inside the Tauri shell, with browser fallbacks
// so the same UI also runs in a normal browser (dev server, web preview).

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface FileFilter {
  name: string;
  extensions: string[];
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function toBytes(data: Blob | string | Uint8Array): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data;
  if (typeof data === "string") return data.startsWith("data:") ? dataUrlToBytes(data) : new TextEncoder().encode(data);
  return new Uint8Array(await data.arrayBuffer());
}

function browserDownload(data: Blob | string | Uint8Array, filename: string) {
  const blob =
    typeof data === "string"
      ? data.startsWith("data:")
        ? null
        : new Blob([data])
      : data instanceof Uint8Array
        ? new Blob([data as BlobPart])
        : data;
  const url = blob ? URL.createObjectURL(blob) : (data as string);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (blob) setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Save a file. In the desktop app this opens the native Save As dialog.
 * Returns the saved path (desktop), "download" (browser) or null if cancelled.
 */
export async function saveFile(data: Blob | string | Uint8Array, filename: string, filters?: FileFilter[]): Promise<string | null> {
  if (!isTauri()) {
    browserDownload(data, filename);
    return "download";
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const { writeFile } = await import("@tauri-apps/plugin-fs");
  const path = await save({ defaultPath: filename, filters });
  if (!path) return null;
  await writeFile(path, await toBytes(data));
  return path;
}

/** Pick and read one file. Returns null when cancelled. */
export async function openFile(filters: FileFilter[], accept: string): Promise<{ name: string; bytes: Uint8Array } | null> {
  if (!isTauri()) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = accept;
      input.onchange = async () => {
        const f = input.files?.[0];
        resolve(f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null);
      };
      input.click();
    });
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const { readFile } = await import("@tauri-apps/plugin-fs");
  const path = await open({ multiple: false, directory: false, filters });
  if (!path || Array.isArray(path)) return null;
  const bytes = await readFile(path);
  return { name: path.split(/[\\/]/).pop() ?? "file", bytes };
}

/** Pick and read several files. Returns [] when cancelled. */
export async function openFiles(filters: FileFilter[], accept: string): Promise<{ name: string; bytes: Uint8Array }[]> {
  if (!isTauri()) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = accept;
      input.multiple = true;
      input.onchange = async () => {
        const fs = Array.from(input.files ?? []);
        resolve(await Promise.all(fs.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
      };
      input.click();
    });
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const { readFile } = await import("@tauri-apps/plugin-fs");
  const paths = await open({ multiple: true, directory: false, filters });
  if (!paths) return [];
  const list = Array.isArray(paths) ? paths : [paths];
  return Promise.all(list.map(async (p) => ({ name: p.split(/[\\/]/).pop() ?? "file", bytes: await readFile(p) })));
}

// ---- Crash-safe autosave in the app's data folder (desktop only) ----

const AUTOSAVE_FILE = "autosave.tforge";

export async function writeAppAutosave(json: string): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const fs = await import("@tauri-apps/plugin-fs");
    const baseDir = fs.BaseDirectory.AppData;
    try {
      await fs.mkdir("", { baseDir, recursive: true });
    } catch {
      /* folder already exists */
    }
    // Write to a temp file first so a crash mid-write never corrupts the last good autosave.
    await fs.writeTextFile(`${AUTOSAVE_FILE}.tmp`, json, { baseDir });
    await fs.writeTextFile(AUTOSAVE_FILE, json, { baseDir });
    return true;
  } catch {
    return false;
  }
}

export async function readAppAutosave(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const fs = await import("@tauri-apps/plugin-fs");
    const baseDir = fs.BaseDirectory.AppData;
    for (const name of [AUTOSAVE_FILE, `${AUTOSAVE_FILE}.tmp`]) {
      if (await fs.exists(name, { baseDir })) {
        const text = await fs.readTextFile(name, { baseDir });
        try {
          JSON.parse(text);
          return text;
        } catch {
          /* try the next copy */
        }
      }
    }
  } catch {
    /* no autosave yet */
  }
  return null;
}

// ---- Updates (only when the app was built with the updater feature) ----

export async function checkForUpdates(): Promise<{ status: "none" | "available" | "disabled" | "error"; version?: string; install?: () => Promise<void>; message?: string }> {
  if (!isTauri()) return { status: "disabled", message: "Updates are handled by the desktop app." };
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return { status: "none" };
    return {
      status: "available",
      version: update.version,
      install: async () => {
        await update.downloadAndInstall();
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      },
    };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/not (found|allowed)|plugin|updater/i.test(msg)) return { status: "disabled", message: "This build doesn't include auto-update. See README: Enable auto-update." };
    return { status: "error", message: msg };
  }
}
