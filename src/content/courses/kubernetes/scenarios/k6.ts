// World K6 "Guards" scenarios (Kubernetes 1.37): RBAC, Pod Security, securityContext,
// NetworkPolicies, and the boss "Lock the kitchen". The model scenarios `k6-rbac` and
// `k6-pod-security` (model.ts) are reused too.
//
// Truth-check notes (npm run verify:k8s replays every verify list on a real kind cluster in CI):
// - Everything lives in namespaces the real-cluster reset deletes (kedai, ci) or in `default`
//   objects it cleans (roles, rolebindings, serviceaccounts, networkpolicies). No ClusterRoles or
//   ClusterRoleBindings: the reset does not remove cluster-wide objects.
// - `default` is never labelled (the reset would not remove the label).
// - Verify lists leave out commands that print a warning AND a result (labelling a zone with old
//   pods in it, applying a Deployment that breaks the zone's level): kubectl writes the warning to
//   stderr and the result to stdout, and the checker joins them in the other order.
// - Pods that must run under `restricted` use busybox:1.37 as user 1000 (nginx needs root).
import type { KubeScenario } from '~/engine/foodcourt-sim';

/** The kedai zone, guarded at the restricted level. */
const ZONE_RESTRICTED = `apiVersion: v1
kind: Namespace
metadata:
  name: kedai
  labels:
    pod-security.kubernetes.io/enforce: restricted
`;

/** A Role for the CI bot (namespace from the command, default here). */
export const DEPLOYER_YAML = `apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: deployer
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "patch"]
`;

const DEPLOYER_KEDAI_YAML = `apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: deployer
  namespace: kedai
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "patch"]
`;

/** A plain nginx tray: runs as root, no locks. */
const PLAIN_KEDAI_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: plain
  namespace: kedai
spec:
  containers:
    - name: web
      image: nginx:1.29-alpine
`;

/** Pod-level locks only: the guard still wants two container locks. */
const HALF_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: half
  namespace: kedai
  labels:
    app: tray
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
`;

/** All four restricted locks, plus a read-only root filesystem. */
const LOCKED_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: locked
  namespace: kedai
  labels:
    app: tray
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
        readOnlyRootFilesystem: true
        capabilities:
          drop: ["ALL"]
`;

// --- NetworkPolicies (default namespace) -----------------------------------

const DB_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: db
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
          image: nginx:1.29-alpine
          ports:
            - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: db
spec:
  selector:
    app: db
  ports:
    - port: 80
      targetPort: 80
`;

const CALLERS_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: api
  labels:
    app: api
spec:
  containers:
    - name: box
      image: busybox:1.37
      command: ["sleep", "3600"]
---
apiVersion: v1
kind: Pod
metadata:
  name: stranger
  labels:
    app: stranger
spec:
  containers:
    - name: box
      image: busybox:1.37
      command: ["sleep", "3600"]
`;

export const DENY_ALL_YAML = `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all
spec:
  podSelector: {}
  policyTypes:
    - Ingress
`;

export const DB_FROM_API_YAML = `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: db-from-api
spec:
  podSelector:
    matchLabels:
      app: db
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: api
      ports:
        - port: 80
`;

// --- Boss: the kedai shop --------------------------------------------------

const shopYaml = (podLocks: string, containerLocks: string) => `apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop
  namespace: kedai
spec:
  replicas: 2
  selector:
    matchLabels:
      app: shop
  template:
    metadata:
      labels:
        app: shop
    spec:
${podLocks}      containers:
        - name: web
          image: busybox:1.37
          command: ["sleep", "3600"]
${containerLocks}`;

const POD_LOCKS = `      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        seccompProfile:
          type: RuntimeDefault
`;
const CONTAINER_LOCKS = `          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
`;

/** The shop as it ran yesterday: no locks at all. */
const SHOP_PLAIN_YAML = shopYaml('', '');
/** Fix A: the pod-level locks only (still refused). */
const SHOP_A_YAML = shopYaml(POD_LOCKS, '');
/** Fix B: all four locks. */
const SHOP_B_YAML = shopYaml(POD_LOCKS, CONTAINER_LOCKS);

const ZONE_PLAIN = `apiVersion: v1
kind: Namespace
metadata:
  name: kedai
`;

/** Lesson YAML that no scenario applies, checked by `npm run verify:manifests`. */
export const NO_LATEST_POLICY_YAML = `apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: no-latest
spec:
  matchConstraints:
    resourceRules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["pods"]
  validations:
    - expression: "object.spec.containers.all(c, !c.image.endsWith(':latest'))"
      message: "Pin a version tag, not latest."
`;

export const NO_LATEST_BINDING_YAML = `apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicyBinding
metadata:
  name: no-latest-kedai
spec:
  policyName: no-latest
  validationActions: [Warn]
  matchResources:
    namespaceSelector:
      matchLabels:
        kubernetes.io/metadata.name: kedai
`;

export const USERNS_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: legacy
spec:
  hostUsers: false
  containers:
    - name: app
      image: busybox:1.37
      command: ["sleep", "3600"]
`;

export const MISSION_ZONE_YAML = `apiVersion: v1
kind: Namespace
metadata:
  name: kedai
  labels:
    pod-security.kubernetes.io/enforce: restricted
    policy.sigstore.dev/include: "true"
`;

const ROOT_TEST_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: root-test
  namespace: kedai
spec:
  containers:
    - name: web
      image: nginx:1.29-alpine
`;

export const k6Scenarios: KubeScenario[] = [
  {
    // L02: the CI bot has a badge; the job card is a file; no binding yet.
    id: 'k6-rbac-start',
    files: { 'deployer.yaml': DEPLOYER_YAML },
    steps: ['kubectl create serviceaccount ci-bot'],
    verify: [
      [
        'kubectl apply -f deployer.yaml',
        'kubectl create rolebinding ci-bot-deployer --role=deployer --serviceaccount=default:ci-bot',
        'kubectl auth can-i patch deployments --as=system:serviceaccount:default:ci-bot',
        'kubectl auth can-i delete deployments --as=system:serviceaccount:default:ci-bot',
        'kubectl get rolebindings',
      ],
    ],
  },
  {
    // L04: an unguarded zone and a plain nginx tray.
    id: 'k6-psa',
    files: { 'plain.yaml': PLAIN_KEDAI_YAML },
    steps: ['kubectl create namespace kedai'],
    verify: [['kubectl label namespace kedai pod-security.kubernetes.io/enforce=restricted', 'kubectl get namespace kedai --show-labels', 'kubectl apply -f plain.yaml']],
  },
  {
    // L05: a restricted zone; half.yaml has the pod locks only, locked.yaml has them all.
    id: 'k6-locks',
    files: { 'zone.yaml': ZONE_RESTRICTED, 'plain.yaml': PLAIN_KEDAI_YAML, 'half.yaml': HALF_YAML, 'locked.yaml': LOCKED_YAML },
    steps: ['kubectl apply -f zone.yaml'],
    verify: [['kubectl apply -f half.yaml', 'kubectl apply -f locked.yaml', 'kubectl wait --for=condition=Ready pod/locked -n kedai --timeout=60s', 'kubectl get pods -n kedai']],
  },
  {
    // L06: the database answers everyone until the fences go up.
    id: 'k6-netpol',
    files: { 'db.yaml': DB_YAML, 'callers.yaml': CALLERS_YAML, 'deny.yaml': DENY_ALL_YAML, 'allow-api.yaml': DB_FROM_API_YAML },
    steps: ['kubectl apply -f db.yaml', 'kubectl apply -f callers.yaml'],
    verify: [['kubectl apply -f deny.yaml', 'kubectl apply -f allow-api.yaml', 'kubectl get networkpolicy']],
  },
  {
    // Boss room 1: the shop runs in an unguarded zone.
    id: 'k6-boss-zone',
    files: { 'zone.yaml': ZONE_PLAIN, 'shop.yaml': SHOP_PLAIN_YAML },
    steps: ['kubectl apply -f zone.yaml', 'kubectl apply -f shop.yaml'],
    verify: [['kubectl get deployment shop -n kedai', 'kubectl get namespace kedai --show-labels']],
  },
  {
    // Boss room 2: the zone is guarded; the shop's trays are refused. Fix A misses the container locks.
    id: 'k6-boss-fix',
    files: { 'zone.yaml': ZONE_RESTRICTED, 'shop.yaml': SHOP_PLAIN_YAML, 'shop-a.yaml': SHOP_A_YAML, 'shop-b.yaml': SHOP_B_YAML },
    steps: ['kubectl apply -f zone.yaml', 'kubectl apply -f shop.yaml'],
    verify: [['kubectl apply -f shop-b.yaml', 'kubectl rollout status deployment/shop -n kedai --timeout=120s', 'kubectl get deployment shop -n kedai']],
  },
  {
    // Boss room 4: the CI bot holds cluster-admin in kedai (a RoleBinding to the built-in ClusterRole).
    id: 'k6-boss-bot',
    files: { 'deployer.yaml': DEPLOYER_KEDAI_YAML },
    steps: [
      'kubectl create namespace kedai',
      'kubectl create namespace ci',
      'kubectl create serviceaccount ci-bot -n ci',
      'kubectl create rolebinding ci-bot-admin -n kedai --clusterrole=cluster-admin --serviceaccount=ci:ci-bot',
    ],
    verify: [
      [
        'kubectl auth can-i get secrets -n kedai --as=system:serviceaccount:ci:ci-bot',
        'kubectl delete rolebinding ci-bot-admin -n kedai',
        'kubectl apply -f deployer.yaml',
        'kubectl create rolebinding ci-bot-deployer -n kedai --role=deployer --serviceaccount=ci:ci-bot',
        'kubectl auth can-i patch deployments -n kedai --as=system:serviceaccount:ci:ci-bot',
        'kubectl auth can-i get secrets -n kedai --as=system:serviceaccount:ci:ci-bot',
      ],
    ],
  },
  {
    // Mission 5: a guarded zone refuses a root tray, even on a server dry run.
    id: 'k6-mission',
    files: { 'zone.yaml': ZONE_RESTRICTED, 'root.yaml': ROOT_TEST_YAML },
    steps: ['kubectl apply -f zone.yaml'],
    verify: [['kubectl apply -f root.yaml --dry-run=server', 'kubectl get pods -n kedai']],
  },
];

/** Every K6 manifest a lesson shows, for `npm run verify:manifests` (kubeconform, Kubernetes 1.37). */
export const k6Manifests: { name: string; text: string }[] = [
  ...k6Scenarios.flatMap((s) => Object.entries(s.files ?? {}).map(([file, text]) => ({ name: `${s.id}-${file.replace(/\.yaml$/, '')}`, text }))),
  { name: 'k6-no-latest-policy', text: NO_LATEST_POLICY_YAML },
  { name: 'k6-no-latest-binding', text: NO_LATEST_BINDING_YAML },
  { name: 'k6-userns', text: USERNS_YAML },
  { name: 'k6-mission-zone', text: MISSION_ZONE_YAML },
];
