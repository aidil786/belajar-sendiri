// The providers the practice laptop has: hashicorp/random 3.9.1, hashicorp/local 2.9.1,
// hashicorp/null 3.3.2 and OpenTofu's built-in terraform_data. Schemas and behaviour follow
// the real providers (checked with `npm run verify:tofu`); random values come from a seeded
// generator instead of crypto/rand.
import { convert } from './convert';
import { base64, contentHashes, toHex, utf8 } from './hashes';
import { PET_ADJECTIVES, PET_ADVERBS, PET_NAMES, type Rng } from './rng';
import {
  T_BOOL,
  T_DYN,
  T_NUMBER,
  T_STRING,
  bool,
  hasUnknown,
  isUnknown,
  num,
  numStr,
  str,
  unknown,
  valEq,
  type Ty,
  type Val,
} from './values';

export interface AttrSchema {
  type: Ty;
  required?: boolean;
  optional?: boolean;
  computed?: boolean;
  sensitive?: boolean;
  /** Changing it replaces the resource. */
  forceNew?: boolean;
  /** Plan-time default when config leaves it out. */
  def?: Val;
  /** Stored as {"value", "type"} in the state (dynamic attributes). */
  dynamic?: boolean;
  /** Replaces the resource, but the plan doesn't mark the line "# forces replacement". */
  quietForce?: boolean;
}

export interface FileCtx {
  read(path: string): string | null;
  write(path: string, content: string): void;
  remove(path: string): void;
  rng: Rng;
}

export class ProviderError extends Error {
  constructor(
    public summary: string,
    public detail: string,
  ) {
    super(summary);
  }
}

export interface ResourceType {
  name: string;
  /** Provider source address, as written in the state ("registry.opentofu.org/hashicorp/random"). */
  provider: string;
  mode: 'managed' | 'data';
  schemaVersion: number;
  attrs: Record<string, AttrSchema>;
  /** Fill computed values after apply (create or update). */
  apply?(planned: Record<string, Val>, prior: Record<string, Val> | null, ctx: FileCtx): Record<string, Val>;
  /** Refresh: the current object, or null when it is gone. */
  read?(prior: Record<string, Val>, ctx: FileCtx): Record<string, Val> | null;
  destroy?(prior: Record<string, Val>, ctx: FileCtx): void;
  /** Data sources: read now (all config known). */
  readData?(config: Record<string, Val>, ctx: FileCtx): Record<string, Val>;
  /** Import by id; throws ProviderError when the id is not valid. */
  importId?(id: string): Record<string, Val>;
  /** Extra planning (e.g. terraform_data's output follows input). */
  planExtra?(planned: Record<string, Val>, prior: Record<string, Val> | null, replace: boolean): void;
}

export const PROVIDERS: Record<string, { source: string; version: string; builtin?: boolean }> = {
  random: { source: 'registry.opentofu.org/hashicorp/random', version: '3.9.1' },
  local: { source: 'registry.opentofu.org/hashicorp/local', version: '2.9.1' },
  null: { source: 'registry.opentofu.org/hashicorp/null', version: '3.3.2' },
  terraform: { source: 'terraform.io/builtin/terraform', version: '', builtin: true },
};

const RANDOM = PROVIDERS.random!.source;
const LOCAL = PROVIDERS.local!.source;
const NULL = PROVIDERS.null!.source;
const BUILTIN = PROVIDERS.terraform!.source;

const MAP_STR: Ty = { k: 'map', e: T_STRING };
const keepers: AttrSchema = { type: MAP_STR, optional: true, forceNew: true };
const computedStr: AttrSchema = { type: T_STRING, computed: true };

const s = (x: Val | undefined): string | null => (x && typeof x.v === 'string' ? x.v : null);
const n = (x: Val | undefined): number | null => (x && typeof x.v === 'number' ? x.v : null);
const b = (x: Val | undefined, d: boolean): boolean => (x && typeof x.v === 'boolean' ? x.v : d);

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SPECIAL = '!@#$%&*()-_=+[]{}<>:?';

function randomString(p: Record<string, Val>, rng: Rng): string {
  const length = n(p.length) ?? 0;
  const special = s(p.override_special) ?? SPECIAL;
  const sets: [string, number][] = [];
  if (b(p.lower, true)) sets.push([LOWER, n(p.min_lower) ?? 0]);
  if (b(p.upper, true)) sets.push([UPPER, n(p.min_upper) ?? 0]);
  if (b(p.numeric, true) && b(p.number, true)) sets.push([DIGITS, n(p.min_numeric) ?? 0]);
  if (b(p.special, true)) sets.push([special, n(p.min_special) ?? 0]);
  const all = sets.map(([c]) => c).join('');
  const chars: string[] = [];
  for (const [set, min] of sets) for (let i = 0; i < min; i++) chars.push(rng.pick([...set]));
  while (chars.length < length) chars.push(rng.pick([...(all || LOWER)]));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.slice(0, Math.max(length, 0)).join('');
}

function uuid(rng: Rng): string {
  const h = toHex(rng.bytes(16));
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const stringAttrs = (extra: Record<string, AttrSchema> = {}): Record<string, AttrSchema> => ({
  id: computedStr,
  keepers,
  length: { type: T_NUMBER, required: true, forceNew: true },
  lower: { type: T_BOOL, optional: true, computed: true, forceNew: true, def: bool(true) },
  min_lower: { type: T_NUMBER, optional: true, computed: true, forceNew: true, def: num(0) },
  min_numeric: { type: T_NUMBER, optional: true, computed: true, forceNew: true, def: num(0) },
  min_special: { type: T_NUMBER, optional: true, computed: true, forceNew: true, def: num(0) },
  min_upper: { type: T_NUMBER, optional: true, computed: true, forceNew: true, def: num(0) },
  number: { type: T_BOOL, optional: true, computed: true, forceNew: true, def: bool(true) },
  numeric: { type: T_BOOL, optional: true, computed: true, forceNew: true, def: bool(true) },
  override_special: { type: T_STRING, optional: true, forceNew: true },
  result: { type: T_STRING, computed: true },
  special: { type: T_BOOL, optional: true, computed: true, forceNew: true, def: bool(true) },
  upper: { type: T_BOOL, optional: true, computed: true, forceNew: true, def: bool(true) },
  ...extra,
});

function importString(id: string): Record<string, Val> {
  return {
    id: str(id),
    keepers: { ty: MAP_STR, v: null },
    length: num([...id].length),
    lower: bool(true),
    min_lower: num(0),
    min_numeric: num(0),
    min_special: num(0),
    min_upper: num(0),
    number: bool(true),
    numeric: bool(true),
    override_special: { ty: T_STRING, v: null },
    result: str(id),
    special: bool(true),
    upper: bool(true),
  };
}

function fileContent(p: Record<string, Val>, ctx: FileCtx): string {
  const c = s(p.content) ?? s(p.sensitive_content);
  if (c !== null) return c;
  const b64 = s(p.content_base64);
  if (b64 !== null) return new TextDecoder().decode(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)));
  const src = s(p.source);
  if (src !== null) return ctx.read(src) ?? '';
  return '';
}

const fileHashAttrs = (): Record<string, AttrSchema> => ({
  content_base64sha256: computedStr,
  content_base64sha512: computedStr,
  content_md5: computedStr,
  content_sha1: computedStr,
  content_sha256: computedStr,
  content_sha512: computedStr,
});

function writeLocal(planned: Record<string, Val>, ctx: FileCtx): Record<string, Val> {
  const content = fileContent(planned, ctx);
  const filename = s(planned.filename)!;
  ctx.write(filename, content);
  const out = { ...planned };
  for (const [k, v] of Object.entries(contentHashes(content))) out[k] = str(v);
  return out;
}

function readLocal(prior: Record<string, Val>, ctx: FileCtx): Record<string, Val> | null {
  const text = ctx.read(s(prior.filename) ?? '');
  if (text === null) return null;
  if (contentHashes(text).id !== s(prior.id)) return null;
  return prior;
}

const localFileAttrs = (sensitiveContent: boolean, perm: string): Record<string, AttrSchema> => ({
  content: { type: T_STRING, optional: true, forceNew: true, ...(sensitiveContent ? { sensitive: true } : {}) },
  content_base64: { type: T_STRING, optional: true, forceNew: true, ...(sensitiveContent ? { sensitive: true } : {}) },
  ...fileHashAttrs(),
  directory_permission: { type: T_STRING, optional: true, computed: true, forceNew: true, def: str(perm) },
  file_permission: { type: T_STRING, optional: true, computed: true, forceNew: true, def: str(perm) },
  filename: { type: T_STRING, required: true, forceNew: true },
  id: computedStr,
  ...(sensitiveContent ? {} : { sensitive_content: { type: T_STRING, optional: true, sensitive: true, forceNew: true } }),
  source: { type: T_STRING, optional: true, forceNew: true },
});

export const RESOURCES: Record<string, ResourceType> = {
  random_pet: {
    name: 'random_pet',
    provider: RANDOM,
    mode: 'managed',
    schemaVersion: 0,
    attrs: {
      id: computedStr,
      keepers,
      length: { type: T_NUMBER, optional: true, computed: true, forceNew: true, def: num(2) },
      prefix: { type: T_STRING, optional: true, forceNew: true },
      separator: { type: T_STRING, optional: true, computed: true, forceNew: true, def: str('-') },
    },
    apply(p, _prior, ctx) {
      const length = n(p.length) ?? 2;
      const words: string[] = [];
      if (length >= 3) for (let i = 0; i < length - 2; i++) words.push(ctx.rng.pick(PET_ADVERBS));
      if (length >= 2) words.push(ctx.rng.pick(PET_ADJECTIVES));
      if (length >= 1) words.push(ctx.rng.pick(PET_NAMES));
      const prefix = s(p.prefix);
      const sep = s(p.separator) ?? '-';
      return { ...p, id: str([...(prefix !== null ? [prefix] : []), ...words].join(sep)) };
    },
  },
  random_integer: {
    name: 'random_integer',
    provider: RANDOM,
    mode: 'managed',
    schemaVersion: 0,
    attrs: {
      id: computedStr,
      keepers,
      max: { type: T_NUMBER, required: true, forceNew: true },
      min: { type: T_NUMBER, required: true, forceNew: true },
      result: { type: T_NUMBER, computed: true },
      seed: { type: T_STRING, optional: true, forceNew: true },
    },
    apply(p, _prior, ctx) {
      const min = n(p.min) ?? 0;
      const max = n(p.max) ?? 0;
      if (max < min) throw new ProviderError('Create Random Integer Error', 'The minimum (min) value needs to be smaller than or equal to maximum (max) value.');
      const r = ctx.rng.int(min, max);
      return { ...p, result: num(r), id: str(numStr(r)) };
    },
    importId(id) {
      const parts = id.split(',');
      if (parts.length < 3 || parts.slice(0, 3).some((x) => !/^-?\d+$/.test(x))) {
        throw new ProviderError('Import Random Integer Error', `Invalid import usage: expecting {result},{min},{max} or {result},{min},{max},{seed}\n\nOriginal Error: ${id}`);
      }
      return {
        id: str(parts[0]!),
        keepers: { ty: MAP_STR, v: null },
        max: num(Number(parts[2])),
        min: num(Number(parts[1])),
        result: num(Number(parts[0])),
        seed: parts[3] !== undefined ? str(parts[3]) : { ty: T_STRING, v: null },
      };
    },
  },
  random_string: {
    name: 'random_string',
    provider: RANDOM,
    mode: 'managed',
    schemaVersion: 2,
    attrs: stringAttrs(),
    apply(p, _prior, ctx) {
      const r = randomString(p, ctx.rng);
      return { ...p, result: str(r), id: str(r) };
    },
    importId: importString,
  },
  random_password: {
    name: 'random_password',
    provider: RANDOM,
    mode: 'managed',
    schemaVersion: 3,
    attrs: stringAttrs({ bcrypt_hash: { type: T_STRING, computed: true, sensitive: true }, result: { type: T_STRING, computed: true, sensitive: true } }),
    apply(p, _prior, ctx) {
      const r = randomString(p, ctx.rng);
      const salt = base64(ctx.rng.bytes(16)).slice(0, 22).replace(/\+/g, '.');
      const hash = base64(ctx.rng.bytes(23)).slice(0, 31).replace(/\+/g, '.');
      return { ...p, result: str(r), id: str('none'), bcrypt_hash: str(`$2a$10$${salt}${hash}`) };
    },
    importId(id) {
      return { ...importString(id), id: str('none'), bcrypt_hash: unknown(T_STRING) };
    },
  },
  random_id: {
    name: 'random_id',
    provider: RANDOM,
    mode: 'managed',
    schemaVersion: 0,
    attrs: {
      b64_std: computedStr,
      b64_url: computedStr,
      byte_length: { type: T_NUMBER, required: true, forceNew: true },
      dec: computedStr,
      hex: computedStr,
      id: computedStr,
      keepers,
      prefix: { type: T_STRING, optional: true, forceNew: true },
    },
    apply(p, _prior, ctx) {
      const bytes = ctx.rng.bytes(n(p.byte_length) ?? 8);
      return { ...p, ...idValues(bytes, s(p.prefix) ?? '') };
    },
    importId(id) {
      const raw = atob(id.replace(/-/g, '+').replace(/_/g, '/'));
      const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      return { ...idValues(bytes, ''), byte_length: num(bytes.length), keepers: { ty: MAP_STR, v: null }, prefix: { ty: T_STRING, v: null } };
    },
  },
  random_uuid: {
    name: 'random_uuid',
    provider: RANDOM,
    mode: 'managed',
    schemaVersion: 0,
    attrs: { id: computedStr, keepers, result: computedStr },
    apply(p, _prior, ctx) {
      const u = uuid(ctx.rng);
      return { ...p, id: str(u), result: str(u) };
    },
  },
  local_file: {
    name: 'local_file',
    provider: LOCAL,
    mode: 'managed',
    schemaVersion: 0,
    attrs: localFileAttrs(false, '0777'),
    apply: (p, _prior, ctx) => writeLocal(p, ctx),
    read: readLocal,
    destroy(prior, ctx) {
      ctx.remove(s(prior.filename) ?? '');
    },
  },
  local_sensitive_file: {
    name: 'local_sensitive_file',
    provider: LOCAL,
    mode: 'managed',
    schemaVersion: 0,
    attrs: localFileAttrs(true, '0700'),
    apply: (p, _prior, ctx) => writeLocal(p, ctx),
    read: readLocal,
    destroy(prior, ctx) {
      ctx.remove(s(prior.filename) ?? '');
    },
  },
  'data.local_file': {
    name: 'local_file',
    provider: LOCAL,
    mode: 'data',
    schemaVersion: 0,
    attrs: {
      content: computedStr,
      content_base64: computedStr,
      ...fileHashAttrs(),
      filename: { type: T_STRING, required: true },
      id: computedStr,
    },
    readData(config, ctx) {
      const filename = s(config.filename) ?? '';
      const text = ctx.read(filename);
      if (text === null) throw new ProviderError('Read local file data source error', `The file at given path cannot be read.\n\n+Original Error: open ${filename}: no such file or directory`);
      const out: Record<string, Val> = { filename: str(filename), content: str(text), content_base64: str(base64(utf8(text))) };
      for (const [k, v] of Object.entries(contentHashes(text))) out[k] = str(v);
      return out;
    },
  },
  'data.local_sensitive_file': {
    name: 'local_sensitive_file',
    provider: LOCAL,
    mode: 'data',
    schemaVersion: 0,
    attrs: {
      content: { type: T_STRING, computed: true, sensitive: true },
      content_base64: { type: T_STRING, computed: true, sensitive: true },
      ...fileHashAttrs(),
      filename: { type: T_STRING, required: true },
      id: computedStr,
    },
    readData(config, ctx) {
      return RESOURCES['data.local_file']!.readData!(config, ctx);
    },
  },
  null_resource: {
    name: 'null_resource',
    provider: NULL,
    mode: 'managed',
    schemaVersion: 0,
    attrs: { id: computedStr, triggers: { type: MAP_STR, optional: true, forceNew: true } },
    apply(p, _prior, ctx) {
      const digits = Array.from({ length: 19 }, (_, i) => String(i === 0 ? ctx.rng.int(1, 8) : ctx.rng.int(0, 9))).join('');
      return { ...p, id: str(digits) };
    },
  },
  terraform_data: {
    name: 'terraform_data',
    provider: BUILTIN,
    mode: 'managed',
    schemaVersion: 0,
    attrs: {
      id: computedStr,
      input: { type: T_DYN, optional: true, dynamic: true },
      output: { type: T_DYN, computed: true, dynamic: true },
      triggers_replace: { type: T_DYN, optional: true, forceNew: true, dynamic: true, quietForce: true },
    },
    planExtra(p, prior, replace) {
      const input = p.input ?? { ty: T_DYN, v: null };
      const same = prior && !replace && prior.input && valEq(prior.input, input) && !hasUnknown(input);
      if (same) p.output = prior.output ?? { ty: T_DYN, v: null };
      else p.output = input.v === null ? { ty: T_DYN, v: null } : unknown(T_DYN);
    },
    apply(p, _prior, ctx) {
      const id = p.id && !isUnknown(p.id) && p.id.v !== null ? p.id : str(uuid(ctx.rng));
      return { ...p, id, output: p.input ?? { ty: T_DYN, v: null } };
    },
  },
};

function idValues(bytes: Uint8Array, prefix: string): Record<string, Val> {
  let dec = 0n;
  for (const x of bytes) dec = (dec << 8n) | BigInt(x);
  const url = base64(bytes, true, false);
  return {
    b64_std: str(prefix + base64(bytes)),
    b64_url: str(prefix + url),
    dec: str(prefix + dec.toString()),
    hex: str(prefix + toHex(bytes)),
    id: str(url),
  };
}

/** The provider short name a resource type uses ("random_pet" → "random"). */
export function providerOf(type: string): string {
  if (type === 'terraform_data') return 'terraform';
  if (type === 'null_resource' || type === 'null_data_source') return 'null';
  return type.split('_')[0]!;
}

export function schemaFor(mode: 'managed' | 'data', type: string): ResourceType | undefined {
  return RESOURCES[mode === 'data' ? `data.${type}` : type];
}

/** Attribute names sorted (state files and plans list them in this order). */
export function attrNames(rt: ResourceType): string[] {
  return Object.keys(rt.attrs).sort();
}

/** Convert a config value for an attribute; throws ConvertError. */
export function convertAttr(a: AttrSchema, v: Val): Val {
  if (a.dynamic) return v;
  return convert(v, a.type);
}

export { T_DYN };
