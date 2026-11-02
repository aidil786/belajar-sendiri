// Model scenarios for the food-court engine (Kubernetes 1.37). Lessons reuse them; their
// `verify` lists are replayed by `npm run verify:k8s` in the engine and, in CI, on a
// real kind cluster (`kind-dev`: dev-control-plane, dev-worker, dev-worker2).
// `{pod:app=shop}` in a command is the first pod (by name) matching that selector.
import type { KubeScenario } from '~/engine/foodcourt-sim';

/** The shop: 3 trays of nginx, with a readiness probe. */
export const SHOP_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop
  labels:
    app: shop
spec:
  replicas: 3
  selector:
    matchLabels:
      app: shop
  template:
    metadata:
      labels:
        app: shop
    spec:
      containers:
        - name: web
          image: nginx:1.29-alpine
          ports:
            - containerPort: 80
          readinessProbe:
            httpGet:
              path: /
              port: 80
            periodSeconds: 5
`;

export const SHOP_SVC_YAML = `apiVersion: v1
kind: Service
metadata:
  name: shop
spec:
  selector:
    app: shop
  ports:
    - port: 80
      targetPort: 80
`;

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

const OOPS_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: oops
spec:
  replicas: 1
  selector:
    matchLabels:
      app: oops
  template:
    metadata:
      labels:
        app: oops
    spec:
      containers:
        - name: app
          image: busybox:1.37
          command: ["sh", "-c", "echo starting the kitchen; echo oh no, no gas; exit 1"]
`;

const HUNGRY_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: hungry
  labels:
    app: hungry
spec:
  containers:
    - name: app
      image: busybox:1.37
      command: ["sh", "-c", "tail /dev/zero"]
      resources:
        limits:
          memory: 64Mi
`;

const BIG_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: big
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

const MENU_YAML = `apiVersion: v1
kind: ConfigMap
metadata:
  name: menu
data:
  index.html: |
    <h1>Kedai Kancil</h1>
    <p>Nasi lemak RM5</p>
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: menu
spec:
  replicas: 1
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
          volumeMounts:
            - name: page
              mountPath: /usr/share/nginx/html
      volumes:
        - name: page
          configMap:
            name: menu
---
apiVersion: v1
kind: Service
metadata:
  name: menu
spec:
  selector:
    app: menu
  ports:
    - port: 80
`;

const RBAC_YAML = `apiVersion: v1
kind: ServiceAccount
metadata:
  name: ci-bot
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: deployer
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "patch"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ci-bot-deployer
subjects:
  - kind: ServiceAccount
    name: ci-bot
    namespace: default
roleRef:
  kind: Role
  name: deployer
  apiGroup: rbac.authorization.k8s.io
`;

const GUARD_NS_YAML = `apiVersion: v1
kind: Namespace
metadata:
  name: guard
  labels:
    pod-security.kubernetes.io/enforce: restricted
`;

const PLAIN_POD_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: plain
  namespace: guard
spec:
  containers:
    - name: web
      image: nginx:1.29-alpine
`;

const SAFE_POD_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: safe
  namespace: guard
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: box
      image: busybox:1.37
      command: ["sleep", "3600"]
      securityContext:
        allowPrivilegeEscalation: false
        capabilities:
          drop: ["ALL"]
`;

const GATEWAY_YAML = `apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: entrance
spec:
  gatewayClassName: eg
  listeners:
    - name: http
      protocol: HTTP
      port: 80
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: shop
spec:
  parentRefs:
    - name: entrance
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /
      backendRefs:
        - name: shop
          port: 80
    - matches:
        - path:
            type: PathPrefix
            value: /api
      backendRefs:
        - name: api
          port: 80
`;

const API_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
        - name: api
          image: hashicorp/http-echo:1.0
          args: ["-text=nasi lemak ready", "-listen=:8080"]
          ports:
            - containerPort: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: api
spec:
  selector:
    app: api
  ports:
    - port: 80
      targetPort: 8080
`;

export const modelScenarios: KubeScenario[] = [
  {
    id: 'k1-empty',
    // A fresh kind cluster: nothing of yours yet.
    verify: [['kubectl get nodes', 'kubectl get pods', 'kubectl config current-context']],
  },
  {
    id: 'k1-first-pod',
    files: { 'tray.yaml': TRAY_YAML },
    verify: [
      ['kubectl apply -f tray.yaml', 'kubectl wait --for=condition=Ready pod/tray --timeout=60s', 'kubectl get pods'],
      ['kubectl run tray --image=nginx:1.29-alpine', 'kubectl wait --for=condition=Ready pod/tray --timeout=60s', 'kubectl get pod tray -o name'],
      ['kubectl apply -f tray.yaml', 'kubectl apply -f tray.yaml', 'kubectl delete -f tray.yaml', 'kubectl get pods'],
    ],
  },
  {
    id: 'k1-want3',
    files: { 'shop.yaml': SHOP_YAML },
    steps: ['kubectl apply -f shop.yaml'],
    verify: [
      ['kubectl get deployment shop', 'kubectl get rs -o name'],
      ['kubectl delete pod {pod:app=shop}', 'kubectl get deployment shop'],
      ['kubectl scale deployment shop --replicas=5', 'kubectl rollout status deployment/shop --timeout=120s', 'kubectl get deployment shop'],
    ],
  },
  {
    id: 'k2-rolling',
    files: { 'shop.yaml': SHOP_YAML },
    steps: ['kubectl apply -f shop.yaml'],
    verify: [
      ['kubectl set image deployment/shop web=nginx:1.30-alpine', 'kubectl rollout status deployment/shop --timeout=180s', 'kubectl rollout history deployment/shop'],
      [
        'kubectl set image deployment/shop web=nginx:1.30-alpine',
        'kubectl rollout status deployment/shop --timeout=180s',
        'kubectl rollout undo deployment/shop',
        'kubectl rollout status deployment/shop --timeout=180s',
        'kubectl rollout history deployment/shop',
      ],
    ],
  },
  {
    id: 'k2-crashloop',
    files: { 'oops.yaml': OOPS_YAML },
    steps: ['kubectl apply -f oops.yaml', { tick: 25 }],
    // `logs --previous` is left out: on a fast crash loop the kubelet may already have removed the old container.
    verify: [['kubectl get deployment oops', 'kubectl logs deployment/oops']],
  },
  {
    id: 'k2-badimage',
    files: { 'shop.yaml': SHOP_YAML },
    steps: ['kubectl apply -f shop.yaml'],
    verify: [['kubectl set image deployment/shop web=nginx:1.299', 'sleep 30', 'kubectl get deployment shop', 'kubectl rollout undo deployment/shop', 'kubectl rollout status deployment/shop --timeout=180s']],
  },
  {
    id: 'k2-oomkilled',
    files: { 'hungry.yaml': HUNGRY_YAML },
    verify: [['kubectl apply -f hungry.yaml', 'sleep 30', 'kubectl get pod hungry -o jsonpath={.status.containerStatuses[0].lastState.terminated.reason}']],
  },
  {
    id: 'k3-service',
    files: { 'shop.yaml': SHOP_YAML, 'service.yaml': SHOP_SVC_YAML, 'client.yaml': CLIENT_YAML },
    steps: ['kubectl apply -f shop.yaml', 'kubectl apply -f client.yaml'],
    verify: [
      ['kubectl apply -f service.yaml', 'kubectl get endpointslices -l kubernetes.io/service-name=shop -o name', 'kubectl exec client -- wget -qO- -T 5 http://shop'],
      ['kubectl expose deployment shop --port=80', 'kubectl get service shop -o jsonpath={.spec.ports[0].port}'],
      ['kubectl apply -f service.yaml', 'kubectl scale deployment shop --replicas=0', 'sleep 10', 'kubectl get endpointslices -l kubernetes.io/service-name=shop -o jsonpath={.items[*].endpoints[*].addresses[*]}'],
    ],
  },
  {
    id: 'k3-gateway',
    clusters: [{ name: 'kind-dev', gateway: true }],
    files: { 'shop.yaml': SHOP_YAML, 'service.yaml': SHOP_SVC_YAML, 'api.yaml': API_YAML, 'gateway.yaml': GATEWAY_YAML },
    steps: ['kubectl apply -f shop.yaml', 'kubectl apply -f service.yaml', 'kubectl apply -f api.yaml'],
    engineOnly: 'needs the Gateway API CRDs and a Gateway controller (Envoy Gateway) in the kind cluster',
    verify: [['kubectl apply -f gateway.yaml', 'kubectl get gateway entrance', 'curl -s http://172.18.0.200/', 'curl -s http://172.18.0.200/api']],
  },
  {
    id: 'k4-configmap',
    files: { 'menu.yaml': MENU_YAML, 'client.yaml': CLIENT_YAML },
    steps: ['kubectl apply -f client.yaml'],
    verify: [['kubectl apply -f menu.yaml', 'kubectl rollout status deployment/menu --timeout=120s', 'kubectl exec client -- wget -qO- -T 5 http://menu']],
  },
  {
    id: 'k5-pending',
    files: { 'big.yaml': BIG_YAML },
    verify: [['kubectl apply -f big.yaml', 'sleep 5', 'kubectl get pod big', 'kubectl get events --field-selector reason=FailedScheduling -o jsonpath={.items[0].message}']],
  },
  {
    id: 'k5-cordon',
    files: { 'shop.yaml': SHOP_YAML },
    steps: ['kubectl apply -f shop.yaml'],
    verify: [['kubectl cordon dev-worker', 'kubectl get node dev-worker', 'kubectl uncordon dev-worker']],
  },
  {
    id: 'k6-rbac',
    files: { 'rbac.yaml': RBAC_YAML },
    steps: ['kubectl apply -f rbac.yaml'],
    verify: [
      [
        'kubectl auth can-i list pods --as=system:serviceaccount:default:ci-bot',
        'kubectl auth can-i delete pods --as=system:serviceaccount:default:ci-bot',
        'kubectl auth can-i patch deployments --as=system:serviceaccount:default:ci-bot',
        'kubectl auth can-i patch deployments -n kube-system --as=system:serviceaccount:default:ci-bot',
        'kubectl get secrets --as=system:serviceaccount:default:ci-bot',
      ],
    ],
  },
  {
    id: 'k6-pod-security',
    files: { 'guard.yaml': GUARD_NS_YAML, 'plain.yaml': PLAIN_POD_YAML, 'safe.yaml': SAFE_POD_YAML },
    steps: ['kubectl apply -f guard.yaml'],
    verify: [['kubectl apply -f plain.yaml', 'kubectl apply -f safe.yaml', 'kubectl wait --for=condition=Ready pod/safe -n guard --timeout=60s', 'kubectl get pods -n guard -o name']],
  },
  {
    id: 'k1-two-clusters',
    clusters: [{ name: 'kind-dev' }, { name: 'prod-like', namespace: 'shop' }],
    files: { 'shop.yaml': SHOP_YAML },
    steps: ['kubectl config use-context prod-like', 'kubectl create namespace shop', 'kubectl apply -f shop.yaml -n shop', 'kubectl config use-context kind-dev'],
    engineOnly: 'needs a second cluster (prod-like)',
    verify: [['kubectl config get-contexts', 'kubectl config use-context prod-like', 'kubectl get pods']],
  },
  {
    id: 'k5-hpa',
    clusters: [{ name: 'kind-dev', metricsServer: true }],
    files: {
      'shop.yaml': SHOP_YAML.replace('            periodSeconds: 5\n', '            periodSeconds: 5\n          resources:\n            requests:\n              cpu: 100m\n'),
      'service.yaml': SHOP_SVC_YAML,
    },
    steps: ['kubectl apply -f shop.yaml', 'kubectl apply -f service.yaml', 'kubectl autoscale deployment shop --cpu=50% --min=3 --max=10'],
    engineOnly: 'needs metrics-server in the kind cluster',
    verify: [['kubectl get hpa shop', 'kubectl top pods']],
  },
];
