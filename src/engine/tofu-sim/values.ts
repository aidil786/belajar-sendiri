// Values for the OpenTofu simulator: a small copy of cty (the type system OpenTofu uses).
// A value has a type, a payload, and two marks: unknown ("known after apply") and sensitive.
// Pure data: no DOM, no React.

export type Ty =
  | { k: 'string' }
  | { k: 'number' }
  | { k: 'bool' }
  | { k: 'dynamic' }
  | { k: 'list'; e: Ty }
  | { k: 'set'; e: Ty }
  | { k: 'map'; e: Ty }
  | { k: 'tuple'; es: Ty[] }
  | { k: 'object'; as: Record<string, Ty>; opt?: string[]; defaults?: Record<string, Val> };

export const T_STRING: Ty = { k: 'string' };
export const T_NUMBER: Ty = { k: 'number' };
export const T_BOOL: Ty = { k: 'bool' };
export const T_DYN: Ty = { k: 'dynamic' };

/** The payload of an unknown value. Checked by shape (isU), so it survives structuredClone. */
export const UNKNOWN = Object.freeze({ unknown: true as const });
export type Unknown = { readonly unknown: true };

/** True for the unknown payload. A map's entries are Val objects, never the literal `true`. */
export function isU(v: unknown): v is Unknown {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && (v as { unknown?: unknown }).unknown === true;
}

export interface Val {
  ty: Ty;
  v: null | string | number | boolean | Val[] | { [key: string]: Val } | Unknown;
  /** Sensitive mark (shown as "(sensitive value)"). */
  s?: boolean;
}

export const str = (v: string): Val => ({ ty: T_STRING, v });
export const num = (v: number): Val => ({ ty: T_NUMBER, v });
export const bool = (v: boolean): Val => ({ ty: T_BOOL, v });
export const nullOf = (ty: Ty = T_DYN): Val => ({ ty, v: null });
export const unknown = (ty: Ty = T_DYN): Val => ({ ty, v: UNKNOWN });
export const tuple = (items: Val[]): Val => ({ ty: { k: 'tuple', es: items.map((i) => i.ty) }, v: items });
export const list = (e: Ty, items: Val[]): Val => ({ ty: { k: 'list', e }, v: items });
export const object = (attrs: Record<string, Val>): Val => ({ ty: { k: 'object', as: Object.fromEntries(Object.entries(attrs).map(([k, x]) => [k, x.ty])) }, v: attrs });
export const map = (e: Ty, attrs: Record<string, Val>): Val => ({ ty: { k: 'map', e }, v: attrs });
export function set(e: Ty, items: Val[]): Val {
  const seen = new Map<string, Val>();
  for (const it of items) seen.set(keyOf(it), it);
  return { ty: { k: 'set', e }, v: sortSet([...seen.values()]) };
}

export const isUnknown = (x: Val) => isU(x.v);
export const isNull = (x: Val) => x.v === null;
export const isKnown = (x: Val) => !isU(x.v);

export function isList(x: Val): x is Val & { v: Val[] } {
  return Array.isArray(x.v);
}
export function isMapLike(x: Val): x is Val & { v: Record<string, Val> } {
  return x.v !== null && !isU(x.v) && typeof x.v === 'object' && !Array.isArray(x.v);
}

/** True when the value or anything inside it is unknown. */
export function hasUnknown(x: Val): boolean {
  if (isU(x.v)) return true;
  if (Array.isArray(x.v)) return x.v.some(hasUnknown);
  if (isMapLike(x)) return Object.values(x.v as Record<string, Val>).some(hasUnknown);
  return false;
}

/** True when the value or anything inside it is sensitive. */
export function hasSensitive(x: Val): boolean {
  if (x.s) return true;
  if (Array.isArray(x.v)) return x.v.some(hasSensitive);
  if (isMapLike(x)) return Object.values(x.v as Record<string, Val>).some(hasSensitive);
  return false;
}

export function mark(x: Val, s: boolean | undefined): Val {
  return s ? { ...x, s: true } : x;
}

/** Remove every sensitive mark (deep). */
export function unmark(x: Val): Val {
  const out: Val = { ty: x.ty, v: x.v };
  if (Array.isArray(x.v)) out.v = x.v.map(unmark);
  else if (isMapLike(x)) out.v = Object.fromEntries(Object.entries(x.v as Record<string, Val>).map(([k, v]) => [k, unmark(v)]));
  return out;
}

// ---------------------------------------------------------------------------
// Types

export function tyEq(a: Ty, b: Ty): boolean {
  if (a.k !== b.k) return false;
  switch (a.k) {
    case 'list':
    case 'set':
    case 'map':
      return tyEq(a.e, (b as typeof a).e);
    case 'tuple': {
      const bb = b as typeof a;
      return a.es.length === bb.es.length && a.es.every((t, i) => tyEq(t, bb.es[i]!));
    }
    case 'object': {
      const bb = b as typeof a;
      const ka = Object.keys(a.as).sort();
      const kb = Object.keys(bb.as).sort();
      return ka.length === kb.length && ka.every((k, i) => k === kb[i] && tyEq(a.as[k]!, bb.as[k]!));
    }
    default:
      return true;
  }
}

/** A type as OpenTofu writes it in HCL (`list(string)`, `object({...})`). */
export function tyString(t: Ty): string {
  switch (t.k) {
    case 'dynamic':
      return 'dynamic';
    case 'list':
    case 'set':
    case 'map':
      return `${t.k}(${tyString(t.e)})`;
    case 'tuple':
      return `tuple([${t.es.map(tyString).join(', ')}])`;
    case 'object':
      return `object({${Object.keys(t.as)
        .sort()
        .map((k) => `${k}: ${tyString(t.as[k]!)}`)
        .join(', ')}})`;
    default:
      return t.k;
  }
}

/** A type as cty JSON (`"string"`, `["list","string"]`, `["object",{...}]`). */
export function tyJson(t: Ty): unknown {
  switch (t.k) {
    case 'list':
    case 'set':
    case 'map':
      return [t.k, tyJson(t.e)];
    case 'tuple':
      return ['tuple', t.es.map(tyJson)];
    case 'object':
      return ['object', Object.fromEntries(Object.keys(t.as).sort().map((k) => [k, tyJson(t.as[k]!)]))];
    default:
      return t.k;
  }
}

export function tyFromJson(j: unknown): Ty {
  if (typeof j === 'string') {
    if (j === 'string' || j === 'number' || j === 'bool' || j === 'dynamic') return { k: j } as Ty;
    return T_DYN;
  }
  if (Array.isArray(j)) {
    const [kind, arg] = j as [string, unknown];
    if (kind === 'list' || kind === 'set' || kind === 'map') return { k: kind, e: tyFromJson(arg) };
    if (kind === 'tuple') return { k: 'tuple', es: (arg as unknown[]).map(tyFromJson) };
    if (kind === 'object') return { k: 'object', as: Object.fromEntries(Object.entries(arg as Record<string, unknown>).map(([k, v]) => [k, tyFromJson(v)])) };
  }
  return T_DYN;
}

/** The friendly name OpenTofu uses in error messages ("a number is required", "list of string"). */
export function tyFriendly(t: Ty): string {
  switch (t.k) {
    case 'list':
    case 'set':
    case 'map':
      return `${t.k} of ${tyFriendly(t.e)}`;
    case 'tuple':
      return 'tuple';
    case 'object':
      return 'object';
    case 'dynamic':
      return 'any';
    default:
      return t.k;
  }
}

// ---------------------------------------------------------------------------
// Ordering and equality

/** A stable key for sets and equality checks. */
export function keyOf(x: Val): string {
  if (isU(x.v)) return '?';
  if (x.v === null) return 'null';
  if (Array.isArray(x.v)) return `[${x.v.map(keyOf).join(',')}]`;
  if (isMapLike(x)) return `{${Object.keys(x.v).sort().map((k) => `${JSON.stringify(k)}:${keyOf((x.v as Record<string, Val>)[k]!)}`).join(',')}}`;
  return `${typeof x.v}:${String(x.v)}`;
}

/** cty sorts set elements: numbers by value, strings lexically, others by key. */
export function sortSet(items: Val[]): Val[] {
  return [...items].sort((a, b) => {
    if (typeof a.v === 'number' && typeof b.v === 'number') return a.v - b.v;
    if (typeof a.v === 'string' && typeof b.v === 'string') return a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
    const ka = keyOf(a);
    const kb = keyOf(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/** Deep equality of payloads (types are compared loosely: a list and a tuple with the same items are equal). */
export function valEq(a: Val, b: Val): boolean {
  return keyOf(a) === keyOf(b);
}

// ---------------------------------------------------------------------------
// Numbers and strings

/** How cty prints a number (no exponent for normal sizes). */
export function numStr(n: number): string {
  if (Number.isInteger(n)) {
    if (Math.abs(n) < 1e21) return BigInt(n).toString();
  }
  const s = String(n);
  if (!/e/.test(s)) return s;
  return n.toFixed(20).replace(/\.?0+$/, '');
}

/** Go-style JSON string escaping (Go escapes <, > and & too). */
export function goJsonString(s: string): string {
  return JSON.stringify(s)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** JSON like Go's encoding/json (MarshalIndent with two spaces when `indent`). */
export function goJson(x: unknown, indent = '  ', prefix = ''): string {
  if (x === null || x === undefined) return 'null';
  if (typeof x === 'string') return goJsonString(x);
  if (typeof x === 'number') return numStr(x);
  if (typeof x === 'boolean') return String(x);
  const nl = indent ? '\n' : '';
  const inner = prefix + indent;
  const sep = indent ? ': ' : ':';
  if (Array.isArray(x)) {
    if (!x.length) return '[]';
    return `[${nl}${x.map((v) => inner + goJson(v, indent, inner)).join(`,${nl}`)}${nl}${prefix}]`;
  }
  const entries = Object.entries(x as Record<string, unknown>).filter(([, v]) => v !== undefined);
  if (!entries.length) return '{}';
  return `{${nl}${entries.map(([k, v]) => `${inner}${goJsonString(k)}${sep}${goJson(v, indent, inner)}`).join(`,${nl}`)}${nl}${prefix}}`;
}

// ---------------------------------------------------------------------------
// JSON <-> values (state files store plain JSON plus the type)

export function toJson(x: Val): unknown {
  if (isU(x.v)) return null;
  if (x.v === null) return null;
  if (Array.isArray(x.v)) return x.v.map(toJson);
  if (isMapLike(x)) {
    const keys = Object.keys(x.v).sort();
    return Object.fromEntries(keys.map((k) => [k, toJson((x.v as Record<string, Val>)[k]!)]));
  }
  return x.v;
}

export function fromJson(j: unknown, ty: Ty): Val {
  if (j === null || j === undefined) return nullOf(ty);
  switch (ty.k) {
    case 'string':
      return str(typeof j === 'string' ? j : String(j));
    case 'number':
      return num(Number(j));
    case 'bool':
      return bool(Boolean(j));
    case 'list':
      return list(ty.e, (j as unknown[]).map((x) => fromJson(x, ty.e)));
    case 'set':
      return set(ty.e, (j as unknown[]).map((x) => fromJson(x, ty.e)));
    case 'map':
      return map(ty.e, Object.fromEntries(Object.entries(j as Record<string, unknown>).map(([k, x]) => [k, fromJson(x, ty.e)])));
    case 'tuple':
      return { ty, v: (j as unknown[]).map((x, i) => fromJson(x, ty.es[i] ?? T_DYN)) };
    case 'object':
      return { ty, v: Object.fromEntries(Object.entries(ty.as).map(([k, t]) => [k, fromJson((j as Record<string, unknown>)[k], t)])) };
    default:
      return inferJson(j);
  }
}

/** A value from JSON without a known type (dynamic). */
export function inferJson(j: unknown): Val {
  if (j === null || j === undefined) return nullOf();
  if (typeof j === 'string') return str(j);
  if (typeof j === 'number') return num(j);
  if (typeof j === 'boolean') return bool(j);
  if (Array.isArray(j)) return tuple(j.map(inferJson));
  return object(Object.fromEntries(Object.entries(j as Record<string, unknown>).map(([k, v]) => [k, inferJson(v)])));
}
