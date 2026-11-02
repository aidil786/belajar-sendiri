# FahamLah Level Up — plan (2026-11-01)

The user asked (2026-11-01) to push learners from "solid working level" towards "advanced" in what we teach, with four additions, all of them:

1. **Harder night shift drills** (incidents), some with no hints.
2. **A CKA pack**: running a cluster yourself.
3. **Four short courses**: Linux & Networking, Terraform & OpenTofu, Monitoring & Observability, Cloud with AWS.
4. **Exam-style practice** for KCNA and CKAD.

**Status (2026-11-02): built.** Linux (L1–L4 + M7), Terraform & OpenTofu (T1–T4 + M8), Monitoring & Observability (O1–O4 + M9), Cloud with AWS (A1–A4 + M10): 139 lessons, 16 bosses, 22 rescue flows. The CKA pack (K9, 12 lessons + boss, node shell recorded on real kind). 38 night shift drills in three levels. A KCNA mock (176 questions) and 34 CKAD tasks. Truth checks: Debian 13, OpenTofu 1.13.5, promtool 3.13.5, kind. All Malay lessons keep `bmReviewed: false`.

Every rule in `CLAUDE.md`, `docs/PLAN.md` and `docs/SHIP-IT-PLAN.md` (§3: one story, state after every command, safe by default, YAML/HCL ≤ ~15 lines per card, real error first) applies unchanged. Facts and versions below are a starting point: **check each one on the official docs before you write it** (the date is 2026-11-01), and say less when unsure.

## 1. Fixed decisions

### A new family: Level Up (BM: Naik Tahap)

- Family id `level-up`, overview `/<lang>/level-up/`, one shared Rescue Center `/<lang>/level-up/rescue/` (like `ship-it`).
- Four courses, each with its own map, glossary, cheat sheet and command pages:

| Part | Course id | EN title | BM title | Story place | Kancil wears | `tool` / `toolVersion` |
|---|---|---|---|---|---|---|
| 1 | `linux` | Linux & Networking | Linux & Rangkaian | the shophouse (*rumah kedai*): rooms, keys, staff, phone lines | a tool belt | `linux` / `"debian-13"` |
| 2 | `iac` | Terraform & OpenTofu | Terraform & OpenTofu | the architect's blueprint (*pelan arkitek*): plan first, then build | a pencil behind the ear | `opentofu` / `"1.13"` (Terraform 1.17 noted, checked 2026-11-01) |
| 3 | `observability` | Monitoring & Observability | Pemantauan & Observability | the control room (*bilik kawalan*): counters, diary, following one order | a headset | `prometheus` / `"3"` |
| 4 | `aws` | Cloud with AWS | Cloud dengan AWS | renting a unit in a big mall: units, keys, the monthly bill | a staff lanyard | `aws` / `"2026-11"` |

- "Best after" hints (never locks): `linux` none (good first step, also before Ship It); `iac` after Git W4 and C1; `observability` after K5; `aws` after L3 and D4.
- Linux is also linked from Docker D0 ("want more Linux? → Level Up L1").

### Ids and folders

- Lessons `linux-l1-l03`, `iac-t2-l05`, `obs-o3-l02`, `aws-a4-l01`; bosses `linux-l1-boss`. World codes `L1–L4`, `T1–T4`, `O1–O4`, `A1–A4` (world ids 1–4).
- Folders `src/content/courses/<course>/<world dir>/NN-<slug>/{en,ms}.mdx`, boss in `boss/`.
- Capstone missions continue the numbering: **M7** Linux (a server from scratch), **M8** IaC (blueprint Kedai Kancil), **M9** Observability (watch Kedai Kancil), **M10** AWS (Kedai Kancil in the cloud, budget alarm first). The lesson schema's `mission` max becomes 10.
- CKA pack = Kubernetes world **9**, code `K9`, folder `k9-cluster-admin`, lessons `k8s-k9-l01…`, boss `k8s-k9-boss`. Optional: the map says "extra pack". Career Quest (K8) stays the finale.

### Colours and look

Use the existing tokens. Each new course gets a course accent token (`--course-linux`, `--course-iac`, `--course-observability`, `--course-aws`, with white text passing AA). Concept colours keep their meanings. No vendor logos (no Tux, no AWS smile, no Terraform/Prometheus/Grafana marks); draw simple own icons.

## 2. Outlines (titles may be polished; ids, slugs and order are fixed once course.yaml lands)

### Linux & Networking (`linux`)

- **L1 The Shophouse — shell and files** (9 + boss): the terminal and the prompt; paths: where am I (`pwd`, `cd`, `ls`); reading files (`cat`, `less`, `head`, `tail`); make, copy, move (`mkdir`, `cp`, `mv`); delete with care (`rm`, `-r`, no undo); find things (`find`); search inside (`grep`); pipes and redirects; wildcards and tab completion. Boss: tidy a messy kitchen folder.
- **L2 Keys & Staff — users, permissions, processes** (10 + boss): users, groups and `sudo`; read `rwx`; `chmod` (letters and numbers); `chown`; processes (`ps`, `top`); signals and `kill`; jobs: `&`, `fg`, `bg`; environment variables and `PATH`; services with `systemctl`; logs with `journalctl`; packages with `apt`. Boss: a service that won't start.
- **L3 Phone Lines — networking** (10 + boss): IP addresses; subnets and CIDR; ports and listening (`ss -tlnp`); localhost vs 0.0.0.0; DNS (`dig`, `/etc/hosts`); HTTP with `curl -v` (methods, status codes, headers); HTTPS and certificates (`openssl s_client`, expiry); firewalls (`ufw` / nftables idea); `ping` and `traceroute`; "can't connect" ladder. Boss: why can't the customer reach the shop?
- **L4 Remote Kitchens — SSH, servers, scripts** (9 + boss + M7): SSH keys; `~/.ssh/config`; copy files (`scp`, `rsync`); disk space (`df`, `du`); scheduled jobs (`cron`, systemd timers); bash scripts: variables, `if`, loops, exit codes; `set -euo pipefail`; a small web server with nginx; **M7: a server from scratch** (a VM or a free playground: user, SSH key, firewall, nginx, a script, a timer). Boss: fix the nightly backup script.

### Terraform & OpenTofu (`iac`)

- **T1 Blueprints — why and the loop** (8 + boss): clicking vs writing it down; HCL blocks; providers and `init`; `plan`: read `+ ~ - -/+`; `apply` and `destroy` (danger badge); state: the building's register; `fmt` and `validate`; Terraform vs OpenTofu (same language, license story, `tofu` vs `terraform`). Boss: build and tear down a small "food court" of local files and random names.
- **T2 Inputs & Outputs** (8 + boss): variables and types; `tfvars` files; outputs; locals; `count`; `for_each`; data sources; expressions and functions (`format`, `join`, conditionals).
- **T3 State & Teams** (8 + boss): remote state backends; locking; drift: someone clicked; `import` blocks; `moved` blocks and refactors; `state list/show/rm` (careful); sensitive values and secrets in state; workspaces vs folders per environment.
- **T4 Modules & Pipelines** (8 + boss + M8): modules (local); module sources and version pins; provider and lock file pins (`.terraform.lock.hcl`); plan on every PR (GitHub Actions); policy checks (OPA/Conftest idea) and cost checks; secrets and OIDC; when not to use IaC; **M8: blueprint Kedai Kancil** (OpenTofu with the Docker provider on your machine, or kind; plan in CI).

### Monitoring & Observability (`observability`)

- **O1 The Control Room** (8 + boss): why watch; metrics, logs, traces; the four golden signals; RED and USE; SLIs, SLOs and error budgets; dashboards vs alerts; on-call kindly; Prometheus, Grafana, OpenTelemetry: who does what.
- **O2 Counters — Prometheus and PromQL** (9 + boss): scraping and targets; exporters (node, blackbox); metric types (counter, gauge, histogram, summary); labels and cardinality; instant vs range vectors; `rate()` and `increase()`; `sum by`; histograms and `histogram_quantile`; recording rules.
- **O3 Alarms & Screens — alerts and dashboards** (8 + boss): alert rules (`for`, labels, annotations); Alertmanager routing, grouping, silences; alert on symptoms not causes; Grafana dashboards and panels; variables and templating; SLO burn-rate alerts; runbooks; alert fatigue.
- **O4 The Diary & One Order — logs and traces** (8 + boss + M9): structured logs; Loki and LogQL basics; OpenTelemetry: SDK, collector, OTLP; traces and spans; following one order across services; exemplars and correlation; incidents and blameless postmortems; **M9: watch Kedai Kancil** (Compose stack: Prometheus, Grafana, node-exporter, one alert, one dashboard).

### Cloud with AWS (`aws`)

- **A1 Renting a Unit — cloud basics and safety first** (8 + boss): what "cloud" means; regions and Availability Zones (Malaysia: `ap-southeast-5`, opt-in); the shared responsibility model; account safety: root user, MFA, never use root; **budgets and billing alarms before anything else**; IAM Identity Center vs IAM users; the AWS CLI and profiles; free tier traps and clean-up.
- **A2 Keys & Guards — IAM** (8 + boss): users, groups, roles; policies (JSON); how AWS decides: explicit deny > allow > implicit deny; least privilege; roles for services; access keys (avoid; rotate); OIDC from GitHub Actions (link C3); permission boundaries and SCPs (idea).
- **A3 The Mall's Roads — network, servers, storage** (8 + boss): VPC; subnets and CIDR (public vs private); internet and NAT gateways; security groups vs NACLs; EC2 basics; load balancers; S3 buckets and Block Public Access; Route 53 and CloudFront (idea).
- **A4 Containers in the Cloud** (8 + boss + M10): ECR; ECS and Fargate; EKS (managed Kubernetes, link K-worlds); RDS; secrets (Secrets Manager / Parameter Store); deploy from GitHub Actions with OIDC; costs: what eats money; **M10: Kedai Kancil in the cloud** (budget alarm first, smallest sizes, delete everything after; the lesson shows the clean-up list).

### CKA pack (`kubernetes`, world K9)

**K9 Cluster Admin** (12 + boss): what CKA adds to CKAD; kubeadm: how a cluster is born (init, join); static pods and `/etc/kubernetes/manifests`; the kubelet: `systemctl` and `journalctl`; `crictl`: containers under the kubelet; node NotReady: a troubleshooting ladder; cordon, drain, uncordon (recap, admin view); cluster upgrades with kubeadm (plan, apply, one minor at a time); etcd backup and restore (`etcdctl snapshot`); certificates and their expiry (`kubeadm certs check-expiration`); users: CSR, certificates and kubeconfig; CoreDNS and kube-proxy troubleshooting. Boss: a broken node and a lost Deployment, restored from an etcd snapshot. Real reps on kind and free playgrounds (Killercoda CKA playgrounds); outputs shown come from a real kind node (captured in CI) or the official docs.

## 3. Harder night shift drills (incidents)

Extend `src/content/courses/nightshift.ts` and the drill page:

- **Levels**: ★ one fault, hints open; ★★ one fault, hints folded; ★★★ an **incident**: two or three faults at once, no hints (the Rescue Center link stays), then a short **"what was the root cause?"** question.
- **+25 drills** (36 in total): Docker 8, CI/CD 6, Kubernetes 11 (3 of them node problems from K9). Every drill: a real-looking alert first ("CrashLoopBackOff on shop"), then the simulator.
- The weekly pick rotates through levels; the list is grouped by level; nothing is locked. Exam mode still adds the timer.

## 4. Exam-style practice (`/<lang>/ship-it/exam/`)

- **KCNA mock**: an original question bank (≥ 150 questions, EN + MS, each with a one-line why and a link to the lesson), tagged by the current official KCNA domains (check the official Linux Foundation page; 2026 guides list four domains: Kubernetes Fundamentals, Container Orchestration, Cloud Native Application Delivery, Cloud Native Architecture). A mock = 60 random questions; optional 90-minute timer (exam mode); a score per domain; review mistakes with links to lessons. Never copy real exam questions; say clearly "practice, not the real exam".
- **CKAD practice**: ≥ 24 original hands-on tasks in FoodCourtSim (goals checked by the engine), tagged by the five official CKAD domains (check the official CNCF page; 2026 guides list: Application Design and Build, Application Deployment, Application Observability and Maintenance, Application Environment, Configuration and Security, Services and Networking). A set = 15 random tasks; optional 2-hour timer; docs-only rule card (kubernetes.io/docs); score per domain.
- The certification map links both pages and gains: CKA → K9; LFCS → Linux; Prometheus Certified Associate → Observability; HashiCorp Terraform Associate → IaC (OpenTofu has no official exam); AWS Certified Cloud Practitioner and Solutions Architect – Associate → AWS. Check formats and prices on the official pages; prices change.

## 5. Practice engines and truth checks

Each new simulator is pure TypeScript (no DOM), Vitest-tested, and checked against the real tool, like the Git, Docker and Kubernetes engines.

| Engine | Interactive | Truth check | Real tool |
|---|---|---|---|
| `src/engine/linux-sim` (a Debian-like machine: files, users, permissions, processes, a few services, a small network) | `LinuxSim` (terminal + state picture: folder tree, who owns what, running services) | `npm run verify:linux`: scenario command lists run in a real `debian:13` container (Docker) and must match | Debian 13 |
| `src/engine/tofu-sim` (HCL subset; providers `random`, `local`, `terraform_data`/`null`; state; plan/apply/destroy; variables, outputs, locals, count, for_each, local modules, moved/import blocks, drift) | `TofuSim` (files + terminal + "blueprint vs built" picture), `PlanReader` game | `npm run verify:tofu`: real OpenTofu (the pinned official container image) runs the same steps; plans and outputs must match | OpenTofu 1.13 |
| `src/engine/promql-sim` (series store, PromQL subset: selectors, matchers, range vectors, rate/increase/irate, sum/avg/max/min/count by/without, binary ops, comparison, histogram_quantile; alert rule evaluation with `for`) | `PromQLPlayground` (query box + table + small graph), `AlertRuleBuilder` | `npm run verify:promql`: `promtool test rules` (official Prometheus image) evaluates the same expressions on the same series | Prometheus 3 (LTS 3.13) |
| AWS has no simulator (no free sandbox to check against). Pure-logic games instead: `IamJudge` (policy evaluation, from the documented logic), `SubnetPlanner` (CIDR maths), `SecurityGroupGate` (which traffic gets in) | — | unit tests built from the official docs' worked examples | AWS docs |
| `foodcourt-sim` node shell for K9 (`ssh <node>`, `systemctl status/restart kubelet`, `journalctl -u kubelet`, `crictl ps`, static pod manifests, `kubeadm certs check-expiration`, `etcdctl snapshot save/status`) | `FoodCourtSim` (existing) | outputs captured once from a real kind node in CI (`.github/workflows/capture-cka.yml`, manual) and kept as fixtures; truth lists where kind allows | Kubernetes 1.37 (kind) |

CI: `linux-truth`, `tofu-truth` and `promql-truth` jobs (Docker on the runner), run like `docker-truth` (main, pull requests, by hand), and the deploy waits for them.

## 6. Safety (these courses touch real servers and real money)

- Throwaway machines only: a VM, a container or a free playground; never your work server.
- Cloud: **set a budget alarm before the first resource**, never use the root user, smallest sizes, a clean-up list at the end of every AWS lesson that creates something, and a reminder that free tier rules change (check the AWS page).
- Terraform/OpenTofu: `plan` before `apply`; `destroy` carries the danger badge; never commit state or `.tfvars` with secrets.
- Linux: `rm -r` and `sudo` carry danger badges; never `curl … | sudo bash`.
- Test keys and test accounts only; never paste real secrets.

## 7. Waves

1. **Wave A (foundations, in parallel):** platform (family, overview, rescue, schema, course outlines, certification map, exam runners, drill levels), linux-sim, tofu-sim, promql-sim, AWS games, K9 node shell + capture workflow.
2. **Wave B (content, in parallel):** Linux L1–L4, IaC T1–T4, Observability O1–O4, AWS A1–A4, K9, KCNA bank + CKAD tasks, +25 drills, Level Up rescue flows (about 5 per course).
3. **Wave C:** full checks (all truth checks incl. the new ones), WebKit spot check, one deploy, live check.

Budget note: the repo is private, so GitHub Actions minutes are limited (2,000 a month on the free plan; one full run ≈ 300+ minutes). Test locally; deploy once at the end.
