// YAML in and out.
// Out: the style kubectl prints (sigs.k8s.io/yaml → go-yaml): keys sorted, lists not indented
// under their key, strings that look like numbers/bools/times in "double quotes", strings with
// special characters in 'single quotes', multi-line strings as | blocks.
// In: the `yaml` package (YAML 1.2), several documents per file.
import { parseAllDocuments } from 'yaml';
import type { KObject } from './types';

const NUMBER = /^[-+]?(\.[0-9]+|[0-9][0-9_]*(\.[0-9_]*)?)([eE][-+]?[0-9]+)?$|^0x[0-9a-fA-F_]+$|^0o?[0-7_]+$|^0b[01_]+$|^[-+]?\.(inf|Inf|INF)$|^\.(nan|NaN|NAN)$/;
const BOOL_NULL = /^(y|Y|yes|Yes|YES|n|N|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF|null|Null|NULL|~)$/;
const TIMESTAMP = /^\d{4}-\d{1,2}-\d{1,2}([Tt ]\d{1,2}:\d{2}:\d{2}(\.\d*)?\s*(Z|[-+]\d{1,2}(:\d{2})?)?)?$/;
/** Control characters (tab excluded): such strings are written in "double quotes". */
const hasControl = (s: string) => [...s].some((ch) => (ch.charCodeAt(0) < 32 && ch !== '\t') || ch.charCodeAt(0) === 127);
const BASE60 = /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+(?:\.[0-9_]*)?$/;

/** Would a YAML reader turn this plain text into something other than a string? */
function looksTyped(s: string): boolean {
  return s === '' || NUMBER.test(s) || BOOL_NULL.test(s) || TIMESTAMP.test(s) || BASE60.test(s);
}

/** Can this string be written without quotes? */
function plainOk(s: string): boolean {
  if (/^[\s]|[\s]$/.test(s)) return false;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(s) && !/^-[^\s]/.test(s)) return false;
  if (/^- |^-$/.test(s)) return false;
  if (/: |:$| #|\t/.test(s)) return false;
  if (hasControl(s)) return false;
  return true;
}

function scalar(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : v > 0 ? '+Inf' : '-Inf';
  const s = String(v);
  if (looksTyped(s)) return JSON.stringify(s);
  if (plainOk(s)) return s;
  if (hasControl(s)) return JSON.stringify(s);
  return `'${s.replace(/'/g, "''")}'`;
}

function key(k: string): string {
  return scalar(k);
}

function isEmptyMap(v: unknown): boolean {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).filter((k) => (v as Record<string, unknown>)[k] !== undefined).length === 0;
}

function block(s: string, indent: string): string {
  const trailing = /\n+$/.exec(s)?.[0].length ?? 0;
  const chomp = trailing === 0 ? '-' : trailing === 1 ? '' : '+';
  const body = (trailing ? s.slice(0, -trailing) : s).split('\n');
  const extra = trailing > 1 ? Array.from({ length: trailing - 1 }, () => '') : [];
  return `|${chomp}\n${[...body, ...extra].map((l) => (l ? indent + l : '')).join('\n')}`;
}

function emitMap(m: Record<string, unknown>, indent: string, out: string[]): void {
  for (const k of Object.keys(m).sort()) {
    const v = m[k];
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) out.push(`${indent}${key(k)}: []`);
      else {
        out.push(`${indent}${key(k)}:`);
        for (const item of v) emitItem(item, indent, out);
      }
    } else if (v && typeof v === 'object') {
      if (isEmptyMap(v)) out.push(`${indent}${key(k)}: {}`);
      else {
        out.push(`${indent}${key(k)}:`);
        emitMap(v as Record<string, unknown>, `${indent}  `, out);
      }
    } else if (typeof v === 'string' && v.includes('\n')) {
      out.push(`${indent}${key(k)}: ${block(v, `${indent}  `)}`);
    } else out.push(`${indent}${key(k)}: ${scalar(v)}`);
  }
}

function emitItem(item: unknown, indent: string, out: string[]): void {
  if (item && typeof item === 'object' && !Array.isArray(item) && !isEmptyMap(item)) {
    const sub: string[] = [];
    emitMap(item as Record<string, unknown>, `${indent}  `, sub);
    // First line of the map goes on the dash line.
    sub[0] = `${indent}- ${sub[0]!.slice(indent.length + 2)}`;
    out.push(...sub);
  } else if (Array.isArray(item)) {
    if (item.length === 0) out.push(`${indent}- []`);
    else {
      const sub: string[] = [];
      for (const x of item) emitItem(x, `${indent}  `, sub);
      sub[0] = `${indent}- ${sub[0]!.slice(indent.length + 2)}`;
      out.push(...sub);
    }
  } else if (isEmptyMap(item)) out.push(`${indent}- {}`);
  else if (typeof item === 'string' && item.includes('\n')) out.push(`${indent}- ${block(item, `${indent}  `)}`);
  else out.push(`${indent}- ${scalar(item)}`);
}

/** Write a value as YAML, the way `kubectl get -o yaml` does. Ends with a newline. */
export function toYaml(v: unknown): string {
  const out: string[] = [];
  if (Array.isArray(v)) for (const item of v) emitItem(item, '', out);
  else if (v && typeof v === 'object') {
    if (isEmptyMap(v)) out.push('{}');
    else emitMap(v as Record<string, unknown>, '', out);
  } else out.push(typeof v === 'string' && v.includes('\n') ? block(v, '  ') : scalar(v));
  return `${out.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// JSON (kubectl -o json: 4 spaces, apiVersion/kind/metadata first)

const META_ORDER = [
  'name', 'generateName', 'namespace', 'uid', 'resourceVersion', 'generation', 'creationTimestamp',
  'deletionTimestamp', 'deletionGracePeriodSeconds', 'labels', 'annotations', 'ownerReferences', 'finalizers',
];
const TOP_ORDER = ['apiVersion', 'kind', 'metadata', 'spec', 'status'];

function ordered(o: Record<string, unknown>, order: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of order) if (o[k] !== undefined) out[k] = o[k];
  for (const k of Object.keys(o)) if (!(k in out) && o[k] !== undefined) out[k] = o[k];
  return out;
}

export function toJson(v: unknown): string {
  const shape = (x: unknown): unknown => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return x;
    const o = x as Record<string, unknown>;
    if ('apiVersion' in o && 'kind' in o) {
      const top = ordered(o, TOP_ORDER);
      if (top.metadata && typeof top.metadata === 'object') top.metadata = ordered(top.metadata as Record<string, unknown>, META_ORDER);
      if (Array.isArray(top.items)) top.items = top.items.map(shape);
      return top;
    }
    return o;
  };
  return JSON.stringify(shape(v), null, 4);
}

// ---------------------------------------------------------------------------
// Parsing

export interface ParsedDocs {
  docs: KObject[];
  /** A YAML syntax problem, like kubectl prints it. */
  error?: string;
}

/** Read every document in a manifest file. Empty documents are skipped. */
export function parseManifests(text: string): ParsedDocs {
  const docs: KObject[] = [];
  let all;
  try {
    all = parseAllDocuments(text, { version: '1.1' });
  } catch (e) {
    return { docs, error: `yaml: ${(e as Error).message}` };
  }
  const list = Array.isArray(all) ? all : [all];
  for (const d of list) {
    if (d.errors.length) {
      const err = d.errors[0]!;
      const pos = err.linePos?.[0];
      const lineNo = pos ? pos.line : 1;
      const what = /Implicit map keys|Nested mappings are not allowed|mapping/i.test(err.message)
        ? 'mapping values are not allowed in this context'
        : /indent/i.test(err.message)
          ? 'did not find expected key'
          : 'could not find expected \':\'';
      return { docs, error: `yaml: line ${lineNo}: ${what}` };
    }
    const v = d.toJS({ maxAliasCount: 50 }) as unknown;
    if (v === null || v === undefined) continue;
    if (typeof v !== 'object' || Array.isArray(v)) return { docs, error: 'yaml: unmarshal errors: cannot unmarshal into an object' };
    docs.push(normalizeYaml(v) as KObject);
  }
  return { docs };
}

/** YAML 1.1 dates and other odd types come back as strings, like kubectl's JSON conversion. */
function normalizeYaml(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString().replace(/\.000Z$/, 'Z');
  if (Array.isArray(v)) return v.map(normalizeYaml);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = normalizeYaml(x);
    return out;
  }
  return v;
}
