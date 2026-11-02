// Goals for TofuSim cards (checked after every command) and the "blueprint vs built" picture.
import { loadConfig, type Module, type ResourceDecl } from './config';
import { formatSource } from './fmt';
import { emptyState, instanceAddr, listInstances, parseState, STATE_FILE } from './state';
import { formatOutput } from './render';
import { Walker } from './plan';
import { convert } from './convert';
import { evalExpr, type Scope } from './eval';
import { DiagError } from './diag';
import { rng } from './rng';
import type { TofuState } from './types';
import type { Val } from './values';

export interface TofuGoal {
  /** Addresses that must be in the state (a resource address matches any of its instances). */
  resourceInState?: string[];
  /** Addresses that must NOT be in the state. */
  resourceMissing?: string[];
  /** Output values in the state (compared as text: `tofu output -raw` style). */
  outputEquals?: Record<string, string | number | boolean>;
  outputExists?: string[];
  /** The last plan's summary ("Plan: 2 to add, 0 to change, 1 to destroy."). */
  planSummary?: { add?: number; change?: number; destroy?: number };
  /** Number of resource instances in the state (managed ones). */
  stateCount?: number;
  /** Project files that must exist / must contain a text / must be gone. */
  filesExist?: string[];
  fileContains?: Record<string, string>;
  fileNotContains?: Record<string, string>;
  filesMissing?: string[];
  /** `tofu init` has run. */
  initialized?: boolean;
  /** Every .tf file is formatted like `tofu fmt` would leave it. */
  formatted?: boolean;
  /** A typed command (regex), or the last one. */
  typed?: string;
  lastTyped?: string;
}

export const TOFU_GOAL_KEYS = ['resourceInState', 'resourceMissing', 'outputEquals', 'outputExists', 'planSummary', 'stateCount', 'filesExist', 'fileContains', 'fileNotContains', 'filesMissing', 'initialized', 'formatted', 'typed', 'lastTyped'] as const;

function planCounts(st: TofuState) {
  const c = { add: 0, change: 0, destroy: 0 };
  for (const a of Object.values(st.lastPlan ?? {})) {
    if (a === 'create') c.add++;
    else if (a === 'update') c.change++;
    else if (a === 'delete') c.destroy++;
    else if (a === 'replace' || a === 'cbd') {
      c.add++;
      c.destroy++;
    }
  }
  return c;
}

function outputText(v: Val): string {
  if (typeof v.v === 'string' || typeof v.v === 'number' || typeof v.v === 'boolean') return String(v.v);
  return formatOutput(v);
}

export function checkTofuGoal(st: TofuState, goal: TofuGoal, typed: string[] = []): { ok: boolean; failed: string[] } {
  const failed: string[] = [];
  const state = parseState(st.files[STATE_FILE]);
  const addrs = state ? listInstances(state).filter((x) => x.res.mode === 'managed').map((x) => x.addr) : [];
  const has = (a: string) => addrs.some((x) => x === a || x.startsWith(`${a}[`));
  for (const a of goal.resourceInState ?? []) if (!has(a)) failed.push(`resourceInState:${a}`);
  for (const a of goal.resourceMissing ?? []) if (has(a)) failed.push(`resourceMissing:${a}`);
  for (const [name, want] of Object.entries(goal.outputEquals ?? {})) {
    const o = state?.outputs[name];
    if (!o || outputText(o.value) !== String(want)) failed.push(`outputEquals:${name}`);
  }
  for (const name of goal.outputExists ?? []) if (!state?.outputs[name]) failed.push(`outputExists:${name}`);
  if (goal.planSummary) {
    const c = planCounts(st);
    const p = goal.planSummary;
    if (!st.lastPlan || (p.add !== undefined && c.add !== p.add) || (p.change !== undefined && c.change !== p.change) || (p.destroy !== undefined && c.destroy !== p.destroy)) failed.push('planSummary');
  }
  if (goal.stateCount !== undefined && addrs.length !== goal.stateCount) failed.push('stateCount');
  for (const f of goal.filesExist ?? []) if (!(f in st.files)) failed.push(`filesExist:${f}`);
  for (const f of goal.filesMissing ?? []) if (f in st.files) failed.push(`filesMissing:${f}`);
  for (const [f, text] of Object.entries(goal.fileContains ?? {})) if (!(st.files[f] ?? '').includes(text)) failed.push(`fileContains:${f}`);
  for (const [f, text] of Object.entries(goal.fileNotContains ?? {})) if ((st.files[f] ?? '').includes(text)) failed.push(`fileNotContains:${f}`);
  if (goal.initialized !== undefined && Boolean(st.init) !== goal.initialized) failed.push('initialized');
  if (goal.formatted !== undefined) {
    let ok = true;
    for (const [f, c] of Object.entries(st.files)) {
      if (!/\.(tf|tfvars)$/.test(f) || f.startsWith('.')) continue;
      try {
        if (formatSource(c, f) !== c) ok = false;
      } catch {
        ok = false;
      }
    }
    if (ok !== goal.formatted) failed.push('formatted');
  }
  if (goal.typed && !typed.some((t) => new RegExp(goal.typed!).test(t))) failed.push('typed');
  if (goal.lastTyped && !new RegExp(goal.lastTyped).test(typed[typed.length - 1] ?? '')) failed.push('lastTyped');
  return { ok: failed.length === 0, failed };
}

// ---------------------------------------------------------------------------
// The picture: what the blueprint (config) asks for, what is built (state), and the last plan.

export interface PictureItem {
  addr: string;
  type: string;
  name: string;
  mode: 'managed' | 'data';
  module: string;
  /** The plan's action for it, if the last plan had one. */
  mark?: 'create' | 'update' | 'delete' | 'replace' | 'cbd';
}

export interface TofuPicture {
  initialized: boolean;
  /** Resources the .tf files describe (instances when count/for_each can be worked out). */
  blueprint: PictureItem[];
  /** Resource instances in terraform.tfstate. */
  built: PictureItem[];
  outputs: { name: string; text: string; sensitive: boolean }[];
  serial: number | null;
  /** The config does not load (a syntax error). */
  broken: boolean;
}

export function tofuPicture(st: TofuState): TofuPicture {
  const marks = st.lastPlan ?? {};
  const state = parseState(st.files[STATE_FILE]);
  const built: PictureItem[] = state
    ? listInstances(state)
        .filter((x) => x.res.mode === 'managed')
        .map((x) => {
          const it: PictureItem = { addr: x.addr, type: x.res.type, name: x.res.name, mode: 'managed', module: x.res.module };
          const m = marks[x.addr];
          if (m === 'delete' || m === 'replace' || m === 'cbd' || m === 'update') it.mark = m;
          return it;
        })
    : [];
  const { config, diags } = loadConfig(st.files);
  const broken = diags.some((d) => d.severity === 'error');
  const blueprint: PictureItem[] = [];
  if (!broken) {
    const vars: Record<string, Val> = {};
    const noRef: Scope = {
      fn: {},
      ref: () => {
        throw new DiagError([]);
      },
    };
    for (const d of Object.values(config.root.variables)) {
      try {
        if (d.default) vars[d.name] = convert(evalExpr(d.default, noRef), d.type);
      } catch {
        /* unknown */
      }
    }
    const r = rng(1);
    const w = new Walker({ mode: 'validate', config, vars, state: state ?? emptyState(''), files: { read: (p) => st.files[p] ?? null, write: () => undefined, remove: () => undefined, rng: r } });
    const add = (m: Module, d: ResourceDecl) => {
      if (d.mode !== 'managed') return;
      let keys: (string | number | undefined)[] = [undefined];
      if (d.count || d.forEach) {
        try {
          keys = w.expand(m, d).map((e) => e.key);
        } catch {
          keys = ['*'];
        }
      }
      for (const k of keys) {
        const addr = k === '*' ? `${instanceAddr({ module: m.path, mode: d.mode, type: d.type, name: d.name })}[*]` : instanceAddr({ module: m.path, mode: d.mode, type: d.type, name: d.name }, k);
        const it: PictureItem = { addr, type: d.type, name: d.name, mode: 'managed', module: m.path };
        const mk = marks[addr];
        if (mk === 'create' || mk === 'update' || mk === 'replace' || mk === 'cbd') it.mark = mk;
        blueprint.push(it);
      }
    };
    for (const m of config.all) for (const d of Object.values(m.resources).sort((a, b) => (a.key < b.key ? -1 : 1))) add(m, d);
  }
  const outputs = state ? Object.entries(state.outputs).sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, o]) => ({ name, text: o.sensitive ? '(sensitive)' : outputText(o.value), sensitive: o.sensitive })) : [];
  return { initialized: Boolean(st.init), blueprint, built, outputs, serial: state ? state.serial : null, broken };
}
