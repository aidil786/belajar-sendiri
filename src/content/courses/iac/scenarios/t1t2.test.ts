// The TofuSim goals used in the T1 and T2 lessons: each starts unmet (after the card's intro) and is
// met by what a learner types. File edits a learner makes in the editor are played here with
// `cp .next/… …` (the same "next version" the verify lists use).
import { describe, expect, it } from 'vitest';
import { buildTofuScenario, checkTofuGoal, plain, run, type TofuGoal } from '~/engine/tofu-sim';
import { scenarios } from './index';

interface Case {
  lesson: string;
  id: string;
  intro?: string[];
  goal: TofuGoal;
  solution: string[];
  /** Typing only these must NOT meet the goal yet. */
  notYet?: string[];
}

const CASES: Case[] = [
  // T1
  { lesson: 't1-l01 try-build', id: 't1-sign', intro: ['tofu init'], goal: { resourceInState: ['local_file.sign'], filesExist: ['sign.txt'] }, solution: ['tofu apply', 'yes'], notYet: ['tofu apply', 'no'] },
  { lesson: 't1-l02 try-edit', id: 't1-blocks', goal: { fileContains: { 'sign.txt': 'Selamat datang' } }, solution: ['cp .next/main.tf main.tf', 'tofu apply', 'yes'], notYet: ['tofu apply', 'yes'] },
  { lesson: 't1-l03 hook', id: 't1-first-blueprint', goal: { typed: '^tofu plan' }, solution: ['tofu plan'] },
  { lesson: 't1-l03 try-init', id: 't1-first-blueprint', goal: { initialized: true }, solution: ['tofu init'], notYet: ['tofu plan'] },
  { lesson: 't1-l03 try-loop', id: 't1-first-blueprint', intro: ['tofu init'], goal: { resourceInState: ['random_pet.stall', 'local_file.sign'], outputExists: ['stall_name'] }, solution: ['tofu plan', 'tofu apply', 'yes'], notYet: ['tofu plan'] },
  { lesson: 't1-l04 try-tilde', id: 't1-hours', goal: { planSummary: { add: 0, change: 1, destroy: 0 } }, solution: ['cp .next/main.tf main.tf', 'tofu plan'], notYet: ['tofu plan'] },
  { lesson: 't1-l05 try-apply', id: 't1-ready', goal: { resourceInState: ['random_pet.stall', 'local_file.sign'] }, solution: ['tofu apply', 'yes'], notYet: ['tofu apply', 'y'] },
  { lesson: 't1-l05 try-destroy', id: 't1-built', goal: { stateCount: 0, filesMissing: ['sign.txt'] }, solution: ['tofu destroy', 'yes'], notYet: ['tofu destroy', 'no'] },
  { lesson: 't1-l06 try-list', id: 't1-built', goal: { lastTyped: '^tofu state list' }, solution: ['tofu state list'] },
  { lesson: 't1-l06 try-drift', id: 't1-built', goal: { planSummary: { add: 1, change: 0, destroy: 0 } }, solution: ['rm sign.txt', 'tofu plan'], notYet: ['tofu plan'] },
  { lesson: 't1-l07 hook', id: 't1-typos', intro: ['tofu init'], goal: { lastTyped: '^tofu validate' }, solution: ['tofu validate'] },
  {
    lesson: 't1-l07 try-fix',
    id: 't1-typos',
    intro: ['tofu init'],
    goal: { resourceInState: ['local_file.sign'] },
    solution: ['printf \'resource "random_pet" "stall" {\\n  length = 2\\n}\\n\\nresource "local_file" "sign" {\\n  filename = "sign.txt"\\n  content  = "Welcome to ${random_pet.stall.id}"\\n}\\n\' > main.tf', 'tofu apply', 'yes'],
    notYet: ['tofu apply'],
  },
  { lesson: 't1-l07 try-fmt', id: 't1-messy', goal: { formatted: true }, solution: ['tofu fmt'] },
  { lesson: 't1-l08 try-command', id: 't1-ready', goal: { typed: '^terraform', lastTyped: '^tofu version' }, solution: ['terraform version', 'tofu version'], notYet: ['tofu version'] },
  { lesson: 't1-boss try-build', id: 't1-boss', goal: { stateCount: 5, filesExist: ['board.txt'] }, solution: ['tofu init', 'tofu plan', 'tofu apply', 'yes'] },
  { lesson: 't1-boss try-change', id: 't1-boss-next', goal: { resourceInState: ['local_file.menu'], resourceMissing: ['null_resource.lamp'] }, solution: ['tofu plan', 'tofu apply', 'yes'] },
  { lesson: 't1-boss try-destroy', id: 't1-boss-done', goal: { stateCount: 0, filesMissing: ['board.txt', 'menu.txt'] }, solution: ['tofu destroy', 'yes'] },
  // T2
  { lesson: 't2-l01 try-ask', id: 't2-vars', goal: { resourceInState: ['local_file.sign'] }, solution: ['tofu apply', 'Kedai Kancil', 'yes'] },
  { lesson: 't2-l01 try-rule', id: 't2-inputs', intro: ['tofu init'], goal: { typed: 'tables=20', planSummary: { add: 1 } }, solution: ['tofu plan -var tables=20', 'tofu plan -var tables=6'], notYet: ['tofu plan -var tables=20'] },
  { lesson: 't2-l02 see-auto', id: 't2-tfvars', goal: { planSummary: { add: 1 }, typed: '^tofu plan' }, solution: ['tofu plan'] },
  { lesson: 't2-l02 try-penang', id: 't2-tfvars', goal: { fileContains: { 'sign.txt': 'Penang' } }, solution: ['tofu apply -var-file=penang.tfvars', 'yes'], notYet: ['tofu apply', 'yes'] },
  { lesson: 't2-l03 try-read', id: 't2-outputs', goal: { outputExists: ['stall_name'], lastTyped: '^tofu output' }, solution: ['tofu apply', 'yes', 'tofu output'], notYet: ['tofu output'] },
  { lesson: 't2-l03 try-add', id: 't2-outputs', goal: { outputEquals: { sign_filename: 'sign.txt' } }, solution: ['cp .next/outputs.tf outputs.tf', 'tofu apply', 'yes'], notYet: ['tofu apply', 'yes'] },
  { lesson: 't2-l04 try-change', id: 't2-locals', goal: { fileContains: { 'door.txt': '7am', 'board.txt': '7am' } }, solution: ['cp .next/main.tf main.tf', 'tofu apply', 'yes'] },
  { lesson: 't2-l05 see-list', id: 't2-count', goal: { lastTyped: '^tofu state list' }, solution: ['tofu state list'] },
  { lesson: 't2-l05 try-three', id: 't2-count', goal: { resourceInState: ['random_pet.helper[2]'] }, solution: ['cp .next/main.tf main.tf', 'tofu apply', 'yes'], notYet: ['tofu apply'] },
  { lesson: 't2-l06 see-keys', id: 't2-for-each', goal: { lastTyped: '^tofu state list' }, solution: ['tofu state list'] },
  { lesson: 't2-l06 try-remove', id: 't2-for-each', goal: { planSummary: { add: 0, change: 0, destroy: 1 } }, solution: ['cp .next/variables.tf variables.tf', 'tofu plan'], notYet: ['tofu plan'] },
  { lesson: 't2-l06 try-map', id: 't2-prices', goal: { fileContains: { 'nasi-price.txt': 'RM5' } }, solution: ['tofu apply', 'yes'] },
  { lesson: 't2-l07 try-read', id: 't2-recipe', goal: { fileContains: { 'menu.txt': 'Nasi lemak' }, lastTyped: '^cat menu\\.txt' }, solution: ['tofu apply', 'yes', 'cat menu.txt'], notYet: ['tofu apply', 'yes'] },
  { lesson: 't2-l07 try-change', id: 't2-recipe-built', goal: { fileContains: { 'menu.txt': 'Roti' } }, solution: ['echo "Roti canai with dhal" > recipe.txt', 'tofu apply', 'yes'], notYet: ['echo "Roti canai with dhal" > recipe.txt', 'tofu plan'] },
  { lesson: 't2-l08 see-plan', id: 't2-functions', goal: { lastTyped: '^tofu plan' }, solution: ['tofu plan'] },
  { lesson: 't2-l08 try-upper', id: 't2-functions', goal: { outputEquals: { shop_sign: 'KEDAI KANCIL' } }, solution: ['cp .next/main.tf main.tf', 'tofu apply', 'yes'], notYet: ['tofu apply', 'yes'] },
  { lesson: 't2-l08 try-closed', id: 't2-functions', goal: { outputEquals: { door: 'CLOSED' } }, solution: ['tofu apply -var open=false', 'yes'], notYet: ['tofu apply', 'yes'] },
  { lesson: 't2-boss try-three', id: 't2-boss', goal: { stateCount: 3, filesExist: ['stalls/mee.txt', 'stalls/roti.txt'] }, solution: ['cp .next/terraform.tfvars terraform.tfvars', 'tofu apply', 'yes'], notYet: ['tofu apply', 'yes'] },
  { lesson: 't2-boss try-output', id: 't2-boss-built', goal: { outputExists: ['stall_names'] }, solution: ['cp .next/outputs.tf outputs.tf', 'tofu apply', 'yes'], notYet: ['tofu apply', 'yes'] },
  { lesson: 't2-boss try-close', id: 't2-boss-built', goal: { planSummary: { add: 0, change: 0, destroy: 1 } }, solution: ['cp .next/closed.tfvars terraform.tfvars', 'tofu plan'], notYet: ['tofu plan'] },
];

function play(id: string, intro: string[], lines: string[]) {
  let st = buildTofuScenario(scenarios[id]!);
  for (const line of intro) {
    const r = run(st, line, { noColor: true });
    if (!r.ok && !r.stopped) throw new Error(`intro ${line}: ${plain(r.output)}`);
    st = r.state;
  }
  const typed: string[] = [];
  for (const line of lines) {
    const waiting = Boolean(st.pending);
    const r = run(st, line, { noColor: true });
    if (!waiting) typed.push(line);
    st = r.state;
  }
  return { st, typed };
}

describe('T1 and T2 lesson goals', () => {
  for (const c of CASES) {
    it(`${c.lesson} (${c.id}): unmet at the start, met after the solution`, () => {
      const start = play(c.id, c.intro ?? [], []);
      expect(checkTofuGoal(start.st, c.goal, start.typed).ok).toBe(false);
      if (c.notYet) {
        const half = play(c.id, c.intro ?? [], c.notYet);
        expect(checkTofuGoal(half.st, c.goal, half.typed).ok, `not yet after ${c.notYet.join(' ; ')}`).toBe(false);
      }
      const end = play(c.id, c.intro ?? [], c.solution);
      expect(checkTofuGoal(end.st, c.goal, end.typed).failed).toEqual([]);
    });
  }
});
