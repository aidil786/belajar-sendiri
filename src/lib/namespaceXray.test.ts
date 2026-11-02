import { describe, expect, it } from 'vitest';
import { ANSWER, DOCKER_DEFAULT, isContainer, panelOf, shownSwitches, startSet, SWITCHES, taskDone, view, type Switch } from './namespaceXray';

const set = (...s: Switch[]) => new Set<Switch>(s);

describe('namespace x-ray', () => {
  it('a plain process sees the whole laptop', () => {
    const v = view(set());
    expect(v.processes.length).toBeGreaterThan(3);
    expect(v.processes.find((p) => p.mine)?.pid).toBe(4242);
    expect(v.hostname).toBe('aina-laptop');
    expect(v.interfaces.map((i) => i.name)).toEqual(['lo', 'wlan0', 'docker0']);
    expect(v.files.some((f) => f.includes('.ssh'))).toBe(true);
    expect(v.uid).toEqual({ inside: 0, outside: 0 });
    expect(v.limits).toEqual({ memory: null, cpu: null, pids: null });
  });

  it('each switch changes only its own panel', () => {
    const base = view(set());
    expect(view(set('pid')).processes).toEqual([{ pid: 1, cmd: 'node server.js', mine: true }]);
    expect(view(set('pid')).procNote).toBe(true);
    expect(view(set('pid', 'mnt')).procNote).toBe(false);
    expect(view(set('uts')).hostname).toBe('3f9c2a7b1d04');
    expect(view(set('net')).interfaces.map((i) => `${i.name} ${i.addr}`)).toEqual(['lo 127.0.0.1', 'eth0 172.17.0.2']);
    expect(view(set('mnt')).files[0]).toBe('/app/server.js');
    expect(view(set('ipc')).ipc).toEqual([]);
    expect(view(set('user')).uid).toEqual({ inside: 0, outside: 100000 });
    expect(view(set('memory', 'cpu', 'pids')).limits).toEqual({ memory: '512 MB', cpu: '1.5', pids: 100 });
    expect(view(set('uts')).processes).toEqual(base.processes);
  });

  it('Docker’s default set makes a container (user namespaces are not default)', () => {
    expect(DOCKER_DEFAULT).not.toContain('user');
    expect(isContainer(set(...DOCKER_DEFAULT))).toBe(true);
    expect(isContainer(set('pid', 'mnt', 'net', 'uts'))).toBe(false);
  });

  it('tasks', () => {
    expect(taskDone({ type: 'all' }, set(...SWITCHES), 'pids')).toBe(true);
    expect(taskDone({ type: 'all' }, set(...DOCKER_DEFAULT), 'ipc')).toBe(false);
    expect(taskDone({ type: 'docker' }, set(...DOCKER_DEFAULT), 'ipc')).toBe(true);
    expect(taskDone({ type: 'find', what: 'hideProcesses' }, set('pid'), 'pid')).toBe(true);
    expect(taskDone({ type: 'find', what: 'hideProcesses' }, set('pid', 'uts'), 'uts')).toBe(false);
    expect(taskDone({ type: 'find', what: 'hideProcesses' }, set(), 'pid')).toBe(false); // switched it off again
    expect(taskDone({ type: 'turnOn', switches: ['memory', 'pids'] }, set('memory', 'pids'), 'pids')).toBe(true);
    expect(ANSWER.capProcesses).toBe('pids');
    expect(panelOf('cpu')).toBe('limits');
    expect([...startSet(['pid', 'bogus' as Switch])]).toEqual(['pid']);
  });

  it('a card may show only some switches', () => {
    expect(shownSwitches()).toEqual(SWITCHES);
    expect(shownSwitches(['memory', 'pid'])).toEqual(['pid', 'memory']);
    expect(taskDone({ type: 'all' }, set('memory', 'cpu', 'pids'), 'pids', shownSwitches(['memory', 'cpu', 'pids']))).toBe(true);
  });
});
