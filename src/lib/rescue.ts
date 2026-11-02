// Rescue Center helpers: page sections and the filter-as-you-type box. Pure, no DOM.

/** Page sections, in order. Flows without a group go under "other". */
export const RESCUE_GROUPS = ['commits', 'branches', 'remote', 'secrets', 'setup'] as const;
export type RescueGroup = (typeof RESCUE_GROUPS)[number];

type Bi = { en: string; ms: string };
export interface FlowLike {
  id: string;
  title: Bi;
  group?: RescueGroup | undefined;
}

/** Lowercase, no accents, single spaces. */
export function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Group flows by section, keeping the file order inside each section. Empty sections are left out. */
export function groupFlows<F extends FlowLike>(flows: readonly F[]): { id: RescueGroup | 'other'; flows: F[] }[] {
  const order = [...RESCUE_GROUPS, 'other'] as const;
  return order
    .map((id) => ({ id, flows: flows.filter((f) => (f.group ?? 'other') === id) }))
    .filter((g) => g.flows.length > 0);
}

/**
 * Every word typed must appear in the flow's title, in either language.
 * (Section names are left out on purpose: "message" should not match every commit problem.)
 */
export function matchesFlow(flow: FlowLike, query: string): boolean {
  const words = normalise(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const hay = normalise(`${flow.title.en} ${flow.title.ms} ${flow.id.replace(/-/g, ' ')}`);
  return words.every((w) => hay.includes(w));
}
