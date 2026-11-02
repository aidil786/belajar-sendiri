// C2 Container Pipelines: conveyor scenarios (shape: ConveyorScenario in src/engine/conveyor-sim/scenario.ts).
// Action majors match KNOWN_ACTIONS (checked by `npm run verify:workflows`, with actionlint).
import type { ConveyorScenario } from '~/engine/conveyor-sim';

/** Test on two Node versions, then build, push and attest an image; scan it after a push. */
const containerPipeline = `name: Container
on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:
permissions:
  contents: read
concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true
jobs:
  test:
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
      - run: npm test
  image:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
      id-token: write
      attestations: write
    outputs:
      digest: \${{ steps.push.outputs.digest }}
    steps:
      - uses: actions/checkout@v7
      - uses: docker/setup-buildx-action@v4
      - uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v6
        with:
          images: ghcr.io/\${{ github.repository }}
          tags: |
            type=ref,event=branch
            type=ref,event=pr
            type=semver,pattern={{version}}
            type=sha
      - id: push
        uses: docker/build-push-action@v7
        with:
          push: \${{ github.event_name != 'pull_request' }}
          tags: \${{ steps.meta.outputs.tags }}
          labels: \${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - if: github.event_name != 'pull_request'
        uses: actions/attest@v4
        with:
          subject-name: ghcr.io/\${{ github.repository }}
          subject-digest: \${{ steps.push.outputs.digest }}
          push-to-registry: true
  scan:
    needs: image
    if: github.event_name != 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: read
    steps:
      - uses: aquasecurity/trivy-action@v0.36.0
        with:
          image-ref: ghcr.io/\${{ github.repository }}@\${{ needs.image.outputs.digest }}
          severity: CRITICAL,HIGH
          exit-code: '1'
`;

/** Push to GHCR with only `contents: read`: the push is denied until the job may write packages. */
const publishNoPackages = `name: Publish
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: docker/setup-buildx-action@v4
      - uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v7
        with:
          push: true
          tags: ghcr.io/\${{ github.repository }}:\${{ github.sha }}
`;

// ---------- C2 lessons (cicd-c2-l01 … boss). The learner's capstone repo: you/kedai-kancil. ----------

const kedai = { owner: 'you', name: 'kedai-kancil' };

/** l01: build only. No checkout: build-push-action reads the code from Git by itself. */
const buildOnly = `name: Image
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
jobs:
  image:
    runs-on: ubuntu-latest
    steps:
      - uses: docker/setup-buildx-action@v4
      - uses: docker/build-push-action@v7
        with:
          tags: kedai-kancil:ci
`;

/** l02: metadata-action names the pack for each event. */
const tagsOnly = `name: Tags
on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:
permissions:
  contents: read
jobs:
  tags:
    runs-on: ubuntu-latest
    steps:
      - id: meta
        uses: docker/metadata-action@v6
        with:
          images: ghcr.io/you/kedai-kancil
          tags: |
            type=ref,event=branch
            type=ref,event=pr
            type=semver,pattern={{version}}
            type=sha
`;

/** l04: the layer cache lives in the GitHub Actions cache between runs. */
const layerCache = `name: Image
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  image:
    runs-on: ubuntu-latest
    steps:
      - uses: docker/setup-buildx-action@v4
      - uses: docker/build-push-action@v7
        with:
          tags: kedai-kancil:ci
          cache-from: type=gha
          cache-to: type=gha,mode=max
`;

/** l05: two CPU types. Line 11 is the fix: QEMU before Buildx. */
const multiArch = `name: Image
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  image:
    runs-on: ubuntu-latest
    steps:
      - uses: docker/setup-buildx-action@v4
      - uses: docker/build-push-action@v7
        with:
          tags: kedai-kancil:ci
          platforms: linux/amd64,linux/arm64
`;

/** l06: build the Dockerfile's test stage, then run the tests inside it. */
const testsInContainer = `name: Test
on:
  pull_request:
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: docker/setup-buildx-action@v4
      - uses: docker/build-push-action@v7
        with:
          target: test
          load: true
          tags: kedai-kancil:test
      - run: docker run --rm kedai-kancil:test npm test
`;

/** l07: the tests need Postgres. Line 8 is the fix: add a service container. */
const needsDb = `name: Test
on:
  pull_request:
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: npm ci
      - run: npm test
        env:
          DATABASE_URL: postgres://postgres:test@localhost:5432/postgres
`;

/** l08: the whole set meal (compose.yaml) on the runner. */
const composeCi = `name: Test
on:
  pull_request:
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: docker compose up -d --wait
      - run: docker compose run --rm api npm test
      - if: always()
        run: docker compose down -v
`;

/** l09: lint the recipe (hadolint) and the workflows (actionlint, official image). */
const lintLine = `name: Lint
on:
  pull_request:
permissions:
  contents: read
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: hadolint/hadolint-action@v3.1.0
        with:
          dockerfile: Dockerfile
      - name: Lint workflows
        run: docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12
`;

/** l10: Trivy scans the image. Without exit-code, a critical CVE only prints a warning. */
const scanNoExit = `name: Scan
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: docker/setup-buildx-action@v4
      - uses: docker/build-push-action@v7
        with:
          load: true
          tags: kedai-kancil:scan
      - uses: aquasecurity/trivy-action@v0.36.0
        with:
          image-ref: kedai-kancil:scan
          severity: CRITICAL
`;

const scanStop = scanNoExit.replace('          severity: CRITICAL\n', "          severity: CRITICAL\n          exit-code: '1'\n");

/** l11: push, attach an SBOM, sign provenance. Lines 8–10 are the fix (id-token, attestations). */
const attest = `name: Publish
on:
  push:
    branches: [main]
jobs:
  image:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: docker/setup-buildx-action@v4
      - uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}
      - id: push
        uses: docker/build-push-action@v7
        with:
          push: true
          sbom: true
          tags: ghcr.io/\${{ github.repository }}:\${{ github.sha }}
      - uses: actions/attest@v4
        with:
          subject-name: ghcr.io/\${{ github.repository }}
          subject-digest: \${{ steps.push.outputs.digest }}
          push-to-registry: true
`;

/** l12: one shared recipe (a reusable workflow), called twice. */
const reusableCaller = `name: CI
on:
  push:
    branches: [main]
permissions:
  contents: read
  packages: write
jobs:
  web:
    uses: ./.github/workflows/build-image.yml
    with:
      folder: web
  api:
    uses: ./.github/workflows/build-image.yml
    with:
      folder: api
`;

/** l12: the shared recipe itself (shown with SpotLines; here so actionlint checks it). */
const reusableCallee = `name: Build image
on:
  workflow_call:
    inputs:
      folder:
        required: true
        type: string
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: docker/setup-buildx-action@v4
      - uses: docker/build-push-action@v7
        with:
          context: "{{defaultContext}}:\${{ inputs.folder }}"
          tags: kedai-kancil-\${{ inputs.folder }}:ci
`;

/** l13: a newer push cancels the older run on the same branch; npm packages come from the cache. */
const concurrencyLine = `name: CI
on:
  push:
concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true
permissions:
  contents: read
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
`;

/** l13: a docs-only change doesn't start the belt (the filter in the SortCards card; here so actionlint and the engine check it). */
const pathsLine = `name: CI
on:
  push:
    branches: [main]
    paths-ignore: ['docs/**', '**.md']
  pull_request:
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npm test
`;

/** Boss: the image job pushes on every event, so a fork's pull request (read-only token) goes red. Line 18 is the fix. */
const bossPush = `name: Green line
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
  packages: write
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
          tags: ghcr.io/\${{ github.repository }}:\${{ github.sha }}
`;

/**
 * Boss + mission 2: the green line. Every PR builds, tests and scans (no push);
 * every merge to main also pushes a tagged image. The image is scanned before it is pushed.
 */
const greenLine = `name: Green line
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
      - run: docker compose up -d --wait
      - run: docker compose run --rm api npm test
  image:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: docker/setup-buildx-action@v4
      - id: meta
        uses: docker/metadata-action@v6
        with:
          images: ghcr.io/\${{ github.repository }}
      - uses: docker/build-push-action@v7
        with:
          load: true
          tags: kedai-kancil:scan
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - uses: aquasecurity/trivy-action@v0.36.0
        with:
          image-ref: kedai-kancil:scan
          severity: CRITICAL
          exit-code: '1'
      - if: github.event_name != 'pull_request'
        uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v7
        with:
          push: \${{ github.event_name != 'pull_request' }}
          tags: \${{ steps.meta.outputs.tags }}
          labels: \${{ steps.meta.outputs.labels }}
          cache-from: type=gha
`;

export const c2: ConveyorScenario[] = [
  {
    // The capstone line (mission 2). PRs build without pushing; forks get a read-only token.
    id: 'c2-container-pipeline',
    workflow: containerPipeline,
    file: '.github/workflows/container.yml',
    cache: { warm: true },
    events: ['push-main', 'pr', 'fork-pr', 'tag'],
    expect: { 'push-main': 'success', pr: 'success', 'fork-pr': 'success', tag: 'success' },
  },
  {
    // Same line, but the image has a critical CVE: the scan station stops it.
    id: 'c2-critical-cve',
    workflow: containerPipeline,
    file: '.github/workflows/container.yml',
    cache: { warm: true, layers: true },
    fail: { cve: 'CRITICAL' },
    events: ['push-main', 'pr'],
    expect: { 'push-main': 'failure', pr: 'success' },
  },
  {
    // Fix task: lines 5–6 are editable. Least privilege: add `packages: write`.
    id: 'c2-fix-permissions',
    workflow: publishNoPackages,
    file: '.github/workflows/publish.yml',
    fix: { from: 5, to: 6 },
    events: ['push-main'],
    expect: { 'push-main': 'failure' },
  },
  // ----- C2 lessons -----
  {
    // l01: the belt packs an image on a fresh runner (no push yet).
    id: 'c2-build',
    workflow: buildOnly,
    file: '.github/workflows/image.yml',
    repo: kedai,
    events: ['push-main', 'pr'],
    expect: { 'push-main': 'success', pr: 'success' },
  },
  {
    // l02: tags per event: main + sha-3f9c2a7; pr-7 + sha; 1.2.0 + sha + latest.
    id: 'c2-tags',
    workflow: tagsOnly,
    file: '.github/workflows/tags.yml',
    repo: kedai,
    events: ['push-main', 'pr', 'tag'],
    expect: { 'push-main': 'success', pr: 'success', tag: 'success' },
  },
  {
    // l04: run twice. The first run misses the layer cache and saves it; the second hits.
    id: 'c2-layer-cache',
    workflow: layerCache,
    file: '.github/workflows/image.yml',
    repo: kedai,
    events: ['push-main'],
    expect: { 'push-main': 'success' },
  },
  {
    // l05: arm64 on an x64 runner needs QEMU. Fix line 11.
    id: 'c2-multi-arch',
    workflow: multiArch,
    file: '.github/workflows/image.yml',
    repo: kedai,
    fix: { from: 11, to: 11 },
    events: ['push-main'],
    expect: { 'push-main': 'failure' },
  },
  {
    // l06: the tests run inside the image's test stage; one fails.
    id: 'c2-tests-in-container',
    workflow: testsInContainer,
    file: '.github/workflows/test.yml',
    repo: kedai,
    fail: { tests: ['tests/cart.test.js > cart > adds 6% SST'] },
    events: ['pr'],
    expect: { pr: 'failure' },
  },
  {
    // l07 + boss: the tests can't reach Postgres. Fix line 8 (runs-on) by adding services.
    id: 'c2-service-db',
    workflow: needsDb,
    file: '.github/workflows/test.yml',
    repo: kedai,
    cache: { warm: true },
    fail: { db: true },
    fix: { from: 8, to: 8 },
    events: ['pr'],
    expect: { pr: 'failure' },
  },
  {
    // l08: Compose brings the database; a failing test still lets the cleanup run (if: always()).
    id: 'c2-compose-ci',
    workflow: composeCi,
    file: '.github/workflows/test.yml',
    repo: kedai,
    fail: { db: true, tests: ['tests/orders.test.js > orders > saves an order'] },
    events: ['pr'],
    expect: { pr: 'failure' },
  },
  {
    // l09: hadolint finds DL3007 (FROM node:latest).
    id: 'c2-lint',
    workflow: lintLine,
    file: '.github/workflows/lint.yml',
    repo: kedai,
    fail: { hadolint: true },
    events: ['pr'],
    expect: { pr: 'failure' },
  },
  {
    // l10: a critical CVE, but no exit-code: the line keeps going (predict "nothing stops it").
    id: 'c2-cve-no-exit',
    workflow: scanNoExit,
    file: '.github/workflows/scan.yml',
    repo: kedai,
    fail: { cve: 'CRITICAL' },
    events: ['push-main'],
    expect: { 'push-main': 'success' },
  },
  {
    // l10: the same scan with exit-code '1' stops the line.
    id: 'c2-cve-stop',
    workflow: scanStop,
    file: '.github/workflows/scan.yml',
    repo: kedai,
    fail: { cve: 'CRITICAL' },
    events: ['push-main'],
    expect: { 'push-main': 'failure' },
  },
  {
    // l11: attestations need id-token: write and attestations: write. Fix lines 8–10.
    id: 'c2-attest',
    workflow: attest,
    file: '.github/workflows/publish.yml',
    repo: kedai,
    fix: { from: 8, to: 10 },
    events: ['push-main'],
    expect: { 'push-main': 'failure' },
  },
  {
    // l12: two jobs call one reusable workflow.
    id: 'c2-reusable',
    workflow: reusableCaller,
    file: '.github/workflows/ci.yml',
    repo: kedai,
    // The called file sits in the learner's repo, not in this one. actionlint checks it on its
    // own as scenario c2-reusable-callee; here it can only say it can't open it.
    actionlint: ['could not read reusable workflow file for "\\./\\.github/workflows/build-image\\.yml"'],
    events: ['push-main'],
    expect: { 'push-main': 'success' },
  },
  {
    // l12: the called workflow (only workflow_call: no event button starts it by itself).
    id: 'c2-reusable-callee',
    workflow: reusableCallee,
    file: '.github/workflows/build-image.yml',
    repo: kedai,
    events: ['push-main'],
    expect: { 'push-main': 'notTriggered' },
  },
  {
    // l13: an older run on the same branch is cancelled; run twice for the npm cache.
    id: 'c2-concurrency',
    workflow: concurrencyLine,
    repo: kedai,
    branch: 'menu-page',
    olderRun: true,
    events: ['push-branch'],
    expect: { 'push-branch': 'success' },
  },
  {
    // l13: only docs changed. The push skips the belt; the pull request (no filter) still runs.
    id: 'c2-paths',
    workflow: pathsLine,
    repo: kedai,
    changed: ['docs/menu.md'],
    cache: { warm: true },
    events: ['push-main', 'pr'],
    expect: { 'push-main': 'notTriggered', pr: 'success' },
  },
  {
    // Boss: push: true on every event. A fork's pull request has a read-only token → red. Fix line 21.
    id: 'c2-boss-push',
    workflow: bossPush,
    file: '.github/workflows/green-line.yml',
    repo: kedai,
    fix: { from: 21, to: 21 },
    events: ['fork-pr', 'push-main'],
    expect: { 'fork-pr': 'failure', 'push-main': 'success' },
  },
  {
    // Boss + mission 2: the whole green line. PRs (also from forks) build, test and scan; main also pushes.
    id: 'c2-green-line',
    workflow: greenLine,
    file: '.github/workflows/green-line.yml',
    repo: kedai,
    cache: { layers: true },
    events: ['pr', 'fork-pr', 'push-main'],
    expect: { pr: 'success', 'fork-pr': 'success', 'push-main': 'success' },
  },
  {
    // Boss: the same line, but the image has a critical CVE. The scan stops PRs and main alike.
    id: 'c2-green-line-cve',
    workflow: greenLine,
    file: '.github/workflows/green-line.yml',
    repo: kedai,
    cache: { layers: true },
    fail: { cve: 'CRITICAL' },
    events: ['pr', 'push-main'],
    expect: { pr: 'failure', 'push-main': 'failure' },
  },
];
