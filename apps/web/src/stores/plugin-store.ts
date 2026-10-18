import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  parsePluginPackage,
  removePluginShaders,
  setPluginShaders,
  type KtPluginPackage,
} from "@openreel/core";
import { validateMotionShaderSource } from "@openreel/core/motion/motion-shader-validator";

// KT ตัดต่อ: installed effect/filter plugins (.ktfx.json). Only the raw package
// text is persisted; it is re-parsed and re-validated on every load, so a
// tampered localStorage entry can't bypass the checks in parsePluginPackage.

export const MAX_INSTALLED_PLUGINS = 20;

export interface InstalledPlugin {
  readonly id: string;
  readonly source: string;
  readonly enabled: boolean;
  readonly installedAt: number;
}

export interface LoadedPlugin extends InstalledPlugin {
  readonly plugin: KtPluginPackage;
}

export type PluginInstallResult =
  | { readonly ok: true; readonly plugin: KtPluginPackage; readonly replaced: boolean }
  | { readonly ok: false; readonly error: string };

interface PluginState {
  plugins: InstalledPlugin[];
  install: (source: string) => PluginInstallResult;
  setEnabled: (id: string, enabled: boolean) => void;
  remove: (id: string) => void;
}

const parseCache = new Map<string, KtPluginPackage | null>();

/** Parses (and GPU-validates when WebGL exists) a stored package, memoized by source. */
export function loadPluginPackage(source: string): KtPluginPackage | null {
  if (!parseCache.has(source)) {
    const result = parsePluginPackage(source, validateMotionShaderSource);
    parseCache.set(source, result.ok ? result.plugin : null);
  }
  return parseCache.get(source) ?? null;
}

/** Pushes the enabled plugins' shaders into the core registry. */
export function syncPluginShaders(plugins: readonly InstalledPlugin[]): void {
  for (const entry of plugins) {
    const plugin = entry.enabled ? loadPluginPackage(entry.source) : null;
    if (plugin) setPluginShaders(entry.id, plugin.shaders);
    else removePluginShaders(entry.id);
  }
}

export const usePluginStore = create<PluginState>()(
  persist(
    (set, get) => ({
      plugins: [],

      install: (source) => {
        const result = parsePluginPackage(source, validateMotionShaderSource);
        if (!result.ok) return result;
        const { id } = result.plugin.manifest;
        const existing = get().plugins;
        const replaced = existing.some((p) => p.id === id);
        if (!replaced && existing.length >= MAX_INSTALLED_PLUGINS) {
          return { ok: false, error: `You can install up to ${MAX_INSTALLED_PLUGINS} plugins` };
        }
        parseCache.set(source, result.plugin);
        const next: InstalledPlugin = { id, source, enabled: true, installedAt: Date.now() };
        const plugins = replaced ? existing.map((p) => (p.id === id ? next : p)) : [...existing, next];
        set({ plugins });
        syncPluginShaders([next]);
        return { ok: true, plugin: result.plugin, replaced };
      },

      setEnabled: (id, enabled) => {
        const plugins = get().plugins.map((p) => (p.id === id ? { ...p, enabled } : p));
        set({ plugins });
        syncPluginShaders(plugins.filter((p) => p.id === id));
      },

      remove: (id) => {
        set({ plugins: get().plugins.filter((p) => p.id !== id) });
        removePluginShaders(id);
      },
    }),
    {
      name: "kt-plugins",
      version: 1,
      partialize: (state) => ({ plugins: state.plugins }),
      onRehydrateStorage: () => (state) => {
        if (state) syncPluginShaders(state.plugins);
      },
    },
  ),
);

/** Installed plugins with their parsed manifests (unparseable entries are skipped). */
export function getLoadedPlugins(plugins: readonly InstalledPlugin[]): LoadedPlugin[] {
  const loaded: LoadedPlugin[] = [];
  for (const entry of plugins) {
    const plugin = loadPluginPackage(entry.source);
    if (plugin) loaded.push({ ...entry, plugin });
  }
  return loaded;
}
