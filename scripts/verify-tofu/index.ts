// Truth check for the OpenTofu simulator: every IaC scenario's `verify` command lists run in the
// engine AND with the real OpenTofu 1.12.4 (official container image, see real.ts), in a fresh
// folder holding the scenario's files. Then it compares, command by command:
//   - the output text (both with -no-color), and the exit code;
//   - the state file after the command (terraform.tfstate, every field);
//   - at the end, the project folder (file names and contents, lock file included).
// Random values (random_* results, ids, uuids, hashes of files that hold them, the lineage) can't
// match, so they are paired: wherever the two state files differ in such a value, both sides get
// the same placeholder (<v1>, <v2> … by first appearance) before comparing. Lines OpenTofu prints
// from parallel work (Creating…, Refreshing state…) are compared as a set, and `init` lines that
// only differ because the check shares one provider download cache are made to read as a learner
// sees them.
//
//   npm run verify:tofu                 every scenario
//   VERIFY_ONLY=iac-t1 npm run verify:tofu   only scenarios whose id starts with that text
//   VERIFY_SHOW=1 …                     print both outputs for every command
//   TRUTH_SHARD=2/3 …                   every third list, starting with the second (CI shards)
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildTofuScenario, plain, run, TOFU_VERSION, type TofuScenario, type TofuState } from '../../src/engine/tofu-sim/index';
import { scenarios } from '../../src/content/courses/iac/scenarios/index';
import { REAL_TOFU_VERSION, runReal, TOFU_IMAGE, withNoColor } from './real';

const SHOW = Boolean(process.env.VERIFY_SHOW);
const CACHE = process.env.VERIFY_TOFU_CACHE ?? join(tmpdir(), 'fl-tofu-plugin-cache');

// ---------------------------------------------------------------------------
// Masking

const VOLATILE: Record<string, string[]> = {
  random_pet: ['id'],
  random_integer: ['id', 'result'],
  random_string: ['id', 'result'],
  random_password: ['result', 'bcrypt_hash'],
  random_id: ['id', 'b64_std', 'b64_url', 'dec', 'hex'],
  random_uuid: ['id', 'result'],
  terraform_data: ['id'],
  null_resource: ['id'],
  local_file: ['id', 'content_base64sha256', 'content_base64sha512', 'content_md5', 'content_sha1', 'content_sha256', 'content_sha512', 'content_base64'],
  local_sensitive_file: ['id', 'content_base64sha256', 'content_base64sha512', 'content_md5', 'content_sha1', 'content_sha256', 'content_sha512'],
};

class Masker {
  readonly engine = new Map<string, string>();
  readonly real = new Map<string, string>();
  private n = 0;

  pair(a: unknown, b: unknown) {
    if (a === null || b === null || a === undefined || b === undefined) return;
    const x = String(a);
    const y = String(b);
    if (x === y) return;
    if (this.engine.has(x) || this.real.has(y)) return;
    const ph = `<v${++this.n}>`;
    this.engine.set(x, ph);
    this.real.set(y, ph);
  }

  /** Pair the volatile values of two state files (same resources, same attributes). */
  states(engineText: string, realText: string) {
    const a = safeJson(engineText);
    const b = safeJson(realText);
    if (!a || !b) return;
    this.pair(a.lineage, b.lineage);
    for (const ra of (a.resources ?? []) as Res[]) {
      const rb = ((b.resources ?? []) as Res[]).find((x) => x.module === ra.module && x.mode === ra.mode && x.type === ra.type && x.name === ra.name);
      if (!rb) continue;
      const keys = VOLATILE[ra.type] ?? [];
      for (const ia of ra.instances) {
        const ib = rb.instances.find((x) => x.index_key === ia.index_key && Boolean(x.deposed) === Boolean(ia.deposed));
        if (!ib) continue;
        for (const k of keys) this.pair(ia.attributes[k], ib.attributes[k]);
        if (ra.type === 'random_integer' && ia.attributes.result !== undefined) this.pair(String(ia.attributes.result), String(ib.attributes.result));
      }
    }
  }

  apply(text: string, side: 'engine' | 'real'): string {
    const map = side === 'engine' ? this.engine : this.real;
    let out = text;
    for (const [v, ph] of [...map.entries()].sort((x, y) => y[0].length - x[0].length)) {
      // Numbers only where a random number can be: result / id values and their quoted forms.
      if (/^-?\d+$/.test(v)) {
        out = out
          .replace(new RegExp(`(result"?\\s*[=:]\\s*)${v}(?![\\w.])`, 'g'), `$1${ph}`)
          .replace(new RegExp(`"${v}"`, 'g'), `"${ph}"`)
          .replace(new RegExp(`\\[id=${v}\\]`, 'g'), `[id=${ph}]`)
          .replace(new RegExp(`(-> |= )${v}$`, 'gm'), `$1${ph}`)
          .replace(new RegExp(`(^|[^\\w.<-])${v}(?=( -> null)?$)`, 'gm'), `$1${ph}`);
        // Three digits or more: anywhere it stands alone (inside text too). Lessons use ranges like 100-999.
        if (v.replace('-', '').length >= 3) out = out.replace(new RegExp(`(?<![\\w.<-])${v}(?![\\w.>])`, 'g'), ph);
      }
      // Whole tokens only: a random pet "boa" must not be masked inside the word "board".
      else out = out.replace(new RegExp(`(?<![A-Za-z0-9_])${escapeRe(v)}(?![A-Za-z0-9_])`, 'g'), ph);
    }
    return out;
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

interface Res {
  module?: string;
  mode: string;
  type: string;
  name: string;
  instances: { index_key?: unknown; deposed?: string; attributes: Record<string, unknown> }[];
}

function safeJson(t: string): { lineage?: string; resources?: unknown[] } | null {
  try {
    return t.trim() ? (JSON.parse(t) as { lineage?: string; resources?: unknown[] }) : null;
  } catch {
    return null;
  }
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const PROGRESS = /^(\S+?)(?: \(deposed object [^)]+\))?: (Creating\.\.\.|Creation complete|Destroying\.\.\.|Destruction complete|Modifying\.\.\.|Modifications complete|Refreshing state\.\.\.|Reading\.\.\.|Read complete|Importing\.\.\.|Import complete|Preparing import\.\.\.|Still )/;

/** Text normalising shared by both sides. */
function norm(text: string, cmd: string): string {
  let lines = text
    .replace(/\r/g, '')
    .replace(ANSI, '')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .map((l) => l.replace(/complete after \d+s/, 'complete after 0s').replace(/deposed object [0-9a-f]{8}/, 'deposed object <key>'))
    .map((l) => l.replace(/terraform\.tfstate\.\d+\.backup/g, 'terraform.tfstate.<ts>.backup'));
  if (/^tofu providers\b/.test(cmd)) {
    // Real OpenTofu lists a module's providers in a random order (a Go map): compare them as a set.
    lines = lines.map((l) => l.replace(/^([│ ]*)└── /, '$1├── '));
    const head = lines.slice(0, 3);
    lines = [...head, ...lines.slice(3).filter((l) => l.trim()).sort()];
  }
  if (/^tofu init\b/.test(cmd)) {
    // A shared plugin cache only changes how installs are worded.
    lines = lines
      .filter((l) => !/^- Using hashicorp\/\w+ v[\d.]+ from the shared cache directory$/.test(l))
      .map((l) => l.replace(/ to the shared cache directory\.\.\.$/, '...'));
  }
  // Sort runs of lines that come from parallel work.
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    out.push(...run.sort());
    run = [];
  };
  for (const l of lines) {
    if (PROGRESS.test(l) || (/^tofu init\b/.test(cmd) && /^- (Finding|Installing|Installed|Reusing|Using previously)/.test(l))) run.push(l);
    else {
      flush();
      out.push(l);
    }
  }
  flush();
  while (out.length && !out[out.length - 1]) out.pop();
  while (out.length && !out[0]) out.shift();
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// One verify list

interface EngineRun {
  cmd: string;
  answers: string[];
  out: string;
  code: number;
  state: string;
}

function engineSide(sc: TofuScenario, list: string[]): { runs: EngineRun[]; files: Record<string, string>; start: TofuState } {
  let st = buildTofuScenario(sc);
  const start = st;
  const runs: EngineRun[] = [];
  for (const line of list) {
    const waiting = Boolean(st.pending);
    const cmd = waiting ? line : withNoColor(line);
    const r = run(st, cmd, { noColor: true });
    const text = plain(r.output);
    if (waiting && runs.length) {
      const last = runs[runs.length - 1]!;
      last.answers.push(line);
      // OpenTofu's question: "var.x", then "  description" and a blank line when there is one.
      const gap = /^var\.\S+$/.test(last.out.split('\n').pop() ?? '') ? '\n' : '\n\n';
      last.out += `${gap}  Enter a value: ${r.output.length && !r.output[0]!.length ? '' : '\n'}${text}`;
      last.code = r.exitCode;
      last.state = r.state.files['terraform.tfstate'] ?? '';
    } else runs.push({ cmd: line, answers: [], out: text, code: r.exitCode, state: r.state.files['terraform.tfstate'] ?? '' });
    if (r.state.pending) {
      // The question line itself ("  Enter a value: ") is the terminal's prompt in the engine.
    }
    st = r.state;
  }
  return { runs, files: st.files, start };
}

function shq(s: string) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function verifyList(sc: TofuScenario, list: string[]): string[] {
  const problems: string[] = [];
  const eng = engineSide(sc, list);
  // Real side: the scenario's setup steps, then the same commands (answers piped in).
  const setup: string[] = [];
  for (const step of sc.steps ?? []) {
    if (typeof step === 'string') setup.push(step);
    else if ('write' in step) setup.push(`mkdir -p "$(dirname ${shq(step.write)})" && printf '%s' ${shq(Buffer.from(step.content).toString('base64'))} | base64 -d > ${shq(step.write)}`);
    else setup.push(`rm -f ${shq(step.delete)}`);
  }
  const commands = [...setup, ...eng.runs.map((r) => r.cmd)];
  const answers: Record<number, string> = {};
  eng.runs.forEach((r, i) => {
    if (r.answers.length) answers[setup.length + i] = r.answers.join('\n');
  });
  const real = runReal(sc.files, commands, { cacheDir: CACHE, answers });
  if (real.error) return [`real tofu failed to run: ${real.error}`];
  for (let i = 0; i < setup.length; i++) {
    const s = real.steps[i];
    if (!s || s.code !== 0) problems.push(`real setup step failed: ${setup[i]} (exit ${s?.code})\n${s?.out ?? ''}`);
  }
  if (problems.length) return problems;
  const mask = new Masker();
  // Pair values from every state snapshot (setup end, then each command).
  const lastSetup = real.steps[setup.length - 1];
  if (lastSetup) mask.states(eng.start.files['terraform.tfstate'] ?? '', lastSetup.state);
  eng.runs.forEach((r, i) => mask.states(r.state, real.steps[setup.length + i]?.state ?? ''));
  eng.runs.forEach((r, i) => {
    const rs = real.steps[setup.length + i]!;
    const cmd = r.cmd;
    let a = norm(mask.apply(r.out, 'engine'), cmd);
    let b = norm(mask.apply(rs.out, 'real'), cmd);
    if (rs.code !== 0 && /^tofu (plan|apply|destroy|refresh)\b/.test(cmd)) {
      // When a run fails, real OpenTofu stops its parallel work part-way: progress lines vary.
      const drop = (x: string) => x.split('\n').filter((l) => !PROGRESS.test(l)).join('\n').replace(/^\n+/, '');
      a = drop(a);
      b = drop(b);
    }
    if (SHOW) console.log(`\n--- ${cmd}${r.answers.length ? ` (answers: ${r.answers.join(', ')})` : ''}\n[engine exit ${r.code}]\n${a}\n[real exit ${rs.code}]\n${b}`);
    if (a !== b) problems.push(`output of "${cmd}" differs\n${diffText(a, b)}`);
    if (r.code !== rs.code) problems.push(`exit code of "${cmd}": engine ${r.code}, real ${rs.code}`);
    const sa = mask.apply(r.state, 'engine');
    const sb = mask.apply(rs.state, 'real');
    if (sa.trim() !== sb.trim()) problems.push(`state after "${cmd}" differs\n${diffText(sa.trim(), sb.trim())}`);
  });
  // Files at the end.
  const skip = (f: string) => f.startsWith('.terraform/') || f.startsWith('.fl-') || f === 'terraform.tfstate';
  const normName = (f: string) => f.replace(/terraform\.tfstate\.\d+\.backup/, 'terraform.tfstate.<ts>.backup');
  const ef = new Map(Object.entries(eng.files).filter(([f]) => !skip(f)).map(([f, c]) => [normName(f), c]));
  const rf = new Map(Object.entries(real.files).filter(([f]) => !skip(f)).map(([f, c]) => [normName(f), c]));
  const names = [...new Set([...ef.keys(), ...rf.keys()])].sort();
  for (const n of names) {
    if (!ef.has(n)) problems.push(`file ${n}: only real OpenTofu has it`);
    else if (!rf.has(n)) problems.push(`file ${n}: only the engine has it`);
    else if (!/^terraform\.tfstate\.<ts>\.backup$|\.tfplan$|^tfplan$/.test(n) && !isPlanFile(ef.get(n)!)) {
      const a = mask.apply(ef.get(n)!, 'engine');
      const b = mask.apply(rf.get(n)!, 'real');
      if (a !== b) problems.push(`file ${n} differs\n${diffText(a, b)}`);
    }
  }
  // Timestamped backups (state mv / rm) are named by the second, so two state commands in the same
  // second share one file in real OpenTofu: compare the newest one's contents.
  const newest = (files: Record<string, string>, side: 'engine' | 'real') => {
    const names = Object.keys(files)
      .filter((f) => /^terraform\.tfstate\.\d+\.backup$/.test(f))
      .sort((x, y) => Number(x.split('.')[2]) - Number(y.split('.')[2]));
    return names.length ? mask.apply(files[names[names.length - 1]!]!, side) : null;
  };
  const ta = newest(eng.files, 'engine');
  const tb = newest(real.files, 'real');
  if ((ta === null) !== (tb === null)) problems.push(`timestamped backup: only ${ta === null ? 'real OpenTofu' : 'the engine'} has one`);
  else if (ta !== null && ta !== tb) problems.push(`the newest timestamped backup differs\n${diffText(ta, tb!)}`);
  return problems;
}

function isPlanFile(c: string) {
  return c.startsWith('\u0000PK');
}

function diffText(a: string, b: string): string {
  const x = a.split('\n');
  const y = b.split('\n');
  const out: string[] = [];
  const n = Math.max(x.length, y.length);
  let shown = 0;
  for (let i = 0; i < n && shown < 14; i++) {
    if (x[i] === y[i]) continue;
    out.push(`      line ${i + 1}:\n        engine: ${JSON.stringify(x[i] ?? '(none)')}\n        real:   ${JSON.stringify(y[i] ?? '(none)')}`);
    shown++;
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------

const v = spawnSync('docker', ['image', 'inspect', TOFU_IMAGE], { encoding: 'utf8' });
if (v.status !== 0) {
  const pull = spawnSync('docker', ['pull', '-q', TOFU_IMAGE], { encoding: 'utf8' });
  if (pull.status !== 0) {
    console.error(`✗ Can't get ${TOFU_IMAGE}: ${pull.stderr.trim()}`);
    process.exit(1);
  }
}
console.log(`Real OpenTofu: ${TOFU_IMAGE} (engine: OpenTofu ${TOFU_VERSION})`);
if (!process.env.VERIFY_TOFU_IMAGE && REAL_TOFU_VERSION !== TOFU_VERSION) {
  console.error(`✗ scripts/verify-tofu/real.ts checks OpenTofu ${REAL_TOFU_VERSION}, but the engine says ${TOFU_VERSION} (src/engine/tofu-sim/state.ts).`);
  process.exit(1);
}
const SHARD = /^(\d+)\/(\d+)$/.exec(process.env.TRUTH_SHARD ?? '');
let listIndex = 0;
const mine = () => !SHARD || listIndex++ % Number(SHARD[2]) === Number(SHARD[1]) - 1;
const only = process.env.VERIFY_ONLY;
const failures: string[] = [];
let count = 0;
for (const sc of Object.values(scenarios) as TofuScenario[]) {
  if (only && !sc.id.startsWith(only)) continue;
  if (sc.engineOnly) {
    console.log(`- ${sc.id}: engine only (${sc.engineOnly})`);
    continue;
  }
  for (const list of sc.verify ?? []) {
    if (!mine()) continue;
    count++;
    const problems = verifyList(sc, list);
    if (problems.length) failures.push(`✗ ${sc.id}: [${list.join(' ; ')}]\n    - ${problems.join('\n    - ')}`);
    else console.log(`✓ ${sc.id}: ${list.length} commands`);
  }
}
if (failures.length) {
  console.error(`\n${failures.join('\n\n')}\n\n✗ ${failures.length} of ${count} command lists differ from real OpenTofu.`);
  process.exit(1);
}
console.log(`✓ ${count} command lists match real OpenTofu.`);
