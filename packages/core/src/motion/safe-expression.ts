/**
 * KT security: a small, sandboxed interpreter for motion/effect expressions.
 *
 * Expressions travel inside project files, templates and AI tool calls, so they
 * are untrusted input. They used to be compiled with `new Function`, which let
 * any project run arbitrary JavaScript in the editor (fetch, storage, desktop
 * IPC…). This module parses a deliberately small JavaScript subset and
 * evaluates it against a host-provided scope only:
 *
 * - literals (number, string, boolean, null), array literals
 * - identifiers from the scope, local `const`/`let`/`var`, `undefined`/`NaN`/`Infinity`
 * - arithmetic, comparison, logical, `??`, ternary, unary `- + ! typeof`
 * - assignment / `++` / `--` to local variables only
 * - member access to OWN properties of host objects (e.g. `Math.sin`,
 *   `thisComp.width`), `.length`/index on strings and arrays
 * - calls to functions the host put in the scope (no way to create functions)
 * - statements: `if/else`, `for(;;)`, `while`, `break`, `continue`, `return`, blocks
 *
 * Everything else (function literals, `new`, `this`, object literals, templates,
 * `constructor`/`__proto__`/`prototype`, globals like `window`/`fetch`) is a
 * compile or runtime error. Execution is bounded by a step budget, so an
 * infinite loop fails fast instead of freezing the renderer.
 */

export type SafeScope = Readonly<Record<string, unknown>>;

export interface SafeExpressionOptions {
  /** Max interpreter steps per evaluation (default 50 000). */
  readonly maxSteps?: number;
}

export type SafeCompileResult =
  | { readonly ok: true; readonly run: (scope: SafeScope, options?: SafeExpressionOptions) => unknown }
  | { readonly ok: false; readonly error: string };

const MAX_SOURCE_LENGTH = 10_000;
const MAX_NESTING = 64;
const DEFAULT_MAX_STEPS = 50_000;

const BLOCKED_MEMBERS = new Set([
  "constructor",
  "__proto__",
  "prototype",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "caller",
  "callee",
  "arguments",
]);

const RESERVED = new Set([
  "function", "new", "this", "class", "import", "export", "await", "async",
  "yield", "delete", "void", "in", "instanceof", "with", "try", "catch",
  "finally", "throw", "switch", "case", "default", "do", "super", "eval",
]);

// ─── Tokenizer ────────────────────────────────────────────────

type TokenType = "num" | "str" | "ident" | "punct" | "eof";
interface Token {
  readonly type: TokenType;
  readonly value: string;
  readonly pos: number;
  readonly end: number;
}

const PUNCTUATORS = [
  "===", "!==", "**=", "...",
  "==", "!=", "<=", ">=", "&&", "||", "??", "**", "++", "--", "+=", "-=", "*=", "/=", "%=", "=>", "?.",
  "+", "-", "*", "/", "%", "<", ">", "!", "=", "?", ":", ",", ";", ".", "(", ")", "[", "]", "{", "}",
];

class ExpressionSyntaxError extends Error {}

function tokenize(src: string): Token[] {
  // (positions let the parser apply automatic semicolons only across newlines)
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end < 0) throw new ExpressionSyntaxError(`Unterminated comment at ${i}`);
      i = end + 2;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(src.slice(i));
      if (!m) throw new ExpressionSyntaxError(`Invalid number at ${i}`);
      tokens.push({ type: "num", value: m[0], pos: i, end: i + m[0].length });
      i += m[0].length;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let out = "";
      while (j < src.length && src[j] !== ch) {
        if (src[j] === "\n") throw new ExpressionSyntaxError(`Unterminated string at ${i}`);
        if (src[j] === "\\") {
          const next = src[j + 1];
          const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"' };
          out += map[next] ?? next ?? "";
          j += 2;
          continue;
        }
        out += src[j];
        j++;
      }
      if (j >= src.length) throw new ExpressionSyntaxError(`Unterminated string at ${i}`);
      tokens.push({ type: "str", value: out, pos: i, end: j + 1 });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i))!;
      tokens.push({ type: "ident", value: m[0], pos: i, end: i + m[0].length });
      i += m[0].length;
      continue;
    }
    const punct = PUNCTUATORS.find((p) => src.startsWith(p, i));
    if (!punct) throw new ExpressionSyntaxError(`Unexpected character "${ch}" at ${i}`);
    tokens.push({ type: "punct", value: punct, pos: i, end: i + punct.length });
    i += punct.length;
  }
  tokens.push({ type: "eof", value: "", pos: src.length, end: src.length });
  return tokens;
}

// ─── AST ──────────────────────────────────────────────────────

type Expr =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "lit"; v: boolean | null }
  | { k: "id"; name: string }
  | { k: "arr"; items: Expr[] }
  | { k: "member"; obj: Expr; prop: Expr; computed: boolean; optional: boolean }
  | { k: "call"; callee: Expr; args: Expr[]; optional: boolean }
  | { k: "unary"; op: string; arg: Expr }
  | { k: "bin"; op: string; l: Expr; r: Expr }
  | { k: "cond"; test: Expr; yes: Expr; no: Expr }
  | { k: "assign"; op: string; name: string; value: Expr }
  | { k: "update"; op: "++" | "--"; prefix: boolean; name: string };

type Stmt =
  | { k: "expr"; e: Expr }
  | { k: "decl"; constant: boolean; decls: { name: string; init: Expr | null }[] }
  | { k: "if"; test: Expr; yes: Stmt; no: Stmt | null }
  | { k: "for"; init: Stmt | null; test: Expr | null; update: Expr | null; body: Stmt }
  | { k: "while"; test: Expr; body: Stmt }
  | { k: "block"; body: Stmt[] }
  | { k: "return"; e: Expr | null }
  | { k: "break" }
  | { k: "continue" }
  | { k: "empty" };

// ─── Parser ───────────────────────────────────────────────────

const BINARY_PRECEDENCE: Record<string, number> = {
  "??": 1, "||": 2, "&&": 3,
  "==": 6, "!=": 6, "===": 6, "!==": 6,
  "<": 7, ">": 7, "<=": 7, ">=": 7,
  "+": 9, "-": 9, "*": 10, "/": 10, "%": 10, "**": 11,
};

class Parser {
  private i = 0;
  private depth = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly src: string,
  ) {}

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.i + offset, this.tokens.length - 1)];
  }
  private next(): Token {
    return this.tokens[this.i++];
  }
  private is(value: string, type: TokenType = "punct"): boolean {
    const t = this.peek();
    return t.type === type && t.value === value;
  }
  private eat(value: string, type: TokenType = "punct"): boolean {
    if (this.is(value, type)) {
      this.i++;
      return true;
    }
    return false;
  }
  private expect(value: string): void {
    if (!this.eat(value)) this.fail(`expected "${value}"`);
  }
  private fail(why: string): never {
    const t = this.peek();
    const near = t.type === "eof" ? "end of input" : `"${t.value}"`;
    throw new ExpressionSyntaxError(`Unexpected ${near} at ${t.pos} (${why})`);
  }
  private enter(): void {
    if (++this.depth > MAX_NESTING) this.fail("expression is nested too deeply");
  }
  private leave(): void {
    this.depth--;
  }
  atEnd(): boolean {
    return this.peek().type === "eof";
  }

  // Statements
  program(): Stmt[] {
    const body: Stmt[] = [];
    while (!this.atEnd()) body.push(this.statement());
    return body;
  }

  private statement(): Stmt {
    this.enter();
    try {
      const t = this.peek();
      if (t.type === "punct" && t.value === "{") return this.block();
      if (t.type === "punct" && t.value === ";") {
        this.next();
        return { k: "empty" };
      }
      if (t.type === "ident") {
        switch (t.value) {
          case "const":
          case "let":
          case "var": {
            const decl = this.declaration();
            this.endStatement();
            return decl;
          }
          case "if": {
            this.next();
            this.expect("(");
            const test = this.expression();
            this.expect(")");
            const yes = this.statement();
            const no = this.eat("else", "ident") ? this.statement() : null;
            return { k: "if", test, yes, no };
          }
          case "for": {
            this.next();
            this.expect("(");
            let init: Stmt | null = null;
            if (!this.is(";")) {
              init = ["const", "let", "var"].includes(this.peek().value) && this.peek().type === "ident"
                ? this.declaration()
                : { k: "expr", e: this.expression() };
            }
            this.expect(";");
            const test = this.is(";") ? null : this.expression();
            this.expect(";");
            const update = this.is(")") ? null : this.expression();
            this.expect(")");
            return { k: "for", init, test, update, body: this.statement() };
          }
          case "while": {
            this.next();
            this.expect("(");
            const test = this.expression();
            this.expect(")");
            return { k: "while", test, body: this.statement() };
          }
          case "return": {
            this.next();
            const e = this.is(";") || this.is("}") || this.atEnd() ? null : this.expression();
            this.endStatement();
            return { k: "return", e };
          }
          case "break":
            this.next();
            this.endStatement();
            return { k: "break" };
          case "continue":
            this.next();
            this.endStatement();
            return { k: "continue" };
        }
      }
      const e = this.expression();
      this.endStatement();
      return { k: "expr", e };
    } finally {
      this.leave();
    }
  }

  private endStatement(): void {
    if (this.eat(";") || this.is("}") || this.atEnd()) return;
    // Automatic semicolon insertion: a line break may end a statement.
    const prev = this.tokens[this.i - 1];
    const cur = this.peek();
    if (prev && this.src.slice(prev.end, cur.pos).includes("\n")) return;
    this.fail('expected ";"');
  }

  private block(): Stmt {
    this.expect("{");
    const body: Stmt[] = [];
    while (!this.is("}")) {
      if (this.atEnd()) this.fail('expected "}"');
      body.push(this.statement());
    }
    this.next();
    return { k: "block", body };
  }

  private declaration(): Stmt {
    const constant = this.next().value === "const";
    const decls: { name: string; init: Expr | null }[] = [];
    do {
      const name = this.identifierName();
      decls.push({ name, init: this.eat("=") ? this.assignment() : null });
    } while (this.eat(","));
    return { k: "decl", constant, decls };
  }

  private identifierName(): string {
    const t = this.next();
    if (t.type !== "ident" || RESERVED.has(t.value)) {
      this.i--;
      this.fail("expected a variable name");
    }
    return t.value;
  }

  // Expressions
  expression(): Expr {
    const first = this.assignment();
    if (this.is(",")) this.fail("comma expressions are not supported");
    return first;
  }

  private assignment(): Expr {
    this.enter();
    try {
      const left = this.conditional();
      const t = this.peek();
      if (t.type === "punct" && ["=", "+=", "-=", "*=", "/=", "%=", "**="].includes(t.value)) {
        if (left.k !== "id") this.fail("only local variables can be assigned");
        this.next();
        return { k: "assign", op: t.value, name: left.name, value: this.assignment() };
      }
      if (t.type === "punct" && t.value === "=>") this.fail("functions are not supported");
      return left;
    } finally {
      this.leave();
    }
  }

  private conditional(): Expr {
    const test = this.binary(0);
    if (!this.eat("?")) return test;
    const yes = this.assignment();
    this.expect(":");
    const no = this.assignment();
    return { k: "cond", test, yes, no };
  }

  private binary(minPrec: number): Expr {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      const prec = t.type === "punct" ? BINARY_PRECEDENCE[t.value] : undefined;
      if (prec === undefined || prec <= minPrec) break;
      this.next();
      // ** is right-associative: parse its right side at one level lower.
      const right = this.binary(t.value === "**" ? prec - 1 : prec);
      left = { k: "bin", op: t.value, l: left, r: right };
    }
    return left;
  }

  private unary(): Expr {
    this.enter();
    try {
      const t = this.peek();
      if (t.type === "punct" && ["-", "+", "!"].includes(t.value)) {
        this.next();
        return { k: "unary", op: t.value, arg: this.unary() };
      }
      if (t.type === "ident" && t.value === "typeof") {
        this.next();
        return { k: "unary", op: "typeof", arg: this.unary() };
      }
      if (t.type === "punct" && (t.value === "++" || t.value === "--")) {
        this.next();
        const target = this.unary();
        if (target.k !== "id") this.fail("only local variables can be incremented");
        return { k: "update", op: t.value, prefix: true, name: target.name };
      }
      return this.postfix();
    } finally {
      this.leave();
    }
  }

  private postfix(): Expr {
    let e = this.primary();
    for (;;) {
      if (this.eat(".")) {
        const t = this.next();
        if (t.type !== "ident") {
          this.i--;
          this.fail("expected a property name");
        }
        e = { k: "member", obj: e, prop: { k: "str", v: t.value }, computed: false, optional: false };
      } else if (this.eat("?.")) {
        if (this.eat("(")) {
          e = { k: "call", callee: e, args: this.args(), optional: true };
        } else if (this.eat("[")) {
          const prop = this.expression();
          this.expect("]");
          e = { k: "member", obj: e, prop, computed: true, optional: true };
        } else {
          const t = this.next();
          if (t.type !== "ident") this.fail("expected a property name");
          e = { k: "member", obj: e, prop: { k: "str", v: t.value }, computed: false, optional: true };
        }
      } else if (this.eat("[")) {
        const prop = this.expression();
        this.expect("]");
        e = { k: "member", obj: e, prop, computed: true, optional: false };
      } else if (this.eat("(")) {
        e = { k: "call", callee: e, args: this.args(), optional: false };
      } else if (this.is("++") || this.is("--")) {
        if (e.k !== "id") this.fail("only local variables can be incremented");
        const op = this.next().value as "++" | "--";
        e = { k: "update", op, prefix: false, name: e.name };
      } else {
        return e;
      }
    }
  }

  private args(): Expr[] {
    const args: Expr[] = [];
    if (this.eat(")")) return args;
    do {
      if (this.is("...")) this.fail("spread is not supported");
      args.push(this.assignment());
    } while (this.eat(","));
    this.expect(")");
    return args;
  }

  private primary(): Expr {
    const t = this.next();
    switch (t.type) {
      case "num":
        return { k: "num", v: Number(t.value) };
      case "str":
        return { k: "str", v: t.value };
      case "ident":
        if (t.value === "true" || t.value === "false") return { k: "lit", v: t.value === "true" };
        if (t.value === "null") return { k: "lit", v: null };
        if (RESERVED.has(t.value) || ["const", "let", "var", "if", "else", "for", "while", "return", "break", "continue"].includes(t.value)) {
          this.i--;
          this.fail(`"${t.value}" is not supported here`);
        }
        return { k: "id", name: t.value };
      case "punct":
        if (t.value === "(") {
          this.enter();
          const e = this.expression();
          this.expect(")");
          this.leave();
          if (this.is("=>")) this.fail("functions are not supported");
          return e;
        }
        if (t.value === "[") {
          const items: Expr[] = [];
          if (!this.eat("]")) {
            do items.push(this.assignment());
            while (this.eat(","));
            this.expect("]");
          }
          return { k: "arr", items };
        }
        if (t.value === "{") {
          this.i--;
          this.fail("object literals are not supported");
        }
        break;
    }
    this.i--;
    return this.fail("expected a value");
  }
}

// ─── Interpreter ──────────────────────────────────────────────

class BreakSignal {}
class ContinueSignal {}
class ReturnSignal {
  constructor(readonly value: unknown) {}
}

const GLOBAL_LITERALS: Record<string, unknown> = {
  undefined,
  NaN,
  Infinity,
};

function isPlainHostObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

class Interpreter {
  private steps = 0;
  private readonly frames: Map<string, { value: unknown; constant: boolean }>[] = [new Map()];

  constructor(
    private readonly scope: SafeScope,
    private readonly maxSteps: number,
  ) {}

  private tick(): void {
    if (++this.steps > this.maxSteps) {
      throw new Error(`Expression exceeded ${this.maxSteps} steps (infinite loop?)`);
    }
  }

  private lookupLocal(name: string): { value: unknown; constant: boolean } | undefined {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const slot = this.frames[i].get(name);
      if (slot) return slot;
    }
    return undefined;
  }

  private readIdent(name: string): unknown {
    const local = this.lookupLocal(name);
    if (local) return local.value;
    if (Object.prototype.hasOwnProperty.call(this.scope, name)) return this.scope[name];
    if (Object.prototype.hasOwnProperty.call(GLOBAL_LITERALS, name)) return GLOBAL_LITERALS[name];
    throw new ReferenceError(`${name} is not defined`);
  }

  private writeIdent(name: string, value: unknown): void {
    const local = this.lookupLocal(name);
    if (!local) throw new ReferenceError(`Cannot assign to "${name}" (declare it with let first)`);
    if (local.constant) throw new TypeError(`Assignment to constant variable "${name}"`);
    local.value = value;
  }

  private getMember(obj: unknown, prop: unknown): unknown {
    if (typeof prop !== "string" && typeof prop !== "number") {
      throw new TypeError("Property names must be strings or numbers");
    }
    const key = String(prop);
    if (BLOCKED_MEMBERS.has(key)) throw new TypeError(`Access to "${key}" is not allowed`);
    if (typeof obj === "string") {
      if (key === "length") return obj.length;
      if (/^\d+$/.test(key)) return obj[Number(key)];
      throw new TypeError(`Strings only support .length and [index]`);
    }
    if (Array.isArray(obj)) {
      if (key === "length") return obj.length;
      if (/^\d+$/.test(key)) return obj[Number(key)];
      throw new TypeError(`Arrays only support .length and [index]`);
    }
    if (typeof obj === "function") throw new TypeError(`Cannot read "${key}" of a function`);
    if (!isPlainHostObject(obj)) {
      throw new TypeError(`Cannot read "${key}" of ${obj === null ? "null" : typeof obj}`);
    }
    // Only the host object's own properties: never the prototype chain.
    return Object.prototype.hasOwnProperty.call(obj, key) ? (obj as Record<string, unknown>)[key] : undefined;
  }

  evalExpr(e: Expr): unknown {
    this.tick();
    switch (e.k) {
      case "num":
      case "str":
      case "lit":
        return e.v;
      case "id":
        return this.readIdent(e.name);
      case "arr":
        return e.items.map((item) => this.evalExpr(item));
      case "member": {
        const obj = this.evalExpr(e.obj);
        if (e.optional && (obj === null || obj === undefined)) return undefined;
        const prop = e.computed ? this.evalExpr(e.prop) : (e.prop as { v: string }).v;
        return this.getMember(obj, prop);
      }
      case "call": {
        let fn: unknown;
        let thisArg: unknown;
        if (e.callee.k === "member") {
          thisArg = this.evalExpr(e.callee.obj);
          if (e.callee.optional && (thisArg === null || thisArg === undefined)) return undefined;
          const prop = e.callee.computed ? this.evalExpr(e.callee.prop) : (e.callee.prop as { v: string }).v;
          fn = this.getMember(thisArg, prop);
        } else {
          fn = this.evalExpr(e.callee);
        }
        if (e.optional && (fn === null || fn === undefined)) return undefined;
        if (typeof fn !== "function") {
          throw new TypeError(`${describeCallee(e.callee)} is not a function`);
        }
        const args = e.args.map((arg) => this.evalExpr(arg));
        // Functions can only come from the host scope (there is no function
        // syntax), so this only ever calls trusted, app-provided helpers.
        return Reflect.apply(fn, isPlainHostObject(thisArg) ? thisArg : undefined, args);
      }
      case "unary": {
        if (e.op === "typeof") {
          if (e.arg.k === "id" && !this.lookupLocal(e.arg.name) &&
            !Object.prototype.hasOwnProperty.call(this.scope, e.arg.name) &&
            !Object.prototype.hasOwnProperty.call(GLOBAL_LITERALS, e.arg.name)) {
            return "undefined";
          }
          const v = this.evalExpr(e.arg);
          return v === null ? "object" : typeof v;
        }
        const v = this.evalExpr(e.arg);
        if (e.op === "!") return !v;
        if (e.op === "-") return -(v as number);
        return +(v as number);
      }
      case "bin": {
        if (e.op === "&&") return this.evalExpr(e.l) && this.evalExpr(e.r);
        if (e.op === "||") return this.evalExpr(e.l) || this.evalExpr(e.r);
        if (e.op === "??") return this.evalExpr(e.l) ?? this.evalExpr(e.r);
        return binaryOp(e.op, this.evalExpr(e.l), this.evalExpr(e.r));
      }
      case "cond":
        return this.evalExpr(e.test) ? this.evalExpr(e.yes) : this.evalExpr(e.no);
      case "assign": {
        const value = this.evalExpr(e.value);
        const next = e.op === "=" ? value : binaryOp(e.op.slice(0, -1), this.readIdent(e.name), value);
        this.writeIdent(e.name, next);
        return next;
      }
      case "update": {
        const before = Number(this.readIdent(e.name));
        const after = e.op === "++" ? before + 1 : before - 1;
        this.writeIdent(e.name, after);
        return e.prefix ? after : before;
      }
    }
  }

  exec(s: Stmt): void {
    this.tick();
    switch (s.k) {
      case "empty":
        return;
      case "expr":
        this.evalExpr(s.e);
        return;
      case "decl": {
        const frame = this.frames[this.frames.length - 1];
        for (const d of s.decls) {
          if (frame.has(d.name)) throw new SyntaxError(`Identifier "${d.name}" has already been declared`);
          frame.set(d.name, { value: d.init ? this.evalExpr(d.init) : undefined, constant: s.constant });
        }
        return;
      }
      case "if":
        if (this.evalExpr(s.test)) this.exec(s.yes);
        else if (s.no) this.exec(s.no);
        return;
      case "block":
        this.frames.push(new Map());
        try {
          for (const stmt of s.body) this.exec(stmt);
        } finally {
          this.frames.pop();
        }
        return;
      case "for":
        this.frames.push(new Map());
        try {
          if (s.init) this.exec(s.init);
          while (s.test ? this.evalExpr(s.test) : true) {
            try {
              this.exec(s.body);
            } catch (signal) {
              if (signal instanceof BreakSignal) break;
              if (!(signal instanceof ContinueSignal)) throw signal;
            }
            if (s.update) this.evalExpr(s.update);
          }
        } finally {
          this.frames.pop();
        }
        return;
      case "while":
        while (this.evalExpr(s.test)) {
          try {
            this.exec(s.body);
          } catch (signal) {
            if (signal instanceof BreakSignal) break;
            if (!(signal instanceof ContinueSignal)) throw signal;
          }
        }
        return;
      case "return":
        throw new ReturnSignal(s.e ? this.evalExpr(s.e) : undefined);
      case "break":
        throw new BreakSignal();
      case "continue":
        throw new ContinueSignal();
    }
  }

  runProgram(body: Stmt[]): unknown {
    try {
      for (const stmt of body) this.exec(stmt);
      return undefined;
    } catch (signal) {
      if (signal instanceof ReturnSignal) return signal.value;
      if (signal instanceof BreakSignal || signal instanceof ContinueSignal) {
        throw new SyntaxError("break/continue outside of a loop");
      }
      throw signal;
    }
  }
}

function describeCallee(e: Expr): string {
  if (e.k === "id") return e.name;
  if (e.k === "member" && !e.computed) return `${describeCallee(e.obj)}.${(e.prop as { v: string }).v}`;
  return "expression";
}

function binaryOp(op: string, l: unknown, r: unknown): unknown {
  const a = l as number;
  const b = r as number;
  switch (op) {
    case "+":
      return (l as string) + (r as string);
    case "-": return a - b;
    case "*": return a * b;
    case "/": return a / b;
    case "%": return a % b;
    case "**": return a ** b;
    case "<": return a < b;
    case ">": return a > b;
    case "<=": return a <= b;
    case ">=": return a >= b;
    case "==": return l == r; // eslint-disable-line eqeqeq
    case "!=": return l != r; // eslint-disable-line eqeqeq
    case "===": return l === r;
    case "!==": return l !== r;
  }
  throw new SyntaxError(`Unsupported operator ${op}`);
}

// ─── Public API ───────────────────────────────────────────────

function parseAsExpression(tokens: Token[], source: string): Expr | null {
  try {
    const parser = new Parser(tokens, source);
    const e = parser.expression();
    return parser.atEnd() ? e : null;
  } catch {
    return null;
  }
}

/**
 * Compiles an expression (`value + 10`) or a statement body
 * (`const a = value * 2; return a + 1;`). Bodies without `return` yield
 * `undefined`, matching the previous behaviour.
 */
export function compileSafeExpression(source: string): SafeCompileResult {
  if (typeof source !== "string") return { ok: false, error: "Expression must be text" };
  if (source.length > MAX_SOURCE_LENGTH) {
    return { ok: false, error: `Expression is longer than ${MAX_SOURCE_LENGTH} characters` };
  }
  let tokens: Token[];
  try {
    tokens = tokenize(source);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  const expr = parseAsExpression(tokens, source);
  if (expr) {
    return {
      ok: true,
      run: (scope, options) => new Interpreter(scope, options?.maxSteps ?? DEFAULT_MAX_STEPS).evalExpr(expr),
    };
  }

  let program: Stmt[];
  try {
    program = new Parser(tokens, source).program();
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  return {
    ok: true,
    run: (scope, options) => new Interpreter(scope, options?.maxSteps ?? DEFAULT_MAX_STEPS).runProgram(program),
  };
}
