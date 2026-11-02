// Built-in functions (the subset lessons use), with OpenTofu's argument rules and messages.
// `can` and `try` are handled in eval.ts (they need lazy arguments).
import { convert, ConvertError, unifyTypes } from './convert';
import { base64, md5, sha1, sha256, sha512, toHex, utf8 } from './hashes';
import {
  T_BOOL,
  T_DYN,
  T_NUMBER,
  T_STRING,
  isUnknown,
  bool,
  hasUnknown,
  isMapLike,
  keyOf,
  list,
  map,
  num,
  numStr,
  object,
  set,
  sortSet,
  str,
  toJson,
  tuple,
  unknown,
  type Val,
} from './values';

/** A function failed; `arg` is the argument index the message is about (or -1). */
export class FuncError extends Error {
  constructor(
    message: string,
    public arg = -1,
    public param = '',
  ) {
    super(message);
  }
}

export interface FuncCtx {
  readFile?: (path: string) => string | null;
}

type Fn = { params: string[]; variadic?: string; impl: (args: Val[], ctx: FuncCtx) => Val };

const isStr = (v: Val) => typeof v.v === 'string';
const S = (v: Val, i: number, p: string): string => {
  try {
    return convert(v, T_STRING).v as string;
  } catch {
    throw new FuncError(`Invalid value for "${p}" parameter: string required.`, i, p);
  }
};
const N = (v: Val, i: number, p: string): number => {
  try {
    return convert(v, T_NUMBER).v as number;
  } catch {
    throw new FuncError(`Invalid value for "${p}" parameter: a number is required.`, i, p);
  }
};
const items = (v: Val, i: number, p: string): Val[] => {
  if (Array.isArray(v.v)) return v.v;
  throw new FuncError(`Invalid value for "${p}" parameter: list of ${p === 'lists' ? 'any single type' : 'string'} required.`, i, p);
};
const entries = (v: Val, i: number, p: string): [string, Val][] => {
  if (isMapLike(v)) return Object.entries(v.v as Record<string, Val>);
  throw new FuncError(`Invalid value for "${p}" parameter: map of any single type required.`, i, p);
};

function listOf(vals: Val[]): Val {
  const e = unifyTypes(vals.map((x) => x.ty)) ?? T_DYN;
  return list(e, vals.map((x) => (e.k === 'dynamic' ? x : convert(x, e))));
}

/** Go fmt-like formatting for format(): %s %d %f %.Nf %v %q %t %%. */
export function goFormat(spec: string, args: Val[]): string {
  let ai = 0;
  return spec.replace(/%([-+ 0#]*)(\d+)?(?:\.(\d+))?([sdfvqtbxXeEgG%])/g, (_m, flags: string, width: string | undefined, prec: string | undefined, verb: string) => {
    if (verb === '%') return '%';
    const a = args[ai++];
    if (!a) throw new FuncError(`Error in function call: not enough arguments for "%${verb}" at ${ai - 1}: need index ${ai} but have ${args.length} total.`, 0, 'format');
    let out: string;
    switch (verb) {
      case 'd':
        out = numStr(Math.trunc(N(a, ai, 'args')));
        break;
      case 'f':
        out = N(a, ai, 'args').toFixed(prec !== undefined ? Number(prec) : 6);
        break;
      case 'q':
        out = JSON.stringify(S(a, ai, 'args'));
        break;
      case 't':
        out = String(convert(a, T_BOOL).v);
        break;
      case 'x':
        out = Math.trunc(N(a, ai, 'args')).toString(16);
        break;
      case 'X':
        out = Math.trunc(N(a, ai, 'args')).toString(16).toUpperCase();
        break;
      case 'v':
        out = typeof a.v === 'string' || typeof a.v === 'number' || typeof a.v === 'boolean' ? S(a, ai, 'args') : JSON.stringify(toJson(a));
        break;
      default:
        out = S(a, ai, 'args');
    }
    if (width) {
      const w = Number(width);
      if (out.length < w) out = flags.includes('-') ? out.padEnd(w) : out.padStart(w, flags.includes('0') && verb !== 's' ? '0' : ' ');
    }
    return out;
  });
}

const FUNCS: Record<string, Fn> = {
  upper: { params: ['str'], impl: ([s]) => str(S(s!, 0, 'str').toUpperCase()) },
  lower: { params: ['str'], impl: ([s]) => str(S(s!, 0, 'str').toLowerCase()) },
  title: { params: ['str'], impl: ([s]) => str(S(s!, 0, 'str').replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase())) },
  trimspace: { params: ['str'], impl: ([s]) => str(S(s!, 0, 'str').trim()) },
  chomp: { params: ['str'], impl: ([s]) => str(S(s!, 0, 'str').replace(/(\r?\n)+$/, '')) },
  strrev: { params: ['str'], impl: ([s]) => str([...S(s!, 0, 'str')].reverse().join('')) },
  trim: { params: ['str', 'cutset'], impl: ([s, c]) => {
    const cut = [...S(c!, 1, 'cutset')];
    let x = S(s!, 0, 'str');
    while (x && cut.includes(x[0]!)) x = x.slice(1);
    while (x && cut.includes(x[x.length - 1]!)) x = x.slice(0, -1);
    return str(x);
  } },
  trimprefix: { params: ['str', 'prefix'], impl: ([s, p]) => { const x = S(s!, 0, 'str'); const pr = S(p!, 1, 'prefix'); return str(x.startsWith(pr) ? x.slice(pr.length) : x); } },
  trimsuffix: { params: ['str', 'suffix'], impl: ([s, p]) => { const x = S(s!, 0, 'str'); const pr = S(p!, 1, 'suffix'); return str(pr && x.endsWith(pr) ? x.slice(0, -pr.length) : x); } },
  startswith: { params: ['str', 'prefix'], impl: ([s, p]) => bool(S(s!, 0, 'str').startsWith(S(p!, 1, 'prefix'))) },
  endswith: { params: ['str', 'suffix'], impl: ([s, p]) => bool(S(s!, 0, 'str').endsWith(S(p!, 1, 'suffix'))) },
  replace: { params: ['str', 'substr', 'replace'], impl: ([s, a, b]) => {
    const sub = S(a!, 1, 'substr');
    const rep = S(b!, 2, 'replace');
    const x = S(s!, 0, 'str');
    if (sub.length > 1 && sub.startsWith('/') && sub.endsWith('/')) return str(x.replace(new RegExp(sub.slice(1, -1), 'g'), rep.replace(/\$(\d)/g, '$$$1')));
    return str(x.split(sub).join(rep));
  } },
  substr: { params: ['str', 'offset', 'length'], impl: ([s, o, l]) => {
    const chars = [...S(s!, 0, 'str')];
    let off = N(o!, 1, 'offset');
    let len = N(l!, 2, 'length');
    if (off < 0) off = chars.length + off;
    if (len < 0) len = chars.length - off;
    return str(chars.slice(off, off + len).join(''));
  } },
  split: { params: ['separator', 'str'], impl: ([sep, s]) => list(T_STRING, S(s!, 1, 'str').split(S(sep!, 0, 'separator')).map(str)) },
  join: { params: ['separator'], variadic: 'lists', impl: ([sep, ...ls]) => {
    if (!ls.length) throw new FuncError('Not enough function arguments: at least one list is required.', -1);
    const parts: string[] = [];
    ls.forEach((l, i) => {
      for (const x of items(l, i + 1, 'lists')) {
        if (x.v === null) throw new FuncError(`Invalid value for "lists" parameter: element ${parts.length} is null; cannot concatenate null values.`, i + 1, 'lists');
        parts.push(S(x, i + 1, 'lists'));
      }
    });
    return str(parts.join(S(sep!, 0, 'separator')));
  } },
  format: { params: ['format'], variadic: 'args', impl: ([f, ...args]) => str(goFormat(S(f!, 0, 'format'), args)) },
  formatlist: { params: ['format'], variadic: 'args', impl: ([f, ...args]) => {
    const n = Math.max(0, ...args.map((a) => (Array.isArray(a.v) ? a.v.length : 0)));
    const out: Val[] = [];
    for (let i = 0; i < n; i++) out.push(str(goFormat(S(f!, 0, 'format'), args.map((a) => (Array.isArray(a.v) ? a.v[i]! : a)))));
    return list(T_STRING, out);
  } },
  length: { params: ['value'], impl: ([v]) => {
    if (typeof v!.v === 'string') return num([...v!.v].length);
    if (Array.isArray(v!.v)) return num(v!.v.length);
    if (isMapLike(v!)) return num(Object.keys(v!.v).length);
    throw new FuncError('Invalid value for "value" parameter: argument must be a string, a collection type, or a structural type.', 0, 'value');
  } },
  toset: { params: ['v'], impl: ([v]) => {
    const xs = items(v!, 0, 'v');
    const e = unifyTypes(xs.map((x) => x.ty));
    if (!e) throw new FuncError('Invalid value for "v" parameter: cannot convert tuple to set of any single type.', 0, 'v');
    return set(e, xs.map((x) => convert(x, e)));
  } },
  tolist: { params: ['v'], impl: ([v]) => listOf(items(v!, 0, 'v')) },
  tomap: { params: ['v'], impl: ([v]) => {
    const es = entries(v!, 0, 'v');
    const e = unifyTypes(es.map(([, x]) => x.ty));
    if (!e) throw new FuncError('Invalid value for "v" parameter: cannot convert object to map of any single type.', 0, 'v');
    return map(e, Object.fromEntries(es.map(([k, x]) => [k, convert(x, e)])));
  } },
  tostring: { params: ['v'], impl: ([v]) => str(S(v!, 0, 'v')) },
  tonumber: { params: ['v'], impl: ([v]) => num(N(v!, 0, 'v')) },
  tobool: { params: ['v'], impl: ([v]) => convert(v!, T_BOOL) },
  lookup: { params: ['inputMap', 'key'], variadic: 'default', impl: ([m, k, d]) => {
    const key = S(k!, 1, 'key');
    const es = entries(m!, 0, 'inputMap');
    const hit = es.find(([kk]) => kk === key);
    if (hit) return hit[1];
    if (d) return d;
    throw new FuncError(`Invalid value for "key" parameter: the given key "${key}" does not exist in the map.`, 1, 'key');
  } },
  merge: { params: [], variadic: 'maps', impl: (ms) => {
    const out: Record<string, Val> = {};
    let allMaps = true;
    ms.forEach((m, i) => {
      if (m.v === null) return;
      if (m.ty.k !== 'map') allMaps = false;
      for (const [k, x] of entries(m, i, 'maps')) out[k] = x;
    });
    if (allMaps && ms.length) {
      const e = unifyTypes(Object.values(out).map((x) => x.ty)) ?? T_DYN;
      return map(e, Object.fromEntries(Object.entries(out).map(([k, x]) => [k, convert(x, e)])));
    }
    return object(out);
  } },
  concat: { params: [], variadic: 'seqs', impl: (ls) => {
    const all: Val[] = [];
    let anyTuple = false;
    ls.forEach((l, i) => {
      if (l.ty.k === 'tuple') anyTuple = true;
      all.push(...items(l, i, 'seqs'));
    });
    return anyTuple ? tuple(all) : listOf(all);
  } },
  coalesce: { params: [], variadic: 'vals', impl: (vs) => {
    for (const v of vs) {
      if (v.v === null) continue;
      if (typeof v.v === 'string' && v.v === '') continue;
      return v;
    }
    throw new FuncError('Invalid function argument: no non-null, non-empty-string arguments.', -1);
  } },
  coalescelist: { params: [], variadic: 'vals', impl: (vs) => vs.find((v) => Array.isArray(v.v) && v.v.length > 0) ?? tuple([]) },
  keys: { params: ['inputMap'], impl: ([m]) => {
    const ks = entries(m!, 0, 'inputMap').map(([k]) => k).sort();
    return m!.ty.k === 'object' ? tuple(ks.map(str)) : list(T_STRING, ks.map(str));
  } },
  values: { params: ['mapping'], impl: ([m]) => {
    const es = entries(m!, 0, 'mapping').sort(([a], [b]) => (a < b ? -1 : 1));
    return m!.ty.k === 'object' ? tuple(es.map(([, x]) => x)) : listOf(es.map(([, x]) => x));
  } },
  contains: { params: ['list', 'value'], impl: ([l, v]) => bool(items(l!, 0, 'list').some((x) => keyOf(x) === keyOf(v!) || (isStr(x) && String(x.v) === String(v!.v)))) },
  element: { params: ['list', 'index'], impl: ([l, i]) => {
    const xs = items(l!, 0, 'list');
    if (!xs.length) throw new FuncError('Invalid value for "list" parameter: cannot use element function with an empty list.', 0, 'list');
    const n = N(i!, 1, 'index');
    return xs[((n % xs.length) + xs.length) % xs.length]!;
  } },
  index: { params: ['list', 'value'], impl: ([l, v]) => {
    const at = items(l!, 0, 'list').findIndex((x) => keyOf(x) === keyOf(v!));
    if (at < 0) throw new FuncError('Invalid value for "value" parameter: item not found.', 1, 'value');
    return num(at);
  } },
  distinct: { params: ['list'], impl: ([l]) => {
    const seen = new Set<string>();
    return listOf(items(l!, 0, 'list').filter((x) => (seen.has(keyOf(x)) ? false : (seen.add(keyOf(x)), true))));
  } },
  flatten: { params: ['list'], impl: ([l]) => {
    const out: Val[] = [];
    const walk = (x: Val) => (Array.isArray(x.v) ? x.v.forEach(walk) : out.push(x));
    items(l!, 0, 'list').forEach(walk);
    return tuple(out);
  } },
  sort: { params: ['list'], impl: ([l]) => list(T_STRING, items(l!, 0, 'list').map((x) => S(x, 0, 'list')).sort().map(str)) },
  reverse: { params: ['list'], impl: ([l]) => {
    const xs = [...items(l!, 0, 'list')].reverse();
    return l!.ty.k === 'tuple' ? tuple(xs) : listOf(xs);
  } },
  slice: { params: ['list', 'start_index', 'end_index'], impl: ([l, a, b]) => {
    const xs = items(l!, 0, 'list').slice(N(a!, 1, 'start_index'), N(b!, 2, 'end_index'));
    return l!.ty.k === 'tuple' ? tuple(xs) : listOf(xs);
  } },
  one: { params: ['list'], impl: ([l]) => {
    const xs = items(l!, 0, 'list');
    if (xs.length > 1) throw new FuncError('Invalid function argument: must be a list, set, or tuple value with either zero or one elements.', 0, 'list');
    return xs[0] ?? { ty: T_DYN, v: null };
  } },
  range: { params: [], variadic: 'params', impl: (ps) => {
    const ns = ps.map((p, i) => N(p, i, 'params'));
    const [start, end, step] = ns.length === 1 ? [0, ns[0]!, 1] : [ns[0]!, ns[1]!, ns[2] ?? (ns[1]! >= ns[0]! ? 1 : -1)];
    const out: Val[] = [];
    if (step === 0) throw new FuncError('Invalid function argument: step must not be zero.', -1);
    for (let x = start; step > 0 ? x < end : x > end; x += step) out.push(num(x));
    return list(T_NUMBER, out);
  } },
  zipmap: { params: ['keys', 'values'], impl: ([k, v]) => {
    const ks = items(k!, 0, 'keys').map((x) => S(x, 0, 'keys'));
    const vs = items(v!, 1, 'values');
    if (ks.length !== vs.length) throw new FuncError(`Invalid value for "values" parameter: number of keys (${ks.length}) does not match number of values (${vs.length}).`, 1, 'values');
    return object(Object.fromEntries(ks.map((kk, i) => [kk, vs[i]!])));
  } },
  min: { params: [], variadic: 'numbers', impl: (ns) => num(Math.min(...ns.map((n, i) => N(n, i, 'numbers')))) },
  max: { params: [], variadic: 'numbers', impl: (ns) => num(Math.max(...ns.map((n, i) => N(n, i, 'numbers')))) },
  sum: { params: ['list'], impl: ([l]) => num(items(l!, 0, 'list').reduce((a, x) => a + N(x, 0, 'list'), 0)) },
  abs: { params: ['num'], impl: ([n]) => num(Math.abs(N(n!, 0, 'num'))) },
  ceil: { params: ['num'], impl: ([n]) => num(Math.ceil(N(n!, 0, 'num'))) },
  floor: { params: ['num'], impl: ([n]) => num(Math.floor(N(n!, 0, 'num'))) },
  alltrue: { params: ['list'], impl: ([l]) => bool(items(l!, 0, 'list').every((x) => convert(x, T_BOOL).v === true)) },
  anytrue: { params: ['list'], impl: ([l]) => bool(items(l!, 0, 'list').some((x) => convert(x, T_BOOL).v === true)) },
  jsonencode: { params: ['val'], impl: ([v]) => str(JSON.stringify(toJson(v!))) },
  jsondecode: { params: ['str'], impl: ([s]) => {
    try {
      return fromAny(JSON.parse(S(s!, 0, 'str')));
    } catch {
      throw new FuncError('Invalid value for "str" parameter: invalid JSON.', 0, 'str');
    }
  } },
  base64encode: { params: ['str'], impl: ([s]) => str(base64(utf8(S(s!, 0, 'str')))) },
  base64decode: { params: ['str'], impl: ([s]) => str(new TextDecoder().decode(Uint8Array.from(atobSafe(S(s!, 0, 'str')), (c) => c.charCodeAt(0)))) },
  md5: { params: ['str'], impl: ([s]) => str(toHex(md5(utf8(S(s!, 0, 'str'))))) },
  sha1: { params: ['str'], impl: ([s]) => str(toHex(sha1(utf8(S(s!, 0, 'str'))))) },
  sha256: { params: ['str'], impl: ([s]) => str(toHex(sha256(utf8(S(s!, 0, 'str'))))) },
  sha512: { params: ['str'], impl: ([s]) => str(toHex(sha512(utf8(S(s!, 0, 'str'))))) },
  basename: { params: ['path'], impl: ([p]) => str(S(p!, 0, 'path').replace(/\/+$/, '').split('/').pop() ?? '') },
  dirname: { params: ['path'], impl: ([p]) => {
    const parts = S(p!, 0, 'path').split('/');
    parts.pop();
    return str(parts.join('/') || '.');
  } },
  file: { params: ['path'], impl: ([p], ctx) => {
    const path = S(p!, 0, 'path');
    const text = ctx.readFile?.(path) ?? null;
    if (text === null) throw new FuncError(`Invalid value for "path" parameter: no file exists at "${path}"; this function works only with files that are distributed as part of the configuration source code, so if this file will be created by a resource in this configuration you must instead obtain this result from an attribute of that resource.`, 0, 'path');
    return str(text);
  } },
  fileexists: { params: ['path'], impl: ([p], ctx) => bool((ctx.readFile?.(S(p!, 0, 'path')) ?? null) !== null) },
};

function atobSafe(s: string): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let bits = 0;
  let acc = 0;
  let out = '';
  for (const ch of s.replace(/=+$/, '')) {
    const v = A.indexOf(ch);
    if (v < 0) throw new FuncError('Invalid value for "str" parameter: failed to decode base64 data.', 0, 'str');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((acc >> bits) & 0xff);
    }
  }
  return out;
}

function fromAny(j: unknown): Val {
  if (j === null) return { ty: T_DYN, v: null };
  if (typeof j === 'string') return str(j);
  if (typeof j === 'number') return num(j);
  if (typeof j === 'boolean') return bool(j);
  if (Array.isArray(j)) return tuple(j.map(fromAny));
  return object(Object.fromEntries(Object.entries(j as Record<string, unknown>).map(([k, v]) => [k, fromAny(v)])));
}

export const FUNCTION_NAMES = Object.keys(FUNCS).concat(['can', 'try']).sort();

export function hasFunction(name: string): boolean {
  return name in FUNCS || name === 'can' || name === 'try';
}

/** Expected argument count text, for "Not enough function arguments" errors. */
export function functionArity(name: string): { min: number; variadic: boolean; params: string[] } | null {
  const f = FUNCS[name];
  if (!f) return null;
  return { min: f.params.length, variadic: Boolean(f.variadic), params: f.params };
}

/** Call a function. Unknown arguments give an unknown result; sensitive marks carry over. */
export function callFunction(name: string, args: Val[], ctx: FuncCtx = {}): Val {
  const f = FUNCS[name]!;
  const sens = args.some((a) => a.s);
  if (args.some((a) => isUnknown(a) || (name !== 'length' && hasUnknown(a)))) {
    const ty = name === 'length' ? T_NUMBER : ['upper', 'lower', 'format', 'join', 'replace', 'title', 'trimspace', 'substr', 'tostring', 'jsonencode', 'md5', 'sha1', 'sha256', 'base64encode', 'basename', 'file'].includes(name) ? T_STRING : T_DYN;
    return { ...unknown(ty), ...(sens ? { s: true } : {}) };
  }
  try {
    const r = f.impl(args, ctx);
    return sens ? { ...r, s: true } : r;
  } catch (e) {
    if (e instanceof ConvertError) throw new FuncError(`Invalid value for "${f.params[0] ?? 'value'}" parameter: ${e.message}.`, 0, f.params[0] ?? '');
    throw e;
  }
}

export { sortSet };
