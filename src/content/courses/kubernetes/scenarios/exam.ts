// CKAD practice tasks (src/content/exams/ckad.ts) start from these clusters, or from any other
// Kubernetes scenario. `npm run verify:k8s` replays every `verify` list in the engine and, in CI,
// on a real kind cluster (Kubernetes 1.37). Ids start with `exam-ckad-`.
import type { KubeScenario } from '~/engine/foodcourt-sim';
import { SHOP_YAML } from './model';

const CLIENT_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: client
  labels:
    app: client
spec:
  containers:
    - name: box
      image: busybox:1.37
      command: ["sleep", "3600"]
`;

/** The menu board: 2 trays, but the image tag has a typo (alpne), so no tray ever starts. */
const MENU_TYPO_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: menu
spec:
  replicas: 2
  selector:
    matchLabels:
      app: menu
  template:
    metadata:
      labels:
        app: menu
    spec:
      containers:
        - name: web
          image: nginx:1.29-alpne
          ports:
            - containerPort: 80
`;

/** A Deployment `name` whose pods carry `app: <name>` (plus `labels`), with the given containers block. */
function deployment(name: string, replicas: number, containers: string, opts: { labels?: Record<string, string>; namespace?: string; podSpec?: string } = {}): string {
  const extra = Object.entries(opts.labels ?? {})
    .map(([k, v]) => `\n        ${k}: ${v}`)
    .join('');
  return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}${opts.namespace ? `\n  namespace: ${opts.namespace}` : ''}
spec:
  replicas: ${replicas}
  selector:
    matchLabels:
      app: ${name}
  template:
    metadata:
      labels:
        app: ${name}${extra}
    spec:${opts.podSpec ?? ''}
      containers:
${containers}`;
}

/** One nginx container `web` on port 80 (indented for `deployment`). */
const WEB = `        - name: web
          image: nginx:1.29-alpine
          ports:
            - containerPort: 80
`;

/** A ClusterIP Service on port 80 that picks pods by one label. */
function service(name: string, selector: string, targetPort = 80, port = 80): string {
  const [k, v] = selector.split('=');
  return `apiVersion: v1
kind: Service
metadata:
  name: ${name}
spec:
  selector:
    ${k}: ${v}
  ports:
    - port: ${port}
      targetPort: ${targetPort}
`;
}

const WGET = 'kubectl exec client -- wget -qO- -T 5';

// ---------------------------------------------------------------------------
// Starting clusters added with the bigger CKAD set (2026-11-01).

/** `menu` runs only a worker container; its Service waits on port 80 for a web container. */
const MENU_WORKER_YAML = deployment('menu', 2, `        - name: worker
          image: busybox:1.37
          command: ["sleep", "3600"]
`);

/** `kedai`'s prep cook (init container) gives up, so the web container never starts. */
const KEDAI_INIT_YAML = deployment('kedai', 2, WEB, {
  podSpec: `
      initContainers:
        - name: prep
          image: busybox:1.37
          command: ["sh", "-c", "echo looking for the menu; exit 1"]`,
});

/** The shop's trays carry `tier: shop`; the Service picks that label (room for a canary). */
const TIER_SHOP_YAML = deployment('shop', 3, WEB, { labels: { tier: 'shop' } });

/** `kedai` serves its page from ConfigMap `menu-page`, which nobody has made yet. */
const KEDAI_PAGE_YAML = deployment(
  'kedai',
  2,
  `${WEB}          volumeMounts:
            - name: page
              mountPath: /usr/share/nginx/html
`,
  { podSpec: `
      volumes:
        - name: page
          configMap:
            name: menu-page` },
);
const MENU_PAGE_HTML = '<h1>Nasi lemak RM5</h1>\n';

/** Namespace `kiosk` has a budget that wants requests and limits; `till` has neither. */
const KIOSK_QUOTA_YAML = `apiVersion: v1
kind: ResourceQuota
metadata:
  name: kiosk-quota
  namespace: kiosk
spec:
  hard:
    requests.cpu: "1"
    requests.memory: 512Mi
    limits.cpu: "2"
    limits.memory: 1Gi
`;
const TILL_YAML = deployment('till', 2, `        - name: app
          image: busybox:1.37
          command: ["sleep", "3600"]
`, { namespace: 'kiosk' });

/** `api` checks a page that does not exist, so its pods never get Ready. */
const SHY_API_YAML = deployment('api', 2, `${WEB}          readinessProbe:
            httpGet:
              path: /ready
              port: 80
            periodSeconds: 5
`);

/** A busybox pod that sleeps (a place to run wget from), with its own labels. */
function sleeper(name: string, labels: Record<string, string>): string {
  return `apiVersion: v1
kind: Pod
metadata:
  name: ${name}
  labels:
${Object.entries(labels)
  .map(([k, v]) => `    ${k}: ${v}\n`)
  .join('')}spec:
  containers:
    - name: box
      image: busybox:1.37
      command: ["sleep", "3600"]
`;
}

const BUSY = `        - name: app
          image: busybox:1.37
          command: ["sleep", "3600"]
`;

/** `ledger` keeps its book on claim `ledger-data`; the claim is only in the folder. */
const LEDGER_YAML = deployment('ledger', 1, `${BUSY}          volumeMounts:\n            - name: data\n              mountPath: /data\n`, {
  podSpec: `\n      volumes:\n        - name: data\n          persistentVolumeClaim:\n            claimName: ledger-data`,
});
const LEDGER_CLAIM_YAML = `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ledger-data
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: standard
  resources:
    requests:
      storage: 1Gi
`;

/** Job `tally` has a command that always fails; with backoffLimit 1 it gives up (Failed). */
const TALLY_YAML = `apiVersion: batch/v1
kind: Job
metadata:
  name: tally
spec:
  backoffLimit: 1
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: tally
          image: busybox:1.37
          command: ["sh", "-c", "echo counting trays; exit 1"]
`;

/** A Deployment written for an API that was removed long ago. */
const OLD_API_YAML = SHOP_YAML.replace('apps/v1', 'extensions/v1beta1');

/** `chef` only runs on a stall labelled `disk: ssd`; no stall has that label. */
const CHEF_YAML = deployment('chef', 2, WEB, { podSpec: `\n      nodeSelector:\n        disk: ssd` });

/** `till` (postgres) has no password, so it stops at once. The image is not in the CI preload list. */
const TILL_PG_YAML = deployment('till', 1, `        - name: db\n          image: postgres:18-alpine\n          ports:\n            - containerPort: 5432\n`);

/** `safe` is Ready only when it can read /etc/safe/password (from a Secret it does not mount yet). */
const SAFE_YAML = deployment('safe', 2, `${BUSY}          readinessProbe:\n            exec:\n              command: ["cat", "/etc/safe/password"]\n            periodSeconds: 5\n`);
const SAFE_KEY_YAML = `apiVersion: v1
kind: Secret
metadata:
  name: safe-key
stringData:
  password: kancil123
`;

/** `board` reads key `mode` of ConfigMap `board-config`, which nobody made. */
const BOARD_YAML = deployment('board', 2, `${BUSY}          env:\n            - name: MODE\n              valueFrom:\n                configMapKeyRef:\n                  name: board-config\n                  key: mode\n`);

/** `report` runs as ServiceAccount `reporter`, which does not exist yet. */
const REPORT_YAML = deployment('report', 1, BUSY, { podSpec: `\n      serviceAccountName: reporter` });

/** Namespace `secure` enforces the restricted Pod Security level; `vault` misses one setting. */
const VAULT_YAML = deployment(
  'vault',
  1,
  `${BUSY}          securityContext:\n            allowPrivilegeEscalation: false\n`,
  { namespace: 'secure', podSpec: `\n      securityContext:\n        runAsNonRoot: true\n        runAsUser: 1000\n        seccompProfile:\n          type: RuntimeDefault` },
);

/** `oven` asks for 64 CPUs: no stall has that many. */
const OVEN_YAML = deployment('oven', 2, `${BUSY}          resources:\n            requests:\n              cpu: "64"\n`);

/** Blue and green shops, each serving its own page; Service `shop` picks blue. */
const colourShop = (colour: string) =>
  deployment(`shop-${colour}`, 2, `${WEB}          volumeMounts:\n            - name: page\n              mountPath: /usr/share/nginx/html\n`, {
    labels: { role: 'shop', version: colour },
    podSpec: `\n      volumes:\n        - name: page\n          configMap:\n            name: ${colour}-page`,
  });
const BLUE_GREEN_SVC_YAML = `apiVersion: v1
kind: Service
metadata:
  name: shop
spec:
  selector:
    role: shop
    version: blue
  ports:
    - port: 80
      targetPort: 80
`;

/** NetworkPolicy `db-allow`: only pods labelled `role: api` may reach `app: db` on port 80. */
const DB_ALLOW_YAML = `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: db-allow
spec:
  podSelector:
    matchLabels:
      app: db
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              role: api
      ports:
        - port: 80
`;

/** Deny every ingress in `default`, plus an allow rule for `app: front` that selects the wrong pods (shops). */
const DENY_ALL_YAML = `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all
spec:
  podSelector: {}
  policyTypes:
    - Ingress
`;
const ALLOW_FRONT_YAML = `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-front
spec:
  podSelector:
    matchLabels:
      app: shops
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: front
      ports:
        - port: 80
`;

/** Kustomize: a base (1 tray of nginx:1.29-alpine) and a prod overlay (namespace prod, 3 trays, 1.30). */
const KEDAI_KZ_FILES: Record<string, string> = {
  'kedai/base/deployment.yaml': deployment('shop', 1, WEB),
  'kedai/base/kustomization.yaml': 'resources:\n  - deployment.yaml\n',
  'kedai/overlays/prod/kustomization.yaml': `resources:
  - ../../base
namespace: prod
replicas:
  - name: shop
    count: 3
images:
  - name: nginx
    newTag: 1.30-alpine
`,
};

/** `kedai` reads ConfigMap `prices` as env vars; the ConfigMap changes after the pods start. */
const PRICES_V1 = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: prices\ndata:\n  NASI_LEMAK: "5"\n';
const PRICES_V2 = PRICES_V1.replace('"5"', '"6"');
const KEDAI_PRICES_YAML = deployment('kedai', 3, `${BUSY}          envFrom:\n            - configMapRef:\n                name: prices\n`);

/** `menu` answers on 5678 (http-echo); the Gateway has no route and the Service is missing. */
const MENU_ECHO_YAML = deployment('menu', 2, `        - name: echo\n          image: hashicorp/http-echo:1.0\n          args: ["-text=menu of the day"]\n          ports:\n            - containerPort: 5678\n`);
const ENTRANCE_YAML = `apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: entrance
spec:
  gatewayClassName: eg
  listeners:
    - name: http
      protocol: HTTP
      port: 80
`;
const MENU_ROUTE_YAML = `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: menu
spec:
  parentRefs:
    - name: entrance
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /menu
      backendRefs:
        - name: menu
          port: 80
`;

export const examScenarios: KubeScenario[] = [
  {
    // A fresh cluster: the learner builds a workload from nothing.
    id: 'exam-ckad-empty',
    verify: [
      ['kubectl create job report --image=busybox:1.37 -- echo done', 'kubectl wait --for=condition=complete job/report --timeout=60s', 'kubectl get job report'],
      // The task's CronJob runs every 15 minutes; here it runs once a day, so it never fires mid-check.
      [
        'kubectl create cronjob cleanup --image=busybox:1.37 --schedule="30 2 * * *" -- echo sweep',
        'kubectl create job cleanup-now --from=cronjob/cleanup',
        'kubectl wait --for=condition=complete job/cleanup-now --timeout=60s',
        'kubectl get cronjob cleanup -o jsonpath={.spec.schedule}',
        'kubectl logs job/cleanup-now',
      ],
      ['kubectl create namespace cafe', 'kubectl create deployment kopi --image=nginx:1.30-alpine --replicas=3 --port=80 -n cafe', 'kubectl rollout status deployment/kopi -n cafe --timeout=180s', 'kubectl get deployment kopi -n cafe -o wide'],
    ],
  },
  {
    // The shop (3 trays of nginx:1.29-alpine) and a client pod. No Service yet.
    id: 'exam-ckad-shop',
    files: { 'shop.yaml': SHOP_YAML, 'client.yaml': CLIENT_YAML },
    steps: ['kubectl apply -f shop.yaml', 'kubectl apply -f client.yaml'],
    verify: [
      ['kubectl set image deployment/shop web=nginx:1.30-alpine', 'kubectl rollout status deployment/shop --timeout=180s', 'kubectl get deployment shop'],
      ['kubectl expose deployment shop --port=80', 'kubectl get service shop', 'kubectl exec client -- wget -qO- -T 5 http://shop'],
    ],
  },
  {
    // A Deployment whose image tag has a typo: its pods never become Ready.
    id: 'exam-ckad-menu-typo',
    files: { 'menu.yaml': MENU_TYPO_YAML },
    steps: ['kubectl apply -f menu.yaml', { tick: 30 }],
    verify: [['kubectl get deployment menu', 'kubectl set image deployment/menu web=nginx:1.29-alpine', 'kubectl rollout status deployment/menu --timeout=180s', 'kubectl get deployment menu']],
  },
  {
    // A ServiceAccount for the CI bot, with no rights yet.
    id: 'exam-ckad-ci-bot',
    steps: ['kubectl create serviceaccount ci-bot'],
    verify: [
      [
        'kubectl auth can-i list pods --as=system:serviceaccount:default:ci-bot',
        'kubectl create role pod-reader --verb=get,list,watch --resource=pods',
        'kubectl create rolebinding ci-bot-reads --role=pod-reader --serviceaccount=default:ci-bot',
        'kubectl auth can-i list pods --as=system:serviceaccount:default:ci-bot',
        'kubectl auth can-i delete pods --as=system:serviceaccount:default:ci-bot',
      ],
    ],
  },
  {
    // A worker-only Deployment behind Service `menu` (port 80, nobody listens yet) and a client pod.
    id: 'exam-ckad-menu-worker',
    files: { 'menu.yaml': MENU_WORKER_YAML, 'service.yaml': service('menu', 'app=menu'), 'client.yaml': CLIENT_YAML },
    steps: ['kubectl apply -f menu.yaml', 'kubectl apply -f service.yaml', 'kubectl apply -f client.yaml'],
    verify: [
      [
        `kubectl patch deployment menu -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","image":"nginx:1.29-alpine","ports":[{"containerPort":80}]}]}}}}'`,
        'kubectl rollout status deployment/menu --timeout=180s',
        'kubectl get deployment menu',
        `${WGET} http://menu`,
      ],
    ],
  },
  {
    // An init container that always fails: the pods stay at Init.
    id: 'exam-ckad-kedai-init',
    files: { 'kedai.yaml': KEDAI_INIT_YAML },
    steps: ['kubectl apply -f kedai.yaml', { tick: 40 }],
    settle: false,
    verify: [
      [
        `kubectl patch deployment kedai -p '{"spec":{"template":{"spec":{"initContainers":[{"name":"prep","command":["sh","-c","echo menu ready"]}]}}}}'`,
        'kubectl rollout status deployment/kedai --timeout=240s',
        'kubectl get deployment kedai',
      ],
    ],
  },
  {
    // A release with a tag that does not exist: stuck at revision 2, the old trays still serve.
    id: 'exam-ckad-bad-release',
    files: { 'shop.yaml': SHOP_YAML },
    steps: ['kubectl apply -f shop.yaml', { settle: true }, 'kubectl set image deployment/shop web=nginx:1.300-alpine', { tick: 30 }],
    settle: false,
    verify: [['kubectl rollout history deployment/shop', 'kubectl rollout undo deployment/shop', 'kubectl rollout status deployment/shop --timeout=180s', 'kubectl get deployment shop']],
  },
  {
    // 3 trays with `tier: shop`, Service `shop` picks `tier=shop`, and a client pod.
    id: 'exam-ckad-canary',
    files: { 'shop.yaml': TIER_SHOP_YAML, 'service.yaml': service('shop', 'tier=shop'), 'client.yaml': CLIENT_YAML },
    steps: ['kubectl apply -f shop.yaml', 'kubectl apply -f service.yaml', 'kubectl apply -f client.yaml'],
    verify: [
      [
        'kubectl create deployment shop-canary --image=nginx:1.30-alpine --replicas=1',
        `kubectl patch deployment shop-canary -p '{"spec":{"template":{"metadata":{"labels":{"tier":"shop"}}}}}'`,
        'kubectl rollout status deployment/shop-canary --timeout=180s',
        'kubectl get endpointslices -l kubernetes.io/service-name=shop -o jsonpath={.items[*].endpoints[*].targetRef.kind}',
      ],
    ],
  },
  {
    // `kedai` mounts ConfigMap `menu-page`, which is missing: the pods wait in ContainerCreating.
    id: 'exam-ckad-menu-page',
    files: { 'kedai.yaml': KEDAI_PAGE_YAML, 'service.yaml': service('kedai', 'app=kedai'), 'client.yaml': CLIENT_YAML, 'index.html': MENU_PAGE_HTML },
    steps: ['kubectl apply -f kedai.yaml', 'kubectl apply -f service.yaml', 'kubectl apply -f client.yaml', { tick: 20 }],
    settle: false,
    verify: [['kubectl create configmap menu-page --from-file=index.html', 'kubectl rollout status deployment/kedai --timeout=240s', `${WGET} http://kedai`]],
  },
  {
    // Namespace `kiosk` with a ResourceQuota on requests and limits; `till` asks for neither, so it has no pods.
    id: 'exam-ckad-quota',
    files: { 'quota.yaml': KIOSK_QUOTA_YAML, 'till.yaml': TILL_YAML },
    steps: ['kubectl create namespace kiosk', 'kubectl apply -f quota.yaml', 'kubectl apply -f till.yaml'],
    verify: [
      [
        'kubectl get deployment till -n kiosk',
        'kubectl set resources deployment till -n kiosk --requests=cpu=100m,memory=64Mi --limits=cpu=200m,memory=128Mi',
        'kubectl rollout status deployment/till -n kiosk --timeout=180s',
        'kubectl get deployment till -n kiosk',
      ],
    ],
  },
  {
    // Service `menu` has a typo in its selector (menus): no endpoints.
    id: 'exam-ckad-wrong-selector',
    files: { 'menu.yaml': deployment('menu', 2, WEB), 'service.yaml': service('menu', 'app=menus'), 'client.yaml': CLIENT_YAML },
    steps: ['kubectl apply -f menu.yaml', 'kubectl apply -f service.yaml', 'kubectl apply -f client.yaml'],
    verify: [
      [
        `kubectl patch service menu -p '{"spec":{"selector":{"app":"menu"}}}'`,
        'kubectl get endpointslices -l kubernetes.io/service-name=menu -o jsonpath={.items[*].endpoints[*].conditions.ready}',
        `${WGET} http://menu`,
      ],
    ],
  },
  {
    // `api`'s readiness probe asks for /ready (404): Running, never Ready.
    id: 'exam-ckad-shy-api',
    files: { 'api.yaml': SHY_API_YAML },
    steps: ['kubectl apply -f api.yaml', { tick: 30 }],
    settle: false,
    verify: [
      [
        `kubectl patch deployment api -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","readinessProbe":{"httpGet":{"path":"/"}}}]}}}}'`,
        'kubectl rollout status deployment/api --timeout=180s',
        'kubectl get deployment api',
      ],
    ],
  },
  {
    // `ledger` needs claim `ledger-data`; only the folder has it (claim.yaml). The pod waits in Pending.
    id: 'exam-ckad-ledger-claim',
    files: { 'ledger.yaml': LEDGER_YAML, 'claim.yaml': LEDGER_CLAIM_YAML },
    steps: ['kubectl apply -f ledger.yaml', { tick: 20 }],
    settle: false,
    verify: [['kubectl get pvc', 'kubectl apply -f claim.yaml', 'kubectl rollout status deployment/ledger --timeout=180s', 'kubectl get pvc ledger-data -o jsonpath={.status.phase}']],
  },
  {
    // Job `tally` failed (its command exits 1, backoffLimit 1). A Job's pod template cannot change.
    id: 'exam-ckad-tally',
    files: { 'tally.yaml': TALLY_YAML },
    steps: ['kubectl apply -f tally.yaml', { tick: 90 }],
    settle: false,
    verify: [
      [
        'kubectl delete job tally',
        'kubectl create job tally --image=busybox:1.37 -- echo counted',
        'kubectl wait --for=condition=complete job/tally --timeout=60s',
        'kubectl logs job/tally',
      ],
    ],
  },
  {
    // shop at revision 1 (1.29), 2 (1.30) and 3 (a tag that does not exist, stuck).
    id: 'exam-ckad-three-releases',
    files: { 'shop.yaml': SHOP_YAML },
    steps: [
      'kubectl apply -f shop.yaml',
      { settle: true },
      'kubectl set image deployment/shop web=nginx:1.30-alpine',
      { settle: true },
      'kubectl set image deployment/shop web=nginx:1.300-alpine',
      { tick: 30 },
    ],
    settle: false,
    verify: [['kubectl rollout undo deployment/shop --to-revision=1', 'kubectl rollout status deployment/shop --timeout=180s', 'kubectl get deployment shop -o wide', 'kubectl rollout history deployment/shop']],
  },
  {
    // shop-blue and shop-green (2 trays each, own pages); Service `shop` picks version=blue.
    id: 'exam-ckad-blue-green',
    files: {
      'blue.yaml': colourShop('blue'),
      'green.yaml': colourShop('green'),
      'service.yaml': BLUE_GREEN_SVC_YAML,
      'client.yaml': CLIENT_YAML,
    },
    steps: [
      'kubectl create configmap blue-page --from-literal=index.html=blue',
      'kubectl create configmap green-page --from-literal=index.html=green',
      'kubectl apply -f blue.yaml',
      'kubectl apply -f green.yaml',
      'kubectl apply -f service.yaml',
      'kubectl apply -f client.yaml',
    ],
    verify: [[`${WGET} http://shop`, `kubectl patch service shop -p '{"spec":{"selector":{"version":"green"}}}'`, `${WGET} http://shop`, `${WGET} http://shop`]],
  },
  {
    // A Kustomize base and a prod overlay; namespace `prod` does not exist yet.
    id: 'exam-ckad-kustomize',
    files: KEDAI_KZ_FILES,
    verify: [
      [
        'kubectl kustomize kedai/overlays/prod',
        'kubectl create namespace prod',
        'kubectl apply -k kedai/overlays/prod',
        'kubectl rollout status deployment/shop -n prod --timeout=180s',
        'kubectl get deployment shop -n prod -o wide',
      ],
    ],
  },
  {
    // kedai reads ConfigMap `prices` (env); then the ConfigMap changes. The pods still have the old value.
    id: 'exam-ckad-prices',
    files: { 'kedai.yaml': KEDAI_PRICES_YAML },
    steps: [
      { write: 'prices.yaml', content: PRICES_V1 },
      'kubectl apply -f prices.yaml',
      'kubectl apply -f kedai.yaml',
      { settle: true },
      { write: 'prices.yaml', content: PRICES_V2 },
      'kubectl apply -f prices.yaml',
    ],
    verify: [
      [
        'kubectl exec deploy/kedai -- printenv NASI_LEMAK',
        'kubectl rollout restart deployment/kedai',
        'kubectl rollout status deployment/kedai --timeout=180s',
        'kubectl exec deploy/kedai -- printenv NASI_LEMAK',
      ],
    ],
  },
  {
    // A Deployment file for extensions/v1beta1 (gone since Kubernetes 1.16).
    id: 'exam-ckad-old-api',
    files: { 'old-shop.yaml': OLD_API_YAML },
    verify: [['kubectl create deployment shop --image=nginx:1.29-alpine --replicas=3', 'kubectl rollout status deployment/shop --timeout=180s', 'kubectl get deployment shop -o wide']],
  },
  {
    // `chef` wants a stall labelled disk=ssd: FailedScheduling, Pending.
    id: 'exam-ckad-chef-pending',
    files: { 'chef.yaml': CHEF_YAML },
    steps: ['kubectl apply -f chef.yaml', { tick: 10 }],
    settle: false,
    verify: [
      [`kubectl patch deployment chef -p '{"spec":{"template":{"spec":{"nodeSelector":null}}}}'`, 'kubectl rollout status deployment/chef --timeout=180s', 'kubectl get deployment chef'],
      // Node labels stay on the real cluster between lists, so this one takes its label off again.
      ['kubectl label node dev-worker disk=ssd', 'kubectl rollout status deployment/chef --timeout=180s', 'kubectl get pods -l app=chef -o jsonpath={.items[*].spec.nodeName}', 'kubectl label node dev-worker disk-'],
    ],
  },
  {
    // postgres with no password: it prints why and stops (CrashLoopBackOff).
    id: 'exam-ckad-till-logs',
    files: { 'till.yaml': TILL_PG_YAML },
    steps: ['kubectl apply -f till.yaml', { tick: 60 }],
    settle: false,
    engineOnly: 'postgres:18-alpine is not in the images CI preloads into kind (pull limits)',
    verify: [['kubectl logs deploy/till', 'kubectl set env deployment/till POSTGRES_PASSWORD=kancil123', 'kubectl rollout status deployment/till --timeout=180s', 'kubectl get deployment till']],
  },
  {
    // `safe` and Secret `safe-key`; the pods are not Ready until the Secret is mounted at /etc/safe.
    id: 'exam-ckad-safe-secret',
    files: { 'safe.yaml': SAFE_YAML, 'secret.yaml': SAFE_KEY_YAML },
    steps: ['kubectl apply -f secret.yaml', 'kubectl apply -f safe.yaml', { tick: 30 }],
    settle: false,
    verify: [
      [
        `kubectl patch deployment safe -p '{"spec":{"template":{"spec":{"volumes":[{"name":"key","secret":{"secretName":"safe-key"}}],"containers":[{"name":"app","volumeMounts":[{"name":"key","mountPath":"/etc/safe","readOnly":true}]}]}}}}'`,
        'kubectl rollout status deployment/safe --timeout=180s',
        'kubectl exec deploy/safe -- cat /etc/safe/password',
      ],
    ],
  },
  {
    // `board` reads a key of a ConfigMap that is missing: CreateContainerConfigError.
    id: 'exam-ckad-board-config',
    files: { 'board.yaml': BOARD_YAML },
    steps: ['kubectl apply -f board.yaml', { tick: 20 }],
    settle: false,
    verify: [['kubectl create configmap board-config --from-literal=mode=lunch', 'kubectl rollout status deployment/board --timeout=180s', 'kubectl exec deploy/board -- printenv MODE']],
  },
  {
    // `report` runs as ServiceAccount `reporter`, which is missing: the ReplicaSet cannot make pods.
    id: 'exam-ckad-reporter',
    files: { 'report.yaml': REPORT_YAML },
    steps: ['kubectl apply -f report.yaml', { tick: 5 }],
    settle: false,
    verify: [
      [
        'kubectl create serviceaccount reporter',
        'kubectl create role config-reader --verb=get,list --resource=configmaps',
        'kubectl create rolebinding reporter-reads --role=config-reader --serviceaccount=default:reporter',
        'kubectl rollout status deployment/report --timeout=240s',
        'kubectl auth can-i list configmaps --as=system:serviceaccount:default:reporter',
      ],
    ],
  },
  {
    // Namespace `secure` enforces restricted; `vault` does not drop its capabilities, so it has no pods.
    id: 'exam-ckad-vault',
    files: { 'vault.yaml': VAULT_YAML },
    steps: ['kubectl create namespace secure', 'kubectl label namespace secure pod-security.kubernetes.io/enforce=restricted', { try: 'kubectl apply -f vault.yaml' }, { tick: 5 }],
    settle: false,
    verify: [
      [
        `kubectl patch deployment vault -n secure -p '{"spec":{"template":{"spec":{"containers":[{"name":"app","securityContext":{"capabilities":{"drop":["ALL"]}}}]}}}}'`,
        'kubectl rollout status deployment/vault -n secure --timeout=240s',
        'kubectl get deployment vault -n secure',
      ],
    ],
  },
  {
    // `oven` asks for 64 CPUs: Pending on every stall.
    id: 'exam-ckad-oven',
    files: { 'oven.yaml': OVEN_YAML },
    steps: ['kubectl apply -f oven.yaml', { tick: 10 }],
    settle: false,
    verify: [['kubectl set resources deployment oven --requests=cpu=250m,memory=64Mi', 'kubectl rollout status deployment/oven --timeout=180s', 'kubectl get deployment oven']],
  },
  {
    // Service `api` sends port 80 to targetPort 8080, but nginx listens on 80.
    id: 'exam-ckad-target-port',
    files: { 'api.yaml': deployment('api', 2, WEB), 'service.yaml': service('api', 'app=api', 8080), 'client.yaml': CLIENT_YAML },
    steps: ['kubectl apply -f api.yaml', 'kubectl apply -f service.yaml', 'kubectl apply -f client.yaml'],
    verify: [[`kubectl patch service api -p '{"spec":{"ports":[{"port":80,"targetPort":80}]}}'`, 'kubectl get service api -o jsonpath={.spec.ports[0].targetPort}', `kubectl exec client -- wget -qO- -T 5 http://api`]],
  },
  {
    // The db pods are guarded by NetworkPolicy db-allow (from role=api only). Pod `api` lacks the label.
    id: 'exam-ckad-db-policy',
    files: {
      'db.yaml': deployment('db', 1, WEB),
      'service.yaml': service('db', 'app=db'),
      'api.yaml': sleeper('api', { app: 'api' }),
      'guest.yaml': sleeper('guest', { app: 'guest' }),
      'policy.yaml': DB_ALLOW_YAML,
    },
    steps: ['kubectl apply -f db.yaml', 'kubectl apply -f service.yaml', 'kubectl apply -f api.yaml', 'kubectl apply -f guest.yaml', 'kubectl apply -f policy.yaml'],
    verify: [['kubectl label pod api role=api', 'kubectl exec api -- wget -qO- -T 5 http://db', 'kubectl get pod api --show-labels']],
  },
  {
    // deny-all plus allow-front, whose podSelector has a typo (shops): front is blocked too.
    id: 'exam-ckad-front-policy',
    files: {
      'shop.yaml': deployment('shop', 2, WEB),
      'service.yaml': service('shop', 'app=shop'),
      'front.yaml': sleeper('front', { app: 'front' }),
      'guest.yaml': sleeper('guest', { app: 'guest' }),
      'deny-all.yaml': DENY_ALL_YAML,
      'allow-front.yaml': ALLOW_FRONT_YAML,
    },
    steps: ['kubectl apply -f shop.yaml', 'kubectl apply -f service.yaml', 'kubectl apply -f front.yaml', 'kubectl apply -f guest.yaml', 'kubectl apply -f deny-all.yaml', 'kubectl apply -f allow-front.yaml'],
    verify: [[`kubectl patch networkpolicy allow-front -p '{"spec":{"podSelector":{"matchLabels":{"app":"shop"}}}}'`, 'kubectl exec front -- wget -qO- -T 5 http://shop', 'kubectl get networkpolicy']],
  },
  {
    // `kitchen` runs in namespace `back`; the client lives in `default`.
    id: 'exam-ckad-kitchen-ns',
    files: { 'kitchen.yaml': deployment('kitchen', 2, WEB, { namespace: 'back' }), 'client.yaml': CLIENT_YAML },
    steps: ['kubectl create namespace back', 'kubectl apply -f kitchen.yaml', 'kubectl apply -f client.yaml'],
    verify: [['kubectl expose deployment kitchen -n back --port=8080 --target-port=80', 'kubectl get service kitchen -n back -o jsonpath={.spec.ports[0].targetPort}', `${WGET} http://kitchen.back:8080`]],
  },
  {
    // Gateway `entrance` is up; the HTTPRoute is only a file, and Service `menu` is missing.
    id: 'exam-ckad-gateway',
    clusters: [{ name: 'kind-dev', gateway: true }],
    files: { 'menu.yaml': MENU_ECHO_YAML, 'entrance.yaml': ENTRANCE_YAML, 'route.yaml': MENU_ROUTE_YAML },
    steps: ['kubectl apply -f menu.yaml', 'kubectl apply -f entrance.yaml'],
    engineOnly: 'needs the Gateway API CRDs and a Gateway controller (Envoy Gateway); kind has none by default',
    verify: [['kubectl expose deployment menu --port=80 --target-port=5678', 'kubectl apply -f route.yaml', 'kubectl get httproute menu', 'curl -s http://172.18.0.200/menu']],
  },
];
