#!/usr/bin/env node
import { endpointFilePath } from "../shared/mcp";
import { postRpc, readEndpoint } from "../shared/mcp-client";
import { runStdioBridge } from "../mcp-shim/index";
import { AGENT_TARGETS, resolveLauncher, type AgentTarget } from "./agent-config";
import { setupAgent } from "./setup";

// kt-tadtor — control a running KT ตัดต่อ desktop app from the terminal or from
// AI coding agents (Claude Code, Codex CLI, Claude Desktop, Cursor).

const HELP = `kt-tadtor — ควบคุม KT ตัดต่อ จาก command line / AI agent

Usage:
  kt-tadtor status                  เช็คว่าแอปเปิดอยู่และเชื่อมต่อได้
  kt-tadtor tools [filter] [--json] รายชื่อคำสั่งที่ AI ใช้ได้
  kt-tadtor call <tool> [json-args] เรียกคำสั่งเดียว เช่น
                                    kt-tadtor call get_editor_state
  kt-tadtor setup <target> [--print] ลงทะเบียนให้ AI ใช้งาน
                                    target: ${AGENT_TARGETS.join(" | ")} | all
  kt-tadtor mcp                     stdio MCP bridge (ให้ AI client เรียก)

The desktop app must be running (it writes ${endpointFilePath()}).
Destructive tools need Settings → MCP → "Trusted local — auto-allow".
`;

let rpcId = 0;
async function rpc(method: string, params?: Record<string, unknown>): Promise<unknown> {
  const endpoint = readEndpoint();
  const response = (await postRpc(endpoint, { jsonrpc: "2.0", id: ++rpcId, method, params })) as {
    result?: unknown;
    error?: { message?: string };
  } | null;
  if (response?.error) throw new Error(response.error.message ?? "MCP error");
  return response?.result;
}

interface ToolInfo {
  name: string;
  description?: string;
}

async function listTools(): Promise<ToolInfo[]> {
  const result = (await rpc("tools/list")) as { tools?: ToolInfo[] } | undefined;
  return result?.tools ?? [];
}

function launcher() {
  return resolveLauncher({
    execPath: process.execPath,
    cliFile: __filename,
    isElectron: Boolean(process.versions.electron),
  });
}

function textOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] } | undefined)?.content;
  if (Array.isArray(content)) {
    return content.map((c) => (c.type === "text" ? c.text ?? "" : JSON.stringify(c))).join("\n");
  }
  return JSON.stringify(result, null, 2);
}

export async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  const flags = new Set(rest.filter((a) => a.startsWith("--")));
  const positional = rest.filter((a) => !a.startsWith("--"));

  switch (command) {
    case "mcp":
      runStdioBridge();
      return;
    case "status": {
      const info = (await rpc("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "kt-tadtor-cli", version: "1" },
      })) as { serverInfo?: { name?: string; version?: string } };
      const tools = await listTools();
      console.log(
        `✓ เชื่อมต่อ ${info.serverInfo?.name ?? "app"} ${info.serverInfo?.version ?? ""} ได้ — ${tools.length} tools`,
      );
      return;
    }
    case "tools": {
      const filter = positional[0]?.toLowerCase();
      const tools = (await listTools()).filter(
        (t) => !filter || t.name.toLowerCase().includes(filter) || t.description?.toLowerCase().includes(filter),
      );
      if (flags.has("--json")) console.log(JSON.stringify(tools, null, 2));
      else for (const t of tools) console.log(`${t.name}\t${(t.description ?? "").split("\n")[0]}`);
      return;
    }
    case "call": {
      const [name, json] = positional;
      if (!name) throw new Error("usage: kt-tadtor call <tool> [json-args]");
      const args = json ? (JSON.parse(json) as Record<string, unknown>) : {};
      const result = await rpc("tools/call", { name, arguments: args });
      console.log(textOf(result));
      if ((result as { isError?: boolean } | undefined)?.isError) process.exitCode = 1;
      return;
    }
    case "setup": {
      const target = positional[0];
      const targets: AgentTarget[] =
        target === "all" ? AGENT_TARGETS : AGENT_TARGETS.includes(target as AgentTarget) ? [target as AgentTarget] : [];
      if (!targets.length) throw new Error(`usage: kt-tadtor setup <${AGENT_TARGETS.join("|")}|all> [--print]`);
      for (const t of targets) {
        const result = setupAgent(t, launcher(), { printOnly: flags.has("--print") });
        (result.ok ? console.log : console.error)(`${result.ok ? "✓" : "✗"} ${result.message}`);
        if (result.manual && !result.ok) console.error(`  ${result.manual}`);
        if (!result.ok) process.exitCode = 1;
      }
      return;
    }
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;
    default:
      throw new Error(`unknown command: ${command}\n\n${HELP}`);
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const hint = /ENOENT|ECONNREFUSED/.test(message) ? "\nเปิดแอป KT ตัดต่อ ก่อน แล้วลองใหม่" : "";
    console.error(`kt-tadtor: ${message}${hint}`);
    process.exit(1);
  });
}
