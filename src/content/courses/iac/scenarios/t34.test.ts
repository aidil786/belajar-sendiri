// The TofuSim goals of the T3 + T4 lessons: each starts unmet and the commands (and file edits)
// a learner would make meet it. A wrong move (rebuilding instead of moving, applying before the
// import) must not meet it.
import { describe, expect, it } from 'vitest';
import { buildTofuScenario, checkTofuGoal, run, type TofuGoal, type TofuState } from '~/engine/tofu-sim';
import { scenarios } from './index';

type Step = string | { edit: string; content: string } | { copy: string; to: string };

function play(id: string, steps: Step[]): { st: TofuState; typed: string[] } {
  let st = buildTofuScenario(scenarios[id]!);
  const typed: string[] = [];
  for (const s of steps) {
    if (typeof s === 'string') {
      const r = run(st, s, { noColor: true });
      st = r.state;
      typed.push(s);
    } else if ('edit' in s) st = { ...st, files: { ...st.files, [s.edit]: s.content } };
    else st = { ...st, files: { ...st.files, [s.to]: st.files[s.copy]! } };
  }
  return { st, typed };
}

const met = (id: string, goal: TofuGoal, steps: Step[]) => {
  const { st, typed } = play(id, steps);
  return checkTofuGoal(st, goal, typed).ok;
};

const CASES: { id: string; goal: TofuGoal; solution: Step[]; wrong?: Step[] }[] = [
  { id: 't3-register', goal: { typed: '^ls', lastTyped: '^cat terraform\\.tfstate' }, solution: ['ls', 'cat terraform.tfstate'] },
  { id: 't3-drift-menu', goal: { planSummary: { add: 1, change: 0, destroy: 0 }, lastTyped: '^tofu plan' }, solution: ['tofu plan'] },
  { id: 't3-drift-menu', goal: { fileNotContains: { 'menu.txt': 'Maggi' }, filesExist: ['menu.txt'] }, solution: ['tofu apply', 'yes'], wrong: ['tofu apply -refresh-only -auto-approve'] },
  { id: 't3-import-door', goal: { planSummary: { add: 1 }, lastTyped: '^tofu plan' }, solution: ['tofu plan'] },
  { id: 't3-import-door', goal: { outputEquals: { door: 'KANCIL' } }, solution: [{ copy: '.next/main.tf', to: 'main.tf' }, 'tofu plan', 'tofu apply', 'yes'], wrong: ['tofu apply -auto-approve'] },
  { id: 't3-rename', goal: { resourceInState: ['random_pet.chef'], outputEquals: { stall: 'lucky-civet' } }, solution: [{ copy: '.next/main.tf', to: 'main.tf' }, 'tofu apply -auto-approve'], wrong: ['tofu apply -auto-approve'] },
  { id: 't3-register-big', goal: { typed: '^tofu state list$', lastTyped: '^tofu state show random_integer\\.table$' }, solution: ['tofu state list', 'tofu state show random_integer.table'] },
  { id: 't3-register-big', goal: { resourceMissing: ['local_file.sign'], filesExist: ['sign.txt'], lastTyped: '^tofu plan' }, solution: ['tofu state rm local_file.sign', 'tofu plan'] },
  { id: 't3-secret-pin', goal: { outputExists: ['pin'], resourceInState: ['random_password.pin'] }, solution: ['tofu plan', { copy: '.next/main.tf', to: 'main.tf' }, 'tofu apply -auto-approve'], wrong: ['tofu apply -auto-approve'] },
  { id: 't3-secret-built', goal: { lastTyped: '^tofu output -raw pin$' }, solution: ['tofu output -raw pin'] },
  { id: 't3-workspace', goal: { filesExist: ['default-sign.txt'] }, solution: ['tofu apply', 'yes'] },
  { id: 't3-boss-drift', goal: { fileContains: { 'menu.txt': 'Roti canai' }, fileNotContains: { 'menu.txt': 'Mee goreng' }, filesExist: ['sign.txt'] }, solution: ['tofu plan', 'tofu apply', 'yes'] },
  { id: 't3-boss-door', goal: { outputEquals: { door: 'KANCIL' } }, solution: [{ copy: '.next/main.tf', to: 'main.tf' }, 'tofu apply -auto-approve'], wrong: ['tofu apply -auto-approve'] },
  { id: 't3-boss-rename', goal: { resourceInState: ['random_pet.chef'], outputEquals: { name: 'lucky-civet' } }, solution: [{ copy: '.next/main.tf', to: 'main.tf' }, 'tofu apply -auto-approve'], wrong: ['tofu apply -auto-approve'] },
  { id: 't4-kiosk', goal: { resourceInState: ['module.roti.local_file.sign'] }, solution: [{ copy: '.next/main.tf', to: 'main.tf' }, 'tofu plan', 'tofu init', 'tofu apply -auto-approve'] },
  { id: 't4-lock', goal: { lastTyped: '^cat \\.terraform\\.lock\\.hcl$' }, solution: ['cat .terraform.lock.hcl'] },
  { id: 't4-lock-new', goal: { fileContains: { '.terraform.lock.hcl': 'hashicorp/null' } }, solution: ['tofu plan', 'tofu init'] },
  { id: 't4-secret-env', goal: { typed: '^export TF_VAR_db_password=', resourceInState: ['local_sensitive_file.db_conf'] }, solution: ['export TF_VAR_db_password=teh-tarik-42', 'tofu apply', 'yes'] },
  {
    id: 't4-boss-module',
    goal: { fileContains: { 'main.tf': 'moved' }, resourceInState: ['module.nasi.local_file.sign', 'module.mee.local_file.sign'], resourceMissing: ['local_file.nasi', 'local_file.mee'] },
    solution: ['tofu plan', 'tofu init', { copy: '.next/main.tf', to: 'main.tf' }, 'tofu plan', 'tofu apply -auto-approve'],
    wrong: ['tofu init', 'tofu apply -auto-approve'],
  },
  { id: 't4-boss-lock', goal: { fileContains: { '.terraform.lock.hcl': 'hashicorp/null' }, resourceInState: ['null_resource.bell'] }, solution: ['tofu plan', 'tofu init', 'tofu apply -auto-approve'] },
];

describe('T3 + T4 lesson goals', () => {
  for (const c of CASES) {
    it(`${c.id}: ${Object.keys(c.goal).join(', ')}`, () => {
      expect(met(c.id, c.goal, []), 'not met at the start').toBe(false);
      expect(met(c.id, c.goal, c.solution), 'met by the solution').toBe(true);
      if (c.wrong) expect(met(c.id, c.goal, c.wrong), 'not met by the wrong move').toBe(false);
    });
  }

  it('the moved fix plans 0 to destroy; the plain rename destroys', () => {
    const plain = play('t3-rename', ['tofu plan']).st;
    expect(Object.values(plain.lastPlan ?? {})).toContain('delete');
    const fixed = play('t3-rename', [{ copy: '.next/main.tf', to: 'main.tf' }, 'tofu plan']).st;
    expect(Object.values(fixed.lastPlan ?? {}).filter((a) => a === 'delete' || a === 'replace')).toEqual([]);
  });
});
