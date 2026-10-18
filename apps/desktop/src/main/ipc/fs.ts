import { app, dialog, shell, BrowserWindow } from "electron";
import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { PathGrants } from "./path-grants";

export class FileWriterRegistry {
  private handles = new Map<string, FileHandle>();
  private paths = new Map<string, string>();

  async open(path: string): Promise<string> {
    const id = randomUUID();
    this.handles.set(id, await fs.open(path, "w"));
    this.paths.set(id, path);
    return id;
  }

  async writeChunk(id: string, data: ArrayBuffer | Uint8Array, position: number): Promise<void> {
    const fh = this.handles.get(id);
    if (!fh) throw new Error(`unknown write handle ${id}`);
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    await fh.write(bytes, 0, bytes.byteLength, position);
  }

  async close(id: string): Promise<void> {
    const fh = this.handles.get(id);
    if (!fh) return;
    await fh.close();
    this.handles.delete(id);
    this.paths.delete(id);
  }

  async abort(id: string): Promise<void> {
    const fh = this.handles.get(id);
    const p = this.paths.get(id);
    if (fh) await fh.close();
    this.handles.delete(id);
    this.paths.delete(id);
    if (p) await fs.rm(p, { force: true });
  }
}

export const fileWriters = new FileWriterRegistry();

let pathGrants: PathGrants | null = null;
/** Lazily created so tests can import this module without an Electron app. */
export function getPathGrants(): PathGrants {
  if (!pathGrants) pathGrants = new PathGrants(path.join(app.getPath("userData"), "kt-path-grants.json"));
  return pathGrants;
}

/** IPC entry for fsOpenWrite: only granted paths may be opened for writing. */
export async function openWriteGranted(args: { path: string }): Promise<string> {
  return fileWriters.open(getPathGrants().assert(args.path, "write"));
}

export async function showSaveDialog(args: {
  defaultPath: string;
  filters: { name: string; extensions: string[] }[];
}): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? undefined;
  const res = await dialog.showSaveDialog(win!, {
    defaultPath: args.defaultPath,
    filters: args.filters,
  });
  if (res.canceled || !res.filePath) return null;
  getPathGrants().grant(res.filePath);
  return res.filePath;
}

export async function showOpenDialog(args: {
  filters: { name: string; extensions: string[] }[];
}): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? undefined;
  const res = await dialog.showOpenDialog(win!, {
    filters: args.filters,
    properties: ["openFile"],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  getPathGrants().grant(res.filePaths[0]);
  return res.filePaths[0];
}

export async function readTextFile(args: { path: string }): Promise<string> {
  return fs.readFile(getPathGrants().assert(args.path, "read"), "utf8");
}

export async function readFileBytes(args: { path: string }): Promise<ArrayBuffer> {
  const buf = await fs.readFile(getPathGrants().assert(args.path, "read"));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export async function writeTextFile(args: { path: string; data: string }): Promise<void> {
  await fs.writeFile(getPathGrants().assert(args.path, "write"), args.data, "utf8");
}

export async function revealInFolder(args: { path: string }): Promise<void> {
  shell.showItemInFolder(args.path);
}

export async function tempFilePath(args: { ext: string }): Promise<string> {
  const safeExt = args.ext.replace(/[^a-zA-Z0-9]/g, "") || "bin";
  const tmp = path.join(os.tmpdir(), `openreel-mat-${randomUUID()}.${safeExt}`);
  getPathGrants().grant(tmp);
  return tmp;
}
