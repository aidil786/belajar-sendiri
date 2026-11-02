# Deploying the site

The site is fully static. Astro builds it into the `dist/` folder and **Cloudflare Pages** serves that folder. There is no server code, no database, no login and no user data on a server (progress stays in the learner's own browser).

- **Live address:** https://belajarsendiri.pages.dev (the Pages project `belajarsendiri`).
- **Repo:** public. Deploys come only from the **`main`** branch, and only after every check passes.

**How it deploys:** GitHub Actions. Every push to `main` runs all the checks, then the `deploy` job:

1. makes sure the Pages project `belajarsendiri` exists (it creates it the first time) and that its address is exactly `belajarsendiri.pages.dev`,
2. runs `npm run deploy` (build, security headers, `wrangler pages deploy`),
3. checks that the live site answers and sends the security headers.

## One-time setup (the owner does this)

### 1. A Cloudflare API token that can do one thing only

1. Cloudflare dashboard → **My Profile → API Tokens → Create Token → Create Custom Token**.
2. Name: `belajarsendiri deploy`.
3. Permissions: **Account → Cloudflare Pages → Edit**. Nothing else.
4. Account Resources: **Include → your account** (only that one).
5. TTL: give it an end date (for example one year) and make a new one before then.
6. Create, and copy the token once. Never paste it in an issue, a chat or a file.

Your **Account ID** is on the Workers & Pages overview page (right side). It is not a secret, but keep it in the environment below anyway.

### 2. A protected GitHub environment for the secrets

1. GitHub repo → **Settings → Environments → New environment** → name it `production`.
2. **Deployment branches and tags → Selected branches and tags → Add rule → `main`.** Only `main` can use these secrets.
3. **Environment secrets → Add secret:** `CLOUDFLARE_API_TOKEN` (the token) and `CLOUDFLARE_ACCOUNT_ID`.
4. Do not put them in repository secrets as well.

Pull requests (also from forks) run all the checks but never deploy and never see these secrets.

### 3. Keep the repo safe (Settings, one click each)

- **Settings → Code security:** turn on **Private vulnerability reporting**, **Dependabot alerts**, **Dependabot security updates**, **Secret scanning** and **Push protection**, and **Code scanning → CodeQL → Default setup**.
- **Settings → Actions → General:**
  - **Fork pull request workflows from outside collaborators → Require approval for all external contributors.**
  - **Workflow permissions → Read repository contents and packages permissions**, and leave "Allow GitHub Actions to create and approve pull requests" **off**.
- **Settings → Rules → Rulesets → New branch ruleset** for `main`: **Restrict deletions** and **Block force pushes**.
- **Settings → General:** under Features you can turn off **Wikis** if you don't use them.
- Your accounts: turn on **two-factor authentication** for GitHub and for Cloudflare.

## The settings (copy these)

| Setting | Value |
|---|---|
| Pages project name | `belajarsendiri` (must match `name` in `wrangler.jsonc`; it is also the address) |
| Production branch | `main` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node.js version | from `.node-version` (24) |

The config lives in `wrangler.jsonc`:

- `pages_build_output_dir: ./dist` is where Astro puts the site.
- Pages serves `/en/` from `/en/index.html` and redirects `/en` to `/en/`.
- Unknown paths get the friendly bilingual `dist/404.html` with a 404 status.

A `*.pages.dev` name can't be renamed. To get a different one, change `name` in `wrangler.jsonc` and `PROJECT` in `scripts/cloudflare-pages.sh`, deploy, then delete the old project in the dashboard. If a name is taken on pages.dev, Cloudflare adds random letters; the deploy stops in that case instead of publishing on that address.

## Security headers

`public/_headers` sends these on every page (`scripts/csp-headers.mjs` finishes them after each build):

- **Content-Security-Policy:** scripts only from this site, plus the few inline scripts the build writes, each allowed by its SHA-256 hash. The only other host the browser may call is `api.github.com` (mission checks read public data, no login). No frames, no plugins, nobody may put the site in a frame.
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (no camera, microphone, location, payment, USB), `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy: same-origin`, and HSTS.

`tests/e2e/security.spec.ts` loads pages with exactly these headers and fails on any policy violation. The build fails if a page gets an inline event handler (`onclick="…"`) or a `javascript:` link, which the policy could not allow.

## Optional settings (build variables)

Add these as repo **variables** (Settings → Secrets and variables → Actions → Variables). They only affect the build.

| Variable | What it does |
|---|---|
| `SITE_URL` | Your own domain, if you add one. Default: `https://belajarsendiri.pages.dev`. Used for canonical and language links. |
| `PUBLIC_CF_ANALYTICS_TOKEN` | Turns on **Cloudflare Web Analytics** (privacy-friendly, no cookies). The build then allows its script in the security policy. Without it, no analytics script is added. |

## Add a custom domain (optional, costs money)

A name must be bought first (for example from Cloudflare Registrar). The `pages.dev` address stays free.

1. Cloudflare dashboard → **Workers & Pages** → `belajarsendiri` → **Custom domains** → **Set up a domain**.
2. Type the domain and confirm. Cloudflare makes the DNS record and the certificate.
3. Set `SITE_URL` to that address (see above) and redeploy.

## Deploy from your own computer (manual way)

Only if GitHub Actions can't run. You log in to Cloudflare in your own browser; no token is needed.

```bash
npm ci
```

```bash
npx wrangler login
```

```bash
npm run deploy
```

To check the config and the build without deploying (no login needed):

```bash
npm run deploy:dry
```

## Offline support (nothing to set up)

The site works offline after the first visit (a small service worker, `public/sw.js`). Each build stamps a new version into it, so learners get fresh pages after every deploy. In **Settings**, learners can tap "Save all lessons for offline use".

## Checks

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and pull request: lint, typecheck, unit tests, readability, card ids, the MDX check, the real-Git truth check, the build, Playwright + axe + the security-header test (6 parts), and actionlint on the lesson workflows. Heavier jobs check the simulators against the real tools: Docker, a kind Kubernetes cluster, Debian 13, OpenTofu and promtool. On a pull request nothing deploys. GitHub-hosted runners are free for public repos.

## Undo a bad deploy

Cloudflare dashboard → **Workers & Pages** → `belajarsendiri` → **Deployments**. Pick an older production deployment → **Rollback to this deployment**. This changes nothing in Git.
