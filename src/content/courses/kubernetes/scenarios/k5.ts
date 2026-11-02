// World K5 "Lunch Rush": scaling, scheduling and seeing inside the cluster (Kubernetes 1.37).
// Verify lists run in the engine and, in CI, on a real kind cluster (`kind-dev`). Scenarios that
// need metrics-server, a fault (traffic, a memory hog) or custom stalls are engine-only.
// Lists that taint or label a node undo it at the end: the real cluster is shared by every list.
import type { KubeScenario } from '~/engine/foodcourt-sim';
import { SHOP_SVC_YAML, SHOP_YAML } from './model';

/** The shop with a CPU request on each tray: the HPA needs one to work out "% busy". */
export const SHOP_CPU_YAML = SHOP_YAML.replace(
  '            periodSeconds: 5\n',
  '            periodSeconds: 5\n          resources:\n            requests:\n              cpu: 100m\n',
);

/** A forgotten report job that holds on to 300 MB of memory (polinux/stress, as in the kubernetes.io memory task). */
const REPORT_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: report
  labels:
    app: report
spec:
  containers:
    - name: stress
      image: polinux/stress:1.0.4
      command: ["stress"]
      args: ["--vm", "1", "--vm-bytes", "300M", "--vm-hang", "1"]
`;

/** A tray that wants a stall with a fast disk (nodeSelector). */
const FAST_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: fast
  labels:
    app: fast
spec:
  nodeSelector:
    disk: ssd
  containers:
    - name: web
      image: nginx:1.29-alpine
`;

/** The oven tray: it has the key (toleration) for the oven stall's lock, and a sign (nodeSelector) to go there. */
const OVEN_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: oven
  labels:
    app: oven
spec:
  tolerations:
    - key: oven
      operator: Equal
      value: big
      effect: NoSchedule
  nodeSelector:
    oven: big
  containers:
    - name: web
      image: nginx:1.29-alpine
`;

/** A zone budget: one CPU of requests for the whole food zone. */
const QUOTA_YAML = `apiVersion: v1
kind: ResourceQuota
metadata:
  name: food-quota
  namespace: food
spec:
  hard:
    requests.cpu: "1"
    requests.memory: 1Gi
    pods: "10"
`;

/** Default requests and limits for every container in the food zone. */
const LIMITS_YAML = `apiVersion: v1
kind: LimitRange
metadata:
  name: food-defaults
  namespace: food
spec:
  limits:
    - type: Container
      defaultRequest:
        cpu: 250m
        memory: 128Mi
      default:
        cpu: 500m
        memory: 256Mi
`;

/** A cook who prints three lines, then waits. */
const KITCHEN_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: kitchen
  labels:
    app: kitchen
spec:
  containers:
    - name: cook
      image: busybox:1.37
      command: ["sh", "-c", "echo order 41 ready; echo order 42 oven too cold; echo order 42 ready; sleep 3600"]
`;

/** The menu app with a readiness probe on a page that does not exist (404). */
const MENU_PROBE_YAML = `apiVersion: apps/v1
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
          image: nginx:1.29-alpine
          readinessProbe:
            httpGet:
              path: /ready
              port: 80
            periodSeconds: 5
`;

const MENU_FIXED_YAML = MENU_PROBE_YAML.replace('path: /ready', 'path: /');

const MENU_SVC_YAML = SHOP_SVC_YAML.replace(/shop/g, 'menu');

/** The load test someone forgot: two trays that each reserve 7Gi of a stall's 8Gi. */
const LOADTEST_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: loadtest
spec:
  replicas: 2
  selector:
    matchLabels:
      app: loadtest
  template:
    metadata:
      labels:
        app: loadtest
    spec:
      containers:
        - name: stress
          image: polinux/stress:1.0.4
          command: ["stress"]
          args: ["--vm", "1", "--vm-bytes", "6G", "--vm-hang", "1"]
          resources:
            requests:
              memory: 7Gi
`;

/** The shop for the boss: CPU and memory requests on every tray. */
const SHOP_BOSS_YAML = SHOP_YAML.replace(
  '            periodSeconds: 5\n',
  '            periodSeconds: 5\n          resources:\n            requests:\n              cpu: 100m\n              memory: 256Mi\n',
);

const METRICS = { name: 'kind-dev', metricsServer: true };

export const k5Scenarios: KubeScenario[] = [
  {
    id: 'k5-top',
    // L01: who uses the most? A shop and a forgotten report pod that holds 300 MB.
    clusters: [METRICS],
    files: { 'shop.yaml': SHOP_CPU_YAML, 'report.yaml': REPORT_YAML },
    steps: ['kubectl apply -f shop.yaml', 'kubectl apply -f report.yaml'],
    engineOnly: 'needs metrics-server in the kind cluster',
    verify: [['kubectl top nodes', 'kubectl top pods', 'kubectl logs report']],
  },
  {
    id: 'k5-rush',
    // L02: the shop is ready for lunch, but nobody set up autoscaling yet.
    clusters: [METRICS],
    files: { 'shop.yaml': SHOP_CPU_YAML, 'service.yaml': SHOP_SVC_YAML },
    steps: ['kubectl apply -f shop.yaml', 'kubectl apply -f service.yaml'],
    engineOnly: 'needs metrics-server in the kind cluster',
    verify: [['kubectl autoscale deployment shop --cpu=50% --min=3 --max=10', 'kubectl get hpa shop']],
  },
  {
    id: 'k5-rush-on',
    // L02: lunch rush is on (200 requests a second) and the HPA has scaled the shop out.
    clusters: [METRICS],
    files: { 'shop.yaml': SHOP_CPU_YAML, 'service.yaml': SHOP_SVC_YAML },
    steps: [
      'kubectl apply -f shop.yaml',
      'kubectl apply -f service.yaml',
      'kubectl autoscale deployment shop --cpu=50% --min=3 --max=10',
      { fault: { type: 'traffic', service: 'shop', rps: 200 } },
      { tick: 60 },
    ],
    engineOnly: 'needs metrics-server and a load generator',
    verify: [['kubectl get hpa shop', 'kubectl get deployment shop']],
  },
  {
    id: 'k5-no-request',
    // L02: an HPA on trays that have no CPU request cannot work out "% busy".
    clusters: [METRICS],
    files: { 'shop.yaml': SHOP_YAML },
    steps: ['kubectl apply -f shop.yaml', 'kubectl autoscale deployment shop --cpu=50% --min=3 --max=10', { tick: 20 }],
    engineOnly: 'needs metrics-server in the kind cluster',
    verify: [['kubectl get hpa shop']],
  },
  {
    id: 'k5-pick',
    // L04: a tray that wants a stall with disk=ssd. No stall has that sign yet.
    files: { 'fast.yaml': FAST_YAML },
    verify: [
      ['kubectl apply -f fast.yaml', 'sleep 5', 'kubectl get pod fast', 'kubectl get events --field-selector reason=FailedScheduling -o jsonpath={.items[0].message}', 'kubectl delete pod fast'],
      [
        'kubectl label nodes dev-worker2 disk=ssd',
        'kubectl apply -f fast.yaml',
        'kubectl wait --for=condition=Ready pod/fast --timeout=60s',
        'kubectl get pod fast -o jsonpath={.spec.nodeName}',
        'kubectl delete pod fast',
        'kubectl label nodes dev-worker2 disk-',
      ],
    ],
  },
  {
    id: 'k5-pick-try',
    // L04 try card: the fast tray waits in Pending until a stall gets the disk=ssd sign.
    files: { 'fast.yaml': FAST_YAML },
    steps: ['kubectl apply -f fast.yaml', { tick: 5 }],
    engineOnly: 'the same commands are checked on kind in k5-pick',
    verify: [['kubectl get pod fast', 'kubectl label nodes dev-worker2 disk=ssd', 'kubectl wait --for=condition=Ready pod/fast --timeout=60s', 'kubectl label nodes dev-worker2 disk-']],
  },
  {
    id: 'k5-taint',
    // L05: the oven stall (dev-worker2) is locked with a taint. Shop trays stay away.
    files: { 'shop.yaml': SHOP_YAML, 'oven.yaml': OVEN_YAML },
    steps: ['kubectl label nodes dev-worker2 oven=big', 'kubectl taint nodes dev-worker2 oven=big:NoSchedule', 'kubectl apply -f shop.yaml'],
    verify: [
      [
        'kubectl get pods -l app=shop -o jsonpath={.items[*].spec.nodeName}',
        'kubectl get node dev-worker2 -o jsonpath={.spec.taints}',
        'kubectl apply -f oven.yaml',
        'kubectl wait --for=condition=Ready pod/oven --timeout=60s',
        'kubectl get pod oven -o jsonpath={.spec.nodeName}',
        'kubectl delete deployment shop',
        'kubectl delete pod oven',
        'kubectl taint nodes dev-worker2 oven=big:NoSchedule-',
        'kubectl label nodes dev-worker2 oven-',
      ],
    ],
  },
  {
    id: 'k5-pdb',
    // L06: 3 shop trays and a budget: at least 2 must stay up during planned work.
    files: { 'shop.yaml': SHOP_YAML },
    steps: ['kubectl apply -f shop.yaml'],
    verify: [['kubectl create pdb shop --selector=app=shop --min-available=2', 'kubectl get pdb shop']],
  },
  {
    id: 'k5-drain',
    // L06 try card: drain a stall while the budget protects the shop.
    files: { 'shop.yaml': SHOP_YAML },
    steps: ['kubectl apply -f shop.yaml', 'kubectl create pdb shop --selector=app=shop --min-available=2'],
    engineOnly: 'drain timing (which eviction waits, how long) differs on a real cluster',
    verify: [['kubectl drain dev-worker --ignore-daemonsets', 'kubectl get pdb shop', 'kubectl uncordon dev-worker']],
  },
  {
    id: 'k5-quota',
    // L07: the food zone has a budget (ResourceQuota) and default requests (LimitRange).
    files: { 'quota.yaml': QUOTA_YAML, 'limits.yaml': LIMITS_YAML },
    steps: ['kubectl create namespace food'],
    verify: [
      [
        'kubectl apply -f quota.yaml',
        'kubectl apply -f limits.yaml',
        'kubectl create deployment shop --image=nginx:1.29-alpine --replicas=5 -n food',
        'kubectl get deployment shop -n food',
        'kubectl get resourcequota -n food',
      ],
      ['kubectl apply -f quota.yaml', 'kubectl apply -f limits.yaml', 'kubectl create deployment shop --image=nginx:1.29-alpine --replicas=5 -n food', 'kubectl scale deployment shop --replicas=4 -n food', 'kubectl get deployment shop -n food'],
    ],
  },
  {
    id: 'k5-quota-full',
    // L07 try card: the shop ordered 5 trays; the budget pays for 4.
    files: { 'quota.yaml': QUOTA_YAML, 'limits.yaml': LIMITS_YAML },
    steps: ['kubectl create namespace food', 'kubectl apply -f quota.yaml', 'kubectl apply -f limits.yaml', 'kubectl create deployment shop --image=nginx:1.29-alpine --replicas=5 -n food'],
    engineOnly: 'the same commands are checked on kind in k5-quota',
    verify: [['kubectl get deployment shop -n food', 'kubectl scale deployment shop --replicas=4 -n food', 'kubectl get deployment shop -n food']],
  },
  {
    id: 'k5-logs',
    // L08: a cook who prints what happens. Logs and events.
    files: { 'kitchen.yaml': KITCHEN_YAML },
    steps: ['kubectl apply -f kitchen.yaml'],
    verify: [['kubectl logs kitchen', 'kubectl logs kitchen --tail=1', 'kubectl get events --field-selector involvedObject.name=kitchen']],
  },
  {
    id: 'k5-ladder',
    // L10 and the boss: the menu never gets ready. Its readiness probe asks for /ready, a page that does not exist.
    files: { 'menu.yaml': MENU_PROBE_YAML, 'menu-fixed.yaml': MENU_FIXED_YAML, 'service.yaml': MENU_SVC_YAML },
    steps: ['kubectl apply -f menu.yaml', 'kubectl apply -f service.yaml', { tick: 20 }],
    verify: [
      ['kubectl get deployment menu', 'kubectl get endpointslices -l kubernetes.io/service-name=menu -o jsonpath={.items[*].endpoints[*].conditions.ready}'],
      ['kubectl apply -f menu-fixed.yaml', 'kubectl rollout status deployment/menu --timeout=120s', 'kubectl get deployment menu'],
    ],
  },
  {
    id: 'k5-boss-rush',
    // Boss room 1: lunch is coming. The shop has requests, a Service and metrics-server. No HPA yet.
    clusters: [METRICS],
    files: { 'shop.yaml': SHOP_BOSS_YAML, 'service.yaml': SHOP_SVC_YAML },
    steps: ['kubectl apply -f shop.yaml', 'kubectl apply -f service.yaml'],
    engineOnly: 'needs metrics-server and a load generator',
    verify: [['kubectl autoscale deployment shop --cpu=50% --min=3 --max=10', 'kubectl get hpa shop']],
  },
  {
    id: 'k5-boss-slow',
    // Boss room 3: the rush is on and the HPA wants 10 trays, but a forgotten load test holds the stalls' memory.
    clusters: [METRICS],
    files: { 'shop.yaml': SHOP_BOSS_YAML, 'service.yaml': SHOP_SVC_YAML, 'loadtest.yaml': LOADTEST_YAML },
    steps: [
      'kubectl apply -f loadtest.yaml',
      { tick: 10 },
      'kubectl apply -f shop.yaml',
      'kubectl apply -f service.yaml',
      'kubectl autoscale deployment shop --cpu=50% --min=3 --max=10',
      { fault: { type: 'traffic', service: 'shop', rps: 200 } },
      { tick: 60 },
    ],
    engineOnly: 'needs metrics-server, a load generator and a memory hog',
    verify: [['kubectl get deployment shop', 'kubectl top pods', 'kubectl logs deploy/loadtest', 'kubectl scale deployment loadtest --replicas=0', 'sleep 40', 'kubectl get deployment shop']],
  },
];
