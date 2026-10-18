import type { MotionShaderCategory, MotionShaderDef, MotionShaderParamDef } from "./types";

// KT ตัดต่อ plugin package (".ktfx.json"): a signed-off bundle of WebGL2 GLSL
// shaders. Plugins carry NO JavaScript — only GLSL that runs inside the
// existing WebGL shader sandbox — so installing one cannot touch files,
// network, IPC or the DOM. Everything below is defensive parsing of untrusted
// input: unknown fields are dropped, sizes are capped, ids are namespaced.

export const KT_PLUGIN_FORMAT = "kt-plugin/1";

export const PLUGIN_LIMITS = {
  maxPackageBytes: 1_000_000,
  maxShaders: 64,
  maxGlslBytes: 64_000,
  maxParams: 16,
  maxTextLength: 200,
  maxDescriptionLength: 1_000,
} as const;

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9.-]{2,63}$/;
const SHADER_ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const PARAM_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]{1,32})?$/;
const CATEGORIES: readonly MotionShaderCategory[] = ["effect", "fill", "text"];

export interface KtPluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly author?: string;
  readonly description?: string;
  readonly homepage?: string;
}

export interface KtPluginPackage {
  readonly manifest: KtPluginManifest;
  /** Shader ids are namespaced: `plugin.<pluginId>.<shaderId>`. */
  readonly shaders: readonly MotionShaderDef[];
}

export type PluginParseResult =
  | { readonly ok: true; readonly plugin: KtPluginPackage }
  | { readonly ok: false; readonly error: string };

/** Optional GPU compile check (pass `validateMotionShaderSource` in the app). */
export type ShaderSourceValidator = (
  glsl: string,
  category: MotionShaderCategory,
) => { readonly ok: true } | { readonly ok: false; readonly error: string };

export function pluginShaderId(pluginId: string, shaderId: string): string {
  return `plugin.${pluginId}.${shaderId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  // Strip control characters; names end up in the UI and in filenames.
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return cleaned.length > 0 && cleaned.length <= max ? cleaned : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safeHomepage(value: unknown): string | undefined {
  const raw = text(value, 300);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function parseParams(value: unknown, where: string): readonly MotionShaderParamDef[] | string {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return `${where}: params must be an array`;
  if (value.length > PLUGIN_LIMITS.maxParams) return `${where}: too many params (max ${PLUGIN_LIMITS.maxParams})`;
  const params: MotionShaderParamDef[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of value.entries()) {
    if (!isRecord(raw)) return `${where}: param #${index + 1} must be an object`;
    const name = typeof raw.name === "string" ? raw.name.replace(/^u_/, "") : "";
    if (!PARAM_NAME_RE.test(name)) return `${where}: param #${index + 1} has an invalid name`;
    if (seen.has(name)) return `${where}: duplicate param "${name}"`;
    seen.add(name);
    const label = text(raw.label, PLUGIN_LIMITS.maxTextLength) ?? name;
    const type = raw.type === "color" ? "color" : "number";
    if (type === "color") {
      const color = typeof raw.default === "string" && /^#[0-9a-fA-F]{6}$/.test(raw.default) ? raw.default : "#ffffff";
      params.push({ name, label, type, default: color, min: 0, max: 1, step: 1 });
      continue;
    }
    const min = finite(raw.min);
    const max = finite(raw.max);
    const def = finite(raw.default);
    if (min === undefined || max === undefined || def === undefined || max < min) {
      return `${where}: param "${name}" needs numeric min ≤ max and a default`;
    }
    const step = finite(raw.step);
    params.push({
      name,
      label,
      type,
      min,
      max,
      default: Math.min(max, Math.max(min, def)),
      step: step !== undefined && step > 0 ? step : 0.01,
      ...(raw.control === "slider" || raw.control === "number" ? { control: raw.control } : {}),
    });
  }
  return params;
}

export function parsePluginPackage(
  source: string,
  validateShader?: ShaderSourceValidator,
): PluginParseResult {
  if (typeof source !== "string") return { ok: false, error: "Plugin file must be text" };
  if (new TextEncoder().encode(source).length > PLUGIN_LIMITS.maxPackageBytes) {
    return { ok: false, error: `Plugin file is larger than ${PLUGIN_LIMITS.maxPackageBytes / 1_000_000} MB` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return { ok: false, error: "Plugin file is not valid JSON" };
  }
  if (!isRecord(raw)) return { ok: false, error: "Plugin file must be a JSON object" };
  if (raw.format !== KT_PLUGIN_FORMAT) {
    return { ok: false, error: `Unsupported plugin format (expected "${KT_PLUGIN_FORMAT}")` };
  }

  const id = typeof raw.id === "string" ? raw.id : "";
  if (!PLUGIN_ID_RE.test(id)) {
    return { ok: false, error: "Plugin id must be 3–64 chars of a-z, 0-9, '.', '-'" };
  }
  const name = text(raw.name, PLUGIN_LIMITS.maxTextLength);
  if (!name) return { ok: false, error: "Plugin needs a name" };
  const version = typeof raw.version === "string" && VERSION_RE.test(raw.version) ? raw.version : undefined;
  if (!version) return { ok: false, error: "Plugin version must look like 1.0.0" };

  if (!Array.isArray(raw.shaders) || raw.shaders.length === 0) {
    return { ok: false, error: "Plugin must contain at least one shader" };
  }
  if (raw.shaders.length > PLUGIN_LIMITS.maxShaders) {
    return { ok: false, error: `Plugin has too many shaders (max ${PLUGIN_LIMITS.maxShaders})` };
  }

  const shaders: MotionShaderDef[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of raw.shaders.entries()) {
    const where = `shader #${index + 1}`;
    if (!isRecord(entry)) return { ok: false, error: `${where} must be an object` };
    const shaderId = typeof entry.id === "string" ? entry.id : "";
    if (!SHADER_ID_RE.test(shaderId)) return { ok: false, error: `${where}: invalid id` };
    if (seen.has(shaderId)) return { ok: false, error: `${where}: duplicate id "${shaderId}"` };
    seen.add(shaderId);
    const shaderName = text(entry.name, PLUGIN_LIMITS.maxTextLength);
    if (!shaderName) return { ok: false, error: `${where}: needs a name` };
    const category = CATEGORIES.find((c) => c === entry.category);
    if (!category) return { ok: false, error: `${where}: category must be effect, fill or text` };
    const glsl = typeof entry.glsl === "string" ? entry.glsl : "";
    if (!glsl.trim()) return { ok: false, error: `${where}: glsl is empty` };
    if (glsl.length > PLUGIN_LIMITS.maxGlslBytes) return { ok: false, error: `${where}: glsl is too large` };
    const params = parseParams(entry.params, where);
    if (typeof params === "string") return { ok: false, error: params };
    if (validateShader) {
      const check = validateShader(glsl, category);
      if (!check.ok) return { ok: false, error: `${where} ("${shaderName}"): ${check.error}` };
    }
    const timeScale = finite(entry.timeScale);
    // Only the fields below are kept. Notably dropped: vertexShader,
    // needsNoiseTexture (asset URL fetch) and staticUniforms.
    shaders.push({
      id: pluginShaderId(id, shaderId),
      name: shaderName,
      category,
      glsl,
      params,
      origin: "generated",
      collection: name,
      ...(timeScale !== undefined && timeScale > 0 && timeScale <= 10 ? { timeScale } : {}),
    });
  }

  const author = text(raw.author, PLUGIN_LIMITS.maxTextLength);
  const description = text(raw.description, PLUGIN_LIMITS.maxDescriptionLength);
  const homepage = safeHomepage(raw.homepage);
  return {
    ok: true,
    plugin: {
      manifest: {
        id,
        name,
        version,
        ...(author ? { author } : {}),
        ...(description ? { description } : {}),
        ...(homepage ? { homepage } : {}),
      },
      shaders,
    },
  };
}
