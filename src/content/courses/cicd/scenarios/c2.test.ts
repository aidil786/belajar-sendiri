// C2 lessons: each fix choice a lesson offers ends the way the lesson says it does,
// and the runs the lessons describe in words really happen in the engine.
import { describe, expect, it } from 'vitest';
import { replaceLines, runScenario, type EventPreset } from '~/engine/conveyor-sim';
import { realError } from '~/lib/conveyorBelt';
import { c2 } from './c2';

const get = (id: string) => c2.find((s) => s.id === id)!;
const fixed = (id: string, text: string, event: EventPreset) => {
  const s = get(id);
  return runScenario(s, event, { yaml: replaceLines(s.workflow, s.fix!.from, s.fix!.to, text) });
};
const tagsOf = (id: string, event: EventPreset) =>
  runScenario(get(id), event)
    .jobs.flatMap((j) => j.steps)
    .find((st) => st.outputs.tags !== undefined)!
    .outputs.tags!.split('\n');

describe('C2 lesson scenarios', () => {
  it('l02: tags per event (main, pr-7, version + latest), all with the short sha', () => {
    expect(tagsOf('c2-tags', 'push-main')).toEqual(['ghcr.io/you/kedai-kancil:main', 'ghcr.io/you/kedai-kancil:sha-3f9c2a7']);
    expect(tagsOf('c2-tags', 'pr')).toEqual(['ghcr.io/you/kedai-kancil:pr-7', 'ghcr.io/you/kedai-kancil:sha-3f9c2a7']);
    expect(tagsOf('c2-tags', 'tag')).toEqual(['ghcr.io/you/kedai-kancil:1.2.0', 'ghcr.io/you/kedai-kancil:sha-3f9c2a7', 'ghcr.io/you/kedai-kancil:latest']);
  });

  it('l04: the first run saves the layer cache; the second one hits it', () => {
    const first = runScenario(get('c2-layer-cache'), 'push-main');
    expect(first.events.some((e) => e.type === 'cacheMiss')).toBe(true);
    expect(first.layersSaved).toBe(true);
    const second = runScenario(get('c2-layer-cache'), 'push-main', { world: { cache: { layers: true } } });
    expect(second.events.some((e) => e.type === 'cacheHit')).toBe(true);
    expect(second.duration).toBeLessThan(first.duration);
  });

  it('l05: only QEMU fixes the arm64 build', () => {
    expect(runScenario(get('c2-multi-arch'), 'push-main').jobs[0]!.why?.key).toBe('conveyor.why.noQemu');
    expect(fixed('c2-multi-arch', '      - uses: docker/setup-qemu-action@v4\n      - uses: docker/setup-buildx-action@v4', 'push-main').status).toBe('success');
    expect(fixed('c2-multi-arch', '      - uses: actions/setup-node@v7\n      - uses: docker/setup-buildx-action@v4', 'push-main').status).toBe('failure');
    expect(fixed('c2-multi-arch', '      - uses: actions/checkout@v7\n      - uses: docker/setup-buildx-action@v4', 'push-main').status).toBe('failure');
  });

  it('l06 + l08: the test station stops the line; the Compose cleanup still runs', () => {
    expect(runScenario(get('c2-tests-in-container'), 'pr').jobs[0]!.why?.key).toBe('conveyor.why.testsFailed');
    const r = runScenario(get('c2-compose-ci'), 'pr');
    const steps = r.jobs[0]!.steps;
    expect(steps[2]!.result).toBe('failure');
    expect(steps[3]!.result).toBe('success'); // if: always()
  });

  const postgres = '    runs-on: ubuntu-latest\n    services:\n      db:\n        image: postgres:18\n        env:\n          POSTGRES_PASSWORD: test\n        options: --health-cmd pg_isready --health-interval 5s --health-retries 10\n        ports:\n          - 5432:5432';
  const redis = '    runs-on: ubuntu-latest\n    services:\n      cache:\n        image: redis:8\n        ports:\n          - 6379:6379';
  it('l07 + boss: a Postgres service fixes the tests; Redis does not', () => {
    const red = runScenario(get('c2-service-db'), 'pr');
    expect(red.jobs[0]!.why?.key).toBe('conveyor.why.dbRefused');
    // The belt's "real error" is the cause, not the test file's FAIL header.
    expect(realError(red)).toBe('Error: connect ECONNREFUSED 127.0.0.1:5432');
    expect(realError(runScenario(get('c2-tests-in-container'), 'pr'))).toBe('FAIL  tests/cart.test.js > cart > adds 6% SST');
    expect(fixed('c2-service-db', postgres, 'pr').status).toBe('success');
    expect(fixed('c2-service-db', redis, 'pr').status).toBe('failure');
  });

  it('l09: hadolint stops the line before anything else', () => {
    const r = runScenario(get('c2-lint'), 'pr');
    expect(r.jobs[0]!.steps[1]!.why?.key).toBe('conveyor.why.hadolint');
    expect(r.jobs[0]!.steps[2]!.result).toBe('skipped');
  });

  it('l10: without exit-code a critical CVE only warns; with it the line stops', () => {
    const quiet = runScenario(get('c2-cve-no-exit'), 'push-main');
    expect(quiet.status).toBe('success');
    expect(quiet.jobs[0]!.steps[2]!.why?.key).toBe('conveyor.note.scanNoExit');
    expect(runScenario(get('c2-cve-stop'), 'push-main').jobs[0]!.why?.key).toBe('conveyor.why.cveFound');
  });

  it('l11: attestations need id-token and attestations; write-all is green but not the lesson’s answer', () => {
    expect(runScenario(get('c2-attest'), 'push-main').jobs[0]!.why?.key).toBe('conveyor.why.idToken');
    const base = '    permissions:\n      contents: read\n      packages: write\n';
    expect(fixed('c2-attest', `${base}      id-token: write\n      attestations: write`, 'push-main').status).toBe('success');
    const half = fixed('c2-attest', `${base}      id-token: write`, 'push-main');
    expect(half.status).toBe('failure');
    expect(half.jobs[0]!.why).toEqual({ key: 'conveyor.why.permDenied', params: { scope: 'attestations' } });
    expect(fixed('c2-attest', '    permissions: write-all', 'push-main').status).toBe('success');
  });

  it('l13: the older run is cancelled; a docs-only push skips the belt, the PR still runs', () => {
    expect(runScenario(get('c2-concurrency'), 'push-branch').events.some((e) => e.type === 'olderRunCancelled')).toBe(true);
    expect(runScenario(get('c2-paths'), 'push-main').why?.key).toBe('conveyor.why.pathIgnored');
  });

  it('boss: only "push when not a PR" makes a fork PR green and still pushes on main', () => {
    const cond = "          push: ${{ github.event_name != 'pull_request' }}";
    expect(runScenario(get('c2-boss-push'), 'fork-pr').jobs[0]!.why?.key).toBe('conveyor.why.packagesWrite');
    expect(fixed('c2-boss-push', cond, 'fork-pr').status).toBe('success');
    const main = fixed('c2-boss-push', cond, 'push-main');
    expect(main.status).toBe('success');
    expect(main.jobs[0]!.steps.at(-1)!.log.some((l) => l.text.includes('pushing manifest done'))).toBe(true);
    expect(fixed('c2-boss-push', '          push: true', 'fork-pr').status).toBe('failure');
  });

  it('boss + mission: the green line pushes from main only, and the scan stops a critical CVE on PRs too', () => {
    const pushed = (event: EventPreset) =>
      runScenario(get('c2-green-line'), event)
        .jobs.flatMap((j) => j.steps)
        .some((st) => st.log.some((l) => l.text.includes('pushing manifest done')));
    expect(pushed('pr')).toBe(false);
    expect(pushed('fork-pr')).toBe(false);
    expect(pushed('push-main')).toBe(true);
    const cve = runScenario(get('c2-green-line-cve'), 'pr');
    expect(cve.jobs.find((j) => j.id === 'test')!.result).toBe('success');
    expect(cve.jobs.find((j) => j.id === 'image')!.why?.key).toBe('conveyor.why.cveFound');
  });
});
