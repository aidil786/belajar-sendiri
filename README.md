# Belajar Sendiri

An ADHD-friendly, bilingual (English + Bahasa Melayu) learning site. Course 1 is **Git & GitHub**; course 2 is **Ship It** (Docker → CI/CD → Kubernetes); course 3 is **Level Up** (Linux, Terraform & OpenTofu, Monitoring, AWS). Short lessons, safe practice simulators, and real missions. *Belajar sendiri* = learn on your own.

- Built with [Astro](https://astro.build) (static), React islands, MDX lessons, and pure TypeScript simulators.
- **Live, free, no sign-up:** https://belajarsendiri.pages.dev (Cloudflare Pages). See [DEPLOY.md](DEPLOY.md).
- The full plan is in [docs/PLAN.md](docs/PLAN.md). How to write lessons: [docs/AUTHORING.md](docs/AUTHORING.md).

## What's inside

- All 13 worlds of the Git & GitHub course: 139 lessons and 12 boss challenges, in English and Malay.
- A practice terminal whose Git engine is checked against real Git (commit ids are real SHA-1s).
- Glossary, cheat sheet, command pages, Rescue Center (15 "oh no" flows), daily review cards, offline mode.
- **Ship It** (`/en/ship-it/`): 19 worlds and 206 lessons in three parts, in English and Malay.
  - Part 1 *Dapur* (Docker, D0–D6), Part 2 *Kilang* (CI/CD with GitHub Actions, C1–C4), Part 3 *Medan Selera* (Kubernetes 1.37, K1–K7) and Career Quest.
  - 19 boss challenges, 6 capstone missions on the learner's own repo, 30 Rescue Center flows.
  - Three simulators (a Docker kitchen, a CI conveyor belt, a Kubernetes food court). CI checks their outputs against real Docker 29 and a real kind cluster.
- Every Malay lesson has `bmReviewed: false` until a native speaker checks it.
- Ship It night shift (`/en/ship-it/night-shift/`): optional 5-minute fix-it drills in the Docker, CI/CD and Kubernetes simulators, a new one each week.
- Ship It exam mode (Settings, off by default): night shift drills get a count-up timer and a docs-only rule card.
- Ship It certification map (`/en/ship-it/certifications/`): KCNA, CKAD, GH-200, CKA, CKS and the Level Up exams, the worlds that help, and your progress.
- Exam practice (`/en/ship-it/exam/`): a KCNA mock from 176 original questions, and 34 CKAD hands-on tasks in the Kubernetes simulator.
- Night shift has 38 drills in three levels (★ one fault, ★★ hints folded, ★★★ incidents with a root-cause question).
- **Level Up** (`/en/level-up/`): four short courses, 16 worlds and 139 lessons (16 bosses, missions M7–M10), in English and Malay.
  - Linux & Networking (L1–L4), Terraform & OpenTofu (T1–T4), Monitoring & Observability (O1–O4), Cloud with AWS (A1–A4); 22 Rescue Center flows.
  - Simulators checked against the real tools: a Linux server (Debian 13), OpenTofu 1.13, PromQL (promtool 3.13). AWS practice is safe games in the browser; optional real reps on your own account start with a budget alarm.
- **CKA pack**: Kubernetes world K9 "Cluster Admin" (12 lessons + boss) with a node shell whose outputs were recorded on a real kind cluster.

## Run it locally

Needs Node.js 24 (see `.node-version`).

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:4321/.

## Checks

| Command | What it checks |
|---|---|
| `npm test` | Git engine, i18n files, lesson scenarios (Vitest) |
| `npm run lint` / `npm run typecheck` | ESLint / Astro + TypeScript |
| `npm run check:readability` | Max 15 words per sentence, 40 per card |
| `npm run check:cards` | Card ids match between `en.mdx` and `ms.mdx` |
| `npm run check:mdx` | Lesson components, props, scenarios and demo commands |
| `npm run verify:commands` | Lesson commands give the same result in the engine and in real Git |
| `npm run verify:docker` | Docker lessons: the kitchen simulator vs a real Docker 29 daemon (needs Docker) |
| `npm run verify:k8s` | Kubernetes lessons: the food-court simulator vs a real kind cluster (engine-only without one; CI runs kind) |
| `npm run verify:workflows` | Lesson GitHub Actions workflows vs actionlint (needs Docker) |
| `npm run verify:manifests` | Lesson Kubernetes YAML vs kubeconform for 1.37 (needs Docker) |
| `npm run verify:linux` | Linux lessons: the server simulator vs a real Debian 13 container with systemd (needs Docker) |
| `npm run verify:tofu` | IaC lessons: the OpenTofu simulator vs the real OpenTofu 1.13 image (needs Docker) |
| `npm run verify:promql` | Observability lessons: the PromQL engine vs real promtool 3.13 (needs Docker) |
| `npm run test:e2e` | Playwright + axe (run `npm run build` first). `PW_BROWSER=webkit` or `firefox` tries other engines. |

## Folders

```text
src/content/courses/<c>/   git, docker, cicd, kubernetes, linux, iac, observability, aws: course.yaml, lessons (en.mdx + ms.mdx), scenarios, commands, rescue flows
src/content/glossary/      shared bilingual glossary
src/engine/                git-sim, kitchen-sim (Docker), conveyor-sim (Actions), foodcourt-sim (Kubernetes),
                           linux-sim, tofu-sim, promql-sim: no DOM, tested
src/components/            lesson frame, interactive cards, UI
src/i18n/                  all UI text (en.json, ms.json)
src/styles/tokens.css      every colour, space, radius and font
scripts/                   readability, card ids, MDX, and checks against real Git, Docker, Kubernetes,
                           Debian, OpenTofu and promtool
tests/e2e/                 Playwright + axe (and the security-header test)
```

## Feedback

Like it? Give the repo a ⭐. Rate the site and tell us what to fix with the [feedback form](https://github.com/aidil786/belajar-sendiri/issues/new?template=feedback.yml), or [report a problem](https://github.com/aidil786/belajar-sendiri/issues/new?template=problem.yml). The site's **Rate & feedback** page (`/en/feedback/`) links to the same forms. The site itself stores no feedback: it all lives here on GitHub.

## Contributing

Ideas, typo fixes and new lessons are welcome. Please open an issue first for big changes.
Read [docs/AUTHORING.md](docs/AUTHORING.md) (how lessons are built) and run the checks above before a pull request.
Malay lessons especially need native speakers: every lesson shows `bmReviewed: false` until someone checks it.

## Security

The site is static: no accounts, no server, no data leaves the learner's browser. Every page has a strict Content-Security-Policy.
Found a problem? Please report it privately; see [SECURITY.md](SECURITY.md).

## License

- **Code:** MIT ([LICENSE](LICENSE)).
- **Lessons and course content** (`src/content/`): CC BY-NC-SA 4.0 ([LICENSE-CONTENT](LICENSE-CONTENT)). Share and adapt them for free, with credit, under the same license. Not for sale.
- **Fonts:** SIL Open Font License 1.1 ([THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).

Not affiliated with GitHub, Docker, the Linux Foundation, the CNCF, HashiCorp, the OpenTofu project, Prometheus or AWS.
