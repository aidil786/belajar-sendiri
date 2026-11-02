// CKAD practice: original hands-on tasks in FoodCourtSim (docs/LEVEL-UP-PLAN.md §4).
// Shown at /<lang>/ship-it/exam/ckad/. Practice, not the real exam: never copy real exam tasks.
// Each task starts from a Kubernetes scenario (any id in src/content/courses/kubernetes/scenarios/,
// or a new one in scenarios/exam.ts) and is checked by the engine with a KubeGoal.
// `src/content/exams/ckad.test.ts` checks every task: the goal is not met at the start, the
// reference solution meets it, docs links are official, short sentences, Malaysian Malay.
// How to add one: docs/AUTHORING.md, "Exam practice and drill levels".
import type { KubeGoal } from '~/engine/foodcourt-sim';

/** The five official CKAD domains and weights (cncf.io and the Linux Foundation CKAD page, checked 2026-11-01). */
export const CKAD_DOMAINS = [
  { id: 'design-build', weight: 20, name: { en: 'Application Design and Build', ms: 'Reka bentuk dan bina aplikasi' } },
  { id: 'deployment', weight: 20, name: { en: 'Application Deployment', ms: 'Deployment aplikasi' } },
  { id: 'observability', weight: 15, name: { en: 'Application Observability and Maintenance', ms: 'Pemerhatian dan penyelenggaraan aplikasi' } },
  { id: 'env-config-security', weight: 25, name: { en: 'Application Environment, Configuration and Security', ms: 'Persekitaran, konfigurasi dan keselamatan aplikasi' } },
  { id: 'services-networking', weight: 20, name: { en: 'Services and Networking', ms: 'Service dan rangkaian' } },
] as const;

export type CkadDomain = (typeof CKAD_DOMAINS)[number]['id'];

/** One language of a task. */
export interface CkadText {
  /** What to do, like an exam task: names, images, ports. One to three short sentences. */
  task: string;
  /** One nudge (hidden in exam mode, folded otherwise). */
  hint: string;
}

export interface CkadTask {
  /** Unique and stable (saved sets refer to it): ckad-<domain>-NNN. */
  id: string;
  domain: CkadDomain;
  /** A Kubernetes course scenario id (the starting cluster). */
  scenario: string;
  /** Checked live by the engine, like a FoodCourtSim goal. */
  goal: KubeGoal;
  en: CkadText;
  ms: CkadText;
  /** One official page (kubernetes.io or helm.sh): the only help allowed in exam mode. */
  docs: { label: string; url: string };
  /** Commands that solve it (tests only; never shown). */
  solution: string[];
}

/** The real exam: 2 hours of hands-on tasks. A practice set takes 15 tasks (all of them while the bank is small). */
export const CKAD_SET_SIZE = 15;
export const CKAD_MINUTES = 120;
export const CKAD_CHECKED = '2026-11-01';
export const CKAD_URL = 'https://training.linuxfoundation.org/certification/certified-kubernetes-application-developer-ckad/';
/** The sites the real CKAD allows (Linux Foundation "Resources allowed", checked 2026-11-01). */
export const CKAD_DOCS = ['kubernetes.io/docs', 'kubernetes.io/blog', 'helm.sh/docs'] as const;

const BOT = 'system:serviceaccount:default:ci-bot';

export const ckadTasks: CkadTask[] = [
  {
    id: 'ckad-design-build-001',
    domain: 'design-build',
    scenario: 'exam-ckad-empty',
    goal: { objectExists: ['job/report'], podStatus: { selector: 'job-name=report', status: 'Completed' } },
    en: {
      task: 'Make a Job called `report`. It uses `busybox:1.37` and runs `echo done` once.',
      hint: '`kubectl create job` can do it in one line. The command goes after `--`.',
    },
    ms: {
      task: 'Buat Job bernama `report`. Ia guna `busybox:1.37` dan jalankan `echo done` sekali.',
      hint: '`kubectl create job` boleh buat dalam satu baris. Arahan itu ditulis selepas `--`.',
    },
    docs: { label: 'Kubernetes: Jobs', url: 'https://kubernetes.io/docs/concepts/workloads/controllers/job/' },
    solution: ['kubectl create job report --image=busybox:1.37 -- echo done'],
  },
  {
    id: 'ckad-deployment-001',
    domain: 'deployment',
    scenario: 'exam-ckad-shop',
    goal: { deploymentImage: { name: 'shop', image: 'nginx:1.30-alpine', container: 'web' }, rolloutComplete: { name: 'shop', minRevision: 2 } },
    en: {
      task: 'Update Deployment `shop`: container `web` gets `nginx:1.30-alpine`. Let the rollout finish.',
      hint: '`kubectl set image` changes one container’s image. Then watch `kubectl rollout status`.',
    },
    ms: {
      task: 'Kemas kini Deployment `shop`: container `web` dapat `nginx:1.30-alpine`. Biar rollout itu siap.',
      hint: '`kubectl set image` tukar image satu container. Kemudian lihat `kubectl rollout status`.',
    },
    docs: { label: 'Kubernetes: updating a Deployment', url: 'https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#updating-a-deployment' },
    solution: ['kubectl set image deployment/shop web=nginx:1.30-alpine'],
  },
  {
    id: 'ckad-observability-001',
    domain: 'observability',
    scenario: 'exam-ckad-menu-typo',
    goal: { podsReady: { selector: 'app=menu', count: 2 }, noPodStatus: { selector: 'app=menu', status: 'ImagePullBackOff' } },
    en: {
      task: 'Deployment `menu` has no Ready pods. Find out why, and fix it. Then 2 pods are Ready.',
      hint: 'Read the events: `kubectl describe pod -l app=menu`. Look closely at the image name.',
    },
    ms: {
      task: 'Deployment `menu` tiada pod yang Ready. Cari sebabnya, dan baikinya. Kemudian 2 pod jadi Ready.',
      hint: 'Baca event: `kubectl describe pod -l app=menu`. Lihat nama image itu betul-betul.',
    },
    docs: { label: 'Kubernetes: debug pods', url: 'https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/' },
    solution: ['kubectl set image deployment/menu web=nginx:1.29-alpine'],
  },
  {
    id: 'ckad-env-config-security-001',
    domain: 'env-config-security',
    scenario: 'exam-ckad-ci-bot',
    goal: {
      canI: [
        { verb: 'list', resource: 'pods', as: BOT, allowed: true },
        { verb: 'delete', resource: 'pods', as: BOT, allowed: false },
      ],
    },
    en: {
      task: 'ServiceAccount `ci-bot` in namespace `default` must list pods there. It must not delete them.',
      hint: 'Make a Role for get, list and watch on pods. Then bind it to the ServiceAccount.',
    },
    ms: {
      task: 'ServiceAccount `ci-bot` dalam namespace `default` mesti boleh list pod di situ. Ia tak boleh padam pod.',
      hint: 'Buat Role untuk get, list dan watch pada pod. Kemudian ikat Role itu kepada ServiceAccount.',
    },
    docs: { label: 'Kubernetes: RBAC', url: 'https://kubernetes.io/docs/reference/access-authn-authz/rbac/' },
    solution: ['kubectl create role pod-reader --verb=get,list,watch --resource=pods', 'kubectl create rolebinding ci-bot-reads --role=pod-reader --serviceaccount=default:ci-bot'],
  },
  {
    id: 'ckad-services-networking-001',
    domain: 'services-networking',
    scenario: 'exam-ckad-shop',
    goal: { serviceEndpoints: { name: 'shop', count: 3 }, reachable: { url: 'http://shop', from: 'client' } },
    en: {
      task: 'Expose Deployment `shop` inside the cluster as Service `shop` on port 80. Pod `client` must reach `http://shop`.',
      hint: '`kubectl expose` makes a Service that picks the Deployment’s pods.',
    },
    ms: {
      task: 'Dedahkan Deployment `shop` dalam kluster sebagai Service `shop` pada port 80. Pod `client` mesti sampai ke `http://shop`.',
      hint: '`kubectl expose` buat Service yang pilih pod Deployment itu.',
    },
    docs: { label: 'Kubernetes: Service', url: 'https://kubernetes.io/docs/concepts/services-networking/service/' },
    solution: ['kubectl expose deployment shop --port=80'],
  },

  // ------------------------------------------------------------------ Application Design and Build
  {
    id: 'ckad-design-build-002',
    domain: 'design-build',
    scenario: 'exam-ckad-empty',
    goal: { objectExists: ['cronjob/cleanup'], podStatus: { selector: 'job-name=cleanup-now', status: 'Completed' } },
    en: {
      task: 'Make CronJob `cleanup`: `busybox:1.37`, every 15 minutes, runs `echo sweep`. Then start one run now as Job `cleanup-now`.',
      hint: 'The schedule is `*/15 * * * *`. A Job can be made `--from=cronjob/cleanup`.',
    },
    ms: {
      task: 'Buat CronJob `cleanup`: `busybox:1.37`, setiap 15 minit, jalankan `echo sweep`. Kemudian mulakan satu larian sekarang sebagai Job `cleanup-now`.',
      hint: 'Jadualnya `*/15 * * * *`. Job boleh dibuat `--from=cronjob/cleanup`.',
    },
    docs: { label: 'Kubernetes: CronJob', url: 'https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/' },
    solution: ['kubectl create cronjob cleanup --image=busybox:1.37 --schedule="*/15 * * * *" -- echo sweep', 'kubectl create job cleanup-now --from=cronjob/cleanup'],
  },
  {
    id: 'ckad-design-build-003',
    domain: 'design-build',
    scenario: 'exam-ckad-menu-worker',
    goal: { podsReady: { selector: 'app=menu', count: 2 }, reachable: { url: 'http://menu', from: 'client' } },
    en: {
      task: 'Deployment `menu` runs one container, `worker`. Add a second container `web` to the same pods: `nginx:1.29-alpine`, port 80. Keep `worker`. Pod `client` must reach `http://menu`.',
      hint: 'No editor here: use `kubectl patch`. A container list in a patch merges by `name`, so a new name is added.',
    },
    ms: {
      task: 'Deployment `menu` jalankan satu container, `worker`. Tambah container kedua `web` dalam pod yang sama: `nginx:1.29-alpine`, port 80. Kekalkan `worker`. Pod `client` mesti sampai ke `http://menu`.',
      hint: 'Tiada editor di sini: guna `kubectl patch`. Senarai container dalam patch digabung ikut `name`, jadi nama baru ditambah.',
    },
    docs: { label: 'Kubernetes: Pods with several containers', url: 'https://kubernetes.io/docs/concepts/workloads/pods/#how-pods-manage-multiple-containers' },
    solution: [`kubectl patch deployment menu -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","image":"nginx:1.29-alpine","ports":[{"containerPort":80}]}]}}}}'`],
  },
  {
    id: 'ckad-design-build-004',
    domain: 'design-build',
    scenario: 'exam-ckad-kedai-init',
    goal: { podsReady: { selector: 'app=kedai', count: 2 }, rolloutComplete: { name: 'kedai' } },
    en: {
      task: 'Pods of Deployment `kedai` never get past Init. Find the failing init container. Change its command to `sh -c "echo menu ready"`.',
      hint: 'Read `kubectl logs` with `-c prep`. Then patch `initContainers`, matched by `name`.',
    },
    ms: {
      task: 'Pod Deployment `kedai` tak pernah lepas Init. Cari init container yang gagal. Tukar arahannya kepada `sh -c "echo menu ready"`.',
      hint: 'Baca `kubectl logs` dengan `-c prep`. Kemudian patch `initContainers`, dipadankan ikut `name`.',
    },
    docs: { label: 'Kubernetes: Init containers', url: 'https://kubernetes.io/docs/concepts/workloads/pods/init-containers/' },
    solution: [`kubectl patch deployment kedai -p '{"spec":{"template":{"spec":{"initContainers":[{"name":"prep","command":["sh","-c","echo menu ready"]}]}}}}'`],
  },

  // ------------------------------------------------------------------ Application Deployment
  {
    id: 'ckad-deployment-002',
    domain: 'deployment',
    scenario: 'exam-ckad-bad-release',
    goal: { deploymentImage: { name: 'shop', image: 'nginx:1.29-alpine', container: 'web' }, rolloutComplete: { name: 'shop', minRevision: 3 } },
    en: {
      task: 'The new release of Deployment `shop` is stuck. Roll it back to the version before. The rollout must finish.',
      hint: '`kubectl rollout history` lists the versions. `kubectl rollout undo` goes back one.',
    },
    ms: {
      task: 'Keluaran baru Deployment `shop` tersekat. Undurkan ke versi sebelumnya. Rollout itu mesti siap.',
      hint: '`kubectl rollout history` senaraikan versi. `kubectl rollout undo` undur satu langkah.',
    },
    docs: { label: 'Kubernetes: rolling back a Deployment', url: 'https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#rolling-back-a-deployment' },
    solution: ['kubectl rollout undo deployment/shop'],
  },
  {
    id: 'ckad-deployment-003',
    domain: 'deployment',
    scenario: 'exam-ckad-canary',
    goal: {
      deploymentImage: { name: 'shop-canary', image: 'nginx:1.30-alpine' },
      replicas: { name: 'shop-canary', count: 1 },
      serviceEndpoints: { name: 'shop', count: 4 },
    },
    en: {
      task: 'Service `shop` picks pods with label `tier=shop`. Add a canary: Deployment `shop-canary`, 1 pod of `nginx:1.30-alpine`. The Service must send it traffic too, so it has 4 endpoints.',
      hint: 'Create the Deployment. Then add `tier: shop` to its pod template labels with `kubectl patch`.',
    },
    ms: {
      task: 'Service `shop` pilih pod berlabel `tier=shop`. Tambah canary: Deployment `shop-canary`, 1 pod `nginx:1.30-alpine`. Service itu mesti hantar trafik kepadanya juga, jadi ada 4 endpoint.',
      hint: 'Buat Deployment itu. Kemudian tambah `tier: shop` pada label templat pod dengan `kubectl patch`.',
    },
    docs: { label: 'Kubernetes: canary deployments', url: 'https://kubernetes.io/docs/concepts/workloads/management/#canary-deployments' },
    solution: ['kubectl create deployment shop-canary --image=nginx:1.30-alpine --replicas=1', `kubectl patch deployment shop-canary -p '{"spec":{"template":{"metadata":{"labels":{"tier":"shop"}}}}}'`],
  },

  // ------------------------------------------------------------------ Application Observability and Maintenance
  {
    id: 'ckad-observability-002',
    domain: 'observability',
    scenario: 'exam-ckad-shy-api',
    goal: { podsReady: { selector: 'app=api', count: 2 } },
    en: {
      task: 'Pods of Deployment `api` run, but never get Ready. Fix the readiness probe: it should check the page `/` on port 80.',
      hint: '`kubectl describe pod -l app=api` shows the probe and its 404. Patch `readinessProbe` in container `web`.',
    },
    ms: {
      task: 'Pod Deployment `api` berjalan, tetapi tak pernah Ready. Baiki readiness probe: ia patut semak halaman `/` pada port 80.',
      hint: '`kubectl describe pod -l app=api` tunjuk probe itu dan 404nya. Patch `readinessProbe` dalam container `web`.',
    },
    docs: { label: 'Kubernetes: configure probes', url: 'https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/' },
    solution: [`kubectl patch deployment api -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","readinessProbe":{"httpGet":{"path":"/"}}}]}}}}'`],
  },

  // ------------------------------------------------------------------ Application Environment, Configuration and Security
  {
    id: 'ckad-env-config-security-002',
    domain: 'env-config-security',
    scenario: 'exam-ckad-menu-page',
    goal: { podsReady: { selector: 'app=kedai', count: 2 }, reachable: { url: 'http://kedai', from: 'client', contains: 'Nasi lemak' } },
    en: {
      task: 'Pods of Deployment `kedai` are stuck. They mount ConfigMap `menu-page`, which is missing. Make it from the file `index.html` in your folder. Then `http://kedai` shows the menu.',
      hint: '`kubectl create configmap` takes `--from-file`. The key becomes the file name.',
    },
    ms: {
      task: 'Pod Deployment `kedai` tersekat. Ia mount ConfigMap `menu-page`, yang tiada. Buat ConfigMap itu daripada fail `index.html` dalam folder anda. Kemudian `http://kedai` tunjuk menu.',
      hint: '`kubectl create configmap` terima `--from-file`. Kuncinya jadi nama fail itu.',
    },
    docs: { label: 'Kubernetes: ConfigMaps as files', url: 'https://kubernetes.io/docs/concepts/configuration/configmap/#using-configmaps-as-files-from-a-pod' },
    solution: ['kubectl create configmap menu-page --from-file=index.html'],
  },
  {
    id: 'ckad-env-config-security-003',
    domain: 'env-config-security',
    scenario: 'exam-ckad-quota',
    goal: { podsReady: { selector: 'app=till', count: 2, namespace: 'kiosk' } },
    en: {
      task: 'Deployment `till` in namespace `kiosk` has no pods. Give its container requests `cpu=100m,memory=64Mi` and limits `cpu=200m,memory=128Mi`. Then 2 pods run.',
      hint: 'Look at `kubectl describe quota -n kiosk`. `kubectl set resources` sets both at once.',
    },
    ms: {
      task: 'Deployment `till` dalam namespace `kiosk` tiada pod. Beri container itu requests `cpu=100m,memory=64Mi` dan limits `cpu=200m,memory=128Mi`. Kemudian 2 pod berjalan.',
      hint: 'Lihat `kubectl describe quota -n kiosk`. `kubectl set resources` tetapkan kedua-duanya sekali gus.',
    },
    docs: { label: 'Kubernetes: resource quotas', url: 'https://kubernetes.io/docs/concepts/policy/resource-quotas/' },
    solution: ['kubectl set resources deployment till -n kiosk --requests=cpu=100m,memory=64Mi --limits=cpu=200m,memory=128Mi'],
  },

  // ------------------------------------------------------------------ Services and Networking
  {
    id: 'ckad-services-networking-002',
    domain: 'services-networking',
    scenario: 'exam-ckad-wrong-selector',
    goal: { serviceEndpoints: { name: 'menu', count: 2 }, reachable: { url: 'http://menu', from: 'client' } },
    en: {
      task: 'Service `menu` has no endpoints. Fix the Service, not the Deployment. Pod `client` must reach `http://menu`.',
      hint: 'Compare the Service `selector` with the pod labels (`--show-labels`). Patch the selector.',
    },
    ms: {
      task: 'Service `menu` tiada endpoint. Baiki Service itu, bukan Deployment. Pod `client` mesti sampai ke `http://menu`.',
      hint: 'Banding `selector` Service dengan label pod (`--show-labels`). Patch selector itu.',
    },
    docs: { label: 'Kubernetes: debug Services', url: 'https://kubernetes.io/docs/tasks/debug/debug-application/debug-service/' },
    solution: [`kubectl patch service menu -p '{"spec":{"selector":{"app":"menu"}}}'`],
  },

  // ------------------------------------------------------------------ more Design and Build
  {
    id: 'ckad-design-build-005',
    domain: 'design-build',
    scenario: 'exam-ckad-ledger-claim',
    goal: { podsReady: { selector: 'app=ledger', count: 1 }, objectExists: ['persistentvolumeclaim/ledger-data'] },
    en: {
      task: 'The pod of Deployment `ledger` is Pending. Find out why. Fix it without changing the Deployment: your folder has what it needs.',
      hint: '`kubectl describe pod -l app=ledger` names a missing claim. Look for it with `ls`.',
    },
    ms: {
      task: 'Pod Deployment `ledger` dalam keadaan Pending. Cari sebabnya. Baikinya tanpa ubah Deployment itu: folder anda ada apa yang ia perlukan.',
      hint: '`kubectl describe pod -l app=ledger` sebut claim yang hilang. Cari dengan `ls`.',
    },
    docs: { label: 'Kubernetes: PersistentVolumeClaims', url: 'https://kubernetes.io/docs/concepts/storage/persistent-volumes/#persistentvolumeclaims' },
    solution: ['kubectl apply -f claim.yaml'],
  },
  {
    id: 'ckad-design-build-006',
    domain: 'design-build',
    scenario: 'exam-ckad-empty',
    goal: { podsReady: { selector: 'app=kopi', count: 3, namespace: 'cafe' }, deploymentImage: { name: 'kopi', image: 'nginx:1.30-alpine', namespace: 'cafe' } },
    en: {
      task: 'Make namespace `cafe`. In it, make Deployment `kopi`: 3 replicas of `nginx:1.30-alpine`, container port 80.',
      hint: '`kubectl create deployment` takes `--replicas`, `--port` and `-n`.',
    },
    ms: {
      task: 'Buat namespace `cafe`. Di dalamnya, buat Deployment `kopi`: 3 replika `nginx:1.30-alpine`, port container 80.',
      hint: '`kubectl create deployment` terima `--replicas`, `--port` dan `-n`.',
    },
    docs: { label: 'Kubernetes: kubectl create deployment', url: 'https://kubernetes.io/docs/reference/kubectl/generated/kubectl_create/kubectl_create_deployment/' },
    solution: ['kubectl create namespace cafe', 'kubectl create deployment kopi --image=nginx:1.30-alpine --replicas=3 --port=80 -n cafe'],
  },
  {
    id: 'ckad-design-build-007',
    domain: 'design-build',
    scenario: 'exam-ckad-tally',
    goal: { podStatus: { selector: 'job-name=tally', status: 'Completed' } },
    en: {
      task: 'Job `tally` failed: its command always exits with 1. Replace it with a Job of the same name. It uses `busybox:1.37` and runs `echo counted`.',
      hint: 'A Job’s pod template cannot change. Delete the Job, then create it again.',
    },
    ms: {
      task: 'Job `tally` gagal: arahannya sentiasa keluar dengan 1. Gantikan dengan Job yang sama nama. Ia guna `busybox:1.37` dan jalankan `echo counted`.',
      hint: 'Templat pod sesebuah Job tak boleh diubah. Padam Job itu, kemudian buat semula.',
    },
    docs: { label: 'Kubernetes: Jobs', url: 'https://kubernetes.io/docs/concepts/workloads/controllers/job/#job-termination-and-cleanup' },
    solution: ['kubectl delete job tally', 'kubectl create job tally --image=busybox:1.37 -- echo counted'],
  },

  // ------------------------------------------------------------------ more Application Deployment
  {
    id: 'ckad-deployment-004',
    domain: 'deployment',
    scenario: 'exam-ckad-three-releases',
    goal: { deploymentImage: { name: 'shop', image: 'nginx:1.29-alpine', container: 'web' }, rolloutComplete: { name: 'shop', minRevision: 4 } },
    en: {
      task: 'Deployment `shop` has three revisions, and the last one is stuck. Roll back to revision 1, the first image. The rollout must finish.',
      hint: 'A plain undo goes back only one step. `kubectl rollout undo` takes `--to-revision`.',
    },
    ms: {
      task: 'Deployment `shop` ada tiga revision, dan yang terakhir tersekat. Undurkan ke revision 1, image yang pertama. Rollout itu mesti siap.',
      hint: 'Undo biasa undur satu langkah sahaja. `kubectl rollout undo` terima `--to-revision`.',
    },
    docs: { label: 'Kubernetes: rolling back to a revision', url: 'https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#rolling-back-to-a-previous-revision' },
    solution: ['kubectl rollout undo deployment/shop --to-revision=1'],
  },
  {
    id: 'ckad-deployment-005',
    domain: 'deployment',
    scenario: 'exam-ckad-blue-green',
    goal: { serviceEndpoints: { name: 'shop', count: 2 }, reachable: { url: 'http://shop', from: 'client', contains: 'green' } },
    en: {
      task: 'Blue and green shops both run. Service `shop` sends traffic to `version=blue`. Switch it to `version=green` in one step, without stopping any pod.',
      hint: 'Only the Service changes. Patch its `selector`.',
    },
    ms: {
      task: 'Kedai biru dan hijau sama-sama berjalan. Service `shop` hantar trafik ke `version=blue`. Tukar ke `version=green` dalam satu langkah, tanpa hentikan mana-mana pod.',
      hint: 'Hanya Service itu berubah. Patch `selector`nya.',
    },
    docs: { label: 'Kubernetes: Service selectors', url: 'https://kubernetes.io/docs/concepts/services-networking/service/#defining-a-service' },
    solution: [`kubectl patch service shop -p '{"spec":{"selector":{"version":"green"}}}'`],
  },
  {
    id: 'ckad-deployment-006',
    domain: 'deployment',
    scenario: 'exam-ckad-kustomize',
    goal: { podsReady: { selector: 'app=shop', count: 3, namespace: 'prod' }, deploymentImage: { name: 'shop', image: 'nginx:1.30-alpine', namespace: 'prod' } },
    en: {
      task: 'Folder `kedai` has a Kustomize base and a `prod` overlay. Deploy the `prod` overlay. Then 3 pods of `shop` run in namespace `prod`.',
      hint: '`kubectl apply -k` takes a folder. Read the error: a namespace may be missing.',
    },
    ms: {
      task: 'Folder `kedai` ada base Kustomize dan overlay `prod`. Deploy overlay `prod` itu. Kemudian 3 pod `shop` berjalan dalam namespace `prod`.',
      hint: '`kubectl apply -k` terima folder. Baca ralat itu: mungkin ada namespace yang tiada.',
    },
    docs: { label: 'Kubernetes: Kustomize', url: 'https://kubernetes.io/docs/tasks/manage-kubernetes-objects/kustomization/' },
    solution: ['kubectl create namespace prod', 'kubectl apply -k kedai/overlays/prod'],
  },
  {
    id: 'ckad-deployment-007',
    domain: 'deployment',
    scenario: 'exam-ckad-prices',
    goal: { rolloutComplete: { name: 'kedai', minRevision: 2 }, podsReady: { selector: 'app=kedai', count: 3 } },
    en: {
      task: 'ConfigMap `prices` just changed. Pods of Deployment `kedai` read it as env vars, so they still have old prices. Replace them with a rolling update.',
      hint: 'Env vars are read when a container starts. `kubectl rollout restart` makes new pods step by step.',
    },
    ms: {
      task: 'ConfigMap `prices` baru berubah. Pod Deployment `kedai` baca ia sebagai env var, jadi harga lama masih ada. Gantikan pod itu dengan rolling update.',
      hint: 'Env var dibaca bila container bermula. `kubectl rollout restart` buat pod baru langkah demi langkah.',
    },
    docs: { label: 'Kubernetes: kubectl rollout restart', url: 'https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_restart/' },
    solution: ['kubectl rollout restart deployment/kedai'],
  },

  // ------------------------------------------------------------------ more Observability and Maintenance
  {
    id: 'ckad-observability-003',
    domain: 'observability',
    scenario: 'exam-ckad-till-logs',
    goal: { podsReady: { selector: 'app=till', count: 1 }, noPodStatus: { selector: 'app=till', status: 'CrashLoopBackOff' } },
    en: {
      task: 'The pod of Deployment `till` keeps crashing. Read its logs. Give it the env var it asks for, with the value `kancil123`.',
      hint: '`kubectl logs deploy/till` shows the last run. `kubectl set env` adds a variable.',
    },
    ms: {
      task: 'Pod Deployment `till` asyik crash. Baca log pod itu. Beri env var yang ia minta, dengan nilai `kancil123`.',
      hint: '`kubectl logs deploy/till` tunjuk larian terakhir. `kubectl set env` tambah satu pemboleh ubah.',
    },
    docs: { label: 'Kubernetes: kubectl logs', url: 'https://kubernetes.io/docs/reference/kubectl/generated/kubectl_logs/' },
    solution: ['kubectl set env deployment/till POSTGRES_PASSWORD=kancil123'],
  },
  {
    id: 'ckad-observability-004',
    domain: 'observability',
    scenario: 'exam-ckad-chef-pending',
    goal: { podsReady: { selector: 'app=chef', count: 2 } },
    en: {
      task: 'Pods of Deployment `chef` stay Pending. Read the events and fix it. They may run on node `dev-worker`, which has a fast disk.',
      hint: 'The `FailedScheduling` event names the rule. Label the node, or drop the `nodeSelector`.',
    },
    ms: {
      task: 'Pod Deployment `chef` kekal Pending. Baca event dan baikinya. Pod itu boleh berjalan di node `dev-worker`, yang ada cakera laju.',
      hint: 'Event `FailedScheduling` sebut peraturan itu. Label node itu, atau buang `nodeSelector`.',
    },
    docs: { label: 'Kubernetes: assign pods to nodes', url: 'https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#nodeselector' },
    solution: ['kubectl label node dev-worker disk=ssd'],
  },
  {
    id: 'ckad-observability-005',
    domain: 'observability',
    scenario: 'exam-ckad-old-api',
    goal: { podsReady: { selector: 'app=shop', count: 3 }, deploymentImage: { name: 'shop', image: 'nginx:1.29-alpine' } },
    en: {
      task: 'File `old-shop.yaml` uses an API that is gone. Run the same Deployment `shop` with today’s API: same image, 3 replicas, label `app=shop`.',
      hint: 'Try `kubectl apply` and read the error. Deployments live in `apps/v1`; `kubectl create deployment` uses it.',
    },
    ms: {
      task: 'Fail `old-shop.yaml` guna API yang sudah tiada. Jalankan Deployment `shop` yang sama dengan API hari ini: image sama, 3 replika, label `app=shop`.',
      hint: 'Cuba `kubectl apply` dan baca ralatnya. Deployment kini dalam `apps/v1`; `kubectl create deployment` gunanya.',
    },
    docs: { label: 'Kubernetes: deprecated API migration guide', url: 'https://kubernetes.io/docs/reference/using-api/deprecation-guide/' },
    solution: ['kubectl create deployment shop --image=nginx:1.29-alpine --replicas=3'],
  },

  // ------------------------------------------------------------------ more Environment, Configuration and Security
  {
    id: 'ckad-env-config-security-004',
    domain: 'env-config-security',
    scenario: 'exam-ckad-safe-secret',
    goal: { podsReady: { selector: 'app=safe', count: 2 } },
    en: {
      task: 'Mount Secret `safe-key` into container `app` of Deployment `safe`, at `/etc/safe`, read-only. Its readiness probe then finds the password file, and 2 pods get Ready.',
      hint: 'Patch two lists: a `secret` volume under `volumes`, and `volumeMounts` in container `app`.',
    },
    ms: {
      task: 'Mount Secret `safe-key` ke dalam container `app` Deployment `safe`, di `/etc/safe`, baca sahaja. Readiness probe akan jumpa fail kata laluan itu, dan 2 pod jadi Ready.',
      hint: 'Patch dua senarai: volume `secret` di bawah `volumes`, dan `volumeMounts` dalam container `app`.',
    },
    docs: { label: 'Kubernetes: Secrets as files', url: 'https://kubernetes.io/docs/concepts/configuration/secret/#using-secrets-as-files-from-a-pod' },
    solution: [
      `kubectl patch deployment safe -p '{"spec":{"template":{"spec":{"volumes":[{"name":"key","secret":{"secretName":"safe-key"}}],"containers":[{"name":"app","volumeMounts":[{"name":"key","mountPath":"/etc/safe","readOnly":true}]}]}}}}'`,
    ],
  },
  {
    id: 'ckad-env-config-security-005',
    domain: 'env-config-security',
    scenario: 'exam-ckad-board-config',
    goal: { podsReady: { selector: 'app=board', count: 2 }, objectExists: ['configmap/board-config'] },
    en: {
      task: 'Pods of Deployment `board` cannot start. They read key `mode` from ConfigMap `board-config`. Create it with `mode=lunch`.',
      hint: 'The pod STATUS says `CreateContainerConfigError`. `kubectl create configmap` takes `--from-literal`.',
    },
    ms: {
      task: 'Pod Deployment `board` tak dapat bermula. Ia baca kunci `mode` daripada ConfigMap `board-config`. Buat ConfigMap itu dengan `mode=lunch`.',
      hint: 'STATUS pod sebut `CreateContainerConfigError`. `kubectl create configmap` terima `--from-literal`.',
    },
    docs: { label: 'Kubernetes: ConfigMaps as env vars', url: 'https://kubernetes.io/docs/tasks/configure-pod-container/configure-pod-configmap/#define-container-environment-variables-using-configmap-data' },
    solution: ['kubectl create configmap board-config --from-literal=mode=lunch'],
  },
  {
    id: 'ckad-env-config-security-006',
    domain: 'env-config-security',
    scenario: 'exam-ckad-reporter',
    goal: {
      podsReady: { selector: 'app=report', count: 1 },
      canI: [
        { verb: 'list', resource: 'configmaps', as: 'system:serviceaccount:default:reporter', allowed: true },
        { verb: 'delete', resource: 'configmaps', as: 'system:serviceaccount:default:reporter', allowed: false },
      ],
    },
    en: {
      task: 'Deployment `report` has no pods: its ServiceAccount `reporter` is missing. Create it. It may get and list ConfigMaps in `default`, nothing more.',
      hint: 'Read the ReplicaSet events. Then: a ServiceAccount, a Role and a RoleBinding.',
    },
    ms: {
      task: 'Deployment `report` tiada pod: ServiceAccount `reporter`nya tiada. Buat ServiceAccount itu. Ia boleh get dan list ConfigMap dalam `default`, itu sahaja.',
      hint: 'Baca event ReplicaSet. Kemudian: satu ServiceAccount, satu Role dan satu RoleBinding.',
    },
    docs: { label: 'Kubernetes: ServiceAccounts', url: 'https://kubernetes.io/docs/concepts/security/service-accounts/' },
    solution: [
      'kubectl create serviceaccount reporter',
      'kubectl create role config-reader --verb=get,list --resource=configmaps',
      'kubectl create rolebinding reporter-reads --role=config-reader --serviceaccount=default:reporter',
    ],
  },
  {
    id: 'ckad-env-config-security-007',
    domain: 'env-config-security',
    scenario: 'exam-ckad-vault',
    goal: { podsReady: { selector: 'app=vault', count: 1, namespace: 'secure' }, podSecurity: { namespace: 'secure', level: 'restricted' } },
    en: {
      task: 'Deployment `vault` in namespace `secure` has no pods. The namespace enforces Pod Security `restricted`. Fix container `app` so its pods are allowed. Keep the namespace as it is.',
      hint: 'The ReplicaSet events say what is missing. Patch the container’s `securityContext`.',
    },
    ms: {
      task: 'Deployment `vault` dalam namespace `secure` tiada pod. Namespace itu kuatkuasakan Pod Security `restricted`. Baiki container `app` supaya pod dibenarkan. Kekalkan namespace itu.',
      hint: 'Event ReplicaSet sebut apa yang kurang. Patch `securityContext` container itu.',
    },
    docs: { label: 'Kubernetes: security context', url: 'https://kubernetes.io/docs/tasks/configure-pod-container/security-context/' },
    solution: [`kubectl patch deployment vault -n secure -p '{"spec":{"template":{"spec":{"containers":[{"name":"app","securityContext":{"capabilities":{"drop":["ALL"]}}}]}}}}'`],
  },
  {
    id: 'ckad-env-config-security-008',
    domain: 'env-config-security',
    scenario: 'exam-ckad-oven',
    goal: { podsReady: { selector: 'app=oven', count: 2 } },
    en: {
      task: 'Pods of Deployment `oven` are Pending: they ask for more CPU than any node has. Set its requests to `cpu=250m,memory=64Mi`.',
      hint: '`kubectl set resources` takes `--requests`.',
    },
    ms: {
      task: 'Pod Deployment `oven` dalam Pending: ia minta CPU lebih daripada mana-mana node. Tetapkan requests kepada `cpu=250m,memory=64Mi`.',
      hint: '`kubectl set resources` terima `--requests`.',
    },
    docs: { label: 'Kubernetes: resource requests and limits', url: 'https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/' },
    solution: ['kubectl set resources deployment oven --requests=cpu=250m,memory=64Mi'],
  },

  // ------------------------------------------------------------------ more Services and Networking
  {
    id: 'ckad-services-networking-003',
    domain: 'services-networking',
    scenario: 'exam-ckad-target-port',
    goal: { reachable: { url: 'http://api', from: 'client' } },
    en: {
      task: 'Service `api` has endpoints, but pod `client` gets no answer from `http://api`. The pods listen on port 80. Fix the Service.',
      hint: 'Compare `port` and `targetPort` with `kubectl describe service api`.',
    },
    ms: {
      task: 'Service `api` ada endpoint, tetapi pod `client` tak dapat jawapan daripada `http://api`. Pod itu dengar pada port 80. Baiki Service itu.',
      hint: 'Banding `port` dan `targetPort` dengan `kubectl describe service api`.',
    },
    docs: { label: 'Kubernetes: Service ports', url: 'https://kubernetes.io/docs/concepts/services-networking/service/#field-spec-ports' },
    solution: [`kubectl patch service api -p '{"spec":{"ports":[{"port":80,"targetPort":80}]}}'`],
  },
  {
    id: 'ckad-services-networking-004',
    domain: 'services-networking',
    scenario: 'exam-ckad-db-policy',
    goal: { reachable: { url: 'http://db', from: 'api' }, unreachable: { url: 'http://db', from: 'guest' } },
    en: {
      task: 'NetworkPolicy `db-allow` guards the `db` pods. Pod `api` must reach `http://db`; pod `guest` must not. Change labels only, not the policy.',
      hint: '`kubectl describe networkpolicy db-allow` shows which label may come in.',
    },
    ms: {
      task: 'NetworkPolicy `db-allow` kawal pod `db`. Pod `api` mesti sampai ke `http://db`; pod `guest` tak boleh. Ubah label sahaja, bukan policy itu.',
      hint: '`kubectl describe networkpolicy db-allow` tunjuk label mana yang boleh masuk.',
    },
    docs: { label: 'Kubernetes: Network Policies', url: 'https://kubernetes.io/docs/concepts/services-networking/network-policies/' },
    solution: ['kubectl label pod api role=api'],
  },
  {
    id: 'ckad-services-networking-005',
    domain: 'services-networking',
    scenario: 'exam-ckad-front-policy',
    goal: { reachable: { url: 'http://shop', from: 'front' }, unreachable: { url: 'http://shop', from: 'guest' } },
    en: {
      task: 'Only pods with `app=front` may reach the `shop` pods. NetworkPolicy `allow-front` should allow that, but `front` is blocked too. Fix that policy. Pod `guest` must stay blocked.',
      hint: 'Check which pods the policy’s `podSelector` picks. Patch it.',
    },
    ms: {
      task: 'Hanya pod dengan `app=front` boleh sampai ke pod `shop`. NetworkPolicy `allow-front` patut benarkannya, tetapi `front` pun tersekat. Baiki policy itu. Pod `guest` mesti kekal tersekat.',
      hint: 'Semak pod mana yang dipilih oleh `podSelector` policy itu. Patch ia.',
    },
    docs: { label: 'Kubernetes: Network Policies', url: 'https://kubernetes.io/docs/concepts/services-networking/network-policies/#networkpolicy-resource' },
    solution: [`kubectl patch networkpolicy allow-front -p '{"spec":{"podSelector":{"matchLabels":{"app":"shop"}}}}'`],
  },
  {
    id: 'ckad-services-networking-006',
    domain: 'services-networking',
    scenario: 'exam-ckad-kitchen-ns',
    goal: { serviceEndpoints: { name: 'kitchen', count: 2, namespace: 'back' }, reachable: { url: 'http://kitchen.back:8080', from: 'client' } },
    en: {
      task: 'Deployment `kitchen` runs in namespace `back`. Expose it as Service `kitchen` on port 8080; the pods listen on 80. Pod `client` in `default` must reach `http://kitchen.back:8080`.',
      hint: '`kubectl expose` takes `--port`, `--target-port` and `-n`.',
    },
    ms: {
      task: 'Deployment `kitchen` berjalan dalam namespace `back`. Dedahkan ia sebagai Service `kitchen` pada port 8080; pod itu dengar pada 80. Pod `client` dalam `default` mesti sampai ke `http://kitchen.back:8080`.',
      hint: '`kubectl expose` terima `--port`, `--target-port` dan `-n`.',
    },
    docs: { label: 'Kubernetes: DNS for Services', url: 'https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/#namespaces-of-services' },
    solution: ['kubectl expose deployment kitchen -n back --port=8080 --target-port=80'],
  },
  {
    id: 'ckad-services-networking-007',
    domain: 'services-networking',
    scenario: 'exam-ckad-gateway',
    goal: { reachable: { url: 'http://172.18.0.200/menu', contains: 'menu of the day' } },
    en: {
      task: 'Gateway `entrance` is up (see `kubectl get gateway`). Requests for `/menu` must reach the `menu` pods (port 5678). The route is ready in `route.yaml`, but Service `menu` is missing.',
      hint: 'Read `route.yaml`: it wants Service `menu` on port 80. Expose, then apply the route.',
    },
    ms: {
      task: 'Gateway `entrance` sudah sedia (lihat `kubectl get gateway`). Permintaan untuk `/menu` mesti sampai ke pod `menu` (port 5678). Route itu sedia dalam `route.yaml`, tetapi Service `menu` tiada.',
      hint: 'Baca `route.yaml`: ia mahu Service `menu` pada port 80. Expose, kemudian apply route itu.',
    },
    docs: { label: 'Kubernetes: Gateway API', url: 'https://kubernetes.io/docs/concepts/services-networking/gateway/' },
    solution: ['kubectl expose deployment menu --port=80 --target-port=5678', 'kubectl apply -f route.yaml'],
  },
];
