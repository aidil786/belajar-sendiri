import { describe, expect, it } from 'vitest';
import { groupFlows, matchesFlow, normalise, type FlowLike } from './rescue';

const flows: FlowLike[] = [
  { id: 'undo-last-commit', title: { en: 'Undo my last commit', ms: 'Undur commit terakhir saya' }, group: 'commits' },
  { id: 'push-rejected', title: { en: 'My push was rejected', ms: 'Push saya ditolak' }, group: 'remote' },
  { id: 'wrong-branch', title: { en: 'I committed on the wrong branch', ms: 'Saya commit di branch yang salah' }, group: 'branches' },
  { id: 'mystery', title: { en: 'Something odd', ms: 'Sesuatu yang pelik' } },
  { id: 'bad-message', title: { en: 'Fix a bad commit message', ms: 'Baiki mesej commit yang salah' }, group: 'commits' },
];

describe('rescue center', () => {
  it('groups flows in page order, keeps file order inside, puts ungrouped last', () => {
    const groups = groupFlows(flows);
    expect(groups.map((g) => g.id)).toEqual(['commits', 'branches', 'remote', 'other']);
    expect(groups[0]!.flows.map((f) => f.id)).toEqual(['undo-last-commit', 'bad-message']);
  });

  it('filter matches every word, in either language, ignoring case and accents', () => {
    const hits = (q: string) => flows.filter((f) => matchesFlow(f, q)).map((f) => f.id);
    expect(hits('')).toHaveLength(5);
    expect(hits('PUSH')).toEqual(['push-rejected']);
    expect(hits('commit message')).toEqual(['bad-message']);
    expect(hits('ditolak')).toEqual(['push-rejected']);
    expect(hits('zebra')).toEqual([]);
    expect(hits('message')).toEqual(['bad-message']); // section names do not count
    expect(normalise('  Café  Déjà ')).toBe('cafe deja');
  });
});
