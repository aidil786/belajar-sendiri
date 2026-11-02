// aws course scenarios, by id. AWS has no simulator (no free sandbox to check against): these are
// starting states for the pure-logic games (IamJudge policies, SubnetPlanner VPCs, SecurityGroupGate
// rules), each game defining its own shape and unit-tested against the official docs' worked examples.
// Lesson helpers: add your world's presets in their own file (e.g. a2.ts) and spread them in below
// (one line per world). Components find them with findScenario<T>('aws', id).
export const allScenarios: { id: string }[] = [];

export const scenarios: Record<string, unknown> = Object.fromEntries(allScenarios.map((s) => [s.id, s]));
