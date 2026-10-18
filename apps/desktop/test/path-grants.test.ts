import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PathGrants } from "../src/main/ipc/path-grants";

const dir = mkdtempSync(path.join(tmpdir(), "kt-grants-"));
const store = path.join(dir, "grants.json");

describe("PathGrants", () => {
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("denies anything that was not granted", () => {
    const grants = new PathGrants();
    expect(() => grants.assert("/Users/me/.zshrc", "write")).toThrow(/Not allowed to write/);
    expect(() => grants.assert(path.join(dir, "x.json"), "read")).toThrow(/Not allowed to read/);
  });

  it("allows exactly the granted path, normalising traversal tricks", () => {
    const grants = new PathGrants();
    const file = path.join(dir, "project.json");
    grants.grant(file);
    expect(grants.assert(file, "write")).toBe(file);
    expect(grants.isGranted(path.join(dir, "sub", "..", "project.json"))).toBe(true);
    expect(grants.isGranted(path.join(dir, "project.json.bak"))).toBe(false);
    expect(grants.isGranted(dir)).toBe(false);
  });

  it("rejects relative paths and non-strings", () => {
    const grants = new PathGrants();
    grants.grant("relative.json");
    expect(grants.isGranted("relative.json")).toBe(false);
    expect(grants.isGranted(undefined as unknown as string)).toBe(false);
  });

  it("persists grants across instances (recent projects after restart)", () => {
    const file = path.join(dir, "recent.json");
    new PathGrants(store).grant(file);
    expect(new PathGrants(store).isGranted(file)).toBe(true);
    expect(JSON.parse(readFileSync(store, "utf8"))).toContain(file);
  });

  it("ignores a corrupted or tampered store", () => {
    writeFileSync(store, '{"not":"an array"}');
    expect(new PathGrants(store).isGranted("/etc/passwd")).toBe(false);
    writeFileSync(store, JSON.stringify(["relative/path", 42]));
    expect(new PathGrants(store).isGranted("relative/path")).toBe(false);
  });
});
