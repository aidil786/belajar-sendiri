import { describe, expect, it } from 'vitest';
import { humanSize, MB } from './dockerUnits';
import { applyMove, dockerfile, dockerignore, isOn, movesFor, reachable, sizeOf, startRecipe, type Recipe } from './shrinkRay';

const start = startRecipe('node-api');
const go = (r: Recipe, ...moves: Parameters<typeof applyMove>[2][]) =>
  moves.reduce((acc, m) => {
    const res = applyMove('node-api', acc, m);
    if (!res.ok) throw new Error(`${m}: ${res.reason}`);
    return res.recipe;
  }, r);

describe('shrink ray (measured sizes)', () => {
  it('starts big: node:24, one stage, no .dockerignore, dev tools in', () => {
    expect(start).toEqual({ base: 'node', stage: false, ignore: false, prodOnly: false });
    expect(humanSize(sizeOf('node-api', start)!)).toBe('1.36GB');
    expect(dockerfile('node-api', start)[0]).toBe('FROM node:24');
  });

  it('each honest move shrinks it', () => {
    const steps = [
      go(start, 'ignore'),
      go(start, 'ignore', 'base:slim'),
      go(start, 'ignore', 'base:alpine'),
      go(start, 'ignore', 'base:alpine', 'stage'),
      go(start, 'ignore', 'base:alpine', 'stage', 'prodOnly'),
      go(start, 'ignore', 'stage', 'prodOnly', 'base:distroless'),
    ].map((r) => sizeOf('node-api', r)!);
    expect(steps.map(humanSize)).toEqual(['1.3GB', '328MB', '260MB', '243MB', '190MB', '168MB']);
    for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeLessThan(steps[i - 1]!);
  });

  it('refuses moves that would not build, kindly', () => {
    expect(applyMove('node-api', start, 'base:distroless')).toEqual({ ok: false, reason: 'needsStage', move: 'base:distroless' });
    expect(applyMove('node-api', start, 'prodOnly')).toEqual({ ok: false, reason: 'needsStage', move: 'prodOnly' });
    const d = go(start, 'stage', 'base:distroless');
    expect(applyMove('node-api', d, 'stage')).toEqual({ ok: false, reason: 'stageNeeded', by: 'base:distroless' });
    const p = go(start, 'stage', 'prodOnly');
    expect(applyMove('node-api', p, 'stage')).toEqual({ ok: false, reason: 'stageNeeded', by: 'prodOnly' });
    expect(applyMove('node-api', start, 'base:nginx')).toMatchObject({ ok: false, reason: 'unknown' });
  });

  it('.dockerignore does not change a multi-stage final image', () => {
    const a = go(start, 'stage');
    const b = go(start, 'stage', 'ignore');
    expect(sizeOf('node-api', a)).toBe(sizeOf('node-api', b));
    expect(isOn(b, 'ignore')).toBe(true);
    expect(isOn(b, 'base:node')).toBe(true);
  });

  it('writes the Dockerfile it measured, 15 lines or fewer', () => {
    const r = go(start, 'stage', 'prodOnly', 'base:distroless');
    const lines = dockerfile('node-api', r);
    expect(lines.length).toBeLessThanOrEqual(15);
    expect(lines[0]).toBe('FROM node:24-slim AS build');
    expect(lines).toContain('RUN npm prune --omit=dev');
    expect(lines).toContain('FROM gcr.io/distroless/nodejs24-debian13');
    expect(lines.at(-1)).toBe('CMD ["dist/server.js"]');
    expect(dockerignore('node-api', r)).toEqual([]);
    expect(dockerignore('node-api', go(start, 'ignore'))).toEqual(['node_modules']);
  });

  it('static site: nginx to nginx alpine', () => {
    const s = startRecipe('static-site');
    expect(humanSize(sizeOf('static-site', s)!)).toBe('186MB');
    const r = applyMove('static-site', s, 'base:nginx-alpine');
    expect(r.ok && humanSize(sizeOf('static-site', r.recipe)!)).toBe('78MB');
    expect(applyMove('static-site', s, 'stage')).toMatchObject({ ok: false });
    expect(dockerfile('static-site', s)).toEqual(['FROM nginx:1.29', 'COPY . /usr/share/nginx/html']);
  });

  it('knows which targets can be reached', () => {
    expect(reachable('node-api', start, movesFor('node-api'), 200 * MB)).toBe(true);
    expect(reachable('node-api', start, movesFor('node-api', ['base:slim', 'ignore']), 200 * MB)).toBe(false);
    expect(reachable('node-api', start, movesFor('node-api'), 100 * MB)).toBe(false);
    expect(movesFor('node-api', ['base:alpine', 'base:nginx' as never])).toEqual(['base:alpine']);
    expect(startRecipe('node-api', { base: 'distroless' })).toEqual(start); // can't build: falls back
  });
});
