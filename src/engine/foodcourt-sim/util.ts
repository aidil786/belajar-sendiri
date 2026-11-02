// Small pure helpers: deterministic names, durations, quantities, label selectors.
import type { KObject, KubeState } from './types';

/** The alphabet Kubernetes uses for generated names (no vowels, no look-alikes). */
export const SAFE_ALPHABET = 'bcdfghjklmnpqrstvwxz2456789';

/** FNV-1a 32-bit, like the hash Kubernetes uses for pod-template-hash. */
export function fnv32a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** `rand.SafeEncodeString(fmt.Sprint(hash))`: digits map to 4-9,b,c,d,f — real hashes look like 7d9c8b6f5d. */
export function safeEncode(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) out += SAFE_ALPHABET[text.charCodeAt(i) % SAFE_ALPHABET.length];
  return out;
}

/** pod-template-hash for a template (stable: same template → same hash). */
export function templateHash(template: unknown, collisionCount = 0): string {
  return safeEncode(String(fnv32a(stableJson(template) + (collisionCount ? `#${collisionCount}` : ''))));
}

/** JSON with sorted keys, so equal objects give equal text. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Deterministic random number in [0, 1) from the state's seed and counter (changes the state's counter). */
export function rand(state: KubeState): number {
  state.counter++;
  let h = fnv32a(`${state.seed}:${state.counter}`);
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** `generateName` suffix: 5 characters from the safe alphabet. */
export function randomSuffix(state: KubeState, n = 5): string {
  let out = '';
  for (let i = 0; i < n; i++) out += SAFE_ALPHABET[Math.floor(rand(state) * SAFE_ALPHABET.length)];
  return out;
}

export function uid(state: KubeState): string {
  const hex = () => Math.floor(rand(state) * 16).toString(16);
  const part = (n: number) => Array.from({ length: n }, hex).join('');
  return `${part(8)}-${part(4)}-4${part(3)}-${'89ab'[Math.floor(rand(state) * 4)]}${part(3)}-${part(12)}`;
}

export function hexId(state: KubeState, n = 64): string {
  return Array.from({ length: n }, () => Math.floor(rand(state) * 16).toString(16)).join('');
}

/** RFC 3339 time, like Kubernetes timestamps. */
export function iso(clock: number): string {
  return new Date(clock * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function fromIso(text: string | undefined): number {
  return text ? Math.floor(Date.parse(text) / 1000) : 0;
}

/** `kubectl describe` timestamps: "Sat, 31 Oct 2026 03:33:32 +0000". */
export function rfc1123(clock: number): string {
  const d = new Date(clock * 1000);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = (n: number) => String(n).padStart(2, '0');
  return `${days[d.getUTCDay()]}, ${p(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}

/** k8s.io/apimachinery duration.HumanDuration: 5s, 2m10s, 15m, 3h20m, 2d4h … */
export function humanDuration(seconds: number): string {
  if (seconds < -1) return '<invalid>';
  if (seconds < 0) return '0s';
  if (seconds < 120) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 10) {
    const s = seconds % 60;
    return s === 0 ? `${minutes}m` : `${minutes}m${s}s`;
  }
  if (minutes < 180) return `${minutes}m`;
  const hours = Math.floor(seconds / 3600);
  if (hours < 8) {
    const m = minutes % 60;
    return m === 0 ? `${hours}h` : `${hours}h${m}m`;
  }
  if (hours < 48) return `${hours}h`;
  if (hours < 24 * 8) {
    const h = hours % 24;
    return h === 0 ? `${Math.floor(hours / 24)}d` : `${Math.floor(hours / 24)}d${h}h`;
  }
  if (hours < 24 * 365 * 2) return `${Math.floor(hours / 24)}d`;
  const dy = Math.floor(hours / 24) % 365;
  return dy === 0 ? `${Math.floor(hours / 24 / 365)}y` : `${Math.floor(hours / 24 / 365)}y${dy}d`;
}

export function age(state: KubeState, obj: KObject): string {
  return humanDuration(state.clock - fromIso(obj.metadata.creationTimestamp));
}

// ---------------------------------------------------------------------------
// Quantities

/** CPU quantity → millicores ("100m" → 100, "1" → 1000, "0.5" → 500). */
export function cpuMilli(q: unknown): number {
  if (q === undefined || q === null || q === '') return 0;
  const s = String(q);
  if (s.endsWith('m')) return Number(s.slice(0, -1));
  return Math.round(Number(s) * 1000);
}

const MEM: Record<string, number> = {
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  '': 1,
};

/** Memory quantity → bytes ("64Mi", "1Gi", "500M", "1000"). */
export function memBytes(q: unknown): number {
  if (q === undefined || q === null || q === '') return 0;
  const m = /^([0-9.]+)([A-Za-z]*)$/.exec(String(q));
  if (!m) return 0;
  return Math.round(Number(m[1]) * (MEM[m[2]!] ?? 1));
}

export function mib(bytes: number): number {
  return bytes / 1024 ** 2;
}

/** Short memory like `kubectl top`: 12Mi. */
export function fmtMi(bytes: number): string {
  return `${Math.round(mib(bytes))}Mi`;
}

// ---------------------------------------------------------------------------
// Labels and selectors

export type Requirement = { key: string; op: 'In' | 'NotIn' | 'Exists' | 'DoesNotExist'; values: string[] };

export interface LabelSelector {
  matchLabels?: Record<string, string>;
  matchExpressions?: { key: string; operator: string; values?: string[] }[];
}

/** Turn a LabelSelector into requirements. `null`/undefined selects nothing; `{}` selects everything. */
export function requirements(sel: LabelSelector | undefined | null): Requirement[] | null {
  if (!sel) return null;
  const out: Requirement[] = [];
  for (const [k, v] of Object.entries(sel.matchLabels ?? {})) out.push({ key: k, op: 'In', values: [v] });
  for (const e of sel.matchExpressions ?? []) out.push({ key: e.key, op: e.operator as Requirement['op'], values: e.values ?? [] });
  return out;
}

export function matches(labels: Record<string, string> | undefined, reqs: Requirement[] | null): boolean {
  if (!reqs) return false;
  const l = labels ?? {};
  return reqs.every((r) => {
    const has = Object.prototype.hasOwnProperty.call(l, r.key);
    switch (r.op) {
      case 'In':
        return has && r.values.includes(l[r.key]!);
      case 'NotIn':
        return !has || !r.values.includes(l[r.key]!);
      case 'Exists':
        return has;
      case 'DoesNotExist':
        return !has;
    }
    return false;
  });
}

export function selectorMatches(sel: LabelSelector | undefined | null, labels: Record<string, string> | undefined): boolean {
  return matches(labels, requirements(sel));
}

/** A plain map selector (Services, ReplicationControllers): every key must match; empty selects nothing here. */
export function mapSelects(sel: Record<string, string> | undefined, labels: Record<string, string> | undefined): boolean {
  if (!sel || Object.keys(sel).length === 0) return false;
  return Object.entries(sel).every(([k, v]) => labels?.[k] === v);
}

/** Parse `kubectl -l` text: `app=shop`, `app!=x`, `tier in (a,b)`, `!key`, `key`. Returns null on bad syntax. */
export function parseSelector(text: string): Requirement[] | null {
  const out: Requirement[] = [];
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim() || parts.length) parts.push(cur);
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) return null;
    let m: RegExpExecArray | null;
    if ((m = /^([\w./-]+)\s+(in|notin)\s+\(([^)]*)\)$/.exec(p))) {
      out.push({ key: m[1]!, op: m[2] === 'in' ? 'In' : 'NotIn', values: m[3]!.split(',').map((s) => s.trim()).filter(Boolean) });
    } else if ((m = /^([\w./-]+)\s*(==|=|!=)\s*([\w.-]*)$/.exec(p))) {
      out.push({ key: m[1]!, op: m[2] === '!=' ? 'NotIn' : 'In', values: [m[3]!] });
    } else if ((m = /^!([\w./-]+)$/.exec(p))) {
      out.push({ key: m[1]!, op: 'DoesNotExist', values: [] });
    } else if ((m = /^([\w./-]+)$/.exec(p))) {
      out.push({ key: m[1]!, op: 'Exists', values: [] });
    } else return null;
  }
  return out;
}

/** `app=shop,tier=web` (sorted like kubectl prints selectors). */
export function labelText(labels: Record<string, string> | undefined): string {
  const entries = Object.entries(labels ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? entries.map(([k, v]) => `${k}=${v}`).join(',') : '<none>';
}

/** A LabelSelector printed like kubectl (`app=shop`, `tier in (a,b)`). */
export function selectorText(sel: LabelSelector | undefined): string {
  if (!sel) return '<none>';
  const parts: string[] = Object.entries(sel.matchLabels ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`);
  for (const e of sel.matchExpressions ?? []) {
    if (e.operator === 'Exists') parts.push(e.key);
    else if (e.operator === 'DoesNotExist') parts.push(`!${e.key}`);
    else parts.push(`${e.key} ${e.operator === 'In' ? 'in' : 'notin'} (${(e.values ?? []).join(',')})`);
  }
  return parts.length ? parts.join(',') : '<none>';
}

export function clone<T>(v: T): T {
  return structuredClone(v);
}

/** Deep merge for patches and kustomize (lists of named items merge by name, other lists replace). */
export function deepMerge(base: any, patch: any): any {
  if (patch === null) return undefined;
  if (Array.isArray(patch)) {
    if (Array.isArray(base) && patch.every((p) => p && typeof p === 'object' && 'name' in p)) {
      const out = base.map((b: any) => {
        const p = patch.find((x: any) => x.name === b?.name);
        return p ? deepMerge(b, p) : b;
      });
      for (const p of patch) if (!base.some((b: any) => b?.name === p.name)) out.push(p);
      return out;
    }
    return clone(patch);
  }
  if (patch && typeof patch === 'object') {
    const out: Record<string, unknown> = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
    for (const [k, v] of Object.entries(patch)) {
      const merged = deepMerge(out[k], v);
      if (merged === undefined) delete out[k];
      else out[k] = merged;
    }
    return out;
  }
  return patch;
}

/** Percent or number of replicas (maxSurge 25% of 3 rounds up, maxUnavailable rounds down). */
export function intOrPercent(v: unknown, total: number, roundUp: boolean): number {
  if (typeof v === 'number') return v;
  const s = String(v ?? '');
  if (s.endsWith('%')) {
    const n = (Number(s.slice(0, -1)) * total) / 100;
    return roundUp ? Math.ceil(n) : Math.floor(n);
  }
  return Number(s) || 0;
}
