// Planning and applying: evaluate the configuration against the (refreshed) state, decide what
// each resource instance needs (create, update, replace, delete, read), then carry it out.
// One Walker does both: in "plan" mode resource references give planned values (with unknowns);
// in "apply" mode they give the values just applied, so "known after apply" gets filled in.
import { ConvertError, convert } from './convert';
import { DiagError, err, warn, type Diag } from './diag';
import { child, evalExpr, suggest, traverse, type Scope } from './eval';
import { references, type Expr, type Range, type Step } from './hcl';
import type { Config, Module, ResourceDecl } from './config';
import { attrNames, convertAttr, ProviderError, providerOf, PROVIDERS, schemaFor, type FileCtx, type ResourceType } from './providers';
import { instanceAddr, listInstances, type SensPath, type StateInstance, type StateResource, type TfState } from './state';
import type { Change, CheckResult, OutputChange } from './types';
import {
  T_DYN,
  T_NUMBER,
  T_STRING,
  hasSensitive,
  hasUnknown,
  isMapLike,
  isUnknown,
  keyOf,
  num,
  object,
  str,
  tuple,
  unknown,
  valEq,
  type Val,
} from './values';

export type WalkMode = 'plan' | 'apply' | 'validate';

export interface InstanceInfo {
  decl: ResourceDecl;
  module: Module;
  key?: string | number;
  addr: string;
  /** count.index / each.key / each.value for this instance. */
  locals: Record<string, Val>;
}

/** A small progress line printer (Refreshing / Creating …). */
export type Progress = (addr: string, text: string) => void;

const META = new Set(['count', 'for_each', 'depends_on', 'lifecycle', 'provider', 'provisioner', 'connection']);

export function objectOf(attrs: Record<string, Val>): Val {
  return object(attrs);
}

/** Every resource address a node depends on (transitively), as config addresses. */
export interface DepIndex {
  [node: string]: Set<string>;
}

/** The value of a whole resource for references: one object, a tuple (count) or an object (for_each). */
function resourceValue(decl: ResourceDecl, instances: { key?: string | number; val: Val }[]): Val {
  if (decl.count) return tuple([...instances].sort((a, b) => Number(a.key) - Number(b.key)).map((i) => i.val));
  if (decl.forEach) return object(Object.fromEntries(instances.map((i) => [String(i.key), i.val])));
  return instances[0]?.val ?? { ty: T_DYN, v: null };
}

export interface WalkerOpts {
  mode: WalkMode;
  config: Config;
  vars: Record<string, Val>;
  /** The state references read from (refreshed state in plan mode, the working state in apply). */
  state: TfState;
  files: FileCtx;
  /** Planned changes so far (plan mode) or the plan being applied (apply mode). */
  destroy?: boolean;
  progress?: Progress;
  /** Data sources read now (plan) — their results go into the state. */
  readData?: boolean;
  /** -replace=ADDR: instances to replace even when nothing changed. */
  replace?: string[];
  /**
   * Root variables whose value failed (wrong type, a broken validation rule). Like OpenTofu's
   * graph walk, everything that uses one is skipped: reading it throws SkipError.
   */
  failed?: Set<string>;
}

/** Thrown when a value needs a failed root variable: the caller leaves that object out of the plan. */
export class SkipError extends Error {
  constructor(public variable: string) {
    super(`var.${variable} has no valid value`);
  }
}

/** Evaluates the configuration graph lazily with memoisation and cycle detection. */
export class Walker {
  readonly memo = new Map<string, Val>();
  private stack: string[] = [];
  /** Planned instance values by address (plan mode). */
  readonly planned = new Map<string, Val>();
  readonly changes = new Map<string, Change>();
  readonly diags: Diag[] = [];
  readonly dataRead = new Map<string, Record<string, Val>>();
  readonly pendingData = new Set<string>();

  constructor(public o: WalkerOpts) {}

  // ----- scopes -------------------------------------------------------------

  scopeFor(mod: Module, locals: Record<string, Val> = {}): Scope {
    return {
      fn: { readFile: (p: string) => this.o.files.read(normPath(p)) },
      locals,
      ref: (root: string, steps: Step[], range: Range) => this.resolve(mod, root, steps, range, locals),
    };
  }

  private resolve(mod: Module, root: string, steps: Step[], range: Range, locals: Record<string, Val>): { val: Val; used: number } {
    const attr = (i: number) => (steps[i]?.t === 'attr' ? (steps[i] as { name: string }).name : null);
    switch (root) {
      case 'var': {
        const n = attr(0);
        if (!n || !mod.variables[n]) throw new DiagError([undeclaredVar(n ?? '', range)]);
        return { val: this.variable(mod, n), used: 1 };
      }
      case 'local': {
        const n = attr(0);
        if (!n || !mod.locals[n]) throw new DiagError([err('Reference to undeclared local value', `A local value with the name "${n}" has not been declared.${suggestTail(n ?? '', Object.keys(mod.locals))}`, range)]);
        return { val: this.local(mod, n), used: 1 };
      }
      case 'path': {
        const n = attr(0);
        if (n === 'module') return { val: str(mod.dir), used: 1 };
        if (n === 'root') return { val: str('.'), used: 1 };
        if (n === 'cwd') return { val: str('/home/you/kedai'), used: 1 };
        throw new DiagError([err('Invalid "path" attribute', `The "path" object does not have an attribute named "${n}". The supported attributes are path.cwd, the current working directory, path.module, the path to the current module, and path.root, the path to the root module.`, range)]);
      }
      case 'terraform':
      case 'tofu':
        if (attr(0) === 'workspace') return { val: str('default'), used: 1 };
        throw new DiagError([err('Invalid "terraform" attribute', `The "terraform" object does not have an attribute named "${attr(0)}". The only supported attribute is terraform.workspace, the name of the currently-selected workspace.`, range)]);
      case 'count':
        if (!('count.index' in locals)) throw new DiagError([err('Reference to "count" in non-counted context', 'The "count" object can only be used in "module", "resource", and "data" blocks, and only when the "count" argument is set.', range)]);
        return { val: locals['count.index']!, used: 1 };
      case 'each': {
        if (!('each.key' in locals)) throw new DiagError([err('Reference to "each" in context without for_each', 'The "each" object can be used only in "module" or "resource" blocks, and only when the "for_each" argument is set.', range)]);
        const n = attr(0);
        if (n === 'key') return { val: locals['each.key']!, used: 1 };
        if (n === 'value') return { val: locals['each.value']!, used: 1 };
        throw new DiagError([err('Invalid "each" attribute', `The "each" object does not have an attribute named "${n}". The supported attributes are each.key and each.value, the current key and value pair of the "for_each" attribute set.`, range)]);
      }
      case 'module': {
        const n = attr(0);
        if (!n || !mod.modules[n]) throw new DiagError([err('Reference to undeclared module', `No module call named "${n}" is declared in ${mod.path ? mod.path : 'the root module'}.`, range)]);
        const childMod = mod.children[n];
        if (!childMod) return { val: unknown(T_DYN), used: 1 };
        const out: Record<string, Val> = {};
        for (const o of Object.keys(childMod.outputs)) out[o] = this.output(childMod, o);
        const want = attr(1);
        if (want && !(want in out)) throw new DiagError([err('Unsupported attribute', `This object does not have an attribute named "${want}".`, range)]);
        return { val: object(out), used: 1 };
      }
      case 'data': {
        const t = attr(0);
        const n = attr(1);
        const key = `data.${t}.${n}`;
        const d = mod.resources[key];
        if (!d) throw new DiagError([err('Reference to undeclared resource', `A data resource "${t}" "${n}" has not been declared in ${mod.path ? mod.path : 'the root module'}.`, range)]);
        return { val: this.resourceRef(mod, d), used: 2 };
      }
      default: {
        if (root === 'self') throw new DiagError([err('Invalid "self" reference', 'The "self" object is not available in this context. This object can be used only in resource provisioner, connection, and postcondition blocks.', range)]);
        const n = attr(0);
        const key = `${root}.${n}`;
        const d = mod.resources[key];
        if (!n) throw new DiagError([err('Invalid reference', 'A reference to a resource type must be followed by at least one attribute access, specifying the resource name.', range)]);
        if (!d) {
          if (!schemaFor('managed', root) && !Object.values(mod.resources).some((r) => r.type === root)) {
            throw new DiagError([err('Reference to undeclared resource', `A managed resource "${root}" "${n}" has not been declared in ${mod.path ? mod.path : 'the root module'}.`, range)]);
          }
          throw new DiagError([err('Reference to undeclared resource', `A managed resource "${root}" "${n}" has not been declared in ${mod.path ? mod.path : 'the root module'}.`, range)]);
        }
        return { val: this.resourceRef(mod, d), used: 1 };
      }
    }
  }

  private guard<T>(key: string, f: () => T): T {
    if (this.stack.includes(key)) throw new DiagError([err('Cycle in configuration', `OpenTofu found a cycle: ${[...this.stack.slice(this.stack.indexOf(key)), key].join(' → ')}.`)]);
    this.stack.push(key);
    try {
      return f();
    } finally {
      this.stack.pop();
    }
  }

  // ----- variables, locals, outputs ----------------------------------------

  variable(mod: Module, name: string): Val {
    if (!mod.path && this.o.failed?.has(name)) throw new SkipError(name);
    const k = `${mod.path}|var.${name}`;
    if (this.memo.has(k)) return this.memo.get(k)!;
    const decl = mod.variables[name]!;
    let v: Val;
    if (!mod.path) v = this.o.vars[name] ?? { ty: decl.type, v: null };
    else {
      // A child module's variable comes from the module call in the parent.
      const parent = this.parentOf(mod);
      const callName = mod.path.split('.').pop()!;
      const call = parent?.modules[callName];
      const a = call?.inputs[name];
      if (a && parent) v = this.guard(k, () => evalExpr(a.expr, this.scopeFor(parent)));
      else if (decl.default) v = evalExpr(decl.default, this.scopeFor(mod));
      else {
        this.diags.push(err('Missing required argument', `The argument "${name}" is required, but no definition was found.`, call?.block.openRange));
        v = { ty: decl.type, v: null };
      }
      try {
        v = convert(v, decl.type);
      } catch (e) {
        if (e instanceof ConvertError) this.diags.push(err('Invalid value for input variable', `The given value is not suitable for ${mod.path}.var.${name} declared at ${decl.range.file}:${decl.range.start.line},${decl.range.start.col}-${decl.range.end.col}: ${e.message}.`, a?.expr.range));
      }
    }
    if (decl.sensitive) v = markDeep(v);
    this.memo.set(k, v);
    return v;
  }

  private parentOf(mod: Module): Module | undefined {
    const parentPath = mod.path.split('.').slice(0, -2).join('.');
    return this.o.config.all.find((m) => m.path === parentPath);
  }

  local(mod: Module, name: string): Val {
    const k = `${mod.path}|local.${name}`;
    if (this.memo.has(k)) return this.memo.get(k)!;
    let v: Val;
    try {
      v = this.guard(k, () => evalExpr(mod.locals[name]!.expr, this.scopeFor(mod)));
    } catch (e) {
      if (!(e instanceof DiagError) || this.o.mode !== 'validate') throw e;
      this.diags.push(...e.diags);
      v = unknown(T_DYN);
    }
    this.memo.set(k, v);
    return v;
  }

  output(mod: Module, name: string): Val {
    const k = `${mod.path}|output.${name}`;
    if (this.memo.has(k)) return this.memo.get(k)!;
    const o = mod.outputs[name]!;
    let v: Val = o.expr ? this.guard(k, () => evalExpr(o.expr!, this.scopeFor(mod))) : { ty: T_DYN, v: null };
    if (o.sensitive) v = markDeep(v);
    this.memo.set(k, v);
    return v;
  }

  // ----- resources -----------------------------------------------------------

  /** The instance keys a resource expands to (count / for_each), or null for a single instance. */
  expand(mod: Module, decl: ResourceDecl): { key?: string | number; locals: Record<string, Val> }[] {
    const k = `${mod.path}|expand.${decl.key}`;
    const cached = this.expansions.get(k);
    if (cached) return cached;
    const sc = this.scopeFor(mod);
    let out: { key?: string | number; locals: Record<string, Val> }[];
    if (decl.count) {
      const v = this.guard(k, () => evalExpr(decl.count!.expr, sc));
      if (isUnknown(v)) {
        throw new DiagError([err('Invalid count argument', 'The "count" value depends on resource attributes that cannot be determined until apply, so OpenTofu cannot predict how many instances will be created. To work around this, use the -target argument to first apply only the resources that the count depends on.', decl.count.expr.range)]);
      }
      let n: number;
      try {
        n = convert(v, T_NUMBER).v as number;
      } catch {
        throw new DiagError([err('Incorrect value type', 'Invalid expression value: a number is required.', decl.count.expr.range)]);
      }
      if (v.v === null || n < 0 || !Number.isInteger(n)) throw new DiagError([err('Invalid count argument', 'The given "count" argument value is unsuitable: must be greater than or equal to zero.', decl.count.expr.range)]);
      out = Array.from({ length: n }, (_, i) => ({ key: i, locals: { 'count.index': num(i) } }));
    } else if (decl.forEach) {
      const v = this.guard(k, () => evalExpr(decl.forEach!.expr, sc));
      if (hasUnknown(v)) {
        throw new DiagError([err('Invalid for_each argument', 'The "for_each" set includes values derived from resource attributes that cannot be determined until apply, and so OpenTofu cannot determine the full set of keys that will identify the instances of this resource.\n\nWhen working with unknown values in for_each, it\'s better to use a map value where the keys are defined statically in your configuration and where only the values contain apply-time results.\n\nAlternatively, you could use the -target planning option to first apply only the resources that the for_each value depends on, and then apply a second time to fully converge.', decl.forEach.expr.range)]);
      }
      if (v.s) throw new DiagError([err('Invalid for_each argument', 'Sensitive values, or values derived from sensitive values, cannot be used as for_each arguments. If used, the sensitive value could be exposed as a resource instance key.', decl.forEach.expr.range)]);
      if (v.ty.k === 'set') {
        const items = v.v as Val[];
        if (items.some((x) => typeof x.v !== 'string')) throw new DiagError([err('Invalid for_each set argument', 'The given "for_each" argument value is unsuitable: "for_each" supports sets of strings, but you have provided a set containing type number.', decl.forEach.expr.range)]);
        out = items.map((x) => ({ key: x.v as string, locals: { 'each.key': x, 'each.value': x } }));
      } else if (isMapLike(v)) {
        out = Object.keys(v.v as object)
          .sort()
          .map((key) => ({ key, locals: { 'each.key': str(key), 'each.value': (v.v as Record<string, Val>)[key]! } }));
      } else {
        const what = v.ty.k === 'tuple' || v.ty.k === 'list' ? 'tuple' : v.ty.k;
        throw new DiagError([err('Invalid for_each argument', `The given "for_each" argument value is unsuitable: the "for_each" argument must be a map, or set of strings, and you have provided a value of type ${what}.`, decl.forEach.expr.range)]);
      }
    } else out = [{ locals: {} }];
    this.expansions.set(k, out);
    return out;
  }
  private expansions = new Map<string, { key?: string | number; locals: Record<string, Val> }[]>();

  /** The reference value of a whole resource (planned or applied, by mode). */
  resourceRef(mod: Module, decl: ResourceDecl): Val {
    const k = `${mod.path}|res.${decl.key}`;
    if (this.memo.has(k)) return this.memo.get(k)!;
    // validate: inputs are unknown, so a counted resource is an unknown list / map.
    if (this.o.mode === 'validate' && (decl.count || decl.forEach)) return unknown(T_DYN);
    const v = this.guard(k, () => {
      const insts = this.expand(mod, decl).map((e) => ({ ...(e.key !== undefined ? { key: e.key } : {}), val: this.instanceValue(mod, decl, e.key, e.locals) }));
      return resourceValue(decl, insts);
    });
    this.memo.set(k, v);
    return v;
  }

  /** One instance's object value. */
  instanceValue(mod: Module, decl: ResourceDecl, key: string | number | undefined, locals: Record<string, Val>): Val {
    const addr = instanceAddr({ module: mod.path, mode: decl.mode, type: decl.type, name: decl.name }, key);
    const hit = this.planned.get(addr);
    if (hit) return hit;
    const rt = schemaFor(decl.mode, decl.type);
    let v: Val;
    if (!rt) v = unknown(T_DYN);
    else if (this.o.mode === 'validate') v = withSchemaMarks(rt, unknownObject(rt));
    else if (decl.mode === 'data') v = this.planData(mod, decl, rt, addr, locals);
    else v = this.planManaged(mod, decl, rt, addr, key, locals);
    this.planned.set(addr, v);
    return v;
  }

  /** Evaluate a resource block's arguments to attribute values (diagnostics on bad ones). */
  configValues(mod: Module, decl: ResourceDecl, rt: ResourceType, locals: Record<string, Val>): Record<string, Val> {
    const sc = this.scopeFor(mod, locals);
    const out: Record<string, Val> = {};
    for (const it of decl.body.items) {
      if (it.kind !== 'attr' || META.has(it.name)) continue;
      const a = rt.attrs[it.name];
      if (!a || (a.computed && !a.optional && !a.required)) continue; // reported by validate
      const v = evalExpr(it.expr, sc);
      try {
        out[it.name] = convertAttr(a, v);
      } catch (e) {
        if (e instanceof ConvertError) {
          throw new DiagError([err('Incorrect attribute value type', `Inappropriate value for attribute "${it.name}": ${e.message}.`, it.expr.range)]);
        }
        throw e;
      }
    }
    return out;
  }

  private planData(mod: Module, decl: ResourceDecl, rt: ResourceType, addr: string, locals: Record<string, Val>): Val {
    const cfg = this.configValues(mod, decl, rt, locals);
    const known = !Object.values(cfg).some(hasUnknown);
    const pendingDep = this.o.mode === 'plan' && this.dependsOnPending(mod, decl);
    if (this.o.mode === 'apply' || (known && !pendingDep)) {
      this.o.progress?.(addr, 'Reading...');
      try {
        const res = rt.readData!(cfg, this.o.files);
        this.dataRead.set(addr, res);
        this.o.progress?.(addr, `Read complete after 0s [id=${res.id?.v as string}]`);
        return withSchemaMarks(rt, fullObject(rt, res));
      } catch (e) {
        if (e instanceof ProviderError) throw new DiagError([err(e.summary, e.detail, decl.range, { address: addr, context: `data "${decl.type}" "${decl.name}"` })]);
        throw e;
      }
    }
    // Read during apply.
    const v: Record<string, Val> = {};
    for (const n of attrNames(rt)) v[n] = cfg[n] ?? unknown(rt.attrs[n]!.type);
    for (const n of attrNames(rt)) if (rt.attrs[n]!.required && cfg[n] && hasUnknown(cfg[n]!)) v[n] = unknown(rt.attrs[n]!.type);
    this.pendingData.add(addr);
    this.changes.set(addr, {
      addr,
      module: mod.path,
      mode: 'data',
      type: decl.type,
      name: decl.name,
      action: 'read',
      before: null,
      after: withSchemaMarks(rt, object(v)),
      forces: [],
      readReason: known ? 'pending' : 'unknown',
      provider: rt.provider,
      deps: [],
    });
    return withSchemaMarks(rt, object(v));
  }

  /** depends_on (direct) points at a resource with planned changes. */
  private dependsOnPending(mod: Module, decl: ResourceDecl): boolean {
    for (const e of decl.dependsOn) {
      const refs = references(e);
      for (const r of refs) {
        const name = r.steps[0]?.t === 'attr' ? r.steps[0].name : '';
        const key = r.root === 'data' ? `data.${name}.${r.steps[1]?.t === 'attr' ? r.steps[1].name : ''}` : `${r.root}.${name}`;
        const d = mod.resources[key];
        if (!d) continue;
        this.resourceRef(mod, d);
        for (const [a, c] of this.changes) {
          if (a.startsWith(instanceAddr({ module: mod.path, mode: d.mode, type: d.type, name: d.name })) && c.action !== 'noop') return true;
        }
      }
    }
    return false;
  }

  private planManaged(mod: Module, decl: ResourceDecl, rt: ResourceType, addr: string, key: string | number | undefined, locals: Record<string, Val>): Val {
    const prior = this.priorOf(addr);
    if (this.o.mode === 'apply') {
      // Apply mode: references see the applied object (the apply loop stores it in `planned`).
      return prior ? withSchemaMarks(rt, object(prior.attrs)) : unknownObject(rt);
    }
    const cfg = this.configValues(mod, decl, rt, locals);
    let c = planInstance(rt, decl, cfg, prior ? prior.attrs : null);
    const requested = Boolean(prior && this.o.replace?.includes(addr) && c.action !== 'replace');
    if (requested) {
      const fresh = planInstance(rt, decl, cfg, null);
      c = { action: 'replace', planned: fresh.planned, forces: [] };
    }
    const before = prior ? withSchemaMarks(rt, object(prior.attrs), prior.sensitive) : null;
    const after = withSchemaMarks(rt, object(c.planned));
    this.changes.set(addr, {
      addr,
      module: mod.path,
      mode: 'managed',
      type: decl.type,
      name: decl.name,
      ...(key !== undefined ? { key } : {}),
      action: c.action,
      ...(c.action === 'replace' && decl.lifecycle.createBeforeDestroy ? { cbd: true } : {}),
      ...(requested ? { requested: true } : {}),
      before,
      after,
      forces: c.forces,
      provider: rt.provider,
      deps: [],
    });
    return after;
  }

  priorOf(addr: string): StateInstance | null {
    for (const x of listInstances(this.o.state)) if (x.addr === addr) return x.inst;
    return null;
  }

  // ----- dependencies --------------------------------------------------------

  /** Config-level resource addresses a resource depends on (transitively), for the state file. */
  resourceDeps(mod: Module, decl: ResourceDecl): string[] {
    const out = new Set<string>();
    const seen = new Set<string>();
    const visitExpr = (m: Module, e: Expr | undefined, bound?: Set<string>) => {
      for (const r of references(e, bound)) visitRef(m, r.root, r.steps);
    };
    const visitBody = (m: Module, d: ResourceDecl) => {
      for (const it of d.body.items) {
        if (it.kind === 'attr' && it.name !== 'depends_on') visitExpr(m, it.expr);
        if (it.kind === 'block' && it.type !== 'lifecycle') for (const a of it.body.items) if (a.kind === 'attr') visitExpr(m, a.expr);
      }
      for (const e of d.dependsOn) visitExpr(m, e);
    };
    const visitRef = (m: Module, root: string, steps: Step[]) => {
      const a0 = steps[0]?.t === 'attr' ? steps[0].name : '';
      const a1 = steps[1]?.t === 'attr' ? steps[1].name : '';
      const key = `${m.path}|${root}.${a0}${root === 'data' ? `.${a1}` : ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (root === 'var') {
        if (m.path) {
          const parent = this.parentOf(m);
          const call = parent?.modules[m.path.split('.').pop()!];
          if (parent && call?.inputs[a0]) visitExpr(parent, call.inputs[a0]!.expr);
        }
        return;
      }
      if (root === 'local') {
        if (m.locals[a0]) visitExpr(m, m.locals[a0]!.expr);
        return;
      }
      if (root === 'module') {
        const c = m.children[a0];
        if (!c) return;
        const outs = a1 && c.outputs[a1] ? [c.outputs[a1]!] : Object.values(c.outputs);
        for (const o of outs) {
          visitExpr(c, o.expr);
          for (const e of o.dependsOn) visitExpr(c, e);
        }
        return;
      }
      if (['path', 'count', 'each', 'terraform', 'self'].includes(root)) return;
      const rkey = root === 'data' ? `data.${a0}.${a1}` : `${root}.${a0}`;
      const d = m.resources[rkey];
      if (!d) return;
      out.add(instanceAddr({ module: m.path, mode: d.mode, type: d.type, name: d.name }));
      visitBody(m, d);
    };
    visitBody(mod, decl);
    out.delete(instanceAddr({ module: mod.path, mode: decl.mode, type: decl.type, name: decl.name }));
    return [...out].sort();
  }
}

// ---------------------------------------------------------------------------
// Instance planning (shared by plan and apply)

export interface InstancePlan {
  action: 'create' | 'update' | 'replace' | 'noop';
  planned: Record<string, Val>;
  forces: string[];
}

export function planInstance(rt: ResourceType, decl: ResourceDecl, cfg: Record<string, Val>, prior: Record<string, Val> | null): InstancePlan {
  const planned: Record<string, Val> = {};
  const names = attrNames(rt);
  for (const n of names) {
    const a = rt.attrs[n]!;
    const c = cfg[n];
    if (c && c.v !== null) planned[n] = c;
    else if (a.def && a.optional) planned[n] = a.def;
    else if (a.computed && !a.optional) planned[n] = prior?.[n] ?? unknown(a.type);
    else if (a.computed && a.optional) planned[n] = prior?.[n] ?? unknown(a.type);
    else planned[n] = { ty: a.type, v: null };
  }
  // lifecycle.ignore_changes keeps the prior value.
  if (prior) {
    const ignore = decl.lifecycle.ignoreChanges;
    for (const n of names) {
      if (ignore === 'all' ? !rt.attrs[n]!.computed || rt.attrs[n]!.optional : ignore.includes(n)) {
        if (rt.attrs[n]!.optional || rt.attrs[n]!.required) planned[n] = prior[n] ?? planned[n]!;
      }
    }
  }
  const forces: string[] = [];
  if (prior) {
    for (const n of names) {
      const a = rt.attrs[n]!;
      if (!a.forceNew) continue;
      const p = prior[n] ?? { ty: a.type, v: null };
      if (hasUnknown(planned[n]!) || !valEq(unmarkVal(planned[n]!), unmarkVal(p))) forces.push(n);
    }
  }
  const replace = forces.length > 0;
  const shown = forces.filter((n) => !rt.attrs[n]!.quietForce);
  if (!prior || replace) {
    for (const n of names) {
      const a = rt.attrs[n]!;
      if (a.computed && !(n in cfg && cfg[n]!.v !== null) && !(a.def && a.optional)) planned[n] = unknown(a.type);
    }
  }
  rt.planExtra?.(planned, prior, replace);
  if (!prior) return { action: 'create', planned, forces };
  if (replace) return { action: 'replace', planned, forces: shown };
  const same = names.every((n) => valEq(unmarkVal(planned[n]!), unmarkVal(prior[n] ?? { ty: T_DYN, v: null })) && !hasUnknown(planned[n]!));
  return { action: same ? 'noop' : 'update', planned: same ? { ...prior } : planned, forces };
}

function unmarkVal(v: Val): Val {
  return { ty: v.ty, v: v.v };
}

/** Mark every value inside as sensitive. */
export function markDeep(v: Val): Val {
  const out: Val = { ...v, s: true };
  if (Array.isArray(v.v)) out.v = v.v.map(markDeep);
  else if (isMapLike(v)) out.v = Object.fromEntries(Object.entries(v.v as Record<string, Val>).map(([k, x]) => [k, markDeep(x)]));
  return out;
}

/** An object with every schema attribute unknown (validate mode, unknown resources). */
export function unknownObject(rt: ResourceType): Val {
  return object(Object.fromEntries(attrNames(rt).map((n) => [n, unknown(rt.attrs[n]!.type)])));
}

/** Fill missing schema attributes with typed nulls. */
export function fullObject(rt: ResourceType, attrs: Record<string, Val>): Val {
  return object(Object.fromEntries(attrNames(rt).map((n) => [n, attrs[n] ?? { ty: rt.attrs[n]!.type, v: null }])));
}

/** Apply the schema's sensitive attributes (and extra paths from the state) as marks. */
export function withSchemaMarks(rt: ResourceType, v: Val, extra: SensPath[] = []): Val {
  if (!isMapLike(v)) return v;
  let attrs = { ...(v.v as Record<string, Val>) };
  for (const n of Object.keys(attrs)) if (rt.attrs[n]?.sensitive) attrs[n] = markDeep(attrs[n]!);
  for (const p of extra) attrs = markPath(attrs, p);
  return { ...v, v: attrs };
}

function markPath(attrs: Record<string, Val>, path: SensPath): Record<string, Val> {
  const [head, ...rest] = path;
  const cur = attrs[String(head)];
  if (!cur) return attrs;
  const mark = (v: Val, p: SensPath): Val => {
    if (!p.length) return markDeep(v);
    const [k, ...more] = p;
    if (Array.isArray(v.v) && typeof k === 'number' && v.v[k]) return { ...v, v: v.v.map((x, i) => (i === k ? mark(x, more) : x)) };
    if (isMapLike(v) && (v.v as Record<string, Val>)[String(k)]) return { ...v, v: { ...(v.v as Record<string, Val>), [String(k)]: mark((v.v as Record<string, Val>)[String(k)]!, more) } };
    return v;
  };
  return { ...attrs, [String(head)]: mark(cur, rest) };
}

/** Paths of sensitive values inside attributes (the schema's own sensitive attributes left out). */
export function sensPathsOf(rt: ResourceType, attrs: Record<string, Val>): SensPath[] {
  const out: SensPath[] = [];
  const walk = (v: Val, p: SensPath) => {
    if (v.s) {
      out.push(p);
      return;
    }
    if (Array.isArray(v.v)) v.v.forEach((x, i) => walk(x, [...p, i]));
    else if (isMapLike(v)) for (const [k, x] of Object.entries(v.v as Record<string, Val>)) walk(x, [...p, k]);
  };
  for (const [n, v] of Object.entries(attrs)) if (!rt.attrs[n]?.sensitive) walk(v, [n]);
  return out;
}

export function undeclaredVar(n: string, range: Range): Diag {
  return err('Reference to undeclared input variable', `An input variable with the name "${n}" has not been declared. This variable can be declared with a variable "${n}" {} block.`, range);
}

function suggestTail(name: string, options: string[]): string {
  const s = suggest(name, options);
  return s ? ` Did you mean "${s}"?` : '';
}

export function normPath(p: string): string {
  let x = p.replace(/^\.\//, '');
  x = x.replace(/\/\.\//g, '/');
  return x;
}

// ---------------------------------------------------------------------------
// Static checks for `validate` (and every plan): arguments, references, types.

/** Decode errors for a resource body: unknown blocks/arguments, computed-only ones, missing required ones. */
function decodeErrors(decl: ResourceDecl, rt: ResourceType): Diag[] {
  const diags: Diag[] = [];
  const seen = new Set<string>();
  for (const it of decl.body.items) {
    if (it.kind === 'block') {
      if (it.type !== 'lifecycle') diags.push(err('Unsupported block type', `Blocks of type "${it.type}" are not expected here.`, it.typeRange));
      continue;
    }
    seen.add(it.name);
    if (META.has(it.name)) continue;
    const a = rt.attrs[it.name];
    if (!a) {
      const s = suggest(it.name, Object.keys(rt.attrs).filter((n) => rt.attrs[n]!.optional || rt.attrs[n]!.required));
      diags.push(err('Unsupported argument', `An argument named "${it.name}" is not expected here.${s ? ` Did you mean "${s}"?` : ''}`, it.nameRange));
    } else if (a.computed && !a.optional && !a.required) {
      diags.push(err('Invalid or unknown key', `The argument "${it.name}" can't be set: its value is decided automatically.`, it.nameRange));
    }
  }
  for (const [n, a] of Object.entries(rt.attrs)) {
    if (a.required && !seen.has(n)) diags.push(err('Missing required argument', `The argument "${n}" is required, but no definition was found.`, decl.block.openRange));
  }
  return diags;
}

/**
 * What `tofu validate` (and the validate step of every plan) reports, in source order: for each
 * resource, reference errors first (they stop that block's other checks), then argument errors,
 * then value type errors; locals, outputs and module inputs are evaluated with every input
 * unknown; a root output holding sensitive data must say `sensitive = true`.
 */
export function validateConfig(config: Config, vars: Record<string, Val>, files: FileCtx): Diag[] {
  const diags: Diag[] = [];
  const w = new Walker({ mode: 'validate', config, vars, state: { serial: 0, lineage: '', outputs: {}, resources: [], checks: null }, files });
  const refErrs = (mod: Module, exprs: (Expr | undefined)[], allow: { count?: boolean; each?: boolean } = {}) => {
    const out: Diag[] = [];
    for (const e of exprs) for (const r of references(e)) out.push(...checkRef(mod, r.root, r.steps, r.range, allow));
    return out;
  };
  const tryEval = (f: () => void) => {
    try {
      f();
    } catch (e) {
      if (e instanceof DiagError) diags.push(...e.diags);
      else throw e;
    }
  };
  for (const mod of config.all) {
    for (const decl of Object.values(mod.resources)) {
      const allow = { count: Boolean(decl.count), each: Boolean(decl.forEach) };
      const exprs = decl.body.items.filter((it) => it.kind === 'attr' && it.name !== 'depends_on' && it.name !== 'count' && it.name !== 'for_each').map((it) => (it as { expr: Expr }).expr);
      const re = [...refErrs(mod, [decl.count?.expr, decl.forEach?.expr]), ...refErrs(mod, exprs, allow), ...refErrs(mod, decl.dependsOn)];
      if (re.length) {
        diags.push(...re);
        continue;
      }
      const rt = schemaFor(decl.mode, decl.type);
      if (!rt) {
        diags.push(err('Invalid resource type', `The provider ${providerName(decl.type)} does not support ${decl.mode === 'data' ? 'data source' : 'resource type'} "${decl.type}".`, decl.block.labelRanges[0]));
        continue;
      }
      const de = decodeErrors(decl, rt);
      if (de.length) {
        diags.push(...de);
        continue;
      }
      const locals: Record<string, Val> = decl.count ? { 'count.index': unknown(T_NUMBER) } : decl.forEach ? { 'each.key': unknown(T_STRING), 'each.value': unknown(T_DYN) } : {};
      tryEval(() => w.configValues(mod, decl, rt, locals));
    }
    for (const [name, l] of Object.entries(mod.locals)) {
      const re = refErrs(mod, [l.expr]);
      if (re.length) diags.push(...re);
      else tryEval(() => w.local(mod, name));
    }
    for (const call of Object.values(mod.modules)) {
      for (const a of Object.values(call.inputs)) {
        const re = refErrs(mod, [a.expr]);
        if (re.length) diags.push(...re);
      }
      const c = mod.children[call.name];
      if (!c) continue;
      for (const [n, a] of Object.entries(call.inputs)) if (!c.variables[n]) diags.push(err('Unsupported argument', `An argument named "${n}" is not expected here.`, a.nameRange));
      for (const v of Object.values(c.variables)) if (!v.default && !call.inputs[v.name]) diags.push(err('Missing required argument', `The argument "${v.name}" is required, but no definition was found.`, call.block.openRange));
    }
    for (const [name, o] of Object.entries(mod.outputs)) {
      const re = refErrs(mod, [o.expr, ...o.dependsOn]);
      if (re.length) {
        diags.push(...re);
        continue;
      }
      tryEval(() => {
        const v = w.output(mod, name);
        if (!mod.path && !o.sensitive && hasSensitive(v)) {
          diags.push(err('Output refers to sensitive values', 'To reduce the risk of accidentally exporting sensitive data that was intended\nto be only internal, OpenTofu requires that any root module output containing\nsensitive data be explicitly marked as sensitive, to confirm your intent.\n\nIf you do intend to export this data, annotate the output value as sensitive\nby adding the following argument:\n    sensitive = true', o.range));
        }
      });
    }
  }
  diags.push(...w.diags);
  // One diagnostic per place (a local's error is reported once, not by each reader).
  const seen = new Set<string>();
  return diags
    .filter((d) => {
      const k = `${d.summary}|${d.subject?.file}:${d.subject?.start.byte}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => cmpDiag(a, b));
}

function cmpDiag(a: Diag, b: Diag): number {
  if (!a.subject || !b.subject) return 0;
  if (a.subject.file !== b.subject.file) return a.subject.file < b.subject.file ? -1 : 1;
  return a.subject.start.byte - b.subject.start.byte;
}

function providerName(type: string): string {
  const p = providerOf(type);
  return PROVIDERS[p] ? (p === 'terraform' ? 'terraform.io/builtin/terraform' : `registry.opentofu.org/hashicorp/${p}`) : `registry.opentofu.org/hashicorp/${p}`;
}

function checkRef(mod: Module, root: string, steps: Step[], range: Range, allow: { count?: boolean; each?: boolean }): Diag[] {
  const a0 = steps[0]?.t === 'attr' ? steps[0].name : null;
  const a1 = steps[1]?.t === 'attr' ? steps[1].name : null;
  const where = mod.path ? mod.path : 'the root module';
  switch (root) {
    case 'var':
      return a0 && mod.variables[a0] ? [] : [undeclaredVar(a0 ?? '', range)];
    case 'local':
      return a0 && mod.locals[a0] ? [] : [err('Reference to undeclared local value', `A local value with the name "${a0}" has not been declared.${suggestTail(a0 ?? '', Object.keys(mod.locals))}`, range)];
    case 'module': {
      if (!a0 || !mod.modules[a0]) return [err('Reference to undeclared module', `No module call named "${a0}" is declared in ${where}.`, range)];
      const c = mod.children[a0];
      if (c && a1 && !c.outputs[a1]) return [err('Unsupported attribute', `This object does not have an attribute named "${a1}".`, range)];
      return [];
    }
    case 'count':
      return allow.count ? [] : [err('Reference to "count" in non-counted context', 'The "count" object can only be used in "module", "resource", and "data" blocks, and only when the "count" argument is set.', range)];
    case 'each':
      return allow.each ? [] : [err('Reference to "each" in context without for_each', 'The "each" object can be used only in "module" or "resource" blocks, and only when the "for_each" argument is set.', range)];
    case 'path':
    case 'terraform':
    case 'tofu':
    case 'self':
      return [];
    case 'data': {
      const d = mod.resources[`data.${a0}.${a1}`];
      if (!d) return [err('Reference to undeclared resource', `There is no data resource "${a0}" "${a1}" definition in ${where}.`, range)];
      return attrCheck(d, steps.slice(2), range);
    }
    default: {
      if (!a0) return [];
      const d = mod.resources[`${root}.${a0}`];
      if (!d) return [err('Reference to undeclared resource', `There is no managed resource "${root}" "${a0}" definition in ${where}.`, range)];
      return attrCheck(d, steps.slice(1), range);
    }
  }
}

/** `random_pet.stall.idd` → Unsupported attribute; `random_pet.stall.id` with count → missing key. */
function attrCheck(d: ResourceDecl, rest: Step[], range: Range): Diag[] {
  const rt = schemaFor(d.mode, d.type);
  if (!rt) return [];
  let steps = rest;
  if (d.count || d.forEach) {
    if (steps[0]?.t === 'attr' && !(d.forEach && false)) {
      const addr = `${d.mode === 'data' ? 'data.' : ''}${d.type}.${d.name}`;
      return [
        err(
          'Missing resource instance key',
          d.count
            ? `Because ${addr} has "count" set, its attributes must be accessed on specific instances.\n\nFor example, to correlate with indices of a referring resource, use:\n    ${addr}[count.index]`
            : `Because ${addr} has "for_each" set, its attributes must be accessed on specific instances.\n\nFor example, to correlate with indices of a referring resource, use:\n    ${addr}[each.key]`,
          range,
        ),
      ];
    }
    steps = steps.slice(1);
  }
  const s0 = steps[0];
  if (s0?.t === 'attr' && !rt.attrs[s0.name]) {
    const s = suggest(s0.name, Object.keys(rt.attrs));
    return [err('Unsupported attribute', `This object has no argument, nested block, or exported attribute named "${s0.name}".${s ? ` Did you mean "${s}"?` : ''}`, s0.range)];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Root variables: tfvars files, -var, -var-file, TF_VAR_ environment

export interface VarInput {
  /** Raw values in order of precedence (later wins). */
  sources: { name: string; raw: string | Expr; from: 'env' | 'file' | 'cli'; range?: Range }[];
}

export function rootVarValue(decl: { type: import('./values').Ty }, raw: string | Expr, scope: Scope): Val {
  if (typeof raw === 'string') {
    if (decl.type.k === 'string' || decl.type.k === 'number' || decl.type.k === 'bool' || decl.type.k === 'dynamic') {
      return convert(str(raw), decl.type.k === 'dynamic' ? T_STRING : decl.type);
    }
    return raw as unknown as Val;
  }
  return convert(evalExpr(raw, scope), decl.type);
}

export { child, traverse, warn, keyOf, hasSensitive };
export type { Change, OutputChange, CheckResult, StateResource };
