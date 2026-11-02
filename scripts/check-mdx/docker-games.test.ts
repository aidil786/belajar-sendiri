import { describe, expect, it } from 'vitest';
import { KEDAI_GOAL, KEDAI_PALETTE } from '../../src/lib/composeSamples';
import { checkDockerGame } from './docker-games';

const check = (name: string, a: Record<string, unknown>) => checkDockerGame(name, a, 'x.mdx:1');

const lines = [
  { id: 'from', text: 'FROM node:24-alpine', size: '181MB' },
  { id: 'all', text: 'COPY . .' },
  { id: 'pkg', text: 'COPY package*.json ./' },
  { id: 'install', text: 'RUN npm ci' },
];

describe('check:mdx Docker games', () => {
  it('KekLapisBuilder', () => {
    expect(check('KekLapisBuilder', { lines, edit: 'index.html', goal: { cached: ['install'] } })).toEqual([]);
    expect(check('KekLapisBuilder', { lines, edit: 'index.html' })).toEqual([]); // no goal: a demo
    expect(check('KekLapisBuilder', { lines: [lines[0], lines[2], lines[3], lines[1]], edit: 'index.html', goal: { cached: ['install'] } })).toEqual(['x.mdx:1: KekLapisBuilder goal is already met at the start']);
    expect(check('KekLapisBuilder', { lines, edit: 'package.json', goal: { cached: ['pkg'] } })).toEqual(['x.mdx:1: KekLapisBuilder goal cannot be reached by reordering or picking lines']);
    expect(check('KekLapisBuilder', { lines: [lines[1], lines[0]], edit: 'a' })).toContain('x.mdx:1: KekLapisBuilder line 1 must be a FROM line');
    expect(check('KekLapisBuilder', { lines, edit: { line: 'nope', text: 'x' } })).toContain('x.mdx:1: KekLapisBuilder edit line "nope" is not a line id');
    expect(check('KekLapisBuilder', { lines, edit: 'a', goal: { cached: ['ghost'] } })).toContain('x.mdx:1: KekLapisBuilder goal names line "ghost", which is not a line id');
    expect(check('KekLapisBuilder', { lines: [{ ...lines[0], size: 'huge' }, lines[1]], edit: 'a' })).toContain(`x.mdx:1: KekLapisBuilder line 1 has a size it can't read: "huge"`);
  });

  it('OrderHatch', () => {
    const containers = [{ name: 'web', ports: [80] }, { name: 'api', ports: [3000] }];
    expect(check('OrderHatch', { containers, task: { type: 'map', host: 8080, container: 'web', port: 80 } })).toEqual([]);
    expect(check('OrderHatch', { containers, task: { type: 'map', host: 8080, container: 'web', port: 81 } })).toEqual(["x.mdx:1: OrderHatch task wants web:81, which doesn't exist"]);
    expect(check('OrderHatch', { containers, start: [{ host: 8080, container: 'web', port: 80 }], task: { type: 'map', host: 8080, container: 'web', port: 80 } })).toEqual(['x.mdx:1: OrderHatch task is already done at the start']);
    expect(check('OrderHatch', { containers, hostPorts: [8080], start: [{ host: 8080, container: 'web', port: 80 }], task: { type: 'map', maps: [{ container: 'api', port: 3000 }] } })).toEqual(['x.mdx:1: OrderHatch every laptop port is taken at the start']);
    expect(check('OrderHatch', { containers, hostPorts: [9000], task: { type: 'map', host: 8080, container: 'web', port: 80 } })).toEqual(['x.mdx:1: OrderHatch task wants laptop port 8080, which is not in hostPorts']);
  });

  it('LockerTest', () => {
    expect(check('LockerTest', {})).toEqual([]);
    expect(check('LockerTest', { mounts: ['volume', { kind: 'bind', name: './x' }], ask: ['restart', 'recreate'] })).toEqual([]);
    expect(check('LockerTest', { mounts: ['fridge'], ask: 'explode' })).toEqual(['x.mdx:1: LockerTest unknown mount kind "fridge"', 'x.mdx:1: LockerTest unknown ask "explode" (use restart, recreate, volumeRm)']);
  });

  it('ComposeCanvas', () => {
    expect(check('ComposeCanvas', { palette: KEDAI_PALETTE, goal: KEDAI_GOAL, start: ['web'] })).toEqual([]);
    expect(check('ComposeCanvas', { palette: KEDAI_PALETTE, goal: { services: ['web', 'shop'] } })).toEqual(['x.mdx:1: ComposeCanvas goal names service "shop", which is not in the palette']);
    expect(check('ComposeCanvas', { palette: KEDAI_PALETTE, goal: { dependsOn: { db: { api: 'service_healthy' } } } })).toEqual(['x.mdx:1: ComposeCanvas goal waits for "api" to be healthy, but it has no healthcheck']);
    expect(check('ComposeCanvas', { palette: KEDAI_PALETTE, goal: { volumes: { web: 'x' } } })).toEqual(['x.mdx:1: ComposeCanvas goal gives "web" a volume, but it has no volumeTarget']);
    expect(check('ComposeCanvas', { palette: KEDAI_PALETTE, goal: { services: ['web'] }, start: ['web'] })).toEqual(['x.mdx:1: ComposeCanvas goal is already met at the start']);
    expect(check('ComposeCanvas', { palette: [{ id: 'Web App' }] })).toEqual(['x.mdx:1: ComposeCanvas service id "Web App" is not a valid Compose service name', 'x.mdx:1: ComposeCanvas service "Web App" needs an image or a build folder']);
  });

  it('ShrinkRay', () => {
    expect(check('ShrinkRay', { target: 200 })).toEqual([]);
    expect(check('ShrinkRay', { target: 100 })).toEqual(['x.mdx:1: ShrinkRay target 100 MB cannot be reached with these options']);
    expect(check('ShrinkRay', { target: 200, options: ['base:slim', 'ignore'] })).toEqual(['x.mdx:1: ShrinkRay target 200 MB cannot be reached with these options']);
    expect(check('ShrinkRay', { target: 2000 })).toEqual(['x.mdx:1: ShrinkRay start is already under the target']);
    expect(check('ShrinkRay', { app: 'static-site', target: 80 })).toEqual([]);
    expect(check('ShrinkRay', { app: 'static-site', target: 80, options: ['stage'] })).toContain('x.mdx:1: ShrinkRay unknown option "stage" for static-site (use base:nginx, base:nginx-alpine, ignore)');
    expect(check('ShrinkRay', { target: 200, start: { base: 'distroless' } })).toEqual(['x.mdx:1: ShrinkRay start is a recipe that cannot be built']);
  });

  it('NamespaceXray', () => {
    expect(check('NamespaceXray', {})).toEqual([]);
    expect(check('NamespaceXray', { task: { type: 'find', what: 'hideProcesses' } })).toEqual([]);
    expect(check('NamespaceXray', { task: { type: 'find', what: 'hideProcesses' }, start: ['pid'] })).toEqual(['x.mdx:1: NamespaceXray the answer switch is already on at the start']);
    expect(check('NamespaceXray', { task: { type: 'docker' }, start: ['pid', 'mnt', 'net', 'uts', 'ipc'] })).toEqual(['x.mdx:1: NamespaceXray task is already done at the start']);
    expect(check('NamespaceXray', { task: { type: 'find', what: 'fly' } })[0]).toMatch(/unknown question "fly"/);
    expect(check('NamespaceXray', { start: ['wings'] })).toEqual(['x.mdx:1: NamespaceXray unknown switch "wings"']);
    expect(check('NamespaceXray', { switches: ['memory', 'cpu', 'pids'] })).toEqual([]);
    expect(check('NamespaceXray', { switches: ['uts'], task: { type: 'find', what: 'hideProcesses' } })).toEqual(['x.mdx:1: NamespaceXray task needs switches that are not shown: pid']);
    expect(check('NamespaceXray', { switches: ['pid', 'mnt'], task: { type: 'docker' } })).toEqual(['x.mdx:1: NamespaceXray task needs switches that are not shown: net, uts, ipc']);
  });
});
