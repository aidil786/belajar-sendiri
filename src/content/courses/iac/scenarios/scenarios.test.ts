// Every IaC scenario builds, its verify lists run in the engine, and model goals start unmet and
// are met by the solution (the commands a learner would type).
import { describe, expect, it } from 'vitest';
import { buildTofuScenario, checkTofuGoal, plain, run, tofuPicture, type TofuGoal } from '~/engine/tofu-sim';
import { allScenarios, scenarios } from './index';

describe('iac scenarios', () => {
  it('ids are unique', () => {
    expect(new Set(allScenarios.map((s) => s.id)).size).toBe(allScenarios.length);
  });

  for (const sc of allScenarios) {
    it(`${sc.id}: builds and every verify list runs in the engine`, () => {
      const start = buildTofuScenario(sc);
      for (const list of sc.verify ?? []) {
        let st = start;
        for (const line of list) {
          const r = run(st, line, { noColor: true });
          // Commands may fail on purpose (errors are part of the lesson); the engine must not throw.
          expect(r.output).toBeDefined();
          st = r.state;
        }
        expect(st.pending).toBeNull();
      }
    });
  }
});

const GOALS: { id: string; goal: TofuGoal; solution: string[] }[] = [
  { id: 't1-first-blueprint', goal: { resourceInState: ['random_pet.stall', 'local_file.sign'], outputExists: ['stall_name'] }, solution: ['tofu init', 'tofu apply', 'yes'] },
  { id: 't1-first-blueprint', goal: { initialized: true, planSummary: { add: 2, change: 0, destroy: 0 } }, solution: ['tofu init', 'tofu plan'] },
  { id: 't1-food-court', goal: { stateCount: 5, filesExist: ['board.txt'] }, solution: ['tofu init', 'tofu apply -auto-approve'] },
  { id: 't1-messy', goal: { formatted: true }, solution: ['tofu fmt'] },
  { id: 't2-inputs', goal: { outputEquals: { sign: 'KEDAI KANCIL', teh: 2 } }, solution: ['tofu init', 'tofu apply -auto-approve'] },
  { id: 't2-ask', goal: { fileContains: { 'sign.txt': 'Warung Ali' } }, solution: ['tofu init', 'tofu apply', 'Warung Ali', 'yes'] },
  { id: 't2-many', goal: { resourceInState: ['local_file.price["nasi"]', 'random_pet.helper[1]'] }, solution: ['tofu init', 'tofu apply -auto-approve'] },
  { id: 't2-data', goal: { fileContains: { 'copy.txt': 'pandan' } }, solution: ['tofu init', 'tofu apply -auto-approve'] },
  { id: 't3-drift', goal: { filesExist: ['menu.txt'], typed: '^tofu plan -refresh-only' }, solution: ['rm menu.txt', 'tofu plan -refresh-only', 'tofu apply -auto-approve'] },
  { id: 't3-drift', goal: { resourceMissing: ['local_file.menu'], filesExist: ['menu.txt'] }, solution: ['tofu state rm local_file.menu'] },
  { id: 't3-moved', goal: { resourceInState: ['random_pet.chef'], resourceMissing: ['random_pet.stall'] }, solution: ['tofu apply -auto-approve'] },
  { id: 't3-import', goal: { resourceInState: ['random_string.code'], outputExists: [] }, solution: ['tofu init', 'tofu apply -auto-approve'] },
  { id: 't3-secrets', goal: { outputExists: ['pin'], filesExist: ['safe.txt'] }, solution: ['tofu init', 'tofu apply -auto-approve'] },
  { id: 't3-lifecycle', goal: { planSummary: { add: 2, destroy: 2 } }, solution: ['cp .next/main.tf main.tf', 'tofu plan'] },
  { id: 't4-modules', goal: { resourceInState: ['module.kiosk.local_file.sign', 'module.stall.local_file.sign'] }, solution: ['tofu init', 'tofu apply -auto-approve'] },
  { id: 't1-plan-reader', goal: { resourceInState: ['local_file.menu'], resourceMissing: ['local_file.old_menu'] }, solution: ['cp .next/main.tf main.tf', 'tofu apply -auto-approve'] },
  { id: 't1-plan-file', goal: { resourceInState: ['random_pet.stall'], typed: '^tofu apply tfplan' }, solution: ['tofu init', 'tofu plan -out tfplan', 'tofu apply tfplan'] },
];

describe('model goals', () => {
  for (const g of GOALS) {
    it(`${g.id}: ${Object.keys(g.goal).join(', ')} — unmet at start, met after the solution`, () => {
      let st = buildTofuScenario(scenarios[g.id]!);
      expect(checkTofuGoal(st, g.goal, []).ok).toBe(false);
      const typed: string[] = [];
      for (const line of g.solution) {
        const waiting = Boolean(st.pending);
        const r = run(st, line, { noColor: true });
        if (!r.ok && !r.stopped) throw new Error(`${line}: ${plain(r.output)}`);
        if (!waiting) typed.push(line);
        st = r.state;
      }
      expect(checkTofuGoal(st, g.goal, typed)).toEqual({ ok: true, failed: [] });
    });
  }
});

describe('the blueprint vs built picture', () => {
  it('shows what the files ask for, what is built, and the plan marks', () => {
    let st = buildTofuScenario(scenarios['t1-plan-reader']!);
    let pic = tofuPicture(st);
    expect(pic.initialized).toBe(true);
    expect(pic.built.map((b) => b.addr)).toEqual(['local_file.old_menu', 'random_pet.stall', 'terraform_data.board']);
    st = run(st, 'cp .next/main.tf main.tf').state;
    st = run(st, 'tofu plan').state;
    pic = tofuPicture(st);
    const marks = Object.fromEntries([...pic.blueprint, ...pic.built].map((x) => [x.addr, x.mark]));
    expect(marks).toMatchObject({ 'local_file.menu': 'create', 'local_file.old_menu': 'delete', 'random_pet.stall': 'replace', 'terraform_data.board': 'update' });
  });

  it('expands count and for_each in the blueprint', () => {
    const pic = tofuPicture(buildTofuScenario(scenarios['t2-many']!));
    expect(pic.blueprint.map((b) => b.addr)).toEqual(['local_file.price["mee"]', 'local_file.price["nasi"]', 'random_pet.helper[0]', 'random_pet.helper[1]']);
    expect(pic.built).toEqual([]);
  });

  it('says when the blueprint does not load', () => {
    const st = buildTofuScenario(scenarios['t1-first-blueprint']!);
    const broken = { ...st, files: { ...st.files, 'main.tf': 'resource "random_pet" "x" {\n' } };
    expect(tofuPicture(broken).broken).toBe(true);
  });
});
