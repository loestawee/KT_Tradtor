import os from "node:os";
import { posix, win32 } from "node:path";

// Pure helpers that build/merge MCP client configs for the AI tools KT ตัดต่อ
// supports. No I/O here, so every format is unit-tested.

export const SERVER_NAME = "kt-tadtor";

export type AgentTarget = "claude-code" | "codex" | "claude-desktop" | "cursor";
export const AGENT_TARGETS: AgentTarget[] = ["claude-code", "codex", "claude-desktop", "cursor"];

export interface Launcher {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * How an MCP client should start the stdio bridge. Inside the packaged app we
 * reuse the app binary as Node (ELECTRON_RUN_AS_NODE), so users need no Node
 * install; under plain Node we use that Node.
 */
export function resolveLauncher(opts: {
  execPath: string;
  cliFile: string;
  isElectron: boolean;
}): Launcher {
  // Code inside app.asar can't be executed by an external process; the CLI is
  // shipped unpacked next to it.
  const cliFile = opts.cliFile.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
  return opts.isElectron
    ? { command: opts.execPath, args: [cliFile, "mcp"], env: { ELECTRON_RUN_AS_NODE: "1" } }
    : { command: opts.execPath, args: [cliFile, "mcp"] };
}

/**
 * `mcpServers` entry used by Claude Desktop and Cursor; `claude mcp add-json`
 * additionally needs `type: "stdio"`.
 */
export function jsonServerEntry(
  launcher: Launcher,
  opts: { withType?: boolean } = {},
): Record<string, unknown> {
  return {
    ...(opts.withType ? { type: "stdio" } : {}),
    command: launcher.command,
    args: launcher.args,
    ...(launcher.env ? { env: launcher.env } : {}),
  };
}

/** Adds/replaces our server in a Claude Desktop / Cursor style JSON config. */
export function mergeJsonConfig(existing: string | null, launcher: Launcher): string {
  let config: Record<string, unknown> = {};
  if (existing && existing.trim()) {
    const parsed: unknown = JSON.parse(existing);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      config = parsed as Record<string, unknown>;
    } else {
      throw new Error("Existing config is not a JSON object");
    }
  }
  const servers =
    config.mcpServers && typeof config.mcpServers === "object"
      ? { ...(config.mcpServers as Record<string, unknown>) }
      : {};
  servers[SERVER_NAME] = jsonServerEntry(launcher);
  return `${JSON.stringify({ ...config, mcpServers: servers }, null, 2)}\n`;
}

const tomlString = (value: string) => JSON.stringify(value);

/** TOML block for Codex CLI (`~/.codex/config.toml`). */
export function codexTomlBlock(launcher: Launcher): string {
  const lines = [
    `[mcp_servers.${SERVER_NAME}]`,
    `command = ${tomlString(launcher.command)}`,
    `args = [${launcher.args.map(tomlString).join(", ")}]`,
  ];
  if (launcher.env) {
    const env = Object.entries(launcher.env)
      .map(([k, v]) => `${k} = ${tomlString(v)}`)
      .join(", ");
    lines.push(`env = { ${env} }`);
  }
  return `${lines.join("\n")}\n`;
}

/** Replaces any previous kt-tadtor block in a Codex config, keeping the rest. */
export function mergeCodexToml(existing: string | null, launcher: Launcher): string {
  const header = `[mcp_servers.${SERVER_NAME}]`;
  const kept: string[] = [];
  let skipping = false;
  for (const line of (existing ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) skipping = trimmed === header || trimmed.startsWith(`[mcp_servers.${SERVER_NAME}.`);
    if (!skipping) kept.push(line);
  }
  const base = kept.join("\n").replace(/\s+$/, "");
  return `${base ? `${base}\n\n` : ""}${codexTomlBlock(launcher)}`;
}

/** Where each JSON/TOML-configured client keeps its config on this OS. */
export function configPath(
  target: Exclude<AgentTarget, "claude-code">,
  env: { platform: NodeJS.Platform; home: string; appData?: string; codexHome?: string },
): string {
  // Build paths in the target OS's style, independent of the host running this.
  const path = env.platform === "win32" ? win32 : posix;
  switch (target) {
    case "codex":
      return path.join(env.codexHome || path.join(env.home, ".codex"), "config.toml");
    case "cursor":
      return path.join(env.home, ".cursor", "mcp.json");
    case "claude-desktop":
      if (env.platform === "darwin") {
        return path.join(env.home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
      }
      if (env.platform === "win32") {
        return path.join(env.appData || path.join(env.home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
      }
      return path.join(env.home, ".config", "Claude", "claude_desktop_config.json");
  }
}

export function currentEnv() {
  return {
    platform: process.platform,
    home: os.homedir(),
    appData: process.env.APPDATA,
    codexHome: process.env.CODEX_HOME,
  };
}
