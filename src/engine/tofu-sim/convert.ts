// Type conversion and unification, like cty's convert package (the subset OpenTofu lessons need).
import {
  T_BOOL,
  T_DYN,
  T_NUMBER,
  T_STRING,
  UNKNOWN,
  isUnknown,
  isMapLike,
  numStr,
  set,
  tyEq,
  type Ty,
  type Val,
} from './values';

export class ConvertError extends Error {
  constructor(
    message: string,
    public path: (string | number)[] = [],
  ) {
    super(message);
  }
}

/** "a number is required", "string required" … as cty words them. */
function required(t: Ty): string {
  switch (t.k) {
    case 'string':
      return 'string required';
    case 'number':
      return 'a number is required';
    case 'bool':
      return 'a bool is required';
    case 'list':
      return 'list of ' + (t.e.k === 'dynamic' ? 'any single type' : t.e.k) + ' required';
    case 'set':
      return 'set of ' + (t.e.k === 'dynamic' ? 'any single type' : t.e.k) + ' required';
    case 'map':
      return 'map of ' + (t.e.k === 'dynamic' ? 'any single type' : t.e.k) + ' required';
    case 'object':
      return 'object required';
    case 'tuple':
      return 'tuple required';
    default:
      return 'value required';
  }
}

/** Convert a value to a type; throws ConvertError with cty's message. */
export function convert(v: Val, to: Ty, path: (string | number)[] = []): Val {
  const mk = (x: Val): Val => (v.s ? { ...x, s: true } : x);
  if (to.k === 'dynamic') return v;
  if (isUnknown(v)) return mk({ ty: to, v: UNKNOWN });
  if (v.v === null) return mk({ ty: to, v: null });
  switch (to.k) {
    case 'string':
      if (typeof v.v === 'string') return mk({ ty: T_STRING, v: v.v });
      if (typeof v.v === 'number') return mk({ ty: T_STRING, v: numStr(v.v) });
      if (typeof v.v === 'boolean') return mk({ ty: T_STRING, v: v.v ? 'true' : 'false' });
      throw new ConvertError(required(to), path);
    case 'number':
      if (typeof v.v === 'number') return mk({ ty: T_NUMBER, v: v.v });
      if (typeof v.v === 'string' && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(v.v.trim())) return mk({ ty: T_NUMBER, v: Number(v.v) });
      if (typeof v.v === 'string') throw new ConvertError(`a number is required`, path);
      throw new ConvertError(required(to), path);
    case 'bool':
      if (typeof v.v === 'boolean') return mk({ ty: T_BOOL, v: v.v });
      if (v.v === 'true' || v.v === 'false') return mk({ ty: T_BOOL, v: v.v === 'true' });
      if (typeof v.v === 'string') throw new ConvertError(`a bool is required`, path);
      throw new ConvertError(required(to), path);
    case 'list':
    case 'set': {
      if (!Array.isArray(v.v)) throw new ConvertError(required(to), path);
      let et = to.e;
      if (et.k === 'dynamic') et = unifyTypes(v.v.map((x) => x.ty)) ?? T_DYN;
      const items = v.v.map((x, i) => convert(x, et, [...path, i]));
      return mk(to.k === 'set' ? set(et, items) : { ty: { k: 'list', e: et }, v: items });
    }
    case 'map': {
      if (!isMapLike(v)) throw new ConvertError(required(to), path);
      const entries = Object.entries(v.v as Record<string, Val>);
      let et = to.e;
      if (et.k === 'dynamic') et = unifyTypes(entries.map(([, x]) => x.ty)) ?? T_DYN;
      return mk({ ty: { k: 'map', e: et }, v: Object.fromEntries(entries.map(([k, x]) => [k, convert(x, et, [...path, k])])) });
    }
    case 'tuple': {
      if (!Array.isArray(v.v)) throw new ConvertError(required(to), path);
      if (v.v.length !== to.es.length) throw new ConvertError(`tuple required with ${to.es.length} elements`, path);
      return mk({ ty: to, v: v.v.map((x, i) => convert(x, to.es[i]!, [...path, i])) });
    }
    case 'object': {
      if (!isMapLike(v)) throw new ConvertError('object required', path);
      const src = v.v as Record<string, Val>;
      const out: Record<string, Val> = {};
      for (const [k, t] of Object.entries(to.as)) {
        if (k in src) out[k] = convert(src[k]!, t, [...path, k]);
        else if (to.opt?.includes(k)) out[k] = to.defaults?.[k] ? convert(to.defaults[k]!, t, [...path, k]) : { ty: t, v: null };
        else throw new ConvertError(`attribute "${k}" is required`, path);
      }
      return mk({ ty: { k: 'object', as: to.as }, v: out });
    }
    default:
      return v;
  }
}

/** The common type for a set of types (strings win over numbers and bools, like cty). */
export function unifyTypes(types: Ty[]): Ty | null {
  if (!types.length) return T_DYN;
  const known = types.filter((t) => t.k !== 'dynamic');
  if (!known.length) return T_DYN;
  const first = known[0]!;
  if (known.every((t) => tyEq(t, first))) return first;
  const prims = new Set(known.map((t) => t.k));
  if ([...prims].every((k) => k === 'string' || k === 'number' || k === 'bool')) return T_STRING;
  // Objects with the same keys, or maps: unify element-wise into a map.
  if (known.every((t) => t.k === 'object' || t.k === 'map')) {
    const elems: Ty[] = [];
    for (const t of known) {
      if (t.k === 'map') elems.push(t.e);
      else if (t.k === 'object') elems.push(...Object.values(t.as));
    }
    const e = unifyTypes(elems);
    if (e) return { k: 'map', e };
  }
  if (known.every((t) => t.k === 'tuple' || t.k === 'list')) {
    const elems: Ty[] = [];
    for (const t of known) {
      if (t.k === 'list') elems.push(t.e);
      else if (t.k === 'tuple') elems.push(...t.es);
    }
    const e = unifyTypes(elems);
    if (e) return { k: 'list', e };
  }
  return null;
}

/** Parse a type constraint expression's text form (from config.ts). */
export function primitive(name: string): Ty | null {
  if (name === 'string') return T_STRING;
  if (name === 'number') return T_NUMBER;
  if (name === 'bool') return T_BOOL;
  if (name === 'any') return T_DYN;
  return null;
}
