import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

// KT security: the renderer may only read/write files the user picked in a
// native Save/Open dialog (or temp files the main process minted). Without
// this, any renderer compromise (malicious project/template, Chromium bug)
// could read ~/.ssh or write ~/.zshrc / LaunchAgents through the fs IPC.
// Grants persist so "Recent projects" keep working after a restart.

const MAX_GRANTS = 500;

export class PathGrants {
  private grants: string[] = [];

  constructor(private readonly storeFile?: string) {
    if (storeFile && existsSync(storeFile)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(storeFile, "utf8"));
        if (Array.isArray(parsed)) {
          this.grants = parsed.filter((p): p is string => typeof p === "string" && path.isAbsolute(p));
        }
      } catch {
        this.grants = [];
      }
    }
  }

  private static normalize(p: string): string {
    return path.resolve(p);
  }

  grant(p: string): void {
    if (typeof p !== "string" || !path.isAbsolute(p)) return;
    const normalized = PathGrants.normalize(p);
    this.grants = [normalized, ...this.grants.filter((g) => g !== normalized)].slice(0, MAX_GRANTS);
    this.persist();
  }

  isGranted(p: string): boolean {
    if (typeof p !== "string" || !path.isAbsolute(p)) return false;
    return this.grants.includes(PathGrants.normalize(p));
  }

  /** Throws unless the path was handed out by a dialog or tempFilePath. */
  assert(p: string, action: "read" | "write"): string {
    if (!this.isGranted(p)) {
      throw new Error(
        `Not allowed to ${action} this file. Choose it again with the Open/Save dialog.`,
      );
    }
    return PathGrants.normalize(p);
  }

  private persist(): void {
    if (!this.storeFile) return;
    try {
      mkdirSync(path.dirname(this.storeFile), { recursive: true });
      const tmp = `${this.storeFile}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.grants), { mode: 0o600 });
      renameSync(tmp, this.storeFile);
    } catch {
      // Grants still work for this session; persistence is best-effort.
    }
  }
}
