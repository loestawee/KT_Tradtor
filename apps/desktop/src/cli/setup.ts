import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  codexTomlBlock,
  configPath,
  currentEnv,
  jsonServerEntry,
  mergeCodexToml,
  mergeJsonConfig,
  SERVER_NAME,
  type AgentTarget,
  type Launcher,
} from "./agent-config";

// Registers KT ตัดต่อ's MCP server with an AI client. Shared by the
// `kt-tadtor setup` command and the desktop Settings → MCP buttons.

export interface SetupResult {
  ok: boolean;
  /** Human-readable outcome (Thai). */
  message: string;
  /** Command or snippet the user can run/paste when automatic setup is impossible. */
  manual?: string;
}

/** GUI apps on macOS get a minimal PATH, so look in the usual install spots too. */
function findClaude(): string | null {
  const home = os.homedir();
  const names = process.platform === "win32" ? ["claude.cmd", "claude.exe"] : ["claude"];
  const dirs = [
    ...(process.env.PATH ?? "").split(path.delimiter),
    path.join(home, ".claude", "local"),
    path.join(home, ".local", "bin"),
    path.join(home, ".npm-global", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    ...(process.env.APPDATA ? [path.join(process.env.APPDATA, "npm")] : []),
  ];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (dir && existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function claudeCodeCommand(launcher: Launcher): string {
  const json = JSON.stringify(jsonServerEntry(launcher, { withType: true }));
  return `claude mcp add-json --scope user ${SERVER_NAME} '${json}'`;
}

export function setupAgent(
  target: AgentTarget,
  launcher: Launcher,
  opts: { printOnly?: boolean } = {},
): SetupResult {
  if (target === "claude-code") {
    const manual = claudeCodeCommand(launcher);
    if (opts.printOnly) return { ok: true, message: manual, manual };
    const claude = findClaude();
    if (!claude) {
      return { ok: false, message: "ไม่พบคำสั่ง claude — ให้รันคำสั่งนี้ใน Terminal เอง", manual };
    }
    const shell = process.platform === "win32";
    // On Windows `claude` is a .cmd shim that needs a shell, and cmd.exe would
    // mangle a JSON argument; there we use `mcp add` with each value quoted.
    const quote = (value: string) => (shell ? `"${value}"` : value);
    const args = shell
      ? [
          "mcp", "add", "--scope", "user",
          ...Object.entries(launcher.env ?? {}).flatMap(([k, v]) => ["-e", quote(`${k}=${v}`)]),
          SERVER_NAME, "--", quote(launcher.command), ...launcher.args.map(quote),
        ]
      : ["mcp", "add-json", "--scope", "user", SERVER_NAME, JSON.stringify(jsonServerEntry(launcher, { withType: true }))];
    spawnSync(claude, ["mcp", "remove", "--scope", "user", SERVER_NAME], { stdio: "ignore", shell });
    const res = spawnSync(claude, args, { encoding: "utf8", shell });
    if (res.error || res.status !== 0) {
      return {
        ok: false,
        message: `เพิ่มใน Claude Code ไม่สำเร็จ: ${(res.stderr || res.error?.message || "").trim()}`,
        manual,
      };
    }
    return { ok: true, message: "Claude Code: เพิ่ม MCP server 'kt-tadtor' แล้ว" };
  }

  const file = configPath(target, currentEnv());
  if (opts.printOnly) {
    const snippet = target === "codex" ? codexTomlBlock(launcher) : mergeJsonConfig(null, launcher);
    return { ok: true, message: `# ${target} → ${file}\n${snippet}`, manual: snippet };
  }
  const existing = existsSync(file) ? readFileSync(file, "utf8") : null;
  let content: string;
  try {
    content = target === "codex" ? mergeCodexToml(existing, launcher) : mergeJsonConfig(existing, launcher);
  } catch (error) {
    return {
      ok: false,
      message: `อ่านไฟล์ตั้งค่าเดิมไม่ได้ (${file}): ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  mkdirSync(path.dirname(file), { recursive: true });
  if (existing !== null) writeFileSync(`${file}.kt-backup`, existing);
  writeFileSync(file, content);
  const restart = target === "codex" ? "" : " (ปิดแล้วเปิดโปรแกรมใหม่เพื่อให้มีผล)";
  return {
    ok: true,
    message: `${target}: เขียน ${file}${existing !== null ? " (สำรองเดิมไว้ที่ .kt-backup)" : ""}${restart}`,
  };
}
