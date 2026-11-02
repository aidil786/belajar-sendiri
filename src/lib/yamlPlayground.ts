// YamlPlayground logic: read a small YAML file the way a YAML reader does, show what it means as a
// tree, and check the learner's task ("sides is a list of 3"). Pure and unit-tested.
// Parsing and error words come from src/lib/k8sYaml.ts (go-yaml's messages and line numbers, the
// reader Docker Compose and kubectl are built on; YAML 1.1 rules, so `yes` is true there).
import { parseYamlDoc, type YamlProblem } from './k8sYaml';

export type YamlKind = 'map' | 'list' | 'text' | 'number' | 'bool' | 'null';

/** One thing the finished YAML must say. All given fields must hold. */
export interface YamlExpect {
  /** Dotted path from the top: `dish`, `sides`, `sides.0`, `tiffin.top.dish`. Empty string = the whole file. */
  path: string;
  /** What kind of value sits there. */
  type?: YamlKind;
  /** Items in a list, or keys in a map. */
  count?: number;
  /** The value, compared as text (`5` and `"5"` both match `5`; use `type` to tell them apart). */
  equals?: string | number | boolean;
  /** A list item (compared as text). */
  includes?: string | number | boolean;
  /** Kind tip shown when this check is the first one that fails. */
  hint?: string;
}

export type PlayResult =
  | { ok: true; value: unknown; failed: YamlExpect[] }
  | { ok: false; problem: YamlProblem };

export function kindOf(v: unknown): YamlKind {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return 'list';
  if (typeof v === 'object') return 'map';
  if (typeof v === 'number' || typeof v === 'bigint') return 'number';
  if (typeof v === 'boolean') return 'bool';
  return 'text';
}

/** The value at a dotted path, if it is there. */
export function getPath(value: unknown, path: string): { found: boolean; value: unknown } {
  if (path === '') return { found: true, value };
  let cur: unknown = value;
  for (const seg of path.split('.')) {
    if (Array.isArray(cur)) {
      if (!/^\d+$/.test(seg) || Number(seg) >= cur.length) return { found: false, value: undefined };
      cur = cur[Number(seg)];
    } else if (cur && typeof cur === 'object') {
      if (!Object.prototype.hasOwnProperty.call(cur, seg)) return { found: false, value: undefined };
      cur = (cur as Record<string, unknown>)[seg];
    } else return { found: false, value: undefined };
  }
  return { found: true, value: cur };
}

const asText = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export function checkExpect(value: unknown, e: YamlExpect): boolean {
  const hit = getPath(value, e.path);
  if (!hit.found) return false;
  const v = hit.value;
  const kind = kindOf(v);
  if (e.type && kind !== e.type) return false;
  if (e.count !== undefined) {
    const n = Array.isArray(v) ? v.length : kind === 'map' ? Object.keys(v as object).length : -1;
    if (n !== e.count) return false;
  }
  if (e.equals !== undefined && (kind === 'map' || kind === 'list' || asText(v) !== asText(e.equals))) return false;
  if (e.includes !== undefined && !(Array.isArray(v) && v.some((x) => asText(x) === asText(e.includes)))) return false;
  return true;
}

/** Read the text and check every expectation. */
export function evaluate(text: string, expect: YamlExpect[] = []): PlayResult {
  const r = parseYamlDoc(text);
  if (!r.ok) return { ok: false, problem: r.problem };
  const value = r.parsed.value;
  return { ok: true, value, failed: expect.filter((e) => !checkExpect(value, e)) };
}

/** Done = it reads without an error and every expectation holds. */
export function goalMet(text: string, expect: YamlExpect[]): boolean {
  const r = evaluate(text, expect);
  return r.ok && expect.length > 0 && r.failed.length === 0;
}

/** A node of the "how the computer reads it" tree. */
export interface YamlTreeNode {
  /** Map key, or list position (0-based). */
  key?: string;
  index?: number;
  kind: YamlKind;
  /** Scalars: the value as the reader sees it (`true`, `5`, `nasi lemak`). */
  text?: string;
  children?: YamlTreeNode[];
}

export function toTree(value: unknown, key?: string, index?: number): YamlTreeNode {
  const kind = kindOf(value);
  const base: YamlTreeNode = { kind, ...(key !== undefined ? { key } : {}), ...(index !== undefined ? { index } : {}) };
  if (kind === 'list') return { ...base, children: (value as unknown[]).map((v, i) => toTree(v, undefined, i)) };
  if (kind === 'map') return { ...base, children: Object.entries(value as Record<string, unknown>).map(([k, v]) => toTree(v, k)) };
  return { ...base, text: kind === 'null' ? '' : String(value) };
}

/** What a YAML reader prints for a problem (go-yaml's words): `yaml: line 3: found character that cannot start any token`. */
export function problemText(p: YamlProblem): string {
  return `yaml: line ${p.goLine}: ${p.message}`;
}

/** Props check for `npm run check:mdx`: the task is possible and not already done. */
export function checkPlaygroundProps(a: { initial?: unknown; expect?: unknown; solution?: unknown }): string[] {
  const errors: string[] = [];
  if (typeof a.initial !== 'string') errors.push('YamlPlayground needs "initial" (the starting YAML)');
  const expect = a.expect as YamlExpect[] | undefined;
  if (expect !== undefined) {
    if (!Array.isArray(expect) || !expect.length) errors.push('YamlPlayground "expect" must be a non-empty list');
    else {
      for (const e of expect) if (typeof e.path !== 'string') errors.push('YamlPlayground expect items need a "path"');
      if (typeof a.initial === 'string' && goalMet(a.initial, expect)) errors.push('YamlPlayground task is already done at the start');
      if (typeof a.solution !== 'string') errors.push('YamlPlayground with "expect" needs a "solution" (never shown; proves the task is possible)');
      else if (!goalMet(a.solution, expect)) {
        const r = evaluate(a.solution, expect);
        errors.push(`YamlPlayground solution does not meet the task: ${r.ok ? r.failed.map((f) => f.path).join(', ') : problemText(r.problem)}`);
      }
    }
  }
  if (typeof a.initial === 'string' && a.initial.split('\n').length > 16) errors.push('YamlPlayground "initial" is longer than ~15 lines (rule 18)');
  return errors;
}
