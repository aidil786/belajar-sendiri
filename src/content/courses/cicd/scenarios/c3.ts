// C3 Release & Deploy: conveyor scenarios (shape: ConveyorScenario in src/engine/conveyor-sim/scenario.ts).
import type { ConveyorScenario } from '~/engine/conveyor-sim';

/** Tag → canary (smoke test) → production after a review; a failed canary runs the rollback job. */
const canaryRelease = `name: Release
on:
  push:
    tags: ['v*']
  workflow_dispatch:
permissions:
  contents: read
jobs:
  canary:
    runs-on: ubuntu-latest
    environment: canary
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npm run deploy -- --env canary
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
      - run: curl --fail --silent https://canary.example.com/health
  production:
    needs: canary
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://shop.example.com
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npm run deploy
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
  rollback:
    needs: canary
    if: failure()
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npm run rollback
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
`;

const environments = {
  canary: { secrets: ['CLOUDFLARE_API_TOKEN'] },
  production: { reviewers: ['aina'], secrets: ['CLOUDFLARE_API_TOKEN'] },
};

// ---------- C3 lessons (cicd-c3-l01 … l11, boss, mission 3) ----------
// Workflows a YamlBuilder card builds are registered here too ("shown in …"), so
// `npm run verify:workflows` checks them with actionlint like every other workflow.

/** l03 hook: every push to main goes live. Nobody looks. */
const noGate = `name: Deploy
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
      - run: npm ci
      - run: npm test
  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npm run deploy
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
`;

/** l03: the same pipeline behind a production environment (reviewer + main only). Runs on every branch. */
const reviewers = `name: Deploy
on: push
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npm test
  deploy:
    needs: test
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://shop.example.com
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npm run deploy
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
`;

/** l03 YamlBuilder: a deploy job that names its environment. */
const envGate = `name: Deploy
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://shop.example.com
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npm run deploy
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
`;

/** l04 YamlBuilder: release-please keeps a release PR (version + changelog) up to date. */
const releasePlease = `name: Release Please
on:
  push:
    branches: [main]
jobs:
  release-please:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          release-type: node
`;

/** l05: a preview of every pull request (Cloudflare Worker Previews). */
const preview = `name: Preview
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
      - run: npx wrangler preview --name "pr-$PR"
        env:
          PR: \${{ github.event.pull_request.number }}
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
`;

/** l06: the shape of this site's own .github/workflows/ci.yml (check, then deploy from main only). */
const thisSite = `name: CI
on:
  push:
  pull_request:
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npm test
  deploy:
    needs: check
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    concurrency:
      group: deploy-production
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npm run deploy
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
`;

/** l07: the token lives only in the production environment, but the job never names it. Fix line 9. */
const envSecret = `name: Deploy
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
      - run: npm run deploy
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
`;

/** l08 YamlBuilder: OIDC to a cloud (AWS): no stored keys, a short-lived role instead. */
const oidc = `name: Deploy to AWS
on:
  push:
    branches: [main]
permissions:
  id-token: write
  contents: read
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v7
      - run: npm ci && npm run build
      - uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: arn:aws:iam::123456789012:role/shop-deploy
          aws-region: ap-southeast-5
      - run: aws s3 sync ./dist s3://kedai-kancil-shop
`;

/** l10 hook: the smoke test has no --fail, so an error page still counts as a pass. */
const smokeWeak = `name: Deploy
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
      - run: npm run deploy
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
      - run: curl --silent https://shop.example.com/health
`;

/** l10 YamlBuilder: deploy, smoke test, and a rollback job that only runs when something failed. */
const autoRollback = `name: Deploy
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
      - run: curl --fail --silent https://shop.example.com/health
  rollback:
    needs: deploy
    if: failure()
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npx wrangler rollback --message "Smoke test failed"
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
`;

/** l11: one quiet alert. Only a failed deploy opens an issue that links to the run. */
const notify = `name: Deploy
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
      - run: npm run deploy
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
      - run: curl --fail --silent https://shop.example.com/health
  notify:
    needs: deploy
    if: failure()
    runs-on: ubuntu-latest
    permissions:
      issues: write
    steps:
      - run: gh issue create --repo "$REPO" --title "Deploy failed" --body "$RUN_URL"
        env:
          GH_TOKEN: \${{ github.token }}
          REPO: \${{ github.repository }}
          RUN_URL: \${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}
`;

/** Boss: a tag sends the new version to 5% of users, then a smoke test checks /health. */
const bossCanary = `name: Canary
on:
  push:
    tags: ['v*']
permissions:
  contents: read
jobs:
  canary:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npm run deploy:canary
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
      - run: curl --fail --silent https://shop.example.com/health
`;

/** Boss: the rollback button (run by hand). The job forgot its environment. Fix line 9. */
const bossRollback = `name: Rollback
on:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  rollback:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npx wrangler rollback --message "Bad Friday"
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
      - run: curl --fail --silent https://shop.example.com/health
`;

/** Mission 3 (Kedai Kancil): canary on staging, production after a review, rollback if the canary fails. */
const mission = `name: Release
on:
  push:
    tags: ['v*']
permissions:
  contents: read
jobs:
  canary:
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npx wrangler deploy --env staging
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
      - run: curl --fail --silent "$STAGING_URL/health"
        env:
          STAGING_URL: \${{ vars.STAGING_URL }}
  production:
    needs: canary
    runs-on: ubuntu-latest
    environment:
      name: production
      url: \${{ vars.SITE_URL }}
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npx wrangler deploy --env production
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
  rollback:
    needs: canary
    if: failure()
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npx wrangler rollback --env staging --message "Canary failed"
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
`;

const shopRepo = { owner: 'you', name: 'shop' };
const kedaiRepo = { owner: 'you', name: 'kedai-kancil' };
const prodOnly = { production: { secrets: ['CLOUDFLARE_API_TOKEN'] } };
const missionWorld = {
  repo: kedaiRepo,
  environments: {
    staging: { secrets: ['CLOUDFLARE_API_TOKEN'] },
    production: { reviewers: ['you'], secrets: ['CLOUDFLARE_API_TOKEN'] },
  },
  vars: { STAGING_URL: 'https://kedai-kancil-staging.you.workers.dev', SITE_URL: 'https://kedai-kancil-production.you.workers.dev' },
};

export const c3: ConveyorScenario[] = [
  {
    // A good release: the canary passes, then production waits for Aina's approval.
    id: 'c3-release',
    workflow: canaryRelease,
    file: '.github/workflows/release.yml',
    tag: 'v1.3.0',
    environments,
    events: ['tag', 'dispatch'],
    traffic: { mode: 'canary', newErrorRate: 0.002, steps: [5, 25, 50, 100] },
    expect: { tag: 'waiting', dispatch: 'waiting' },
  },
  {
    // A bad release: the canary's smoke test gets errors, production is skipped, rollback runs.
    id: 'c3-canary',
    workflow: canaryRelease,
    file: '.github/workflows/release.yml',
    tag: 'v1.3.1',
    environments,
    fail: { smoke: true },
    events: ['tag', 'dispatch'],
    traffic: { mode: 'canary', newErrorRate: 0.08, steps: [5, 25, 50, 100] },
    expect: { tag: 'failure', dispatch: 'failure' },
  },
  // ---------- C3 lessons ----------
  {
    // l03 hook: a push to main deploys at once, with nobody checking.
    id: 'c3-no-gate',
    workflow: noGate,
    file: '.github/workflows/deploy.yml',
    repo: shopRepo,
    secrets: ['CLOUDFLARE_API_TOKEN'],
    events: ['push-main'],
    expect: { 'push-main': 'success' },
  },
  {
    // l03: production needs Aina's approval, and only main may deploy there.
    id: 'c3-reviewers',
    workflow: reviewers,
    file: '.github/workflows/deploy.yml',
    repo: shopRepo,
    environments: { production: { reviewers: ['aina'], branches: ['main'], secrets: ['CLOUDFLARE_API_TOKEN'] } },
    events: ['push-main', 'push-branch'],
    expect: { 'push-main': 'waiting', 'push-branch': 'failure' },
  },
  {
    // l03 check: the reviewer always says yes here, so only the branch rule can stop the deploy.
    id: 'c3-branch-rule',
    workflow: reviewers,
    file: '.github/workflows/deploy.yml',
    repo: shopRepo,
    environments: { production: { reviewers: ['aina'], branches: ['main'], secrets: ['CLOUDFLARE_API_TOKEN'], approve: true } },
    events: ['push-main', 'push-branch'],
    expect: { 'push-main': 'success', 'push-branch': 'failure' },
  },
  {
    // l03 YamlBuilder (shown in cicd-c3-l03).
    id: 'c3-env-gate',
    workflow: envGate,
    file: '.github/workflows/deploy.yml',
    repo: shopRepo,
    environments: { production: { reviewers: ['aina'], branches: ['main'], secrets: ['CLOUDFLARE_API_TOKEN'] } },
    events: ['push-main'],
    expect: { 'push-main': 'waiting' },
  },
  {
    // l04 YamlBuilder (shown in cicd-c3-l04). The simulator only pretends release-please runs.
    id: 'c3-release-please',
    workflow: releasePlease,
    file: '.github/workflows/release-please.yml',
    repo: shopRepo,
    events: ['push-main'],
    expect: { 'push-main': 'success' },
  },
  {
    // l05: every pull request gets its own preview. A fork's pull request gets no secrets.
    id: 'c3-preview',
    workflow: preview,
    file: '.github/workflows/preview.yml',
    repo: shopRepo,
    secrets: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'],
    events: ['pr', 'fork-pr'],
    expect: { pr: 'success', 'fork-pr': 'failure' },
  },
  {
    // l06: this site's pipeline. Pull requests check; only a push to main deploys.
    id: 'c3-this-site',
    workflow: thisSite,
    repo: { owner: 'you', name: 'fahamlah' },
    secrets: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'],
    events: ['push-main', 'pr', 'push-branch'],
    expect: { 'push-main': 'success', pr: 'success', 'push-branch': 'success' },
  },
  {
    // l07: the deploy job must name its environment to get the environment's secret.
    id: 'c3-env-secret',
    workflow: envSecret,
    file: '.github/workflows/deploy.yml',
    repo: shopRepo,
    environments: { staging: { secrets: ['CLOUDFLARE_API_TOKEN'] }, production: { secrets: ['CLOUDFLARE_API_TOKEN'] } },
    events: ['push-main'],
    fix: { from: 9, to: 9 },
    expect: { 'push-main': 'failure' },
  },
  {
    // l08 YamlBuilder (shown in cicd-c3-l08). The simulator only pretends the AWS steps run.
    id: 'c3-oidc',
    workflow: oidc,
    file: '.github/workflows/deploy-aws.yml',
    repo: shopRepo,
    events: ['push-main'],
    expect: { 'push-main': 'success' },
  },
  {
    // l10 hook: the site is broken, but curl without --fail still passes.
    id: 'c3-smoke-weak',
    workflow: smokeWeak,
    file: '.github/workflows/deploy.yml',
    repo: shopRepo,
    secrets: ['CLOUDFLARE_API_TOKEN'],
    fail: { smoke: true },
    events: ['push-main'],
    expect: { 'push-main': 'success' },
  },
  {
    // l10 YamlBuilder (shown in cicd-c3-l10): the smoke test fails, the rollback job runs.
    id: 'c3-auto-rollback',
    workflow: autoRollback,
    file: '.github/workflows/deploy.yml',
    repo: shopRepo,
    environments: prodOnly,
    fail: { smoke: true },
    events: ['push-main'],
    expect: { 'push-main': 'failure' },
  },
  {
    // l11: a failed deploy opens one issue with a link to the run.
    id: 'c3-notify',
    workflow: notify,
    file: '.github/workflows/deploy.yml',
    repo: shopRepo,
    secrets: ['CLOUDFLARE_API_TOKEN'],
    fail: { smoke: true },
    events: ['push-main'],
    expect: { 'push-main': 'failure' },
  },
  {
    // Boss: v2.3.0 reaches 5% of users; /health still says ok (the bug is in checkout).
    id: 'c3-boss-canary',
    workflow: bossCanary,
    file: '.github/workflows/canary.yml',
    repo: shopRepo,
    tag: 'v2.3.0',
    environments: prodOnly,
    events: ['tag'],
    traffic: { mode: 'canary', newErrorRate: 0.08, steps: [5, 25, 50, 100] },
    expect: { tag: 'success' },
  },
  {
    // Boss: the rollback workflow can't read production's token until the job names the environment.
    id: 'c3-boss-rollback',
    workflow: bossRollback,
    file: '.github/workflows/rollback.yml',
    repo: shopRepo,
    environments: prodOnly,
    events: ['dispatch'],
    fix: { from: 8, to: 8 },
    expect: { dispatch: 'failure' },
  },
  {
    // Mission 3: a good tag. The canary passes; production waits for your approval.
    id: 'c3-mission',
    workflow: mission,
    file: '.github/workflows/release.yml',
    tag: 'v1.0.0',
    ...missionWorld,
    events: ['tag'],
    expect: { tag: 'waiting' },
  },
  {
    // Mission 3: the deliberate bad release. The canary's smoke test fails and the pipeline rolls staging back.
    id: 'c3-mission-bad',
    workflow: mission,
    file: '.github/workflows/release.yml',
    tag: 'v1.0.1',
    ...missionWorld,
    fail: { smoke: true },
    events: ['tag'],
    expect: { tag: 'failure' },
  },
];
