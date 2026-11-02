// PlanReader logic (pure): run a scenario in the OpenTofu simulator, make a plan, and turn each
// resource change into a card the learner classifies: create, update, destroy or replace — and,
// for a replace, which argument forces it. The plan text is the engine's own (OpenTofu 1.13.5
// words), with the "will be created" style comment hidden so the learner reads the symbols.
import { buildTofuScenario, plain, run, renderChange, type Change, type TofuScenario } from '~/engine/tofu-sim';
import { schemaFor } from '~/engine/tofu-sim/providers';
import { valEq, hasUnknown, type Val } from '~/engine/tofu-sim/values';

export type ReaderAction = 'create' | 'update' | 'delete' | 'replace';

export interface ReaderItem {
  addr: string;
  action: ReaderAction;
  /** "-/+" or "+/-" for a replace. */
  symbol: string;
  /** The change as OpenTofu prints it, with the action words hidden. */
  lines: string[];
  /** For a replace: the arguments that force it (any one is a right answer). */
  forces: string[];
  /** For a replace: arguments to choose from (the ones that change). */
  choices: string[];
}

export interface ReaderPlan {
  items: ReaderItem[];
  /** "Plan: 1 to add, 1 to change, 1 to destroy." */
  summary: string;
  error?: string;
}

const PLAN_FILE = '.planreader';

function changedAttrs(c: Change): string[] {
  const b = (c.before?.v ?? {}) as Record<string, Val>;
  const a = (c.after?.v ?? {}) as Record<string, Val>;
  return [...new Set([...Object.keys(b), ...Object.keys(a)])]
    .filter((n) => {
      const x = b[n];
      const y = a[n];
      if ((!x || x.v === null) && (!y || y.v === null)) return false;
      return !(x && y && valEq(x, y) && !hasUnknown(y));
    })
    .sort();
}

/** Build the cards for a scenario (after `commands`), planning with `flags` (e.g. "-destroy"). */
export function buildReader(scenario: TofuScenario, commands: string[] = [], flags = ''): ReaderPlan {
  let st = buildTofuScenario(scenario);
  for (const c of commands) {
    const r = run(st, c, { noColor: true });
    if (!r.ok && !r.stopped) return { items: [], summary: '', error: `"${c}" failed: ${plain(r.output).split('\n').slice(0, 4).join(' ')}` };
    st = r.state;
  }
  const r = run(st, `tofu plan -no-color -out ${PLAN_FILE}${flags ? ` ${flags}` : ''}`, { noColor: true });
  const plan = r.state.plans[PLAN_FILE];
  if (!plan) return { items: [], summary: '', error: plain(r.output).split('\n').filter(Boolean).slice(0, 4).join(' ') };
  const items: ReaderItem[] = [];
  for (const c of plan.changes) {
    if (c.mode !== 'managed' || c.action === 'noop' || c.action === 'read') continue;
    const lines = plain(renderChange(c)).split('\n');
    // Hide the comment lines that say what will happen; keep the address.
    const body = lines.filter((l) => !/^ {2}# \(/.test(l) && !/^ {2}# Warning/.test(l)).map((l, i) => (i === 0 ? `  # ${c.addr}` : l));
    const changed = changedAttrs(c);
    let forces = c.forces;
    if (c.action === 'replace' && !forces.length) {
      const rt = schemaFor('managed', c.type);
      forces = changed.filter((n) => rt?.attrs[n]?.forceNew);
    }
    const action = c.action as ReaderAction;
    items.push({
      addr: c.addr,
      action,
      symbol: action === 'replace' ? (c.cbd ? '+/-' : '-/+') : action === 'create' ? '+' : action === 'delete' ? '-' : '~',
      lines: body,
      forces,
      choices: action === 'replace' ? changed.filter((n) => schemaFor('managed', c.type)?.attrs[n]?.optional || schemaFor('managed', c.type)?.attrs[n]?.required) : [],
    });
  }
  const summary = plain(r.output).split('\n').find((l) => /^Plan: /.test(l)) ?? '';
  return { items, summary };
}

/** Problems with PlanReader props (for check:mdx). */
export function checkReaderProps(scenario: TofuScenario | undefined, a: Record<string, unknown>): string[] {
  if (!scenario) return ['needs an iac scenario'];
  const p = buildReader(scenario, (a.commands as string[] | undefined) ?? [], (a.flags as string | undefined) ?? '');
  if (p.error) return [`the plan failed: ${p.error}`];
  if (!p.items.length) return ['the plan has no resource changes to read'];
  const out: string[] = [];
  for (const it of p.items) if (it.action === 'replace' && a.askWhy !== false && !it.forces.length) out.push(`${it.addr} is replaced but no argument forces it (set askWhy={false})`);
  return out;
}
