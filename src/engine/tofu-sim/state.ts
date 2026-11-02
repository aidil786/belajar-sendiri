// The state file (terraform.tfstate, format version 4), read and written like OpenTofu 1.13:
// the same field order, Go-style JSON (two-space indent, <>& escaped) and sorting rules.
import { attrNames, schemaFor, type ResourceType } from './providers';
import { fromJson, goJson, inferJson, isU, toJson, tyFromJson, tyJson, type Val } from './values';
import type { CheckResult } from './types';

export const TOFU_VERSION = '1.13.5';
export const STATE_FILE = 'terraform.tfstate';
export const BACKUP_FILE = 'terraform.tfstate.backup';

export interface StateInstance {
  key?: string | number;
  schemaVersion: number;
  /** Attribute values (objects of Val, typed by the schema). */
  attrs: Record<string, Val>;
  /** Extra sensitive paths (besides the schema's sensitive attributes): ["triggers", "pin"]. */
  sensitive: SensPath[];
  deps: string[];
  cbd?: boolean;
  deposed?: string;
}

/** An attribute path: the attribute name, then map keys / list indexes. */
export type SensPath = (string | number)[];

export interface StateResource {
  module: string;
  mode: 'managed' | 'data';
  type: string;
  name: string;
  each?: 'list' | 'map';
  provider: string;
  instances: StateInstance[];
}

export interface StateOutput {
  value: Val;
  sensitive: boolean;
}

export interface TfState {
  serial: number;
  lineage: string;
  outputs: Record<string, StateOutput>;
  resources: StateResource[];
  checks: CheckResult[] | null;
}

export function emptyState(lineage: string): TfState {
  return { serial: 0, lineage, outputs: {}, resources: [], checks: null };
}

/** "random_pet.stall[0]" / `local_file.price["nasi"]` / "module.kiosk.local_file.sign". */
export function instanceAddr(r: { module: string; mode: string; type: string; name: string }, key?: string | number): string {
  const base = `${r.module ? `${r.module}.` : ''}${r.mode === 'data' ? 'data.' : ''}${r.type}.${r.name}`;
  return key === undefined ? base : `${base}[${typeof key === 'number' ? key : JSON.stringify(key)}]`;
}

export function resourceAddr(r: { module: string; mode: string; type: string; name: string }): string {
  return instanceAddr(r);
}

/** Sort order of state resources: module, then mode (data before managed), type, name. */
function cmpRes(a: StateResource, b: StateResource): number {
  const k = (r: StateResource) => [r.module, r.mode, r.type, r.name];
  const ka = k(a);
  const kb = k(b);
  for (let i = 0; i < 4; i++) if (ka[i] !== kb[i]) return ka[i]! < kb[i]! ? -1 : 1;
  return 0;
}

function cmpKey(a?: string | number, b?: string | number): number {
  if (a === undefined || b === undefined) return 0;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/** Instance attributes → JSON, dynamic attributes as {"value", "type"}. */
function attrsJson(rt: ResourceType | undefined, attrs: Record<string, Val>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const names = rt ? attrNames(rt) : Object.keys(attrs).sort();
  for (const n of names) {
    const v = attrs[n];
    const schema = rt?.attrs[n];
    if (schema?.dynamic) out[n] = !v || v.v === null || isU(v.v) ? null : { value: toJson(v), type: tyJson(v.ty) };
    else out[n] = v ? toJson(v) : null;
  }
  return out;
}

function sensitivePaths(rt: ResourceType | undefined, extra: SensPath[]): unknown[][] {
  const paths = new Map<string, SensPath>();
  if (rt) for (const [n, a] of Object.entries(rt.attrs)) if (a.sensitive) paths.set(JSON.stringify([n]), [n]);
  for (const p of extra) paths.set(JSON.stringify(p), p);
  return [...paths.keys()].sort().map((k) => {
    const p = paths.get(k)!;
    return [
      { type: 'get_attr', value: p[0] },
      ...p.slice(1).map((x) => ({ type: 'index', value: { value: x, type: typeof x === 'number' ? 'number' : 'string' } })),
    ];
  });
}

/** The state file text (backups too, since OpenTofu 1.13). `compact` = one line (what 1.12 wrote to backups). */
export function serializeState(s: TfState, compact = false): string {
  const outputs: Record<string, unknown> = {};
  for (const name of Object.keys(s.outputs).sort()) {
    const o = s.outputs[name]!;
    outputs[name] = { value: toJson(o.value), type: tyJson(o.value.ty), ...(o.sensitive ? { sensitive: true } : {}) };
  }
  const resources = [...s.resources].sort(cmpRes).map((r) => {
    const rt = schemaFor(r.mode, r.type);
    return {
      ...(r.module ? { module: r.module } : {}),
      mode: r.mode,
      type: r.type,
      name: r.name,
      provider: `provider["${r.provider}"]`,
      instances: [...r.instances]
        .sort((a, b) => cmpKey(a.key, b.key) || (a.deposed ? 1 : 0) - (b.deposed ? 1 : 0))
        .map((i) => ({
          ...(i.key !== undefined ? { index_key: i.key } : {}),
          ...(i.deposed ? { deposed: i.deposed } : {}),
          schema_version: i.schemaVersion,
          attributes: attrsJson(rt, i.attrs),
          sensitive_attributes: sensitivePaths(rt, i.sensitive),
          ...(i.deps.length ? { dependencies: [...i.deps].sort() } : {}),
          ...(i.cbd ? { create_before_destroy: true } : {}),
        })),
    };
  });
  const doc = { version: 4, terraform_version: TOFU_VERSION, serial: s.serial, lineage: s.lineage, outputs, resources, check_results: s.checks };
  return `${goJson(doc, compact ? '' : '  ')}\n`;
}

export function parseState(text: string | undefined): TfState | null {
  if (!text || !text.trim()) return null;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  const outputs: Record<string, StateOutput> = {};
  for (const [name, o] of Object.entries((j.outputs ?? {}) as Record<string, { value: unknown; type: unknown; sensitive?: boolean }>)) {
    outputs[name] = { value: fromJson(o.value, tyFromJson(o.type)), sensitive: Boolean(o.sensitive) };
  }
  const resources: StateResource[] = [];
  for (const r of (j.resources ?? []) as Record<string, unknown>[]) {
    const mode = r.mode as 'managed' | 'data';
    const type = r.type as string;
    const rt = schemaFor(mode, type);
    const provider = /provider\["(.+)"\]/.exec(String(r.provider))?.[1] ?? '';
    resources.push({
      module: (r.module as string) ?? '',
      mode,
      type,
      name: r.name as string,
      ...(r.each ? { each: r.each as 'list' | 'map' } : {}),
      provider,
      instances: ((r.instances ?? []) as Record<string, unknown>[]).map((i) => {
        const raw = (i.attributes ?? {}) as Record<string, unknown>;
        const attrs: Record<string, Val> = {};
        for (const [n, v] of Object.entries(raw)) {
          const a = rt?.attrs[n];
          if (a?.dynamic) attrs[n] = v === null ? { ty: { k: 'dynamic' }, v: null } : fromJson((v as { value: unknown }).value, tyFromJson((v as { type: unknown }).type));
          else attrs[n] = a ? fromJson(v, a.type) : inferJson(v);
        }
        const sens = ((i.sensitive_attributes ?? []) as { type: string; value: unknown }[][])
          .map((p) => p.map((step) => (step.type === 'get_attr' ? (step.value as string) : ((step.value as { value: string | number }).value))))
          .filter((p) => p.length && !(p.length === 1 && rt?.attrs[p[0] as string]?.sensitive));
        const inst: StateInstance = { schemaVersion: Number(i.schema_version ?? 0), attrs, sensitive: sens, deps: (i.dependencies as string[]) ?? [] };
        if (i.index_key !== undefined) inst.key = i.index_key as string | number;
        if (i.create_before_destroy) inst.cbd = true;
        if (i.deposed) inst.deposed = i.deposed as string;
        return inst;
      }),
    });
  }
  return {
    serial: Number(j.serial ?? 0),
    lineage: String(j.lineage ?? ''),
    outputs,
    resources,
    checks: (j.check_results as CheckResult[] | null) ?? null,
  };
}

/** Every instance with its full address, in `tofu state list` order (root module first). */
export function listInstances(s: TfState): { addr: string; res: StateResource; inst: StateInstance }[] {
  const out: { addr: string; res: StateResource; inst: StateInstance }[] = [];
  for (const r of [...s.resources].sort(cmpState)) {
    for (const i of [...r.instances].sort((a, b) => cmpKey(a.key, b.key))) {
      if (i.deposed) continue;
      out.push({ addr: instanceAddr(r, i.key), res: r, inst: i });
    }
  }
  return out;
}

/** `tofu state list` order: module path first (root ""), then mode managed before data, type, name. */
function cmpState(a: StateResource, b: StateResource): number {
  if (a.module !== b.module) return a.module < b.module ? -1 : 1;
  if (a.mode !== b.mode) return a.mode === 'data' ? -1 : 1;
  if (a.type !== b.type) return a.type < b.type ? -1 : 1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

export function cloneState(s: TfState): TfState {
  return structuredClone(s);
}

/** Two states are the same when everything but the serial matches (OpenTofu bumps the serial only then). */
export function sameState(a: TfState, b: TfState): boolean {
  return serializeState({ ...a, serial: 0 }) === serializeState({ ...b, serial: 0 });
}
