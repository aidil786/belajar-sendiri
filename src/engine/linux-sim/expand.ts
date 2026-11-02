// Word expansion like bash: braces, tilde, parameters ($x, ${x:-y}, $?, $1 …), command
// substitution $( … ), arithmetic $(( … )), field splitting, globbing and quote removal.
import { childNames, joinPath, lookup, userByName } from './fs';
import type { LinuxState } from './types';

export interface ExpandEnv {
  st: LinuxState;
  user: string;
  cwd: string;
  get(name: string): string | undefined;
  set(name: string, value: string): void;
  positional: string[];
  arg0: string;
  lastExit: number;
  pid: number;
  lastBg?: number;
  /** Run a command line and return what it printed on stdout. */
  subst(src: string): string;
  /** `set -u`: an unset variable is an error. */
  nounset?: boolean;
  onError(msg: string): void;
}

export class ExpandError extends Error {}

// ---------------------------------------------------------------------------
// Brace expansion: a{b,c}d → abd acd, {1..3} → 1 2 3 (unquoted braces only).

export function braceExpand(word: string): string[] {
  let depth = 0;
  let quote: string | null = null;
  let open = -1;
  for (let i = 0; i < word.length; i++) {
    const c = word[i]!;
    if (c === '\\') {
      i++;
      continue;
    }
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === '$' && word[i + 1] === '{') {
      const e = word.indexOf('}', i);
      if (e > 0) i = e;
      continue;
    }
    if (c === '{') {
      if (depth === 0) open = i;
      depth++;
    } else if (c === '}' && depth > 0) {
      depth--;
      if (depth === 0) {
        const inner = word.slice(open + 1, i);
        const pre = word.slice(0, open);
        const post = word.slice(i + 1);
        const range = /^(-?\d+)\.\.(-?\d+)$/.exec(inner) ?? /^([a-zA-Z])\.\.([a-zA-Z])$/.exec(inner);
        let parts: string[] | null = null;
        if (range) {
          const num = /\d/.test(range[1]!);
          const a = num ? Number(range[1]) : range[1]!.charCodeAt(0);
          const b = num ? Number(range[2]) : range[2]!.charCodeAt(0);
          parts = [];
          const step = a <= b ? 1 : -1;
          for (let v = a; step > 0 ? v <= b : v >= b; v += step) parts.push(num ? String(v) : String.fromCharCode(v));
        } else {
          const split = splitTopCommas(inner);
          if (split.length > 1) parts = split;
        }
        if (parts) return parts.flatMap((p) => braceExpand(pre + p + post));
        return braceExpand(pre + '\\{' + inner + '\\}' + post).map((w) => w);
      }
    }
  }
  return [word];
}

function splitTopCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '\\') {
      cur += c + (s[i + 1] ?? '');
      i++;
      continue;
    }
    if (c === '{') depth++;
    if (c === '}') depth--;
    if (c === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

// ---------------------------------------------------------------------------
// Arithmetic $(( … ))

export function arith(expr: string, env: ExpandEnv): number {
  const src = expr.replace(/\$\{?(\w+)\}?/g, (_m, n: string) => env.get(n) ?? (n === '?' ? String(env.lastExit) : '0'));
  const toks = src.match(/\d+|[A-Za-z_]\w*|\*\*|<=|>=|==|!=|&&|\|\||[-+*/%()<>!]/g) ?? [];
  let i = 0;
  const val = (t: string): number => (/^\d+$/.test(t) ? Number(t) : Number(env.get(t) ?? '0') || 0);
  const prim = (): number => {
    const t = toks[i++];
    if (t === '(') {
      const v = or();
      i++;
      return v;
    }
    if (t === '-') return -prim();
    if (t === '+') return prim();
    if (t === '!') return prim() ? 0 : 1;
    if (t === undefined) throw new ExpandError('syntax error: operand expected');
    return val(t);
  };
  const pow = (): number => {
    const a = prim();
    if (toks[i] === '**') {
      i++;
      return a ** pow();
    }
    return a;
  };
  const mul = (): number => {
    let a = pow();
    while (toks[i] === '*' || toks[i] === '/' || toks[i] === '%') {
      const op = toks[i++];
      const b = pow();
      if ((op === '/' || op === '%') && b === 0) throw new ExpandError('division by 0');
      a = op === '*' ? a * b : op === '/' ? Math.trunc(a / b) : a % b;
    }
    return a;
  };
  const add = (): number => {
    let a = mul();
    while (toks[i] === '+' || toks[i] === '-') {
      const op = toks[i++];
      const b = mul();
      a = op === '+' ? a + b : a - b;
    }
    return a;
  };
  const cmp = (): number => {
    let a = add();
    while (['<', '>', '<=', '>=', '==', '!='].includes(toks[i] ?? '')) {
      const op = toks[i++];
      const b = add();
      a = Number(op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : op === '>=' ? a >= b : op === '==' ? a === b : a !== b);
    }
    return a;
  };
  const and = (): number => {
    let a = cmp();
    while (toks[i] === '&&') {
      i++;
      const b = cmp();
      a = Number(!!a && !!b);
    }
    return a;
  };
  function or(): number {
    let a = and();
    while (toks[i] === '||') {
      i++;
      const b = and();
      a = Number(!!a || !!b);
    }
    return a;
  }
  if (!toks.length) return 0;
  return or();
}

// ---------------------------------------------------------------------------
// Glob patterns

/** Turn a glob (with backslash-escaped literals) into a RegExp. */
export function globToRegex(pat: string, anchored = true): RegExp {
  let re = '';
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i]!;
    if (c === '\\') {
      const n = pat[++i] ?? '\\';
      re += n.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    } else if (c === '*') re += '.*';
    else if (c === '?') re += '.';
    else if (c === '[') {
      const e = pat.indexOf(']', i + 2);
      if (e < 0) re += '\\[';
      else {
        let cls = pat.slice(i + 1, e);
        if (cls.startsWith('!') || cls.startsWith('^')) cls = `^${cls.slice(1)}`;
        re += `[${cls.replace(/\\/g, '\\\\')}]`;
        i = e;
      }
    } else re += c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }
  return new RegExp(anchored ? `^${re}$` : re);
}

export function hasGlob(pat: string): boolean {
  for (let i = 0; i < pat.length; i++) {
    if (pat[i] === '\\') {
      i++;
      continue;
    }
    if (pat[i] === '*' || pat[i] === '?' || pat[i] === '[') return true;
  }
  return false;
}

/** Match a glob against the file system. Returns sorted paths, as typed (relative stays relative). */
export function globFs(st: LinuxState, user: string, cwd: string, pat: string): string[] {
  const absolute = pat.startsWith('/');
  const parts = pat.split('/').filter((p, i) => p !== '' || i === 0);
  let bases: { shown: string; real: string }[] = [{ shown: absolute ? '' : '', real: absolute ? '/' : cwd }];
  const segs = absolute ? parts.slice(1) : parts;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    const last = i === segs.length - 1;
    const next: typeof bases = [];
    for (const b of bases) {
      const join = (name: string) => ({ shown: b.shown === '' ? (absolute ? `/${name}` : name) : `${b.shown}/${name}`, real: joinPath(b.real, name) });
      if (!hasGlob(seg)) {
        const name = seg.replace(/\\(.)/g, '$1');
        const j = join(name);
        const f = lookup(st, user, j.real);
        if (f.ok && (last || f.node.type === 'dir')) next.push(j);
        continue;
      }
      const dir = lookup(st, user, b.real);
      if (!dir.ok || dir.node.type !== 'dir') continue;
      // Reading a folder needs r on it.
      const u = userByName(st, user);
      const node = dir.node;
      const canRead = u?.uid === 0 || (node.uid === u?.uid ? node.mode & 0o400 : node.mode & 0o004) !== 0;
      if (!canRead) continue;
      const re = globToRegex(seg);
      for (const name of childNames(st, dir.path)) {
        if (name.startsWith('.') && !seg.startsWith('.') && !seg.startsWith('\\.')) continue;
        if (!re.test(name)) continue;
        const j = join(name);
        if (!last) {
          const f = lookup(st, user, j.real);
          if (!f.ok || f.node.type !== 'dir') continue;
        }
        next.push(j);
      }
    }
    bases = next;
  }
  return bases.map((b) => b.shown).sort();
}

// ---------------------------------------------------------------------------
// Words

interface Field {
  text: string;
  pat: string;
  glob: boolean;
}

const GLOB_CHARS = new Set(['*', '?', '[']);

/** Expand one word into fields. */
export function expandWord(raw: string, env: ExpandEnv, opts: { split?: boolean; glob?: boolean } = {}): string[] {
  const split = opts.split ?? true;
  const glob = opts.glob ?? true;
  const out: string[] = [];
  for (const w of split ? braceExpand(raw) : [raw]) {
    const fields = expandOne(tilde(w, env), env, split);
    for (const f of fields) {
      if (glob && f.glob) {
        const hits = globFs(env.st, env.user, env.cwd, f.pat);
        if (hits.length) {
          out.push(...hits);
          continue;
        }
      }
      out.push(f.text);
    }
  }
  return out;
}

/** Expand to one string (assignments, redirection targets, here-documents, case words). */
export function expandString(raw: string, env: ExpandEnv): string {
  return expandOne(tilde(raw, env), env, false)
    .map((f) => f.text)
    .join(' ');
}

function tilde(w: string, env: ExpandEnv): string {
  const m = /^~([a-z_][\w-]*)?(?=\/|$|:)/.exec(w);
  if (!m) return w.replace(/(^|=|:)~(?=\/|$|:)/g, (_x, pre: string) => pre + (env.get('HOME') ?? '/'));
  const home = m[1] ? userByName(env.st, m[1])?.home : env.get('HOME');
  if (!home) return w;
  return home.replace(/[\\'"$`*?[]/g, '\\$&') + w.slice(m[0].length);
}

function expandOne(w: string, env: ExpandEnv, split: boolean): Field[] {
  const fields: Field[] = [];
  let cur: Field | null = null;
  const lit = (s: string, quoted: boolean) => {
    cur ??= { text: '', pat: '', glob: false };
    for (const c of s) {
      cur.text += c;
      if (quoted && (GLOB_CHARS.has(c) || c === '\\')) cur.pat += `\\${c}`;
      else cur.pat += c;
      if (!quoted && GLOB_CHARS.has(c)) cur.glob = true;
    }
  };
  const start = () => {
    cur ??= { text: '', pat: '', glob: false };
  };
  const unquotedValue = (v: string) => {
    if (!split) {
      lit(v, false);
      return;
    }
    const pieces = v.split(/[ \t\n]+/);
    pieces.forEach((p, idx) => {
      if (idx > 0) {
        if (cur) fields.push(cur);
        cur = null;
      }
      if (p) lit(p, false);
    });
  };

  let i = 0;
  while (i < w.length) {
    const c = w[i]!;
    if (c === '\\') {
      if (i + 1 < w.length) lit(w[i + 1]!, true);
      i += 2;
      continue;
    }
    if (c === "'") {
      const e = w.indexOf("'", i + 1);
      start();
      lit(w.slice(i + 1, e < 0 ? w.length : e), true);
      i = e < 0 ? w.length : e + 1;
      continue;
    }
    if (c === '"') {
      start();
      i++;
      while (i < w.length && w[i] !== '"') {
        const d = w[i]!;
        if (d === '\\' && i + 1 < w.length && '$`"\\\n'.includes(w[i + 1]!)) {
          lit(w[i + 1]!, true);
          i += 2;
          continue;
        }
        if (d === '$' || d === '`') {
          const r = dollar(w, i, env, true);
          if (r.at) {
            // "$@": one field per argument.
            env.positional.forEach((p, idx) => {
              if (idx > 0) {
                if (cur) fields.push(cur);
                cur = { text: '', pat: '', glob: false };
              }
              lit(p, true);
            });
          } else lit(r.value, true);
          i = r.end;
          continue;
        }
        lit(d, true);
        i++;
      }
      i++;
      continue;
    }
    if (c === '$' || c === '`') {
      const r = dollar(w, i, env, false);
      if (r.literal) lit(r.value, false);
      else if (r.at) {
        env.positional.forEach((p, idx) => {
          if (idx > 0) {
            if (cur) fields.push(cur);
            cur = null;
          }
          unquotedValue(p);
        });
      } else unquotedValue(r.value);
      i = r.end;
      continue;
    }
    lit(c, false);
    i++;
  }
  if (cur) fields.push(cur);
  return fields;
}

function dollar(w: string, i: number, env: ExpandEnv, quoted: boolean): { value: string; end: number; literal?: boolean; at?: boolean } {
  if (w[i] === '`') {
    const e = w.indexOf('`', i + 1);
    const inner = w.slice(i + 1, e < 0 ? w.length : e);
    return { value: env.subst(inner).replace(/\n+$/, ''), end: e < 0 ? w.length : e + 1 };
  }
  const n = w[i + 1];
  if (n === '(' && w[i + 2] === '(') {
    // $(( … ))
    let depth = 0;
    let j = i + 1;
    for (; j < w.length; j++) {
      if (w[j] === '(') depth++;
      if (w[j] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    const inner = w.slice(i + 3, j - 1);
    try {
      return { value: String(arith(expandString(inner, env), env)), end: j + 1 };
    } catch (e) {
      // bash 5.2: "7 / 0 : division by 0 (error token is "0 ")"
      const expr = inner.replace(/^\s+/, '');
      const msg = (e as Error).message;
      const token = msg === 'division by 0' ? expr.slice(Math.max(expr.lastIndexOf('/'), expr.lastIndexOf('%')) + 1).replace(/^\s+/, '') : '';
      env.onError(`${expr}: ${msg}${token ? ` (error token is "${token}")` : ''}`);
      throw new ExpandError((e as Error).message);
    }
  }
  if (n === '(') {
    let depth = 0;
    let j = i + 1;
    let q: string | null = null;
    for (; j < w.length; j++) {
      const c = w[j]!;
      if (q) {
        if (c === q) q = null;
        continue;
      }
      if (c === "'" || c === '"') q = c;
      else if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    const inner = w.slice(i + 2, j);
    return { value: env.subst(inner).replace(/\n+$/, ''), end: j + 1 };
  }
  if (n === '{') {
    const e = w.indexOf('}', i);
    const inner = w.slice(i + 2, e < 0 ? w.length : e);
    return { value: braceParam(inner, env), end: e < 0 ? w.length : e + 1 };
  }
  const m = /^([A-Za-z_]\w*|[0-9?#@*$!-])/.exec(w.slice(i + 1));
  if (!m) return { value: '$', end: i + 1, literal: !quoted };
  const name = m[1]!;
  if (name === '@' || name === '*') {
    if (name === '@') return { value: env.positional.join(' '), end: i + 2, at: true };
    return { value: env.positional.join(' '), end: i + 2 };
  }
  return { value: param(name, env), end: i + 1 + name.length };
}

function param(name: string, env: ExpandEnv): string {
  switch (name) {
    case '?':
      return String(env.lastExit);
    case '#':
      return String(env.positional.length);
    case '$':
      return String(env.pid);
    case '!':
      return env.lastBg === undefined ? '' : String(env.lastBg);
    case '0':
      return env.arg0;
    case '-':
      return 'hB';
  }
  if (/^\d$/.test(name)) return env.positional[Number(name) - 1] ?? unset(name, env);
  const v = env.get(name);
  return v === undefined ? unset(name, env) : v;
}

function unset(name: string, env: ExpandEnv): string {
  if (env.nounset) {
    env.onError(`${name}: unbound variable`);
    throw new ExpandError(`${name}: unbound variable`);
  }
  return '';
}

function braceParam(inner: string, env: ExpandEnv): string {
  if (inner.startsWith('#') && inner.length > 1) {
    const n = inner.slice(1);
    const v = /^\d$/.test(n) ? env.positional[Number(n) - 1] : env.get(n);
    return String((v ?? '').length);
  }
  const m = /^([A-Za-z_]\w*|[0-9?#@$!])(?::?([-=+?])([\s\S]*)|(%%|%|##|#)([\s\S]*))?$/.exec(inner);
  if (!m) {
    env.onError(`\${${inner}}: bad substitution`);
    throw new ExpandError('bad substitution');
  }
  const name = m[1]!;
  const get = () => (/^[0-9?#@$!]$/.test(name) ? (name === '?' ? String(env.lastExit) : /\d/.test(name) ? env.positional[Number(name) - 1] : param(name, env)) : env.get(name));
  const colon = inner.slice(name.length, name.length + 1) === ':';
  if (m[2]) {
    const v = get();
    const empty = v === undefined || (colon && v === '');
    const word = expandString(m[3] ?? '', env);
    if (m[2] === '-') return empty ? word : v!;
    if (m[2] === '=') {
      if (empty) {
        env.set(name, word);
        return word;
      }
      return v!;
    }
    if (m[2] === '+') return empty ? '' : word;
    if (m[2] === '?') {
      if (empty) {
        env.onError(`${name}: ${word || 'parameter null or not set'}`);
        throw new ExpandError('unset');
      }
      return v!;
    }
  }
  if (m[4]) {
    const v = get() ?? '';
    const pat = expandString(m[5] ?? '', env);
    const re = globToRegex(pat, false).source;
    if (m[4] === '#' || m[4] === '##') {
      const greedy = m[4] === '##';
      for (let k = greedy ? v.length : 0; greedy ? k >= 0 : k <= v.length; k += greedy ? -1 : 1) if (new RegExp(`^(?:${re})$`).test(v.slice(0, k))) return v.slice(k);
      return v;
    }
    const greedy = m[4] === '%%';
    for (let k = greedy ? 0 : v.length; greedy ? k <= v.length : k >= 0; k += greedy ? 1 : -1) if (new RegExp(`^(?:${re})$`).test(v.slice(k))) return v.slice(0, k);
    return v;
  }
  const v = get();
  return v === undefined ? unset(name, env) : v;
}
