// What the belt draws, and Spot the hole's audit.
import { describe, expect, it } from 'vitest';
import { auditWorkflow, beltLayout, firstFailedStation, parseWorkflow, presetTrigger, simulate, stationView, stations, viewAt } from '../index';

const single = `on: push
jobs:
  ci:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [22, 24]
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: \${{ matrix.node }}
          cache: npm
      - run: npm ci
      - run: npm run lint
      - name: Run tests
        run: npm test
      - run: npm run build
`;

describe('beltLayout', () => {
  it('one job: stations are steps; setup steps share one station', () => {
    const l = beltLayout(parseWorkflow(single).workflow!);
    expect(l.mode).toBe('steps');
    expect(stations(l).map((s) => [s.kind, s.label, s.steps])).toEqual([
      ['prep', '', [0, 1, 2]],
      ['lint', 'npm run lint', [3]],
      ['test', 'Run tests', [4]],
      ['build', 'npm run build', [5]],
    ]);
  });

  it('several jobs: one station per job, in needs order', () => {
    const wf = parseWorkflow(`on: push
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: npm run lint
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
  image:
    needs: [lint, test]
    runs-on: ubuntu-latest
    steps:
      - uses: docker/build-push-action@v7
  ship:
    needs: image
    runs-on: ubuntu-latest
    environment: production
    steps:
      - run: echo go
`).workflow!;
    const l = beltLayout(wf);
    expect(l.columns.map((c) => c.map((s) => `${s.id}:${s.kind}`))).toEqual([['lint:lint', 'test:test'], ['image:build'], ['ship:deploy']]);
  });
});

describe('viewAt and stationView', () => {
  const wf = parseWorkflow(single).workflow!;
  const layout = beltLayout(wf);
  const r = simulate(single, { trigger: presetTrigger('push-main'), world: { fail: { tests: ['t'], onlyIn: { node: '22' } } } });

  it('nothing moves before the first event; lanes appear for a matrix', () => {
    const v0 = viewAt(r, 0);
    expect(stations(layout).map((s) => stationView(s, layout, r, v0).state)).toEqual(['idle', 'idle', 'idle', 'idle']);
    const end = viewAt(r);
    const views = stations(layout).map((s) => stationView(s, layout, r, end));
    expect(views[0]!.lanes.map((l) => `${l.label}:${l.state}`)).toEqual(['22:success', '24:success']);
    expect(views[0]!.cache).toBe('miss');
    expect(views[2]!.lanes.map((l) => `${l.label}:${l.state}`)).toEqual(['22:failure', '24:cancelled']);
    expect(views[2]!.state).toBe('failure');
    expect(end.finished && end.status).toBe('failure');
  });

  it('a station is running in the middle of a run', () => {
    const i = r.events.findIndex((e) => e.type === 'stepStarted' && e.step === 3);
    const v = viewAt(r, i + 1);
    expect(stationView(stations(layout)[1]!, layout, r, v).state).toBe('running');
    expect(v.finished).toBe(false);
  });

  it('firstFailedStation is the one to predict', () => {
    expect(firstFailedStation(layout, r)?.label).toBe('Run tests');
    const green = simulate(single, { trigger: presetTrigger('push-main') });
    expect(firstFailedStation(layout, green)).toBeNull();
  });
});

describe('auditWorkflow', () => {
  it('finds each kind of hole on its line', () => {
    const yaml = `on:
  pull_request_target:
permissions: write-all
jobs:
  a:
    runs-on: self-hosted
    permissions: write-all
    steps:
      - uses: actions/checkout@v7
        with:
          ref: \${{ github.event.pull_request.head.ref }}
      - uses: someone/tool@v1
      - uses: someone/pinned@0123456789abcdef0123456789abcdef01234567
      - run: |
          echo "\${{ github.event.pull_request.title }}"
          echo "\${{ secrets.TOKEN }}"
          echo "\${{ github.sha }}"
`;
    expect(auditWorkflow(yaml).map((h) => `${h.line}:${h.kind}`)).toEqual(['3:writeAll', '6:selfHosted', '7:writeAll', '11:prTargetCheckout', '12:unpinned', '15:injection', '16:secretEcho']);
    expect(auditWorkflow(yaml, { publicRepo: false }).some((h) => h.kind === 'selfHosted')).toBe(false);
  });
});
