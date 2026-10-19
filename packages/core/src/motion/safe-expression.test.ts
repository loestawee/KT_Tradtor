import { afterEach, describe, expect, it } from "vitest";
import { compileSafeExpression, type SafeScope } from "./safe-expression";

function run(code: string, scope: SafeScope = {}): unknown {
  const compiled = compileSafeExpression(code);
  if (!compiled.ok) throw new Error(`compile: ${compiled.error}`);
  return compiled.run(scope);
}

function compileError(code: string): string {
  const compiled = compileSafeExpression(code);
  if (compiled.ok) throw new Error(`expected "${code}" to fail to compile`);
  return compiled.error;
}

const layer = { index: 2, name: "Logo", value: (p: string) => (p === "x" ? 40 : 0) };
const scope: SafeScope = {
  value: 10,
  time: 2,
  Math,
  wiggle: (f: number, a: number) => 10 + f * a,
  clamp: (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v)),
  thisLayer: layer,
  thisComp: { width: 1920, layer: () => layer },
};

describe("compileSafeExpression — language subset", () => {
  it.each([
    ["value + 10", 20],
    ["value * 2 + time ** 2", 24],
    ["2 ** 3 ** 2", 512],
    ["-value + +time", -8],
    ["(value > 5) ? 1 : 0", 1],
    ["value >= 10 && time < 3", true],
    ["null ?? 7", 7],
    ["value % 3", 1],
    ["Math.sin(0) + Math.PI", Math.PI],
    ["Math.max(1, value, 3)", 10],
    ["clamp(value * 10, 0, 50)", 50],
    ["wiggle(2, 3)", 16],
    ["thisLayer.index", 2],
    ["thisLayer.name.length", 4],
    ['thisComp.layer("Logo").value("x") + 1', 41],
    ["thisComp.width / 2", 960],
    ["[1, 2, 3][1] + [4, 5].length", 4],
    ["typeof value", "number"],
    ["typeof notDefinedAnywhere", "undefined"],
    ["thisLayer?.missing?.deep", undefined],
  ])("%s", (code, expected) => {
    expect(run(code, scope)).toEqual(expected);
  });

  it("runs statement bodies with locals, if/else, loops and return", () => {
    expect(run("const a = value * 2;\nreturn a + 1;", scope)).toBe(21);
    expect(run("let total = 0; for (let i = 0; i < 5; i++) { total += i; } return total;", scope)).toBe(10);
    expect(run("let n = 0; while (true) { n++; if (n > 3) break; } return n;", scope)).toBe(4);
    expect(run("let s = 0; for (let i = 0; i < 6; i++) { if (i % 2) continue; s += i; } return s;", scope)).toBe(6);
    expect(run("if (value > 100) { return 1 } else if (value > 5) { return 2 } return 3", scope)).toBe(2);
    expect(run("let x = 1\nx = x + 1\nreturn x", scope)).toBe(2);
    // A body without return yields undefined (callers fall back to the base value).
    expect(run("const a = 1;", scope)).toBeUndefined();
  });

  it("keeps block scoping and const semantics", () => {
    expect(() => run("const a = 1; a = 2; return a;")).toThrow(/constant/);
    expect(() => run("{ let inner = 1; } return inner;")).toThrow(/inner is not defined/);
    expect(() => run("let a = 1; let a = 2;")).toThrow(/already been declared/);
  });

  it("reports useful compile errors", () => {
    expect(compileError("value +")).toMatch(/Unexpected/);
    expect(compileError("return a +")).toMatch(/Unexpected/);
    expect(compileError("this is (not valid javascript")).toMatch(/not supported|Unexpected/);
    expect(compileError("value value")).toMatch(/expected ";"/);
    expect(compileError("'unterminated")).toMatch(/Unterminated/);
  });
});

describe("compileSafeExpression — sandbox", () => {
  const g = globalThis as Record<string, unknown>;
  afterEach(() => {
    delete g.__ktPwned;
  });

  it.each([
    "window",
    "globalThis",
    "fetch('https://evil.example')",
    "document.cookie",
    "localStorage",
    "alert(1)",
    "eval('1')",
    "Function('return this')()",
    "process",
    "require('fs')",
    "openreel",
  ])("cannot reach host globals: %s", (code) => {
    const compiled = compileSafeExpression(code);
    if (compiled.ok) expect(() => compiled.run(scope)).toThrow();
  });

  it.each([
    "Math.constructor",
    "Math.max.constructor",
    "Math.__proto__",
    "thisLayer.constructor",
    "thisLayer['constructor']",
    "thisLayer['__proto__']",
    "'abc'.constructor",
    "[].constructor",
    "value.constructor",
    "Math.max.call",
    "'x'.toUpperCase()",
    "thisLayer.value.apply(null, ['x'])",
  ])("cannot climb to Function/prototypes: %s", (code) => {
    expect(() => run(code, scope)).toThrow();
  });

  it("does not expose inherited properties of host objects", () => {
    expect(run("thisLayer.toString", scope)).toBeUndefined();
    expect(run("thisLayer.hasOwnProperty", scope)).toBeUndefined();
  });

  it.each([
    "(() => 1)()",
    "function f() { return 1 }",
    "new Date()",
    "this",
    "({ a: 1 })",
    "`template ${value}`",
    "delete thisLayer.name",
    "thisLayer.name = 'x'",
    "Math.PI = 3",
    "value = 1",
  ])("rejects unsupported or mutating syntax: %s", (code) => {
    const compiled = compileSafeExpression(code);
    if (compiled.ok) expect(() => compiled.run(scope)).toThrow();
  });

  it("never mutates the host scope", () => {
    const host = { value: 1 } as const;
    expect(() => run("value = 99", host)).toThrow();
    expect(host.value).toBe(1);
  });

  it("stops infinite loops with a step budget", () => {
    const compiled = compileSafeExpression("while (true) {}");
    expect(compiled.ok).toBe(true);
    if (compiled.ok) expect(() => compiled.run({}, { maxSteps: 5_000 })).toThrow(/steps/);
    const forever = compileSafeExpression("for (;;) { }");
    if (forever.ok) expect(() => forever.run({})).toThrow(/steps/);
  });

  it("rejects oversized or deeply nested input instead of overflowing the stack", () => {
    expect(compileSafeExpression("1+".repeat(6000) + "1").ok).toBe(false); // > 10 000 chars
    expect(compileSafeExpression("(".repeat(500) + "1" + ")".repeat(500)).ok).toBe(false);
  });

  it("no global side effects are possible", () => {
    const attempts = [
      "__ktPwned = 1",
      "globalThis.__ktPwned = 1",
      "thisComp.layer.constructor('globalThis.__ktPwned = 1')()",
    ];
    for (const code of attempts) {
      const compiled = compileSafeExpression(code);
      if (compiled.ok) {
        try {
          compiled.run(scope);
        } catch {
          // expected
        }
      }
    }
    expect(g.__ktPwned).toBeUndefined();
  });
});
