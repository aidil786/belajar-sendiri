// Pure logic for the SpotTheHole interactive (workflow lines with hole metadata).
import { auditWorkflow, type HoleKind } from '~/engine/conveyor-sim';

export interface HoleSpec {
  /** Kind of hole: picks the default words (attack, fix, hint). */
  kind?: HoleKind;
  /** The attack, in plain words (default: from the kind). */
  attack?: string;
  /** The fix, in plain words (default: from the kind). */
  fix?: string;
  /** The fixed line(s). Empty string: delete the line. */
  fixCode?: string;
}

export interface HoleLine {
  /** 1-based line number. */
  n: number;
  text: string;
  hole?: HoleSpec;
}

export function holeLines(workflow: (string | { text: string; hole?: HoleSpec })[]): HoleLine[] {
  return workflow.map((l, i) => (typeof l === 'string' ? { n: i + 1, text: l } : { n: i + 1, text: l.text, ...(l.hole ? { hole: l.hole } : {}) }));
}

/** Check SpotTheHole props: there are holes, and the marked holes agree with the engine's audit. */
export function checkHoleProps(p: { workflow?: unknown; scenario?: unknown }, scenarioYaml: string | undefined): string[] {
  const out: string[] = [];
  if (!p.workflow && !scenarioYaml) return ['needs workflow lines or a cicd scenario (course="cicd")'];
  if (p.workflow) {
    if (!Array.isArray(p.workflow)) return ['workflow must be a list of lines'];
    const lines = holeLines(p.workflow as (string | { text: string; hole?: HoleSpec })[]);
    const marked = lines.filter((l) => l.hole);
    if (!marked.length) out.push('mark at least one line with a hole');
    const text = lines.map((l) => l.text).join('\n') + '\n';
    const found = auditWorkflow(text);
    for (const l of marked) {
      if (l.hole!.kind && !found.some((h) => h.line === l.n && h.kind === l.hole!.kind)) out.push(`line ${l.n} is marked "${l.hole!.kind}", but the audit doesn't find it there`);
      if (!l.hole!.kind && (!l.hole!.attack || !l.hole!.fix)) out.push(`line ${l.n}: a hole without a kind needs attack and fix`);
    }
    for (const h of found) if (!marked.some((l) => l.n === h.line)) out.push(`line ${h.line} has a hole (${h.kind}) that is not marked`);
  } else if (!auditWorkflow(scenarioYaml!).length) out.push('the scenario has no holes');
  return out;
}
