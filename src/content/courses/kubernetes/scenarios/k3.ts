// World K3 "Counters & Doors" scenarios (Kubernetes 1.37): pod IPs, Services, EndpointSlices,
// cluster DNS, port-forward, Gateway API, TLS and NetworkPolicies.
// `npm run verify:k8s` replays the verify lists in the engine and, in CI, on a real kind cluster.
// Lists that need a Gateway controller, curl from the laptop or a port-forward are engine-only
// (`engineOnly`): kind has no Gateway controller by default, and the real check runs kubectl only.
// The real lists use only the images CI pre-loads (nginx:1.29-alpine, busybox:1.37).
import type { KubeScenario } from '~/engine/foodcourt-sim';

/** The shop: 3 nginx trays that serve one short page (a ConfigMap), with a readiness probe. */
export const K3_SHOP_YAML = `apiVersion: v1
kind: ConfigMap
metadata:
  name: shop-page
data:
  index.html: |
    <h1>Kedai Kancil</h1>
---
apiVersion: apps/v1
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
          volumeMounts:
            - name: page
              mountPath: /usr/share/nginx/html
      volumes:
        - name: page
          configMap:
            name: shop-page
`;

/** The shop's order number (ClusterIP). */
export const K3_SERVICE_YAML = `apiVersion: v1
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

/** A pod to call from (busybox has wget). */
const clientYaml = (name: string) => `apiVersion: v1
kind: Pod
metadata:
  name: ${name}
  labels:
    app: ${name}
spec:
  containers:
    - name: box
      image: busybox:1.37
      command: ["sleep", "3600"]
`;

/** The menu: 1 nginx tray with its own short page. */
const MENU_YAML = `apiVersion: v1
kind: ConfigMap
metadata:
  name: menu-page
data:
  index.html: |
    <p>Nasi lemak RM5</p>
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: menu
  labels:
    app: menu
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
          ports:
            - containerPort: 80
          volumeMounts:
            - name: page
              mountPath: /usr/share/nginx/html
      volumes:
        - name: page
          configMap:
            name: menu-page
`;

/** The menu's order number, with a typo in the selector (app: menus). */
const MENU_TYPO_SVC_YAML = `apiVersion: v1
kind: Service
metadata:
  name: menu
spec:
  selector:
    app: menus
  ports:
    - port: 80
      targetPort: 80
`;

const NODEPORT_YAML = `apiVersion: v1
kind: Service
metadata:
  name: shop-np
spec:
  type: NodePort
  selector:
    app: shop
  ports:
    - port: 80
      targetPort: 80
      nodePort: 30080
`;

const HEADLESS_YAML = `apiVersion: v1
kind: Service
metadata:
  name: shop-direct
spec:
  clusterIP: None
  selector:
    app: shop
  ports:
    - port: 80
`;

/** The API behind /api (http-echo answers every path with one line). */
const API_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  labels:
    app: api
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

/** The main entrance: one HTTP listener on port 80 (GatewayClass eg = Envoy Gateway). */
export const K3_GATEWAY_YAML = `apiVersion: gateway.networking.k8s.io/v1
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

/** One signboard: everything goes to the shop. */
const ROUTE_SHOP_YAML = `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: kedai
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
`;

/** Two signboards: / to the shop, /api to the API. */
export const K3_ROUTES_YAML = `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: kedai
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

/**
 * The certificate Secret cert-manager would make (practice data, not a real key).
 * kubernetes.io/tls Secrets must hold tls.crt and tls.key.
 */
const TLS_SECRET_YAML = `apiVersion: v1
kind: Secret
metadata:
  name: kedai-tls
type: kubernetes.io/tls
stringData:
  tls.crt: "practice certificate"
  tls.key: "practice key"
`;

/** The entrance with an HTTPS listener; cert-manager reads the annotation. */
export const K3_TLS_GATEWAY_YAML = `apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: entrance
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
spec:
  gatewayClassName: eg
  listeners:
    - name: http
      protocol: HTTP
      port: 80
    - name: https
      protocol: HTTPS
      port: 443
      hostname: kedai.example
      tls:
        mode: Terminate
        certificateRefs:
          - name: kedai-tls
`;

/** Lock every door in the namespace (ingress). */
export const K3_DENY_ALL_YAML = `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all
spec:
  podSelector: {}
  policyTypes:
    - Ingress
`;

/** Then let only pods labelled app=client in to the shop, on port 80. */
export const K3_ALLOW_CLIENT_YAML = `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: shop-allow-client
spec:
  podSelector:
    matchLabels:
      app: shop
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: client
      ports:
        - port: 80
`;

/**
 * The boss's database. In the practice cluster it answers plain web requests on 5432,
 * so wget can test the lock (a real Postgres speaks its own protocol).
 */
const DB_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: db
  labels:
    app: db
spec:
  replicas: 1
  selector:
    matchLabels:
      app: db
  template:
    metadata:
      labels:
        app: db
    spec:
      containers:
        - name: db
          image: hashicorp/http-echo:1.0
          args: ["-text=orders db: ok", "-listen=:5432"]
          ports:
            - containerPort: 5432
---
apiVersion: v1
kind: Service
metadata:
  name: db
spec:
  selector:
    app: db
  ports:
    - port: 5432
      targetPort: 5432
`;

/** Locks the database for everyone (no allow rules). */
const DB_DENY_YAML = `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: db-deny
spec:
  podSelector:
    matchLabels:
      app: db
  policyTypes:
    - Ingress
`;

/** Locks the database, but lets the API in on 5432. */
export const K3_DB_LOCK_YAML = `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: db-lock
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
              app: api
      ports:
        - port: 5432
`;

const WGET = 'kubectl exec client -- wget -qO- -T 5';

const gatewayOnly = 'needs the Gateway API CRDs and a Gateway controller (Envoy Gateway); kind has none by default';

const boss = {
  clusters: [{ name: 'kind-dev', gateway: true }],
  files: {
    'shop.yaml': K3_SHOP_YAML,
    'service.yaml': K3_SERVICE_YAML,
    'api.yaml': API_YAML,
    'db.yaml': DB_YAML,
    'entrance.yaml': K3_GATEWAY_YAML,
    'routes.yaml': K3_ROUTES_YAML,
    'tls.yaml': K3_TLS_GATEWAY_YAML,
    'kedai-tls.yaml': TLS_SECRET_YAML,
    'db-deny.yaml': DB_DENY_YAML,
    'db-lock.yaml': K3_DB_LOCK_YAML,
  },
  baseSteps: ['kubectl apply -f shop.yaml', 'kubectl apply -f service.yaml', 'kubectl apply -f api.yaml', 'kubectl apply -f db.yaml'],
};

export const k3Scenarios: KubeScenario[] = [
  {
    // L01: three shop trays and a client tray; every pod has its own IP.
    id: 'k3-pods',
    files: { 'shop.yaml': K3_SHOP_YAML, 'client.yaml': clientYaml('client') },
    steps: ['kubectl apply -f shop.yaml', 'kubectl apply -f client.yaml'],
    verify: [
      ['kubectl get pods -l app=shop -o name', 'kubectl get pod client -o jsonpath={.status.podIP}'],
      ['kubectl delete pod {pod:app=shop}', 'kubectl get pods -l app=shop -o name'],
    ],
  },
  {
    // L02: the shop with no order number yet; service.yaml is ready to apply.
    id: 'k3-counter',
    files: { 'shop.yaml': K3_SHOP_YAML, 'service.yaml': K3_SERVICE_YAML, 'client.yaml': clientYaml('client') },
    steps: ['kubectl apply -f shop.yaml', 'kubectl apply -f client.yaml'],
    verify: [
      ['kubectl apply -f service.yaml', 'kubectl get service shop -o jsonpath={.spec.type}', `${WGET} http://shop`],
      ['kubectl expose deployment shop --port=80', 'kubectl get endpointslices -l kubernetes.io/service-name=shop -o name', `${WGET} http://shop`],
      ['kubectl expose deployment shop --port=80', 'kubectl delete pod {pod:app=shop}', `${WGET} http://shop`],
    ],
  },
  {
    // L03: the shop with a ClusterIP; NodePort, LoadBalancer and headless next to it.
    id: 'k3-types',
    files: { 'shop.yaml': K3_SHOP_YAML, 'service.yaml': K3_SERVICE_YAML, 'nodeport.yaml': NODEPORT_YAML, 'headless.yaml': HEADLESS_YAML },
    steps: ['kubectl apply -f shop.yaml', 'kubectl apply -f service.yaml'],
    verify: [
      ['kubectl get service shop -o jsonpath={.spec.type}', 'kubectl apply -f nodeport.yaml', 'kubectl get service shop-np'],
      ['kubectl expose deployment shop --type=LoadBalancer --port=80 --name=shop-lb', 'kubectl get service shop-lb -o jsonpath={.spec.type}'],
      ['kubectl apply -f headless.yaml', 'kubectl get service shop-direct'],
    ],
  },
  {
    // L03 (engine-only parts): the laptop calls a NodePort on a kind node's address.
    id: 'k3-nodeport-curl',
    files: { 'shop.yaml': K3_SHOP_YAML, 'service.yaml': K3_SERVICE_YAML, 'nodeport.yaml': NODEPORT_YAML },
    steps: ['kubectl apply -f shop.yaml', 'kubectl apply -f service.yaml'],
    engineOnly: 'curl runs on the laptop; the real check runs kubectl only',
    verify: [['kubectl apply -f nodeport.yaml', 'kubectl get nodes -o wide', 'curl -s http://172.18.0.3:30080']],
  },
  {
    // L04: the menu's Service has a typo in its selector, so nobody answers.
    id: 'k3-endpoints',
    files: { 'shop.yaml': K3_SHOP_YAML, 'service.yaml': K3_SERVICE_YAML, 'menu.yaml': MENU_YAML, 'menu-svc.yaml': MENU_TYPO_SVC_YAML, 'client.yaml': clientYaml('client') },
    steps: ['kubectl apply -f shop.yaml', 'kubectl apply -f service.yaml', 'kubectl apply -f menu.yaml', 'kubectl apply -f menu-svc.yaml', 'kubectl apply -f client.yaml'],
    verify: [
      ['kubectl get endpointslices -l kubernetes.io/service-name=menu', `${WGET} http://menu`],
      ['kubectl get pods -l app=menu -o name', 'kubectl get service menu -o jsonpath={.spec.selector.app}'],
      ['kubectl delete service menu', 'kubectl expose deployment menu --port=80', `${WGET} http://menu`],
      ['kubectl scale deployment shop --replicas=1', 'sleep 10', 'kubectl get endpointslices -l kubernetes.io/service-name=shop -o jsonpath={.items[*].endpoints[*].conditions.ready}'],
    ],
  },
  {
    // L05: the menu lives in the kitchen namespace; the client is in default.
    id: 'k3-dns',
    files: { 'menu.yaml': MENU_YAML, 'client.yaml': clientYaml('client') },
    steps: ['kubectl create namespace kitchen', 'kubectl apply -f menu.yaml -n kitchen', 'kubectl expose deployment menu --port=80 -n kitchen', 'kubectl apply -f client.yaml'],
    verify: [
      [`${WGET} http://menu`, `${WGET} http://menu.kitchen`],
      [`${WGET} http://menu.kitchen.svc.cluster.local`, 'kubectl get service menu -n kitchen -o name'],
    ],
  },
  {
    // L06: the shop's order number; port-forward from the laptop.
    id: 'k3-forward',
    files: { 'shop.yaml': K3_SHOP_YAML, 'service.yaml': K3_SERVICE_YAML },
    steps: ['kubectl apply -f shop.yaml', 'kubectl apply -f service.yaml'],
    engineOnly: 'kubectl port-forward keeps running in the foreground and curl runs on the laptop; the real check runs short kubectl commands only',
    verify: [['kubectl port-forward svc/shop 8080:80', 'curl -s localhost:8080']],
  },
  {
    // L07: a cluster with a Gateway controller (GatewayClass eg); no entrance yet.
    id: 'k3-entrance',
    clusters: [{ name: 'kind-dev', gateway: true }],
    files: { 'shop.yaml': K3_SHOP_YAML, 'service.yaml': K3_SERVICE_YAML, 'gateway.yaml': K3_GATEWAY_YAML, 'route.yaml': ROUTE_SHOP_YAML },
    steps: ['kubectl apply -f shop.yaml', 'kubectl apply -f service.yaml'],
    engineOnly: gatewayOnly,
    verify: [['kubectl get gatewayclass', 'kubectl apply -f gateway.yaml', 'kubectl get gateway entrance', 'kubectl apply -f route.yaml', 'curl -s http://172.18.0.200/']],
  },
  {
    // L08: the entrance and one signboard (/ → shop); routes.yaml adds /api → api.
    id: 'k3-routes',
    clusters: [{ name: 'kind-dev', gateway: true }],
    files: { 'shop.yaml': K3_SHOP_YAML, 'service.yaml': K3_SERVICE_YAML, 'api.yaml': API_YAML, 'gateway.yaml': K3_GATEWAY_YAML, 'route.yaml': ROUTE_SHOP_YAML, 'routes.yaml': K3_ROUTES_YAML },
    steps: ['kubectl apply -f shop.yaml', 'kubectl apply -f service.yaml', 'kubectl apply -f api.yaml', 'kubectl apply -f gateway.yaml', 'kubectl apply -f route.yaml'],
    engineOnly: gatewayOnly,
    verify: [['curl -s http://172.18.0.200/api/menu', 'kubectl apply -f routes.yaml', 'curl -s http://172.18.0.200/api/menu', 'curl -s http://172.18.0.200/']],
  },
  {
    // L09: a cluster with no ingress-nginx (the check from the retirement blog post).
    id: 'k3-ingress-check',
    verify: [['kubectl get pods -A -l app.kubernetes.io/name=ingress-nginx', 'kubectl get ingressclass']],
  },
  {
    // L10: the entrance and the signboards; the certificate Secret is ready (as cert-manager would make it).
    id: 'k3-tls',
    clusters: [{ name: 'kind-dev', gateway: true }],
    files: { 'shop.yaml': K3_SHOP_YAML, 'service.yaml': K3_SERVICE_YAML, 'gateway.yaml': K3_GATEWAY_YAML, 'route.yaml': ROUTE_SHOP_YAML, 'tls.yaml': K3_TLS_GATEWAY_YAML, 'kedai-tls.yaml': TLS_SECRET_YAML },
    steps: ['kubectl apply -f shop.yaml', 'kubectl apply -f service.yaml', 'kubectl apply -f gateway.yaml', 'kubectl apply -f route.yaml', 'kubectl apply -f kedai-tls.yaml'],
    engineOnly: gatewayOnly,
    verify: [['kubectl get secret kedai-tls', 'kubectl apply -f tls.yaml', 'kubectl get gateway entrance']],
  },
  {
    // L11: every door is open; deny-all.yaml and allow-client.yaml are ready.
    id: 'k3-policy',
    files: { 'shop.yaml': K3_SHOP_YAML, 'service.yaml': K3_SERVICE_YAML, 'client.yaml': clientYaml('client'), 'stranger.yaml': clientYaml('stranger'), 'deny-all.yaml': K3_DENY_ALL_YAML, 'allow-client.yaml': K3_ALLOW_CLIENT_YAML },
    steps: ['kubectl apply -f shop.yaml', 'kubectl apply -f service.yaml', 'kubectl apply -f client.yaml', 'kubectl apply -f stranger.yaml'],
    verify: [
      ['kubectl exec stranger -- wget -qO- -T 5 http://shop', 'kubectl apply -f deny-all.yaml', `${WGET} http://shop`],
      ['kubectl apply -f deny-all.yaml', 'kubectl apply -f allow-client.yaml', `${WGET} http://shop`, 'kubectl exec stranger -- wget -qO- -T 5 http://shop', 'kubectl get networkpolicy'],
    ],
  },
  {
    // L11: the same, with deny-all already applied.
    id: 'k3-policy-locked',
    files: { 'shop.yaml': K3_SHOP_YAML, 'service.yaml': K3_SERVICE_YAML, 'client.yaml': clientYaml('client'), 'stranger.yaml': clientYaml('stranger'), 'deny-all.yaml': K3_DENY_ALL_YAML, 'allow-client.yaml': K3_ALLOW_CLIENT_YAML },
    steps: ['kubectl apply -f shop.yaml', 'kubectl apply -f service.yaml', 'kubectl apply -f client.yaml', 'kubectl apply -f stranger.yaml', 'kubectl apply -f deny-all.yaml'],
    verify: [['kubectl apply -f allow-client.yaml', `${WGET} http://shop`, 'kubectl describe networkpolicy shop-allow-client']],
  },
  {
    // Boss room 1: shop, api and db run; no entrance yet.
    id: 'k3-boss',
    clusters: boss.clusters,
    files: boss.files,
    steps: boss.baseSteps,
    engineOnly: gatewayOnly,
    verify: [['kubectl get gateway', 'kubectl apply -f entrance.yaml', 'kubectl apply -f routes.yaml', 'curl -s http://172.18.0.200/', 'curl -s http://172.18.0.200/api']],
  },
  {
    // Boss room 2: the entrance and signboards are up; the certificate Secret is ready.
    id: 'k3-boss-tls',
    clusters: boss.clusters,
    files: boss.files,
    steps: [...boss.baseSteps, 'kubectl apply -f entrance.yaml', 'kubectl apply -f routes.yaml', 'kubectl apply -f kedai-tls.yaml'],
    engineOnly: gatewayOnly,
    verify: [['kubectl apply -f tls.yaml', 'kubectl get gateway entrance']],
  },
  {
    // Boss room 3: HTTPS works; the database is still open to every pod.
    id: 'k3-boss-lock',
    clusters: boss.clusters,
    files: boss.files,
    steps: [...boss.baseSteps, 'kubectl apply -f entrance.yaml', 'kubectl apply -f routes.yaml', 'kubectl apply -f kedai-tls.yaml', 'kubectl apply -f tls.yaml'],
    engineOnly: gatewayOnly,
    verify: [
      ['kubectl exec deploy/shop -- wget -qO- -T 5 http://db:5432', 'kubectl apply -f db-lock.yaml', 'kubectl exec deploy/shop -- wget -qO- -T 5 http://db:5432'],
      ['kubectl apply -f db-deny.yaml', 'kubectl apply -f db-lock.yaml', 'kubectl get networkpolicy'],
    ],
  },
];
