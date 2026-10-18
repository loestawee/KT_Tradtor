import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parsePluginPackage, PLUGIN_LIMITS } from "./plugin-package";
import {
  clearPluginShaders,
  getPluginShadersVersion,
  removePluginShaders,
  setPluginShaders,
  subscribePluginShaders,
} from "./plugin-registry";
import { getMotionShaderDef, getMotionShaderEffectDefs } from "./index";
import { clearGeneratedMotionShaders, registerMotionShader } from "./registry";

const GLSL = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D u_input;
out vec4 fragColor;
void main() { fragColor = texture(u_input, vUv); }
`;

function pkg(overrides: Record<string, unknown> = {}, shader: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: "kt-plugin/1",
    id: "acme.looks",
    name: "Acme Looks",
    version: "1.2.0",
    shaders: [{ id: "warm", name: "Warm", category: "effect", glsl: GLSL, ...shader }],
    ...overrides,
  });
}

describe("parsePluginPackage", () => {
  it("accepts a valid package and namespaces shader ids", () => {
    const result = parsePluginPackage(pkg({ author: "Acme", homepage: "https://acme.example" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plugin.manifest).toMatchObject({ id: "acme.looks", name: "Acme Looks", version: "1.2.0", author: "Acme" });
    expect(result.plugin.shaders[0]).toMatchObject({
      id: "plugin.acme.looks.warm",
      category: "effect",
      collection: "Acme Looks",
      origin: "generated",
    });
  });

  it("drops fields that could reach outside the shader sandbox", () => {
    const result = parsePluginPackage(
      pkg({}, { vertexShader: "evil", needsNoiseTexture: "https://evil.example/x.png", staticUniforms: { a: 1 } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const def = result.plugin.shaders[0] as unknown as Record<string, unknown>;
    expect(def.vertexShader).toBeUndefined();
    expect(def.needsNoiseTexture).toBeUndefined();
    expect(def.staticUniforms).toBeUndefined();
  });

  it("rejects non-https homepages without failing the install", () => {
    const result = parsePluginPackage(pkg({ homepage: "javascript:alert(1)" }));
    expect(result.ok && result.plugin.manifest.homepage).toBeFalsy();
  });

  it.each([
    ["bad JSON", "{"],
    ["wrong format", pkg({ format: "other/1" })],
    ["bad plugin id", pkg({ id: "../../etc" })],
    ["bad version", pkg({ version: "latest" })],
    ["no shaders", pkg({ shaders: [] })],
    ["bad shader id", pkg({}, { id: "../x" })],
    ["bad category", pkg({}, { category: "script" })],
    ["empty glsl", pkg({}, { glsl: "  " })],
    ["bad param name", pkg({}, { params: [{ name: "a b", min: 0, max: 1, default: 0 }] })],
    ["min > max", pkg({}, { params: [{ name: "amt", min: 2, max: 1, default: 1 }] })],
  ])("rejects %s", (_label, source) => {
    expect(parsePluginPackage(source).ok).toBe(false);
  });

  it("enforces size limits", () => {
    const huge = "x".repeat(PLUGIN_LIMITS.maxPackageBytes + 1);
    expect(parsePluginPackage(huge).ok).toBe(false);
    const big = pkg({}, { glsl: GLSL + "//" + "x".repeat(PLUGIN_LIMITS.maxGlslBytes) });
    expect(parsePluginPackage(big).ok).toBe(false);
  });

  it("clamps param defaults and reports validator failures", () => {
    const clamped = parsePluginPackage(pkg({}, { params: [{ name: "u_amt", label: "Amt", min: 0, max: 1, default: 5 }] }));
    expect(clamped.ok && clamped.plugin.shaders[0].params[0]).toMatchObject({ name: "amt", default: 1 });
    const failing = parsePluginPackage(pkg(), () => ({ ok: false, error: "compile error" }));
    expect(failing).toEqual({ ok: false, error: 'shader #1 ("Warm"): compile error' });
  });

  it("parses the bundled KT Film Pack sample", () => {
    const path = fileURLToPath(
      new URL("../../../../../apps/web/src/plugins/samples/kt-film-pack.ktfx.json", import.meta.url),
    );
    const result = parsePluginPackage(readFileSync(path, "utf8"));
    expect(result.ok).toBe(true);
    expect(result.ok && result.plugin.shaders.map((s) => s.id)).toEqual([
      "plugin.kt.film-pack.teal-orange",
      "plugin.kt.film-pack.film-fade",
      "plugin.kt.film-pack.vhs",
    ]);
  });
});

describe("plugin shader registry", () => {
  afterEach(() => {
    clearPluginShaders();
    clearGeneratedMotionShaders();
  });

  it("exposes plugin shaders through the normal lookups", () => {
    const result = parsePluginPackage(pkg());
    if (!result.ok) throw new Error(result.error);
    setPluginShaders("acme.looks", result.plugin.shaders);
    expect(getMotionShaderDef("plugin.acme.looks.warm")?.name).toBe("Warm");
    expect(getMotionShaderEffectDefs().some((d) => d.id === "plugin.acme.looks.warm")).toBe(true);
    removePluginShaders("acme.looks");
    expect(getMotionShaderDef("plugin.acme.looks.warm")).toBeUndefined();
  });

  it("survives project switches (generated registry clears) and does not duplicate copies", () => {
    const result = parsePluginPackage(pkg());
    if (!result.ok) throw new Error(result.error);
    const def = result.plugin.shaders[0];
    setPluginShaders("acme.looks", result.plugin.shaders);
    registerMotionShader(def); // copied into the project when used on a clip
    expect(getMotionShaderEffectDefs().filter((d) => d.id === def.id)).toHaveLength(1);
    clearGeneratedMotionShaders(); // what opening another project does
    expect(getMotionShaderDef(def.id)).toBeDefined();
  });

  it("notifies subscribers and bumps the version", () => {
    let calls = 0;
    const unsubscribe = subscribePluginShaders(() => calls++);
    const before = getPluginShadersVersion();
    setPluginShaders("a.b.c", []);
    removePluginShaders("a.b.c");
    unsubscribe();
    setPluginShaders("a.b.c", []);
    expect(calls).toBe(2);
    expect(getPluginShadersVersion()).toBeGreaterThan(before);
  });
});
