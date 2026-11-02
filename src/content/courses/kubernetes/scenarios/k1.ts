// World K1 "The Food Court" scenarios (Kubernetes 1.37). Lessons also reuse the model
// scenarios in model.ts (k1-empty, k1-first-pod, k1-want3, k1-two-clusters).
// `verify` lists only use kubectl and `sleep`, wait with `kubectl wait` where timing matters,
// and avoid outputs that depend on which stall the scheduler picks (no `-o wide`).
import type { KubeScenario } from '~/engine/foodcourt-sim';
import { SHOP_YAML } from './model';

/** One tray of nginx: the first pod. */
export const TRAY_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: tray
  labels:
    app: tray
spec:
  containers:
    - name: web
      image: nginx:1.29-alpine
`;

/** A busybox pod that prints one line, then waits (logs and exec). */
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
      command: ["sh", "-c", "echo Kedai Kancil is open; sleep 3600"]
`;

/** Two pods named web, in two zones (the namespace food is made first). */
const ZONES_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: web
  namespace: food
  labels:
    app: web
spec:
  containers:
    - name: web
      image: nginx:1.29-alpine
---
apiVersion: v1
kind: Pod
metadata:
  name: web
  labels:
    app: web
spec:
  containers:
    - name: web
      image: nginx:1.29-alpine
`;

/** Three trays with different labels (labels and selectors). */
const LABELS_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: shop-1
  labels:
    app: shop
    tier: web
spec:
  containers:
    - name: web
      image: nginx:1.29-alpine
---
apiVersion: v1
kind: Pod
metadata:
  name: shop-2
  labels:
    app: shop
spec:
  containers:
    - name: web
      image: nginx:1.29-alpine
---
apiVersion: v1
kind: Pod
metadata:
  name: api-1
  labels:
    app: api
spec:
  containers:
    - name: web
      image: nginx:1.29-alpine
`;

export const k1Scenarios: KubeScenario[] = [
  {
    id: 'k1-night',
    // 3 a.m.: the shop runs 3 trays, then the stall dev-worker closes (its kubelet stops).
    files: { 'shop.yaml': SHOP_YAML },
    steps: ['kubectl apply -f shop.yaml', { settle: true }, { fault: { type: 'killNode', node: 'dev-worker' } }, { tick: 60 }],
    settle: false,
    engineOnly: 'a stall closing (a node fault) is only made in the engine',
    verify: [['kubectl get nodes']],
  },
  {
    id: 'k1-first-cluster',
    // A fresh kind cluster, right after `kind create cluster --name dev`.
    verify: [
      ['kubectl cluster-info', 'kubectl get nodes', 'kubectl config current-context'],
      ['kubectl create deployment shop --image=nginx:1.29-alpine --replicas=3', 'kubectl rollout status deployment/shop --timeout=120s', 'kubectl get deployment shop'],
    ],
  },
  {
    id: 'k1-tray',
    // One tray, already running.
    files: { 'tray.yaml': TRAY_YAML },
    steps: ['kubectl apply -f tray.yaml'],
    verify: [
      ['kubectl wait --for=condition=Ready pod/tray --timeout=60s', 'kubectl get pod tray', 'kubectl describe pod tray', 'kubectl get pod tray -o jsonpath={.status.phase}'],
      ['kubectl wait --for=condition=Ready pod/tray --timeout=60s', 'kubectl get pod tray -o jsonpath={.kind}', 'kubectl get pod tray -o jsonpath={.metadata.labels.app}'],
    ],
  },
  {
    id: 'k1-kubectl',
    // A tray of nginx and a kitchen that prints one line.
    files: { 'tray.yaml': TRAY_YAML, 'kitchen.yaml': KITCHEN_YAML },
    steps: ['kubectl apply -f tray.yaml', 'kubectl apply -f kitchen.yaml'],
    verify: [
      ['kubectl wait --for=condition=Ready pod/kitchen --timeout=60s', 'kubectl get pods', 'kubectl logs kitchen', 'kubectl exec kitchen -- hostname'],
      ['kubectl wait --for=condition=Ready pod/tray --timeout=60s', 'kubectl describe pod tray', 'kubectl delete pod tray', 'kubectl get pods'],
    ],
  },
  {
    id: 'k1-two-sites',
    // Two clusters: a kind cluster (current) with one tray, and a production-like one with the shop.
    clusters: [{ name: 'kind-dev' }, { name: 'prod-like', namespace: 'shop' }],
    files: { 'tray.yaml': TRAY_YAML, 'shop.yaml': SHOP_YAML },
    steps: ['kubectl apply -f tray.yaml', 'kubectl config use-context prod-like', 'kubectl create namespace shop', 'kubectl apply -f shop.yaml -n shop', 'kubectl config use-context kind-dev'],
    engineOnly: 'needs a second cluster (prod-like)',
    verify: [
      ['kubectl config get-contexts', 'kubectl config current-context', 'kubectl get pods'],
      ['kubectl config use-context prod-like', 'kubectl get pods', 'kubectl config use-context kind-dev', 'kubectl --context prod-like get deployments'],
    ],
  },
  {
    id: 'k1-zones',
    // Namespace food; a pod called web in food and another one in default.
    files: { 'zones.yaml': ZONES_YAML },
    // The namespace first: its default ServiceAccount must exist before pods go in.
    steps: ['kubectl create namespace food', { settle: true }, 'kubectl apply -f zones.yaml'],
    verify: [
      ['kubectl get namespaces', 'kubectl get pods', 'kubectl get pods -n food'],
      ['kubectl create namespace drinks', 'kubectl get namespaces', 'kubectl get pods -n drinks'],
    ],
  },
  {
    id: 'k1-labels',
    // shop-1 (app=shop, tier=web), shop-2 (app=shop), api-1 (app=api).
    files: { 'labels.yaml': LABELS_YAML },
    steps: ['kubectl apply -f labels.yaml'],
    verify: [
      ['kubectl get pods --show-labels', 'kubectl get pods -l app=shop', 'kubectl get pods -l app=shop,tier=web'],
      ['kubectl label pod shop-2 tier=web', 'kubectl get pods -l tier=web', 'kubectl get pods -l app!=shop'],
    ],
  },
  {
    id: 'k1-dry-run',
    // An empty cluster, plus the shop's order on disk.
    files: { 'shop.yaml': SHOP_YAML },
    verify: [
      ['kubectl create deployment shop --image=nginx:1.29-alpine --replicas=3 --dry-run=client -o yaml', 'kubectl get deployments'],
      ['kubectl run tray --image=nginx:1.29-alpine --dry-run=client -o yaml', 'kubectl get pods'],
      ['kubectl explain deployment.spec.replicas', 'kubectl explain pod.spec.restartPolicy'],
      ['kubectl apply -f shop.yaml --dry-run=server', 'kubectl get deployments'],
    ],
  },
];
