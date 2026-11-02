import { describe, expect, it } from 'vitest';
import { allocatedError, checkHatch, hostPortList, plug, requestPort, route, runCommand, unplug, wanted, type Cable } from './orderHatch';

const web = { name: 'web', ports: [80] };
const api = { name: 'api', ports: [3000], image: 'node:24-alpine' };

describe('order hatch', () => {
  it('plugs a cable and writes the -p flag (laptop:container)', () => {
    const r = plug([], { host: 8080, container: 'web', port: 80 });
    expect(r.ok).toBe(true);
    const cables = r.ok ? r.cables : [];
    expect(runCommand(web, cables)).toBe('docker run -d --name web -p 8080:80 nginx:1.29-alpine');
    expect(runCommand(api, cables)).toBe('docker run -d --name api node:24-alpine');
    expect(checkHatch({ type: 'map', host: 8080, container: 'web', port: 80 }, cables)).toEqual({ ok: true });
  });

  it('a second cable on one laptop port sparks, with Docker’s words', () => {
    const cables: Cable[] = [{ host: 8080, container: 'web', port: 80 }];
    expect(plug(cables, { host: 8080, container: 'api', port: 3000 })).toEqual({ ok: false, reason: 'allocated', by: cables[0] });
    expect(plug(cables, { host: 8080, container: 'web', port: 80 })).toEqual({ ok: false, reason: 'same' });
    expect(allocatedError(8080)).toBe('Bind for 0.0.0.0:8080 failed: port is already allocated');
  });

  it('two laptop ports may lead to one container port', () => {
    let cables: Cable[] = [{ host: 8080, container: 'web', port: 80 }];
    const r = plug(cables, { host: 8081, container: 'web', port: 80 });
    expect(r.ok).toBe(true);
    if (r.ok) cables = r.cables;
    expect(runCommand(web, cables)).toBe('docker run -d --name web -p 8080:80 -p 8081:80 nginx:1.29-alpine');
    expect(unplug(cables, 8080)).toEqual([{ host: 8081, container: 'web', port: 80 }]);
  });

  it('fix a conflict: any free laptop port is fine when the task leaves host out', () => {
    const task = { type: 'map' as const, maps: [{ container: 'api', port: 3000 }] };
    const start: Cable[] = [{ host: 8080, container: 'web', port: 80 }];
    expect(checkHatch(task, start)).toEqual({ ok: false, missing: { container: 'api', port: 3000 }, wrong: null });
    const r = plug(start, { host: 8081, container: 'api', port: 3000 });
    expect(r.ok && checkHatch(task, r.cables)).toEqual({ ok: true });
    expect(r.ok && requestPort(task, r.cables)).toBe(8081);
  });

  it('names a cable on the right laptop port that goes to the wrong place', () => {
    const cables: Cable[] = [{ host: 8080, container: 'api', port: 3000 }];
    expect(checkHatch({ type: 'map', host: 8080, container: 'web', port: 80 }, cables)).toEqual({
      ok: false,
      missing: { host: 8080, container: 'web', port: 80 },
      wrong: cables[0],
    });
  });

  it('offers laptop ports and routes requests', () => {
    expect(hostPortList({ type: 'map', host: 5000, container: 'web', port: 80 }, [])).toEqual([3000, 5000, 8080]);
    expect(hostPortList({ type: 'map', host: 5000, container: 'web', port: 80 }, [], [8080, 8080, 9000])).toEqual([8080, 9000]);
    expect(wanted({ type: 'map', container: 'web', port: 80 })).toEqual([{ container: 'web', port: 80 }]);
    expect(route([{ host: 8080, container: 'web', port: 80 }], 8080)?.container).toBe('web');
    expect(route([], 8080)).toBeNull();
  });
});
