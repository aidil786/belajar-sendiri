// Read a safe subset of GitHub Actions workflow YAML into a Workflow, with kind
// validation messages (line numbers included). Unknown keys are errors, like on GitHub.
import { isMap, isPair, isScalar, isSeq, LineCounter, parseDocument, type Node as YNode, type Pair, type YAMLMap } from 'yaml';
import { KNOWN_ACTIONS, RUNNER_LABELS, isFullSha, parseUses } from './actions';
import { exprError, expressionsIn } from './expr';
import type { Concurrency, Issue, Job, Matrix, ParseResult, PermLevel, PermSpec, Scalar, Step, Triggers, Workflow } from './types';

const TOP_KEYS = new Set(['name', 'run-name', 'on', 'permissions', 'env', 'defaults', 'concurrency', 'jobs']);
const JOB_KEYS = new Set([
  'name', 'permissions', 'needs', 'if', 'runs-on', 'snapshot', 'environment', 'concurrency', 'outputs', 'env', 'defaults',
  'steps', 'timeout-minutes', 'strategy', 'continue-on-error', 'container', 'services', 'uses', 'with', 'secrets',
]);
const STEP_KEYS = new Set(['id', 'if', 'name', 'uses', 'run', 'working-directory', 'shell', 'with', 'env', 'continue-on-error', 'timeout-minutes']);
const STRATEGY_KEYS = new Set(['matrix', 'fail-fast', 'max-parallel']);
const CONCURRENCY_KEYS = new Set(['group', 'cancel-in-progress', 'queue']);
const ENV_KEYS = new Set(['name', 'url', 'deployment']);
const SERVICE_KEYS = new Set(['image', 'credentials', 'env', 'ports', 'volumes', 'options']);
export const EVENTS = new Set([
  'branch_protection_rule', 'check_run', 'check_suite', 'create', 'delete', 'deployment', 'deployment_status', 'discussion',
  'discussion_comment', 'fork', 'gollum', 'issue_comment', 'issues', 'label', 'merge_group', 'milestone', 'page_build', 'public',
  'pull_request', 'pull_request_review', 'pull_request_review_comment', 'pull_request_target', 'push', 'registry_package',
  'release', 'repository_dispatch', 'schedule', 'status', 'watch', 'workflow_call', 'workflow_dispatch', 'workflow_run',
]);
const EVENT_KEYS: Record<string, Set<string>> = {
  push: new Set(['branches', 'branches-ignore', 'tags', 'tags-ignore', 'paths', 'paths-ignore']),
  pull_request: new Set(['types', 'branches', 'branches-ignore', 'paths', 'paths-ignore']),
  pull_request_target: new Set(['types', 'branches', 'branches-ignore', 'paths', 'paths-ignore']),
  workflow_dispatch: new Set(['inputs']),
  workflow_call: new Set(['inputs', 'outputs', 'secrets']),
  workflow_run: new Set(['workflows', 'types', 'branches', 'branches-ignore']),
};
export const PERMISSION_SCOPES = new Set([
  'actions', 'artifact-metadata', 'attestations', 'checks', 'code-quality', 'contents', 'copilot-requests', 'deployments',
  'discussions', 'id-token', 'issues', 'models', 'packages', 'pages', 'pull-requests', 'repository-projects', 'security-events',
  'statuses', 'vulnerability-alerts',
]);

class Reader {
  issues: Issue[] = [];
  constructor(private lc: LineCounter) {}

  line(node: YNode | Pair | null | undefined): number | undefined {
    const n = (node && isPair(node) ? (node.key as YNode) : node) as YNode | null | undefined;
    const r = n?.range;
    return r ? this.lc.linePos(r[0]).line : undefined;
  }

  lastLine(node: YNode | null | undefined): number | undefined {
    const r = node?.range;
    if (!r) return undefined;
    // range[1] is the end of the value; step back over a trailing newline.
    return this.lc.linePos(Math.max(r[0], r[1] - 1)).line;
  }

  add(level: Issue['level'], key: string, node: YNode | Pair | null | undefined, params?: Issue['params'], real?: string) {
    const issue: Issue = { level, key, line: this.line(node) };
    if (params) issue.params = params;
    if (real) issue.real = real;
    this.issues.push(issue);
  }

  /** Check every `${{ }}` in a string value. */
  exprs(text: string, node: YNode | Pair | null | undefined) {
    const opens = (text.match(/\$\{\{/g) ?? []).length;
    const found = expressionsIn(text);
    if (found.length < opens) this.add('error', 'conveyor.issue.exprUnclosed', node, {}, "Unclosed '${{'");
    for (const { expr } of found) {
      const err = exprError(expr);
      if (err) this.add('error', 'conveyor.issue.exprSyntax', node, { expr }, err);
    }
  }

  pairs(node: unknown): Pair[] {
    return isMap(node) ? (node as YAMLMap).items.filter((p): p is Pair => isPair(p)) : [];
  }

  keyOf(p: Pair): string {
    return isScalar(p.key) ? String(p.key.value) : String(p.key);
  }

  checkKeys(node: unknown, known: Set<string>, where: string) {
    for (const p of this.pairs(node)) {
      const k = this.keyOf(p);
      if (!known.has(k)) this.add('error', 'conveyor.issue.unknownKey', p, { key: k, where }, `Unexpected value '${k}'`);
    }
  }

  get(node: unknown, key: string): YNode | null | undefined {
    const p = this.pairs(node).find((x) => this.keyOf(x) === key);
    return p ? (p.value as YNode | null) : undefined;
  }

  pairFor(node: unknown, key: string): Pair | undefined {
    return this.pairs(node).find((x) => this.keyOf(x) === key);
  }

  scalar(node: YNode | null | undefined): Scalar | undefined {
    if (node && isScalar(node)) {
      const v = node.value;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
      if (v === null) return '';
    }
    return undefined;
  }

  str(node: YNode | null | undefined): string | undefined {
    const v = this.scalar(node);
    return v === undefined ? undefined : String(v);
  }

  /** A string or a list of strings. */
  list(node: YNode | null | undefined): string[] {
    if (!node) return [];
    if (isSeq(node)) return node.items.map((i) => this.str(i as YNode) ?? '').filter((s) => s !== '');
    const s = this.str(node);
    return s === undefined || s === '' ? [] : [s];
  }

  /** A map of scalars → strings (env, with, outputs). */
  strMap(node: YNode | null | undefined, where: string): Record<string, string> {
    const out: Record<string, string> = {};
    if (node === undefined || node === null) return out;
    if (!isMap(node)) {
      if (isScalar(node) && typeof node.value === 'string' && node.value.includes('${{')) return out;
      this.add('error', 'conveyor.issue.notMap', node, { where });
      return out;
    }
    for (const p of this.pairs(node)) {
      const v = this.scalar(p.value as YNode);
      const k = this.keyOf(p);
      if (v === undefined) {
        this.add('error', 'conveyor.issue.notScalar', p, { key: k, where });
        continue;
      }
      out[k] = String(v);
      this.exprs(out[k], p);
    }
    return out;
  }

  permissions(node: YNode | null | undefined, pair: Pair | undefined): PermSpec | undefined {
    if (node === undefined) return undefined;
    if (node === null) return {};
    const s = this.str(node);
    if (s !== undefined) {
      if (s === 'read-all' || s === 'write-all') return s;
      this.add('error', 'conveyor.issue.badPermissions', pair ?? node, { value: s });
      return {};
    }
    const out: Record<string, PermLevel> = {};
    for (const p of this.pairs(node)) {
      const scope = this.keyOf(p);
      const level = this.str(p.value as YNode);
      if (!PERMISSION_SCOPES.has(scope)) {
        this.add('error', 'conveyor.issue.badScope', p, { scope }, `Unknown permission scope '${scope}'`);
        continue;
      }
      if (level !== 'read' && level !== 'write' && level !== 'none') {
        this.add('error', 'conveyor.issue.badLevel', p, { scope, value: level ?? '' });
        continue;
      }
      if (scope === 'id-token' && level === 'read') this.add('warning', 'conveyor.issue.idTokenRead', p);
      out[scope] = level;
    }
    return out;
  }

  concurrency(node: YNode | null | undefined): Concurrency | undefined {
    if (node === undefined || node === null) return undefined;
    const s = this.str(node);
    if (s !== undefined) {
      this.exprs(s, node);
      return { group: s, cancelInProgress: false };
    }
    this.checkKeys(node, CONCURRENCY_KEYS, 'concurrency');
    const group = this.str(this.get(node, 'group')) ?? '';
    if (!group) this.add('error', 'conveyor.issue.missing', node, { key: 'group', where: 'concurrency' }, 'Required property is missing: group');
    this.exprs(group, this.get(node, 'group'));
    const cip = this.scalar(this.get(node, 'cancel-in-progress'));
    const queue = this.str(this.get(node, 'queue'));
    const out: Concurrency = { group, cancelInProgress: typeof cip === 'boolean' ? cip : cip === undefined ? false : String(cip) };
    if (queue !== undefined) {
      if (queue !== 'single' && queue !== 'max') this.add('error', 'conveyor.issue.badValue', this.pairFor(node, 'queue'), { key: 'queue', value: queue });
      else out.queue = queue;
      if (queue === 'max' && cip === true) this.add('error', 'conveyor.issue.queueMaxCancel', this.pairFor(node, 'queue'));
    }
    return out;
  }
}

function triggers(r: Reader, node: YNode | null | undefined, onPair: Pair | undefined): { on: Triggers; lines: Record<string, number> } {
  const on: Triggers = {};
  const lines: Record<string, number> = {};
  const addEvent = (name: string, at: YNode | Pair | null | undefined) => {
    if (!EVENTS.has(name)) r.add('error', 'conveyor.issue.unknownEvent', at, { event: name }, `Unknown event '${name}'`);
    lines[name] = r.line(at) ?? 0;
  };
  if (node === undefined || node === null) {
    r.add('error', 'conveyor.issue.noOn', onPair ?? null, {}, "Required property is missing: 'on'");
    return { on, lines };
  }
  if (isScalar(node)) {
    const name = String(node.value);
    addEvent(name, node);
    on[name] = {};
  } else if (isSeq(node)) {
    for (const item of node.items) {
      const name = r.str(item as YNode) ?? '';
      addEvent(name, item as YNode);
      on[name] = {};
    }
  } else if (isMap(node)) {
    for (const p of r.pairs(node)) {
      const name = r.keyOf(p);
      addEvent(name, p);
      const cfg: Record<string, unknown> = {};
      const v = p.value as YNode | null;
      if (name === 'schedule') {
        cfg.crons = isSeq(v) ? v.items.map((i) => r.str(r.get(i, 'cron')) ?? '') : [];
      } else if (v && isMap(v)) {
        const known = EVENT_KEYS[name] ?? new Set(['types']);
        r.checkKeys(v, known, `on.${name}`);
        for (const q of r.pairs(v)) {
          const k = r.keyOf(q);
          if (k === 'inputs' || k === 'outputs' || k === 'secrets') {
            const inner: Record<string, Record<string, string>> = {};
            for (const ip of r.pairs(q.value)) {
              const def: Record<string, string> = {};
              for (const dp of r.pairs(ip.value)) def[r.keyOf(dp)] = r.str(dp.value as YNode) ?? '';
              inner[r.keyOf(ip)] = def;
            }
            cfg[k] = inner;
          } else cfg[k] = r.list(q.value as YNode);
        }
        if (cfg.branches && cfg['branches-ignore']) r.add('error', 'conveyor.issue.bothFilters', p, { a: 'branches', b: 'branches-ignore' });
        if (cfg.tags && cfg['tags-ignore']) r.add('error', 'conveyor.issue.bothFilters', p, { a: 'tags', b: 'tags-ignore' });
        if (cfg.paths && cfg['paths-ignore']) r.add('error', 'conveyor.issue.bothFilters', p, { a: 'paths', b: 'paths-ignore' });
      }
      on[name] = cfg;
    }
  }
  return { on, lines };
}

function matrix(r: Reader, node: YNode | null | undefined): Matrix | undefined {
  if (node === undefined || node === null) return undefined;
  if (!isMap(node)) {
    r.add('info', 'conveyor.issue.matrixExpr', node);
    return undefined;
  }
  const m: Matrix = { axes: {}, include: [], exclude: [] };
  const obj = (n: unknown): Record<string, Scalar> => {
    const o: Record<string, Scalar> = {};
    for (const p of r.pairs(n)) o[r.keyOf(p)] = r.scalar(p.value as YNode) ?? '';
    return o;
  };
  for (const p of r.pairs(node)) {
    const k = r.keyOf(p);
    const v = p.value as YNode | null;
    if (k === 'include' || k === 'exclude') {
      if (!isSeq(v)) r.add('error', 'conveyor.issue.notList', p, { key: k });
      else m[k] = v.items.map(obj);
    } else if (isSeq(v)) {
      m.axes[k] = v.items.map((i) => r.scalar(i as YNode) ?? '');
      if (m.axes[k].length === 0) r.add('error', 'conveyor.issue.matrixEmpty', p, { key: k });
    } else r.add('error', 'conveyor.issue.notList', p, { key: k });
  }
  return m;
}

function steps(r: Reader, node: YNode | null | undefined, jobId: string): Step[] {
  if (!node) return [];
  if (!isSeq(node)) {
    r.add('error', 'conveyor.issue.notList', node, { key: 'steps' });
    return [];
  }
  return node.items.map((item, index) => {
    const n = item as YNode;
    r.checkKeys(n, STEP_KEYS, `jobs.${jobId}.steps`);
    const step: Step = {
      index,
      with: r.strMap(r.get(n, 'with'), 'with'),
      env: r.strMap(r.get(n, 'env'), 'env'),
      continueOnError: false,
      line: r.line(n) ?? 0,
    };
    const id = r.str(r.get(n, 'id'));
    const name = r.str(r.get(n, 'name'));
    const uses = r.str(r.get(n, 'uses'));
    const runNode = r.get(n, 'run');
    const run = r.str(runNode);
    const cond = r.scalar(r.get(n, 'if'));
    const coe = r.scalar(r.get(n, 'continue-on-error'));
    const tm = r.scalar(r.get(n, 'timeout-minutes'));
    if (id !== undefined) step.id = id;
    if (name !== undefined) {
      step.name = name;
      r.exprs(name, r.get(n, 'name'));
    }
    if (uses !== undefined) {
      step.uses = uses;
      step.usesLine = r.line(r.pairFor(n, 'uses'));
    }
    if (run !== undefined) {
      step.run = run;
      const first = r.line(r.pairFor(n, 'run'));
      const last = r.lastLine(runNode);
      if (first !== undefined) step.runLines = [first, Math.max(first, last ?? first)];
      r.exprs(run, r.pairFor(n, 'run'));
    }
    if (cond !== undefined) {
      step.if = String(cond);
      checkIf(r, step.if, r.pairFor(n, 'if'));
    }
    if (coe !== undefined) step.continueOnError = typeof coe === 'boolean' ? coe : String(coe);
    if (typeof tm === 'number') step.timeoutMinutes = tm;
    if (uses === undefined && run === undefined) r.add('error', 'conveyor.issue.stepEmpty', n, {}, "Step must have 'uses' or 'run'");
    if (uses !== undefined && run !== undefined) r.add('error', 'conveyor.issue.stepBoth', n, {}, "Step cannot have both 'uses' and 'run'");
    if (uses !== undefined) checkUses(r, uses, step.with, r.pairFor(n, 'uses'));
    return step;
  });
}

function checkIf(r: Reader, cond: string, at: Pair | undefined) {
  const src = cond.trim();
  const whole = /^\$\{\{([\s\S]*)\}\}$/.exec(src);
  if (whole && !whole[1]!.includes('}}')) {
    const err = exprError(whole[1]!.trim());
    if (err) r.add('error', 'conveyor.issue.exprSyntax', at, { expr: whole[1]!.trim() }, err);
  } else if (src.includes('${{')) r.exprs(src, at);
  else {
    const err = exprError(src);
    if (err) r.add('error', 'conveyor.issue.exprSyntax', at, { expr: src }, err);
  }
}

function checkUses(r: Reader, uses: string, inputs: Record<string, string>, at: Pair | undefined) {
  const u = parseUses(uses);
  if (u.local || u.docker) return;
  if (!u.ref) {
    r.add('error', 'conveyor.issue.usesNoRef', at, { uses }, `Specifying action "${uses}" in invalid format`);
    return;
  }
  const known = KNOWN_ACTIONS[u.name];
  if (!known) {
    r.add('info', 'conveyor.issue.unknownAction', at, { uses });
    return;
  }
  if (!isFullSha(u.ref) && u.ref.split('.')[0] !== known.version.split('.')[0]) r.add('warning', 'conveyor.issue.oldMajor', at, { uses, want: known.version });
  if (known.inputs) {
    for (const k of Object.keys(inputs)) if (!known.inputs.includes(k)) r.add('warning', 'conveyor.issue.unknownInput', at, { input: k, action: u.name });
  }
}

function job(r: Reader, p: Pair): Job {
  const id = r.keyOf(p);
  const n = p.value as YNode;
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(id)) r.add('error', 'conveyor.issue.badJobId', p, { id }, `Invalid job ID "${id}"`);
  if (!isMap(n)) {
    r.add('error', 'conveyor.issue.notMap', p, { where: `jobs.${id}` });
    return { id, line: r.line(p) ?? 0, runsOn: [], needs: [], services: {}, outputs: {}, env: {}, failFast: true, continueOnError: false, timeoutMinutes: 360, steps: [], with: {} };
  }
  r.checkKeys(n, JOB_KEYS, `jobs.${id}`);
  const runsOnNode = r.get(n, 'runs-on');
  // runs-on: a label, a list, or { group, labels } (a runner group: labels are not checked).
  const runsOn: string[] = runsOnNode && isMap(runsOnNode) ? r.list(r.get(runsOnNode, 'labels')) : r.list(runsOnNode);
  const uses = r.str(r.get(n, 'uses'));
  const j: Job = {
    id,
    line: r.line(p) ?? 0,
    runsOn,
    needs: r.list(r.get(n, 'needs')),
    services: {},
    outputs: r.strMap(r.get(n, 'outputs'), `jobs.${id}.outputs`),
    env: r.strMap(r.get(n, 'env'), `jobs.${id}.env`),
    failFast: true,
    continueOnError: false,
    timeoutMinutes: 360,
    steps: steps(r, r.get(n, 'steps'), id),
    with: r.strMap(r.get(n, 'with'), `jobs.${id}.with`),
  };
  const roLine = r.line(r.pairFor(n, 'runs-on'));
  if (roLine !== undefined) j.runsOnLine = roLine;
  const name = r.str(r.get(n, 'name'));
  if (name !== undefined) j.name = name;
  if (uses !== undefined) {
    j.uses = uses;
    if (runsOnNode !== undefined) r.add('error', 'conveyor.issue.unknownKey', r.pairFor(n, 'runs-on'), { key: 'runs-on', where: `jobs.${id}` }, "Unexpected value 'runs-on'");
  } else {
    if (runsOnNode === undefined) r.add('error', 'conveyor.issue.missing', p, { key: 'runs-on', where: `jobs.${id}` }, 'Required property is missing: runs-on');
    if (!r.get(n, 'steps')) r.add('error', 'conveyor.issue.missing', p, { key: 'steps', where: `jobs.${id}` }, 'Required property is missing: steps');
    for (const label of isMap(runsOnNode) ? [] : runsOn) {
      if (!RUNNER_LABELS.has(label.toLowerCase()) && !label.includes('${{')) {
        r.add('error', 'conveyor.issue.badLabel', r.pairFor(n, 'runs-on'), { label }, `label "${label}" is unknown`);
      }
    }
  }
  const cond = r.scalar(r.get(n, 'if'));
  if (cond !== undefined) {
    j.if = String(cond);
    checkIf(r, j.if, r.pairFor(n, 'if'));
  }
  const perm = r.permissions(r.get(n, 'permissions'), r.pairFor(n, 'permissions'));
  if (perm !== undefined) j.permissions = perm;
  const envNode = r.get(n, 'environment');
  if (envNode !== undefined && envNode !== null) {
    if (isMap(envNode)) {
      r.checkKeys(envNode, ENV_KEYS, `jobs.${id}.environment`);
      j.environment = { name: r.str(r.get(envNode, 'name')) ?? '' };
      const url = r.str(r.get(envNode, 'url'));
      if (url) j.environment.url = url;
    } else j.environment = { name: r.str(envNode) ?? '' };
  }
  const conc = r.concurrency(r.get(n, 'concurrency'));
  if (conc) j.concurrency = conc;
  for (const sp of r.pairs(r.get(n, 'services'))) {
    r.checkKeys(sp.value, SERVICE_KEYS, `jobs.${id}.services`);
    j.services[r.keyOf(sp)] = { image: r.str(r.get(sp.value, 'image')) ?? '' };
  }
  const strategy = r.get(n, 'strategy');
  if (strategy) {
    r.checkKeys(strategy, STRATEGY_KEYS, `jobs.${id}.strategy`);
    const m = matrix(r, r.get(strategy, 'matrix'));
    if (m) j.matrix = m;
    const ff = r.scalar(r.get(strategy, 'fail-fast'));
    if (typeof ff === 'boolean') j.failFast = ff;
    const mp = r.scalar(r.get(strategy, 'max-parallel'));
    if (typeof mp === 'number') j.maxParallel = mp;
  }
  const coe = r.scalar(r.get(n, 'continue-on-error'));
  if (coe !== undefined) j.continueOnError = typeof coe === 'boolean' ? coe : String(coe);
  const tm = r.scalar(r.get(n, 'timeout-minutes'));
  if (typeof tm === 'number') j.timeoutMinutes = tm;
  if (uses !== undefined) checkUses(r, uses, j.with, r.pairFor(n, 'uses'));
  return j;
}

/** Parse workflow YAML. `workflow` is null when the file can't be read at all. */
export function parseWorkflow(text: string): ParseResult {
  const lc = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lc, prettyErrors: false, uniqueKeys: true });
  const r = new Reader(lc);
  if (doc.errors.length) {
    for (const e of doc.errors) {
      const issue: Issue = { level: 'error', key: 'conveyor.issue.yaml', real: e.message.split('\n')[0]! };
      const at = e.linePos?.[0]?.line ?? lc.linePos(e.pos[0]).line;
      if (at) issue.line = at;
      r.issues.push(issue);
    }
    return { workflow: null, issues: r.issues };
  }
  const root = doc.contents as YNode | null;
  if (!isMap(root)) {
    r.issues.push({ level: 'error', key: 'conveyor.issue.notWorkflow' });
    return { workflow: null, issues: r.issues };
  }
  r.checkKeys(root, TOP_KEYS, 'top');
  const { on, lines } = triggers(r, r.get(root, 'on'), r.pairFor(root, 'on'));
  const wf: Workflow = { on, onLines: lines, env: r.strMap(r.get(root, 'env'), 'env'), jobs: [] };
  const name = r.str(r.get(root, 'name'));
  if (name !== undefined) wf.name = name;
  const perm = r.permissions(r.get(root, 'permissions'), r.pairFor(root, 'permissions'));
  if (perm !== undefined) {
    wf.permissions = perm;
    const pl = r.line(r.pairFor(root, 'permissions'));
    if (pl !== undefined) wf.permissionsLine = pl;
  }
  const conc = r.concurrency(r.get(root, 'concurrency'));
  if (conc) wf.concurrency = conc;
  const jobsNode = r.get(root, 'jobs');
  if (!jobsNode || !isMap(jobsNode) || r.pairs(jobsNode).length === 0) {
    r.issues.push({ level: 'error', key: 'conveyor.issue.noJobs', real: "Required property is missing: 'jobs'" });
  } else wf.jobs = r.pairs(jobsNode).map((p) => job(r, p));

  // needs: known jobs, no cycles.
  const ids = new Set(wf.jobs.map((j) => j.id));
  for (const j of wf.jobs) {
    for (const need of j.needs) {
      if (!ids.has(need)) r.issues.push({ level: 'error', key: 'conveyor.issue.unknownNeed', line: j.line, params: { job: j.id, need }, real: `Job '${j.id}' depends on unknown job '${need}'.` });
    }
  }
  const cyc = findCycle(wf);
  if (cyc) r.issues.push({ level: 'error', key: 'conveyor.issue.cycle', line: wf.jobs.find((j) => j.id === cyc[0])?.line, params: { jobs: cyc.join(' → ') } });
  r.issues.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  return { workflow: wf, issues: r.issues };
}

function findCycle(wf: Workflow): string[] | null {
  const byId = new Map(wf.jobs.map((j) => [j.id, j]));
  const state = new Map<string, 1 | 2>();
  const path: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === 2) return null;
    if (state.get(id) === 1) return [...path.slice(path.indexOf(id)), id];
    state.set(id, 1);
    path.push(id);
    for (const n of byId.get(id)?.needs ?? []) {
      if (!byId.has(n)) continue;
      const c = visit(n);
      if (c) return c;
    }
    path.pop();
    state.set(id, 2);
    return null;
  };
  for (const j of wf.jobs) {
    const c = visit(j.id);
    if (c) return c;
  }
  return null;
}

/** True when the file has no error-level issue, so it can run. */
export function canRun(issues: Issue[]): boolean {
  return !issues.some((i) => i.level === 'error');
}
