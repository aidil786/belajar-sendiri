// The `tofu` command line: init, validate, plan, apply, destroy, refresh, show, output, state,
// import, providers, version (fmt lives in fmt.ts). Output follows OpenTofu 1.13.5 word for word
// (checked by `npm run verify:tofu`). Colour mode draws diagnostics in the "╷ │ ╵" gutter; with
// -no-color they print plain, exactly like the real CLI.
import { loadConfig, neededProviders, staticString, type Config, type Module, type ResourceDecl } from './config';
import { DiagError, err, renderDiags, warn, type Diag } from './diag';
import { evalExpr, type Scope } from './eval';
import { parseExpr, parseFile, attrsOf, HclError, type Range } from './hcl';
import { HASHES, LOCK_FILE, parseLock, renderLock, satisfies, SIGNING_KEY, type LockEntry } from './lockfile';
import {
  fullObject,
  markDeep,
  planInstance,
  sensPathsOf,
  validateConfig,
  unknownObject,
  SkipError,
  Walker,
  withSchemaMarks,
  type Progress,
} from './plan';
import { attrNames, convertAttr, ProviderError, providerOf, PROVIDERS, schemaFor, type FileCtx } from './providers';
import { changedOutputs, formatOutput, outputChangeLines, outputLines, renderChange, renderStateResource, RULER, showOutputLines } from './render';
import { rng } from './rng';
import { BACKUP_FILE, emptyState, instanceAddr, listInstances, parseState, sameState, serializeState, STATE_FILE, TOFU_VERSION, type StateInstance, type StateResource, type TfState } from './state';
import type { Change, CheckResult, Line, OutputChange, Plan, TofuEvent, TofuState } from './types';
import { convert, ConvertError } from './convert';
import { T_DYN, T_STRING, goJson, hasUnknown, isUnknown, object, str, toJson, tyJson, unknown, valEq, type Val } from './values';

export interface Sess {
  st: TofuState;
  out: Line[];
  events: TofuEvent[];
  color: boolean;
  exit: number;
  /** A friendly explanation key for the line under the terminal. */
  explain?: { key: string; params?: Record<string, string | number> };
  stopped?: boolean;
}

const L = (t: string, c?: Line[number]['c']): Line => (t ? [c ? { t, c } : { t }] : []);
const text = (s: Sess, block: string, c?: Line[number]['c']) => {
  for (const l of block.split('\n')) s.out.push(L(l, c));
};

function diags(s: Sess, ds: Diag[], sources?: Record<string, string>) {
  if (!ds.length) return;
  s.out.push(...renderDiags(ds, sources ?? sourcesOf(s.st), s.color));
  if (ds.some((d) => d.severity === 'error')) s.exit = 1;
}

function sourcesOf(st: TofuState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [f, c] of Object.entries(st.files)) if (/\.(tf|tfvars)$/.test(f)) out[f] = c;
  return out;
}

// ---------------------------------------------------------------------------
// Flags (Go's flag package: -x, -x=v, -x v; --x works too)

export interface Flags {
  bools: Set<string>;
  values: Record<string, string[]>;
  args: string[];
  bad?: string;
}

export function parseFlags(argv: string[], valueFlags: string[], boolFlags: string[]): Flags {
  const f: Flags = { bools: new Set(), values: {}, args: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('-') || a === '-') {
      f.args.push(...argv.slice(i));
      break;
    }
    const m = /^--?([\w-]+)(?:=(.*))?$/s.exec(a);
    if (!m) {
      f.bad = a;
      break;
    }
    const name = m[1]!;
    if (boolFlags.includes(name)) {
      if (m[2] === undefined || m[2] === 'true') f.bools.add(name);
      else if (m[2] === 'false') f.bools.add(`${name}=false`);
      continue;
    }
    if (valueFlags.includes(name)) {
      const v = m[2] ?? argv[++i];
      if (v === undefined) {
        f.bad = `flag needs an argument: -${name}`;
        break;
      }
      (f.values[name] ??= []).push(v);
      continue;
    }
    f.bad = `flag provided but not defined: -${name}`;
    break;
  }
  return f;
}

// ---------------------------------------------------------------------------
// Files for providers (local_file reads and writes the project folder)

function fileCtx(st: TofuState, files: Record<string, string>): FileCtx & { seed: () => number } {
  const r = rng(st.seed);
  return {
    read: (p) => {
      const k = normal(p);
      return k in files ? files[k]! : null;
    },
    write: (p, c) => {
      files[normal(p)] = c;
    },
    remove: (p) => {
      delete files[normal(p)];
    },
    rng: r,
    seed: () => r.state(),
  };
}

export function normal(p: string): string {
  const parts: string[] = [];
  for (const seg of p.replace(/^\/home\/you\/[^/]+\//, '').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

// ---------------------------------------------------------------------------
// init

export function cmdInit(s: Sess, argv: string[]) {
  const f = parseFlags(argv, ['backend-config', 'plugin-dir', 'from-module', 'lockfile', 'var', 'var-file'], ['upgrade', 'reconfigure', 'migrate-state', 'input', 'no-color', 'backend', 'get', 'force-copy', 'json']);
  if (f.bad) return flagError(s, f.bad, 'init');
  const files = s.st.files;
  const tfFiles = Object.keys(files).filter((x) => x.endsWith('.tf') && !x.includes('/'));
  if (!tfFiles.length) {
    s.out.push(L('OpenTofu initialized in an empty directory!', 'bold'), [], L('The directory has no OpenTofu configuration files. You may begin working'), L('with OpenTofu immediately by creating OpenTofu configuration files.'));
    return;
  }
  const { config, diags: loadDiags } = loadConfig(files);
  if (loadDiags.some((d) => d.severity === 'error')) {
    text(s, '\nOpenTofu encountered problems during initialization, including problems\nwith the configuration, described below.\n\nThe OpenTofu configuration must be valid before initialization so that\nOpenTofu can determine which modules and providers need to be installed.');
    diags(s, loadDiags);
    s.out.push([]);
    s.explain = { key: 'tofu.err.initConfig' };
    return;
  }
  const backend = config.root.backend;
  s.out.push([], L('Initializing the backend...', 'bold'));
  if (backend && backend.type !== 'local') {
    s.out.pop();
    diags(s, [err('Backend not available in practice', `This practice laptop only has the "local" backend (a state file in this folder). The "${backend.type}" backend needs a real account, so try it on your own machine.`, backend.range)]);
    s.explain = { key: 'tofu.err.backend' };
    return;
  }
  const modules: Record<string, string> = {};
  const modLines: string[] = [];
  const upgradeMods = f.bools.has('upgrade');
  const haveMods = s.st.init?.modules ?? {};
  // Calls are installed in name order; a local module that is already installed prints nothing.
  const walkMods = (m: Module, prefix: string) => {
    for (const call of Object.values(m.modules).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const key = prefix ? `${prefix}.${call.name}` : call.name;
      const child = m.children[call.name];
      if (!/^\.\.?\//.test(call.source)) {
        diags(s, [err('Module source not available in practice', `This practice laptop can only use local modules (source = "./modules/..."). "${call.source}" would be downloaded from the internet.`, call.sourceRange)]);
        continue;
      }
      if (!child || !child.fileNames.length) {
        diags(s, [err('Unreadable module directory', `Unable to evaluate directory symlink: lstat ${call.source.replace(/^\.\//, '')}: no such file or directory`, call.sourceRange)]);
        continue;
      }
      modules[key] = child.dir;
      if (upgradeMods || haveMods[key] !== child.dir) modLines.push(`- ${key} in ${child.dir}`);
      walkMods(child, key);
    }
  };
  walkMods(config.root, '');
  if (s.exit) return;
  if (Object.keys(modules).length) s.out.push(L(upgradeMods ? 'Upgrading modules...' : 'Initializing modules...', 'bold'), ...modLines.map((l) => L(l)));

  // Providers
  s.out.push([], L('Initializing provider plugins...', 'bold'));
  const need = neededProviders(config);
  const unknownP = need.filter((p) => !PROVIDERS[p]);
  if (unknownP.length) {
    diags(s, [err('Provider not available in practice', `This practice laptop only has the hashicorp/random, hashicorp/local and hashicorp/null providers (and the built-in terraform_data). It can't download ${unknownP.map((p) => `hashicorp/${p}`).join(', ')}.`)]);
    s.explain = { key: 'tofu.err.provider' };
    return;
  }
  const lockOld = parseLock(files[LOCK_FILE]);
  const upgrade = f.bools.has('upgrade');
  const constraints: Record<string, string | undefined> = {};
  for (const m of config.all) for (const [p, r] of Object.entries(m.requiredProviders)) if (r.version) constraints[p] = constraints[p] ? `${constraints[p]}, ${r.version}` : r.version;
  if (need.includes('terraform')) s.out.push(L('- terraform.io/builtin/terraform is built in to OpenTofu'));
  const regs = need.filter((p) => p !== 'terraform');
  const lines: { find: string[]; inst: string[]; done: string[] } = { find: [], inst: [], done: [] };
  const entries: LockEntry[] = [];
  const installed: Record<string, string> = {};
  let changedLock = false;
  for (const p of regs) {
    const ver = PROVIDERS[p]!.version;
    const c = constraints[p];
    if (c && !satisfies(ver, c)) {
      diags(s, [err('Failed to query available provider packages', `Could not retrieve the list of available versions for provider hashicorp/${p}: no available releases match the given constraints ${c}`)]);
      return;
    }
    const locked = lockOld.find((e) => e.provider === p);
    const reuse = locked && !upgrade && satisfies(locked.version, c);
    if (reuse) lines.find.push(`- Reusing previous version of hashicorp/${p} from the dependency lock file`);
    else lines.find.push(c ? `- Finding hashicorp/${p} versions matching "${c}"...` : `- Finding latest version of hashicorp/${p}...`);
    const have = s.st.init?.providers[p];
    // Already in .terraform: no download, even with -upgrade (checked with OpenTofu 1.12.4).
    if (have === ver) lines.inst.push(`- Using previously-installed hashicorp/${p} v${ver}`);
    else {
      lines.inst.push(`- Installing hashicorp/${p} v${ver}...`);
      lines.done.push(`- Installed hashicorp/${p} v${ver} (signed, key ID ${SIGNING_KEY})`);
    }
    if (!reuse) changedLock = true;
    installed[p] = ver;
    entries.push(c ? { provider: p, version: ver, constraints: c } : { provider: p, version: ver });
  }
  // OpenTofu prints all "Finding/Reusing" lines first, then the installs (they run in parallel).
  for (const l of [...lines.find, ...lines.inst, ...lines.done]) s.out.push(L(l));
  if (lines.done.length) text(s, "\nProviders are signed by their developers.\nIf you'd like to know more about provider signing, you can read about it here:\nhttps://opentofu.org/docs/cli/plugins/signing/");
  const newLock = entries.length ? renderLock(entries) : undefined;
  const hadLock = LOCK_FILE in files;
  if (newLock && newLock !== files[LOCK_FILE]) {
    files[LOCK_FILE] = newLock;
    s.events.push({ type: 'fileWritten', path: LOCK_FILE });
    if (!hadLock) text(s, '\nOpenTofu has created a lock file .terraform.lock.hcl to record the provider\nselections it made above. Include this file in your version control repository\nso that OpenTofu can guarantee to make the same selections by default when\nyou run "tofu init" in the future.');
    else if (changedLock) text(s, '\nOpenTofu has made some changes to the provider dependency selections recorded\nin the .terraform.lock.hcl file. Review those changes and commit them to your\nversion control system if they represent changes you intended to make.');
  }
  s.st.init = { providers: installed, modules };
  s.out.push([]);
  s.out.push(L('OpenTofu has been successfully initialized!', 'green'));
  text(s, '\nYou may now begin working with OpenTofu. Try running "tofu plan" to see\nany changes that are required for your infrastructure. All OpenTofu commands\nshould now work.\n\nIf you ever set or change modules or backend configuration for OpenTofu,\nrerun this command to reinitialize your working directory. If you forget, other\ncommands will detect it and remind you to do so if necessary.');
  s.events.push({ type: 'initDone', providers: regs, modules: Object.keys(modules) });
  s.explain = { key: 'tofu.explain.init' };
}

/** The checks every command that needs `init` makes first. Returns the config, or null after printing errors. */
function ready(s: Sess, cmd: string): Config | null {
  const files = s.st.files;
  const tfFiles = Object.keys(files).filter((x) => x.endsWith('.tf') && !x.includes('/'));
  if (!tfFiles.length && cmd !== 'destroy') {
    diags(s, [
      err(
        'No configuration files',
        `${cmd === 'apply' ? 'Apply' : cmd === 'validate' ? 'Validate' : 'Plan'} requires configuration to be present. ${cmd === 'apply' ? 'Applying' : 'Planning'} without a configuration would mark everything for destruction, which is normally not what is desired. If you would like to destroy everything, run ${cmd === 'apply' ? "'tofu destroy'" : 'plan with the -destroy option'}. Otherwise, create a OpenTofu configuration file (.tf file) and try again.`,
      ),
    ]);
    s.explain = { key: 'tofu.err.noConfig' };
    return null;
  }
  const { config, diags: loadDiags } = loadConfig(files);
  if (loadDiags.some((d) => d.severity === 'error')) {
    diags(s, loadDiags);
    s.explain = { key: 'tofu.err.config' };
    return null;
  }
  // Modules installed?
  const notInstalled: Diag[] = [];
  for (const m of config.all) {
    for (const call of Object.values(m.modules)) {
      const key = m.path ? `${m.path.replace(/module\./g, '')}.${call.name}` : call.name;
      if (!s.st.init || !(key in s.st.init.modules)) notInstalled.push(err('Module not installed', 'This module is not yet installed. Run "tofu init" to install all modules required by this configuration.', call.range));
    }
  }
  if (notInstalled.length) {
    diags(s, notInstalled);
    s.explain = { key: 'tofu.err.needInit' };
    return null;
  }
  // Providers locked and installed?
  const need = neededProviders(config).filter((p) => p !== 'terraform');
  const lock = parseLock(files[LOCK_FILE]);
  const missing = need.filter((p) => !lock.some((e) => e.provider === p));
  if (missing.length) {
    if (cmd === 'validate') {
      diags(s, [err('Missing required provider', `This configuration requires provider registry.opentofu.org/hashicorp/${missing[0]},\nbut that provider isn't available. You may be able to install it\nautomatically by running:\n  tofu init`)]);
    } else {
      const list = missing.map((p) => `  - provider registry.opentofu.org/hashicorp/${p}: required by this configuration but no version is selected`).join('\n');
      const tail = files[LOCK_FILE] !== undefined ? 'To update the locked dependency selections to match a changed configuration,\nrun:\n  tofu init -upgrade' : 'To make the initial dependency selections that will initialize the dependency\nlock file, run:\n  tofu init';
      diags(s, [err('Inconsistent dependency lock file', `The following dependency selections recorded in the lock file are\ninconsistent with the current configuration:\n${list}\n\n${tail}`)]);
    }
    s.explain = { key: 'tofu.err.needInit' };
    return null;
  }
  if (need.some((p) => !s.st.init?.providers[p])) {
    diags(s, [err('Required plugins are not installed', `The installed provider plugins are not consistent with the packages selected\nin the dependency lock file:\n${need
      .filter((p) => !s.st.init?.providers[p])
      .map((p) => `  - registry.opentofu.org/hashicorp/${p}: there is no package for registry.opentofu.org/hashicorp/${p} ${PROVIDERS[p]!.version} cached in .terraform/providers`)
      .join('\n')}\n\nOpenTofu uses external plugins to integrate with a variety of different\ninfrastructure services. To download the plugins required for this\nconfiguration, run:\n  tofu init`)]);
    s.explain = { key: 'tofu.err.needInit' };
    return null;
  }
  return config;
}

// ---------------------------------------------------------------------------
// Variables

interface VarArg {
  kind: 'var' | 'file';
  value: string;
}

function varArgs(f: Flags, argv: string[]): VarArg[] {
  // Keep the command-line order of -var and -var-file.
  const out: VarArg[] = [];
  for (let i = 0; i < argv.length; i++) {
    const m = /^--?(var|var-file)(?:=(.*))?$/s.exec(argv[i]!);
    if (!m) continue;
    const v = m[2] ?? argv[++i] ?? '';
    out.push({ kind: m[1] === 'var' ? 'var' : 'file', value: v });
  }
  void f;
  return out;
}

const NO_SCOPE: Scope = {
  fn: {},
  ref(_root: string, _steps, range: Range): never {
    throw new DiagError([err('Variables not allowed', 'Variables may not be used here.', range)]);
  },
};

/** Where a variable's value came from (OpenTofu names it when the value has the wrong type). */
type VarSource = 'cli' | 'env' | 'input' | 'file';

/**
 * Resolve root variable values. Returns null after printing errors; `missing` lists unset required
 * ones. A value of the wrong type is not printed here: it lands in `bad` (OpenTofu finds it while
 * planning, so the plan goes on without everything that uses that variable).
 */
function rootVars(s: Sess, config: Config, args: VarArg[], extra: Record<string, string>): { values: Record<string, Val>; missing: string[]; warnings: Diag[]; bad: Record<string, Diag> } | null {
  const decls = config.root.variables;
  const raw: Record<string, { v: string | Val; range?: Range; src: VarSource }> = {};
  const ds: Diag[] = [];
  const warnings: Diag[] = [];
  for (const [k, v] of Object.entries(s.st.env)) {
    const m = /^TF_VAR_(.+)$/.exec(k);
    if (m && decls[m[1]!]) raw[m[1]!] = { v, src: 'env' };
  }
  const loadFile = (name: string, explicit: boolean) => {
    const content = s.st.files[normal(name)];
    if (content === undefined) {
      ds.push(err('Failed to read variables file', `Given variables file ${name} does not exist.`));
      return;
    }
    let body;
    try {
      body = parseFile(content, name);
    } catch (e) {
      if (e instanceof HclError) ds.push(err(e.summary, e.detail, e.range));
      return;
    }
    for (const a of attrsOf(body)) {
      if (!decls[a.name]) {
        if (explicit) ds.push(err('Value for undeclared variable', `A variable named "${a.name}" was assigned a value, but the root module does not declare a variable of that name. To use this value, add a "variable" block to the configuration.`, a.nameRange));
        else warnings.push(warn('Value for undeclared variable', `The root module does not declare a variable named "${a.name}" but a value was found in file "${name}". If you meant to use this value, add a "variable" block to the configuration.\n\nTo silence these warnings, use TF_VAR_... environment variables to provide certain "global" settings to all configurations in your organization. To reduce the verbosity of these warnings, use the -compact-warnings option.`, a.nameRange));
        continue;
      }
      try {
        raw[a.name] = { v: evalExpr(a.expr, NO_SCOPE), range: a.expr.range, src: 'file' };
      } catch (e) {
        if (e instanceof DiagError) ds.push(...e.diags);
        else throw e;
      }
    }
  };
  if ('terraform.tfvars' in s.st.files) loadFile('terraform.tfvars', false);
  for (const f of Object.keys(s.st.files).filter((x) => !x.includes('/') && x.endsWith('.auto.tfvars')).sort()) loadFile(f, false);
  for (const a of args) {
    if (a.kind === 'file') loadFile(a.value, true);
    else {
      const eq = a.value.indexOf('=');
      if (eq < 0) {
        ds.push(err('Invalid -var option', `The given -var option ${JSON.stringify(a.value)} is not correctly specified. Must be a variable name and value separated by an equals sign, like -var="key=value".`));
        continue;
      }
      const name = a.value.slice(0, eq);
      if (!decls[name]) {
        ds.push(err('Value for undeclared variable', `A variable named "${name}" was assigned on the command line, but the root module does not declare a variable of that name. To use this value, add a "variable" block to the configuration.`));
        continue;
      }
      raw[name] = { v: a.value.slice(eq + 1), src: 'cli' };
    }
  }
  for (const [k, v] of Object.entries(extra)) raw[k] = { v, src: 'input' };
  if (ds.length) {
    diags(s, ds);
    return null;
  }
  const values: Record<string, Val> = {};
  const missing: string[] = [];
  const bad: Record<string, Diag> = {};
  for (const d of Object.values(decls).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const r = raw[d.name];
    let v: Val;
    try {
      if (r) {
        if (typeof r.v === 'string') {
          const prim = ['string', 'number', 'bool'].includes(d.type.k) || (d.type.k === 'dynamic' && !/^[[{]/.test(r.v.trim()));
          v = prim ? convert(str(r.v), d.type.k === 'dynamic' ? T_STRING : d.type) : convert(evalExpr(parseExpr(r.v), NO_SCOPE), d.type);
        } else v = convert(r.v, d.type);
      } else if (d.default) v = convert(evalExpr(d.default, NO_SCOPE), d.type);
      else {
        missing.push(d.name);
        continue;
      }
    } catch (e) {
      if (e instanceof ConvertError) {
        // OpenTofu points at the variable block either way; "declared at" ends after the name label.
        const declared = `${d.range.file}:${d.range.start.line},${d.range.start.col}-${d.range.start.col + `variable ${JSON.stringify(d.name)}`.length}`;
        const how = { cli: `set using -var="${d.name}=..."`, env: `set using the TF_VAR_${d.name} environment variable`, input: 'set using an interactive prompt', file: '' }[r?.src ?? 'file'];
        const diag = r && how
          ? err('Invalid value for input variable', `Unsuitable value for var.${d.name} ${how}: ${e.message}.`, d.range, { context: null })
          : err('Invalid value for input variable', `The given value is not suitable for var.${d.name} declared at ${declared}: ${e.message}.`, r ? d.range : undefined, { context: null });
        if (r) bad[d.name] = diag;
        else ds.push(diag);
        continue;
      }
      if (e instanceof DiagError) {
        ds.push(...e.diags);
        continue;
      }
      if (e instanceof HclError) {
        ds.push(err(e.summary, e.detail));
        continue;
      }
      throw e;
    }
    values[d.name] = v;
  }
  if (ds.length) {
    diags(s, ds);
    return null;
  }
  return { values, missing, warnings, bad };
}

// ---------------------------------------------------------------------------
// Planning

interface PlanOpts {
  kind: 'normal' | 'destroy' | 'refresh';
  replace: string[];
  /** -exclude=ADDR: leave these (and what depends on them) out of the plan. */
  exclude: string[];
  refresh: boolean;
  targets: string[];
  vars: VarArg[];
  input: boolean;
  /** The command line (to repeat it after a variable question). */
  line: string;
  /** Values answered at the prompt. */
  answered: Record<string, string>;
}

interface Planned {
  plan: Plan;
  progress: Line[];
  warnings: Diag[];
}

function progressPrinter(lines: Line[]): Progress {
  return (addr, t) => lines.push([{ t: `${addr}: ${t}` }]);
}

/** Make a plan. Prints errors itself; returns null on failure or when a variable question is pending. */
function makePlan(s: Sess, config: Config, o: PlanOpts): Planned | null {
  const st = s.st;
  const v = rootVars(s, config, o.vars, o.answered);
  if (!v) {
    s.explain = { key: 'tofu.err.vars' };
    return null;
  }
  if (v.missing.length) {
    const name = v.missing[0]!;
    const decl = config.root.variables[name]!;
    if (o.input) {
      // OpenTofu's question: the name, then the description and a blank line (when there is one).
      s.out.push(L(`var.${name}`, 'bold'));
      if (decl.description) s.out.push(L(`  ${decl.description}`), []);
      s.st.pending = { kind: 'var', line: o.line, names: v.missing, values: o.answered };
      s.events.push({ type: 'waiting', for: 'var' });
      s.stopped = true;
      s.explain = { key: 'tofu.explain.askVar', params: { name } };
      return null;
    }
    // One paragraph, wrapped like every detail (a long variable name moves "Use" up a line).
    diags(s, [err('No value for required variable', `The root module input variable "${name}" is not set, and has no default value. Use a -var or -var-file command line argument to provide a value for this variable.`, decl.range)]);
    s.explain = { key: 'tofu.err.vars' };
    return null;
  }
  const files = { ...st.files };
  const fctx = fileCtx(st, files);
  const priorText = st.files[STATE_FILE];
  let prior = parseState(priorText) ?? emptyState(uuidFrom(fctx));
  // The validate step: references, arguments, types, sensitive outputs.
  const vds = validateConfig(config, markSensitiveVars(config, {}), fctx);
  if (vds.some((d) => d.severity === 'error')) {
    diags(s, vds);
    s.explain = { key: 'tofu.err.config' };
    return null;
  }

  const progress: Line[] = [];
  const pr = progressPrinter(progress);
  const fail = (ds: Diag[]) => {
    s.out.push(...progress);
    s.out.push([], L('Planning failed. OpenTofu encountered an error while generating this plan.', 'red'), []);
    diags(s, ds);
    s.explain = { key: 'tofu.err.planFailed' };
    return null;
  };

  // moved blocks
  const moved = new Map<string, string>();
  prior = structuredClone(prior);
  for (const m of config.all) {
    for (const mv of m.moved) {
      const from = (m.path ? `${m.path}.` : '') + mv.from;
      const to = (m.path ? `${m.path}.` : '') + mv.to;
      if (moveInState(prior, from, to)) {
        for (const x of listInstances(prior)) if (x.addr === to || x.addr.startsWith(`${to}[`)) moved.set(x.addr, x.addr.replace(to, from));
        // Things that depended on the old address now depend on the new one (as in the real state after apply).
        for (const x of listInstances(prior)) x.inst.deps = x.inst.deps.map((d) => (d === from ? to : d.startsWith(`${from}[`) ? to + d.slice(from.length) : d));
      }
    }
  }
  // import blocks
  const imports = new Map<string, string>();
  for (const m of config.all) {
    for (const im of m.imports) {
      const to = (m.path ? `${m.path}.` : '') + im.to;
      if (listInstances(prior).some((x) => x.addr === to)) continue;
      let id: Val;
      try {
        id = evalExpr(im.id, new Walker({ mode: 'plan', config, vars: v.values, state: prior, files: fctx, failed: new Set(Object.keys(v.bad)) }).scopeFor(m));
      } catch (e) {
        if (e instanceof DiagError) return fail(e.diags);
        if (e instanceof SkipError) continue;
        throw e;
      }
      const idStr = String(id.v);
      const tgt = /^(?:module\.[\w-]+\.)*(?:([\w-]+)\.([\w-]+))(?:\[.*\])?$/.exec(to);
      const type = tgt?.[1] ?? '';
      const rt = schemaFor('managed', type);
      pr(to, `Preparing import... [id=${idStr}]`);
      if (!rt?.importId) {
        return fail([err('Resource Import Not Implemented', `This resource does not support import. Please contact the provider developer for additional information.`, im.range)]);
      }
      try {
        const attrs = rt.importId(idStr);
        addInstance(prior, to, rt.provider, { schemaVersion: rt.schemaVersion, attrs, sensitive: [], deps: [] });
        imports.set(to, idStr);
      } catch (e) {
        if (e instanceof ProviderError) return fail([err(e.summary, e.detail, im.range)]);
        throw e;
      }
    }
  }

  // refresh
  const drift: Change[] = [];
  if (o.refresh) {
    const wanted = o.targets.length ? targetSet(config, o.targets) : null;
    const left = o.exclude.length ? excludedSet(config, o.exclude) : null;
    for (const x of listInstances(prior)) {
      if (x.res.mode !== 'managed') continue;
      if (wanted && !wanted.has(x.addr.replace(/\[[^\]]*\]$/, ''))) continue;
      if (left && isExcluded(left, x.addr)) continue;
      const rt = schemaFor('managed', x.res.type);
      const id = x.inst.attrs.id;
      pr(x.addr, `Refreshing state... [id=${id ? String(id.v) : ''}]`);
      if (!rt?.read) continue;
      const now = rt.read(x.inst.attrs, fctx);
      if (now === null) {
        drift.push(changeOf(x.addr, x.res, x.inst, 'delete', withSchemaMarks(rt, object(x.inst.attrs), x.inst.sensitive), null));
        removeInstance(prior, x.addr);
      }
    }
  }
  // Data sources leave the state on every refresh; they are read again.
  const refreshed = structuredClone(prior);
  refreshed.resources = refreshed.resources.filter((r) => r.mode !== 'data');

  const changes: Change[] = [];
  const checks: CheckResult[] = [];
  // A variable with a value of the wrong type, or one that breaks a validation rule, fails on its
  // own: like OpenTofu's graph walk, everything that uses it is left out (SkipError) and the rest
  // is still planned. With nothing left to show, the plan is just "Planning failed."
  const failed = new Set(Object.keys(v.bad));
  const errs: Diag[] = Object.values(v.bad);
  const pw = new Walker({ mode: 'plan', config, vars: v.values, state: refreshed, files: fctx, progress: pr, replace: o.replace, failed });
  const skipped = new Set<string>();
  const walk = (f: () => void) => {
    try {
      f();
    } catch (e) {
      if (e instanceof DiagError) errs.push(...e.diags);
      else if (!(e instanceof SkipError)) throw e;
    }
  };

  if (o.kind !== 'refresh') {
    // Variable validations.
    for (const d of Object.values(config.root.variables)) {
      if (!d.validations.length || failed.has(d.name)) continue;
      const broken = d.validations.filter((val) => {
        const sc = pw.scopeFor(config.root);
        let bad = false;
        walk(() => {
          const c = evalExpr(val.condition, sc);
          if (!isUnknown(c) && c.v === false) {
            bad = true;
            const msg = evalExpr(val.message, sc);
            const value = pw.variable(config.root, d.name);
            errs.push(err('Invalid value for variable', `${String(msg.v)}\n\nThis was checked by the validation rule at ${val.range.file}:${val.range.start.line},${val.range.start.col}-${val.range.end.col}.`, d.range, { values: [`var.${d.name} is ${describeVal(value)}`], context: null }));
          }
        });
        return bad;
      });
      const status = broken.length ? 'fail' : 'pass';
      if (broken.length) failed.add(d.name);
      checks.push({ object_kind: 'var', config_addr: `var.${d.name}`, status, objects: [{ object_addr: `var.${d.name}`, status }] });
    }
    // Walk every resource (data sources read now when their config is known).
    if (o.kind === 'normal') {
      for (const m of config.all) {
        for (const decl of sortedDecls(m)) {
          if (o.targets.length && !targeted(m, decl, o.targets)) continue;
          if (o.exclude.length && isExcluded(excludedSet(config, o.exclude), instanceAddr({ module: m.path, mode: decl.mode, type: decl.type, name: decl.name }))) continue;
          try {
            pw.resourceRef(m, decl);
          } catch (e) {
            // Left out because it uses a failed variable: its built objects are not orphans.
            if (e instanceof SkipError) skipped.add(`${m.path}|${decl.key}`);
            else if (e instanceof DiagError) errs.push(...e.diags);
            else throw e;
          }
        }
      }
    } else {
      // destroy: data sources still read (OpenTofu refreshes first)
      for (const m of config.all) for (const decl of sortedDecls(m)) if (decl.mode === 'data') walk(() => pw.resourceRef(m, decl));
    }
    if (o.kind === 'normal') {
      for (const c of pw.changes.values()) changes.push(c);
      // Orphans: in the state but not in the configuration.
      for (const x of listInstances(refreshed)) {
        if (x.res.mode !== 'managed') continue;
        if (pw.changes.has(x.addr)) continue;
        const decl = declFor(config, x.res);
        if (decl && skipped.has(`${x.res.module}|${decl.key}`)) continue;
        if (o.targets.length && !o.targets.some((t) => x.addr === t || x.addr.startsWith(`${t}[`) || x.addr.startsWith(`${t}.`))) continue;
        if (o.exclude.length && isExcluded(excludedSet(config, o.exclude), x.addr)) continue;
        const rt = schemaFor('managed', x.res.type);
        const reason: Change['reason'] = !decl ? (x.res.module && !config.all.some((m) => m.path === x.res.module) ? 'noModule' : 'gone') : decl.count ? 'countIndex' : decl.forEach ? 'eachKey' : 'gone';
        const c = changeOf(x.addr, x.res, x.inst, 'delete', rt ? withSchemaMarks(rt, object(x.inst.attrs), x.inst.sensitive) : object(x.inst.attrs), null);
        c.reason = reason;
        changes.push(c);
      }
    } else {
      for (const x of listInstances(refreshed)) {
        if (x.res.mode !== 'managed') continue;
        if (o.targets.length && !o.targets.some((t) => x.addr === t || x.addr.startsWith(`${t}[`))) continue;
        if (o.exclude.length && isExcluded(excludedSet(config, o.exclude), x.addr)) continue;
        const rt = schemaFor('managed', x.res.type);
        changes.push(changeOf(x.addr, x.res, x.inst, 'delete', rt ? withSchemaMarks(rt, object(x.inst.attrs), x.inst.sensitive) : object(x.inst.attrs), null));
      }
    }
  }
  for (const c of changes) {
    const from = moved.get(c.addr);
    if (from) c.movedFrom = from;
    const imp = imports.get(c.addr);
    if (imp !== undefined) c.importId = imp;
  }
  // prevent_destroy
  const pdErrs: Diag[] = [];
  for (const c of changes) {
    if (c.action !== 'delete' && c.action !== 'replace') continue;
    const decl = declFor(config, { module: c.module, mode: c.mode, type: c.type, name: c.name });
    if (decl?.lifecycle.preventDestroy) {
      pdErrs.push(err('Resource instance cannot be destroyed', `Resource instance ${c.addr} has prevent_destroy set, but the plan calls for it to be destroyed.\n\nTo proceed, either disable prevent_destroy for this resource or exclude instances of this resource from this round using:\n    -exclude=${JSON.stringify(c.addr)}`, decl.range, { context: null }));
    }
  }
  errs.push(...pdErrs);

  // Data sources that were read go into the refreshed state the plan applies to.
  for (const [addr, attrs] of pw.dataRead) {
    const m = /^(?:(.*)\.)?data\.([\w-]+)\.([\w-]+)(?:\[(.+)\])?$/.exec(addr)!;
    const rt = schemaFor('data', m[2]!)!;
    addInstance(refreshed, addr, rt.provider, { schemaVersion: rt.schemaVersion, attrs: (fullObject(rt, attrs).v as Record<string, Val>), sensitive: [], deps: [] });
  }

  // Outputs
  const outputs: OutputChange[] = [];
  const ow = o.kind === 'normal' ? pw : new Walker({ mode: 'apply', config, vars: v.values, state: refreshed, files: fctx, failed });
  // A destroy plan with nothing built and no outputs saved skips its refresh, so outputs are not
  // in its state: there is nothing to remove ("No changes. No objects need to be destroyed.").
  const nothingSaved = !prior.resources.length && !Object.keys(prior.outputs).length;
  // A destroy with -target or -exclude leaves every output alone (no "Changes to Outputs", and the
  // saved values stay in the state).
  const keepOutputs = o.kind === 'destroy' && (nothingSaved || o.targets.length > 0 || o.exclude.length > 0);
  for (const [name, decl] of Object.entries(config.root.outputs)) {
    if (keepOutputs) continue;
    let after: Val | null;
    try {
      after = ow.output(config.root, name);
    } catch (e) {
      if (e instanceof DiagError) return fail(e.diags);
      if (e instanceof SkipError) continue;
      throw e;
    }
    const was = prior.outputs[name];
    let before: Val | null = was ? (was.sensitive ? markDeep(was.value) : was.value) : null;
    if (o.kind === 'destroy') {
      before = after;
      after = null;
    } else if (o.kind === 'refresh') {
      // refresh-only: outputs follow the refreshed objects.
    }
    outputs.push({ name, before, after, sensitive: decl.sensitive });
  }
  for (const [name, was] of Object.entries(prior.outputs)) {
    if (!keepOutputs && !config.root.outputs[name]) outputs.push({ name, before: was.value, after: null, sensitive: was.sensitive });
  }
  st.seed = fctx.seed();
  const plan: Plan = {
    kind: o.kind,
    changes: sortChanges(changes),
    drift: sortChanges(drift),
    outputs,
    targeted: o.targets.length > 0 || o.exclude.length > 0,
    usedTarget: o.targets.length > 0,
    prior: serializeState({ ...refreshed }),
    lineage: prior.lineage,
    serial: parseState(priorText)?.serial ?? 0,
    vars: Object.fromEntries(Object.entries(v.values).map(([k, x]) => [k, { value: toJson(x), type: tyJson(x.ty) }])),
    checks,
  };
  if (errs.length) {
    // OpenTofu still shows what it planned (resources or outputs), then the problem.
    if (visibleChanges(plan).length || changedOutputs(plan).length) {
      s.out.push(...progress);
      renderPlanBody(s, plan, true);
      diags(s, errs);
      s.explain = { key: 'tofu.err.planFailed' };
      return null;
    }
    return fail(errs);
  }
  return { plan, progress, warnings: v.warnings };
}

function markSensitiveVars(config: Config, values: Record<string, Val>): Record<string, Val> {
  const out: Record<string, Val> = {};
  for (const [k, v] of Object.entries(values)) out[k] = config.root.variables[k]?.sensitive ? markDeep(v) : v;
  for (const d of Object.values(config.root.variables)) if (!(d.name in out)) out[d.name] = unknown(d.type);
  return out;
}

function describeVal(v: Val): string {
  if (v.s) return 'has a sensitive value';
  if (typeof v.v === 'string') return JSON.stringify(v.v);
  if (typeof v.v === 'number' || typeof v.v === 'boolean') return String(v.v);
  if (v.v === null) return 'null';
  if (Array.isArray(v.v)) return `${v.ty.k === 'set' ? 'set' : v.ty.k === 'tuple' ? 'tuple' : 'list'} of ${v.ty.k === 'list' || v.ty.k === 'set' ? v.ty.e.k : 'dynamic'} with ${v.v.length} element${v.v.length === 1 ? '' : 's'}`;
  const n = Object.keys(v.v as object).length;
  return `${v.ty.k === 'map' ? `map of ${v.ty.e.k}` : 'object'} with ${n} ${v.ty.k === 'map' ? 'element' : 'attribute'}${n === 1 ? '' : 's'}`;
}

function uuidFrom(f: FileCtx): string {
  const b = f.rng.bytes(16);
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Targeted resources plus everything they depend on (config addresses). */
function targetSet(config: Config, targets: string[]): Set<string> {
  const out = new Set<string>();
  const w = new Walker({ mode: 'validate', config, vars: {}, state: emptyState(''), files: { read: () => null, write: () => undefined, remove: () => undefined, rng: rng(1) } });
  for (const m of config.all) {
    for (const decl of Object.values(m.resources)) {
      if (!targeted(m, decl, targets)) continue;
      out.add(instanceAddr({ module: m.path, mode: decl.mode, type: decl.type, name: decl.name }));
      for (const d of w.resourceDeps(m, decl)) out.add(d);
    }
  }
  return out;
}

function sortedDecls(m: Module): ResourceDecl[] {
  return Object.values(m.resources).sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** Excluded resources plus everything that depends on them (config addresses). */
function excludedSet(config: Config, exclude: string[]): Set<string> {
  const out = new Set<string>(exclude.map((e) => e.replace(/\[[^\]]*\]$/, '')));
  const w = new Walker({ mode: 'validate', config, vars: {}, state: emptyState(''), files: { read: () => null, write: () => undefined, remove: () => undefined, rng: rng(1) } });
  for (const m of config.all) {
    for (const decl of Object.values(m.resources)) {
      const addr = instanceAddr({ module: m.path, mode: decl.mode, type: decl.type, name: decl.name });
      if (w.resourceDeps(m, decl).some((d) => out.has(d))) out.add(addr);
    }
  }
  return out;
}

function isExcluded(set: Set<string>, addr: string): boolean {
  return set.has(addr.replace(/\[[^\]]*\]$/, '')) || [...set].some((e) => addr.startsWith(`${e}.`));
}

function targeted(m: Module, decl: ResourceDecl, targets: string[]): boolean {
  const addr = instanceAddr({ module: m.path, mode: decl.mode, type: decl.type, name: decl.name });
  return targets.some((t) => t === addr || t.startsWith(`${addr}[`) || (m.path && (t === m.path || addr.startsWith(`${t}.`))));
}

export function declFor(config: Config, r: { module: string; mode: string; type: string; name: string }): ResourceDecl | undefined {
  const m = config.all.find((x) => x.path === r.module);
  return m?.resources[r.mode === 'data' ? `data.${r.type}.${r.name}` : `${r.type}.${r.name}`];
}

function changeOf(addr: string, res: StateResource, inst: StateInstance, action: Change['action'], before: Val | null, after: Val | null): Change {
  return { addr, module: res.module, mode: res.mode, type: res.type, name: res.name, ...(inst.key !== undefined ? { key: inst.key } : {}), action, before, after, forces: [], provider: res.provider, deps: inst.deps };
}

/** Plan order: root module first, then by module path; data before managed; type; name; key. */
export function sortChanges(cs: Change[]): Change[] {
  return [...cs].sort((a, b) => {
    if (a.module !== b.module) return a.module < b.module ? -1 : 1;
    if (a.mode !== b.mode) return a.mode === 'data' ? -1 : 1;
    if (a.type !== b.type) return a.type < b.type ? -1 : 1;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    if (typeof a.key === 'number' && typeof b.key === 'number') return a.key - b.key;
    return String(a.key ?? '') < String(b.key ?? '') ? -1 : String(a.key ?? '') > String(b.key ?? '') ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// State edits

function parseAddr(addr: string): { module: string; mode: 'managed' | 'data'; type: string; name: string; key?: string | number } | null {
  const m = /^((?:module\.[\w-]+\.)*)?(data\.)?([A-Za-z][\w-]*)\.([A-Za-z_][\w-]*)(?:\[(\d+|"[^"]*")\])?$/.exec(addr);
  if (!m) return null;
  const out: { module: string; mode: 'managed' | 'data'; type: string; name: string; key?: string | number } = { module: (m[1] ?? '').replace(/\.$/, ''), mode: m[2] ? 'data' : 'managed', type: m[3]!, name: m[4]! };
  if (m[5] !== undefined) out.key = m[5].startsWith('"') ? (JSON.parse(m[5]) as string) : Number(m[5]);
  return out;
}

export function addInstance(st: TfState, addr: string, provider: string, inst: StateInstance) {
  const a = parseAddr(addr)!;
  let r = st.resources.find((x) => x.module === a.module && x.mode === a.mode && x.type === a.type && x.name === a.name);
  if (!r) {
    r = { module: a.module, mode: a.mode, type: a.type, name: a.name, provider, instances: [] };
    st.resources.push(r);
  }
  if (a.key !== undefined) {
    inst.key = a.key;
    r.each = typeof a.key === 'number' ? 'list' : 'map';
  }
  r.instances = r.instances.filter((i) => i.key !== a.key || i.deposed);
  r.instances.push(inst);
}

export function removeInstance(st: TfState, addr: string): StateInstance | null {
  const a = parseAddr(addr);
  if (!a) return null;
  const r = st.resources.find((x) => x.module === a.module && x.mode === a.mode && x.type === a.type && x.name === a.name);
  if (!r) return null;
  const i = r.instances.find((x) => x.key === a.key && !x.deposed);
  if (!i) return null;
  r.instances = r.instances.filter((x) => x !== i);
  if (!r.instances.length) st.resources = st.resources.filter((x) => x !== r);
  return i;
}

/** Move a resource or instance in the state (moved blocks, `tofu state mv`). */
function moveInState(st: TfState, from: string, to: string): number {
  const insts = listInstances(st).filter((x) => x.addr === from || x.addr.startsWith(`${from}[`));
  if (!insts.length) return 0;
  if (listInstances(st).some((x) => x.addr === to || x.addr.startsWith(`${to}[`))) return 0;
  for (const x of insts) {
    removeInstance(st, x.addr);
    const suffix = x.addr.slice(from.length);
    addInstance(st, to + suffix, x.res.provider, { ...x.inst });
  }
  return insts.length;
}

// ---------------------------------------------------------------------------
// plan / apply / destroy / refresh commands

const PLAN_VALUE_FLAGS = ['out', 'var', 'var-file', 'target', 'replace', 'lock-timeout', 'parallelism', 'state', 'exclude'];
const PLAN_BOOL_FLAGS = ['destroy', 'refresh-only', 'refresh', 'input', 'no-color', 'lock', 'compact-warnings', 'detailed-exitcode', 'auto-approve', 'json', 'concise'];

function flagError(s: Sess, bad: string, cmd: string) {
  const msg = bad.startsWith('flag ') ? bad : `flag provided but not defined: ${bad}`;
  text(s, `\nError: Failed to parse command-line flags\n\n${msg}\n\nFor more help on using this command, run:\n  tofu ${cmd} -help`);
  s.exit = 1;
  s.explain = { key: 'tofu.err.flag' };
}

function optsFrom(f: Flags, argv: string[], kind: PlanOpts['kind'], line: string, answered: Record<string, string>): PlanOpts {
  return {
    kind,
    replace: f.values.replace ?? [],
    exclude: f.values.exclude ?? [],
    refresh: !f.bools.has('refresh=false'),
    targets: f.values.target ?? [],
    vars: varArgs(f, argv),
    input: !f.bools.has('input=false'),
    line,
    answered,
  };
}

function badTargets(s: Sess, targets: string[], cmd: string): boolean {
  for (const t of targets) {
    if (parseAddr(t) || /^(module\.[\w-]+)(\.module\.[\w-]+)*$/.test(t)) continue;
    text(s, `\nError: Invalid target "${t}"\n\nResource specification must include a resource type and name.\n\nFor more help on using this command, run:\n  tofu ${cmd} -help`);
    s.exit = 1;
    return true;
  }
  return false;
}

const TARGET_WARNING = 'You are creating a plan with either the -target option or the -exclude\noption, which means that the result of this plan may not represent all of the\nchanges requested by the current configuration.\n\nThe -target and -exclude options are not for routine use, and are provided\nonly for exceptional situations such as recovering from errors or mistakes,\nor when OpenTofu specifically suggests to use it as part of an error message.';

/** Count of each action for "Plan: X to add, …". */
function counts(p: Plan) {
  let add = 0;
  let change = 0;
  let destroy = 0;
  let imp = 0;
  for (const c of p.changes) {
    if (c.importId !== undefined) imp++;
    if (c.action === 'create') add++;
    else if (c.action === 'update') change++;
    else if (c.action === 'delete') destroy++;
    else if (c.action === 'replace') {
      add++;
      destroy++;
    }
  }
  return { add, change, destroy, import: imp };
}

function visibleChanges(p: Plan): Change[] {
  return p.changes.filter((c) => c.action !== 'noop' || c.movedFrom || c.importId !== undefined);
}

/** The plan body (shared by plan, apply, destroy and show <planfile>). */
function renderPlanBody(s: Sess, p: Plan, partial = false): { any: boolean } {
  const vis = visibleChanges(p);
  const outs = changedOutputs(p);
  if (!vis.length && !outs.length) return { any: false };
  if (vis.length) {
    const acts = new Set(vis.map((c) => (c.action === 'replace' ? (c.cbd ? 'cbd' : 'replace') : c.action)));
    const legend: [string, string, Line[number]['c']][] = [];
    if (acts.has('create')) legend.push(['  +', ' create', 'green']);
    if (acts.has('update')) legend.push(['  ~', ' update in-place (current -> planned)', 'yellow']);
    if (acts.has('delete')) legend.push(['  -', ' destroy', 'red']);
    if (acts.has('replace')) legend.push(['-/+', ' destroy and then create replacement', 'yellow']);
    if (acts.has('cbd')) legend.push(['+/-', ' create replacement and then destroy', 'yellow']);
    if (acts.has('read')) legend.push([' <=', ' read (data resources)', 'cyan']);
    if (legend.length) {
      s.out.push([], L('OpenTofu used the selected providers to generate the following execution'), L('plan. Resource actions are indicated with the following symbols:'));
      for (const [sym, t, c] of legend) s.out.push([{ t: sym, c }, { t }]);
    }
    s.out.push([], L(partial ? 'OpenTofu planned the following actions, but then encountered a problem:' : 'OpenTofu will perform the following actions:'));
    for (const c of vis) {
      s.out.push([]);
      s.out.push(...renderChange(c));
    }
    const n = counts(p);
    s.out.push([]);
    s.out.push([{ t: 'Plan:', c: 'bold' }, { t: ` ${n.import ? `${n.import} to import, ` : ''}${n.add} to add, ${n.change} to change, ${n.destroy} to destroy.` }]);
  }
  if (outs.length) {
    s.out.push([], L('Changes to Outputs:'));
    s.out.push(...outputChangeLines(outs, p.outputs));
  }
  // Imports and moves alone change no real infrastructure, so OpenTofu 1.12 still says this.
  if (!vis.some((c) => c.action !== 'noop') && outs.length) {
    text(s, '\nYou can apply this plan to save these new output values to the OpenTofu\nstate, without changing any real infrastructure.');
  }
  return { any: true };
}

function renderDrift(s: Sess, p: Plan) {
  if (!p.drift.length) return;
  s.out.push([], L('Note: Objects have changed outside of OpenTofu', 'bold'));
  text(s, '\nOpenTofu detected the following changes made outside of OpenTofu since the\nlast "tofu apply" which may have affected this plan:');
  for (const c of p.drift) {
    s.out.push([]);
    s.out.push(...renderChange(c, true));
  }
  s.out.push([]);
}

function noChanges(s: Sess, kind: Plan['kind'], usedTarget = false) {
  if (kind === 'destroy') text(s, '\nNo changes. No objects need to be destroyed.\n\nEither you have not created any objects yet or the existing objects were\nalready deleted outside of OpenTofu.');
  else if (kind === 'refresh') text(s, '\nNo changes. Your infrastructure still matches the configuration.\n\nOpenTofu has checked that the real remote objects still match the result of\nyour most recent changes, and found no differences.');
  else {
    // OpenTofu 1.13 dropped the paragraph that followed this line; with -target (not -exclude) it
    // adds a note instead.
    text(s, '\nNo changes. Your infrastructure matches the configuration.');
    if (usedTarget) text(s, '\nNote: You used the -target option, so OpenTofu only checked resources\nmatching those targets and may have skipped others. If you expected changes\nto appear, verify that the addresses passed to -target are correct.');
  }
}

/** Print a whole plan (progress lines, drift, body or "No changes"). Returns true when it has changes. */
function showPlan(s: Sess, p: Plan, progress: Line[]): boolean {
  s.out.push(...progress);
  if (p.kind === 'refresh') {
    if (!p.drift.length) {
      noChanges(s, 'refresh');
      return changedOutputs(p).length > 0;
    }
    renderDrift(s, p);
    text(s, '\nThis is a refresh-only plan, so OpenTofu will not take any actions to undo\nthese. If you were expecting these changes then you can apply this plan to\nrecord the updated values in the OpenTofu state without changing any remote\nobjects.');
    return true;
  }
  const { any } = renderPlanBody(s, p);
  if (!any) noChanges(s, p.kind, Boolean(p.usedTarget));
  return any;
}

export function cmdPlan(s: Sess, argv: string[], line: string, answered: Record<string, string> = {}) {
  const f = parseFlags(argv, PLAN_VALUE_FLAGS, PLAN_BOOL_FLAGS);
  if (f.bad) return flagError(s, f.bad, 'plan');
  if (f.args.length) {
    text(s, `\nError: Too many command line arguments\n\nTo specify a working directory for the plan, use the global -chdir flag.\n\nFor more help on using this command, run:\n  tofu plan -help`);
    s.exit = 1;
    return;
  }
  const config = ready(s, 'plan');
  if (!config) return;
  const kind = f.bools.has('destroy') ? 'destroy' : f.bools.has('refresh-only') ? 'refresh' : 'normal';
  const o = optsFrom(f, argv, kind, line, answered);
  if (badTargets(s, o.targets, 'plan') || badTargets(s, o.replace, 'plan') || badTargets(s, o.exclude, 'plan')) return;
  const r = makePlan(s, config, o);
  if (!r) return;
  const p = r.plan;
  const any = showPlan(s, p, r.progress);
  diags(s, r.warnings);
  // The targeting warning comes before the ruler and the "-out" note (real OpenTofu 1.13.5).
  if (p.targeted) diags(s, [warn('Resource targeting is in effect', TARGET_WARNING)]);
  const out = f.values.out?.[0];
  if (any || out) {
    s.out.push([], L(RULER), []);
    if (out) {
      s.st.plans[out] = p;
      s.st.files[out] = PLAN_FILE_MARK;
      s.events.push({ type: 'fileWritten', path: out });
      s.out.push(L(`Saved the plan to: ${out}`), [], L('To perform exactly these actions, run the following command to apply:'), L(`    tofu apply "${out}"`));
    } else {
      s.out.push(L('Note: You didn\'t use the -out option to save this plan, so OpenTofu can\'t'), L('guarantee to take exactly these actions if you run "tofu apply" now.'));
    }
  }
  const n = counts(p);
  s.st.lastPlan = planMarks(p);
  s.events.push({ type: 'planned', add: n.add, change: n.change, destroy: n.destroy, import: n.import, actions: s.st.lastPlan });
  s.explain = { key: any ? (kind === 'destroy' ? 'tofu.explain.planDestroy' : 'tofu.explain.plan') : 'tofu.explain.noChanges', params: { add: n.add, change: n.change, destroy: n.destroy } };
  if (f.bools.has('detailed-exitcode') && any) s.exit = 2;
}

/** What the picture marks after a plan: address → action. */
function planMarks(p: Plan): Record<string, string> {
  return Object.fromEntries(p.changes.filter((c) => c.action !== 'noop' && c.mode === 'managed').map((c) => [c.addr, c.action === 'replace' ? (c.cbd ? 'cbd' : 'replace') : c.action]));
}

/** The placeholder content of a saved plan file (real ones are zip files). */
export const PLAN_FILE_MARK = '\u0000PK (binary plan file: read it with tofu show)';

export function cmdApply(s: Sess, argv: string[], line: string, cmd: 'apply' | 'destroy' | 'refresh', answered: Record<string, string> = {}) {
  const f = parseFlags(argv, PLAN_VALUE_FLAGS, PLAN_BOOL_FLAGS);
  if (f.bad) return flagError(s, f.bad, cmd);
  const config = ready(s, cmd);
  if (!config) return;
  let p: Plan;
  const planFile = cmd === 'apply' ? f.args[0] : undefined;
  if (planFile !== undefined) {
    p = s.st.plans[planFile]!;
    if (!p) {
      text(s, `\nError: Failed to load "${planFile}" as a plan file\n\nError: stat ${planFile}: no such file or directory`);
      s.exit = 1;
      s.explain = { key: 'tofu.err.noPlanFile' };
      return;
    }
    const cur = parseState(s.st.files[STATE_FILE]);
    if ((cur?.serial ?? 0) !== p.serial || (cur && cur.lineage !== p.lineage && p.serial !== 0)) {
      diags(s, [err('Saved plan is stale', 'The given plan file can no longer be applied because the state was changed by another operation after the plan was created.')]);
      s.explain = { key: 'tofu.err.stale' };
      return;
    }
  } else {
    if (f.args.length) {
      text(s, `\nError: Failed to load "${f.args[0]}" as a plan file\n\nError: stat ${f.args[0]}: no such file or directory`);
      s.exit = 1;
      return;
    }
    const kind: Plan['kind'] = cmd === 'destroy' || f.bools.has('destroy') ? 'destroy' : cmd === 'refresh' || f.bools.has('refresh-only') ? 'refresh' : 'normal';
    const o = optsFrom(f, argv, kind, line, answered);
    if (badTargets(s, o.targets, cmd) || badTargets(s, o.exclude, cmd)) return;
    const r = makePlan(s, config, o);
    if (!r) return;
    p = r.plan;
    const any = cmd === 'refresh' ? (s.out.push(...r.progress), false) : showPlan(s, p, r.progress);
    diags(s, r.warnings);
    const auto = f.bools.has('auto-approve') || cmd === 'refresh';
    if (any && !auto && (visibleChanges(p).length || p.kind === 'refresh' || changedOutputs(p).length)) {
      if (p.kind === 'destroy') text(s, '\nDo you really want to destroy all resources?\n  OpenTofu will destroy all your managed infrastructure, as shown above.\n  There is no undo. Only \'yes\' will be accepted to confirm.', 'bold');
      else text(s, '\nDo you want to perform these actions?\n  OpenTofu will perform the actions described above.\n  Only \'yes\' will be accepted to approve.', 'bold');
      s.out.push([]);
      s.st.pending = { kind: 'approve', command: cmd === 'destroy' ? 'destroy' : 'apply', plan: p, line, flags: {} };
      s.st.lastPlan = planMarks(p);
      s.events.push({ type: 'waiting', for: 'approve' });
      s.stopped = true;
      s.explain = { key: p.kind === 'destroy' ? 'tofu.explain.askDestroy' : 'tofu.explain.askApply' };
      return;
    }
  }
  runApply(s, config, p, cmd === 'destroy' ? 'destroy' : 'apply');
}

/** After "yes": carry out a plan. */
export function runApply(s: Sess, config: Config, p: Plan, cmd: 'apply' | 'destroy') {
  const files = s.st.files;
  const fctx = fileCtx(s.st, files);
  const before = files[STATE_FILE];
  const prevState = parseState(before);
  const work = parseState(p.prior) ?? emptyState(p.lineage);
  work.lineage = p.lineage;
  const vars = Object.fromEntries(Object.entries(p.vars).map(([k, x]) => [k, fromVarJson(x)]));
  const lines: Line[] = [];
  const pr = progressPrinter(lines);
  const errs: Diag[] = [];
  const done = { add: 0, change: 0, destroy: 0, import: 0 };

  const changes = p.changes;
  const depsOf = new Map<string, string[]>();
  {
    const w = new Walker({ mode: 'apply', config, vars, state: work, files: fctx });
    for (const c of changes) {
      const decl = declFor(config, c);
      const mod = config.all.find((m) => m.path === c.module);
      depsOf.set(c.addr, decl && mod ? w.resourceDeps(mod, decl) : c.deps);
    }
  }
  const resOf = (addr: string) => addr.replace(/\[[^\]]*\]$/, '');
  const order = topo(changes, depsOf);

  // Imports first (they are part of the refresh in real OpenTofu's apply).
  for (const c of order) {
    if (c.importId === undefined) continue;
    pr(c.addr, `Importing... [id=${c.importId}]`);
    pr(c.addr, `Import complete [id=${c.importId}]`);
    done.import++;
  }
  // Phase A: destroy (dependents first).
  for (const c of [...order].reverse()) {
    if (c.mode !== 'managed') continue;
    if (!(c.action === 'delete' || (c.action === 'replace' && !c.cbd))) continue;
    destroyOne(c, work, fctx, pr);
    if (c.action === 'delete') done.destroy++;
  }
  // Phase B: create / update / read.
  const deposed: { c: Change; inst: StateInstance; key: string }[] = [];
  for (const c of order) {
    if (c.action === 'delete' || c.action === 'noop') continue;
    const decl = declFor(config, c);
    const mod = config.all.find((m) => m.path === c.module);
    if (!decl || !mod) continue;
    const rt = schemaFor(c.mode, c.type)!;
    const w = new Walker({ mode: 'apply', config, vars, state: work, files: fctx });
    const exp = w.expand(mod, decl).find((e) => e.key === c.key) ?? { locals: {} };
    try {
      const cfg = w.configValues(mod, decl, rt, exp.locals);
      if (c.mode === 'data') {
        pr(c.addr, 'Reading...');
        const res = rt.readData!(cfg, fctx);
        addInstance(work, c.addr, rt.provider, { schemaVersion: rt.schemaVersion, attrs: fullObject(rt, res).v as Record<string, Val>, sensitive: [], deps: [] });
        pr(c.addr, `Read complete after 0s [id=${String(res.id?.v)}]`);
        continue;
      }
      const priorInst = listInstances(work).find((x) => x.addr === c.addr)?.inst ?? null;
      if (c.action === 'replace' && c.cbd && priorInst) {
        const key = Array.from(fctx.rng.bytes(4), (x) => x.toString(16).padStart(2, '0')).join('');
        deposed.push({ c, inst: priorInst, key });
        removeInstance(work, c.addr);
      }
      const prior = c.action === 'update' ? priorInst?.attrs ?? null : null;
      const ip = planInstance(rt, decl, cfg, prior);
      const verb = c.action === 'update' ? ['Modifying...', 'Modifications complete after 0s'] : ['Creating...', 'Creation complete after 0s'];
      pr(c.addr, c.action === 'update' ? `${verb[0]} [id=${String(priorInst?.attrs.id?.v)}]` : verb[0]!);
      const applied = rt.apply ? rt.apply(ip.planned, prior, fctx) : ip.planned;
      for (const [k, x] of Object.entries(applied)) if (isUnknown(x)) applied[k] = { ty: x.ty, v: null };
      const sens = sensPathsOf(rt, applied);
      const clean = Object.fromEntries(Object.entries(applied).map(([k, x]) => [k, unmarkDeep(x)]));
      addInstance(work, c.addr, rt.provider, {
        schemaVersion: rt.schemaVersion,
        attrs: clean,
        sensitive: sens,
        deps: depsOf.get(c.addr) ?? [],
        ...(decl.lifecycle.createBeforeDestroy ? { cbd: true } : {}),
      });
      pr(c.addr, `${verb[1]} [id=${String(clean.id?.v ?? '')}]`);
      if (c.action === 'create') done.add++;
      else if (c.action === 'update') done.change++;
      else if (c.action === 'replace') {
        done.add++;
        done.destroy++;
      }
    } catch (e) {
      if (e instanceof DiagError) errs.push(...e.diags.map((d) => ({ ...d, address: c.addr })));
      else if (e instanceof ProviderError) errs.push(err(e.summary, e.detail, decl.range, { address: c.addr }));
      else throw e;
      break;
    }
  }
  // Phase C: deposed objects (create_before_destroy).
  for (const d of [...deposed].reverse()) {
    pr(`${d.c.addr} (deposed object ${d.key})`, `Destroying... [id=${String(d.inst.attrs.id?.v)}]`);
    schemaFor('managed', d.c.type)?.destroy?.(d.inst.attrs, fctx);
    pr(d.c.addr, 'Destruction complete after 0s');
  }
  void resOf;

  // Outputs and checks.
  const ow = new Walker({ mode: 'apply', config, vars, state: work, files: fctx });
  // A targeted destroy keeps the saved outputs (real OpenTofu leaves them as they were).
  if (!(p.kind === 'destroy' && p.targeted)) work.outputs = {};
  if (p.kind !== 'destroy') {
    for (const [name, decl] of Object.entries(config.root.outputs)) {
      try {
        const v = ow.output(config.root, name);
        if (v.v === null && !decl.sensitive) continue;
        work.outputs[name] = { value: unmarkDeep(v), sensitive: decl.sensitive };
      } catch (e) {
        if (e instanceof DiagError) errs.push(...e.diags);
        else throw e;
      }
    }
  }
  if (p.kind === 'destroy') work.resources = work.resources.filter((r) => r.mode !== 'data' && r.instances.length);
  work.checks = p.checks.length && p.kind !== 'destroy' ? p.checks : null;
  s.st.seed = fctx.seed();
  // Save the state (serial +1 when anything changed).
  const old = prevState ?? emptyState(work.lineage);
  if (!prevState || !sameState(old, work)) {
    work.serial = (prevState?.serial ?? 0) + 1;
    // OpenTofu 1.13 writes backups in the same indented layout as the state file (1.12: one line).
    if (prevState) files[BACKUP_FILE] = serializeState(prevState);
    files[STATE_FILE] = serializeState(work);
    s.events.push({ type: 'stateChanged' });
  }
  s.out.push(...lines);
  if (errs.length) {
    diags(s, errs);
    s.explain = { key: 'tofu.err.applyFailed' };
    return;
  }
  if (p.targeted) {
    diags(s, [
      warn('Resource targeting is in effect', TARGET_WARNING),
      warn('Applied changes may be incomplete', 'The plan was created with the -target or the -exclude option in effect, so\nsome changes requested in the configuration may have been ignored and the\noutput values may not be fully updated. Run the following command to verify\nthat no other changes are pending:\n    tofu plan\n\t\nNote that the -target and -exclude options are not suitable for routine use,\nand are provided only for exceptional situations such as recovering from\nerrors or mistakes, or when OpenTofu specifically suggests to use it as part\nof an error message.'),
    ]);
  }
  s.out.push([]);
  if (cmd === 'destroy') s.out.push([{ t: `Destroy complete! Resources: ${done.destroy} destroyed.`, c: 'green' }]);
  else s.out.push([{ t: `Apply complete! Resources: ${done.import ? `${done.import} imported, ` : ''}${done.add} added, ${done.change} changed, ${done.destroy} destroyed.`, c: 'green' }]);
  if (p.kind !== 'destroy' && Object.keys(work.outputs).length) {
    s.out.push([], L('Outputs:', 'green'), []);
    s.out.push(...outputLines(Object.entries(work.outputs).map(([name, o]) => ({ name, value: o.value, sensitive: o.sensitive }))));
  }
  s.st.lastPlan = null;
  s.events.push({ type: 'applied', ...done });
  s.explain = { key: cmd === 'destroy' ? 'tofu.explain.destroyed' : 'tofu.explain.applied', params: { add: done.add, change: done.change, destroy: done.destroy } };
}

function destroyOne(c: Change, work: TfState, fctx: FileCtx, pr: Progress) {
  const inst = listInstances(work).find((x) => x.addr === c.addr);
  if (!inst) return;
  pr(c.addr, `Destroying... [id=${String(inst.inst.attrs.id?.v ?? '')}]`);
  schemaFor('managed', c.type)?.destroy?.(inst.inst.attrs, fctx);
  removeInstance(work, c.addr);
  pr(c.addr, 'Destruction complete after 0s');
}

/** Dependency order (dependencies first), alphabetical among equals. */
function topo(changes: Change[], depsOf: Map<string, string[]>): Change[] {
  const byRes = new Map<string, Change[]>();
  for (const c of changes) {
    const r = c.addr.replace(/\[[^\]]*\]$/, '');
    (byRes.get(r) ?? byRes.set(r, []).get(r)!).push(c);
  }
  const out: Change[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();
  const visit = (c: Change) => {
    if (done.has(c.addr) || visiting.has(c.addr)) return;
    visiting.add(c.addr);
    for (const d of depsOf.get(c.addr) ?? []) for (const dc of byRes.get(d) ?? []) visit(dc);
    visiting.delete(c.addr);
    done.add(c.addr);
    out.push(c);
  };
  for (const c of [...changes].sort((a, b) => (a.addr < b.addr ? -1 : 1))) visit(c);
  return out;
}

function unmarkDeep(v: Val): Val {
  const out: Val = { ty: v.ty, v: v.v };
  if (Array.isArray(v.v)) out.v = v.v.map(unmarkDeep);
  else if (v.v && typeof v.v === 'object' && !('unknown' in v.v && (v.v as { unknown?: unknown }).unknown === true)) out.v = Object.fromEntries(Object.entries(v.v as Record<string, Val>).map(([k, x]) => [k, unmarkDeep(x)]));
  return out;
}

function fromVarJson(x: unknown): Val {
  const j = x as { value: unknown; type: unknown };
  return convertJson(j.value, j.type);
}

import { fromJson, tyFromJson } from './values';
function convertJson(value: unknown, type: unknown): Val {
  return fromJson(value, tyFromJson(type));
}

// ---------------------------------------------------------------------------
// validate, show, output, state, import, providers, version

export function cmdValidate(s: Sess, argv: string[]) {
  const f = parseFlags(argv, ['var', 'var-file', 'test-directory'], ['no-color', 'json', 'no-tests', 'compact-warnings']);
  if (f.bad) return flagError(s, f.bad, 'validate');
  const config = ready(s, 'validate');
  if (!config) return;
  const ds = validateConfig(config, markSensitiveVars(config, {}), fileCtx(s.st, { ...s.st.files }));
  if (ds.some((d) => d.severity === 'error')) {
    diags(s, ds);
    s.events.push({ type: 'validated', ok: false });
    s.explain = { key: 'tofu.err.invalid' };
    return;
  }
  diags(s, ds);
  s.out.push([{ t: 'Success!', c: 'green' }, { t: ' The configuration is valid.' }]);
  s.events.push({ type: 'validated', ok: true });
  s.explain = { key: 'tofu.explain.valid' };
}

function stateNow(s: Sess): TfState | null {
  return parseState(s.st.files[STATE_FILE]);
}

export function cmdShow(s: Sess, argv: string[]) {
  const f = parseFlags(argv, ['plan', 'var', 'var-file'], ['no-color', 'json', 'show-sensitive', 'state', 'config']);
  if (f.bad) return flagError(s, f.bad, 'show');
  const planName = f.values.plan?.[0] ?? f.args[0];
  if (planName !== undefined) {
    const p = s.st.plans[planName];
    if (!p) {
      text(s, `\nError: Failed to read the given file as a state or plan file\n\nState read error: Error loading statefile: open ${planName}: no such file or directory\n\nPlan read error: open ${planName}: no such file or directory`);
      s.exit = 1;
      return;
    }
    const any = showPlan(s, p, []);
    void any;
    s.explain = { key: 'tofu.explain.showPlan' };
    return;
  }
  const st = stateNow(s);
  if (f.bools.has('json')) {
    s.out.push(L(showJson(st)));
    return;
  }
  if (!st || (!st.resources.length && !Object.keys(st.outputs).length)) {
    s.out.push(L('No state.'));
    s.explain = { key: 'tofu.explain.noState' };
    return;
  }
  const items = listInstances(st);
  items.forEach((x, i) => {
    if (i) s.out.push([]);
    s.out.push(...renderStateResource(x.addr, x.res.mode, x.res.type, x.res.name, x.inst.attrs, x.inst.sensitive.map((p) => String(p[0]))));
  });
  if (Object.keys(st.outputs).length) {
    s.out.push([], [], L('Outputs:'), []);
    s.out.push(...showOutputLines(Object.entries(st.outputs).map(([name, o]) => ({ name, value: o.value, sensitive: o.sensitive }))));
  }
  s.explain = { key: 'tofu.explain.show' };
}

function showJson(st: TfState | null): string {
  if (!st) return goJson({ format_version: '1.0' }, '');
  const outputs = Object.fromEntries(Object.keys(st.outputs).sort().map((n) => [n, { sensitive: st.outputs[n]!.sensitive, value: toJson(st.outputs[n]!.value), type: tyJson(st.outputs[n]!.value.ty) }]));
  const resources = listInstances(st)
    .filter((x) => !x.res.module)
    .map((x) => {
      const rt = schemaFor(x.res.mode, x.res.type);
      const values = Object.fromEntries((rt ? attrNames(rt) : Object.keys(x.inst.attrs).sort()).map((n) => [n, x.inst.attrs[n] ? toJson(x.inst.attrs[n]!) : null]));
      const sv: Record<string, boolean> = {};
      if (rt) for (const [n, a] of Object.entries(rt.attrs)) if (a.sensitive) sv[n] = true;
      return {
        address: x.addr,
        mode: x.res.mode,
        type: x.res.type,
        name: x.res.name,
        ...(x.inst.key !== undefined ? { index: x.inst.key } : {}),
        provider_name: x.res.provider,
        schema_version: x.inst.schemaVersion,
        values,
        sensitive_values: sv,
        ...(x.inst.deps.length ? { depends_on: x.inst.deps } : {}),
      };
    });
  return goJson({ format_version: '1.0', terraform_version: TOFU_VERSION, values: { outputs, root_module: { resources } } }, '');
}

export function cmdOutput(s: Sess, argv: string[]) {
  const f = parseFlags(argv, ['state', 'var', 'var-file'], ['no-color', 'json', 'raw', 'show-sensitive']);
  if (f.bad) return flagError(s, f.bad, 'output');
  const st = stateNow(s);
  const outs = st?.outputs ?? {};
  const name = f.args[0];
  if (!Object.keys(outs).length) {
    if (f.bools.has('json')) {
      s.out.push(L('{}'));
      return;
    }
    text(s, '\nWarning: No outputs found\n\nThe state file either has no outputs defined, or all the defined outputs are\nempty. Please define an output in your configuration with the `output`\nkeyword and run `tofu refresh` for it to become available. If you are using\ninterpolation, please verify the interpolated value is not empty. You can use\nthe `tofu console` command to assist.');
    s.explain = { key: 'tofu.explain.noOutputs' };
    return;
  }
  if (name !== undefined) {
    const o = outs[name];
    if (!o) {
      diags(s, [err(`Output "${name}" not found`, 'The output variable requested could not be found in the state file. If you recently added this to your configuration, be sure to run `tofu apply`, since the state won\'t be updated with new output variables until that command is run.')]);
      s.explain = { key: 'tofu.err.noOutput', params: { name } };
      return;
    }
    if (f.bools.has('json')) s.out.push(...goJson(toJson(o.value)).split('\n').map((l) => L(l)));
    else if (f.bools.has('raw')) {
      if (typeof o.value.v !== 'string' && typeof o.value.v !== 'number' && typeof o.value.v !== 'boolean') {
        text(s, `\nError: Unsupported value for raw output\n\nThe -raw option only supports strings, numbers, and boolean values, but output\nvalue "${name}" is ${o.value.ty.k === 'object' || o.value.ty.k === 'map' ? 'object' : o.value.ty.k}.\n\nUse the -json option for machine-readable representations of output values\nthat have complex types.`);
        s.exit = 1;
        return;
      }
      // -raw prints the bare value (and no newline at the end).
      const t = typeof o.value.v === 'string' ? o.value.v.replace(/\n$/, '') : String(o.value.v);
      for (const p of t.split('\n')) s.out.push(L(p));
    } else for (const l of formatOutput(o.value).split('\n')) s.out.push(L(l));
    s.explain = { key: 'tofu.explain.output', params: { name } };
    return;
  }
  if (f.bools.has('json')) {
    const j = Object.fromEntries(Object.keys(outs).sort().map((n) => [n, { sensitive: outs[n]!.sensitive, type: tyJson(outs[n]!.value.ty), value: toJson(outs[n]!.value) }]));
    s.out.push(...goJson(j).split('\n').map((l) => L(l)));
  } else s.out.push(...outputLines(Object.entries(outs).map(([n, o]) => ({ name: n, value: o.value, sensitive: o.sensitive }))));
  s.explain = { key: 'tofu.explain.outputs' };
}

function stateErr(s: Sess, summary: string, detail: string) {
  const was = s.color;
  s.color = true; // `tofu state …` errors always use the gutter, even with -no-color
  diags(s, [err(summary, detail)]);
  s.color = was;
}

export function cmdState(s: Sess, argv: string[]) {
  const sub = argv[0];
  const rest = argv.slice(1);
  const st = stateNow(s);
  if (['list', 'ls', 'show', 'mv', 'move', 'rm', 'remove'].includes(sub ?? '') && !st) {
    stateErr(s, 'No state file was found', 'State management commands require a state file. Run this command in a directory where OpenTofu has been run or use the -state flag to point the command to a specific state location.');
    s.explain = { key: 'tofu.err.noState' };
    return;
  }
  if (sub === 'list' || sub === 'ls') {
    const f = parseFlags(rest, ['state', 'id', 'var', 'var-file'], ['json']);
    if (!st) return;
    let items = listInstances(st);
    if (f.args.length) {
      items = items.filter((x) => f.args.some((a) => x.addr === a || x.addr.startsWith(`${a}[`) || x.addr.startsWith(`${a}.`)));
    }
    for (const x of items) s.out.push(L(x.addr));
    s.explain = { key: 'tofu.explain.stateList', params: { n: items.length } };
    return;
  }
  if (sub === 'show') {
    const addr = rest.filter((a) => !a.startsWith('-'))[0];
    if (!addr) {
      stateErr(s, 'Exactly one argument expected', 'The state show command requires exactly one argument: the address of the resource instance to show.');
      return;
    }
    const x = st ? listInstances(st).find((i) => i.addr === addr) : undefined;
    if (!x) {
      stateErr(s, 'No instance found for the given address', 'This command requires that the address references one specific instance. To view the available instances, use "tofu state list". Please modify the address to reference a specific instance.');
      s.explain = { key: 'tofu.err.noInstance', params: { addr } };
      return;
    }
    s.out.push(...renderStateResource(x.addr, x.res.mode, x.res.type, x.res.name, x.inst.attrs, x.inst.sensitive.map((p) => String(p[0]))));
    s.explain = { key: 'tofu.explain.stateShow' };
    return;
  }
  if (sub === 'mv' || sub === 'move' || sub === 'rm' || sub === 'remove') {
    const f = parseFlags(rest, ['state', 'state-out', 'backup', 'lock-timeout', 'var', 'var-file'], ['dry-run', 'lock', 'ignore-remote-version', 'json']);
    if (!st) return;
    const before = serializeState(st);
    if (sub === 'mv' || sub === 'move') {
      const [from, to] = f.args;
      if (!from || !to || f.args.length !== 2) {
        stateErr(s, 'Exactly two arguments expected', 'The state mv command requires exactly two arguments: the source and destination addresses.');
        return;
      }
      const all = listInstances(st);
      const found = all.filter((x) => x.addr === from || x.addr.startsWith(`${from}[`));
      if (!found.length) {
        stateErr(s, 'Invalid source address', `Cannot move ${from}: does not match anything in the current state.`);
        return;
      }
      if (all.some((x) => x.addr === to || x.addr.startsWith(`${to}[`))) {
        stateErr(s, 'Invalid target address', `Cannot move to ${to}: there is already a resource instance at that address in the current state.`);
        return;
      }
      if (f.bools.has('dry-run')) {
        s.out.push(L(`Would move "${from}" to "${to}"`));
        return;
      }
      moveInState(st, from, to);
      s.out.push(L(`Move "${from}" to "${to}"`), L(`Successfully moved 1 object(s).`));
      s.explain = { key: 'tofu.explain.stateMv' };
    } else {
      if (!f.args.length) {
        stateErr(s, 'Invalid target address', 'At least one address is required.');
        return;
      }
      const all = listInstances(st);
      let n = 0;
      const lines: string[] = [];
      for (const a of f.args) {
        const found = all.filter((x) => x.addr === a || x.addr.startsWith(`${a}[`) || x.addr.startsWith(`${a}.`));
        if (!found.length) {
          stateErr(s, 'Invalid target address', `No matching objects found. To view the available instances, use "tofu state list". Please modify the address to reference a specific instance.`);
          return;
        }
        for (const x of found) {
          if (!f.bools.has('dry-run')) removeInstance(st, x.addr);
          lines.push(`${f.bools.has('dry-run') ? 'Would remove' : 'Removed'} ${x.addr}`);
          n++;
        }
      }
      for (const l of lines) s.out.push(L(l));
      if (f.bools.has('dry-run')) return;
      s.out.push(L(`Successfully removed ${n} resource instance(s).`));
      s.explain = { key: 'tofu.explain.stateRm' };
    }
    st.serial++;
    s.st.files[`terraform.tfstate.${s.st.clock}.backup`] = before;
    s.st.files[STATE_FILE] = serializeState(st);
    s.events.push({ type: 'stateChanged' });
    return;
  }
  if (sub === 'pull') {
    for (const l of (s.st.files[STATE_FILE] ?? '').replace(/\n$/, '').split('\n')) s.out.push(L(l));
    return;
  }
  text(s, 'Usage: tofu [global options] state <subcommand> [options] [args]\n\n  This command has subcommands for advanced state management.\n\n  These subcommands can be used to slice and dice the OpenTofu state.\n  This is sometimes necessary in advanced cases. For your safety, all\n  state management commands that modify the state create a timestamped\n  backup of the state prior to making modifications.\n\n  The structure and output of the commands is specifically tailored to work\n  well with the common Unix utilities such as grep, awk, etc. We recommend\n  using those tools to perform more advanced state tasks.\n\nSubcommands:\n    list                List resources in the state\n    mv                  Move an item in the state\n    pull                Pull current state and output to stdout\n    push                Update remote state from a local state file\n    replace-provider    Replace provider in the state\n    rm                  Remove instances from the state\n    show                Show a resource in the state');
  s.exit = sub ? 1 : 0;
}

/**
 * A CLI import also works out the root outputs and saves them in the state, like real OpenTofu.
 * What isn't built yet is unknown, and the state keeps an unknown value as null (with its type):
 * `tofu output` then prints it as `tostring(null)`.
 */
function importOutputs(s: Sess, config: Config, st: TfState, f: Flags, argv: string[]) {
  const quiet: Sess = { ...s, out: [], events: [], exit: 0 };
  const v = rootVars(quiet, config, varArgs(f, argv), {});
  if (!v || v.missing.length || Object.keys(v.bad).length) return;
  const w = new Walker({ mode: 'apply', config, vars: v.values, state: st, files: fileCtx(s.st, { ...s.st.files }) });
  const outputs: TfState['outputs'] = {};
  for (const [name, decl] of Object.entries(config.root.outputs)) {
    try {
      outputs[name] = { value: unknownAsNull(unmarkDeep(w.output(config.root, name))), sensitive: decl.sensitive };
    } catch (e) {
      if (!(e instanceof DiagError)) throw e;
    }
  }
  st.outputs = outputs;
}

/** cty's UnknownAsNull: unknown parts become null of the same type. */
function unknownAsNull(v: Val): Val {
  if (isUnknown(v)) return { ty: v.ty, v: null };
  if (Array.isArray(v.v)) return { ...v, v: v.v.map(unknownAsNull) };
  if (v.v !== null && typeof v.v === 'object') return { ...v, v: Object.fromEntries(Object.entries(v.v as Record<string, Val>).map(([k, x]) => [k, unknownAsNull(x)])) };
  return v;
}

export function cmdImport(s: Sess, argv: string[]) {
  const f = parseFlags(argv, ['config', 'var', 'var-file', 'lock-timeout', 'state', 'state-out', 'backup'], ['input', 'lock', 'no-color', 'ignore-remote-version', 'compact-warnings', 'json']);
  if (f.bad) return flagError(s, f.bad, 'import');
  const [addr, id] = f.args;
  if (!addr || id === undefined || f.args.length !== 2) {
    text(s, 'The import command expects two arguments.\nUsage: tofu [global options] import [options] ADDR ID');
    s.exit = 1;
    return;
  }
  const config = ready(s, 'import');
  if (!config) return;
  const a = parseAddr(addr);
  const decl = a ? declFor(config, a) : undefined;
  if (!a || !decl) {
    diags(s, [err('Configuration for import target does not exist', `The configuration for the given import target ${addr} does not exist. All target instances must have an associated configuration to be imported.`)]);
    return;
  }
  const st = stateNow(s) ?? emptyState(uuidFrom(fileCtx(s.st, { ...s.st.files })));
  if (listInstances(st).some((x) => x.addr === addr)) {
    diags(s, [err('Resource already managed by OpenTofu', `OpenTofu is already managing a remote object for ${addr}. To import to this address you must first remove the existing object from the state.`)]);
    return;
  }
  const rt = schemaFor(a.mode, a.type);
  if (!rt?.importId) {
    diags(s, [err('Resource Import Not Implemented', 'This resource does not support import. Please contact the provider developer for additional information.')]);
    return;
  }
  let attrs: Record<string, Val>;
  try {
    attrs = rt.importId(id);
  } catch (e) {
    if (e instanceof ProviderError) {
      diags(s, [err(e.summary, e.detail)]);
      return;
    }
    throw e;
  }
  s.out.push(L(`${addr}: Importing from ID "${id}"...`, 'bold'), L(`${addr}: Import prepared!`, 'green'), L(`  Prepared ${a.type} for import`), L(`${addr}: Refreshing state... [id=${String(attrs.id?.v ?? id)}]`, 'bold'));
  const prev = parseState(s.st.files[STATE_FILE]);
  addInstance(st, addr, rt.provider, { schemaVersion: rt.schemaVersion, attrs, sensitive: [], deps: [] });
  importOutputs(s, config, st, f, argv);
  st.serial++;
  if (prev) s.st.files[BACKUP_FILE] = serializeState(prev);
  s.st.files[STATE_FILE] = serializeState(st);
  s.events.push({ type: 'stateChanged' });
  s.out.push([], L('Import successful!', 'green'), [], L('The resources that were imported are shown above. These resources are now in'), L('your OpenTofu state and will henceforth be managed by OpenTofu.'), []);
  s.explain = { key: 'tofu.explain.imported' };
}

export function cmdProviders(s: Sess) {
  const { config, diags: ds } = loadConfig(s.st.files);
  if (ds.some((d) => d.severity === 'error')) {
    diags(s, ds);
    return;
  }
  s.out.push([], L('Providers required by configuration:'), L('.'));
  const lines: string[] = [];
  const walk = (m: Module, indent: string) => {
    const ps = new Set<string>();
    for (const r of Object.values(m.resources)) ps.add(providerOf(r.type));
    for (const p of Object.keys(m.requiredProviders)) ps.add(p);
    const items: { label: string; mod?: Module }[] = [...ps]
      .map((p) => {
        const ver = m.requiredProviders[p]?.version;
        return { label: `provider[${PROVIDERS[p]?.source ?? `registry.opentofu.org/hashicorp/${p}`}]${ver ? ` ${ver}` : ''}` };
      });
    for (const c of Object.values(m.children).sort((a, b) => (a.path < b.path ? -1 : 1))) items.push({ label: c.path.split('.').slice(-2).join('.'), mod: c });
    items.forEach((it, i) => {
      const last = i === items.length - 1;
      lines.push(`${indent}${last ? '└── ' : '├── '}${it.label}`);
      if (it.mod) walk(it.mod, `${indent}${last ? '    ' : '│   '}`);
    });
  };
  walk(config.root, '');
  for (const l of lines) s.out.push(L(l));
  const st = stateNow(s);
  if (st && st.resources.length) {
    s.out.push([], L('Providers required by state:'), []);
    for (const p of [...new Set(st.resources.map((r) => r.provider))].sort()) s.out.push(L(`    provider[${p}]`), []);
  }
  s.out.push([]);
  s.explain = { key: 'tofu.explain.providers' };
}

export function cmdVersion(s: Sess) {
  s.out.push(L(`OpenTofu v${TOFU_VERSION}`), L('on linux_amd64'));
  const lock = parseLock(s.st.files[LOCK_FILE]);
  for (const e of lock) s.out.push(L(`+ provider registry.opentofu.org/hashicorp/${e.provider} v${e.version}`));
  s.explain = { key: 'tofu.explain.version' };
}

export { HASHES, valEq, hasUnknown, unknownObject, convertAttr, staticString, T_DYN };
