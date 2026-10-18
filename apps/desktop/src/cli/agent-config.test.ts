import { describe, expect, it } from "vitest";
import {
  codexTomlBlock,
  configPath,
  jsonServerEntry,
  mergeCodexToml,
  mergeJsonConfig,
  resolveLauncher,
} from "./agent-config";

const app = "/Applications/KT Tadtor.app/Contents/MacOS/KT Tadtor";
const cliInAsar = "/Applications/KT Tadtor.app/Contents/Resources/app.asar/dist/cli/index.js";

describe("resolveLauncher", () => {
  it("runs the packaged app binary as Node from the unpacked CLI", () => {
    const l = resolveLauncher({ execPath: app, cliFile: cliInAsar, isElectron: true });
    expect(l.command).toBe(app);
    expect(l.args).toEqual([
      "/Applications/KT Tadtor.app/Contents/Resources/app.asar.unpacked/dist/cli/index.js",
      "mcp",
    ]);
    expect(l.env).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
  });

  it("uses plain node without extra env", () => {
    const l = resolveLauncher({ execPath: "/usr/bin/node", cliFile: "/x/dist/cli/index.js", isElectron: false });
    expect(l).toEqual({ command: "/usr/bin/node", args: ["/x/dist/cli/index.js", "mcp"] });
  });

  it("handles Windows asar paths", () => {
    const l = resolveLauncher({
      execPath: "C:\\KT\\KT Tadtor.exe",
      cliFile: "C:\\KT\\resources\\app.asar\\dist\\cli\\index.js",
      isElectron: true,
    });
    expect(l.args[0]).toBe("C:\\KT\\resources\\app.asar.unpacked\\dist\\cli\\index.js");
  });
});

describe("JSON client configs", () => {
  const launcher = { command: "node", args: ["cli.js", "mcp"] };

  it("adds kt-tadtor while keeping other servers and settings", () => {
    const existing = JSON.stringify({ theme: "dark", mcpServers: { other: { command: "x" } } });
    const merged = JSON.parse(mergeJsonConfig(existing, launcher));
    expect(merged.theme).toBe("dark");
    expect(merged.mcpServers.other).toEqual({ command: "x" });
    expect(merged.mcpServers["kt-tadtor"]).toEqual({ command: "node", args: ["cli.js", "mcp"] });
  });

  it("creates a config from nothing and replaces an old entry", () => {
    const first = mergeJsonConfig(null, launcher);
    const second = JSON.parse(mergeJsonConfig(first, { command: "node2", args: ["a", "mcp"] }));
    expect(Object.keys(second.mcpServers)).toEqual(["kt-tadtor"]);
    expect(second.mcpServers["kt-tadtor"].command).toBe("node2");
  });

  it("refuses to overwrite a config that is not an object", () => {
    expect(() => mergeJsonConfig("[]", launcher)).toThrow();
  });

  it("adds type stdio only for Claude Code", () => {
    expect(jsonServerEntry(launcher, { withType: true }).type).toBe("stdio");
    expect(jsonServerEntry(launcher).type).toBeUndefined();
  });
});

describe("Codex TOML config", () => {
  const launcher = { command: app, args: ["/p/cli.js", "mcp"], env: { ELECTRON_RUN_AS_NODE: "1" } };

  it("writes a valid server block with escaped paths and env", () => {
    expect(codexTomlBlock(launcher)).toBe(
      `[mcp_servers.kt-tadtor]\ncommand = "${app}"\nargs = ["/p/cli.js", "mcp"]\nenv = { ELECTRON_RUN_AS_NODE = "1" }\n`,
    );
    expect(codexTomlBlock({ command: "C:\\KT\\a.exe", args: [] })).toContain('command = "C:\\\\KT\\\\a.exe"');
  });

  it("replaces only its own block and keeps the rest", () => {
    const existing = [
      'model = "gpt-5"',
      "",
      "[mcp_servers.kt-tadtor]",
      'command = "old"',
      "",
      "[mcp_servers.kt-tadtor.env]",
      'X = "1"',
      "",
      "[mcp_servers.github]",
      'command = "gh"',
    ].join("\n");
    const merged = mergeCodexToml(existing, launcher);
    expect(merged).toContain('model = "gpt-5"');
    expect(merged).toContain("[mcp_servers.github]");
    expect(merged).not.toContain('command = "old"');
    expect(merged).not.toContain("[mcp_servers.kt-tadtor.env]");
    expect(merged.match(/\[mcp_servers\.kt-tadtor\]/g)).toHaveLength(1);
  });
});

describe("configPath", () => {
  it("knows each client's config location per OS", () => {
    expect(configPath("codex", { platform: "darwin", home: "/h" })).toBe("/h/.codex/config.toml");
    expect(configPath("codex", { platform: "linux", home: "/h", codexHome: "/c" })).toBe("/c/config.toml");
    expect(configPath("cursor", { platform: "linux", home: "/h" })).toBe("/h/.cursor/mcp.json");
    expect(configPath("claude-desktop", { platform: "darwin", home: "/h" })).toBe(
      "/h/Library/Application Support/Claude/claude_desktop_config.json",
    );
    expect(configPath("claude-desktop", { platform: "linux", home: "/h" })).toBe(
      "/h/.config/Claude/claude_desktop_config.json",
    );
  });
});
