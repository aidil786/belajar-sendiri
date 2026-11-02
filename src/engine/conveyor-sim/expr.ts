// A small evaluator for GitHub Actions expressions: `${{ ... }}` and `if:`.
// https://docs.github.com/en/actions/reference/workflows-and-actions/expressions
// Supported: literals, contexts with `.name`, `['name']` and `.*`, ! == != < <= > >= && || ( ),
// and the functions contains, startsWith, endsWith, format, join, toJSON, fromJSON, hashFiles,
// success, failure, always, cancelled. Strings compare without case, like GitHub.

export type Value = string | number | boolean | null | Value[] | { [k: string]: Value };

export class ExprError extends Error {}

export interface ExprContext {
  /** A top-level context: github, env, vars, secrets, matrix, needs, steps, inputs, runner, job, strategy. */
  context: (name: string) => Value | undefined;
  /** Job status so far, for success() / failure() / cancelled(). */
  status?: 'success' | 'failure' | 'cancelled';
  hashFiles?: (patterns: string[]) => string;
}

type Tok = { k: 'num'; v: number } | { k: 'str'; v: string } | { k: 'id'; v: string } | { k: 'op'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "'") {
      let s = '';
      i++;
      for (;;) {
        if (i >= src.length) throw new ExprError('Unclosed string');
        if (src[i] === "'") {
          if (src[i + 1] === "'") {
            s += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        s += src[i++];
      }
      out.push({ k: 'str', v: s });
      continue;
    }
    const num = /^(0x[0-9a-fA-F]+|-?\d+(\.\d+)?([eE][-+]?\d+)?)/.exec(src.slice(i));
    if (num && (ch !== '-' || /[\d]/.test(src[i + 1] ?? ''))) {
      out.push({ k: 'num', v: Number(num[1]) });
      i += num[1]!.length;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(src.slice(i));
    if (id) {
      out.push({ k: 'id', v: id[0] });
      i += id[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) {
      out.push({ k: 'op', v: two });
      i += 2;
      continue;
    }
    if ('!<>()[].,*'.includes(ch)) {
      out.push({ k: 'op', v: ch });
      i++;
      continue;
    }
    throw new ExprError(`Unexpected symbol: '${ch}'`);
  }
  return out;
}

type Node =
  | { t: 'lit'; v: Value }
  | { t: 'ctx'; name: string }
  | { t: 'prop'; obj: Node; key: Node | '*' }
  | { t: 'call'; fn: string; args: Node[] }
  | { t: 'not'; x: Node }
  | { t: 'bin'; op: string; a: Node; b: Node };

const FUNCS = new Set(['contains', 'startswith', 'endswith', 'format', 'join', 'tojson', 'fromjson', 'hashfiles', 'success', 'failure', 'always', 'cancelled']);

function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.k === 'op' && peek()!.v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new ExprError(`Expected '${v}'`);
    p++;
  };
  const binary = (ops: string[], next: () => Node) => (): Node => {
    let a = next();
    for (let tok = peek(); tok?.k === 'op' && ops.includes(tok.v); tok = peek()) {
      p++;
      a = { t: 'bin', op: tok.v, a, b: next() };
    }
    return a;
  };
  const primary = (): Node => {
    const tok = toks[p++];
    if (!tok) throw new ExprError('Unexpected end of expression');
    if (tok.k === 'num' || tok.k === 'str') return { t: 'lit', v: tok.v };
    if (tok.k === 'op' && tok.v === '(') {
      const e = or();
      expect(')');
      return e;
    }
    if (tok.k === 'id') {
      const low = tok.v.toLowerCase();
      if (low === 'true' || low === 'false') return { t: 'lit', v: low === 'true' };
      if (low === 'null') return { t: 'lit', v: null };
      if (isOp('(')) {
        if (!FUNCS.has(low)) throw new ExprError(`Unknown function: ${tok.v}`);
        p++;
        const args: Node[] = [];
        if (!isOp(')')) {
          args.push(or());
          while (isOp(',')) {
            p++;
            args.push(or());
          }
        }
        expect(')');
        return { t: 'call', fn: low, args };
      }
      return { t: 'ctx', name: low };
    }
    throw new ExprError(`Unexpected '${tok.v}'`);
  };
  const postfix = (): Node => {
    let n = primary();
    for (;;) {
      if (isOp('.')) {
        p++;
        if (isOp('*')) {
          p++;
          n = { t: 'prop', obj: n, key: '*' };
          continue;
        }
        const tok = toks[p++];
        if (!tok || tok.k !== 'id') throw new ExprError('Expected a name after "."');
        n = { t: 'prop', obj: n, key: { t: 'lit', v: tok.v } };
      } else if (isOp('[')) {
        p++;
        if (isOp('*')) {
          p++;
          expect(']');
          n = { t: 'prop', obj: n, key: '*' };
          continue;
        }
        const key = or();
        expect(']');
        n = { t: 'prop', obj: n, key };
      } else return n;
    }
  };
  const unary = (): Node => {
    if (isOp('!')) {
      p++;
      return { t: 'not', x: unary() };
    }
    return postfix();
  };
  const cmp = binary(['==', '!=', '<', '<=', '>', '>='], unary);
  const and = binary(['&&'], cmp);
  const or = binary(['||'], and);
  const e = or();
  if (p < toks.length) throw new ExprError(`Unexpected '${String(toks[p]!.v)}'`);
  return e;
}

export function truthy(v: Value | undefined): boolean {
  if (v === null || v === undefined || v === false || v === '' || v === 0) return false;
  if (typeof v === 'number' && Number.isNaN(v)) return false;
  return true;
}

export function toStr(v: Value | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v, null, 2);
}

function toNum(v: Value | undefined): number {
  if (v === null || v === undefined || v === false) return 0;
  if (v === true) return 1;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return v.trim() === '' ? 0 : Number(v);
  return NaN;
}

function looseEq(a: Value | undefined, b: Value | undefined): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  if (typeof a === 'object' || typeof b === 'object') return a === b;
  return toNum(a) === toNum(b);
}

function getProp(obj: Value | undefined, key: string): Value | undefined {
  if (obj === null || obj === undefined || typeof obj !== 'object') return undefined;
  if (Array.isArray(obj)) {
    const n = Number(key);
    return Number.isInteger(n) ? obj[n] : undefined;
  }
  if (key in obj) return obj[key];
  const low = key.toLowerCase();
  const k = Object.keys(obj).find((x) => x.toLowerCase() === low);
  return k === undefined ? undefined : obj[k];
}

function evalNode(n: Node, ctx: ExprContext): Value | undefined {
  switch (n.t) {
    case 'lit':
      return n.v;
    case 'ctx':
      return ctx.context(n.name);
    case 'not':
      return !truthy(evalNode(n.x, ctx));
    case 'prop': {
      const obj = evalNode(n.obj, ctx);
      if (n.key === '*') {
        if (Array.isArray(obj)) return obj;
        if (obj && typeof obj === 'object') return Object.values(obj);
        return [];
      }
      const key = toStr(evalNode(n.key, ctx));
      // `.*` then `.name`: map over the list.
      if (Array.isArray(obj) && !/^\d+$/.test(key)) return obj.map((o) => getProp(o, key) ?? null);
      return getProp(obj, key);
    }
    case 'bin': {
      if (n.op === '&&') {
        const a = evalNode(n.a, ctx);
        return truthy(a) ? evalNode(n.b, ctx) : a;
      }
      if (n.op === '||') {
        const a = evalNode(n.a, ctx);
        return truthy(a) ? a : evalNode(n.b, ctx);
      }
      const a = evalNode(n.a, ctx);
      const b = evalNode(n.b, ctx);
      if (n.op === '==') return looseEq(a, b);
      if (n.op === '!=') return !looseEq(a, b);
      const [x, y] = typeof a === 'string' && typeof b === 'string' ? [a.toLowerCase(), b.toLowerCase()] : [toNum(a), toNum(b)];
      if (n.op === '<') return x < y;
      if (n.op === '<=') return x <= y;
      if (n.op === '>') return x > y;
      return x >= y;
    }
    case 'call': {
      const args = n.args.map((a) => evalNode(a, ctx));
      const s = (i: number) => toStr(args[i]).toLowerCase();
      switch (n.fn) {
        case 'success':
          return (ctx.status ?? 'success') === 'success';
        case 'failure':
          return ctx.status === 'failure';
        case 'cancelled':
          return ctx.status === 'cancelled';
        case 'always':
          return true;
        case 'contains': {
          const hay = args[0];
          if (Array.isArray(hay)) return hay.some((x) => looseEq(x, args[1]));
          return s(0).includes(s(1));
        }
        case 'startswith':
          return s(0).startsWith(s(1));
        case 'endswith':
          return s(0).endsWith(s(1));
        case 'format':
          return toStr(args[0]).replace(/\{(\d+)\}/g, (_, i: string) => toStr(args[Number(i) + 1]));
        case 'join': {
          const sep = args.length > 1 ? toStr(args[1]) : ',';
          return Array.isArray(args[0]) ? args[0].map(toStr).join(sep) : toStr(args[0]);
        }
        case 'tojson':
          return JSON.stringify(args[0] ?? null, null, 2);
        case 'fromjson':
          try {
            return JSON.parse(toStr(args[0])) as Value;
          } catch {
            throw new ExprError('fromJSON needs valid JSON');
          }
        case 'hashfiles':
          return ctx.hashFiles ? ctx.hashFiles(args.map(toStr)) : '';
      }
      return null;
    }
  }
}

/** Check an expression's syntax. Returns the error message, or null when it is fine. */
export function exprError(src: string): string | null {
  try {
    parse(src);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

export function evaluate(src: string, ctx: ExprContext): Value | undefined {
  return evalNode(parse(src), ctx);
}

/** Every `${{ ... }}` inside a string. */
export function expressionsIn(text: string): { expr: string; index: number }[] {
  const out: { expr: string; index: number }[] = [];
  const re = /\$\{\{([\s\S]*?)\}\}/g;
  for (const m of text.matchAll(re)) out.push({ expr: m[1]!.trim(), index: m.index });
  return out;
}

/** Replace every `${{ ... }}` with its value. */
export function interpolate(text: string, ctx: ExprContext): string {
  return text.replace(/\$\{\{([\s\S]*?)\}\}/g, (_, e: string) => toStr(evaluate(e.trim(), ctx)));
}

const STATUS_FN = /\b(success|failure|always|cancelled)\s*\(/i;

/** Evaluate an `if:` condition. No status function inside means `success() && (...)`, like GitHub. */
export function evalIf(cond: string | undefined, ctx: ExprContext): boolean {
  if (cond === undefined || cond.trim() === '') return (ctx.status ?? 'success') === 'success';
  let src = cond.trim();
  const whole = /^\$\{\{([\s\S]*)\}\}$/.exec(src);
  if (whole && !whole[1]!.includes('}}')) src = whole[1]!.trim();
  else if (src.includes('${{')) src = `'${interpolate(src, ctx).replace(/'/g, "''")}'`;
  if (!STATUS_FN.test(src)) {
    if ((ctx.status ?? 'success') !== 'success') return false;
  }
  return truthy(evaluate(src, ctx));
}
