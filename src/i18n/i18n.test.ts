import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPLAIN_ONLY } from '../engine/git-sim/registry';
import en from './en.json';
import ms from './ms.json';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('i18n files', () => {
  it('en and ms have exactly the same keys', () => {
    const a = Object.keys(en).sort();
    const b = Object.keys(ms).sort();
    expect(a.filter((k) => !b.includes(k))).toEqual([]);
    expect(b.filter((k) => !a.includes(k))).toEqual([]);
  });

  it('placeholders match between languages', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    const enDict = en as Record<string, string>;
    const msDict = ms as Record<string, string>;
    const bad = Object.keys(enDict).filter((k) => ph(enDict[k]!) !== ph(msDict[k] ?? ''));
    expect(bad).toEqual([]);
  });

  it('every engine hint key exists', () => {
    const files = walk('src/engine').filter((f) => f.endsWith('.ts') && !f.includes('__tests__'));
    const keys = new Set<string>();
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(/'(sim\.(?:explain|err)\.[A-Za-z.]+)'/g)) keys.add(m[1]!);
    }
    for (const mode of ['working', 'staged', 'commits', 'commitWorking']) keys.add(`sim.explain.diff.${mode}`);
    for (const mode of ['Soft', 'Mixed', 'Hard']) keys.add(`sim.explain.reset${mode}`);
    // World 10 keys built at run time.
    for (const type of ['blob', 'tree', 'commit', 'tag']) keys.add(`sim.explain.catFileType.${type}`).add(`sim.explain.catFilePretty.${type}`);
    for (const kind of ['bad', 'good']) keys.add(`sim.explain.bisectMark.${kind}`);
    for (const name of EXPLAIN_ONLY) keys.add(`sim.explain.notInSim.${name}`);
    const missing = [...keys].filter((k) => !(k in en));
    expect(missing).toEqual([]);
  });
});
