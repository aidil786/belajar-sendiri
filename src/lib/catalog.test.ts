import { describe, expect, it } from 'vitest';
import en from '~/i18n/en.json';
import ms from '~/i18n/ms.json';
import {
  commandHref,
  FAMILIES,
  familyKeys,
  HATS,
  LEVEL_UP,
  mapOrder,
  placeOfPath,
  reviewItemId,
  SHIP_IT,
  sortCourses,
  toolHref,
  TOOLS,
  toolVersionText,
  worldCode,
  worldList,
} from './catalog';

const git = { id: 'git' };
const docker = { id: 'docker', family: 'ship-it', part: 1 };
const cicd = { id: 'cicd', family: 'ship-it', part: 2 };
const k8s = { id: 'kubernetes', family: 'ship-it', part: 3 };
const linux = { id: 'linux', family: 'level-up', part: 1 };
const iac = { id: 'iac', family: 'level-up', part: 2 };
const obs = { id: 'observability', family: 'level-up', part: 3 };
const aws = { id: 'aws', family: 'level-up', part: 4 };

describe('catalog helpers', () => {
  it('keeps the Git tool URLs short and gives other courses their own', () => {
    expect(toolHref('en', git, 'glossary')).toBe('/en/glossary/');
    expect(toolHref('ms', git, 'rescue')).toBe('/ms/rescue/');
    expect(toolHref('en', docker, 'glossary')).toBe('/en/docker/glossary/');
    expect(toolHref('en', k8s, 'cheatsheet')).toBe('/en/kubernetes/cheatsheet/');
    // Ship It has one Rescue Center for all three parts.
    expect(toolHref('en', cicd, 'rescue')).toBe('/en/ship-it/rescue/');
    expect(commandHref('en', 'git', 'add')).toBe('/en/commands/add/');
    expect(commandHref('ms', 'docker', 'run')).toBe('/ms/docker/commands/run/');
  });

  it('gives Level Up courses their own tool pages and one shared Rescue Center', () => {
    expect(toolHref('en', linux, 'glossary')).toBe('/en/linux/glossary/');
    expect(toolHref('ms', obs, 'commands')).toBe('/ms/observability/commands/');
    expect(toolHref('en', aws, 'cheatsheet')).toBe('/en/aws/cheatsheet/');
    for (const c of [linux, iac, obs, aws]) expect(toolHref('ms', c, 'rescue')).toBe('/ms/level-up/rescue/');
    expect(commandHref('en', 'iac', 'tofu-plan')).toBe('/en/iac/commands/tofu-plan/');
  });

  it('knows the course or family of a path', () => {
    const ids = ['git', 'docker', 'cicd', 'kubernetes', 'linux', 'iac', 'observability', 'aws'];
    expect(placeOfPath('/en/docker/first-containers/port-mapping/', ids)).toEqual({ course: 'docker' });
    expect(placeOfPath('/ms/git/', ids)).toEqual({ course: 'git' });
    expect(placeOfPath('/en/ship-it/rescue/', ids)).toEqual({ family: 'ship-it' });
    expect(placeOfPath('/en/level-up/', ids)).toEqual({ family: 'level-up' });
    expect(placeOfPath('/ms/level-up/rescue/', ids)).toEqual({ family: 'level-up' });
    expect(placeOfPath('/en/aws/renting-a-unit/budget-alarm/', ids)).toEqual({ course: 'aws' });
    expect(placeOfPath('/en/glossary/', ids)).toEqual({});
    expect(placeOfPath('/en/', ids)).toEqual({});
  });

  it('puts the first course first, then each family in catalog order with its parts in order', () => {
    expect(sortCourses([k8s, git, cicd, docker]).map((c) => c.id)).toEqual(['git', 'docker', 'cicd', 'kubernetes']);
    // Ship It stays before Level Up (alphabetical order would flip them), so review card order never shifts.
    expect(sortCourses([aws, linux, k8s, iac, git, obs, cicd, docker]).map((c) => c.id)).toEqual([
      'git',
      'docker',
      'cicd',
      'kubernetes',
      'linux',
      'iac',
      'observability',
      'aws',
    ]);
    expect(FAMILIES).toEqual([SHIP_IT, LEVEL_UP]);
    // A course without a family comes right after the first one; an unknown family goes last.
    expect(sortCourses([{ id: 'x', family: 'zzz' }, linux, { id: 'loose' }, git]).map((c) => c.id)).toEqual(['git', 'loose', 'linux', 'x']);
  });

  it('shows world codes and world lists', () => {
    expect(worldCode({ id: 1, code: 'D1' })).toBe('D1');
    expect(worldCode({ id: 3 })).toBe('3');
    expect(worldList([0, 1, 2, 3, 4])).toEqual({ text: '0–4', many: true });
    expect(worldList([7])).toEqual({ text: '7', many: false });
    expect(worldList([3, 1])).toEqual({ text: '1, 3', many: true });
    expect(worldList([])).toEqual({ text: '', many: false });
  });

  it('names worlds by their code in "best after" lists', () => {
    const code = (id: number) => `K${id}`;
    expect(worldList([5], code)).toEqual({ text: 'K5', many: false });
    expect(worldList([1, 2, 3], code)).toEqual({ text: 'K1–K3', many: true });
    expect(worldList([4, 1], code)).toEqual({ text: 'K1, K4', many: true });
  });

  it('keeps the finish line last on a map; an extra pack stays in outline order', () => {
    const worlds = [
      { id: 7, code: 'K7' },
      { id: 8, code: 'K8', finale: true },
      { id: 9, code: 'K9', extra: true },
    ];
    expect(mapOrder(worlds).map((w) => w.code)).toEqual(['K7', 'K9', 'K8']);
    expect(mapOrder([{ id: 1 }, { id: 2 }]).map((w) => w.id)).toEqual([1, 2]);
  });

  it('keeps Git review ids and prefixes the others', () => {
    expect(reviewItemId('git', 'commit')).toBe('commit');
    expect(reviewItemId('docker', 'registry')).toBe('docker:registry');
    expect(reviewItemId('linux', 'shell')).toBe('linux:shell');
  });

  it('reads tool versions for the lesson frame', () => {
    expect(toolVersionText('debian-13')).toBe('(Debian 13)');
    expect(toolVersionText('1.12')).toBe('1.12');
    expect(toolVersionText('2026-11')).toBe('2026-11');
  });
});

describe('family words, tools and outfits exist in both languages', () => {
  const dicts = { en: en as Record<string, string>, ms: ms as Record<string, string> };

  it.each(FAMILIES)('every overview and Rescue Center key of %s', (family) => {
    const keys = familyKeys(family);
    // Level Up has no finish line, but keeps the key so the shared layout never shows a raw key.
    for (const key of Object.values(keys)) for (const [lang, dict] of Object.entries(dicts)) expect(dict[key], `${lang}: ${key}`).toBeTruthy();
  });

  it('keeps Ship It on its older rescue keys and gives Level Up its own', () => {
    expect(familyKeys(SHIP_IT)).toMatchObject({ title: 'shipit.title', rescueTitle: 'rescue.shipItTitle', rescueFilterHint: 'rescue.filterHintShip' });
    expect(familyKeys(LEVEL_UP)).toMatchObject({ title: 'levelup.title', rescueTitle: 'levelup.rescueTitle', missionsText: 'levelup.missionsText' });
    expect(dicts.en['levelup.title']).toBe('Level Up');
    expect(dicts.ms['levelup.title']).toBe('Naik Tahap');
  });

  it('names every tool (lesson frame "Checked with …") and every outfit (screen-reader label)', () => {
    expect(TOOLS).toEqual(expect.arrayContaining(['linux', 'opentofu', 'prometheus', 'aws']));
    expect(HATS).toEqual(expect.arrayContaining(['toolbelt', 'pencil', 'headset', 'lanyard']));
    for (const [lang, dict] of Object.entries(dicts)) {
      for (const tool of TOOLS) expect(dict[`tool.${tool}`], `${lang}: tool.${tool}`).toBeTruthy();
      for (const hat of HATS) expect(dict[`mascot.hat.${hat}`], `${lang}: mascot.hat.${hat}`).toMatch(/Kancil/);
    }
    for (const key of ['map.extraPack', 'map.extraPackWhy', 'rescue.familySoon', 'glossary.empty', 'levelup.startHere', 'levelup.certsText']) {
      expect(dicts.en[key] && dicts.ms[key], key).toBeTruthy();
    }
  });
});
