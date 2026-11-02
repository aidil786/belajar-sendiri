// The CKAD practice tasks: every task starts from a real Kubernetes scenario, its goal is not met at
// the start, the reference solution meets it in the engine, and the words follow the rules.
import { describe, expect, it } from 'vitest';
import { buildScenario, checkGoal, GOAL_KEYS, plain, run as kubeRun, settle, tick, type KubeScenario } from '~/engine/foodcourt-sim';
import { findScenario } from '../courses/scenarios';
import { codeSpans, longSentences, NOT_MALAYSIAN } from '../textRules';
import { CKAD_DOCS, CKAD_DOMAINS, CKAD_URL, ckadTasks, type CkadTask } from './ckad';

const texts = (t: CkadTask, lang: 'en' | 'ms') => [t[lang].task, t[lang].hint];

describe('CKAD tasks', () => {
  it('the five current official domains, with weights that add up to 100', () => {
    expect(CKAD_DOMAINS.map((d) => d.name.en)).toEqual([
      'Application Design and Build',
      'Application Deployment',
      'Application Observability and Maintenance',
      'Application Environment, Configuration and Security',
      'Services and Networking',
    ]);
    expect(CKAD_DOMAINS.map((d) => d.weight)).toEqual([20, 20, 15, 25, 20]);
    expect(CKAD_DOCS).toEqual(['kubernetes.io/docs', 'kubernetes.io/blog', 'helm.sh/docs']);
    expect(new URL(CKAD_URL).host).toBe('training.linuxfoundation.org');
  });

  it('unique, url-safe ids; at least 4 domains covered', () => {
    const ids = ckadTasks.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of ckadTasks) expect(t.id).toMatch(new RegExp(`^ckad-${t.domain}-\\d{3}$`));
    expect(new Set(ckadTasks.map((t) => t.domain)).size).toBeGreaterThanOrEqual(4);
  });

  for (const t of ckadTasks) {
    describe(t.id, () => {
      it('a known domain, a real scenario, known goal keys and an official docs page', () => {
        expect(CKAD_DOMAINS.map((d) => d.id)).toContain(t.domain);
        expect(() => findScenario<KubeScenario>('kubernetes', t.scenario)).not.toThrow();
        expect(Object.keys(t.goal).length).toBeGreaterThan(0);
        for (const k of Object.keys(t.goal)) expect((GOAL_KEYS as readonly string[]).includes(k), k).toBe(true);
        // The exam's own rules: no typed-command goals (any path that works should pass).
        expect(t.goal.typed ?? t.goal.lastTyped).toBeUndefined();
        const url = new URL(t.docs.url);
        expect(url.protocol).toBe('https:');
        expect(CKAD_DOCS.some((site) => `${url.host}${url.pathname}`.startsWith(site)), t.docs.url).toBe(true);
      });

      it('not done at the start; the reference solution does it', () => {
        let state = buildScenario(findScenario<KubeScenario>('kubernetes', t.scenario));
        expect(checkGoal(state, t.goal, []).ok).toBe(false);
        for (const c of t.solution) {
          const r = kubeRun(state, c);
          expect(r.ok, `${c}\n${plain(r.output)}`).toBe(true);
          state = r.state;
        }
        expect(checkGoal(settle(state).state, t.goal, t.solution).failed).toEqual([]);
      });

      it('waiting does not solve it (the clock keeps running on the page)', { timeout: 30_000 }, () => {
        let state = buildScenario(findScenario<KubeScenario>('kubernetes', t.scenario));
        let at = 0;
        for (const until of [30, 120, 300]) {
          state = tick(state, until - at).state;
          at = until;
          expect(checkGoal(state, t.goal, []).ok, `after ${at} s`).toBe(false);
        }
      });

      it('words: short sentences, the same names in EN and MS, Malaysian Malay', () => {
        for (const lang of ['en', 'ms'] as const) {
          for (const text of texts(t, lang)) {
            expect(text.trim().length).toBeGreaterThan(0);
            expect(longSentences(text), `${lang}: ${text}`).toEqual([]);
          }
        }
        expect(codeSpans(t.ms.task)).toEqual(codeSpans(t.en.task));
        expect(codeSpans(t.ms.hint)).toEqual(codeSpans(t.en.hint));
        expect(texts(t, 'en').join(' ')).not.toMatch(/\bwrong\b/i);
        expect(texts(t, 'ms').join(' ')).not.toMatch(NOT_MALAYSIAN);
      });
    });
  }
});
