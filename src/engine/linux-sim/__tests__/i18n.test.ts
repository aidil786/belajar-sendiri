// Every friendly line the Linux engine can ask for exists in English and Malay.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '~/i18n/en.json';
import ms from '~/i18n/ms.json';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('linux i18n keys', () => {
  it('every explain / err key the engine uses exists in en and ms', () => {
    const keys = new Set<string>();
    for (const f of walk('src/engine/linux-sim').filter((x) => x.endsWith('.ts') && !x.includes('__tests__'))) {
      for (const m of readFileSync(f, 'utf8').matchAll(/'(linux\.(?:explain|err)\.[A-Za-z.]+)'/g)) keys.add(m[1]!);
    }
    // Keys built at run time.
    for (const k of ['head', 'tail', 'isActive', 'isEnabled', 'start', 'stop', 'restart', 'reload', 'enable', 'disable', 'enableNow', 'disableNow', 'status.active', 'status.inactive', 'status.failed']) keys.add(`linux.explain.${k}`);
    expect(keys.size).toBeGreaterThan(100);
    const enDict = en as Record<string, string>;
    const msDict = ms as Record<string, string>;
    expect([...keys].filter((k) => !(k in enDict))).toEqual([]);
    expect([...keys].filter((k) => !(k in msDict))).toEqual([]);
  });

  it('UI words for the picture exist', () => {
    const enDict = en as Record<string, string>;
    for (const k of ['linux.board', 'linux.here', 'linux.folder', 'linux.services', 'linux.svc.active', 'linux.svc.failed', 'linux.ctrlC', 'linux.ctrlZ', 'linux.danger', 'linux.network']) expect(enDict[k], k).toBeTruthy();
  });
});
