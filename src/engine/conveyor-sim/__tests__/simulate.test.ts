// The fake runner: jobs, needs, matrix, cache, artifacts, permissions, secrets,
// environments, concurrency, timeouts, and the events for animations.
import { describe, expect, it } from 'vitest';
import { expandMatrix, presetTrigger, simulate, tokenPermissions, parseWorkflow, type RunResult, type Trigger, type World } from '../index';

const run = (yaml: string, t: Trigger | Parameters<typeof presetTrigger>[0] = 'push-main', world: World = {}, decisions = {}) =>
  simulate(yaml, { trigger: typeof t === 'string' ? presetTrigger(t) : t, world, decisions });
const job = (r: RunResult, key: string) => r.jobs.find((j) => j.key === key)!;
const steps = (r: RunResult, key: string) => job(r, key).steps.map((s) => s.result);
const types = (r: RunResult) => r.events.map((e) => e.type);
const log = (r: RunResult, key: string, i: number) => job(r, key).steps[i]!.log.map((l) => l.text).join('\n');

const ci = (extra = '') => `name: CI
on:
  push:
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm test
${extra}`;

describe('a simple run', () => {
  it('passes, in order, with times on the fake clock', () => {
    const r = run(ci());
    expect(r.status).toBe('success');
    expect(steps(r, 'test')).toEqual(['success', 'success', 'success', 'success']);
    expect(types(r)[0]).toBe('runQueued');
    expect(types(r).at(-1)).toBe('runFinished');
    const times = r.events.map((e) => e.t);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(r.duration).toBeGreaterThan(30);
  });

  it('the npm cache misses, is saved, then hits on the next run', () => {
    const first = run(ci());
    expect(types(first)).toContain('cacheMiss');
    expect(first.cachesSaved).toEqual(['node-cache-Linux-x64-npm-a1b2c3d4e5f6']);
    const second = run(ci(), 'push-main', { cache: { warm: true } });
    expect(types(second)).toContain('cacheHit');
    expect(second.duration).toBeLessThan(first.duration);
    // A new lockfile means a new key: miss again.
    expect(types(run(ci(), 'push-main', { cache: { warm: true, lockfileChanged: true } }))).toContain('cacheMiss');
  });

  it('a failing test stops the line; later steps are skipped', () => {
    const r = run(ci('      - run: npm run build\n'), 'push-main', { fail: { tests: ['tests/a.test.js > adds'] } });
    expect(r.status).toBe('failure');
    expect(steps(r, 'test')).toEqual(['success', 'success', 'success', 'failure', 'skipped']);
    expect(job(r, 'test').why).toEqual({ key: 'conveyor.why.testsFailed', params: { count: 1, first: 'tests/a.test.js > adds' } });
    expect(log(r, 'test', 3)).toContain('Error: Process completed with exit code 1.');
  });

  it('forgetting checkout or npm ci gives the real errors', () => {
    const noCheckout = run(ci().replace('      - uses: actions/checkout@v7\n', ''));
    expect(noCheckout.jobs[0]!.why!.key).toBe('conveyor.why.noLockForCache');
    const noCi = run(ci().replace('      - run: npm ci\n', ''));
    expect(noCi.jobs[0]!.why!.key).toBe('conveyor.why.notInstalled');
    expect(log(noCi, 'test', 2)).toContain('not found');
  });
});

describe('triggers', () => {
  it('a workflow that does not match the event does not run', () => {
    const r = run(ci().replace('  push:\n  pull_request:\n', '  pull_request:\n'), 'push-main');
    expect(r).toMatchObject({ status: 'notTriggered', triggered: false, why: { key: 'conveyor.why.noEvent' } });
    expect(r.events).toEqual([]);
  });
  it('an invalid file does not run', () => {
    expect(run('on: push\njobs: {}\n').status).toBe('invalid');
  });
});

describe('jobs: needs, if, matrix', () => {
  const pipeline = `on: push
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npm run lint
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [20, 22, 24]
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npm test
  deploy:
    needs: [lint, test]
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - run: echo deploy
  report:
    needs: test
    if: failure()
    runs-on: ubuntu-latest
    steps:
      - run: echo report
`;

  it('the matrix splits into legs; needs wait for every leg', () => {
    const r = run(pipeline);
    expect(r.status).toBe('success');
    expect(r.jobs.map((j) => j.key)).toEqual(['lint', 'test (20)', 'test (22)', 'test (24)', 'deploy', 'report']);
    expect(r.events.find((e) => e.type === 'matrixSplit')).toMatchObject({ job: 'test', legs: ['test (20)', 'test (22)', 'test (24)'] });
    const lastLeg = Math.max(...r.jobs.filter((j) => j.id === 'test').map((j) => j.end));
    expect(job(r, 'deploy').start).toBeGreaterThanOrEqual(lastLeg);
    expect(job(r, 'report')).toMatchObject({ result: 'skipped', why: { key: 'conveyor.why.ifFalse' } });
  });

  it('if: false skips a job; a skipped need skips the jobs after it', () => {
    const r = run(pipeline.replace('needs: test\n    if: failure()', 'needs: deploy'), 'push-branch');
    expect(job(r, 'deploy')).toMatchObject({ result: 'skipped', why: { key: 'conveyor.why.ifFalse' } });
    expect(job(r, 'report')).toMatchObject({ result: 'skipped', why: { key: 'conveyor.why.needSkipped' } });
  });

  it('fail-fast cancels the legs still running; failure() jobs run', () => {
    const r = run(pipeline, 'push-main', { fail: { tests: ['x'], onlyIn: { node: '20' } } });
    expect(r.status).toBe('failure');
    expect(job(r, 'test (20)').result).toBe('failure');
    expect(job(r, 'test (22)')).toMatchObject({ result: 'cancelled', why: { key: 'conveyor.why.failFast' } });
    expect(job(r, 'deploy')).toMatchObject({ result: 'skipped', why: { key: 'conveyor.why.needFailed' } });
    expect(job(r, 'report').result).toBe('success');
    const noFF = run(pipeline.replace('    strategy:\n', '    strategy:\n      fail-fast: false\n'), 'push-main', { fail: { tests: ['x'], onlyIn: { node: '20' } } });
    expect(job(noFF, 'test (22)').result).toBe('success');
  });

  it('include and exclude', () => {
    const m = parseWorkflow(`on: push
jobs:
  t:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest]
        node: [22, 24]
        exclude:
          - os: windows-latest
            node: 22
        include:
          - os: ubuntu-latest
            experimental: true
          - os: macos-latest
            node: 24
    steps:
      - run: echo hi
`).workflow!.jobs[0]!.matrix!;
    expect(expandMatrix(m)).toEqual([
      { os: 'ubuntu-latest', node: 22, experimental: true },
      { os: 'ubuntu-latest', node: 24, experimental: true },
      { os: 'windows-latest', node: 24 },
      { os: 'macos-latest', node: 24 },
    ]);
  });

  it('continue-on-error keeps the job going', () => {
    const r = run(ci().replace('      - run: npm test', '      - run: npm test\n        continue-on-error: true\n      - run: echo after'), 'push-main', { fail: { tests: ['x'] } });
    expect(r.status).toBe('success');
    expect(job(r, 'test').steps[3]).toMatchObject({ result: 'success', outcome: 'failure' });
    expect(r.events.find((e) => e.type === 'stepFailed')).toMatchObject({ continued: true });
  });
});

describe('artifacts', () => {
  const yaml = `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-artifact@v7
        with:
          name: dist
          path: dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v8
        with:
          name: dist
`;
  it('pass from one job to the next', () => {
    const r = run(yaml);
    expect(r.status).toBe('success');
    expect(r.artifacts).toEqual(['dist']);
    expect(types(r)).toContain('artifactUploaded');
    expect(types(r)).toContain('artifactDownloaded');
  });
  it('a missing artifact or a duplicate name fails', () => {
    const r = run(yaml.replace('    needs: build\n', ''));
    expect(job(r, 'deploy').why).toEqual({ key: 'conveyor.why.artifactMissing', params: { name: 'dist' } });
    const dup = yaml.replace('    steps:\n      - uses: actions/checkout@v7', '    strategy:\n      matrix:\n        node: [22, 24]\n    steps:\n      - uses: actions/checkout@v7');
    const d = run(dup);
    expect(job(d, 'build (24)').why).toMatchObject({ key: 'conveyor.why.artifactDuplicate' });
    expect(log(d, 'build (24)', 3)).toContain('(409) Conflict');
  });
});

describe('the token, secrets and forks', () => {
  const publish = (perm: string) => `on:
  push:
  pull_request:
${perm}
jobs:
  image:
    runs-on: ubuntu-latest
    steps:
      - uses: docker/setup-buildx-action@v4
      - uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v7
        with:
          push: true
          tags: ghcr.io/you/shop:latest
`;
  it('pushing to GHCR needs packages: write', () => {
    const r = run(publish('permissions:\n  contents: read'));
    expect(r.status).toBe('failure');
    expect(log(r, 'image', 2)).toContain('denied: permission_denied: write_package');
    expect(run(publish('permissions:\n  contents: read\n  packages: write')).status).toBe('success');
  });
  it('a fork pull request gets a read-only token', () => {
    const r = run(publish('permissions:\n  packages: write'), 'fork-pr');
    expect(job(r, 'image').why!.key).toBe('conveyor.why.packagesWrite');
  });
  it('default token: restricted unless the repo says write', () => {
    const wf = parseWorkflow(publish('')).workflow!;
    expect(tokenPermissions(wf, wf.jobs[0]!, {}, false)).toEqual({ contents: 'read', packages: 'read' });
    expect(tokenPermissions(wf, wf.jobs[0]!, { repo: { tokenDefault: 'write' } }, false).packages).toBe('write');
    expect(tokenPermissions(wf, wf.jobs[0]!, { repo: { tokenDefault: 'write' } }, true).packages).toBe('read');
  });
  it('secrets: missing, masked, and empty for forks', () => {
    const yaml = `on:
  push:
  pull_request:
jobs:
  hub:
    runs-on: ubuntu-latest
    steps:
      - run: echo "token \${{ secrets.HUB_TOKEN }}"
      - uses: docker/login-action@v4
        with:
          username: kancil
          password: \${{ secrets.HUB_TOKEN }}
`;
    expect(job(run(yaml), 'hub').why).toEqual({ key: 'conveyor.why.secretMissing', params: { name: 'HUB_TOKEN' } });
    const withSecret = run(yaml, 'push-main', { secrets: ['HUB_TOKEN'] });
    expect(withSecret.status).toBe('success');
    expect(log(withSecret, 'hub', 0)).toContain('token ***');
    expect(job(run(yaml, 'fork-pr', { secrets: ['HUB_TOKEN'] }), 'hub').why).toEqual({ key: 'conveyor.why.forkNoSecrets', params: { name: 'HUB_TOKEN' } });
  });
  it('attestations need id-token: write', () => {
    const yaml = (perm: string) => `on: push\npermissions:\n${perm}\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/attest@v4\n        with:\n          subject-path: dist/app.tgz\n`;
    expect(run(yaml('  contents: read')).jobs[0]!.why!.key).toBe('conveyor.why.idToken');
    expect(run(yaml('  id-token: write')).jobs[0]!.why).toEqual({ key: 'conveyor.why.permDenied', params: { scope: 'attestations' } });
    expect(run(yaml('  id-token: write\n  attestations: write')).status).toBe('success');
  });
  it('gh needs GH_TOKEN, then the right scope', () => {
    const yaml = (env: string, perm: string) => `on: push\npermissions:\n  ${perm}\njobs:\n  r:\n    runs-on: ubuntu-latest\n    steps:\n      - run: gh release create v1.0.0\n${env}`;
    expect(run(yaml('', 'contents: write')).jobs[0]!.why!.key).toBe('conveyor.why.ghNoToken');
    const env = '        env:\n          GH_TOKEN: ${{ github.token }}\n';
    const denied = run(yaml(env, 'contents: read'));
    expect(denied.jobs[0]!.why).toEqual({ key: 'conveyor.why.permDenied', params: { scope: 'contents' } });
    expect(log(denied, 'r', 0)).toContain('HTTP 403: Resource not accessible by integration');
    expect(run(yaml(env, 'contents: write')).status).toBe('success');
  });
});

describe('docker steps', () => {
  const build = (extra: string) => `on:
  push:
    tags: ['v*']
  pull_request:
jobs:
  image:
    runs-on: ubuntu-latest
    steps:
${extra}      - id: meta
        uses: docker/metadata-action@v6
        with:
          images: ghcr.io/you/shop
          tags: |
            type=ref,event=pr
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha
      - uses: docker/build-push-action@v7
        with:
          tags: \${{ steps.meta.outputs.tags }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
`;
  it('metadata-action makes tags from the event', () => {
    const r = run(build('      - uses: docker/setup-buildx-action@v4\n'), 'tag');
    // A version tag also gets `latest` (flavor latest=auto, the metadata-action default).
    expect(job(r, 'image').steps[1]!.outputs.tags!.split('\n')).toEqual(['ghcr.io/you/shop:1.2.0', 'ghcr.io/you/shop:1.2', 'ghcr.io/you/shop:sha-3f9c2a7', 'ghcr.io/you/shop:latest']);
    const pr = run(build('      - uses: docker/setup-buildx-action@v4\n'), 'pr');
    expect(job(pr, 'image').steps[1]!.outputs.tags!.split('\n')).toEqual(['ghcr.io/you/shop:pr-7', 'ghcr.io/you/shop:sha-3f9c2a7']);
  });
  it('layer cache: a warm cache is faster; the docker driver cannot export it', () => {
    const cold = run(build('      - uses: docker/setup-buildx-action@v4\n'), 'tag');
    const warm = run(build('      - uses: docker/setup-buildx-action@v4\n'), 'tag', { cache: { layers: true } });
    expect(cold.layersSaved).toBe(true);
    expect(warm.duration).toBeLessThan(cold.duration);
    expect(warm.events.find((e) => e.type === 'cacheHit')).toMatchObject({ key: 'docker layers' });
    expect(run(build(''), 'tag').jobs[0]!.why!.key).toBe('conveyor.why.cacheExportDocker');
  });
  it('trivy fails on a critical CVE only with exit-code 1; hadolint on DL3007', () => {
    const scan = (code: string) => `on: push\njobs:\n  s:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: hadolint/hadolint-action@v3.1.0\n      - uses: aquasecurity/trivy-action@v0.36.0\n        with:\n          image-ref: shop:1\n          severity: CRITICAL\n          exit-code: '${code}'\n`;
    expect(run(scan('1'), 'push-main', { fail: { cve: 'CRITICAL' } }).jobs[0]!.why).toEqual({ key: 'conveyor.why.cveFound', params: { severity: 'CRITICAL' } });
    expect(run(scan('0'), 'push-main', { fail: { cve: 'CRITICAL' } }).status).toBe('success');
    expect(run(scan('1'), 'push-main', { fail: { cve: 'HIGH' } }).status).toBe('success');
    expect(run(scan('1'), 'push-main', { fail: { hadolint: true } }).jobs[0]!.why!.key).toBe('conveyor.why.hadolint');
  });
});

describe('environments, concurrency, timeouts, services, smoke tests', () => {
  const deploy = `on: push
concurrency:
  group: deploy-\${{ github.ref }}
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npm run build
  production:
    needs: build
    runs-on: ubuntu-latest
    environment: production
    steps:
      - run: npm run deploy
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
`;
  const world: World = { environments: { production: { reviewers: ['aina'], secrets: ['CLOUDFLARE_API_TOKEN'], branches: ['main'] } } };

  it('a required reviewer makes the job wait; approve or reject', () => {
    const w = run(deploy, 'push-main', world);
    expect(w).toMatchObject({ status: 'waiting', waitingFor: 'production' });
    expect(types(w)).toContain('approvalWaiting');
    expect(types(w)).not.toContain('runFinished');
    const yes = run(deploy, 'push-main', world, { production: 'approve' });
    expect(yes.status).toBe('success');
    expect(types(yes)).toEqual(expect.arrayContaining(['approved', 'runFinished']));
    const no = run(deploy, 'push-main', world, { production: 'reject' });
    expect(job(no, 'production')).toMatchObject({ result: 'failure', why: { key: 'conveyor.why.rejected' } });
  });
  it('environment secrets reach only that job; branch rules block other branches', () => {
    const noSecret: World = { environments: { production: {} } };
    expect(job(run(deploy, 'push-main', noSecret), 'production').why!.key).toBe('conveyor.why.secretMissing');
    const r = run(deploy, 'push-branch', world, { production: 'approve' });
    expect(job(r, 'production')).toMatchObject({ result: 'failure', why: { key: 'conveyor.why.envBranch', params: { branch: 'feature' } } });
    expect(job(r, 'production').log.at(-1)!.text).toBe('Branch "feature" is not allowed to deploy to production due to environment protection rules.');
  });
  it('concurrency cancels the older run, or waits for it', () => {
    expect(types(run(deploy, 'push-main', { ...world, olderRun: true }, { production: 'approve' }))).toContain('olderRunCancelled');
    const wait = run(deploy.replace('cancel-in-progress: true', 'cancel-in-progress: false'), 'push-main', { ...world, olderRun: true }, { production: 'approve' });
    expect(types(wait)[1]).toBe('runPending');
    expect(wait.jobs[0]!.start).toBeGreaterThanOrEqual(40);
  });
  it('timeouts: the job is cancelled; a step timeout fails the step', () => {
    const yaml = `on: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:\n      - uses: actions/checkout@v7\n      - run: npm ci\n      - run: npm test\n`;
    const r = run(yaml, 'push-main', { fail: { hang: 'npm test' } });
    expect(r.jobs[0]).toMatchObject({ result: 'cancelled', why: { key: 'conveyor.why.timeout', params: { minutes: 10 } } });
    expect(r.duration).toBeLessThanOrEqual(10 * 60 + 3 + 1);
    const step = run(yaml.replace('      - run: npm test', '      - run: npm test\n        timeout-minutes: 5'), 'push-main', { fail: { hang: 'npm test' } });
    expect(step.jobs[0]!.steps[2]!.why).toEqual({ key: 'conveyor.why.stepTimeout', params: { minutes: 5 } });
  });
  it('tests that need a database need a service container', () => {
    const yaml = `on: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n      - run: npm ci\n      - run: npm test\n`;
    expect(run(yaml, 'push-main', { fail: { db: true } }).jobs[0]!.why!.key).toBe('conveyor.why.dbRefused');
    const svc = yaml.replace('    steps:', '    services:\n      postgres:\n        image: postgres:18-alpine\n    steps:');
    expect(run(svc, 'push-main', { fail: { db: true } }).status).toBe('success');
  });
  it('curl without --fail passes on a 500 (with a note); with --fail it stops', () => {
    const yaml = (flags: string) => `on: push\njobs:\n  smoke:\n    runs-on: ubuntu-latest\n    steps:\n      - run: curl ${flags} https://shop.example.com/health\n`;
    const loose = run(yaml('-s'), 'push-main', { fail: { smoke: true } });
    expect(loose.status).toBe('success');
    expect(loose.jobs[0]!.steps[0]!.why!.key).toBe('conveyor.note.curlNoFail');
    const strict = run(yaml('--fail -s'), 'push-main', { fail: { smoke: true } });
    expect(strict.jobs[0]!.why!.key).toBe('conveyor.why.smokeFailed');
    expect(log(strict, 'smoke', 0)).toContain('curl: (22) The requested URL returned error: 500');
  });
  it('outputs pass between jobs; GITHUB_OUTPUT works', () => {
    const yaml = `on: push
jobs:
  a:
    runs-on: ubuntu-latest
    outputs:
      v: \${{ steps.v.outputs.version }}
    steps:
      - id: v
        run: echo "version=1.4.0" >> "$GITHUB_OUTPUT"
  b:
    needs: a
    if: needs.a.outputs.v == '1.4.0'
    runs-on: ubuntu-latest
    steps:
      - run: echo "\${{ needs.a.outputs.v }}"
`;
    const r = run(yaml);
    expect(job(r, 'a').outputs).toEqual({ v: '1.4.0' });
    expect(log(r, 'b', 0)).toContain('1.4.0');
  });
  it('a reusable workflow job runs as one call', () => {
    const r = run('on: push\njobs:\n  call:\n    uses: you/shared/.github/workflows/ci.yml@v1\n');
    expect(r.status).toBe('success');
    expect(r.jobs[0]!.steps[0]!.name).toBe('Call you/shared/.github/workflows/ci.yml@v1');
  });
  it('is pure: the same input gives the same result', () => {
    expect(JSON.stringify(run(deploy, 'push-main', world))).toBe(JSON.stringify(run(deploy, 'push-main', world)));
  });
});
