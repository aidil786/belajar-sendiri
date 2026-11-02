// Expression evaluation: HCL expressions → values, with unknowns and sensitive marks carried
// through like OpenTofu does. References (var., local., resources …) are answered by a Scope.
import { convert, ConvertError, unifyTypes } from './convert';
import { err, type Diag, DiagError } from './diag';
import { callFunction, FUNCTION_NAMES, FuncError, functionArity, hasFunction, type FuncCtx } from './functions';
import type { Expr, Range, Step } from './hcl';
import {
  T_BOOL,
  T_DYN,
  T_NUMBER,
  T_STRING,
  bool,
  hasSensitive,
  isMapLike,
  isUnknown,
  keyOf,
  list,
  num,
  numStr,
  object,
  str,
  tuple,
  unknown,
  type Val,
} from './values';

export interface Scope {
  /** Resolve a root reference: returns the value and how many steps it used. */
  ref(root: string, steps: Step[], range: Range): { val: Val; used: number };
  fn: FuncCtx;
  /** Names bound by for expressions, count and each. */
  locals?: Record<string, Val>;
}

export function child(scope: Scope, locals: Record<string, Val>): Scope {
  return { ref: scope.ref, fn: scope.fn, locals: { ...scope.locals, ...locals } };
}

const fail = (d: Diag): never => {
  throw new DiagError([d]);
};

/** Edit distance, for "Did you mean …?" suggestions (like OpenTofu's nameSuggestion). */
export function suggest(name: string, options: string[]): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const o of options) {
    const d = lev(name, o);
    if (d < 3 && d < bestD) {
      best = o;
      bestD = d;
    }
  }
  return best;
}

function lev(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length]![b.length]!;
}

/** How OpenTofu shows a value in "├── │ var.x is 20" lines. */
export function describe(v: Val): string {
  if (isUnknown(v)) return 'a string, known only after apply';
  if (v.s) return 'has a sensitive value';
  if (v.v === null) return 'null';
  if (typeof v.v === 'string') return JSON.stringify(v.v);
  if (typeof v.v === 'number') return numStr(v.v);
  if (typeof v.v === 'boolean') return String(v.v);
  if (Array.isArray(v.v)) return `${v.ty.k === 'tuple' ? 'tuple' : v.ty.k} with ${v.v.length} element${v.v.length === 1 ? '' : 's'}`;
  const n = Object.keys(v.v as object).length;
  return v.ty.k === 'map' ? `map of ${v.ty.e.k} with ${n} element${n === 1 ? '' : 's'}` : `object with ${n} attribute${n === 1 ? '' : 's'}`;
}

/** Apply attribute / index / splat steps to a value. */
export function traverse(v: Val, steps: Step[], range: Range): Val {
  let cur = v;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    if (s.t === 'splat') {
      const rest = steps.slice(i + 1);
      if (isUnknown(cur)) return unknown(T_DYN);
      if (cur.v === null) return tuple([]);
      const elems = Array.isArray(cur.v) ? cur.v : [cur];
      const mapped = elems.map((e) => traverse(e, rest, range));
      return cur.ty.k === 'list' || cur.ty.k === 'set' ? list(unifyTypes(mapped.map((m) => m.ty)) ?? T_DYN, mapped) : tuple(mapped);
    }
    if (isUnknown(cur)) return { ...unknown(T_DYN), ...(cur.s ? { s: true } : {}) };
    if (s.t === 'attr') {
      if (cur.v === null) fail(err('Attempt to get attribute from null value', 'This value is null, so it does not have any attributes.', s.range));
      if (!isMapLike(cur)) fail(err('Unsupported attribute', `Can't access attributes on a primitive-typed value (${cur.ty.k}).`, s.range));
      const m = cur.v as Record<string, Val>;
      if (!(s.name in m)) {
        if (cur.ty.k === 'map') fail(err('Missing map element', `This map does not have an element with the key "${s.name}".`, s.range));
        fail(err('Unsupported attribute', `This object does not have an attribute named "${s.name}".`, s.range));
      }
      const next = m[s.name]!;
      cur = cur.s ? { ...next, s: true } : next;
      continue;
    }
    // index
    const keyV = evaluateKey(s.key, range);
    if (cur.v === null) fail(err('Attempt to index null value', 'This value is null, so it does not have any indices.', s.range));
    if (Array.isArray(cur.v)) {
      if (cur.ty.k === 'set') fail(err('Invalid index', 'Elements of a set are identified only by their value and don\'t have any separate index or key to select with, so it\'s only possible to perform operations across all elements of the set.', s.range));
      let idx: number;
      try {
        idx = convert(keyV, T_NUMBER).v as number;
      } catch {
        return fail(err('Invalid index', 'The given key does not identify an element in this collection value: a number is required.', s.range));
      }
      if (idx < 0 || idx >= cur.v.length || !Number.isInteger(idx)) {
        fail(err('Invalid index', idx >= cur.v.length ? `The given key does not identify an element in this collection value: the collection has ${cur.v.length} element${cur.v.length === 1 ? '' : 's'} for index ${numStr(idx)}.` : 'The given key does not identify an element in this collection value.', s.range));
      }
      const next = cur.v[idx]!;
      cur = cur.s ? { ...next, s: true } : next;
      continue;
    }
    if (isMapLike(cur)) {
      const k = convert(keyV, T_STRING).v as string;
      const m = cur.v as Record<string, Val>;
      if (!(k in m)) fail(err('Invalid index', `The given key does not identify an element in this collection value.`, s.range));
      const next = m[k]!;
      cur = cur.s ? { ...next, s: true } : next;
      continue;
    }
    fail(err('Invalid index', 'This value does not have any indices.', s.range));
  }
  return cur;
}

// Index keys inside a traversal are evaluated without references (literal keys are the norm);
// the evaluator replaces them before traversing (see evalExpr 'get').
let keyScope: Scope | null = null;
function evaluateKey(e: Expr, _range: Range): Val {
  if (!keyScope) {
    if (e.k === 'lit') return litVal(e.v);
    throw new Error('index key needs a scope');
  }
  return evalExpr(e, keyScope);
}

function litVal(v: null | string | number | boolean): Val {
  if (v === null) return { ty: T_DYN, v: null };
  if (typeof v === 'string') return str(v);
  if (typeof v === 'number') return num(v);
  return bool(v);
}

export function evalExpr(e: Expr, scope: Scope): Val {
  switch (e.k) {
    case 'lit':
      return litVal(e.v);
    case 'paren':
      return evalExpr(e.e, scope);
    case 'tmpl': {
      const parts = e.parts.map((p) => (typeof p === 'string' ? str(p) : evalExpr(p, scope)));
      if (!e.heredoc && e.parts.length === 1 && typeof e.parts[0] !== 'string') return parts[0]!;
      let out = '';
      let unk = false;
      let sens = false;
      e.parts.forEach((p, i) => {
        const v = parts[i]!;
        if (v.s) sens = true;
        if (isUnknown(v)) {
          unk = true;
          return;
        }
        if (typeof p !== 'string') {
          if (v.v === null) fail(err('Invalid template interpolation value', 'The expression result is null. Cannot include a null value in a string template.', p.range));
          try {
            out += convert(v, T_STRING).v as string;
          } catch {
            fail(err('Invalid template interpolation value', `Cannot include the given value in a string template: string required.`, p.range));
          }
        } else out += v.v as string;
      });
      const r: Val = unk ? unknown(T_STRING) : str(out);
      return sens ? { ...r, s: true } : r;
    }
    case 'tuple':
      return tuple(e.items.map((i) => evalExpr(i, scope)));
    case 'object': {
      const out: Record<string, Val> = {};
      for (const it of e.items) {
        const k = it.ident && it.key.k === 'lit' ? str(String(it.key.v)) : evalExpr(it.key, scope);
        if (isUnknown(k)) return unknown(T_DYN);
        let ks: string;
        try {
          ks = convert(k, T_STRING).v as string;
        } catch {
          return fail(err('Incorrect key type', 'Key expression must be a string.', it.key.range));
        }
        out[ks] = evalExpr(it.value, scope);
      }
      return object(out);
    }
    case 'var': {
      if (scope.locals && e.name in scope.locals) return scope.locals[e.name]!;
      const r = scope.ref(e.name, [], e.range);
      return r.val;
    }
    case 'get': {
      const prev = keyScope;
      keyScope = scope;
      try {
        if (e.obj.k === 'var') {
          if (scope.locals && e.obj.name in scope.locals) return traverse(scope.locals[e.obj.name]!, e.steps, e.range);
          const r = scope.ref(e.obj.name, e.steps, e.range);
          return traverse(r.val, e.steps.slice(r.used), e.range);
        }
        return traverse(evalExpr(e.obj, scope), e.steps, e.range);
      } finally {
        keyScope = prev;
      }
    }
    case 'unary': {
      const v = evalExpr(e.e, scope);
      if (isUnknown(v)) return unknown(e.op === '!' ? T_BOOL : T_NUMBER);
      if (e.op === '!') return { ...bool(!(asBool(v, e.e.range))), ...(v.s ? { s: true } : {}) };
      return { ...num(-asNum(v, e.e.range)), ...(v.s ? { s: true } : {}) };
    }
    case 'binary':
      return binary(e.op, e.l, e.r, scope, e.range);
    case 'cond': {
      const c = evalExpr(e.c, scope);
      if (isUnknown(c)) {
        const t = evalExpr(e.t, scope);
        const f = evalExpr(e.f, scope);
        return unknown(unifyTypes([t.ty, f.ty]) ?? T_DYN);
      }
      if (c.v === null) fail(err('Null condition', 'The condition value is null. Conditions must either be true or false.', e.c.range));
      const pick = asBool(c, e.c.range) ? evalExpr(e.t, scope) : evalExpr(e.f, scope);
      return c.s ? { ...pick, s: true } : pick;
    }
    case 'for':
      return forExpr(e, scope);
    case 'call':
      return call(e, scope);
  }
}

function asBool(v: Val, range: Range): boolean {
  try {
    return convert(v, T_BOOL).v as boolean;
  } catch {
    return fail(err('Incorrect condition type', 'The condition expression must be of type bool.', range));
  }
}

function asNum(v: Val, range: Range): number {
  if (v.v === null) fail(err('Invalid operand', 'Unsuitable value for unary operand: a number is required.', range));
  try {
    return convert(v, T_NUMBER).v as number;
  } catch {
    return fail(err('Invalid operand', 'Unsuitable value for unary operand: a number is required.', range));
  }
}

function binary(op: string, le: Expr, re: Expr, scope: Scope, range: Range): Val {
  const l = evalExpr(le, scope);
  if (op === '&&' && !isUnknown(l) && l.v === false) return bool(false);
  if (op === '||' && !isUnknown(l) && l.v === true) return bool(true);
  const r = evalExpr(re, scope);
  const sens = Boolean(l.s || r.s);
  const res = (v: Val): Val => (sens ? { ...v, s: true } : v);
  const arith = ['+', '-', '*', '/', '%'].includes(op);
  const cmp = ['<', '>', '<=', '>='].includes(op);
  if (isUnknown(l) || isUnknown(r)) return res(unknown(arith ? T_NUMBER : T_BOOL));
  if (op === '==' || op === '!=') {
    const same = l.v === null || r.v === null ? l.v === r.v : keyOf(l) === keyOf(r) && sameKind(l, r);
    return res(bool(op === '==' ? same : !same));
  }
  if (op === '&&' || op === '||') {
    const a = boolOperand(l, le.range, op);
    const b = boolOperand(r, re.range, op);
    return res(bool(op === '&&' ? a && b : a || b));
  }
  const a = numOperand(l, le.range, op);
  const b = numOperand(r, re.range, op);
  if (cmp) return res(bool(op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b));
  switch (op) {
    case '+':
      return res(num(a + b));
    case '-':
      return res(num(a - b));
    case '*':
      return res(num(a * b));
    case '/':
      if (b === 0) fail(err('Operation failed', 'Error during operation: can\'t divide by zero.', range));
      return res(num(a / b));
    default:
      return res(num(a % b));
  }
}

function sameKind(a: Val, b: Val): boolean {
  const ka = typeof a.v === 'object' ? (Array.isArray(a.v) ? 'seq' : 'map') : typeof a.v;
  const kb = typeof b.v === 'object' ? (Array.isArray(b.v) ? 'seq' : 'map') : typeof b.v;
  return ka === kb;
}

function numOperand(v: Val, range: Range, op: string): number {
  try {
    if (v.v === null) throw new ConvertError('null');
    return convert(v, T_NUMBER).v as number;
  } catch {
    return fail(err('Invalid operand', `Unsuitable value for ${['<', '>', '<=', '>='].includes(op) ? 'left' : 'left'} operand: a number is required.`, range));
  }
}

function boolOperand(v: Val, range: Range, _op: string): boolean {
  try {
    if (v.v === null) throw new ConvertError('null');
    return convert(v, T_BOOL).v as boolean;
  } catch {
    return fail(err('Invalid operand', 'Unsuitable value for left operand: a bool is required.', range));
  }
}

function forExpr(e: Extract<Expr, { k: 'for' }>, scope: Scope): Val {
  const coll = evalExpr(e.coll, scope);
  if (isUnknown(coll)) return unknown(T_DYN);
  if (coll.v === null) fail(err('Iteration over null value', 'A null value cannot be used as the collection in a \'for\' expression.', e.coll.range));
  let pairs: [Val, Val][];
  if (Array.isArray(coll.v)) pairs = coll.v.map((v, i) => [coll.ty.k === 'set' ? v : num(i), v]);
  else if (isMapLike(coll)) pairs = Object.keys(coll.v).sort().map((k) => [str(k), (coll.v as Record<string, Val>)[k]!]);
  else return fail(err('Iteration over non-iterable value', `A value of type ${coll.ty.k} cannot be used as the collection in a 'for' expression.`, e.coll.range));
  const sens = Boolean(coll.s);
  const items: Val[] = [];
  const obj: Record<string, Val> = {};
  const groups: Record<string, Val[]> = {};
  for (const [k, v] of pairs) {
    const locals: Record<string, Val> = { [e.val]: sens ? { ...v, s: true } : v };
    if (e.key) locals[e.key] = k;
    const sc = child(scope, locals);
    if (e.cond) {
      const c = evalExpr(e.cond, sc);
      if (isUnknown(c)) return unknown(T_DYN);
      if (!asBool(c, e.cond.range)) continue;
    }
    if (e.obj) {
      const kv = evalExpr(e.keyExpr!, sc);
      if (isUnknown(kv)) return unknown(T_DYN);
      const ks = convert(kv, T_STRING).v as string;
      const vv = evalExpr(e.valExpr, sc);
      if (e.group) (groups[ks] ??= []).push(vv);
      else {
        if (ks in obj) {
          fail(err('Duplicate object key', `Two different items produced the key "${ks}" in this 'for' expression. If duplicates are expected, use the ellipsis (...) after the value expression to enable grouping by key.`, e.keyExpr!.range));
        }
        obj[ks] = vv;
      }
    } else items.push(evalExpr(e.valExpr, sc));
  }
  const out = e.obj ? (e.group ? object(Object.fromEntries(Object.entries(groups).map(([k, vs]) => [k, tuple(vs)]))) : object(obj)) : tuple(items);
  return sens ? { ...out, s: true } : out;
}

function call(e: Extract<Expr, { k: 'call' }>, scope: Scope): Val {
  if (e.name === 'can' || e.name === 'try') {
    if (e.name === 'can' && e.args.length !== 1) fail(err('Invalid number of arguments', 'Function "can" expects exactly one argument.', e.range));
    for (const a of e.args) {
      try {
        const v = evalExpr(a, scope);
        if (e.name === 'can') return bool(true);
        return v;
      } catch (x) {
        if (!(x instanceof DiagError)) throw x;
      }
    }
    if (e.name === 'can') return bool(false);
    return fail(err('Error in function call', 'Call to function "try" failed: no expression succeeded.', e.range));
  }
  if (!hasFunction(e.name)) {
    const s = suggest(e.name, FUNCTION_NAMES);
    fail(err('Call to unknown function', `There is no function named "${e.name}".${s ? ` Did you mean "${s}"?` : ''}`, e.nameRange));
  }
  let args = e.args.map((a) => evalExpr(a, scope));
  if (e.expand && args.length) {
    const last = args[args.length - 1]!;
    if (Array.isArray(last.v)) args = [...args.slice(0, -1), ...last.v];
  }
  const ar = functionArity(e.name)!;
  if (args.length < ar.min) {
    fail(err('Not enough function arguments', `Function "${e.name}" expects ${ar.min}${ar.variadic ? ' or more' : ''} argument(s). Missing value for "${ar.params[args.length]}".`, e.range));
  }
  if (!ar.variadic && args.length > ar.min && !['lookup'].includes(e.name)) {
    fail(err('Too many function arguments', `Function "${e.name}" expects only ${ar.min} argument(s).`, e.args[ar.min]!.range));
  }
  try {
    return callFunction(e.name, args, scope.fn);
  } catch (x) {
    if (x instanceof FuncError) {
      const argE = x.arg >= 0 ? e.args[x.arg] : undefined;
      return fail(err(x.arg >= 0 ? 'Invalid function argument' : 'Error in function call', x.arg >= 0 ? x.message : `Call to function "${e.name}" failed: ${x.message.replace(/^Invalid function argument: /, '')}`, argE?.range ?? e.range));
    }
    if (x instanceof ConvertError) return fail(err('Invalid function argument', x.message, e.range));
    throw x;
  }
}

/** True when the expression mentions anything sensitive (for output checks). */
export function anySensitive(v: Val): boolean {
  return hasSensitive(v);
}
