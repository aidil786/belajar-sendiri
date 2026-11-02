import { describe, expect, it } from 'vitest';
import { buildScenario, duration, instantQuery, parseExpr, PromQLError } from '~/engine/promql-sim';
import { findScenario } from '../../scenarios';
import { allObsScenarios, scenarios } from './index';

describe('observability scenarios', () => {
  it('ids are unique and start with the world code', () => {
    const ids = allObsScenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^o[1-4]-[a-z0-9-]+$/);
    expect(findScenario('observability', 'o2-shop-requests')).toBe(scenarios['o2-shop-requests']);
  });

  for (const sc of allObsScenarios) {
    describe(sc.id, () => {
      const b = buildScenario(sc);

      it('builds, with the eval time inside the data and its rules running cleanly', () => {
        expect(sc.about, 'say in one line what the data shows').toBeTruthy();
        expect(b.end).toBeGreaterThan(0);
        expect(b.evalTime).toBeLessThanOrEqual(b.end);
        expect(b.rules?.errors ?? []).toEqual([]);
      });

      it('metric chips exist in the data', () => {
        const names = new Set(b.store.metricNames());
        for (const m of sc.metrics ?? []) expect(names.has(m), m).toBe(true);
      });

      it('verify entries parse, and error: true ones fail', () => {
        for (const v of sc.verify) {
          for (const at of v.at) expect(() => duration(at)).not.toThrow();
          if ('alert' in v) {
            expect(() => parseExpr(v.alert.expr)).not.toThrow();
            continue;
          }
          if (v.error) {
            let failed = false;
            try {
              instantQuery(b.store, v.expr, duration(v.at[0]!));
            } catch (e) {
              failed = e instanceof PromQLError;
            }
            expect(failed, v.expr).toBe(true);
          } else expect(() => instantQuery(b.store, v.expr, duration(v.at[0]!)), v.expr).not.toThrow();
        }
      });
    });
  }
});
