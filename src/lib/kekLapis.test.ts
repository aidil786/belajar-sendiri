import { describe, expect, it } from 'vitest';
import sizes from './docker-sizes.json';
import { humanSize, parseSize } from './dockerUnits';
import { buildOutput, checkKek, copiesFile, copySources, layerKind, moveLine, normaliseLines, pickOption, rebuild } from './kekLapis';

const slow = normaliseLines([
  { id: 'from', text: 'FROM node:24-alpine', size: '181MB' },
  { id: 'workdir', text: 'WORKDIR /app', size: '8.19kB' },
  { id: 'copy-all', text: 'COPY . .', size: '36.9kB' },
  { id: 'copy-pkg', text: 'COPY package.json package-lock.json ./', size: '53.2kB' },
  { id: 'install', text: 'RUN npm ci --omit=dev', size: '12.8MB' },
  { id: 'cmd', text: 'CMD ["node", "server.js"]' },
]);
const ids = (ls: { id: string }[]) => ls.map((l) => l.id);

describe('docker units', () => {
  it('prints sizes like docker history', () => {
    expect(humanSize(0)).toBe('0B');
    expect(humanSize(8192)).toBe('8.19kB');
    expect(humanSize(53248)).toBe('53.2kB');
    expect(humanSize(12767232)).toBe('12.8MB');
    expect(humanSize(181100544)).toBe('181MB');
    expect(humanSize(1361469440)).toBe('1.36GB');
    expect(humanSize(999_600)).toBe('1MB');
    expect(humanSize(999)).toBe('999B');
  });
  it('reads sizes from props', () => {
    expect(parseSize('12.8MB')).toBe(12_800_000);
    expect(parseSize('37 kB')).toBe(37_000);
    expect(parseSize('1.36GB')).toBe(1_360_000_000);
    expect(parseSize(42)).toBe(42);
    expect(parseSize('big')).toBeNull();
    expect(parseSize(undefined)).toBeNull();
  });
});

describe('COPY sources', () => {
  it('finds what a COPY copies', () => {
    expect(copySources('COPY . .')).toEqual(['.']);
    expect(copySources('COPY package*.json ./')).toEqual(['package*.json']);
    expect(copySources('COPY --chown=node:node src/ ./src/')).toEqual(['src/']);
    expect(copySources('COPY ["a b.txt", "./"]')).toEqual(['a b.txt']);
    expect(copySources('COPY --from=build /app/dist ./dist')).toBeNull();
    expect(copySources('RUN npm ci')).toBeNull();
  });
  it('matches files, folders and globs', () => {
    expect(copiesFile('COPY . .', 'index.html')).toBe(true);
    expect(copiesFile('COPY ./ /app', 'src/a.js')).toBe(true);
    expect(copiesFile('COPY package*.json ./', 'package.json')).toBe(true);
    expect(copiesFile('COPY package*.json ./', 'package-lock.json')).toBe(true);
    expect(copiesFile('COPY package*.json ./', 'index.html')).toBe(false);
    expect(copiesFile('COPY src/ ./src/', 'src/server.js')).toBe(true);
    expect(copiesFile('COPY src ./src', 'srcfile.js')).toBe(false);
    expect(copiesFile('ADD site.tar.gz /srv', 'site.tar.gz')).toBe(true);
    expect(copiesFile('COPY --from=build /app/dist ./dist', 'index.html')).toBe(false);
  });
  it('knows settings lines', () => {
    expect(layerKind('FROM node:24')).toBe('base');
    expect(layerKind('ENV PORT=3000')).toBe('settings');
    expect(layerKind('cmd ["node"]')).toBe('settings');
    expect(layerKind('WORKDIR /app')).toBe('step');
  });
});

describe('rebuild', () => {
  it('copying everything early makes the install bake again', () => {
    const b = rebuild(slow, 'index.html');
    expect(b.firstMiss).toBe(2);
    expect(b.layers.map((l) => l.cached)).toEqual([true, true, false, false, false, false]);
    expect(b.layers[2]!.reason).toBe('copiesFile');
    expect(b.layers[4]!.reason).toBe('below');
    expect(b.steps).toBe(5);
    expect(b.cachedSteps).toBe(1);
    expect(b.rebakedBytes).toBe(36_900 + 53_200 + 12_800_000);
  });

  it('package files first, install, then the rest: only the last COPY bakes again', () => {
    let lines = slow;
    lines = moveLine(lines, 2, 1); // COPY . . below COPY package
    lines = moveLine(lines, 3, 1); // and below RUN npm ci
    expect(ids(lines)).toEqual(['from', 'workdir', 'copy-pkg', 'install', 'copy-all', 'cmd']);
    const b = rebuild(lines, { file: 'index.html' });
    expect(b.layers.filter((l) => !l.cached).map((l) => l.id)).toEqual(['copy-all', 'cmd']);
    expect(b.cachedSteps).toBe(3);
    expect(checkKek({ cached: ['install'], cachedAfterEdit: 3 }, lines, b)).toEqual({ ok: true });
    expect(buildOutput(b)).toEqual([
      ' => CACHED [2/5] WORKDIR /app',
      ' => CACHED [3/5] COPY package.json package-lock.json ./',
      ' => CACHED [4/5] RUN npm ci --omit=dev',
      ' => [5/5] COPY . .',
    ]);
  });

  it('changing package.json re-runs the install, even in the good order', () => {
    const good = normaliseLines([{ text: 'FROM node:24-alpine' }, { text: 'COPY package*.json ./' }, { text: 'RUN npm ci' }, { text: 'COPY . .' }]);
    const b = rebuild(good, 'package.json');
    expect(b.firstMiss).toBe(1);
    expect(b.cachedSteps).toBe(0);
  });

  it('a file nothing copies keeps every layer', () => {
    const b = rebuild(normaliseLines([{ text: 'FROM nginx:1.29-alpine' }, { text: 'COPY index.html /usr/share/nginx/html/' }]), 'notes.md');
    expect(b.firstMiss).toBe(-1);
    expect(b.cachedSteps).toBe(1);
  });

  it('editing a line re-bakes from that line up, and shows the new text', () => {
    const b = rebuild(slow, { line: 'workdir', text: 'WORKDIR /srv' });
    expect(b.firstMiss).toBe(1);
    expect(b.layers[1]!.reason).toBe('edited');
    expect(b.layers[1]!.text).toBe('WORKDIR /srv');
    expect(b.cachedSteps).toBe(0);
  });

  it('FROM stays first; settings lines default to 0B', () => {
    expect(moveLine(slow, 0, 1)).toBe(slow);
    expect(moveLine(slow, 1, -1)).toBe(slow);
    expect(slow[5]!.size).toBe(0);
    expect(slow[2]!.options).toEqual([{ text: 'COPY . .', size: 36_900 }]);
  });

  it('picking another version of a line swaps its text and size', () => {
    const lines = normaliseLines([
      { text: 'FROM node:24-alpine' },
      { id: 'first', text: 'COPY . .', size: '36.9kB', changes: [{ text: 'COPY package.json package-lock.json ./', size: '53.2kB' }, 'COPY . .'] },
      { id: 'install', text: 'RUN npm ci' },
      { id: 'rest', text: 'COPY . .' },
    ]);
    expect(lines[1]!.options.map((o) => o.text)).toEqual(['COPY . .', 'COPY package.json package-lock.json ./']);
    expect(rebuild(lines, 'index.html').layers[2]!.cached).toBe(false);
    const picked = pickOption(lines, 1, 'COPY package.json package-lock.json ./');
    expect(picked[1]).toMatchObject({ text: 'COPY package.json package-lock.json ./', size: 53_200 });
    expect(rebuild(picked, 'index.html').layers.map((l) => l.cached)).toEqual([true, true, true, false]);
    expect(pickOption(lines, 1, 'nope')).toEqual(lines);
  });
});

describe('goal check', () => {
  it('explains why a line baked again', () => {
    const b = rebuild(slow, 'index.html');
    expect(checkKek({ cached: ['install'] }, slow, b)).toEqual({ ok: false, reason: 'cached', id: 'install', because: 'copy-all', why: 'below' });
    expect(checkKek({ cachedAfterEdit: 3 }, slow, b)).toEqual({ ok: false, reason: 'count', got: 1, need: 3, miss: 'copy-all' });
    expect(checkKek({ order: ['from', 'workdir', 'copy-pkg'] }, slow, b)).toEqual({ ok: false, reason: 'order', index: 2, id: 'copy-all', want: 'copy-pkg' });
  });
});

describe('measured sizes', () => {
  it('the data file has the kek lapis layers and they print sensibly', () => {
    const good = sizes.kekLapis.good;
    expect(good.map((l) => l.line)).toEqual(['WORKDIR /app', 'COPY package.json package-lock.json ./', 'RUN npm ci --omit=dev', 'COPY . .', 'CMD ["node" "src/server.ts"]']);
    expect(good.map((l) => humanSize(l.size))).toEqual(['8.19kB', '53.2kB', '12.8MB', '36.9kB', '0B']);
    expect(humanSize(sizes.kekLapis.base.bytes)).toBe('181MB');
  });
});
