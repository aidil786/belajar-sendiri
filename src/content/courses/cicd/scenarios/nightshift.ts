// Night shift drills (CI/CD): a belt that stopped; the learner fixes it.
// Drills are listed in src/content/courses/nightshift.ts. The other two CI/CD drills reuse
// c2-fix-permissions and c4-release-perms. Every workflow is checked by actionlint (`npm run verify:workflows`).
import type { ConveyorScenario } from '~/engine/conveyor-sim';

/** Listens for pushes to master, but the shop's main branch is main. Line 4 is the fix. */
const masterOnly = `name: CI
on:
  push:
    branches: [master]
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

/** Pushes to GHCR with no login step first. Line 12 is the fix (add the login after buildx). */
const noLogin = `name: Publish
on:
  push:
    branches: [main]
permissions:
  contents: read
  packages: write
jobs:
  image:
    runs-on: ubuntu-latest
    steps:
      - uses: docker/setup-buildx-action@v4
      - uses: docker/build-push-action@v7
        with:
          push: true
          tags: ghcr.io/\${{ github.repository }}:\${{ github.sha }}
`;

/** gh needs GH_TOKEN in the step's env, even when the job may write. Line 12 is the fix. */
const ghNoToken = `name: Release
on:
  push:
    tags: ['v*']
permissions:
  contents: write
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: gh release create "$GITHUB_REF_NAME" --generate-notes
`;

/** The tests need Postgres. On a laptop it runs already; the runner has none. Line 8 is the fix. */
const noTestDb = `name: Test
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

/** The attestation step needs id-token: write and attestations: write. Lines 8–10 are the fix. */
const attestNoIdToken = `name: Publish
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
          tags: ghcr.io/\${{ github.repository }}:\${{ github.sha }}
      - uses: actions/attest@v4
        with:
          subject-name: ghcr.io/\${{ github.repository }}
          subject-digest: \${{ steps.push.outputs.digest }}
          push-to-registry: true
`;

/** A comment on the pull request needs pull-requests: write. Lines 4–5 are the fix. */
const prComment = `name: Coverage
on:
  pull_request:
permissions:
  contents: read
jobs:
  coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npm test
      - run: gh pr comment "$PR" --body "Tests passed"
        env:
          GH_TOKEN: \${{ github.token }}
          PR: \${{ github.event.pull_request.number }}
`;

/** A job timeout far below what the image build needs. Line 10 is the fix. */
const tightTimeout = `name: Image
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  image:
    runs-on: ubuntu-latest
    timeout-minutes: 1
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npm test
      - uses: docker/setup-buildx-action@v4
      - uses: docker/build-push-action@v7
        with:
          tags: kedai-kancil:ci
`;

const kedai = { owner: 'you', name: 'kedai-kancil' };

export const nightshift: ConveyorScenario[] = [
  {
    // "The belt never started": a push to main does not match branches: [master].
    id: 'ns-ci-not-triggered',
    file: '.github/workflows/ci.yml',
    workflow: masterOnly,
    fix: { from: 4, to: 4 },
    events: ['push-main'],
    expect: { 'push-main': 'notTriggered', pr: 'success' },
  },

  // ---------------------------------------------------------------- Level Up drills (2026-11-01)
  {
    // ★ "no login": build-push-action pushes to GHCR, but nothing logged in first.
    id: 'ns-ci-no-login',
    file: '.github/workflows/publish.yml',
    workflow: noLogin,
    repo: kedai,
    fix: { from: 12, to: 12 },
    events: ['push-main'],
    expect: { 'push-main': 'failure' },
  },
  {
    // ★ "gh needs a token": the job may write, but gh finds no GH_TOKEN in the step's env.
    id: 'ns-ci-gh-token',
    file: '.github/workflows/release.yml',
    workflow: ghNoToken,
    repo: kedai,
    tag: 'v1.5.0',
    fix: { from: 12, to: 12 },
    events: ['tag'],
    expect: { tag: 'failure' },
  },
  {
    // ★★ "no test database": green on every laptop, red on the runner (ECONNREFUSED 127.0.0.1:5432).
    id: 'ns-ci-no-db',
    file: '.github/workflows/test.yml',
    workflow: noTestDb,
    repo: kedai,
    fail: { db: true },
    fix: { from: 8, to: 8 },
    events: ['pr'],
    expect: { pr: 'failure' },
  },
  {
    // ★★ "attestation refused": the image is pushed, then the attestation step has no OIDC token.
    id: 'ns-ci-attest',
    file: '.github/workflows/publish.yml',
    workflow: attestNoIdToken,
    repo: kedai,
    fix: { from: 8, to: 10 },
    events: ['push-main'],
    expect: { 'push-main': 'failure' },
  },
  {
    // ★★ "the PR comment is refused": the token may only read pull requests.
    id: 'ns-ci-pr-comment',
    file: '.github/workflows/coverage.yml',
    workflow: prComment,
    repo: kedai,
    fix: { from: 4, to: 5 },
    events: ['pr'],
    expect: { pr: 'failure' },
  },
  {
    // ★★ "timed out": the job timeout is shorter than the image build.
    id: 'ns-ci-timeout',
    file: '.github/workflows/image.yml',
    workflow: tightTimeout,
    repo: kedai,
    fix: { from: 10, to: 10 },
    events: ['push-main'],
    expect: { 'push-main': 'cancelled' },
  },
];
