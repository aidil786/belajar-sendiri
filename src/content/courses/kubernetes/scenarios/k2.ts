// World K2 "Trays & Orders" scenarios (food-court engine, Kubernetes 1.37).
// Every `verify` list is replayed by `npm run verify:k8s` in the engine and, in CI, on a real
// kind cluster (kind-dev). Lists end in a steady state and read only stable outputs
// (rollout status / wait first; no `logs --previous`; restart counts are never printed).
// Images are the ones CI preloads (nginx:1.29-alpine, nginx:1.30-alpine, busybox:1.37), plus
// tags that do not exist on purpose (nginx:1.299, nginx:1.300-alpine) for ImagePullBackOff.
import type { KubeScenario } from '~/engine/foodcourt-sim';
import { SHOP_SVC_YAML, SHOP_YAML } from './model';

/** A lone pod: one tray, no manager. */
const TRAY_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: tray
  labels:
    app: tray
spec:
  containers:
    - name: web
      image: nginx:1.29-alpine
      ports:
        - containerPort: 80
`;

/** Two containers on one tray: they share the pod's IP (localhost). */
const DUO_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: duo
  labels:
    app: duo
spec:
  containers:
    - name: web
      image: nginx:1.29-alpine
      ports:
        - containerPort: 80
    - name: helper
      image: busybox:1.37
      command: ["sleep", "3600"]
`;

/** A prep cook (init container), a sweeper who stays all day (native sidecar) and the web server. */
const KEDAI_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: kedai
  labels:
    app: kedai
spec:
  initContainers:
    - name: prep
      image: busybox:1.37
      command: ["sh", "-c", "echo laying out the menu; sleep 5"]
    - name: sweeper
      image: busybox:1.37
      restartPolicy: Always
      command: ["sh", "-c", "echo sweeping all day; sleep 3600"]
  containers:
    - name: web
      image: nginx:1.29-alpine
      ports:
        - containerPort: 80
`;

/** The prep cook gives up: the web server never starts. */
const NOPREP_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: noprep
  labels:
    app: noprep
spec:
  initContainers:
    - name: prep
      image: busybox:1.37
      command: ["sh", "-c", "echo where is the menu file; exit 1"]
  containers:
    - name: web
      image: nginx:1.29-alpine
`;

/** A ReplicaSet: always 3 trays. */
const TRAYS_RS_YAML = `apiVersion: apps/v1
kind: ReplicaSet
metadata:
  name: trays
spec:
  replicas: 3
  selector:
    matchLabels:
      app: tray
  template:
    metadata:
      labels:
        app: tray
    spec:
      containers:
        - name: web
          image: nginx:1.29-alpine
`;

/** The shop with 1 tray (the boss starts here). */
const SHOP_ONE_YAML = SHOP_YAML.replace('replicas: 3', 'replicas: 1');

/** Four trays in trouble (L07): no room, crash, out of memory, a typo in the image tag. */
const loneBox = (name: string, container: string) => `apiVersion: v1
kind: Pod
metadata:
  name: ${name}
  labels:
    app: ${name}
spec:
  containers:
${container}`;
const STATES_YAML = [
  loneBox('big', `    - name: app\n      image: busybox:1.37\n      command: ["sleep", "3600"]\n      resources:\n        requests:\n          cpu: "64"\n`),
  loneBox('oops', `    - name: app\n      image: busybox:1.37\n      command: ["sh", "-c", "echo starting the kitchen; echo oh no, no gas; exit 1"]\n`),
  loneBox('hungry', `    - name: app\n      image: busybox:1.37\n      command: ["sh", "-c", "tail /dev/zero"]\n      resources:\n        limits:\n          memory: 64Mi\n`),
  loneBox('typo', `    - name: web\n      image: nginx:1.299\n`),
].join('---\n');

/** Liveness probe on a page that does not exist: nginx answers 404, so the kubelet restarts the cook. */
const SLEEPY_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: sleepy
  labels:
    app: sleepy
spec:
  containers:
    - name: web
      image: nginx:1.29-alpine
      livenessProbe:
        httpGet:
          path: /healthz
          port: 80
        periodSeconds: 5
        failureThreshold: 3
`;

/** Readiness probe on a missing page: Running, never Ready, never restarted. */
const SHY_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: shy
  labels:
    app: shy
spec:
  containers:
    - name: web
      image: nginx:1.29-alpine
      readinessProbe:
        httpGet:
          path: /ready
          port: 80
        periodSeconds: 5
`;

/** A Deployment that asks for far more CPU than any stall has. */
const BIG_DEPLOY_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: big
spec:
  replicas: 1
  selector:
    matchLabels:
      app: big
  template:
    metadata:
      labels:
        app: big
    spec:
      containers:
        - name: app
          image: busybox:1.37
          command: ["sleep", "3600"]
          resources:
            requests:
              cpu: "64"
`;

const qosPod = (name: string, resources: string) => `apiVersion: v1
kind: Pod
metadata:
  name: ${name}
  labels:
    app: ${name}
spec:
  containers:
    - name: app
      image: busybox:1.37
      command: ["sleep", "3600"]
${resources}`;

/** Requests = limits for CPU and memory: Guaranteed. */
const GOLD_YAML = qosPod(
  'gold',
  `      resources:
        requests:
          cpu: 100m
          memory: 64Mi
        limits:
          cpu: 100m
          memory: 64Mi
`,
);
/** Only a request: Burstable. */
const SILVER_YAML = qosPod(
  'silver',
  `      resources:
        requests:
          cpu: 100m
          memory: 64Mi
`,
);
/** Nothing at all: BestEffort. */
const BRONZE_YAML = qosPod('bronze', '');

/** One sweeper per stall. */
const SWEEPER_YAML = `apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: sweeper
spec:
  selector:
    matchLabels:
      app: sweeper
  template:
    metadata:
      labels:
        app: sweeper
    spec:
      containers:
        - name: broom
          image: busybox:1.37
          command: ["sleep", "3600"]
`;

/** Trays with names that stay: web-0, web-1, web-2 (plus the headless Service they need). */
const WEB_STS_YAML = `apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  clusterIP: None
  selector:
    app: web
  ports:
    - port: 80
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: web
spec:
  serviceName: web
  replicas: 3
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:1.29-alpine
          ports:
            - containerPort: 80
`;

/** Count the plates once, then stop. */
const TALLY_YAML = `apiVersion: batch/v1
kind: Job
metadata:
  name: tally
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: count
          image: busybox:1.37
          command: ["sh", "-c", "echo counting plates; echo 42 plates"]
`;

/** The same count, every night at 23:30 (UTC). */
const NIGHTLY_YAML = `apiVersion: batch/v1
kind: CronJob
metadata:
  name: nightly
spec:
  schedule: "30 23 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: count
              image: busybox:1.37
              command: ["sh", "-c", "echo counting plates; echo 42 plates"]
`;

/** Blue/green: two full kitchens, each serving its own menu page from a ConfigMap. */
const colourYaml = (colour: string, version: string, image: string) => `apiVersion: v1
kind: ConfigMap
metadata:
  name: menu-${colour}
data:
  index.html: |
    <h1>Kedai Kancil menu ${version}</h1>
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop-${colour}
spec:
  replicas: 2
  selector:
    matchLabels:
      app: shop
      version: ${colour}
  template:
    metadata:
      labels:
        app: shop
        version: ${colour}
    spec:
      containers:
        - name: web
          image: ${image}
          volumeMounts:
            - name: page
              mountPath: /usr/share/nginx/html
      volumes:
        - name: page
          configMap:
            name: menu-${colour}
`;
const BLUE_YAML = colourYaml('blue', 'v1', 'nginx:1.29-alpine');
const GREEN_YAML = colourYaml('green', 'v2', 'nginx:1.30-alpine');

/** The order number points at blue. */
const BG_SVC_YAML = `apiVersion: v1
kind: Service
metadata:
  name: shop
spec:
  selector:
    app: shop
    version: blue
  ports:
    - port: 80
`;

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

/** Canary: 3 stable trays and 1 canary tray, all behind one order number (app: shop). */
const trackYaml = (track: string, replicas: number, image: string) => `apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop-${track}
spec:
  replicas: ${replicas}
  selector:
    matchLabels:
      app: shop
      track: ${track}
  template:
    metadata:
      labels:
        app: shop
        track: ${track}
    spec:
      containers:
        - name: web
          image: ${image}
`;
const STABLE_YAML = trackYaml('stable', 3, 'nginx:1.29-alpine');
const CANARY_YAML = trackYaml('canary', 1, 'nginx:1.30-alpine');

/** The same order number, now pointing at green (apply it to switch; apply service.yaml to switch back). */
const BG_SVC_GREEN_YAML = BG_SVC_YAML.replace('version: blue', 'version: green');

export const k2Scenarios: KubeScenario[] = [
  {
    id: 'k2-pods',
    // L01: a lone pod, then a pod with two containers.
    files: { 'tray.yaml': TRAY_YAML, 'duo.yaml': DUO_YAML },
    verify: [
      ['kubectl apply -f tray.yaml', 'kubectl wait --for=condition=Ready pod/tray --timeout=60s', 'kubectl get pod tray', 'kubectl delete pod tray', 'kubectl get pods'],
      ['kubectl apply -f duo.yaml', 'kubectl wait --for=condition=Ready pod/duo --timeout=60s', 'kubectl get pod duo -o jsonpath={.spec.containers[*].name}'],
    ],
  },
  {
    id: 'k2-sidecar',
    // L02: init container, native sidecar (an init container with restartPolicy: Always), a failing init.
    files: { 'kedai.yaml': KEDAI_YAML, 'noprep.yaml': NOPREP_YAML },
    verify: [
      ['kubectl apply -f kedai.yaml', 'kubectl wait --for=condition=Ready pod/kedai --timeout=90s', 'kubectl logs kedai -c prep', 'kubectl logs kedai -c sweeper'],
      ['kubectl apply -f noprep.yaml', 'sleep 20', 'kubectl logs noprep -c prep', 'kubectl delete pod noprep'],
    ],
  },
  {
    id: 'k2-replicaset',
    // L03: a ReplicaSet keeps the count.
    files: { 'trays.yaml': TRAYS_RS_YAML },
    steps: ['kubectl apply -f trays.yaml'],
    verify: [
      ['kubectl get rs trays', 'kubectl delete pod {pod:app=tray}', 'kubectl get rs trays'],
      ['kubectl scale rs trays --replicas=5', 'kubectl get rs trays'],
      ['kubectl run extra --image=nginx:1.29-alpine --labels=app=tray', 'kubectl get rs trays', 'kubectl get pods -o name'],
    ],
  },
  {
    id: 'k2-deploy',
    // L04: nothing yet; shop.yaml waits in the folder.
    files: { 'shop.yaml': SHOP_YAML },
    verify: [
      ['kubectl apply -f shop.yaml', 'kubectl rollout status deployment/shop --timeout=120s', 'kubectl get deployment shop', 'kubectl get rs -o name'],
      ['kubectl apply -f shop.yaml', 'kubectl rollout status deployment/shop --timeout=120s', 'kubectl delete rs -l app=shop', 'kubectl rollout status deployment/shop --timeout=120s', 'kubectl get rs -o name'],
    ],
  },
  {
    id: 'k2-bad-rollout',
    // L05 and L07: a release with a typo in the tag is stuck; the old trays still serve.
    files: { 'shop.yaml': SHOP_YAML },
    steps: ['kubectl apply -f shop.yaml', { settle: true }, 'kubectl set image deployment/shop web=nginx:1.299', { tick: 30 }],
    settle: false,
    verify: [
      ['kubectl get deployment shop', 'kubectl rollout undo deployment/shop', 'kubectl rollout status deployment/shop --timeout=180s', 'kubectl get deployment shop'],
      ['kubectl set image deployment/shop web=nginx:1.30-alpine', 'kubectl rollout status deployment/shop --timeout=180s', 'kubectl get deployment shop'],
    ],
  },
  {
    id: 'k2-states',
    // L07: four trays in trouble at once (Pending, CrashLoopBackOff, OOMKilled, ImagePullBackOff).
    files: { 'trouble.yaml': STATES_YAML },
    steps: ['kubectl apply -f trouble.yaml', { tick: 45 }],
    settle: false,
    verify: [
      [
        'kubectl get pod big',
        'kubectl get events --field-selector reason=FailedScheduling -o jsonpath={.items[0].message}',
        'kubectl get pod hungry -o jsonpath={.status.containerStatuses[0].lastState.terminated.exitCode}',
        'kubectl get pod oops -o jsonpath={.status.containerStatuses[0].lastState.terminated.exitCode}',
      ],
    ],
  },
  {
    id: 'k2-restart',
    // L06: the shop; a container restart keeps the pod, a rollout restart replaces every pod.
    files: { 'shop.yaml': SHOP_YAML },
    steps: ['kubectl apply -f shop.yaml'],
    verify: [['kubectl rollout restart deployment/shop', 'kubectl rollout status deployment/shop --timeout=180s', 'kubectl rollout history deployment/shop', 'kubectl get deployment shop']],
  },
  {
    id: 'k2-probes',
    // L08: the shop behind its order number (its readiness probe decides who gets customers).
    files: { 'shop.yaml': SHOP_YAML, 'service.yaml': SHOP_SVC_YAML },
    steps: ['kubectl apply -f shop.yaml', 'kubectl apply -f service.yaml'],
    verify: [['kubectl get endpointslices -l kubernetes.io/service-name=shop -o jsonpath={.items[*].endpoints[*].conditions.ready}', 'kubectl get deployment shop']],
  },
  {
    id: 'k2-liveness',
    // L08: a sleepy cook (liveness fails: restarted) and a shy one (readiness fails: never Ready, never restarted).
    files: { 'sleepy.yaml': SLEEPY_YAML, 'shy.yaml': SHY_YAML },
    verify: [
      ['kubectl apply -f shy.yaml', 'sleep 20', 'kubectl get pod shy', 'kubectl delete pod shy'],
      // Wait for the first restart, not a fixed time: how soon the kubelet's first probe runs varies,
      // so after 30 s a real cluster may or may not have reached its first back-off yet.
      [
        'kubectl apply -f sleepy.yaml',
        'kubectl wait --for=jsonpath={.status.containerStatuses[0].restartCount}=1 pod/sleepy --timeout=90s',
        'kubectl get events --field-selector reason=Killing -o jsonpath={.items[0].message}',
        'kubectl delete pod sleepy',
      ],
    ],
  },
  {
    id: 'k2-limits',
    // L09: a tray that asks for 64 CPUs waits; a sensible request lets it sit down.
    files: { 'big.yaml': BIG_DEPLOY_YAML },
    steps: ['kubectl apply -f big.yaml', { tick: 10 }],
    verify: [['kubectl get deployment big', 'kubectl set resources deployment big --requests=cpu=100m', 'kubectl rollout status deployment/big --timeout=120s', 'kubectl get deployment big']],
  },
  {
    id: 'k2-qos',
    // L10: three pods, three QoS classes.
    files: { 'gold.yaml': GOLD_YAML, 'silver.yaml': SILVER_YAML, 'bronze.yaml': BRONZE_YAML },
    verify: [
      [
        'kubectl apply -f gold.yaml',
        'kubectl apply -f silver.yaml',
        'kubectl apply -f bronze.yaml',
        'kubectl get pod gold -o jsonpath={.status.qosClass}',
        'kubectl get pod silver -o jsonpath={.status.qosClass}',
        'kubectl get pod bronze -o jsonpath={.status.qosClass}',
      ],
    ],
  },
  {
    id: 'k2-daemonset',
    // L11: one sweeper per worker stall (the control plane has a taint).
    files: { 'sweeper.yaml': SWEEPER_YAML },
    verify: [['kubectl apply -f sweeper.yaml', 'kubectl rollout status daemonset/sweeper --timeout=120s', 'kubectl get daemonset sweeper']],
  },
  {
    id: 'k2-statefulset',
    // L12: web-0, web-1, web-2 keep their names.
    files: { 'web.yaml': WEB_STS_YAML },
    verify: [
      [
        'kubectl apply -f web.yaml',
        'kubectl rollout status statefulset/web --timeout=180s',
        'kubectl get pods -o name',
        'kubectl delete pod web-1',
        'kubectl wait --for=condition=Ready pod/web-1 --timeout=90s',
        'kubectl get pods -o name',
      ],
    ],
  },
  {
    id: 'k2-statefulset-up',
    // L12 try card: the StatefulSet is already running.
    files: { 'web.yaml': WEB_STS_YAML },
    steps: ['kubectl apply -f web.yaml'],
    verify: [['kubectl scale statefulset web --replicas=4', 'kubectl rollout status statefulset/web --timeout=120s', 'kubectl get statefulset web']],
  },
  {
    id: 'k2-jobs',
    // L13: a Job runs once; a CronJob makes Jobs on a schedule (or on demand with --from).
    files: { 'tally.yaml': TALLY_YAML, 'nightly.yaml': NIGHTLY_YAML },
    verify: [
      ['kubectl apply -f tally.yaml', 'kubectl wait --for=condition=complete job/tally --timeout=60s', 'kubectl get job tally', 'kubectl logs job/tally'],
      ['kubectl apply -f nightly.yaml', 'kubectl create job tally-now --from=cronjob/nightly', 'kubectl wait --for=condition=complete job/tally-now --timeout=60s', 'kubectl get cronjob nightly'],
    ],
  },
  {
    id: 'k2-bluegreen',
    // L14: blue and green both run; the Service picks blue until you switch it.
    files: { 'blue.yaml': BLUE_YAML, 'green.yaml': GREEN_YAML, 'service.yaml': BG_SVC_YAML, 'service-green.yaml': BG_SVC_GREEN_YAML, 'client.yaml': CLIENT_YAML },
    steps: ['kubectl apply -f blue.yaml', 'kubectl apply -f green.yaml', 'kubectl apply -f service.yaml', 'kubectl apply -f client.yaml'],
    verify: [
      [
        'kubectl get deployments',
        'kubectl get service shop -o wide',
        'kubectl exec client -- wget -qO- -T 5 http://shop',
        'kubectl apply -f service-green.yaml',
        'kubectl exec client -- wget -qO- -T 5 http://shop',
        'kubectl apply -f service.yaml',
        'kubectl get service shop -o jsonpath={.spec.selector.version}',
      ],
    ],
  },
  {
    id: 'k2-canary',
    // L14: 3 stable trays + 1 canary tray behind the same order number.
    files: { 'stable.yaml': STABLE_YAML, 'canary.yaml': CANARY_YAML, 'service.yaml': SHOP_SVC_YAML },
    steps: ['kubectl apply -f stable.yaml', 'kubectl apply -f service.yaml'],
    verify: [
      ['kubectl apply -f canary.yaml', 'kubectl rollout status deployment/shop-canary --timeout=120s', 'kubectl get deployments', 'kubectl get endpointslices -l kubernetes.io/service-name=shop -o jsonpath={.items[*].endpoints[*].conditions.ready}'],
      ['kubectl apply -f canary.yaml', 'kubectl scale deployment shop-canary --replicas=3', 'kubectl scale deployment shop-stable --replicas=1', 'kubectl rollout status deployment/shop-canary --timeout=120s', 'kubectl get deployments'],
    ],
  },
  {
    id: 'k2-boss-start',
    // Boss stage 1: one lonely tray before the lunch rush.
    files: { 'shop.yaml': SHOP_ONE_YAML },
    steps: ['kubectl apply -f shop.yaml'],
    verify: [['kubectl scale deployment shop --replicas=3', 'kubectl rollout status deployment/shop --timeout=120s', 'kubectl get deployment shop']],
  },
  {
    id: 'k2-boss-scaled',
    // Boss stage 2: 3 trays on nginx 1.29; ship 1.30 with no downtime.
    files: { 'shop.yaml': SHOP_YAML },
    steps: ['kubectl apply -f shop.yaml'],
    verify: [['kubectl set image deployment/shop web=nginx:1.30-alpine', 'kubectl rollout status deployment/shop --timeout=180s', 'kubectl get deployment shop -o jsonpath={.spec.template.spec.containers[0].image}']],
  },
  {
    id: 'k2-boss-updated',
    // Boss stage 3: 1.30 is live (revision 2). A typo release (1.300) is about to land.
    files: { 'shop.yaml': SHOP_YAML },
    steps: ['kubectl apply -f shop.yaml', { settle: true }, 'kubectl set image deployment/shop web=nginx:1.30-alpine'],
    verify: [
      [
        'kubectl set image deployment/shop web=nginx:1.300-alpine',
        'sleep 30',
        'kubectl get deployment shop',
        'kubectl rollout undo deployment/shop',
        'kubectl rollout status deployment/shop --timeout=180s',
        'kubectl rollout history deployment/shop',
      ],
    ],
  },
];
