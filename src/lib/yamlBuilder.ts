// Pure logic for the YamlBuilder interactive: stack blocks, get a workflow file.
//
// Block model (what lesson authors write in `yaml`):
//   trigger      the event under `on:`        e.g. "push:\n  branches: [main]"
//   job          the job id and its settings  e.g. "build:\n  runs-on: ubuntu-latest"
//   step         one step (dash optional)     e.g. "- uses: actions/checkout@v7"
//   permissions  one or more permission lines e.g. "contents: read"
//   env          one or more variables        e.g. "NODE_ENV: production"
//
// The builder adds the `on:`, `jobs:`, `steps:`, `permissions:` and `env:` keys
// and all indentation. Steps belong to the job above them. Permissions and env
// above the first job are for the whole workflow; below a job they are for that job.
// Steps with no job above them are shown as comments (they would do nothing).

export type BlockKind = 'trigger' | 'job' | 'step' | 'permissions' | 'env';

export interface YamlBlock {
  id: string;
  kind: BlockKind;
  /** Short name on the block button. */
  label: string;
  yaml: string;
  /** What this block means, in plain words. */
  means: string;
  /** Optional: why this block is not needed here (for decoys). */
  why?: string;
}

export interface Pipeline {
  triggers: YamlBlock[];
  jobs: { job: YamlBlock; steps: YamlBlock[] }[];
  orphans: YamlBlock[];
}

export function pipeline(chosen: YamlBlock[]): Pipeline {
  const out: Pipeline = { triggers: [], jobs: [], orphans: [] };
  for (const b of chosen) {
    if (b.kind === 'trigger') out.triggers.push(b);
    else if (b.kind === 'job') out.jobs.push({ job: b, steps: [] });
    else if (b.kind === 'step') {
      const job = out.jobs[out.jobs.length - 1];
      if (job) job.steps.push(b);
      else out.orphans.push(b);
    }
  }
  return out;
}

function indent(text: string, n: number): string[] {
  const pad = ' '.repeat(n);
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\s+$/, '')
    .split('\n')
    .map((l) => (l.trim() ? pad + l : ''));
}

function stepLines(yaml: string): string {
  const text = yaml.replace(/\r\n?/g, '\n').replace(/^\s+|\s+$/g, '');
  if (text.startsWith('- ') || text === '-') return text;
  return text
    .split('\n')
    .map((l, i) => (i === 0 ? `- ${l}` : `  ${l}`))
    .join('\n');
}

/** Quote a workflow name when YAML would misread it. */
export function yamlString(s: string): string {
  return /^[A-Za-z0-9][\w .()/-]*$/.test(s) && !/[ ]$/.test(s) ? s : JSON.stringify(s);
}

/** Build the workflow file from the chosen blocks, in order. */
export function buildYaml(name: string, chosen: YamlBlock[], orphanNote = 'needs a job above'): string {
  const lines: string[] = [`name: ${yamlString(name)}`];
  const firstJob = chosen.findIndex((b) => b.kind === 'job');
  const top = (kind: BlockKind) => chosen.filter((b, i) => b.kind === kind && (firstJob === -1 || i < firstJob));

  const triggers = chosen.filter((b) => b.kind === 'trigger');
  if (triggers.length) {
    lines.push('on:');
    for (const t of triggers) lines.push(...indent(t.yaml, 2));
  }
  for (const kind of ['permissions', 'env'] as const) {
    const list = top(kind);
    if (list.length) {
      lines.push(`${kind}:`);
      for (const b of list) lines.push(...indent(b.yaml, 2));
    }
  }

  const { jobs, orphans } = pipeline(chosen);
  if (jobs.length || orphans.length) lines.push('jobs:');
  for (const o of orphans) {
    lines.push(`  # ${orphanNote}:`);
    lines.push(...indent(stepLines(o.yaml), 2).map((l) => (l ? `  # ${l.slice(2)}` : l)));
  }
  for (const [j, { job, steps }] of jobs.entries()) {
    lines.push(...indent(job.yaml, 2));
    const start = chosen.indexOf(job);
    const end = jobs[j + 1] ? chosen.indexOf(jobs[j + 1]!.job) : chosen.length;
    const own = chosen.slice(start + 1, end);
    for (const kind of ['permissions', 'env'] as const) {
      const list = own.filter((b) => b.kind === kind);
      if (list.length) {
        lines.push(`    ${kind}:`);
        for (const b of list) lines.push(...indent(b.yaml, 6));
      }
    }
    if (steps.length) {
      lines.push('    steps:');
      for (const s of steps) lines.push(...indent(stepLines(s.yaml), 6));
    }
  }
  return lines.join('\n') + '\n';
}

export type OrderResult =
  | { ok: true }
  | { ok: false; reason: 'missing'; index: number; needed: string }
  | { ok: false; reason: 'decoy'; index: number; id: string }
  | { ok: false; reason: 'order'; index: number; id: string; belongs: number };

/** Compare the learner's stack with the goal order. Reports the first difference. */
export function checkOrder(goal: string[], chosen: string[]): OrderResult {
  const len = Math.max(goal.length, chosen.length);
  for (let i = 0; i < len; i++) {
    const want = goal[i];
    const got = chosen[i];
    if (want === got) continue;
    if (got === undefined) return { ok: false, reason: 'missing', index: i, needed: want! };
    if (!goal.includes(got)) return { ok: false, reason: 'decoy', index: i, id: got };
    return { ok: false, reason: 'order', index: i, id: got, belongs: goal.indexOf(got) };
  }
  return { ok: true };
}

export type YamlToken = { t: string; c?: 'key' | 'dash' | 'str' | 'num' | 'comment' | 'punct' };

/** Light syntax colouring for one YAML line. */
export function highlightYaml(line: string): YamlToken[] {
  const out: YamlToken[] = [];
  const m = /^(\s*)(#.*)$/.exec(line);
  if (m) {
    if (m[1]) out.push({ t: m[1] });
    out.push({ t: m[2]!, c: 'comment' });
    return out;
  }
  const k = /^(\s*)(- )?([\w./${}-]+|"[^"]*"|'[^']*')(:)(?=\s|$)(.*)$/.exec(line);
  let rest = line;
  if (k) {
    if (k[1]) out.push({ t: k[1] });
    if (k[2]) out.push({ t: k[2], c: 'dash' });
    out.push({ t: k[3]!, c: 'key' });
    out.push({ t: k[4]!, c: 'punct' });
    rest = k[5]!;
  } else {
    const d = /^(\s*)(- )(.*)$/.exec(line);
    if (d) {
      if (d[1]) out.push({ t: d[1] });
      out.push({ t: d[2]!, c: 'dash' });
      rest = d[3]!;
    }
  }
  if (rest) {
    const value = /^(\s*)(.*?)(\s+#.*)?$/.exec(rest)!;
    if (value[1]) out.push({ t: value[1] });
    const v = value[2]!;
    if (v) {
      if (/^(["']).*\1$/.test(v)) out.push({ t: v, c: 'str' });
      else if (/^(-?\d+(\.\d+)?|true|false|null)$/.test(v)) out.push({ t: v, c: 'num' });
      else out.push({ t: v });
    }
    if (value[3]) out.push({ t: value[3], c: 'comment' });
  }
  return out;
}
