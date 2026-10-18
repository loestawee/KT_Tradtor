import type { MotionShaderCategory, MotionShaderDef } from "./types";
import { EFFECT_SHADERS } from "./effect-shaders";
import { FILL_SHADERS } from "./fill-shaders";
import { TEXT_SHADERS } from "./text-shaders";
import { PAPER_SHADER_DEFS } from "./paper-shaders";
import { generatedShaderById, listGeneratedMotionShaders } from "./registry";
import { listPluginShaders, pluginShaderById } from "./plugin-registry";
export {
  KT_PLUGIN_FORMAT,
  PLUGIN_LIMITS,
  parsePluginPackage,
  pluginShaderId,
  type KtPluginManifest,
  type KtPluginPackage,
  type PluginParseResult,
  type ShaderSourceValidator,
} from "./plugin-package";

export type {
  MotionShaderParamType,
  MotionShaderParamDef,
  MotionShaderCategory,
  MotionShaderColorArrayParams,
  MotionShaderDef,
} from "./types";
export { EFFECT_SHADERS } from "./effect-shaders";
export { FILL_SHADERS } from "./fill-shaders";
export { TEXT_SHADERS } from "./text-shaders";
export {
  registerMotionShader,
  unregisterMotionShader,
  clearGeneratedMotionShaders,
  listGeneratedMotionShaders,
  generatedShaderById,
  isBuiltinMotionShaderId,
} from "./registry";
export { registerProjectGeneratedShaders } from "./project-shaders";
export {
  setPluginShaders,
  removePluginShaders,
  clearPluginShaders,
  listPluginShaders,
  pluginShaderById,
  isPluginShaderId,
  getPluginShadersVersion,
  subscribePluginShaders,
} from "./plugin-registry";
export { PAPER_SHADER_DEFS, PAPER_VERTEX_SHADER } from "./paper-shaders";

export const MOTION_SHADER_LIBRARY: readonly MotionShaderDef[] = [
  ...EFFECT_SHADERS,
  ...FILL_SHADERS,
  ...TEXT_SHADERS,
  ...PAPER_SHADER_DEFS,
];

function generatedByCategory(category: MotionShaderCategory): readonly MotionShaderDef[] {
  // A plugin shader already copied into the project shows up once, as the plugin's.
  const generated = listGeneratedMotionShaders().filter(
    (def) => def.category === category && !pluginShaderById(def.id),
  );
  return [...generated, ...listPluginShaders().filter((def) => def.category === category)];
}

// Lookup order: built-in → project (travels with the file) → installed plugins.
export function getMotionShaderDef(id: string): MotionShaderDef | undefined {
  return MOTION_SHADER_LIBRARY.find((def) => def.id === id) ?? generatedShaderById(id) ?? pluginShaderById(id);
}

export function getMotionShaderEffectDefs(): readonly MotionShaderDef[] {
  return [...MOTION_SHADER_LIBRARY.filter((def) => def.category === "effect"), ...generatedByCategory("effect")];
}

export function getMotionShaderFillDefs(): readonly MotionShaderDef[] {
  return [...MOTION_SHADER_LIBRARY.filter((def) => def.category === "fill"), ...generatedByCategory("fill")];
}

export function getMotionShaderTextDefs(): readonly MotionShaderDef[] {
  return [...MOTION_SHADER_LIBRARY.filter((def) => def.category === "text"), ...generatedByCategory("text")];
}

export function defaultMotionShaderParams(
  def: MotionShaderDef,
): Record<string, number | string> {
  return Object.fromEntries(def.params.map((p) => [p.name, p.default]));
}
