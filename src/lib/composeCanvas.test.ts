import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { changedLines, checkCompose, composeYaml, emptyService, findCycle, indentLevels, offered, scalar, startOrder, type CanvasService } from './composeCanvas';
import { KEDAI_DONE, KEDAI_GOAL, KEDAI_PALETTE } from './composeSamples';

type Doc = {
  services: Record<string, { image?: string; build?: string; ports?: string[]; environment?: Record<string, string>; volumes?: string[]; networks?: string[]; depends_on?: Record<string, { condition: string }>; healthcheck?: { test: string[]; interval: string; retries: number } }>;
  networks?: Record<string, unknown>;
  volumes?: Record<string, unknown>;
};

describe('compose.yaml writes itself', () => {
  it('an empty canvas is still valid YAML', () => {
    expect(parse(composeYaml(KEDAI_PALETTE, []))).toEqual({ services: {} });
  });

  it('the finished stack parses to the Compose structure', () => {
    const yaml = composeYaml(KEDAI_PALETTE, KEDAI_DONE);
    const doc = parse(yaml) as Doc;
    expect(Object.keys(doc.services)).toEqual(['web', 'api', 'db', 'cache']);
    expect(doc.services.web).toEqual({ image: 'nginx:1.29-alpine', ports: ['8080:80'], networks: ['front'], depends_on: { api: { condition: 'service_started' } } });
    expect(doc.services.api!.build).toBe('./api');
    expect(doc.services.api!.environment).toEqual({ DATABASE_URL: 'postgres://kedai:example@db:5432/kedai' });
    expect(doc.services.api!.depends_on).toEqual({ db: { condition: 'service_healthy' }, cache: { condition: 'service_healthy' } });
    expect(doc.services.db!.volumes).toEqual(['db-data:/var/lib/postgresql']);
    expect(doc.services.db!.healthcheck).toEqual({ test: ['CMD-SHELL', 'pg_isready -U kedai -d kedai'], interval: '5s', timeout: '3s', retries: 5 });
    expect(doc.networks).toEqual({ front: {}, back: {} });
    expect(doc.volumes).toEqual({ 'db-data': {}, 'cache-data': {} });
    // Ports stay strings ("8080:80"), never a number.
    expect(yaml).toContain('      - "8080:80"');
  });

  it('quotes values YAML would misread', () => {
    expect(scalar('5432')).toBe('"5432"');
    expect(scalar('yes')).toBe('"yes"');
    expect(scalar('a: b')).toBe('"a: b"');
    expect(scalar('x #y')).toBe('"x #y"');
    expect(scalar('postgres://a:b@db:5432/x')).toBe('postgres://a:b@db:5432/x');
    expect(scalar(true)).toBe('true');
    const odd = composeYaml([{ id: 'x', image: 'alpine:3.22', environment: { A: '0012', B: 'on', C: '- dash', D: 'it: works', E: '' } }], [emptyService('x')]);
    expect((parse(odd) as Doc).services.x!.environment).toEqual({ A: '0012', B: 'on', C: '- dash', D: 'it: works', E: '' });
  });

  it('only writes depends_on for services on the canvas', () => {
    const canvas: CanvasService[] = [{ ...emptyService('api'), dependsOn: { db: 'service_healthy' } }];
    expect((parse(composeYaml(KEDAI_PALETTE, canvas)) as Doc).services.api!.depends_on).toBeUndefined();
  });

  it('indent guides and changed lines', () => {
    expect(indentLevels('services:\n  web:\n    image: x\n')).toEqual([0, 1, 2]);
    expect(changedLines('a\nb\n', 'a\nb\nc\n')).toEqual([2]);
    expect(changedLines('a\n', 'b\na\n')).toEqual([0]);
  });
});

describe('goal check', () => {
  it('the finished stack meets the goal', () => {
    expect(checkCompose(KEDAI_GOAL, KEDAI_DONE, KEDAI_PALETTE)).toEqual({ ok: true });
    expect(checkCompose({ ...KEDAI_GOAL, only: true }, KEDAI_DONE, KEDAI_PALETTE)).toEqual({ ok: false, reason: 'extra', service: 'cache' });
  });

  it('reports the first problem', () => {
    expect(checkCompose(KEDAI_GOAL, [emptyService('web')], KEDAI_PALETTE)).toEqual({ ok: false, reason: 'missing', service: 'api' });
    const three = ['web', 'api', 'db'].map(emptyService);
    expect(checkCompose(KEDAI_GOAL, three, KEDAI_PALETTE)).toEqual({ ok: false, reason: 'volume', service: 'db', volume: 'db-data' });
    three[2]!.volume = 'db-data';
    expect(checkCompose(KEDAI_GOAL, three, KEDAI_PALETTE)).toEqual({ ok: false, reason: 'network', service: 'web', network: 'front' });
    three[0]!.networks = ['front'];
    three[1]!.networks = ['front', 'back'];
    three[2]!.networks = ['back'];
    expect(checkCompose(KEDAI_GOAL, three, KEDAI_PALETTE)).toEqual({ ok: false, reason: 'dependsOn', service: 'api', on: 'db', condition: 'service_healthy', got: null });
    three[1]!.dependsOn = { db: 'service_started' };
    expect(checkCompose(KEDAI_GOAL, three, KEDAI_PALETTE)).toMatchObject({ reason: 'dependsOn', got: 'service_started' });
    three[1]!.dependsOn = { db: 'service_healthy' };
    expect(checkCompose(KEDAI_GOAL, three, KEDAI_PALETTE)).toEqual({ ok: true });
  });

  it('healthy needs a healthcheck; loops are refused', () => {
    const c: CanvasService[] = [{ ...emptyService('web'), dependsOn: { api: 'service_healthy' } }, emptyService('api')];
    expect(checkCompose({}, c, KEDAI_PALETTE)).toEqual({ ok: false, reason: 'noHealthcheck', service: 'web', on: 'api' });
    const loop: CanvasService[] = [{ ...emptyService('web'), dependsOn: { api: 'service_started' } }, { ...emptyService('api'), dependsOn: { web: 'service_started' } }];
    expect(findCycle(loop)).toEqual(['web', 'api', 'web']);
    expect(checkCompose({}, loop, KEDAI_PALETTE)).toMatchObject({ reason: 'cycle' });
  });

  it('start order puts dependencies first', () => {
    expect(startOrder(KEDAI_DONE)).toEqual(['db', 'cache', 'api', 'web']);
  });

  it('offers the networks and volumes the goal uses', () => {
    expect(offered(KEDAI_GOAL)).toEqual({ networks: ['front', 'back'], volumes: ['db-data'] });
    expect(offered(KEDAI_GOAL, ['x'], [])).toEqual({ networks: ['x'], volumes: [] });
  });
});
