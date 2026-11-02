// Truth check for every workflow the CI/CD course shows (cicd scenarios) and for this
// repo's own workflows:
//   1. the conveyor engine reads it with no error, and only uses the action versions it teaches
//      (KNOWN_ACTIONS: the same majors as .github/workflows/ci.yml);
//   2. actionlint (official Docker image, pinned) finds nothing, except the findings a
//      scenario lists in `actionlint` (vulnerable on purpose) — and those must still show up;
//   3. a scenario's `fixed` version has no security holes left.
// Needs Docker. Usage: npm run verify:workflows
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { auditWorkflow, isFullSha, KNOWN_ACTIONS, parseUses, parseWorkflow } from '../../src/engine/conveyor-sim/index';
import { allConveyorScenarios } from '../../src/content/courses/cicd/scenarios/index';

/** Pinned actionlint image (https://hub.docker.com/r/rhysd/actionlint/tags). */
export const ACTIONLINT_IMAGE = 'rhysd/actionlint:1.7.12';
const OUT = 'node_modules/.cache/fahamlah-workflows';

interface Finding {
  message: string;
  filepath: string;
  line: number;
  column: number;
  kind: string;
}

interface Target {
  /** Path relative to the repo root (what actionlint sees). */
  path: string;
  label: string;
  text: string;
  expect: string[];
  /** Check action versions against KNOWN_ACTIONS (scenarios only). */
  versions: boolean;
}

const errors: string[] = [];
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, '.github/workflows'), { recursive: true });

const targets: Target[] = [];
for (const s of allConveyorScenarios) {
  const add = (suffix: string, text: string, expect: string[]) => {
    const path = join(OUT, '.github/workflows', `${s.id}${suffix}.yml`);
    writeFileSync(path, text);
    targets.push({ path, label: `scenario ${s.id}${suffix ? ` (${suffix.slice(1)})` : ''}`, text, expect, versions: true });
  };
  add('', s.workflow, s.actionlint ?? []);
  if (s.fixed) {
    add('.fixed', s.fixed, []);
    const left = auditWorkflow(s.fixed, { publicRepo: !s.repo?.private });
    if (left.length) errors.push(`scenario ${s.id}: the fixed workflow still has holes: ${left.map((h) => `${h.kind} (line ${h.line})`).join(', ')}`);
  }
}
for (const f of readdirSync('.github/workflows').filter((n) => /\.ya?ml$/.test(n))) {
  const path = `.github/workflows/${f}`;
  targets.push({ path, label: path, text: readFileSync(path, 'utf8'), expect: [], versions: false });
}

// 1. The engine reads every scenario, and the versions are the ones the course teaches.
for (const t of targets) {
  const { workflow, issues } = parseWorkflow(t.text);
  for (const i of issues.filter((x) => x.level === 'error')) errors.push(`${t.label}: line ${i.line ?? '?'}: the engine refuses it (${i.key}${i.real ? `: ${i.real}` : ''})`);
  if (!workflow) continue;
  const steps = workflow.jobs.flatMap((j) => j.steps);
  for (const step of steps) {
    if (!step.uses) continue;
    const u = parseUses(step.uses);
    const known = KNOWN_ACTIONS[u.name];
    if (!known) continue;
    if (t.versions) {
      if (!isFullSha(u.ref) && u.ref !== known.version) errors.push(`${t.label}: line ${step.line}: ${step.uses} — the course teaches ${u.name}@${known.version}`);
    } else if (isFullSha(u.ref)) {
      // This repo pins full SHAs with a "# vX.Y.Z" comment: its major must match what the course teaches.
      const line = t.text.split('\n')[(step.usesLine ?? step.line) - 1] ?? '';
      const comment = /#\s*(v[\d.]+)/.exec(line)?.[1];
      if (comment && comment.split('.')[0] !== known.version.split('.')[0]) errors.push(`${t.label}: ${u.name} is ${comment}, but the course teaches ${known.version}: update KNOWN_ACTIONS and the scenarios together`);
    }
  }
}

// 2. actionlint, from its official Docker image.
const files = targets.map((t) => t.path);
const docker = spawnSync('docker', ['run', '--rm', '-v', `${process.cwd()}:/repo`, '--workdir', '/repo', ACTIONLINT_IMAGE, '-format', '{{json .}}', ...files], { encoding: 'utf8' });
if (docker.error || (docker.status !== 0 && docker.status !== 1)) {
  console.error(`✗ Could not run actionlint with Docker (${ACTIONLINT_IMAGE}).`);
  console.error(docker.error?.message ?? docker.stderr);
  console.error('  Docker must be running. On GitHub Actions, ubuntu-latest has it.');
  process.exit(1);
}
let findings: Finding[] = [];
try {
  findings = JSON.parse(docker.stdout.trim() || '[]') as Finding[];
} catch {
  console.error(`✗ Could not read actionlint output:\n${docker.stdout}\n${docker.stderr}`);
  process.exit(1);
}
for (const t of targets) {
  const mine = findings.filter((f) => f.filepath === t.path);
  const patterns = t.expect.map((p) => new RegExp(p));
  for (const f of mine) {
    if (!patterns.some((p) => p.test(f.message))) errors.push(`${t.label}: line ${f.line}:${f.column}: actionlint [${f.kind}] ${f.message}`);
  }
  for (const [i, p] of patterns.entries()) {
    if (!mine.some((f) => p.test(f.message))) errors.push(`${t.label}: actionlint no longer reports "${t.expect[i]}" (the lesson shows it on purpose)`);
  }
}

if (errors.length) {
  console.error(`✗ Workflow check failed (${errors.length}):\n${errors.map((e) => `- ${e}`).join('\n')}`);
  // Show actionlint's own coloured report too.
  const bad = [...new Set(findings.map((f) => f.filepath))];
  if (bad.length) spawnSync('docker', ['run', '--rm', '-v', `${process.cwd()}:/repo`, '--workdir', '/repo', ACTIONLINT_IMAGE, '-color', ...bad], { stdio: 'inherit' });
  process.exit(1);
}
const expected = findings.length;
console.log(`✓ Workflows OK: ${targets.length} files checked with ${ACTIONLINT_IMAGE}${expected ? ` (${expected} finding${expected === 1 ? '' : 's'} shown on purpose)` : ''}.`);
