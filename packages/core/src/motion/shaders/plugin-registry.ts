import type { MotionShaderDef } from "./types";

// KT: shaders contributed by installed plugins. Kept apart from the project
// ("generated") registry because that one is cleared on every project open,
// while plugins belong to the app, not to a project.

const pluginShaders = new Map<string, readonly MotionShaderDef[]>();
const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/** Replaces every shader a plugin contributes (idempotent per plugin id). */
export function setPluginShaders(pluginId: string, defs: readonly MotionShaderDef[]): void {
  pluginShaders.set(pluginId, defs);
  notify();
}

export function removePluginShaders(pluginId: string): void {
  if (pluginShaders.delete(pluginId)) notify();
}

export function clearPluginShaders(): void {
  if (pluginShaders.size === 0) return;
  pluginShaders.clear();
  notify();
}

export function listPluginShaders(): readonly MotionShaderDef[] {
  return [...pluginShaders.values()].flat();
}

export function pluginShaderById(id: string): MotionShaderDef | undefined {
  for (const defs of pluginShaders.values()) {
    const match = defs.find((def) => def.id === id);
    if (match) return match;
  }
  return undefined;
}

export function isPluginShaderId(id: string): boolean {
  return pluginShaderById(id) !== undefined;
}

/** Changes whenever plugin shaders change; lets UI lists re-read the library. */
export function getPluginShadersVersion(): number {
  return version;
}

export function subscribePluginShaders(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
