import { Capacitor, registerPlugin } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

// KT ตัดต่อ: in the Android app the WebView has no download manager, so an
// `<a download>` click silently does nothing. Exports are handed to the
// native side instead: copied into the app cache, then saved/shared.

interface KtMediaPlugin {
  saveToGallery(options: { path: string; filename: string; mime: string }): Promise<{
    uri: string;
    relativePath: string;
  }>;
}

const KtMedia = registerPlugin<KtMediaPlugin>("KtMedia");

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

export interface CachedExport {
  /** file:// URI inside the app cache. */
  uri: string;
  filename: string;
  mime: string;
  sizeBytes: number;
}

export interface DeliveryActions {
  /**
   * Copies the file into Movies/KT Tadtor (or Music/ for audio). Throws on failure.
   * On success the cached copy is deleted, so call share() first if you want both.
   */
  saveToGallery: () => Promise<{ relativePath: string }>;
  /** Opens the Android share sheet. Rejects if the user dismisses it. */
  share: () => Promise<void>;
}

// 3 MiB per bridge call keeps base64 strings small enough for the JS↔native bridge.
const CHUNK_BYTES = 3 * 1024 * 1024;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}

async function copyToCache(data: Blob, filename: string): Promise<string> {
  const path = `exports/${Date.now()}-${filename}`;
  for (let offset = 0; offset < data.size; offset += CHUNK_BYTES) {
    const chunk = await blobToBase64(data.slice(offset, offset + CHUNK_BYTES));
    const write = offset === 0 ? Filesystem.writeFile : Filesystem.appendFile;
    await write({ path, data: chunk, directory: Directory.Cache, recursive: true });
  }
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  return uri;
}

/**
 * Decide what happens once an export is ready on the device.
 *
 * TODO(KT): implement — see the trade-offs in the PR/notes:
 *  - gallery first (CapCut-style) vs. share sheet first
 *  - what to do when saveToGallery throws (e.g. fall back to share?)
 *  - audio-only exports (mime starts with "audio/") don't belong in the video gallery
 */
export async function deliverToUser(file: CachedExport, actions: DeliveryActions): Promise<void> {
  void file;
  await actions.saveToGallery();
}

export async function deliverExportedFile(data: Blob, filename: string, mime: string): Promise<void> {
  const uri = await copyToCache(data, filename);
  const cached: CachedExport = { uri, filename, mime: data.type || mime, sizeBytes: data.size };
  await deliverToUser(cached, {
    saveToGallery: () => KtMedia.saveToGallery({ path: uri, filename, mime: cached.mime }),
    share: async () => {
      await Share.share({ title: filename, files: [uri], dialogTitle: "ส่งออกวิดีโอ" });
    },
  });
}
