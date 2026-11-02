// C1 Pipeline Thinking: conveyor scenarios (shape: ConveyorScenario in src/engine/conveyor-sim/scenario.ts).
// Every workflow here is checked by actionlint (`npm run verify:workflows`).
import type { ConveyorScenario } from '~/engine/conveyor-sim';

/** One job, the classic CI line: get ready → lint → test → build. */
const firstPipeline = `name: CI
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build
`;

/** Tests, then the delivery van (a deploy job in the production environment). */
const shipLine = `name: Ship
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm ci && npm test
  deploy:
    needs: test
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v7
      - run: npm ci && npm run build
      - run: npm run deploy
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
`;

/** Ships first, tastes later: deploy runs before the tests (on purpose, for the hook). */
const wrongOrder = `name: Oops
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  line:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npm run build
      - run: npm run deploy
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
      - run: npm test
`;

/** All six stations in one job: lint → test → build → scan → publish → deploy. */
const shopLine = `name: Shop line
on:
  push:
    branches: [main]
permissions:
  contents: read
  packages: write
jobs:
  line:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: docker build -t shop:\${{ github.sha }} .
      - name: Scan the image
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          image-ref: shop:\${{ github.sha }}
          severity: CRITICAL
          exit-code: '1'
      - name: Publish to GHCR
        run: |
          echo "$TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin
          docker tag shop:\${{ github.sha }} ghcr.io/kancil/shop:\${{ github.sha }}
          docker push ghcr.io/kancil/shop:\${{ github.sha }}
        env:
          TOKEN: \${{ secrets.GITHUB_TOKEN }}
      - run: npm run deploy
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
`;

/** The testing pyramid as stations: unit (fast) → integration → end-to-end (slow). */
const pyramid = `name: Tests
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
jobs:
  tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npm run test:unit
      - run: npm run test:integration
      - run: npm run test:e2e
`;

/** Trunk-based work: test both sides of a feature flag, one matrix leg per flag state. */
const flagMatrix = `name: CI
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        new-checkout: ['off', 'on']
    steps:
      - uses: actions/checkout@v7
      - run: npm ci && npm run lint
      - run: npm test
        env:
          NEW_CHECKOUT: \${{ matrix.new-checkout }}
`;

/** Build once, then promote the same artifact: staging (with a health check) → production. */
const promote = `name: Promote
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm ci && npm test && npm run build
      - uses: actions/upload-artifact@v7
        with:
          name: site
          path: dist
  staging:
    needs: build
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v7
      - uses: actions/download-artifact@v8
        with:
          name: site
          path: dist
      - run: npx wrangler deploy --env staging
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
      - run: curl --fail --silent https://staging.example.com/health
  production:
    needs: staging
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v7
      - uses: actions/download-artifact@v8
        with:
          name: site
          path: dist
      - run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
`;

/** Boss, team 1 (a small kuih shop website): pull requests are checked, only main ships. */
const kuihSite = `name: Kuih site
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm ci && npm run lint && npm test
  deploy:
    needs: test
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm ci && npm run build
      - run: npm run deploy
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
`;

const cloudflare = { secrets: ['CLOUDFLARE_API_TOKEN'] };

export const c1: ConveyorScenario[] = [
  {
    // Green on every event. The first run misses the npm cache; run again to hit it.
    id: 'c1-first-pipeline',
    workflow: firstPipeline,
    events: ['push-main', 'push-branch', 'pr', 'fork-pr'],
    expect: { 'push-main': 'success', 'push-branch': 'notTriggered', pr: 'success', 'fork-pr': 'success' },
  },
  {
    // Same line, one failing test: predict which station stops the line.
    id: 'c1-broken-test',
    workflow: firstPipeline,
    cache: { warm: true },
    fail: { tests: ['tests/cart.test.js > cart > adds 6% tax'] },
    events: ['push-main', 'pr'],
    expect: { 'push-main': 'failure', pr: 'failure' },
  },
  {
    // l02 continuous delivery: tests pass, then production waits for a person (Aina) to approve.
    id: 'c1-delivery',
    workflow: shipLine,
    file: '.github/workflows/ship.yml',
    cache: { warm: true },
    environments: { production: { reviewers: ['aina'], ...cloudflare } },
    events: ['push-main'],
    expect: { 'push-main': 'waiting' },
  },
  {
    // l02 continuous deployment: the same line with no reviewer. Green means live.
    id: 'c1-deployment',
    workflow: shipLine,
    file: '.github/workflows/ship.yml',
    cache: { warm: true },
    environments: { production: cloudflare },
    events: ['push-main'],
    expect: { 'push-main': 'success' },
  },
  {
    // l03 hook: deploy runs before the tests, and a test fails. The bug is already live.
    id: 'c1-wrong-order',
    workflow: wrongOrder,
    file: '.github/workflows/oops.yml',
    cache: { warm: true },
    secrets: ['CLOUDFLARE_API_TOKEN'],
    fail: { tests: ['tests/cart.test.js > cart > adds 6% tax'] },
    events: ['push-main'],
    expect: { 'push-main': 'failure' },
  },
  {
    // l03: all six stations, all green.
    id: 'c1-shop-line',
    workflow: shopLine,
    file: '.github/workflows/shop.yml',
    cache: { warm: true },
    secrets: ['CLOUDFLARE_API_TOKEN'],
    events: ['push-main'],
    expect: { 'push-main': 'success' },
  },
  {
    // l03 predict: a critical CVE stops the line at the scan station. Nothing is published.
    id: 'c1-scan-stop',
    workflow: shopLine,
    file: '.github/workflows/shop.yml',
    cache: { warm: true },
    secrets: ['CLOUDFLARE_API_TOKEN'],
    fail: { cve: 'CRITICAL' },
    events: ['push-main'],
    expect: { 'push-main': 'failure' },
  },
  {
    // l04 predict: a typo; lint is the first (and fastest) station to stop the line.
    id: 'c1-typo',
    workflow: firstPipeline,
    cache: { warm: true },
    fail: { lint: ["src/cart.js  3:7  error  'totl' is not defined  no-undef"] },
    events: ['pr', 'push-main'],
    expect: { pr: 'failure', 'push-main': 'failure' },
  },
  {
    // l05 predict: a maths bug; the fast unit tests catch it before the slow ones start.
    id: 'c1-pyramid',
    workflow: pyramid,
    file: '.github/workflows/tests.yml',
    cache: { warm: true },
    fail: { tests: ['tests/unit/tax.test.js > adds 6% tax'] },
    events: ['pr', 'push-main'],
    expect: { pr: 'failure', 'push-main': 'failure' },
  },
  {
    // l06: build once, then the same artifact goes to staging, then production.
    id: 'c1-promote',
    workflow: promote,
    file: '.github/workflows/promote.yml',
    cache: { warm: true },
    environments: { staging: cloudflare, production: cloudflare },
    events: ['push-main'],
    expect: { 'push-main': 'success' },
  },
  {
    // l06 predict: staging's health check fails, so production never gets the bad build.
    id: 'c1-promote-smoke',
    workflow: promote,
    file: '.github/workflows/promote.yml',
    cache: { warm: true },
    environments: { staging: cloudflare, production: cloudflare },
    fail: { smoke: true },
    events: ['push-main'],
    expect: { 'push-main': 'failure' },
  },
  {
    // l07 predict: Ben's PR finishes the new checkout. It breaks only with the flag on, so the PR stays red.
    id: 'c1-flag-matrix',
    workflow: flagMatrix,
    cache: { warm: true },
    fail: { tests: ['tests/checkout.test.js > new checkout > pays with FPX'], onlyIn: { 'new-checkout': 'on' } },
    events: ['pr'],
    expect: { pr: 'failure' },
  },
  {
    // Boss team 1: find the event where the deploy job is skipped (a pull request).
    id: 'c1-boss-kuih',
    workflow: kuihSite,
    file: '.github/workflows/site.yml',
    cache: { warm: true },
    secrets: ['CLOUDFLARE_API_TOKEN'],
    events: ['push-main', 'pr'],
    expect: { 'push-main': 'success', pr: 'success' },
  },
  {
    // Boss team 2: the image build breaks, so nothing is scanned, published or deployed.
    id: 'c1-boss-api',
    workflow: shopLine.replace('name: Shop line', 'name: API line').replaceAll('shop', 'api'),
    file: '.github/workflows/api.yml',
    cache: { warm: true },
    secrets: ['CLOUDFLARE_API_TOKEN'],
    fail: { build: true },
    events: ['push-main'],
    expect: { 'push-main': 'failure' },
  },
  {
    // Boss team 3 (a clinic booking app): staging, then production after a person approves.
    id: 'c1-boss-clinic',
    workflow: promote.replace('name: Promote', 'name: Clinic release'),
    file: '.github/workflows/release.yml',
    cache: { warm: true },
    environments: { staging: cloudflare, production: { reviewers: ['dr-lim'], ...cloudflare } },
    events: ['push-main'],
    expect: { 'push-main': 'waiting' },
  },
];
