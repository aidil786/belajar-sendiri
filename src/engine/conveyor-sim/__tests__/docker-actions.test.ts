// C2 additions to the docker/* actions: metadata-action's `latest` flavor and pre-releases,
// multi-platform builds that need QEMU, and tests run inside a container.
import { describe, expect, it } from 'vitest';
import { simulate } from '../simulate';
import { presetTrigger } from '../events';
import type { EventPreset, World } from '../types';

const meta = (tags: string, extra = '') => `name: Tags
on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:
jobs:
  tags:
    runs-on: ubuntu-latest
    steps:
      - id: meta
        uses: docker/metadata-action@v6
        with:
          images: ghcr.io/you/shop
${extra}          tags: |
${tags
  .split('\n')
  .map((l) => `            ${l}`)
  .join('\n')}
`;

function tagsFor(yaml: string, preset: EventPreset, tag?: string): string[] {
  const r = simulate(yaml, { trigger: presetTrigger(preset, tag ? { tag } : {}), world: {} });
  expect(r.status).toBe('success');
  return r.jobs[0]!.steps[0]!.outputs.tags!.split('\n').map((t) => t.replace('ghcr.io/you/shop:', ''));
}

describe('docker/metadata-action tags', () => {
  const rules = 'type=ref,event=branch\ntype=ref,event=pr\ntype=semver,pattern={{version}}\ntype=sha';

  it('push to main: branch name and short sha (no latest)', () => {
    expect(tagsFor(meta(rules), 'push-main')).toEqual(['main', 'sha-3f9c2a7']);
  });

  it('pull request: pr-N and sha', () => {
    expect(tagsFor(meta(rules), 'pr')).toEqual(['pr-7', 'sha-3f9c2a7']);
  });

  it('a version tag: the version, sha, and latest (flavor latest=auto)', () => {
    expect(tagsFor(meta(rules), 'tag', 'v1.2.0')).toEqual(['1.2.0', 'sha-3f9c2a7', 'latest']);
  });

  it('a pre-release keeps its suffix, skips {{major}}.{{minor}} and gets no latest', () => {
    const r = `${rules}\ntype=semver,pattern={{major}}.{{minor}}`;
    expect(tagsFor(meta(r), 'tag', 'v1.3.0-rc.1')).toEqual(['1.3.0-rc.1', 'sha-3f9c2a7']);
    expect(tagsFor(meta(r), 'tag', 'v1.3.0')).toEqual(['1.3.0', 'sha-3f9c2a7', '1.3', 'latest']);
  });

  it('flavor latest=false never adds latest; latest=true always does', () => {
    expect(tagsFor(meta(rules, '          flavor: latest=false\n'), 'tag', 'v1.2.0')).toEqual(['1.2.0', 'sha-3f9c2a7']);
    expect(tagsFor(meta(rules, '          flavor: latest=true\n'), 'push-main')).toEqual(['main', 'sha-3f9c2a7', 'latest']);
  });
});

const build = (platforms: string, before = '', runsOn = 'ubuntu-latest') => `name: Image
on: push
jobs:
  image:
    runs-on: ${runsOn}
    steps:
${before}      - uses: docker/setup-buildx-action@v4
      - uses: docker/build-push-action@v7
        with:
          tags: shop:ci
          platforms: ${platforms}
`;

const run = (yaml: string, world: World = {}) => simulate(yaml, { trigger: presetTrigger('push-main'), world });

describe('multi-platform builds', () => {
  it('arm64 on an x64 runner without QEMU: exec format error (exit code 255)', () => {
    const r = run(build('linux/amd64,linux/arm64'));
    expect(r.status).toBe('failure');
    const step = r.jobs[0]!.steps[1]!;
    expect(step.why).toEqual({ key: 'conveyor.why.noQemu', params: { platform: 'linux/arm64' } });
    expect(step.log.map((l) => l.text)).toContain('#7 0.274 exec /bin/sh: exec format error');
  });

  it('QEMU first makes both platforms build; the export is a manifest list', () => {
    const r = run(build('linux/amd64,linux/arm64', '      - uses: docker/setup-qemu-action@v4\n'));
    expect(r.status).toBe('success');
    expect(r.jobs[0]!.steps[2]!.log.map((l) => l.text)).toContain('#9 exporting manifest list for linux/amd64, linux/arm64');
  });

  it('the native platform needs no QEMU (amd64 on x64, arm64 on an arm runner)', () => {
    expect(run(build('linux/amd64')).status).toBe('success');
    expect(run(build('linux/arm64', '', 'ubuntu-24.04-arm')).status).toBe('success');
    expect(run(build('linux/amd64', '', 'ubuntu-24.04-arm')).status).toBe('failure');
  });
});

describe('tests inside a container', () => {
  const wf = (cmd: string, services = '') => `name: Test
on: push
jobs:
  test:
    runs-on: ubuntu-latest
${services}    steps:
      - run: ${cmd}
`;

  it('docker run … npm test runs the tests (no npm ci on the runner needed)', () => {
    expect(run(wf('docker run --rm shop:test npm test')).status).toBe('success');
    const r = run(wf('docker run --rm shop:test npm test'), { fail: { tests: ['tests/a.test.js > a'] } });
    expect(r.status).toBe('failure');
    expect(r.jobs[0]!.steps[0]!.why?.key).toBe('conveyor.why.testsFailed');
  });

  it('docker compose run brings the database; a plain docker run needs a service', () => {
    expect(run(wf('docker compose run --rm api npm test'), { fail: { db: true } }).status).toBe('success');
    expect(run(wf('docker run --rm shop:test npm test'), { fail: { db: true } }).status).toBe('failure');
  });

  it('other docker commands still just pass', () => {
    expect(run(wf('docker compose up -d --wait')).status).toBe('success');
  });
});
