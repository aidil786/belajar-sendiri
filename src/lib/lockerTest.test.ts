import { describe, expect, it } from 'vitest';
import { actionCommands, filePath, normaliseAsk, runLine, score, stores, survives } from './lockerTest';

describe('locker test', () => {
  it('matches what Docker 29 keeps (checked on a real daemon)', () => {
    // restart: writable layer stays, tmpfs empties
    expect(['writable', 'volume', 'bind', 'tmpfs'].map((k) => survives(k as never, 'restart'))).toEqual([true, true, true, false]);
    // rm + run: only volumes and bind mounts stay
    expect(['writable', 'volume', 'bind', 'tmpfs'].map((k) => survives(k as never, 'recreate'))).toEqual([false, true, true, false]);
    // volume rm: only the laptop folder stays
    expect(['writable', 'volume', 'bind', 'tmpfs'].map((k) => survives(k as never, 'volumeRm'))).toEqual([false, false, true, false]);
  });

  it('fills in sensible defaults', () => {
    const all = stores();
    expect(all.map((s) => s.kind)).toEqual(['writable', 'volume', 'bind', 'tmpfs']);
    expect(filePath(all[1]!)).toBe('/data/orders.db');
    const two = stores(['volume', { kind: 'bind', name: './photos', target: '/srv/photos', file: 'cat.jpg' }]);
    expect(two[1]).toEqual({ kind: 'bind', name: './photos', target: '/srv/photos', file: 'cat.jpg' });
  });

  it('writes the real commands', () => {
    const all = stores();
    expect(runLine(all, 'kedai', 'nginx:1.29-alpine')).toBe('docker run -d --name kedai -v kedai-data:/data -v ./menu:/menu --tmpfs /tmp/cache nginx:1.29-alpine');
    expect(actionCommands('restart', all)).toEqual(['docker restart kedai']);
    expect(actionCommands('recreate', all)).toEqual(['docker rm -f kedai', runLine(all, 'kedai', 'nginx:1.29-alpine')]);
    expect(actionCommands('volumeRm', all)[1]).toBe('docker volume rm kedai-data');
    expect(actionCommands('volumeRm', stores(['writable']))).toEqual(['docker rm -f kedai', 'docker run -d --name kedai nginx:1.29-alpine']);
  });

  it('scores a prediction', () => {
    const all = stores();
    expect(score(all, 'recreate', [false, true, true, false])).toEqual({ right: 4, total: 4, wrong: [] });
    expect(score(all, 'restart', [true, true, true, true])).toEqual({ right: 3, total: 4, wrong: [3] });
    expect(score(all, 'restart', [null, true, true, false]).wrong).toEqual([0]);
  });

  it('asks about recreate by default and drops unknown actions', () => {
    expect(normaliseAsk()).toEqual(['recreate']);
    expect(normaliseAsk('restart')).toEqual(['restart']);
    expect(normaliseAsk(['restart', 'explode' as never, 'volumeRm'])).toEqual(['restart', 'volumeRm']);
  });
});
