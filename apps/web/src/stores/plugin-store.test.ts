import { beforeEach, describe, expect, it } from "vitest";
import { clearPluginShaders, getMotionShaderDef, getMotionShaderEffectDefs } from "@openreel/core";
import sample from "../plugins/samples/kt-film-pack.ktfx.json?raw";
import { MAX_INSTALLED_PLUGINS, getLoadedPlugins, syncPluginShaders, usePluginStore } from "./plugin-store";

const VHS = "plugin.kt.film-pack.vhs";

function pluginSource(id: string): string {
  const parsed = JSON.parse(sample) as Record<string, unknown>;
  return JSON.stringify({ ...parsed, id });
}

describe("plugin store", () => {
  beforeEach(() => {
    usePluginStore.setState({ plugins: [] });
    clearPluginShaders();
    localStorage.clear();
  });

  it("installs the sample and exposes its effects to clips", () => {
    const result = usePluginStore.getState().install(sample);
    expect(result).toMatchObject({ ok: true, replaced: false });
    expect(getMotionShaderDef(VHS)?.name).toBe("VHS");
    expect(getMotionShaderEffectDefs().map((d) => d.id)).toContain(VHS);
  });

  it("disables, re-enables and removes", () => {
    const { install, setEnabled, remove } = usePluginStore.getState();
    install(sample);
    setEnabled("kt.film-pack", false);
    expect(getMotionShaderDef(VHS)).toBeUndefined();
    setEnabled("kt.film-pack", true);
    expect(getMotionShaderDef(VHS)).toBeDefined();
    remove("kt.film-pack");
    expect(getMotionShaderDef(VHS)).toBeUndefined();
    expect(usePluginStore.getState().plugins).toHaveLength(0);
  });

  it("re-installing the same id upgrades in place", () => {
    const { install } = usePluginStore.getState();
    install(sample);
    const second = install(sample.replace('"1.0.0"', '"1.1.0"'));
    expect(second).toMatchObject({ ok: true, replaced: true });
    const loaded = getLoadedPlugins(usePluginStore.getState().plugins);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].plugin.manifest.version).toBe("1.1.0");
  });

  it("rejects invalid packages without changing state", () => {
    const result = usePluginStore.getState().install('{"format":"kt-plugin/1"}');
    expect(result.ok).toBe(false);
    expect(usePluginStore.getState().plugins).toHaveLength(0);
  });

  it("caps the number of installed plugins", () => {
    const { install } = usePluginStore.getState();
    for (let i = 0; i < MAX_INSTALLED_PLUGINS; i++) expect(install(pluginSource(`kt.pack-${i}`)).ok).toBe(true);
    expect(install(pluginSource("kt.one-more")).ok).toBe(false);
  });

  it("re-validates persisted entries and skips tampered ones on load", () => {
    usePluginStore.setState({
      plugins: [
        { id: "kt.film-pack", source: sample, enabled: true, installedAt: 1 },
        { id: "evil", source: '{"format":"kt-plugin/1","id":"evil"}', enabled: true, installedAt: 2 },
      ],
    });
    syncPluginShaders(usePluginStore.getState().plugins);
    expect(getMotionShaderDef(VHS)).toBeDefined();
    expect(getLoadedPlugins(usePluginStore.getState().plugins).map((p) => p.id)).toEqual(["kt.film-pack"]);
  });
});
