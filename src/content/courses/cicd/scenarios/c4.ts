// C4 Pipeline Shields: conveyor scenarios (shape: ConveyorScenario in src/engine/conveyor-sim/scenario.ts).
// `holes` must match auditWorkflow() (a test checks it). `actionlint` lists the findings the
// vulnerable file shows on purpose; `fixed` must pass actionlint with no findings.
import type { ConveyorScenario } from '~/engine/conveyor-sim';

/** Six holes on purpose. Valid YAML that GitHub would run, which is the danger. */
const vulnerable = `name: Triage
on:
  pull_request_target:
  issues:
    types: [opened]
permissions: write-all
jobs:
  greet:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v7
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - uses: example-org/changed-files@v2
      - run: echo "Thanks for \${{ github.event.issue.title }}"
      - run: echo "Token is \${{ secrets.NPM_TOKEN }}"
      - run: npm ci && npm test
`;

/** The same job, patched. The SHA is an example: copy the real one from the action's release page. */
const fixed = `name: Triage
on:
  pull_request:
  issues:
    types: [opened]
permissions:
  contents: read
jobs:
  greet:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: example-org/changed-files@0123456789abcdef0123456789abcdef01234567 # v2.0.0 (example SHA)
      - run: echo "Thanks for $TITLE"
        env:
          TITLE: \${{ github.event.issue.title }}
      - run: npm ci && npm test
`;

/** L04: a release job with a read-only token. `gh release create` is refused until the job may write contents. */
const releaseReadOnly = `name: Release
on:
  push:
    tags: ['v*']
permissions:
  contents: read
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npm test
      - run: gh release create "$GITHUB_REF_NAME" --generate-notes
        env:
          GH_TOKEN: \${{ github.token }}
`;

/** L05: a PR preview on the safe trigger. Fork PRs get no secrets, so their deploy step stops. */
const previewPr = `name: Preview
on:
  pull_request:
permissions:
  contents: read
jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npx wrangler deploy --env preview
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
`;

/** L05: the same preview on pull_request_target, checking out the PR's code: a fork PR runs green, with your token. */
const previewPrTarget = `name: Preview
on:
  pull_request_target:
permissions:
  contents: read
jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - run: npm ci
      - run: npx wrangler deploy --env preview
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
`;

/** L07: a debug line prints a secret. GitHub masks the exact value as ***. */
const echoSecret = `name: Deploy
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: echo "Using token \${{ secrets.CLOUDFLARE_API_TOKEN }}"
      - run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
`;

/** Boss: a "PR helper" copied from a blog. Exactly five holes (the boss is "find and fix 5"). */
const bossVulnerable = `name: PR helper
on:
  pull_request_target:
permissions: write-all
jobs:
  check:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v7
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - uses: example-org/size-check@v3
      - run: echo "Checking \${{ github.event.pull_request.title }}"
      - run: npm ci && npm test
`;

/** Boss, patched. The SHA is an example: copy the real one from the action's release page. */
const bossFixed = `name: PR helper
on:
  pull_request:
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: example-org/size-check@0123456789abcdef0123456789abcdef01234567 # v3.1.0 (example SHA)
      - run: echo "Checking $TITLE"
        env:
          TITLE: \${{ github.event.pull_request.title }}
      - run: npm ci && npm test
`;

/** Boss, last room: the patched helper now labels the PR. With only contents: read, the label is refused. */
const bossLabel = `name: PR helper
on:
  pull_request:
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - run: npm ci && npm test
      - run: gh pr edit "$PR" --add-label tested
        env:
          GH_TOKEN: \${{ github.token }}
          PR: \${{ github.event.pull_request.number }}
`;

export const c4: ConveyorScenario[] = [
  {
    // L04 fix task: lines 5–6. Least privilege: contents: write (not write-all).
    id: 'c4-release-perms',
    file: '.github/workflows/release.yml',
    workflow: releaseReadOnly,
    tag: 'v1.4.0',
    fix: { from: 5, to: 6 },
    events: ['tag'],
    expect: { tag: 'failure' },
  },
  {
    // L05: your own PR deploys a preview; a fork PR gets no secrets, so it stops safely.
    id: 'c4-pr-preview',
    file: '.github/workflows/preview.yml',
    workflow: previewPr,
    secrets: ['CLOUDFLARE_API_TOKEN'],
    events: ['pr', 'fork-pr'],
    expect: { pr: 'success', 'fork-pr': 'failure' },
  },
  {
    // L05: pull_request_target + the PR's code. A stranger's PR runs green, with your token.
    id: 'c4-prt-preview',
    file: '.github/workflows/preview.yml',
    workflow: previewPrTarget,
    secrets: ['CLOUDFLARE_API_TOKEN'],
    events: ['fork-pr'],
    holes: [{ line: 12, kind: 'prTargetCheckout', fix: 'on:\n  pull_request:' }],
    expect: { 'fork-pr': 'success' },
  },
  {
    // L07: the echo line prints the token; the log shows ***.
    id: 'c4-mask',
    file: '.github/workflows/deploy.yml',
    workflow: echoSecret,
    secrets: ['CLOUDFLARE_API_TOKEN'],
    events: ['push-main'],
    holes: [{ line: 13, kind: 'secretEcho', fix: '' }],
    expect: { 'push-main': 'success' },
  },
  {
    // Boss room 1: five holes on purpose (SpotTheHole). Valid YAML that GitHub would run.
    id: 'c4-boss',
    file: '.github/workflows/pr-helper.yml',
    workflow: bossVulnerable,
    fixed: bossFixed,
    holes: [
      { line: 4, kind: 'writeAll', fix: 'permissions:\n  contents: read' },
      { line: 7, kind: 'selfHosted', fix: '    runs-on: ubuntu-latest' },
      { line: 11, kind: 'prTargetCheckout', fix: 'on:\n  pull_request:' },
      { line: 12, kind: 'unpinned', fix: '      - uses: example-org/size-check@0123456789abcdef0123456789abcdef01234567 # v3.1.0 (example SHA)' },
      { line: 13, kind: 'injection', fix: '      - run: echo "Checking $TITLE"\n        env:\n          TITLE: ${{ github.event.pull_request.title }}' },
    ],
    actionlint: ['"github\\.event\\.pull_request\\.title" is potentially untrusted'],
    repo: { private: false },
  },
  {
    // Boss room 3: the patched helper labels the PR. Fix lines 4–5 with the one key it needs.
    id: 'c4-boss-label',
    file: '.github/workflows/pr-helper.yml',
    workflow: bossLabel,
    fix: { from: 4, to: 5 },
    events: ['pr'],
    expect: { pr: 'failure' },
  },
  {
    id: 'c4-vulnerable',
    file: '.github/workflows/triage.yml',
    workflow: vulnerable,
    fixed,
    holes: [
      { line: 6, kind: 'writeAll', fix: 'permissions:\n  contents: read' },
      { line: 9, kind: 'selfHosted', fix: '    runs-on: ubuntu-latest' },
      { line: 13, kind: 'prTargetCheckout', fix: 'on:\n  pull_request:' },
      { line: 14, kind: 'unpinned', fix: '      - uses: example-org/changed-files@0123456789abcdef0123456789abcdef01234567 # v2.0.0 (example SHA)' },
      { line: 15, kind: 'injection', fix: '      - run: echo "Thanks for $TITLE"\n        env:\n          TITLE: ${{ github.event.issue.title }}' },
      { line: 16, kind: 'secretEcho', fix: '' },
    ],
    actionlint: ['"github\\.event\\.issue\\.title" is potentially untrusted'],
    repo: { private: false },
  },
];
