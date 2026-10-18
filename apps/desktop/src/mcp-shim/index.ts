#!/usr/bin/env node
import { createInterface } from "node:readline";
import type { McpEndpoint } from "../shared/mcp";
import { postRpc, readEndpoint } from "../shared/mcp-client";

interface RpcMessage {
  id?: string | number | null;
  method?: string;
}

export type RpcPoster = (message: RpcMessage) => Promise<unknown>;

/**
 * Forwards one newline-delimited JSON-RPC line to the upstream poster and
 * returns the response line to emit (or null for notifications / blank lines).
 * Pure relative to `post` so it is unit-testable.
 */
export async function forwardLine(
  line: string,
  post: RpcPoster,
): Promise<string | null> {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let message: RpcMessage;
  try {
    message = JSON.parse(trimmed) as RpcMessage;
  } catch {
    return null;
  }
  const isNotification = message.id === undefined || message.id === null;
  try {
    const response = await post(message);
    if (response === null || response === undefined) return null;
    return JSON.stringify(response);
  } catch (error) {
    if (isNotification) return null;
    return JSON.stringify({
      jsonrpc: "2.0",
      id: message.id ?? null,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

/** Bridges stdin/stdout JSON-RPC to the running app (used by `kt-tadtor mcp` too). */
export function runStdioBridge(): void {
  let endpoint: McpEndpoint;
  try {
    endpoint = readEndpoint();
  } catch (error) {
    process.stderr.write(
      `kt-tadtor-mcp: ${error instanceof Error ? error.message : String(error)}\n` +
        "Is the KT Tadtor desktop app running?\n",
    );
    process.exit(1);
  }

  const post: RpcPoster = (message) => postRpc(endpoint, message);
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    void forwardLine(line, post)
      .then((out) => {
        if (out !== null) process.stdout.write(`${out}\n`);
      })
      .catch((error) => {
        process.stderr.write(
          `kt-tadtor-mcp: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      });
  });
  rl.on("close", () => process.exit(0));
}

// Only auto-run as the standalone shim entry; the kt-tadtor CLI bundles this
// module and calls runStdioBridge() itself.
if (require.main === module && /mcp-shim/.test(__filename)) {
  runStdioBridge();
}
