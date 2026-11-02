// Configuration loading: the root module's .tf files and local child modules (source = "./x"),
// turned into declarations (variables, locals, outputs, resources, data sources, module calls,
// moved and import blocks), with OpenTofu's load-time diagnostics.
import { err, type Diag } from './diag';
import { attrOf, attrsOf, blocksOf, HclError, parseFile, traversalOf, type Attribute, type Block, type Body, type Expr, type Range } from './hcl';
import { primitive } from './convert';
import { T_DYN, type Ty, type Val } from './values';

export interface Validation {
  condition: Expr;
  message: Expr;
  range: Range;
}

export interface VariableDecl {
  name: string;
  type: Ty;
  typeGiven: boolean;
  default?: Expr;
  description?: string;
  sensitive: boolean;
  nullable: boolean;
  validations: Validation[];
  range: Range;
}

export interface OutputDecl {
  name: string;
  expr?: Expr;
  sensitive: boolean;
  description?: string;
  dependsOn: Expr[];
  range: Range;
}

export interface Lifecycle {
  createBeforeDestroy: boolean;
  preventDestroy: boolean;
  ignoreChanges: string[] | 'all';
  replaceTriggeredBy: Expr[];
}

export interface ResourceDecl {
  mode: 'managed' | 'data';
  type: string;
  name: string;
  /** "random_pet.stall" or "data.local_file.recipe". */
  key: string;
  body: Body;
  block: Block;
  count?: Attribute;
  forEach?: Attribute;
  dependsOn: Expr[];
  lifecycle: Lifecycle;
  range: Range;
}

export interface ModuleCall {
  name: string;
  source: string;
  sourceRange: Range;
  inputs: Record<string, Attribute>;
  dependsOn: Expr[];
  block: Block;
  range: Range;
}

export interface MovedDecl {
  from: string;
  to: string;
  range: Range;
}

export interface ImportDecl {
  to: string;
  toExpr: Expr;
  id: Expr;
  range: Range;
}

export interface Module {
  /** "" for the root, "module.kiosk" for a child (no instance keys: child modules have no count here). */
  path: string;
  /** Folder relative to the project ("." or "modules/kiosk"). */
  dir: string;
  variables: Record<string, VariableDecl>;
  locals: Record<string, Attribute>;
  outputs: Record<string, OutputDecl>;
  resources: Record<string, ResourceDecl>;
  modules: Record<string, ModuleCall>;
  moved: MovedDecl[];
  imports: ImportDecl[];
  requiredProviders: Record<string, { source: string; version?: string }>;
  backend?: { type: string; attrs: Record<string, Attribute>; range: Range };
  children: Record<string, Module>;
  /** Files of this module (relative to the project), for snippets. */
  fileNames: string[];
}

export interface Config {
  root: Module;
  /** Every module, root first. */
  all: Module[];
  sources: Record<string, string>;
}

const TOP_BLOCKS = new Set(['terraform', 'provider', 'variable', 'output', 'locals', 'resource', 'data', 'module', 'moved', 'import', 'check', 'removed']);

/** Parse a type constraint (`list(string)`, `object({ a = string })`). */
export function parseType(e: Expr, diags: Diag[]): Ty {
  const bad = (): Ty => {
    diags.push(err('Invalid type specification', 'A type specification is either a primitive type keyword (bool, number, string) or a complex type constructor call, like list(string).', e.range));
    return T_DYN;
  };
  if (e.k === 'var') return primitive(e.name) ?? bad();
  if (e.k === 'tmpl' && e.parts.length === 1 && typeof e.parts[0] === 'string') return primitive(e.parts[0]) ?? bad();
  if (e.k === 'call') {
    const [a] = e.args;
    if (['list', 'set', 'map'].includes(e.name) && a) return { k: e.name as 'list', e: parseType(a, diags) };
    if (e.name === 'tuple' && a?.k === 'tuple') return { k: 'tuple', es: a.items.map((x) => parseType(x, diags)) };
    if (e.name === 'object' && a?.k === 'object') {
      const as: Record<string, Ty> = {};
      const opt: string[] = [];
      for (const it of a.items) {
        const name = it.key.k === 'lit' ? String(it.key.v) : it.key.k === 'var' ? it.key.name : '';
        if (it.value.k === 'call' && it.value.name === 'optional' && it.value.args[0]) {
          as[name] = parseType(it.value.args[0], diags);
          opt.push(name);
        } else as[name] = parseType(it.value, diags);
      }
      return { k: 'object', as, ...(opt.length ? { opt } : {}) };
    }
  }
  return bad();
}

/** A static string (a literal or a template without interpolation). */
export function staticString(e: Expr | undefined): string | null {
  if (!e) return null;
  if (e.k === 'tmpl' && e.parts.every((p) => typeof p === 'string')) return e.parts.join('');
  if (e.k === 'lit' && typeof e.v === 'string') return e.v;
  return null;
}

function staticBool(e: Expr | undefined): boolean | null {
  if (!e) return null;
  if (e.k === 'lit' && typeof e.v === 'boolean') return e.v;
  return null;
}

/** An address written as a traversal (`random_pet.old`, `module.kiosk`) → text. */
export function addrText(e: Expr): string | null {
  const t = traversalOf(e);
  if (!t) return null;
  let out = t.root;
  for (const s of t.steps) {
    if (s.t === 'attr') out += `.${s.name}`;
    else if (s.t === 'index' && s.key.k === 'lit') out += typeof s.key.v === 'string' ? `["${s.key.v}"]` : `[${String(s.key.v)}]`;
    else if (s.t === 'index' && s.key.k === 'tmpl' && s.key.parts.every((p) => typeof p === 'string')) out += `["${s.key.parts.join('')}"]`;
    else return null;
  }
  return out;
}

function lifecycleOf(b: Block | undefined, diags: Diag[]): Lifecycle {
  const lc: Lifecycle = { createBeforeDestroy: false, preventDestroy: false, ignoreChanges: [], replaceTriggeredBy: [] };
  if (!b) return lc;
  for (const a of attrsOf(b.body)) {
    if (a.name === 'create_before_destroy') lc.createBeforeDestroy = staticBool(a.expr) ?? false;
    else if (a.name === 'prevent_destroy') lc.preventDestroy = staticBool(a.expr) ?? false;
    else if (a.name === 'ignore_changes') {
      if (a.expr.k === 'var' && a.expr.name === 'all') lc.ignoreChanges = 'all';
      else if (a.expr.k === 'tuple') lc.ignoreChanges = a.expr.items.map((x) => addrText(x) ?? '').filter(Boolean);
    } else if (a.name === 'replace_triggered_by') {
      if (a.expr.k === 'tuple') lc.replaceTriggeredBy = a.expr.items;
    } else diags.push(err('Unsupported argument', `An argument named "${a.name}" is not expected here.`, a.nameRange));
  }
  return lc;
}

function listExprs(a: Attribute | undefined): Expr[] {
  if (!a) return [];
  return a.expr.k === 'tuple' ? a.expr.items : [a.expr];
}

function loadModule(path: string, dir: string, files: Record<string, string>, diags: Diag[], sources: Record<string, string>, depth: number): Module {
  const mod: Module = { path, dir, variables: {}, locals: {}, outputs: {}, resources: {}, modules: {}, moved: [], imports: [], requiredProviders: {}, children: {}, fileNames: [] };
  const prefix = dir === '.' ? '' : `${dir}/`;
  const names = Object.keys(files)
    .filter((f) => f.startsWith(prefix) && !f.slice(prefix.length).includes('/') && f.endsWith('.tf'))
    .sort();
  mod.fileNames = names;
  for (const f of names) {
    sources[f] = files[f]!;
    let body: Body;
    try {
      body = parseFile(files[f]!, f);
    } catch (e) {
      if (e instanceof HclError) {
        diags.push(err(e.summary, e.detail, e.range));
        continue;
      }
      throw e;
    }
    for (const it of body.items) {
      if (it.kind === 'attr') {
        diags.push(err('Unsupported argument', `An argument named "${it.name}" is not expected here.`, it.nameRange));
        continue;
      }
      const b = it;
      if (!TOP_BLOCKS.has(b.type)) {
        diags.push(err('Unsupported block type', `Blocks of type "${b.type}" are not expected here.`, b.typeRange));
        continue;
      }
      const want: Record<string, number> = { terraform: 0, provider: 1, variable: 1, output: 1, locals: 0, resource: 2, data: 2, module: 1, moved: 0, import: 0, check: 1, removed: 0 };
      if (b.labels.length !== want[b.type]) {
        const needed = want[b.type]!;
        const label = b.type === 'resource' || b.type === 'data' ? 'name' : 'name';
        diags.push(
          b.labels.length < needed
            ? err('Missing name for ' + b.type, `All ${b.type} blocks must have ${needed} labels (${b.type === 'resource' || b.type === 'data' ? 'type, name' : label}).`, b.openRange)
            : err('Extraneous label for ' + b.type, `Only ${needed} labels (${b.type === 'resource' || b.type === 'data' ? 'type, name' : label}) are expected for ${b.type} blocks.`, b.labelRanges[needed] ?? b.openRange),
        );
        continue;
      }
      switch (b.type) {
        case 'terraform':
          for (const inner of blocksOf(b.body)) {
            if (inner.type === 'required_providers') {
              for (const a of attrsOf(inner.body)) {
                if (a.expr.k === 'object') {
                  const src = a.expr.items.find((x) => x.key.k === 'lit' && x.key.v === 'source');
                  const ver = a.expr.items.find((x) => x.key.k === 'lit' && x.key.v === 'version');
                  const source = staticString(src?.value) ?? `hashicorp/${a.name}`;
                  const version = staticString(ver?.value);
                  mod.requiredProviders[a.name] = version !== null ? { source, version } : { source };
                } else {
                  const v = staticString(a.expr);
                  mod.requiredProviders[a.name] = v !== null ? { source: `hashicorp/${a.name}`, version: v } : { source: `hashicorp/${a.name}` };
                }
              }
            } else if (inner.type === 'backend') {
              mod.backend = { type: inner.labels[0] ?? '', attrs: Object.fromEntries(attrsOf(inner.body).map((a) => [a.name, a])), range: inner.defRange };
            }
          }
          break;
        case 'provider':
          break;
        case 'variable': {
          const name = b.labels[0]!;
          if (mod.variables[name]) {
            diags.push(err('Duplicate variable declaration', `A variable named "${name}" was already declared at ${mod.variables[name]!.range.file}:${mod.variables[name]!.range.start.line},${mod.variables[name]!.range.start.col}-${mod.variables[name]!.range.end.col}. Variable names must be unique within a module.`, b.defRange));
            break;
          }
          const typeA = attrOf(b.body, 'type');
          const v: VariableDecl = {
            name,
            type: typeA ? parseType(typeA.expr, diags) : T_DYN,
            typeGiven: Boolean(typeA),
            sensitive: staticBool(attrOf(b.body, 'sensitive')?.expr) ?? false,
            nullable: staticBool(attrOf(b.body, 'nullable')?.expr) ?? true,
            validations: blocksOf(b.body, 'validation').map((vb) => ({ condition: attrOf(vb.body, 'condition')!.expr, message: attrOf(vb.body, 'error_message')!.expr, range: vb.typeRange })),
            range: b.defRange,
          };
          const def = attrOf(b.body, 'default');
          if (def) v.default = def.expr;
          const desc = staticString(attrOf(b.body, 'description')?.expr);
          if (desc !== null) v.description = desc;
          for (const a of attrsOf(b.body)) {
            if (!['type', 'default', 'description', 'sensitive', 'nullable', 'ephemeral'].includes(a.name)) diags.push(err('Unsupported argument', `An argument named "${a.name}" is not expected here.`, a.nameRange));
          }
          mod.variables[name] = v;
          break;
        }
        case 'output': {
          const name = b.labels[0]!;
          const value = attrOf(b.body, 'value');
          const o: OutputDecl = { name, sensitive: staticBool(attrOf(b.body, 'sensitive')?.expr) ?? false, dependsOn: listExprs(attrOf(b.body, 'depends_on')), range: b.defRange };
          if (value) o.expr = value.expr;
          else diags.push(err('Missing required argument', 'The argument "value" is required, but no definition was found.', b.openRange));
          const desc = staticString(attrOf(b.body, 'description')?.expr);
          if (desc !== null) o.description = desc;
          if (mod.outputs[name]) diags.push(err('Duplicate output definition', `An output named "${name}" was already defined at ${mod.outputs[name]!.range.file}:${mod.outputs[name]!.range.start.line},${mod.outputs[name]!.range.start.col}-${mod.outputs[name]!.range.end.col}. Output names must be unique within a module.`, b.defRange));
          else mod.outputs[name] = o;
          break;
        }
        case 'locals':
          for (const a of attrsOf(b.body)) {
            if (mod.locals[a.name]) diags.push(err('Duplicate local value definition', `A local value named "${a.name}" was already defined at ${mod.locals[a.name]!.range.file}:${mod.locals[a.name]!.range.start.line},${mod.locals[a.name]!.range.start.col}-${mod.locals[a.name]!.range.end.col}. Local value names must be unique within a module.`, a.range));
            else mod.locals[a.name] = a;
          }
          break;
        case 'resource':
        case 'data': {
          const [type, name] = b.labels as [string, string];
          const mode = b.type === 'resource' ? 'managed' : 'data';
          const key = mode === 'data' ? `data.${type}.${name}` : `${type}.${name}`;
          if (mod.resources[key]) {
            const prev = mod.resources[key]!.range;
            diags.push(err(`Duplicate ${mode === 'data' ? 'data' : 'resource'} "${type}" configuration`, `A ${mode === 'data' ? 'data' : 'resource'} "${type}" "${name}" was already declared at ${prev.file}:${prev.start.line},${prev.start.col}-${prev.end.col}. ${mode === 'data' ? 'Data' : 'Resource'} names must be unique per type in each module.`, b.defRange));
            break;
          }
          const count = attrOf(b.body, 'count');
          const forEach = attrOf(b.body, 'for_each');
          if (count && forEach) diags.push(err('Invalid combination of "count" and "for_each"', 'The "count" and "for_each" meta-arguments are mutually-exclusive, only one should be used to be explicit about the number of resources to be created.', forEach.nameRange));
          const r: ResourceDecl = { mode, type, name, key, body: b.body, block: b, dependsOn: listExprs(attrOf(b.body, 'depends_on')), lifecycle: lifecycleOf(blocksOf(b.body, 'lifecycle')[0], diags), range: b.defRange };
          if (count) r.count = count;
          if (forEach) r.forEach = forEach;
          mod.resources[key] = r;
          break;
        }
        case 'module': {
          const name = b.labels[0]!;
          const src = attrOf(b.body, 'source');
          const source = staticString(src?.expr);
          if (!src || source === null) {
            diags.push(err('Missing required argument', 'The argument "source" is required, but no definition was found.', b.openRange));
            break;
          }
          const inputs: Record<string, Attribute> = {};
          for (const a of attrsOf(b.body)) if (!['source', 'version', 'depends_on', 'providers', 'count', 'for_each'].includes(a.name)) inputs[a.name] = a;
          mod.modules[name] = { name, source, sourceRange: src.expr.range, inputs, dependsOn: listExprs(attrOf(b.body, 'depends_on')), block: b, range: b.defRange };
          break;
        }
        case 'moved': {
          const from = attrOf(b.body, 'from');
          const to = attrOf(b.body, 'to');
          const f = from ? addrText(from.expr) : null;
          const t = to ? addrText(to.expr) : null;
          if (!from || !to || !f || !t) diags.push(err('Invalid "moved" block', 'A moved block needs "from" and "to" resource addresses.', b.defRange));
          else mod.moved.push({ from: f, to: t, range: b.defRange });
          break;
        }
        case 'import': {
          const to = attrOf(b.body, 'to');
          const id = attrOf(b.body, 'id');
          const t = to ? addrText(to.expr) : null;
          if (!to || !id || !t) diags.push(err('Invalid import block', 'An import block needs a "to" address and an "id".', b.defRange));
          else mod.imports.push({ to: t, toExpr: to.expr, id: id.expr, range: b.defRange });
          break;
        }
        default:
          break;
      }
    }
  }
  // Local child modules.
  if (depth < 4) {
    for (const call of Object.values(mod.modules)) {
      if (!/^\.\.?\//.test(call.source)) continue;
      const childDir = normalizeDir(dir, call.source);
      const childPath = `${path ? `${path}.` : ''}module.${call.name}`;
      mod.children[call.name] = loadModule(childPath, childDir, files, diags, sources, depth + 1);
    }
  }
  return mod;
}

export function normalizeDir(base: string, rel: string): string {
  const parts = base === '.' ? [] : base.split('/');
  for (const p of rel.split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') parts.pop();
    else parts.push(p);
  }
  return parts.length ? parts.join('/') : '.';
}

/** Does the folder hold any .tf file? */
export function hasConfig(files: Record<string, string>, dir = '.'): boolean {
  const prefix = dir === '.' ? '' : `${dir}/`;
  return Object.keys(files).some((f) => f.startsWith(prefix) && !f.slice(prefix.length).includes('/') && f.endsWith('.tf'));
}

export function loadConfig(files: Record<string, string>): { config: Config; diags: Diag[] } {
  const diags: Diag[] = [];
  const sources: Record<string, string> = {};
  const root = loadModule('', '.', files, diags, sources, 0);
  const all: Module[] = [];
  const walk = (m: Module) => {
    all.push(m);
    for (const c of Object.values(m.children)) walk(c);
  };
  walk(root);
  for (const f of Object.keys(files)) if (f.endsWith('.tfvars')) sources[f] = files[f]!;
  return { config: { root, all, sources }, diags };
}

/** Every provider short name a configuration needs (from resources and required_providers). */
export function neededProviders(config: Config): string[] {
  const out = new Set<string>();
  for (const m of config.all) {
    for (const r of Object.values(m.resources)) {
      const p = r.type === 'terraform_data' ? 'terraform' : r.type.startsWith('null_') ? 'null' : r.type.split('_')[0]!;
      out.add(p);
    }
    for (const p of Object.keys(m.requiredProviders)) out.add(p);
  }
  return [...out].sort();
}

export type { Val };
