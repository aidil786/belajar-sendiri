// World K4 "Notes, Lockers & Packages": ConfigMaps, Secrets, volumes, Kustomize and Helm.
// Every `verify` list runs in the engine and, in CI, on a real kind cluster (Kubernetes 1.37,
// `kind-dev`, StorageClass `standard` = rancher.io/local-path, WaitForFirstConsumer).
import type { KubeScenario } from '~/engine/foodcourt-sim';

/** The shop's notes on the wall: a ConfigMap. */
export const SETTINGS_YAML = `apiVersion: v1
kind: ConfigMap
metadata:
  name: settings
data:
  GREETING: Selamat datang
  SPICY: "3"
`;

const SETTINGS_V2_YAML = `apiVersion: v1
kind: ConfigMap
metadata:
  name: settings
data:
  GREETING: Jemput makan
  SPICY: "5"
`;

/** One tray of nginx that reads the notes two ways: as env vars and as files. */
const NOTES_SHOP_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop
spec:
  replicas: 1
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
          envFrom:
            - configMapRef:
                name: settings
          volumeMounts:
            - name: notes
              mountPath: /etc/notes
      volumes:
        - name: notes
          configMap:
            name: settings
`;

/** The till reads its password from a Secret. */
const TILL_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: till
spec:
  replicas: 1
  selector:
    matchLabels:
      app: till
  template:
    metadata:
      labels:
        app: till
    spec:
      containers:
        - name: box
          image: busybox:1.37
          command: ["sleep", "3600"]
          env:
            - name: PASSWORD
              valueFrom:
                secretKeyRef:
                  name: till
                  key: PASSWORD
`;

/** A tray with two cooks sharing one scratch table (emptyDir). */
const PREP_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: prep
spec:
  replicas: 1
  selector:
    matchLabels:
      app: prep
  template:
    metadata:
      labels:
        app: prep
    spec:
      containers:
        - name: cook
          image: busybox:1.37
          command: ["sleep", "3600"]
          volumeMounts:
            - name: table
              mountPath: /table
        - name: helper
          image: busybox:1.37
          command: ["sleep", "3600"]
          volumeMounts:
            - name: table
              mountPath: /table
      volumes:
        - name: table
          emptyDir: {}
`;

/** A locker request: a PersistentVolumeClaim. */
export const CLAIM_YAML = `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: orders
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
`;

/** The cashier pod keeps the order book in the locker. */
const CASHIER_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: cashier
  labels:
    app: cashier
spec:
  containers:
    - name: box
      image: busybox:1.37
      command: ["sleep", "3600"]
      volumeMounts:
        - name: orders
          mountPath: /data
  volumes:
    - name: orders
      persistentVolumeClaim:
        claimName: orders
`;

/** The same cashier with no locker: orders live inside the box. */
const PLAIN_CASHIER_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: cashier
  labels:
    app: cashier
spec:
  containers:
    - name: box
      image: busybox:1.37
      command: ["sleep", "3600"]
`;

/** Two ledger trays, each with its own locker (volumeClaimTemplates). */
const LEDGER_YAML = `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: ledger
spec:
  serviceName: ledger
  replicas: 2
  selector:
    matchLabels:
      app: ledger
  template:
    metadata:
      labels:
        app: ledger
    spec:
      containers:
        - name: box
          image: busybox:1.37
          command: ["sleep", "3600"]
          volumeMounts:
            - name: data
              mountPath: /data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 1Gi
`;

// ---------------------------------------------------------------------------
// Kustomize: one base, one sticky note (overlay) per kitchen.

const KZ = 'apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\n';

const BASE_DEPLOYMENT_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop
  labels:
    app: shop
spec:
  replicas: 1
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
          envFrom:
            - configMapRef:
                name: settings
`;

const BASE_SETTINGS_YAML = `apiVersion: v1
kind: ConfigMap
metadata:
  name: settings
data:
  GREETING: Selamat datang
  LOG_LEVEL: debug
`;

const ns = (name: string) => `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${name}\n`;
const logPatch = (level: string, extra = '') => `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: settings\ndata:\n  LOG_LEVEL: ${level}\n${extra}`;
function overlay(name: string, replicas?: number, patch?: boolean): string {
  let t = `${KZ}namespace: ${name}\nresources:\n  - ../../base\n  - namespace.yaml\n`;
  if (replicas) t += `replicas:\n  - name: shop\n    count: ${replicas}\n`;
  if (patch) t += 'patches:\n  - path: settings-patch.yaml\n';
  return t;
}

const BASE_FILES: Record<string, string> = {
  'base/kustomization.yaml': `${KZ}resources:\n  - deployment.yaml\n  - settings.yaml\n`,
  'base/deployment.yaml': BASE_DEPLOYMENT_YAML,
  'base/settings.yaml': BASE_SETTINGS_YAML,
};

/** L08: a base, a dev overlay (as is) and a prod overlay (3 trays, quieter logs). */
export const KZ_FILES: Record<string, string> = {
  ...BASE_FILES,
  'overlays/dev/kustomization.yaml': overlay('dev'),
  'overlays/dev/namespace.yaml': ns('dev'),
  'overlays/prod/kustomization.yaml': overlay('prod', 3, true),
  'overlays/prod/namespace.yaml': ns('prod'),
  'overlays/prod/settings-patch.yaml': logPatch('warn'),
};

/** Boss: three kitchens. dev 1 tray + debug, staging 2 + info, prod 3 + warn. */
export const KITCHEN_FILES: Record<string, string> = {
  ...BASE_FILES,
  'overlays/dev/kustomization.yaml': overlay('dev'),
  'overlays/dev/namespace.yaml': ns('dev'),
  'overlays/staging/kustomization.yaml': overlay('staging', 2, true),
  'overlays/staging/namespace.yaml': ns('staging'),
  // The boss's YamlDoctor card fixes this file (CACHE: true is a bool; ConfigMap data must be text).
  'overlays/staging/settings-patch.yaml': logPatch('info', '  CACHE: "true"\n'),
  'overlays/prod/kustomization.yaml': overlay('prod', 3, true),
  'overlays/prod/namespace.yaml': ns('prod'),
  'overlays/prod/settings-patch.yaml': logPatch('warn'),
};

/** An old tutorial's Deployment (extensions/v1beta1, gone since Kubernetes 1.16). */
const OLD_SHOP_YAML = `apiVersion: extensions/v1beta1
kind: Deployment
metadata:
  name: shop
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
      containers:
        - name: web
          image: nginx:1.29-alpine
`;

export const k4Scenarios: KubeScenario[] = [
  {
    id: 'k4-notes',
    // L01: env vars vs mounted files. Env is read once, at start; files follow the ConfigMap.
    files: { 'settings.yaml': SETTINGS_YAML, 'settings-v2.yaml': SETTINGS_V2_YAML, 'shop.yaml': NOTES_SHOP_YAML },
    steps: ['kubectl apply -f settings.yaml', 'kubectl apply -f shop.yaml'],
    verify: [
      ['kubectl get configmap settings -o jsonpath={.data.GREETING}', 'kubectl exec deploy/shop -- printenv GREETING', 'kubectl exec deploy/shop -- ls /etc/notes', 'kubectl exec deploy/shop -- cat /etc/notes/SPICY'],
      ['kubectl apply -f settings-v2.yaml', 'sleep 120', 'kubectl exec deploy/shop -- cat /etc/notes/GREETING', 'kubectl exec deploy/shop -- printenv GREETING'],
      ['kubectl apply -f settings-v2.yaml', 'kubectl rollout restart deployment/shop', 'kubectl rollout status deployment/shop --timeout=120s', 'kubectl exec deploy/shop -- printenv GREETING'],
    ],
  },
  {
    id: 'k4-notes-new',
    // L01 try: make the notes yourself, then the shop.
    files: { 'settings.yaml': SETTINGS_YAML, 'shop.yaml': NOTES_SHOP_YAML },
    verify: [
      ['kubectl create configmap settings --from-literal=GREETING=Hai --from-literal=SPICY=2', 'kubectl apply -f shop.yaml', 'kubectl rollout status deployment/shop --timeout=120s', 'kubectl exec deploy/shop -- printenv GREETING'],
    ],
  },
  {
    id: 'k4-secret',
    // L02: a Secret is base64, not locked. The till reads it as an env var.
    files: { 'till.yaml': TILL_YAML },
    verify: [
      [
        'kubectl create secret generic till --from-literal=PASSWORD=sup3r-rahsia',
        'kubectl get secret till -o jsonpath={.data.PASSWORD}',
        'kubectl apply -f till.yaml',
        'kubectl rollout status deployment/till --timeout=120s',
        'kubectl exec deploy/till -- printenv PASSWORD',
      ],
      ['kubectl create secret generic till --from-literal=PASSWORD=sup3r-rahsia --dry-run=client -o yaml', 'kubectl get secrets'],
    ],
  },
  {
    id: 'k4-scratch',
    // L04: two containers share an emptyDir; a new pod starts with an empty table.
    files: { 'prep.yaml': PREP_YAML },
    steps: ['kubectl apply -f prep.yaml'],
    verify: [
      ['kubectl exec deploy/prep -c cook -- touch /table/onions.txt', 'kubectl exec deploy/prep -c helper -- ls /table'],
      ['kubectl exec deploy/prep -c cook -- touch /table/onions.txt', 'kubectl delete pod {pod:app=prep}', 'kubectl rollout status deployment/prep --timeout=120s', 'kubectl exec deploy/prep -c helper -- ls /table'],
    ],
  },
  {
    id: 'k4-plain',
    // L05 hook: an order written inside the box is lost when the pod is replaced.
    files: { 'cashier.yaml': PLAIN_CASHIER_YAML },
    steps: ['kubectl apply -f cashier.yaml'],
    verify: [
      [
        "kubectl exec cashier -- sh -c 'echo nasi lemak x2 >> /tmp/orders.txt'",
        'kubectl delete pod cashier',
        'kubectl apply -f cashier.yaml',
        'kubectl wait --for=condition=Ready pod/cashier --timeout=120s',
        'kubectl exec cashier -- cat /tmp/orders.txt',
      ],
    ],
  },
  {
    id: 'k4-locker',
    // L05: a claim waits for its first pod (WaitForFirstConsumer), then binds; data outlives the pod.
    files: { 'claim.yaml': CLAIM_YAML, 'cashier.yaml': CASHIER_YAML },
    verify: [
      ['kubectl apply -f claim.yaml', 'kubectl get pvc orders -o jsonpath={.status.phase}', 'kubectl apply -f cashier.yaml', 'kubectl wait --for=condition=Ready pod/cashier --timeout=120s', 'kubectl get pvc orders -o jsonpath={.status.phase}'],
      [
        'kubectl apply -f claim.yaml',
        'kubectl apply -f cashier.yaml',
        'kubectl wait --for=condition=Ready pod/cashier --timeout=120s',
        "kubectl exec cashier -- sh -c 'echo nasi lemak x2 >> /data/orders.txt'",
        'kubectl delete pod cashier',
        'kubectl apply -f cashier.yaml',
        'kubectl wait --for=condition=Ready pod/cashier --timeout=120s',
        'kubectl exec cashier -- cat /data/orders.txt',
      ],
    ],
  },
  {
    id: 'k4-sc',
    // L06: the claim waits for its first pod; the default StorageClass will build its PV.
    files: { 'claim.yaml': CLAIM_YAML, 'cashier.yaml': CASHIER_YAML },
    steps: ['kubectl apply -f claim.yaml'],
    verify: [['kubectl get storageclass', 'kubectl get pvc orders -o jsonpath={.status.phase}', 'kubectl get storageclass standard -o jsonpath={.volumeBindingMode}']],
  },
  {
    id: 'k4-locker-bound',
    // L05/L06: the cashier already uses the locker.
    files: { 'claim.yaml': CLAIM_YAML, 'cashier.yaml': CASHIER_YAML },
    steps: ['kubectl apply -f claim.yaml', 'kubectl apply -f cashier.yaml'],
    verify: [['kubectl get storageclass', 'kubectl get pvc orders -o jsonpath={.spec.storageClassName}', 'kubectl get pvc orders -o jsonpath={.spec.accessModes}']],
  },
  {
    id: 'k4-ledger',
    // L07: a StatefulSet gives each tray its own claim; deleting the set keeps them.
    files: { 'ledger.yaml': LEDGER_YAML },
    verify: [
      ['kubectl apply -f ledger.yaml', 'kubectl rollout status statefulset/ledger --timeout=180s', 'kubectl get pvc -o name'],
      [
        'kubectl apply -f ledger.yaml',
        'kubectl rollout status statefulset/ledger --timeout=180s',
        "kubectl exec ledger-0 -- sh -c 'echo page 1 >> /data/book.txt'",
        'kubectl delete statefulset ledger',
        'kubectl get pvc -o name',
        'kubectl apply -f ledger.yaml',
        'kubectl rollout status statefulset/ledger --timeout=180s',
        'kubectl exec ledger-0 -- cat /data/book.txt',
      ],
    ],
  },
  {
    id: 'k4-ledger-up',
    // L07: the ledger is open, and ledger-0 wrote page 1 into its own locker.
    files: { 'ledger.yaml': LEDGER_YAML },
    steps: ['kubectl apply -f ledger.yaml', { settle: true }, "kubectl exec ledger-0 -- sh -c 'echo page 1 >> /data/book.txt'"],
    verify: [
      ['kubectl get pods -l app=ledger -o name', 'kubectl scale statefulset ledger --replicas=3', 'kubectl rollout status statefulset/ledger --timeout=180s', 'kubectl get pvc -o name'],
      ['kubectl delete statefulset ledger', 'kubectl get pvc -o name', 'kubectl apply -f ledger.yaml', 'kubectl rollout status statefulset/ledger --timeout=180s', 'kubectl exec ledger-0 -- cat /data/book.txt'],
    ],
  },
  {
    id: 'k4-kz',
    // L08 + L11: Kustomize builds the overlay (kubectl kustomize), then applies it (apply -k).
    files: KZ_FILES,
    verify: [
      ['kubectl kustomize overlays/prod', 'kubectl apply -k overlays/prod', 'kubectl rollout status deployment/shop -n prod --timeout=180s', 'kubectl get deployment shop -n prod', 'kubectl exec -n prod deploy/shop -- printenv LOG_LEVEL'],
      ['kubectl kustomize overlays/dev', 'kubectl apply -k overlays/dev', 'kubectl rollout status deployment/shop -n dev --timeout=180s', 'kubectl exec -n dev deploy/shop -- printenv LOG_LEVEL'],
      [
        'kubectl apply -k overlays/dev',
        'kubectl apply -k overlays/prod',
        'kubectl rollout status deployment/shop -n prod --timeout=120s',
        'kubectl exec -n dev deploy/shop -- printenv LOG_LEVEL',
        'kubectl exec -n prod deploy/shop -- printenv LOG_LEVEL',
      ],
    ],
  },
  {
    id: 'k4-helm',
    // L09-L11: helm template renders the built-in ./kedai chart (the cluster starts empty).
    // Helm commands stay out of verify: the real-cluster check replays kubectl commands only.
    verify: [['kubectl get deployments']],
  },
  {
    id: 'k4-old',
    // L12: an old tutorial's apiVersion is gone; apps/v1 works.
    files: { 'old-shop.yaml': OLD_SHOP_YAML, 'shop.yaml': OLD_SHOP_YAML.replace('extensions/v1beta1', 'apps/v1') },
    verify: [['kubectl apply -f old-shop.yaml', 'kubectl apply -f shop.yaml', 'kubectl rollout status deployment/shop --timeout=120s', 'kubectl get deployment shop -o jsonpath={.apiVersion}']],
  },
  {
    id: 'k4-kitchens',
    // Boss: dev, staging and prod overlays of one base.
    files: KITCHEN_FILES,
    verify: [
      [
        'kubectl apply -k overlays/dev',
        'kubectl apply -k overlays/staging',
        'kubectl apply -k overlays/prod',
        'kubectl rollout status deployment/shop -n prod --timeout=180s',
        'kubectl rollout status deployment/shop -n staging --timeout=180s',
        'kubectl get deployments -A -l app=shop',
        'kubectl exec -n staging deploy/shop -- printenv LOG_LEVEL',
      ],
    ],
  },
  {
    id: 'k4-kitchens-up',
    // Boss, last stage: all three kitchens are open.
    files: KITCHEN_FILES,
    steps: ['kubectl apply -k overlays/dev', 'kubectl apply -k overlays/staging', 'kubectl apply -k overlays/prod'],
    verify: [
      ['kubectl config set-context --current --namespace=prod', 'kubectl get pods -l app=shop -o name', 'kubectl exec deploy/shop -- printenv LOG_LEVEL', 'kubectl config set-context --current --namespace=default'],
      ['kubectl get deployments -A -l app=shop', 'kubectl exec -n staging deploy/shop -- printenv CACHE'],
    ],
  },
];
