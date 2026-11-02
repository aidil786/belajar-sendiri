// check:mdx for the PromQL interactives (PromQLPlayground, AlertRuleBuilder). They always read
// observability scenarios (src/content/courses/observability/scenarios), from any course.
import { scenarios as observability } from '../../src/content/courses/observability/scenarios/index';
import type { ObsScenario } from '../../src/engine/promql-sim/index';
import { checkBuilderProps } from '../../src/lib/alertRuleBuilder';
import { checkPlaygroundProps } from '../../src/lib/promqlPlayground';

export const PROMQL_REQUIRED: Record<string, string[]> = {
  PromQLPlayground: ['scenario'],
  AlertRuleBuilder: ['scenario', 'exprs'],
};

export function checkPromqlInteractive(name: string, a: Record<string, unknown>, where: string): string[] {
  if (!(name in PROMQL_REQUIRED)) return [];
  const id = a.scenario as string | undefined;
  const sc = id ? (observability[id] as ObsScenario | undefined) : undefined;
  if (id && !sc) return [`${where}: ${name} unknown observability scenario "${id}"`];
  const problems = name === 'PromQLPlayground' ? checkPlaygroundProps(a, sc) : checkBuilderProps(a, sc);
  return problems.map((p) => `${where}: ${name} ${p}`);
}
