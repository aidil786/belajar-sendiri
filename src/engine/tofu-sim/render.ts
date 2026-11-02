// Rendering like OpenTofu 1.13's human output: plan diffs (+ ~ - -/+ +/- <=), `state show` /
// `show`, and the two output styles (`tofu output` and the Outputs part of `tofu show`).
import { schemaFor } from './providers';
import type { Change, Line, OutputChange, Plan, Seg } from './types';
import { hasUnknown, isMapLike, isUnknown, keyOf, numStr, valEq, type Val } from './values';

export const RULER = '─'.repeat(77);

type Sym = '+' | '-' | '~' | ' ';
const SYM_COLOR: Record<Sym, Seg['c'] | undefined> = { '+': 'green', '-': 'red', '~': 'yellow', ' ': undefined };

interface Opts {
  /** Diff mode (plan) has a symbol column; plain mode (show) does not. */
  diff: boolean;
  /**
   * A value with no schema type (an output, terraform_data's input): OpenTofu diffs it as JSON,
   * so a map is drawn like an object (bare keys, "unchanged attributes").
   */
  json?: boolean;
}

const BARE_KEY = /^[A-Za-z_][\w-]*$/;

/** Column where an attribute's name starts at level L. */
const col = (L: number, o: Opts) => (o.diff ? 4 * L + 4 : 4 * L);
const sp = (n: number) => ' '.repeat(Math.max(0, n));

function lineWith(L: number, sym: Sym, text: string, o: Opts): Line {
  if (!o.diff) return [{ t: sp(col(L, o)) + text }];
  const c = SYM_COLOR[sym];
  return [{ t: sp(col(L, o) - 2) }, c ? { t: sym, c } : { t: sym }, { t: ` ${text}` }];
}

/** A primitive as OpenTofu prints it. */
export function prim(v: Val): string {
  if (isUnknown(v)) return '(known after apply)';
  if (v.v === null) return 'null';
  if (typeof v.v === 'string') return quote(v.v);
  if (typeof v.v === 'number') return numStr(v.v);
  if (typeof v.v === 'boolean') return String(v.v);
  return '?';
}

export function quote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r').replace(/\$\{/g, '$${').replace(/%\{/g, '%%{')}"`;
}

const isMulti = (v: Val | null | undefined) => Boolean(v && typeof v.v === 'string' && v.v.includes('\n') && !v.s);
const isColl = (v: Val | null | undefined) => Boolean(v && !v.s && !isUnknown(v) && v.v !== null && typeof v.v === 'object');
const isNullish = (v: Val | null | undefined) => !v || v.v === null;

interface Rendered {
  first: string;
  rest: Line[];
}

/** Go's strings.TrimSpace (the characters unicode.IsSpace accepts). */
const GO_SPACE = '\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const GO_TRIM = new RegExp(`^[${GO_SPACE}]+|[${GO_SPACE}]+$`, 'g');

/** The lines of a multi-line string in a diff: OpenTofu trims the string first (strings.TrimSpace). */
function heredocLines(text: string): string[] {
  return text.replace(GO_TRIM, '').split('\n');
}

type Pair<T> = { op: ' ' | '-' | '+' | '~'; a?: T; b?: T };

/** OpenTofu's objchange.LongestCommonSubsequence: the common items (taken from `xs`). */
function longestCommon<T>(xs: T[], ys: T[], eq: (x: T, y: T) => boolean): T[] {
  if (!xs.length || !ys.length) return [];
  const w = xs.length;
  const c = new Array<number>(xs.length * ys.length).fill(0);
  const eqs = new Array<boolean>(xs.length * ys.length).fill(false);
  for (let y = 0; y < ys.length; y++) {
    for (let x = 0; x < xs.length; x++) {
      if (eq(xs[x]!, ys[y]!)) {
        eqs[w * y + x] = true;
        c[w * y + x] = x === 0 || y === 0 ? 1 : c[w * (y - 1) + (x - 1)]! + 1;
      } else {
        const l = x > 0 ? c[w * y + (x - 1)]! : 0;
        const u = y > 0 ? c[w * (y - 1) + x]! : 0;
        c[w * y + x] = l > u ? l : u;
      }
    }
  }
  const seq = new Array<T>(c[c.length - 1]!);
  let x = xs.length - 1;
  let y = ys.length - 1;
  let i = seq.length - 1;
  while (x > -1 && y > -1) {
    if (eqs[w * y + x]) {
      seq[i--] = xs[x--]!;
      y--;
    } else {
      const l = x > 0 ? c[w * y + (x - 1)]! : 0;
      const u = y > 0 ? c[w * (y - 1) + x]! : 0;
      if (l > u) x--;
      else y--;
    }
  }
  return seq;
}

/**
 * OpenTofu's collections.ProcessSlice: before items up to the next common one are deleted (two
 * objects are changed in place instead), then after items up to it are created, then the common one.
 */
function lcs<T>(before: T[], after: T[], eq: (x: T, y: T) => boolean, isObj: (x: T) => boolean = () => false): Pair<T>[] {
  const common = longestCommon(before, after, eq);
  const out: Pair<T>[] = [];
  let bi = 0;
  let ai = 0;
  let ci = 0;
  while (bi < before.length || ai < after.length || ci < common.length) {
    while (bi < before.length && (ci >= common.length || !eq(before[bi]!, common[ci]!))) {
      if (isObj(before[bi]!) && ai < after.length && isObj(after[ai]!) && (ci >= common.length || !eq(after[ai]!, common[ci]!))) {
        out.push({ op: '~', a: before[bi++]!, b: after[ai++]! });
        continue;
      }
      out.push({ op: '-', a: before[bi++]! });
    }
    while (ai < after.length && (ci >= common.length || !eq(after[ai]!, common[ci]!))) out.push({ op: '+', b: after[ai++]! });
    if (ci < common.length) {
      out.push({ op: ' ', a: before[bi++]!, b: after[ai++]! });
      ci++;
    }
  }
  return out;
}

const FORCES = ' # forces replacement';

/**
 * Render one value (or a before → after change) for an attribute at level L. `forces` adds
 * "# forces replacement" where OpenTofu puts it: after the opening line (`<<-EOT`, `[`, `{`) or
 * the one-line value. A known value that becomes unknown gets it twice, like the real CLI: the
 * old value is drawn as removed (with its own mark), then `-> (known after apply)` and the mark.
 */
function value(before: Val | null | undefined, after: Val | null | undefined, L: number, o: Opts, keyStyle: 'object' | 'map', forces = false): Rendered {
  const r = valueBody(before, after, L, o, keyStyle, forces);
  if (forces && o.diff && !r.both) r.first += FORCES;
  return r;
}

function valueBody(before: Val | null | undefined, after: Val | null | undefined, L: number, o: Opts, keyStyle: 'object' | 'map', forces = false): Rendered & { both?: boolean } {
  void keyStyle;
  const creating = isNullish(before) && !isNullish(after);
  const deleting = !isNullish(before) && isNullish(after) && o.diff;
  const single = creating ? after! : deleting ? before! : null;
  const tail = deleting ? ' -> null' : '';
  // Sensitive
  if ((before?.s || after?.s) && o.diff) {
    if (creating || deleting) return { first: `(sensitive value)${tail}`, rest: [] };
    return { first: '(sensitive value)', rest: [] };
  }
  if (!o.diff) {
    const v = after!;
    if (v.s) return { first: '(sensitive value)', rest: [] };
    return whole(v, L, o, ' ');
  }
  if (single) return whole(single, L, o, creating ? '+' : '-', tail);
  // update (or no-op shown for context)
  const b = before!;
  const a = after!;
  if (isUnknown(a)) {
    // OpenTofu's unknown renderer: the old value drawn as deleted (no "-> null"), then the arrow.
    const w = whole(b, L, o, '-');
    const mark = forces ? FORCES : '';
    const arrow = ` -> (known after apply)${mark}`;
    if (!w.rest.length) return { first: `${w.first}${mark}${arrow}`, rest: [], both: true };
    const last = w.rest.pop()!;
    w.rest.push([...last, { t: arrow }]);
    return { first: `${w.first}${mark}`, rest: w.rest, both: true };
  }
  if (typeof b.v === 'string' && typeof a.v === 'string' && (isMulti(b) || isMulti(a))) {
    const ops = lcs(heredocLines(b.v), heredocLines(a.v), (x, y) => x === y);
    const rest: Line[] = ops.map((x) => lineWith(L + 1, x.op === '~' ? ' ' : x.op, x.op === '+' ? x.b! : x.a!, o));
    rest.push([{ t: sp(col(L, o)) + 'EOT' }]);
    return { first: '<<-EOT', rest };
  }
  if (isColl(b) && isColl(a) && Array.isArray(b.v) === Array.isArray(a.v)) return collDiff(b, a, L, o);
  return { first: `${prim(b)} -> ${prim(a)}`, rest: [] };
}

/** A whole value, every line with the same symbol (create / delete / plain). */
function whole(v: Val, L: number, o: Opts, sym: Sym, tail = ''): Rendered {
  if (isUnknown(v)) return { first: `(known after apply)${tail}`, rest: [] };
  if (v.s && o.diff) return { first: `(sensitive value)${tail}`, rest: [] };
  if (isMulti(v)) {
    const rest: Line[] = heredocLines(v.v as string).map((t) => [{ t: sp(col(L, o) + 4) + t }]);
    rest.push([{ t: `${sp(col(L, o))}EOT${tail}` }]);
    return { first: '<<-EOT', rest };
  }
  if (Array.isArray(v.v)) {
    if (!v.v.length) return { first: `[]${tail}`, rest: [] };
    const rest: Line[] = [];
    for (const item of v.v) {
      const r = whole(item, L + 1, o, sym);
      if (r.rest.length) {
        rest.push(lineWith(L + 1, sym, r.first, o));
        rest.push(...r.rest.slice(0, -1));
        const last = r.rest[r.rest.length - 1]!;
        rest.push([...last, { t: ',' }]);
      } else rest.push(lineWith(L + 1, sym, `${r.first},`, o));
    }
    rest.push([{ t: `${sp(col(L, o))}]${tail}` }]);
    return { first: '[', rest };
  }
  if (isMapLike(v)) {
    const entries = Object.keys(v.v as object)
      .sort()
      .map((k) => [k, (v.v as Record<string, Val>)[k]!] as const)
      .filter(([, x]) => !(o.diff && x.v === null && v.ty.k === 'object'));
    if (!entries.length) return { first: `{}${tail}`, rest: [] };
    const keyText = (k: string) => (v.ty.k === 'map' && !o.json ? quote(k) : BARE_KEY.test(k) ? k : quote(k));
    const w = Math.max(...entries.map(([k]) => keyText(k).length));
    const rest: Line[] = [];
    for (const [k, x] of entries) {
      const r = whole(x, L + 1, o, sym);
      rest.push(lineWith(L + 1, sym, `${keyText(k).padEnd(w)} = ${r.first}`, o));
      rest.push(...r.rest);
    }
    rest.push([{ t: `${sp(col(L, o))}}${tail}` }]);
    return { first: '{', rest };
  }
  return { first: `${prim(v)}${tail}`, rest: [] };
}

function collDiff(b: Val, a: Val, L: number, o: Opts): Rendered {
  const rest: Line[] = [];
  if (Array.isArray(b.v) && Array.isArray(a.v)) {
    const ops = lcs(b.v, a.v, (x, y) => keyOf(x) === keyOf(y) && !hasUnknown(x) && !hasUnknown(y), (x) => isMapLike(x) && !x.s);
    // OpenTofu's list renderer: a changed element shows the unchanged element just before it and
    // the one just after it; a run of other unchanged elements becomes one "hidden" line.
    const hiddenLine = (n: number): Line => [{ t: `${sp(col(L + 1, o))}# (${n} unchanged element${n === 1 ? '' : 's'} hidden)` }];
    const element = (x: Pair<Val>) => {
      const sym: Sym = x.op === '~' ? '~' : x.op;
      const r = x.op === '~' ? value(x.a, x.b, L + 1, o, 'object') : whole(x.op === '+' ? x.b! : x.a!, L + 1, o, sym);
      if (r.rest.length) {
        rest.push(lineWith(L + 1, sym, r.first, o));
        rest.push(...r.rest.slice(0, -1));
        rest.push([...r.rest[r.rest.length - 1]!, { t: ',' }]);
      } else rest.push(lineWith(L + 1, sym, `${r.first},`, o));
    };
    let unchanged: Pair<Val>[] = [];
    let renderNext = false;
    for (const x of ops) {
      if (x.op === ' ' && !renderNext) {
        unchanged.push(x);
        continue;
      }
      renderNext = false;
      if (unchanged.length > 1) rest.push(hiddenLine(unchanged.length - 1));
      if (unchanged.length) element(unchanged[unchanged.length - 1]!);
      unchanged = [];
      if (x.op !== ' ') renderNext = true;
      element(x);
    }
    if (unchanged.length) rest.push(hiddenLine(unchanged.length));
    rest.push([{ t: `${sp(col(L, o))}]` }]);
    return { first: '[', rest };
  }
  // maps / objects
  const bm = b.v as Record<string, Val>;
  const am = a.v as Record<string, Val>;
  const keys = [...new Set([...Object.keys(bm), ...Object.keys(am)])].sort();
  const isMap = !o.json && (b.ty.k === 'map' || a.ty.k === 'map');
  const keyText = (k: string) => (isMap || !BARE_KEY.test(k) ? quote(k) : k);
  const shown = keys.filter((k) => !(bm[k] && am[k] && valEq(bm[k]!, am[k]!) && !hasUnknown(am[k]!)));
  // Keys line up on the longest key, unchanged ones included (OpenTofu's map and object renderers).
  const w = Math.max(0, ...keys.map((k) => keyText(k).length));
  for (const k of shown) {
    const x = bm[k];
    const y = am[k];
    const sym: Sym = isNullish(x) ? '+' : isNullish(y) ? '-' : '~';
    const r = value(x ?? null, y ?? null, L + 1, o, isMap ? 'map' : 'object');
    rest.push(lineWith(L + 1, sym, `${keyText(k).padEnd(w)} = ${r.first}`, o));
    rest.push(...r.rest);
  }
  const hidden = keys.length - shown.length;
  if (hidden) rest.push([{ t: `${sp(col(L + 1, o))}# (${hidden} unchanged ${isMap ? 'element' : 'attribute'}${hidden === 1 ? '' : 's'} hidden)` }]);
  rest.push([{ t: `${sp(col(L, o))}}` }]);
  return { first: '{', rest };
}

// ---------------------------------------------------------------------------
// Resource blocks

const IDENTIFYING = new Set(['id', 'name', 'tags']);

function headerSym(c: Change): { t: string; c?: Seg['c'] } {
  switch (c.action) {
    case 'create':
      return { t: '  +', c: 'green' };
    case 'delete':
      return { t: '  -', c: 'red' };
    case 'update':
      return { t: '  ~', c: 'yellow' };
    case 'replace':
      return c.cbd ? { t: '+/-', c: 'yellow' } : { t: '-/+', c: 'yellow' };
    case 'read':
      return { t: ' <=', c: 'cyan' };
    default:
      return { t: '   ' };
  }
}

/** The attribute lines of a resource change (level 1). */
function resourceBody(c: Change, o: Opts, showAll: boolean): Line[] {
  const before = (c.before?.v ?? {}) as Record<string, Val>;
  const after = (c.after?.v ?? {}) as Record<string, Val>;
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  type Row = { name: string; sym: Sym; r: Rendered };
  const rows: Row[] = [];
  let hidden = 0;
  const rt = schemaFor(c.mode, c.type);
  for (const n of names) {
    const b = c.action === 'create' || c.action === 'read' ? null : before[n] ?? null;
    const a = c.action === 'delete' ? null : after[n] ?? null;
    if (isNullish(b) && isNullish(a)) continue;
    const ao: Opts = rt?.attrs[n]?.type.k === 'dynamic' ? { ...o, json: true } : o;
    const changed = !(b && a && valEq(b, a) && !hasUnknown(a)) || (b && a && Boolean(b.s) !== Boolean(a.s));
    if (!changed && c.action !== 'create' && c.action !== 'delete') {
      if (showAll || IDENTIFYING.has(n)) rows.push({ name: n, sym: ' ', r: whole(a!, 1, ao, ' ') });
      else hidden++;
      continue;
    }
    const sym: Sym = c.action === 'create' || c.action === 'read' ? '+' : c.action === 'delete' ? '-' : isNullish(b) ? '+' : isNullish(a) ? '-' : '~';
    rows.push({ name: n, sym, r: value(b, a, 1, ao, 'object', c.forces.includes(n) && c.action === 'replace') });
  }
  const w = Math.max(
    0,
    ...names.filter((n) => !(isNullish(c.action === 'create' || c.action === 'read' ? null : before[n]) && isNullish(c.action === 'delete' ? null : after[n]))).map((n) => n.length),
  );
  const out: Line[] = [];
  for (const row of rows) {
    out.push(lineWith(1, row.sym, `${row.name.padEnd(w)} = ${row.r.first}`, o));
    out.push(...row.r.rest);
  }
  if (hidden) out.push([{ t: `${sp(col(1, o))}# (${hidden} unchanged attribute${hidden === 1 ? '' : 's'} hidden)` }]);
  return out;
}

const keyTextOf = (k: string | number | undefined) => (k === undefined ? '' : typeof k === 'number' ? `[${k}]` : `[${JSON.stringify(k)}]`);

export function changeHeader(c: Change, drift = false): Line[] {
  const b: Line[] = [];
  const com = (t: string): Line => [{ t: `  # ${t}`, c: 'bold' }];
  if (drift) {
    b.push(com(`${c.addr} ${c.action === 'delete' ? 'has been deleted' : 'has changed'}`));
    return b;
  }
  if (c.action === 'noop' && c.movedFrom) b.push(com(`${c.movedFrom} has moved to ${c.addr}`));
  else if (c.action === 'noop' && c.importId !== undefined) {
    // OpenTofu 1.12 names the import id and shows every attribute (checked with the real CLI).
    b.push(com(`${c.addr} will be imported`));
    b.push(com(`(imported from ${JSON.stringify(c.importId)})`));
  }
  else {
    const what = { create: 'will be created', update: 'will be updated in-place', delete: 'will be destroyed', replace: 'must be replaced', read: 'will be read during apply', noop: '' }[c.action];
    b.push(com(`${c.addr} ${c.requested ? 'will be replaced, as requested' : what}`));
    if (c.movedFrom) b.push(com(`(moved from ${c.movedFrom})`));
    if (c.importId !== undefined) {
      b.push(com(`(imported from ${JSON.stringify(c.importId)})`));
      if (c.action === 'replace' || c.action === 'delete') b.push(com('Warning: this will destroy the imported resource'));
    }
    if (c.action === 'delete' && c.reason) {
      const where = c.addr.replace(/\[[^\]]*\]$/, '');
      const reason =
        c.reason === 'countIndex'
          ? `(because index ${keyTextOf(c.key)} is out of range for count)`
          : c.reason === 'eachKey'
            ? `(because key ${keyTextOf(c.key)} is not in for_each map)`
            : c.reason === 'noModule'
              ? `(because ${c.module} is not in configuration)`
              : `(because ${where} is not in configuration)`;
      b.push(com(reason));
    }
    if (c.action === 'read') b.push(com(c.readReason === 'unknown' ? '(config refers to values not yet known)' : '(depends on a resource or a module with changes pending)'));
  }
  return b;
}

export function renderChange(c: Change, drift = false): Line[] {
  const o: Opts = { diff: true };
  const out = changeHeader(c, drift);
  const s = headerSym(drift ? { ...c, action: c.action === 'delete' ? 'delete' : 'update' } : c);
  const kind = c.mode === 'data' ? 'data' : 'resource';
  out.push([s.c ? { t: s.t, c: s.c } : { t: s.t }, { t: ` ${kind} "${c.type}" "${c.name}" {` }]);
  const showAll = c.importId !== undefined;
  out.push(...resourceBody(drift && c.action === 'delete' ? { ...c, action: 'delete' } : c, o, showAll));
  out.push([{ t: '    }' }]);
  return out;
}

/** `tofu state show` / `tofu show` block for one instance. */
export function renderStateResource(addr: string, mode: string, type: string, name: string, attrs: Record<string, Val>, sensitive: string[]): Line[] {
  const rt = schemaFor(mode as 'managed' | 'data', type);
  const o: Opts = { diff: false };
  const out: Line[] = [[{ t: `# ${addr}:` }], [{ t: `${mode === 'data' ? 'data' : 'resource'} "${type}" "${name}" {` }]];
  const rows: [string, Val][] = Object.keys(attrs)
    .sort()
    .map((n) => [n, attrs[n]!] as [string, Val])
    .filter(([, v]) => v.v !== null);
  const w = Math.max(0, ...rows.map(([n]) => n.length));
  for (const [n, v] of rows) {
    const sens = rt?.attrs[n]?.sensitive || sensitive.includes(n);
    const r: Rendered = sens ? { first: '(sensitive value)', rest: [] } : whole(v, 1, o, ' ');
    out.push([{ t: `${sp(4)}${n.padEnd(w)} = ${r.first}` }]);
    out.push(...r.rest);
  }
  out.push([{ t: '}' }]);
  return out;
}

// ---------------------------------------------------------------------------
// Output values

/**
 * `tofu output` / "Outputs:" after apply, like OpenTofu's repl.FormatValue: quoted keys, two-space
 * indent, and the type shown where HCL can't tell it: a list prints `tolist([…])`, a set
 * `toset([…])`, a map `tomap({…})` (a tuple or an object prints bare). Multi-line strings are
 * heredocs (`<<-EOT` and indented when nested).
 */
export function formatOutput(v: Val, indent = 0): string {
  if (v.v === null) return nullText(v.ty);
  if (typeof v.v === 'string') {
    if (v.v.includes('\n')) return heredoc(v.v, indent);
    return quote(v.v);
  }
  if (typeof v.v === 'number') return numStr(v.v);
  if (typeof v.v === 'boolean') return String(v.v);
  const pad = ' '.repeat(indent + 2);
  if (Array.isArray(v.v)) {
    const body = v.v.length ? `[\n${v.v.map((x) => `${pad}${formatOutput(x, indent + 2)},`).join('\n')}\n${' '.repeat(indent)}]` : '[]';
    return v.ty.k === 'list' ? `tolist(${body})` : v.ty.k === 'set' ? `toset(${body})` : body;
  }
  const m = v.v as Record<string, Val>;
  const keys = Object.keys(m).sort();
  const body = keys.length ? `{\n${keys.map((k) => `${pad}${JSON.stringify(k)} = ${formatOutput(m[k]!, indent + 2)}`).join('\n')}\n${' '.repeat(indent)}}` : '{}';
  return v.ty.k === 'map' ? `tomap(${body})` : body;
}

/** A null with a type, as repl.FormatValue prints it (`tostring(null)` …). */
function nullText(ty: Val['ty']): string {
  switch (ty.k) {
    case 'dynamic':
      return 'null';
    case 'string':
      return 'tostring(null)';
    case 'number':
      return 'tonumber(null)';
    case 'bool':
      return 'tobool(null)';
    case 'list':
      return `tolist(null) /* of ${friendlyName(ty.e)} */`;
    case 'set':
      return `toset(null) /* of ${friendlyName(ty.e)} */`;
    case 'map':
      return `tomap(null) /* of ${friendlyName(ty.e)} */`;
    default:
      return `null /* ${friendlyName(ty)} */`;
  }
}

/** cty's FriendlyName for a type. */
function friendlyName(ty: Val['ty']): string {
  switch (ty.k) {
    case 'list':
    case 'set':
    case 'map':
      return `${ty.k} of ${friendlyName(ty.e)}`;
    default:
      return ty.k;
  }
}

/** repl's formatMultilineString: `<<EOT` at the top, `<<-EOT` and indented lines when nested. */
function heredoc(text: string, indent: number): string {
  const lines = text.split('\n');
  let delim = 'EOT';
  while (lines.some((l) => l.trim() === delim)) delim += '_';
  const pad = ' '.repeat(indent);
  return `${indent > 0 ? '<<-' : '<<'}${delim}\n${lines.map((l) => pad + l).join('\n')}\n${pad}${delim}`;
}

/** The output list after apply and in `tofu output` (sensitive ones show <sensitive>). */
export function outputLines(outputs: { name: string; value: Val; sensitive: boolean }[]): Line[] {
  const out: Line[] = [];
  for (const o of [...outputs].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const text = o.sensitive ? `${o.name} = <sensitive>` : `${o.name} = ${formatOutput(o.value)}`;
    for (const l of text.split('\n')) out.push([{ t: l }]);
  }
  return out;
}

/** The "Outputs:" part of `tofu show` (aligned, unquoted object keys, 4-space indent). */
export function showOutputLines(outputs: { name: string; value: Val; sensitive: boolean }[]): Line[] {
  const o: Opts = { diff: false };
  const out: Line[] = [];
  for (const x of [...outputs].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const r: Rendered = x.sensitive ? { first: '(sensitive value)', rest: [] } : whole(x.value, 0, o, ' ');
    out.push([{ t: `${x.name} = ${r.first}` }]);
    out.push(...r.rest);
  }
  return out;
}

/**
 * "Changes to Outputs:" lines. Names are padded to the longest name of every output in the plan
 * (`all`), changed or not — like OpenTofu.
 */
export function outputChangeLines(changes: OutputChange[], all: OutputChange[] = changes): Line[] {
  const o: Opts = { diff: true, json: true };
  const rows = changes.filter((c) => !(c.before && c.after && valEq(c.before, c.after) && !hasUnknown(c.after) && Boolean(c.before.s) === Boolean(c.after.s)));
  const w = Math.max(0, ...rows.map((r) => r.name.length), ...all.map((r) => r.name.length));
  const out: Line[] = [];
  for (const c of [...rows].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const sym: Sym = isNullish(c.before) ? '+' : isNullish(c.after) ? '-' : '~';
    const b = c.before && c.sensitive ? { ...c.before, s: true } : c.before;
    const a = c.after && c.sensitive ? { ...c.after, s: true } : c.after;
    const r = value(b, a, 0, o, 'object');
    out.push(lineWith(0, sym, `${c.name.padEnd(w)} = ${r.first}`, o));
    out.push(...r.rest);
  }
  return out;
}

export function changedOutputs(p: Plan): OutputChange[] {
  return p.outputs.filter((c) => !(c.before && c.after && valEq(c.before, c.after) && !hasUnknown(c.after) && Boolean(c.before.s) === Boolean(c.after.s)) && !(isNullish(c.before) && isNullish(c.after)));
}
