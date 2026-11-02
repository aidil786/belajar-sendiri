// Every cicd scenario: the engine reads it, runs end as promised, holes match the audit,
// and a fix region exists. (actionlint runs in `npm run verify:workflows`.)
import { describe, expect, it } from 'vitest';
import { auditWorkflow, KNOWN_ACTIONS, isFullSha, parseUses, parseWorkflow, replaceLines, runScenario, type EventPreset } from '~/engine/conveyor-sim';
import { allConveyorScenarios, scenarios } from './index';

describe('cicd scenarios', () => {
  it('ids are unique and registered', () => {
    const ids = allConveyorScenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(scenarios[id]).toBeTruthy();
  });

  for (const s of allConveyorScenarios) {
    describe(s.id, () => {
      it('reads with no error and uses the taught action versions', () => {
        const { workflow, issues } = parseWorkflow(s.workflow);
        expect(issues.filter((i) => i.level !== 'info')).toEqual([]);
        for (const step of workflow!.jobs.flatMap((j) => j.steps)) {
          if (!step.uses) continue;
          const u = parseUses(step.uses);
          const known = KNOWN_ACTIONS[u.name];
          if (known && !isFullSha(u.ref)) expect(`${u.name}@${u.ref}`).toBe(`${u.name}@${known.version}`);
        }
      });

      for (const [event, status] of Object.entries(s.expect ?? {})) {
        it(`${event} → ${status}`, () => {
          expect(runScenario(s, event as EventPreset).status).toBe(status);
        });
      }

      if (s.holes) {
        it('holes match auditWorkflow, and the fixed file has none', () => {
          const found = auditWorkflow(s.workflow, { publicRepo: !s.repo?.private }).map((h) => `${h.line}:${h.kind}`);
          expect(found).toEqual(s.holes!.map((h) => `${h.line}:${h.kind}`));
          if (s.fixed) expect(auditWorkflow(s.fixed)).toEqual([]);
        });
      }
    });
  }

  it('c2-fix-permissions: packages: write makes it green; write-all does too (but is not least privilege)', () => {
    const s = allConveyorScenarios.find((x) => x.id === 'c2-fix-permissions')!;
    const fixed = replaceLines(s.workflow, s.fix!.from, s.fix!.to, 'permissions:\n  contents: read\n  packages: write');
    expect(runScenario(s, 'push-main', { yaml: fixed }).status).toBe('success');
    expect(runScenario(s, 'push-main', { yaml: replaceLines(s.workflow, s.fix!.from, s.fix!.to, 'permissions: write-all') }).status).toBe('success');
    expect(runScenario(s, 'push-main', { yaml: replaceLines(s.workflow, s.fix!.from, s.fix!.to, 'permissions:\n  contents: write') }).status).toBe('failure');
  });

  it('c3-release: approving production finishes the release', () => {
    const s = allConveyorScenarios.find((x) => x.id === 'c3-release')!;
    expect(runScenario(s, 'tag', { decisions: { production: 'approve' } }).status).toBe('success');
  });
});
