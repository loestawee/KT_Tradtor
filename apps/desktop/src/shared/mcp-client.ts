import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { endpointFilePath, type McpEndpoint } from "./mcp";

// Electron-free client for the desktop app's local MCP endpoint. Shared by the
// stdio shim and the kt-tadtor CLI.

export interface RpcMessage {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export function readEndpoint(): McpEndpoint {
  const file = endpointFilePath();
  const raw = readFileSync(file, "utf8");
  const parsed = JSON.parse(raw) as Partial<McpEndpoint>;
  if (!parsed.url || !parsed.token) {
    throw new Error(`Invalid MCP endpoint file at ${file}`);
  }
  return { url: parsed.url, port: parsed.port ?? 0, token: parsed.token };
}

export function postRpc(endpoint: McpEndpoint, message: RpcMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint.url);
    const body = JSON.stringify(message);
    const req = httpRequest(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Authorization: `Bearer ${endpoint.token}`,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode === 202 || text.length === 0) {
            resolve(null);
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${text}`));
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
