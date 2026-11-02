// Every night shift drill must work: the scenario builds, the goal is not met at the start,
// the solution meets it, choices and exam mode both work for belts, the help path and docs
// look right, and the words follow the writing rules.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { runScenario, type ConveyorScenario } from '~/engine/conveyor-sim';
import { buildScenario, checkGoal, GOAL_KEYS, run as kubeRun, settle, type KubeScenario } from '~/engine/foodcourt-sim';
import { buildKitchenScenario, checkKitchenGoal, run as kitchenRun, plain } from '~/engine/kitchen-sim';
import { applyFix, checkConveyorProps } from '~/lib/conveyorBelt';
import { KITCHEN_GOAL_KEYS } from '../../../scripts/check-mdx/kitchen';
import { longSentences, NOT_MALAYSIAN } from '../textRules';
import { DRILL_LEVELS, drills, type Drill } from './nightshift';
import { findScenario } from './scenarios';

const rescueIds = (course: string): string[] =>
  ((parse(readFileSync(new URL(`./${course}/rescue.yaml`, import.meta.url), 'utf8')) as { flows: { id: string }[] }).flows ?? []).map((f) => f.id);

/**
 * The engine tests replay whole scenarios (an incident: once per fault). Under a full parallel
 * test run they can pass 5 s, so they get more room; a slow drill is still caught (30 s).
 */
const ENGINE_MS = 30_000;

const DOC_HOSTS: Record<Drill['part'], string> = { docker: 'docs.docker.com', cicd: 'docs.github.com', kubernetes: 'kubernetes.io' };

/** Every learner-facing text of a drill, per language. */
function texts(d: Drill, lang: 'en' | 'ms'): string[] {
  const out = [d.title[lang], d.story[lang], d.task[lang], d.success[lang]];
  if (d.kind !== 'conveyor') out.push(...d.hints.map((h) => h[lang]), ...(d.problems ?? []).map((p) => p.what[lang]));
  else out.push(...d.fixes.flatMap((f) => (f.why ? [f.why[lang]] : [])));
  if (d.rootCause) out.push(d.rootCause.question[lang], d.rootCause.why[lang], ...d.rootCause.options.map((o) => o[lang]));
  return out;
}

describe('night shift drills', () => {
  it('8–40 drills over Docker, CI/CD and Kubernetes, with unique url-safe ids', () => {
    expect(drills.length).toBeGreaterThanOrEqual(8);
    expect(drills.length).toBeLessThanOrEqual(40);
    const ids = drills.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    for (const part of ['docker', 'cicd', 'kubernetes'] as const) expect(drills.filter((d) => d.part === part).length).toBeGreaterThanOrEqual(3);
  });

  it('every level has drills; level 3 (incidents) exists in more than one part', () => {
    for (const level of DRILL_LEVELS) expect(drills.filter((d) => d.level === level).length, `level ${level}`).toBeGreaterThan(0);
    expect(new Set(drills.filter((d) => d.level === 3).map((d) => d.part)).size).toBeGreaterThanOrEqual(2);
  });

  for (const d of drills) {
    describe(d.id, () => {
      it('the help path points at a real Rescue Center flow (once that course has flows) and official docs', () => {
        const flows = rescueIds(d.part);
        if (flows.length) expect(flows).toContain(d.rescue);
        expect(d.rescue).toMatch(d.part === 'cicd' ? /^ci-/ : d.part === 'docker' ? /^docker-/ : /^k8s-/);
        expect(d.docs.length).toBeGreaterThan(0);
        for (const doc of d.docs) expect(new URL(doc.url).host).toBe(DOC_HOSTS[d.part]);
      });

      it('words: short sentences in both languages, Malaysian Malay, kind feedback', () => {
        for (const lang of ['en', 'ms'] as const) {
          for (const text of texts(d, lang)) {
            expect(text.trim().length).toBeGreaterThan(0);
            expect(longSentences(text), `${lang}: ${text}`).toEqual([]);
            expect(text).not.toMatch(/\bwrong\b/i);
          }
        }
        expect(texts(d, 'ms').join(' ')).not.toMatch(NOT_MALAYSIAN);
        if (d.alert !== undefined) expect(d.alert.trim().length).toBeGreaterThan(0);
      });

      it('level rules: hints for levels 1–2; an incident has 2–3 faults and a root-cause question', () => {
        expect(DRILL_LEVELS).toContain(d.level);
        if (d.level < 3 && d.kind !== 'conveyor') expect(d.hints.length, 'levels 1–2 need hints').toBeGreaterThan(0);
        if (d.level === 3) {
          expect(d.kind, 'incidents run in KitchenSim or FoodCourtSim').not.toBe('conveyor');
          expect(d.rootCause, 'an incident asks for the root cause').toBeDefined();
          if (d.kind !== 'conveyor') {
            expect(d.problems?.length ?? 0).toBeGreaterThanOrEqual(2);
            expect(d.problems!.length).toBeLessThanOrEqual(3);
            expect(d.solution).toEqual(d.problems!.flatMap((p) => p.fix));
          }
        }
        if (d.rootCause) {
          const rc = d.rootCause;
          expect(rc.options.length).toBeGreaterThanOrEqual(3);
          expect(rc.options.length).toBeLessThanOrEqual(4);
          expect(Number.isInteger(rc.answer) && rc.answer >= 0 && rc.answer < rc.options.length).toBe(true);
          for (const lang of ['en', 'ms'] as const) expect(new Set(rc.options.map((o) => o[lang])).size).toBe(rc.options.length);
        }
      });

      if (d.kind === 'kitchen') {
        it('kitchen: not done at the start; the solution fixes it', () => {
          for (const k of Object.keys(d.goal)) expect(KITCHEN_GOAL_KEYS.has(k), k).toBe(true);
          let state = buildKitchenScenario(findScenario(d.part, d.scenario));
          expect(checkKitchenGoal(state, d.goal).ok).toBe(false);
          for (const c of d.solution) {
            const r = kitchenRun(state, c);
            expect(r.ok, `${c}\n${plain(r.output)}`).toBe(true);
            state = r.state;
          }
          expect(checkKitchenGoal(state, d.goal, d.solution).failed).toEqual([]);
        }, ENGINE_MS);

        if (d.problems) {
          it('kitchen incident: every fault matters (fixing all but one is not enough)', () => {
            d.problems!.forEach((skip, i) => {
              let state = buildKitchenScenario(findScenario(d.part, d.scenario));
              const rest = d.problems!.filter((p) => p !== skip).flatMap((p) => p.fix);
              for (const c of rest) state = kitchenRun(state, c).state;
              expect(checkKitchenGoal(state, d.goal, rest).ok, `fault ${i + 1} skipped`).toBe(false);
            });
          }, ENGINE_MS);
        }
      }

      if (d.kind === 'kube') {
        it('kube: not done at the start; the solution fixes it', () => {
          for (const k of Object.keys(d.goal)) expect((GOAL_KEYS as readonly string[]).includes(k), k).toBe(true);
          let state = buildScenario(findScenario<KubeScenario>(d.part, d.scenario));
          expect(checkGoal(state, d.goal, []).ok).toBe(false);
          for (const c of d.solution) {
            const r = kubeRun(state, c);
            expect(r.ok, `${c}\n${plain(r.output)}`).toBe(true);
            state = r.state;
          }
          expect(checkGoal(settle(state).state, d.goal, d.solution).failed).toEqual([]);
        }, ENGINE_MS);

        if (d.problems) {
          it('kube incident: every fault matters (fixing all but one is not enough)', () => {
            d.problems!.forEach((skip, i) => {
              let state = buildScenario(findScenario<KubeScenario>(d.part, d.scenario));
              const rest = d.problems!.filter((p) => p !== skip).flatMap((p) => p.fix);
              for (const c of rest) state = kubeRun(state, c).state;
              expect(checkGoal(settle(state).state, d.goal, rest).ok, `fault ${i + 1} skipped`).toBe(false);
            });
          }, ENGINE_MS);
        }
      }

      if (d.kind === 'conveyor') {
        it('conveyor: red at the start; choices and the exam text box both work', () => {
          const s = findScenario<ConveyorScenario>(d.part, d.scenario);
          const event = d.event ?? s.events?.[0] ?? 'push-main';
          expect(runScenario(s, event).status).not.toBe('success');
          const fixes = d.fixes.map((f) => ({ label: f.label, text: f.text, ...(f.correct === false ? { correct: false } : {}) }));
          expect(checkConveyorProps({ event, task: { type: 'green' }, fixes }, s)).toEqual([]);
          expect(checkConveyorProps({ event, task: { type: 'green', forbid: d.forbid ?? [] }, editable: true }, s)).toEqual([]);
          const fixed = applyFix(s, d.solution);
          expect(runScenario(s, event, { yaml: fixed }).status).toBe('success');
          for (const re of d.forbid ?? []) expect(new RegExp(re, 'm').test(fixed), re).toBe(false);
          // Every option marked as not safe really turns green (so the "not the safe answer" note is true),
          // and every option without a why turns green.
          for (const f of d.fixes) {
            const status = runScenario(s, event, { yaml: applyFix(s, f.text) }).status;
            if (f.correct === false || !f.why) expect(status, f.label).toBe('success');
            else expect(status, f.label).not.toBe('success');
          }
          for (const f of d.fixes.filter((x) => x.correct === false)) expect((d.forbid ?? []).some((re) => new RegExp(re, 'm').test(applyFix(s, f.text))), f.label).toBe(true);
        });
      }
    });
  }
});
