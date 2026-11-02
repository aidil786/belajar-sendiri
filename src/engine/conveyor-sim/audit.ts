// Find security holes in a workflow, with the line each one is on.
// Based on GitHub's "Security hardening for GitHub Actions" guide
// (docs.github.com/en/actions/reference/security/secure-use).
import { GITHUB_OWNERS, isFullSha, parseUses } from './actions';
import { parseWorkflow } from './parse';

export type HoleKind = 'unpinned' | 'writeAll' | 'prTargetCheckout' | 'injection' | 'secretEcho' | 'selfHosted';

export interface Hole {
  kind: HoleKind;
  /** 1-based line. */
  line: number;
  /** What was found (the action, the expression, the secret name…). */
  detail: string;
}

/** Event data that anyone can write (titles, bodies, branch names). */
const UNTRUSTED =
  /github\.(event\.(issue\.(title|body)|pull_request\.(title|body|head\.ref|head\.label|head\.repo\.default_branch)|comment\.body|review\.body|review_comment\.body|pages\.[^.\s]+\.page_name|commits\.[^.\s]+\.(message|author\.(email|name))|head_commit\.(message|author\.(email|name))|discussion\.(title|body)|workflow_run\.(head_branch|head_commit\.message))|head_ref)\b/;

export interface AuditOptions {
  /** The repository is public (self-hosted runners are risky there). Default true. */
  publicRepo?: boolean;
}

export function auditWorkflow(text: string, o: AuditOptions = {}): Hole[] {
  const { workflow } = parseWorkflow(text);
  if (!workflow) return [];
  const lines = text.split(/\r?\n/);
  const holes: Hole[] = [];
  const add = (kind: HoleKind, line: number | undefined, detail: string) => {
    if (line && !holes.some((h) => h.kind === kind && h.line === line)) holes.push({ kind, line, detail });
  };

  if (workflow.permissions === 'write-all') add('writeAll', workflow.permissionsLine, 'write-all');
  const prTarget = 'pull_request_target' in workflow.on;

  for (const job of workflow.jobs) {
    if (job.permissions === 'write-all') {
      const at = findLine(lines, job.line, /^\s*permissions:\s*write-all\b/);
      add('writeAll', at, 'write-all');
    }
    if ((o.publicRepo ?? true) && job.runsOn.some((l) => l.toLowerCase() === 'self-hosted')) add('selfHosted', job.runsOnLine, 'self-hosted');
    for (const step of job.steps) {
      if (step.uses) {
        const u = parseUses(step.uses);
        const owner = u.name.split('/')[0] ?? '';
        if (!u.local && !u.docker && !GITHUB_OWNERS.has(owner) && !isFullSha(u.ref)) add('unpinned', step.usesLine, step.uses);
        if (prTarget && u.name === 'actions/checkout') {
          const ref = step.with.ref ?? '';
          if (/github\.event\.pull_request\.head\.(sha|ref)|github\.head_ref/.test(ref)) {
            add('prTargetCheckout', findLine(lines, step.line, /^\s*ref:/), ref);
          }
        }
      }
      if (step.run && step.runLines) {
        const [from, to] = step.runLines;
        for (let n = from; n <= to; n++) {
          const text = lines[n - 1] ?? '';
          for (const m of text.matchAll(/\$\{\{([^}]*)\}\}/g)) {
            const expr = m[1]!.trim();
            if (UNTRUSTED.test(expr)) add('injection', n, expr);
            else if (/\bsecrets\./.test(expr) && /\becho\b|\bprintf\b/.test(text)) add('secretEcho', n, expr);
          }
        }
      }
    }
  }
  return holes.sort((a, b) => a.line - b.line);
}

function findLine(lines: string[], from: number, re: RegExp): number | undefined {
  for (let n = from; n <= lines.length; n++) if (re.test(lines[n - 1] ?? '')) return n;
  return undefined;
}
