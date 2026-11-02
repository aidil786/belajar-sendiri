# FahamLah Ship It — Course Plan: Docker, CI/CD & Kubernetes

Oct 31, 2026

## 1. The big picture

Make **Ship It** FahamLah's second course: one path from your first container to a self-healing app on Kubernetes, shipped by a pipeline. About 200 bite-size lessons in 18 worlds, in English and Malay, built on the same engine and rules as the Git course.

The course follows your app's journey, so each part answers one question. **Docker:** how do I pack my app so it runs anywhere? **CI/CD:** how does every change get tested and shipped by itself? **Kubernetes:** how do I keep many copies running, healthy and up to date?

| Decision | Choice | Why |
| --- | --- | --- |
| Shape | One course, three parts: Dapur (Docker), Kilang (CI/CD), Medan Selera (Kubernetes) | Mirrors the real path code takes: pack it → test and ship it → run it at scale |
| Order | Docker → CI/CD → Kubernetes, then GitOps closes the loop | Pipelines build container images; Kubernetes runs them; GitOps lets Git drive the cluster |
| Size | \~200 lessons, 3–5 min each, plus a Rescue Center and a capstone | Roughly 13–15 hours of lessons and 40–60 hours of hands-on practice (estimate) |
| Starting point | Git course Worlds 0–4 first; World 7 (Robots) before Part 2 | Nothing the Git course already teaches is repeated |
| One story | Food all the way: home kitchen → central kitchen → food court | One analogy family for three tools keeps memory load low |
| Practice | Three new in-browser simulators (containers, pipelines, clusters), then real tools and free online labs | Mistakes are free in the sim; real reps make you job-ready |
| Accuracy | Every lesson pins the tool version it was checked against, re-checked every quarter | Kubernetes alone ships about three releases a year |
| End goal | One portfolio app: containerised, tested in CI, deployed to Kubernetes by GitOps | Proof for job hunting, and solid prep for entry-level Kubernetes exams |

Name ideas: **Ship It** (EN) with the Malay subtitle *Dari Dapur ke Medan Selera* (from the kitchen to the food court). Backups: Jom Deploy, Kancil Cloud.

## 2. Who it's for and where you start

This course is for you once you can commit, branch and push, but have never run a container. The only hard requirement is the Git course's Worlds 0–4; every other basic is taught in a short bridge world (D0) before Docker starts.

| You need | Where you get it | Why it matters here |
| --- | --- | --- |
| Git basics: commit, branch, push, pull request | Git course Worlds 0–5 | Pipelines and GitOps are triggered by Git events |
| GitHub Actions basics | Git course World 7 (Robots) | Part 2 starts where Robots ends, so workflow anatomy and secrets are not repeated |
| Terminal and Linux basics: files, permissions, processes, environment variables, exit codes | D0 bridge | A container is a Linux process, so most container errors are Linux errors |
| Networking basics: IP, port, localhost, DNS, HTTP status codes | D0 bridge | Port mapping, Services and Gateways make no sense without them |
| YAML | D0 bridge | Compose files, workflows and every Kubernetes object are YAML |
| A computer that can run containers | 16 GB RAM is comfortable, 8 GB works with small clusters (estimate); Windows needs WSL 2 | Local clusters and Docker Desktop use a lot of memory; Codespaces is the fallback (section 11) |

Each part opens with a 10-minute **placement test**, so you can skip worlds you already know (ADHD rule 9, freedom to jump). Part 2 also explains what happens after you hand a site to your boss: the build and deploy steps on GitHub and Cloudflare.

## 3. Rules, story and words

All 14 ADHD rules, the writing rules and the bilingual rules from the Git plan apply unchanged. Infrastructure is invisible and full of YAML, so this course adds five rules and one shared story.

### Five extra rules for this course

| # | Rule | What it looks like on screen |
| --- | --- | --- |
| 15 | One story for everything | Every new term hangs on the food story below. Each world's Go deeper has a "Where the story breaks" note. |
| 16 | Show the state, not just the command | After every command, a picture shows what now exists: which containers run, which pods are healthy, which pipeline step is green. |
| 17 | Safe by default | Risky commands (`docker system prune`, `kubectl delete`) carry a danger badge. A pink "you are here" bar always shows your current cluster and namespace. Dry run first, every time. |
| 18 | YAML in small bites | Max \~15 lines of YAML per card. It grows block by block, with indent guide lines. |
| 19 | Real errors, plain words | You see the real message (`CrashLoopBackOff`), then a one-line translation. You will meet these at work. |

### The story: from home kitchen to food court

Part 1 is your **home kitchen** (Docker): you pack a dish so it tastes the same anywhere. Part 2 is the **central kitchen** (CI/CD): every recipe change is taste-tested and shipped by a conveyor belt. Part 3 is the **food court** (Kubernetes): a manager keeps many stalls serving, all day.

| Term | Food story | In BM lessons | Plain meaning (BM) |
| --- | --- | --- | --- |
| container | A sealed lunchbox with the dish and everything it needs | container | Bekas bertutup yang bawa aplikasi dan semua keperluannya |
| image | A frozen meal pack you can copy again and again | image | Pek beku yang boleh disalin berkali-kali; templat untuk container |
| Dockerfile | The recipe | Dockerfile | Resepi untuk buat image |
| layer | One layer of kek lapis | layer (lapisan) | Satu lapisan image; tukar satu, lapisan di atasnya dibuat semula |
| registry | The shop freezer where packs are shared | registry | Tempat simpan dan kongsi image, contohnya Docker Hub |
| volume | A locker outside the lunchbox | volume | Loker data supaya tak hilang bila container dibuang |
| port mapping | The order hatch | port mapping | Tingkap pesanan dari komputer anda ke container |
| Compose | A set meal ordered in one go | Compose | Hidupkan banyak container serentak dengan satu arahan |
| pipeline | A conveyor belt with stations | pipeline | Tali sawat automatik: bina, uji, hantar |
| CI | Taste-test every change | CI | Setiap perubahan diuji secara automatik |
| CD | The delivery van | CD | Versi yang lulus ujian dihantar secara automatik |
| runner | The worker at a station | runner | Mesin yang jalankan kerja dalam pipeline |
| secret | The locked spice box | secret | Maklumat rahsia seperti token; jangan letak dalam kod |
| cluster | The whole food court | cluster (kluster) | Sekumpulan mesin yang Kubernetes urus sebagai satu |
| node | One stall | node | Satu mesin dalam kluster |
| pod | A tray of dishes that always go together | pod | Unit paling kecil; satu atau lebih container yang sentiasa bersama |
| Deployment | The manager's standing order: "always 3 trays" | Deployment | Arahan tetap, contohnya "sentiasa ada 3 salinan" |
| desired state | What is written on the order board | desired state | Keadaan yang anda mahu; Kubernetes sentiasa kejar keadaan ini |
| Service | One order number, whichever stall cooks it | Service | Alamat tetap untuk sekumpulan pod |
| Gateway | The main entrance and its signboards | Gateway | Pintu masuk dari internet ke dalam kluster |
| namespace | One zone of the food court | namespace | Ruang berasingan dalam kluster |
| context | The "you are here" sign | context | Kluster dan namespace yang anda sedang guna |
| GitOps | The order board is a Git repo | GitOps | Git jadi sumber kebenaran; kluster ikut apa yang ada dalam Git |

### Colour means state, shape means thing

Keep the Git course's colour meanings so nothing has to be relearned: **blue** = on your machine, **amber** = waiting, pending or building, **green** = healthy, passed or saved, **purple** = online or remote (registry, cloud cluster), **pink** = you are here (current context), **red plus an icon** = failed. Object types use shapes instead: stacked layers for an image, a box for a container, a tray for a pod, a stall for a node, a belt for a pipeline.

## 4. The course map

Take the three parts in order: Docker, then CI/CD, then Kubernetes. Inside each part the worlds build on each other, but placement tests let you skip what you know.

```text
Before you start: Git course Worlds 0–4, and World 7 (Robots) before Part 2

Part 1 · Dapur (Docker, 69 lessons)   Part 2 · Kilang (CI/CD, 42)        Part 3 · Medan Selera (Kubernetes, 81)
D0 Start Here                         C1 Pipeline Thinking               K1 The Food Court
D1 First Containers                   C2 Container Pipelines   [M2]      K2 Trays & Orders
D2 Recipes                            C3 Release & Deploy      [M3]      K3 Counters & Doors
D3 Lockers & Phone Lines              C4 Pipeline Shields                K4 Config & Storage
D4 Set Meals              [M1]                                           K5 Lunch Rush            [M4]
D5 Ship & Shield                                                         K6 Guards                [M5]
D6 Under the Hood                                                        K7 Self-Driving          [M6]

Always open: Rescue Center (30 flows)      Finish line: Career Quest (8 lessons + capstone)
M1–M6 = Kedai Kancil capstone missions, unlocked after these worlds
```

Read it left to right for the order of the parts, then top to bottom inside each part. A tagged world unlocks a capstone mission.

- **Docker first:** in this course, CI/CD builds and ships container images, and Kubernetes runs them.
- **CI/CD before Kubernetes:** by Part 3 you already have a pipeline producing images worth deploying.
- **GitOps last (K7):** it ties all three together, with Git driving both the pipeline and the cluster.

## 5. Part 1 — Dapur (Docker): 7 worlds, 69 lessons

By the end of Part 1 you can pack any of your team's websites into a small, safe image and run it anywhere with one command. Teach Docker Engine 29.x and Compose v5; Compose v5 uses the same `docker compose` commands as v2 and mainly adds a Go SDK ([Docker docs](https://docs.docker.com/compose/intro/history/)).

| World | You will be able to | Lesson topics | Lessons | Boss challenge |
| --- | --- | --- | --- | --- |
| D0. Start Here | Explain why containers exist and set up your machine | "It works on my machine"; containers vs virtual machines (a room vs a whole house); Docker Engine vs Docker Desktop vs Podman; installing on Windows (WSL 2), macOS and Linux; `docker version`; Linux crash course (files, permissions, processes, env vars, exit codes); networking crash course (IP, port, localhost, DNS, HTTP codes); YAML in two lessons; placement test | 10 | Set up your kitchen: install, run `hello-world`, solve 5 network puzzles |
| D1. First Containers | Run, inspect and clean up containers with confidence | `docker run` (pull → create → start); image vs container; `-d`, `--name`, `--rm`; `docker ps -a`; lifecycle states; `logs -f`; `exec -it`; port mapping `-p 8080:80`; env vars `-e`; tags and the `latest` trap; Docker Hub, Official Images, Verified Publishers; `inspect`; cleanup (`rm`, `rmi`, `system df`, `prune`, danger level high) | 11 | Night shift: fix 3 broken containers (wrong port, exits at once, missing env var) |
| D2. Recipes (Dockerfile) | Write a clean, small, cache-friendly Dockerfile | `FROM`, `WORKDIR`, `COPY`, `RUN`, `ENV`, `EXPOSE`, `CMD`; `CMD` vs `ENTRYPOINT`; `ARG` vs `ENV`; build context and `.dockerignore`; layers and cache (kek lapis) and why order matters; tagging with SemVer + Git SHA; multi-stage builds; choosing a base (alpine, slim, distroless, Docker Hardened Images); non-root `USER`; `HEALTHCHECK`; BuildKit cache mounts and build secrets; multi-platform builds with `buildx` (amd64 vs arm64); labels | 13 | Shrink ray: containerise your diary site with nginx, non-root, under a size target |
| D3. Lockers & Phone Lines | Keep data safe and let containers talk | The writable layer disappears; named volumes; bind mounts for development; tmpfs; back up and restore a volume; default bridge vs user-defined networks; container DNS by name; `host` and `none`; publish vs expose; env files; secrets never baked in | 9 | App + Postgres whose data survives `docker rm` |
| D4. Set Meals (Compose) | Start a whole stack with one command | Why Compose; `compose.yaml` anatomy (services, build, ports, volumes, networks, environment); `up -d`, `down`, `ps`, `logs`, `exec`; `depends_on` with health conditions; `.env` and interpolation; profiles; override files for dev vs prod; `compose watch` for live reload; scaling a service; Compose v2 vs v5 | 10 | One command launches web + API + database + cache |
| D5. Ship & Shield | Publish images safely | Registries (Docker Hub, GHCR, cloud registries); log in with tokens, not passwords; tag strategy (no `latest` in production); digests and `@sha256` pinning; Docker Hub pull limits; scanning (Docker Scout, Trivy); SBOM and provenance attestations; signing with Sigstore (awareness); least privilege (non-root, read-only filesystem, drop capabilities); `docker history` shows leaked secrets; Docker Desktop licence rules | 9 | Publish a non-root image with an SBOM to GHCR and zero critical CVEs |
| D6. Under the Hood | Explain what a container really is | A container is a Linux process; namespaces (what it can see); cgroups v2 (what it can use); overlay filesystem; OCI image and runtime specs; containerd and runc, and why Kubernetes uses containerd without Docker; rootless mode and Podman; why Docker on Mac and Windows runs a small Linux VM | 7 | X-ray: turn a plain process into a container in the simulator, one namespace at a time |

**Facts to teach as of Oct 2026.** Docker Desktop is free for personal use, education and small businesses under 250 employees *and* under USD 10M revenue; bigger companies need a paid plan ([Docker licence](https://docs.docker.com/subscription/desktop-license/)). Docker Hub allows 100 pulls per 6 hours without login and 200 with a free account ([SSD Nodes summary of Docker docs](https://www.ssdnodes.com/learn/is-docker-free-engine-vs-desktop)). Docker Hardened Images became free and open source (Apache 2.0) in Dec 2025, so D2 can teach secure base images at no cost ([BleepingComputer](https://bleepingcomputer.com/news/security/docker-hardened-images-now-open-source-and-available-for-free)).

## 6. Part 2 — Kilang (CI/CD): 4 worlds, 42 lessons

By the end of Part 2 every pull request in your repo builds, tests and scans itself, and every merge ships a versioned image. The Git course's Robots world already covers workflow files, triggers, secrets, matrix and Pages deploys, so Part 2 starts with a 5-question recap and goes deeper into containers, releases and pipeline security.

| World | You will be able to | Lesson topics | Lessons | Boss challenge |
| --- | --- | --- | --- | --- |
| C1. Pipeline Thinking | Design a pipeline before writing YAML | Robots recap (skip if you pass); CI vs continuous delivery vs continuous deployment; stages: lint → test → build → scan → publish → deploy; fast feedback and flaky tests; the testing pyramid (unit, integration, end-to-end); build once, promote the same artifact; environments (dev, staging, production); trunk-based development and feature flags (links to Git World 6); DORA's five delivery metrics; the same ideas in GitLab CI, Jenkins and Azure Pipelines | 9 | Draw the line: design pipelines for 3 different teams on a canvas |
| C2. Container Pipelines | Build, test, scan and publish images in GitHub Actions | `setup-buildx` and `build-push-action`; tags from `metadata-action` (branch, SemVer, SHA); push to GHCR with `GITHUB_TOKEN` and `packages: write`; layer cache in CI; multi-arch builds; tests inside containers; service containers (Postgres for integration tests); Compose in CI; linting with hadolint and actionlint; fail on critical CVEs; SBOM and build provenance attestations; reusable workflows and composite actions; concurrency, path filters and dependency caching | 13 | Green line: every PR builds, tests and scans; every merge to main pushes a tagged image |
| C3. Release & Deploy | Ship safely and undo fast | Recreate, rolling, blue/green and canary; deploys vs feature flags; environments with required reviewers; automated versions and changelogs (release-please or semantic-release); preview environments per PR; deploying to Cloudflare from Actions (Workers static assets and Cloudflare Containers), the same path your team uses; per-environment secrets; OIDC instead of long-lived cloud keys; zero-downtime database migrations (expand → migrate → contract); smoke tests and automatic rollback; quiet, useful notifications | 11 | Bad Friday: ship a canary, spot the error spike, roll back |
| C4. Pipeline Shields | Keep your pipeline from becoming the way in | Why pipelines are targets (they hold secrets); the tj-actions incident story; pin third-party actions to a full commit SHA and let Dependabot update them; least-privilege `permissions:`; `pull_request_target` and forks; script injection through `${{ github.event.* }}`; secrets in logs and masking; self-hosted runner risks; SLSA levels and provenance; allow-listing actions for an organisation | 9 | Spot the holes: find and fix 5 flaws in a vulnerable workflow |

**Facts to teach as of Oct 2026.** In March 2025, attackers moved the version tags of the popular `tj-actions/changed-files` action to a malicious commit that dumped CI secrets; pinning to a full commit SHA would have blocked it ([Semgrep](https://semgrep.dev/blog/2025/popular-github-action-tj-actionschanged-files-is-compromised)). GitHub cut hosted-runner prices by up to 39% from 1 Jan 2026 and postponed a planned fee for self-hosted runners; Actions on public repos stays free ([GitHub changelog](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/)). DORA now tracks five metrics: deployment frequency, lead time for changes, failed deployment recovery time, change failure rate and the newer rework rate ([DORA](https://dora.dev/guides/dora-metrics/history/)). Cloudflare Containers became generally available in Apr 2026 and need the Workers Paid plan ([Cloudflare changelog](https://developers.cloudflare.com/changelog/2026-04-13-containers-sandbox-ga), [Containers docs](https://developers.cloudflare.com/containers/)).

## 7. Part 3 — Medan Selera (Kubernetes): 7 worlds, 81 lessons

By the end of Part 3 you can run an app on Kubernetes that heals itself, scales at lunch rush, is locked down, and updates itself from Git. Teach Kubernetes 1.37, the latest minor release, and the same version the CKAD exam currently uses ([Kubernetes releases](https://kubernetes.io/releases/), [CKAD](https://training.linuxfoundation.org/certification/certified-kubernetes-application-developer-ckad/)).

| World | You will be able to | Lesson topics | Lessons | Boss challenge |
| --- | --- | --- | --- | --- |
| K1. The Food Court | Explain how Kubernetes works and drive it with kubectl | Why orchestration (1 container is easy, 200 are not); when *not* to use Kubernetes; desired state and the reconcile loop; cluster, nodes, pods; control plane (API server, etcd, scheduler, controller manager); node parts (kubelet, kube-proxy, containerd via CRI); first cluster with kind, minikube or k3d; `get`, `describe`, `apply`, `delete`, `logs`, `exec`; kubeconfig and contexts; namespaces; manifest anatomy (`apiVersion`, `kind`, `metadata`, `spec`, `status`); labels and selectors; `--dry-run=client -o yaml`; `kubectl explain` | 13 | Grand opening: start a kind cluster, deploy a pod, read its status 3 ways |
| K2. Trays & Orders | Run apps that heal and update without downtime | Pods; multi-container pods, native sidecars, init containers; ReplicaSets; Deployments; rolling updates and `rollout undo`; container restart vs pod replacement; pod states (Pending, CrashLoopBackOff, ImagePullBackOff, OOMKilled); liveness, readiness and startup probes; requests and limits; QoS classes; DaemonSets; StatefulSets; Jobs and CronJobs; blue/green and canary with plain Deployments | 14 | Lunch-rush upgrade: zero-downtime update to 3 replicas, then roll back a bad image |
| K3. Counters & Doors | Let traffic in, safely | The pod network (every pod gets an IP, pods come and go); Services: ClusterIP, NodePort, LoadBalancer, headless; EndpointSlices and selector matching; cluster DNS; `port-forward` for debugging; **Gateway API** (GatewayClass, Gateway, HTTPRoute) as the main way in; Ingress (still on exams and older clusters) and why ingress-nginx was retired; TLS with cert-manager; NetworkPolicies (default deny, allow by label); CNI plugins (Cilium, Calico) awareness | 11 | Open the doors: route `/` and `/api` through a Gateway with TLS; lock the database with a NetworkPolicy |
| K4. Notes, Lockers & Packages | Configure, store and package apps | ConfigMaps (env vars vs mounted files); Secrets (base64 is not encryption) and encryption at rest; External Secrets and Sealed Secrets awareness; volumes: emptyDir, PV, PVC, StorageClass, dynamic provisioning, access modes; StatefulSet storage; Kustomize bases and overlays (built into kubectl); Helm 4: charts, values, install, upgrade, rollback; writing a small chart; Helm vs Kustomize; API deprecations; `kubectl get -o kyaml` | 12 | Same app, three kitchens: dev, staging and prod overlays with different config and replicas |
| K5. Lunch Rush | Scale, schedule and see inside the cluster | metrics-server and `kubectl top`; HorizontalPodAutoscaler (scale to zero is beta in 1.37); VPA and node autoscaling (Cluster Autoscaler, Karpenter) awareness; nodeSelector, affinity, taints and tolerations, topology spread; PodDisruptionBudgets; ResourceQuotas and LimitRanges; logs and events; Prometheus and Grafana; OpenTelemetry basics; the debug ladder (get → describe → logs → events → exec → `kubectl debug`); cluster upgrades and version skew; managed Kubernetes (EKS, GKE, AKS, DigitalOcean) and cost basics | 12 | Lunch rush: survive a traffic spike with HPA, then find the slow pod with metrics and logs |
| K6. Guards | Lock the cluster down | Authentication vs authorization vs admission; RBAC (Role, ClusterRole, bindings, ServiceAccounts); `kubectl auth can-i`; Pod Security Standards and admission; `securityContext` (non-root, read-only root filesystem, drop capabilities, seccomp); NetworkPolicies recap; ValidatingAdmissionPolicy (CEL), Kyverno and Gatekeeper; audit logs; supply-chain recap (signed images, SBOMs); user namespaces awareness | 10 | Lock the kitchen: pass the "restricted" Pod Security level and give a CI bot only the rights it needs |
| K7. Self-Driving | Let Git drive the cluster | GitOps principles (declarative, versioned, pulled, continuously reconciled); Argo CD vs Flux; sync, self-heal and drift; automated image updates; promoting between environments with PRs; progressive delivery (Argo Rollouts, Flagger); CRDs and operators (the same reconcile loop, reused); platform engineering and Backstage awareness | 9 | Hands off: change one line in Git and watch the cluster follow; catch and undo a manual edit |

**Facts to teach as of Oct 2026.** Kubernetes 1.37 was released on 26 Aug 2026, with support until 28 Oct 2027; 1.38 is expected around Dec 2026 ([Kubernetes releases](https://kubernetes.io/releases/), [InfoQ](https://infoq.com/news/2026/09/kubernetes-1-37)). The Kubernetes project retired ingress-nginx in March 2026 and recommends moving to Gateway API, so K3 teaches Gateway API first ([Kubernetes blog](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/)). Helm 4 shipped in Nov 2025 and Helm 3 security fixes end on 11 Nov 2026, so teach Helm 4 only ([Helm blog](https://helm.sh/blog/helm-4-released)).

## 8. Capstone, Rescue Center and Career Quest

One capstone runs through all three parts: **Kedai Kancil**, a tiny shop app (static front end, small API, Postgres). You build it in six missions, each unlocked by a world, and finish with one public repo that proves every skill in the course.

| Mission | After | You build | Done when |
| --- | --- | --- | --- |
| 1. Pack it | D4 | Dockerfiles for web and API, `compose.yaml` for local dev | `docker compose up` starts the whole shop on a fresh machine |
| 2. Ship it | C2 | Workflow that lints, tests, scans and pushes images to GHCR | Latest run on `main` is green (checked through the public GitHub API) |
| 3. Release it | C3 | Staging and production environments, canary step, rollback job | A deliberate bad release is rolled back by the pipeline |
| 4. Run it | K5 | Kustomize overlays, Gateway, probes, HPA | App survives a pod kill and a load spike in your kind cluster |
| 5. Guard it | K6 | RBAC, "restricted" Pod Security, NetworkPolicies, signed images | A policy check rejects an unsigned or root image |
| 6. Hands off | K7 | Argo CD syncing from a GitOps repo | A one-line Git change reaches the cluster with no kubectl |

The missions checker reuses the Git course's public-API checker, so it can only verify public repos. Missions 4–6 also give you a short self-check list for what the API cannot see.

### Rescue Center: 30 "oh no" flows, always open

Answer 2–3 questions, get the exact safe commands, like the Git Rescue Center.

| Part | Flows |
| --- | --- |
| Docker (10) | Container exits right away; port already allocated; app unreachable from localhost (listening on 127.0.0.1 inside); `exec format error` (wrong CPU type); permission denied on a volume; disk full from images and build cache; image far too big; secret baked into an image; Docker Hub `429 Too Many Requests`; containers can't find each other by name |
| CI/CD (8) | Workflow didn't trigger; "Resource not accessible by integration"; push to GHCR denied; cache never hits; flaky test; pipeline too slow; secret printed in logs; deploy "succeeded" but the site is broken |
| Kubernetes (12) | CrashLoopBackOff; ImagePullBackOff; pod stuck Pending; OOMKilled; Service has no endpoints; Gateway returns 404 or 503; DNS fails inside a pod; PVC stuck Pending; rollout stuck; `forbidden` (RBAC); ran a command on the wrong cluster; node NotReady |

### Career Quest: 8 lessons

What DevOps, SRE, platform and cloud engineers actually do; turning Kedai Kancil into a portfolio piece (README, architecture diagram, 2-minute demo video); reading job posts; interview questions (containers vs VMs, designing a pipeline, a debugging story); the certification path (section 12); first open-source contributions in cloud native (docs fixes, good first issues); keeping up (Kubernetes release blog, Docker release notes, KubeCon talks); a budget homelab. **Boss:** publish the capstone with its demo video and diagram.

## 9. Sample lesson: K1, Lesson 4 — "Want 3, See 2" (desired state), 4 min, 20 XP

This lesson teaches the single most important Kubernetes idea: you write down what you want, and a controller keeps fixing reality to match. It uses the same 6-step frame as the Git course (Hook, See it, Try it, Predict and check, Win, Go deeper).

| Card | Step | English | Bahasa Melayu | What moves on screen |
| --- | --- | --- | --- | --- |
| 1 | Hook | Your app's server died at 3 a.m. Everyone was asleep. Who fixes it? | Server aplikasi anda mati pukul 3 pagi. Semua orang tidur. Siapa nak baiki? | A food court at night; one stall's lights go out and its tray drops. |
| 2 | See it | You tell Kubernetes what you want: 3 copies, always. This is the **desired state**. | Anda beritahu Kubernetes apa yang anda mahu: 3 salinan, sentiasa. Ini dipanggil **desired state**. | A note saying "Want: 3" pins onto the manager's board. |
| 3 | See it | A **controller** checks again and again. Want 3. See 3. All good. | **Controller** periksa berulang kali. Mahu 3. Nampak 3. Semua okey. | The manager walks past 3 trays, ticking each one. |
| 4 | Predict | A whole stall closes, and one tray is lost. What happens next? | Satu gerai tutup, dan satu dulang hilang. Apa jadi lepas ni? | Three choice cards: "Nothing", "A new tray appears", "Everything restarts". |
| 5 | See it | Want 3. See 2. Make 1 more. That is the whole trick. | Mahu 3. Nampak 2. Buat 1 lagi. Itu sahaja rahsianya. | The manager spots the gap; a new tray slides onto another stall. |
| 6 | Try it | Tap "delete" on any pod. Watch what Kubernetes does. | Tekan "delete" pada mana-mana pod. Lihat apa Kubernetes buat. | Cluster simulator; every delete triggers a replacement and a "healed" counter goes up. |
| 7 | Try it | Now change the order. Type `kubectl scale deployment shop --replicas=5`. | Sekarang tukar pesanan. Taip `kubectl scale deployment shop --replicas=5`. | Mini terminal; the board flips to "Want: 5" and two trays appear. |
| 8 | Check | The new pod has a new name. Kubernetes replaces pods; it does not repair them. | Pod baharu ada nama baharu. Kubernetes ganti pod, bukan baiki pod lama. | Real `kubectl get pods` output; the new name and its AGE glow once. |
| 9 | Win | +20 XP. You can now explain how Kubernetes heals itself. | +20 XP. Kini anda boleh terangkan cara Kubernetes pulihkan dirinya. | A gold tick lands on the board (static in calm mode). |
| — | Go deeper | This loop is called reconciliation. If only a container crashes, the kubelet restarts it inside the same pod; watch the RESTARTS column. When a node dies, Kubernetes waits a few minutes before replacing its pods. | Gelung ini dipanggil reconciliation. Jika container sahaja yang crash, kubelet hidupkan semula dalam pod yang sama; lihat lajur RESTARTS. Bila node mati, Kubernetes tunggu beberapa minit sebelum ganti pod. | Folded panel with a 20-second `kubectl get pods -w` demo. |

The Go deeper card guards against the most common beginner mix-up: a crashed container is restarted in place, while a lost pod is replaced with a new name.

## 10. Interactives and animations

Build 18 new components and reuse four from the Git course (mini terminal, command builder, rescue flowcharts, missions checker). Three engines matter most, because every game plugs into them: the **kitchen engine** (Docker), the **conveyor engine** (pipelines) and the **food-court engine** (Kubernetes). Build each engine before the games for its part.

| Component | What it teaches | How it works | Used in |
| --- | --- | --- | --- |
| Kitchen engine + terminal | Docker commands, safely | Simulated images, layers, containers, volumes, networks and ports; type real `docker` commands and watch the state picture change | D0–D6 |
| Kek lapis builder | Layers and build cache | Each Dockerfile line stacks a cake layer with its size; edit a line and every layer above it re-bakes | D2, C2 |
| Order hatch | Port mapping | Plug cables from laptop ports to container ports; two cables on one port spark | D1, D3 |
| Locker test | Volumes | Delete a container and see which data survives | D3 |
| Compose canvas | Compose | Drag services, link networks and volumes; `compose.yaml` writes itself beside it | D4 |
| Shrink ray | Image size | Swap base images and add build stages to beat a size target | D2 |
| Namespace X-ray | What a container really is | Switch namespaces and cgroups on, one by one, until a plain process becomes a container | D6 |
| Conveyor engine + belt | Pipelines | Workflow YAML on the left, animated stations on the right; a matrix splits the belt, a cache hit is a shortcut, a red station stops the line | C1–C3 |
| Spot the hole | Workflow security | Tap risky lines; each reveals the attack and the fix | C4 |
| Traffic dial | Canary and blue/green | Slide traffic between old and new; watch the error graph; press rollback | C3, K2 |
| Food-court engine + kubectl | Kubernetes | Simulated API objects, controllers, scheduler and kubelet on a pausable clock; inject faults (kill a node, bad image, memory leak) | K1–K7 |
| Manager's board | Desired state and reconciliation | A "Want / See / Do" board animates every loop | K1, K2, K7 |
| Scheduler Tetris | Requests, taints, affinity | Fit pod blocks onto node shelves; taints are locks, tolerations are keys | K2, K5 |
| Label matchmaker | Labels, selectors, Services | Drag labels onto pods; the Service lights up what it matches; no match means no endpoints | K1, K3 |
| Request tracer | Gateway → Service → Pod | Follow one request hop by hop; break any hop to see the error a user gets | K3 |
| YAML doctor | Manifests | Fix broken manifests (indentation, wrong `apiVersion`, misspelt field) until the validator turns green | K1–K4 |
| RBAC switchboard | Who can do what | Wire users and ServiceAccounts to roles; ask "can-i?" and get yes or no | K6 |
| GitOps mirror | GitOps and drift | Edit Git on the left; the cluster on the right syncs; a manual edit shows as drift and snaps back | K7 |

The Git course's animation rules stay: one main animation per card, never looping forever, replayable, and swapped for a before/after fade in calm mode. Kubernetes animations also get a **pause and step** button, because many things happen at once.

## 11. Hands-on practice: simulator first, then real tools

Every lesson starts in the browser simulator, then hands you a short "do it for real" rep on a free tool. No lesson ever requires paying for cloud.

| Rung | Where | Cost | Best for | Watch out for |
| --- | --- | --- | --- | --- |
| 1 | FahamLah simulators | Free | Every lesson; mistakes cost nothing | Simplified on purpose; Go deeper links to the real thing |
| 2 | [Killercoda](https://killercoda.com) | Free tier | Real terminals and ready Kubernetes clusters in the browser; exam-style tasks | Free sessions last about an hour, one at a time, and reset ([DevOpsCube](https://devopscube.com/websites-to-practice-devops/)) |
| 3 | GitHub Codespaces | 120 core hours + 15 GB a month on a free personal account, about 60 hours on a 2-core machine ([GitHub Docs](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces)) | Docker and a kind cluster without installing anything; good on a weak laptop | Stop and delete idle codespaces so the quota lasts |
| 4 | Your own computer | Free: Docker Desktop (personal and small business) or Docker Engine on Linux/WSL 2, plus kind, minikube or k3d | The capstone and anything you want to keep | Memory; Docker Desktop needs a paid plan at large companies |
| 5 | GitHub Actions on your repos | Free on public repos | Real pipelines for Part 2 and the capstone | Private repos use your monthly minutes |
| 6 | Real cloud (optional) | Cloudflare Containers need Workers Paid; managed Kubernetes is billed by the hour | Seeing a real public deploy | Set a budget alert first and delete everything when done |

### Safety rules (shown as a checklist before the first real rep)

- Practise on throwaway clusters only, never on a work cluster.
- Read the pink "you are here" bar (cluster + namespace) before any `delete`.
- Dry run first: `kubectl diff`, `kubectl apply --dry-run=server`, `docker compose config`.
- Never mount the Docker socket into a container unless a lesson explains why.
- Use test tokens only; never paste real keys into a lesson, a repo or a chat.
- Log in to Docker Hub with a free account so you don't hit the anonymous pull limit.
- Install tools from official docs only; never pipe a random script into `bash`.

## 12. Motivation, assessments and certifications

Keep the Git course's gentle motivation system as it is (XP, world map, badges, rest-day streaks, boss retries, review cards, no leaderboards). Add skill badges for this course, optional "night shift" drills, and a map from worlds to real certifications.

**New badges (earned by skill, never by time):** Kek Lapis Master (cache-friendly Dockerfile), Shrink Ray (image under target), Green Line (first fully green pipeline), Hole Patcher (all 5 workflow flaws fixed), Self-Healer (pod survives a node kill), Zero Downtime (rolling update with no failed requests), Gatekeeper (restricted Pod Security passed), Hands Off (first GitOps sync).

**Night shift drills:** an optional 5-minute weekly scenario where something breaks in the simulator and you fix it with the Rescue Center. There is no countdown by default. A separate **exam mode**, off by default, adds a timer and a docs-only rule for people practising for hands-on exams.

### Certification map

| Certification | Format | Price (USD) | Covered by | Take it when |
| --- | --- | --- | --- | --- |
| [KCNA](https://training.linuxfoundation.org/certification/kubernetes-cloud-native-associate/) | 90-minute multiple choice, online, one retake, valid 2 years | 250 | D6, K1–K7 concepts | After K4, as a confidence step |
| [CKAD](https://training.linuxfoundation.org/certification/certified-kubernetes-application-developer-ckad/) | 2-hour hands-on tasks in a live cluster (Kubernetes 1.37), one retake, two simulator sessions | 445 | D2, K1–K6, Helm and Kustomize | After capstone mission 5 |
| [GitHub Actions (GH-200)](https://learn.microsoft.com/en-us/credentials/certifications/github-actions/) | 100-minute proctored exam via Pearson VUE, valid 2 years | Varies by country | Git World 7, C1–C4 | After C4 |
| CKA | Hands-on cluster administration | 445 | K1–K6, plus an optional "CKA pack" (kubeadm install and upgrade, etcd backup) | Later, after a few months of practice |
| CKS | Hands-on Kubernetes security; requires a valid CKA ([SFEIR](https://institute.sfeir.com/en/kubernetes-training/cost-certification-cks/)) | 445 | K6, C4, D5, plus more | After CKA |

CKAD's domain list maps cleanly onto Part 3: application design and build, deployment (including Helm and Kustomize), observability, configuration and security, and services and networking ([Linux Foundation](https://training.linuxfoundation.org/certification/certified-kubernetes-application-developer-ckad/)). Linux Foundation runs frequent discounts, so check for a promotion before you pay full price.

## 13. What the site needs, and how lessons stay correct

The FahamLah stack stays exactly as planned (Astro, React islands, MDX, Cloudflare Workers static assets). This course adds three simulator engines, a YAML toolkit and version-aware truth checks; nothing needs a server.

| Addition | What it is | Why |
| --- | --- | --- |
| Three course folders | `content/courses/docker`, `cicd`, `kubernetes`, each with `course.yaml` and a glossary file | The world map shows three parts; the glossary drives tooltips in both languages |
| `engine/kitchen-sim` | Pure TypeScript model of images (layers, size, digest), containers (states), volumes, networks, ports and a fake registry; commands return `{ state, output, events }` | Same pattern as the Git engine, so animations just listen to events |
| `engine/conveyor-sim` | Reads a safe subset of workflow YAML and runs jobs on a fake runner: `needs`, matrix, cache, artifacts, environments, failures on purpose | Pipelines run in seconds, with no GitHub account |
| `engine/foodcourt-sim` | Object store + controllers (Deployment, ReplicaSet, Job, HPA) + scheduler (requests, taints, affinity) + kubelet (probes, restarts, OOM) + Services and Gateway routing, on a pausable tick clock with fault injection | The heart of Part 3; the Manager's board is simply its event log drawn nicely |
| YAML toolkit | CodeMirror 6 with schemas for the Compose spec, GitHub workflows and Kubernetes 1.37 objects | Instant, friendly hints while typing YAML |
| Lesson header fields | Add `tool`, `toolVersion` and keep `lastChecked` | Shows which lessons go stale when a tool updates |
| Truth checks in CI | Replay Docker lessons on real Docker Engine on the GitHub runner, and Kubernetes lessons in a kind cluster at the pinned version; lint with hadolint, actionlint and kubeconform | The simulators can never quietly drift from reality |
| Version watch | A scheduled workflow opens an issue when a new Kubernetes minor, Docker Engine major or Compose major ships | Turns "keep up" into a to-do, not a worry |

```yaml
id: k8s-k1-l04
world: K1
title: Want 3, See 2
minutes: 4
xp: 20
interactives: [ManagersBoard, FoodCourtSim, Terminal]
tool: kubernetes
toolVersion: "1.37"
lastChecked: 2026-10-31
```

### Keep-fresh calendar

- **Kubernetes:** a new minor about every 4 months; 1.38 is due around Dec 2026. Re-check deprecations and bump lessons within about 8 weeks, since CKAD moves to a new minor 4–8 weeks after release.
- **Docker:** Engine 29.x and Compose v5 update often; skim release notes monthly, re-check lessons quarterly.
- **GitHub Actions:** screens and pricing change often; re-check quarterly, as the Git plan does for GitHub screens.
- **Watch list:** Gateway API versions, Helm 4, Cloudflare Containers limits and pricing.

### Using other people's material

Write all lesson text yourself and link official docs in Go deeper. Kubernetes docs are CC BY 4.0, so you may adapt them with credit, but rewrite in simple words anyway ([Kubernetes](https://kubernetes.io/releases/)). Use product names in text, but never the Docker whale or the Kubernetes wheel logos; draw your own icons. Kancil, the Git course mascot, simply changes hats: a chef's hat in Part 1, a hard hat in Part 2 and a captain's cap in Part 3.

## 14. Roadmap, Claude Code prompts and your study plan

Seven phases over about 26 weeks, starting once the Git course's Worlds 0–4 are live. Part 1 can launch around week 9 and the full course around week 26.

```text
Phase 0 Foundations (kitchen-sim, truth checks, world map, glossaries, D0) → gate: kitchen engine matches real Docker
Phase 1 Docker basics (D1–D3, Kek lapis builder, Order hatch, Locker test) → gate: testers finish D0–D3
Phase 2 Docker pro (D4–D6, Compose canvas, Shrink ray, Namespace X-ray, 10 rescue flows, mission 1) → Part 1 launches
Phase 3 CI/CD (conveyor-sim, C1–C4, Conveyor belt, Spot the hole, Traffic dial, 8 rescue flows, missions 2–3) → Part 2 launches
Phase 4 Kubernetes core (foodcourt-sim pinned to 1.37, K1–K3, Manager's board, Label matchmaker, Request tracer, YAML doctor) → gate: matches a real kind cluster
Phase 5 Kubernetes pro (K4–K7, Scheduler Tetris, RBAC switchboard, GitOps mirror, 12 rescue flows, missions 4–6) → Part 3 launches
Phase 6 Polish (Career Quest, certification map, night shift drills, exam mode, narration, review cards) → v1.0
```

If your weekly hours differ, the order stays the same and only the weeks stretch. Each phase ends at a gate; the next phase starts only when it passes.

### Claude Code prompts

First export this doc as Markdown and save it in the FahamLah repo as `docs/SHIP-IT-PLAN.md`. Start every prompt with *"Read `CLAUDE.md`, `docs/PLAN.md` and `docs/SHIP-IT-PLAN.md`."* End every prompt with *"Same rules and definition of done as the Git course. Never push or deploy. Show me the lesson list first and wait for my go."*

1. **Phase 0 — Foundations:** Build the `kitchen-sim` engine with Vitest tests, a truth-check workflow that replays its commands on real Docker in CI, the three-part world map, the glossary files and World D0 in EN and BM.
2. **Phase 1 — Docker basics:** Build Worlds D1–D3 in EN and BM with the Kek lapis builder, Order hatch and Locker test.
3. **Phase 2 — Docker pro:** Build D4–D6, the Compose canvas, Shrink ray, Namespace X-ray, the 10 Docker rescue flows and capstone mission 1.
4. **Phase 3 — CI/CD:** Build the `conveyor-sim` engine, C1–C4, the Conveyor belt, Spot the hole, Traffic dial, the 8 CI/CD rescue flows and capstone missions 2–3.
5. **Phase 4 — Kubernetes core:** Build the `foodcourt-sim` engine with tests and a kind-based truth check pinned to Kubernetes 1.37, then K1–K3, the Manager's board, Label matchmaker, Request tracer and YAML doctor.
6. **Phase 5 — Kubernetes pro:** Build K4–K7, Scheduler Tetris, RBAC switchboard, GitOps mirror, the 12 Kubernetes rescue flows and capstone missions 4–6.
7. **Phase 6 — Polish and v1.0:** Re-check every `toolVersion` against current releases first. Then build Career Quest, the certification map, night shift drills, exam mode, EN and BM narration and review cards for all three parts.

### Your own study plan: learn it the week before you build it

| Weeks | Learn | Real reps | Done when |
| --- | --- | --- | --- |
| 1–6 | D0–D3 | Containerise your diary site and one team website | You can explain every Dockerfile line out loud |
| 7–9 | D4–D6 | A Compose stack with a form and a database | Your image scans with zero critical CVEs |
| 10–13 | C1–C4 | Capstone missions 2–3; ask your boss for a walkthrough of the team's GitHub → Cloudflare deploy | Every PR is green and you can explain the team's deploy |
| 14–19 | K1–K3 | A kind cluster in Codespaces or on your laptop; Killercoda three times a week | You deploy, expose and roll back without notes |
| 20–24 | K4–K7 | Capstone missions 4–6 | Argo CD keeps the capstone in sync |
| 25–30 (optional) | Exam prep | KCNA practice, then CKAD with its two simulator sessions | Simulator scores pass comfortably before you book |

Daily rhythm: one 25-minute focus sprint for one lesson plus one real rep, then a 5-minute break. On rest days, just the 1-minute review cards.

## 15. Risks, success measures and next steps

The biggest risk is scope again: about 200 lessons and three engines on top of the Git course. Ship Part 1 first, learn from real use, then grow.

| Risk | What to do about it |
| --- | --- |
| Too big to finish | Build in phase order; launch Part 1 at week 9 even if Parts 2–3 slip |
| Facts go stale (Kubernetes every \~4 months, tool prices) | `toolVersion` fields, the version-watch workflow and quarterly re-checks |
| A simulator behaves differently from the real tool | Truth checks against real Docker and kind in CI; every lesson ends with a real rep |
| Overwhelm (infrastructure feels abstract) | One food story, a state picture after every command, max \~15 YAML lines per card, placement tests |
| The analogy misleads | A "Where the story breaks" note in every world's Go deeper |
| Surprise cloud bills | No lesson needs paid cloud; budget alerts and clean-up steps on every optional cloud rep |
| Unsafe habits (real tokens, wrong cluster) | Shields worlds early in each part (D5, C4, K6), test tokens only, the pink "you are here" bar |
| Competing with the Git course for your time | Finish Git Worlds 0–4 and World 7 first; this course builds on them anyway |

### How you will know it works

| Measure | Target |
| --- | --- |
| You can containerise any team website without notes | After Part 1 |
| Every pull request on your capstone gets a green pipeline | After Part 2 |
| A one-line Git change updates your cluster with no kubectl | After Part 3 |
| Lessons voted "Fun" | At least 70% of votes; fix anything voted "Confusing" first |
| Simulator truth checks | 100% passing before every release |
| Certifications (optional) | KCNA, then CKAD |

### Next steps

- [ ] Finish Git course Worlds 0–4 and World 7 on the site
- [ ] Export this doc as Markdown into the repo as `docs/SHIP-IT-PLAN.md`
- [ ] Install Docker Desktop (or Docker Engine on WSL 2 or Linux) and kind; make a free Docker Hub account
- [ ] Ask your boss for a 15-minute walkthrough of the team's GitHub → Cloudflare deploy
- [ ] Sketch Kancil's three hats (chef, hard hat, captain)
- [ ] Run the Phase 0 prompt in Claude Code

## Sources

Builds on FahamLah Git — Deep Plan for an ADHD-Friendly Git & GitHub Learning Site (ADHD rules, writing and bilingual rules, lesson frame, tech stack).

- [Kubernetes releases](https://kubernetes.io/releases/) and [Kubernetes v1.37 release blog](https://kubernetes.io/blog/2026/08/26/kubernetes-v1-37-release/)
- [InfoQ: Kubernetes 1.37](https://infoq.com/news/2026/09/kubernetes-1-37)
- [Kubernetes blog: Ingress NGINX retirement](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/)
- [Helm 4 released](https://helm.sh/blog/helm-4-released)
- [Docker Desktop licence agreement](https://docs.docker.com/subscription/desktop-license/)
- [History and development of Docker Compose](https://docs.docker.com/compose/intro/history/)
- [SSD Nodes: Is Docker free? (Docker Hub pull limits)](https://www.ssdnodes.com/learn/is-docker-free-engine-vs-desktop)
- [BleepingComputer: Docker Hardened Images now free and open source](https://bleepingcomputer.com/news/security/docker-hardened-images-now-open-source-and-available-for-free)
- [Cloudflare changelog: Containers generally available](https://developers.cloudflare.com/changelog/2026-04-13-containers-sandbox-ga) and [Cloudflare Containers docs](https://developers.cloudflare.com/containers/)
- [GitHub Docs: Codespaces billing](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces)
- [GitHub changelog: Actions pricing update](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/)
- [Semgrep: tj-actions/changed-files compromise](https://semgrep.dev/blog/2025/popular-github-action-tj-actionschanged-files-is-compromised)
- [DORA: history of the delivery metrics](https://dora.dev/guides/dora-metrics/history/)
- [DevOpsCube: free hands-on DevOps labs (Killercoda limits)](https://devopscube.com/websites-to-practice-devops/)
- [Linux Foundation: CKAD](https://training.linuxfoundation.org/certification/certified-kubernetes-application-developer-ckad/) and [KCNA](https://training.linuxfoundation.org/certification/kubernetes-cloud-native-associate/)
- [SFEIR Institute: CKS cost and CKA prerequisite](https://institute.sfeir.com/en/kubernetes-training/cost-certification-cks/)
- [Microsoft Learn: GitHub Actions certification (GH-200)](https://learn.microsoft.com/en-us/credentials/certifications/github-actions/)
