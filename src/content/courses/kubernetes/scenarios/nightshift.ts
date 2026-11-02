// Night shift drills (Kubernetes): something is broken in the food court; the learner fixes it.
// Drills are listed in src/content/courses/nightshift.ts. `npm run verify:k8s` replays every
// `verify` list in the engine and, in CI, on a real kind cluster (Kubernetes 1.37).
import type { KubeScenario } from '~/engine/foodcourt-sim';
import { SHOP_SVC_YAML, SHOP_YAML } from './model';

/** Version 2 of the shop: a start command that stops at once (CrashLoopBackOff). */
const SHOP_V2_YAML = SHOP_YAML.replace('          image: nginx:1.29-alpine\n', '          image: nginx:1.29-alpine\n          command: ["sh", "-c", "echo gas is off; exit 1"]\n');

/** The shop's order number, with a typo in its selector (app: shopp). */
const SHOP_SVC_TYPO_YAML = SHOP_SVC_YAML.replace('    app: shop\n', '    app: shopp\n');

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

/** A soup pot that only goes to a stall with the sign disk=ssd. No stall has it yet. */
const SOUP_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: soup
spec:
  replicas: 1
  selector:
    matchLabels:
      app: soup
  template:
    metadata:
      labels:
        app: soup
    spec:
      nodeSelector:
        disk: ssd
      containers:
        - name: pot
          image: busybox:1.37
          command: ["sleep", "3600"]
`;

// ---------------------------------------------------------------- Level Up drills (2026-11-01)

/** A soup pot that needs about 150 MB, but its cap is 100Mi (polinux/stress, as in the kubernetes.io memory task). */
const SOUP_OOM_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: soup
spec:
  replicas: 1
  selector:
    matchLabels:
      app: soup
  template:
    metadata:
      labels:
        app: soup
        tier: kitchen
    spec:
      containers:
        - name: pot
          image: polinux/stress:1.0.4
          command: ["stress"]
          args: ["--vm", "1", "--vm-bytes", "150M", "--vm-hang", "1"]
          resources:
            limits:
              memory: 100Mi
`;

/** A rice cooker that asks for far more memory than any stall has (8Gi each). */
const RICE_BIG_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: rice
spec:
  replicas: 1
  selector:
    matchLabels:
      app: rice
  template:
    metadata:
      labels:
        app: rice
        tier: kitchen
    spec:
      containers:
        - name: cooker
          image: busybox:1.37
          command: ["sleep", "3600"]
          resources:
            requests:
              memory: 16Gi
`;

/** The deploy bot: its Role exists, but the RoleBinding that gives it to the bot was "cleaned up". */
const BOT_YAML = `apiVersion: v1
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
`;

/** Version 2 of the shop reads today's special from a ConfigMap that nobody made. */
const SHOP_NOTE_YAML = SHOP_YAML.replace(
  '          ports:\n            - containerPort: 80\n',
  '          env:\n            - name: SPECIAL\n              valueFrom:\n                configMapKeyRef:\n                  name: menu-config\n                  key: special\n          ports:\n            - containerPort: 80\n',
);

/** A cap on trays in this namespace: 3 shop trays + client = 4. */
const QUOTA_YAML = `apiVersion: v1
kind: ResourceQuota
metadata:
  name: pods-cap
spec:
  hard:
    pods: "4"
`;

/** noodle: copied from the burger stall's YAML. Burger listens on 8080; nginx listens on 80. */
const NOODLE_YAML = SHOP_YAML.replaceAll('shop', 'noodle').replace('              path: /\n              port: 80\n', '              path: /\n              port: 8080\n');
const NOODLE_SVC_YAML = `apiVersion: v1
kind: Service
metadata:
  name: noodle
spec:
  selector:
    app: noodle
  ports:
    - port: 80
      targetPort: 8080
`;

/** The shop moved to namespace food. Its trays read the menu note at start. */
const FOOD_NS_YAML = `apiVersion: v1
kind: Namespace
metadata:
  name: food
`;
const MENU_NOTE_YAML = `apiVersion: v1
kind: ConfigMap
metadata:
  name: menu-config
data:
  special: laksa
`;

export const nightshift: KubeScenario[] = [
  {
    // "Crash loop": version 2 of the shop crashes. Version 1 still serves (maxUnavailable rounds down to 0).
    id: 'ns-k8s-crashloop',
    files: { 'shop.yaml': SHOP_YAML, 'shop-v2.yaml': SHOP_V2_YAML },
    steps: ['kubectl apply -f shop.yaml', { settle: true }, 'kubectl apply -f shop-v2.yaml', { tick: 30 }],
    verify: [['kubectl get deployment shop', 'kubectl rollout undo deployment/shop', 'kubectl rollout status deployment/shop --timeout=120s', 'kubectl get deployment shop']],
  },
  {
    // "Image typo": someone typed nginx:1.299. The new tray can't get its meal pack.
    id: 'ns-k8s-imagepull',
    files: { 'shop.yaml': SHOP_YAML },
    steps: ['kubectl apply -f shop.yaml', { settle: true }, 'kubectl set image deployment/shop web=nginx:1.299', { tick: 30 }],
    verify: [['kubectl get deployment shop', 'kubectl set image deployment/shop web=nginx:1.29-alpine', 'kubectl rollout status deployment/shop --timeout=180s', 'kubectl get deployment shop']],
  },
  {
    // "No endpoints": the Service asks for app=shopp, so it matches no tray.
    id: 'ns-k8s-no-endpoints',
    files: { 'shop.yaml': SHOP_YAML, 'service.yaml': SHOP_SVC_TYPO_YAML, 'client.yaml': CLIENT_YAML },
    steps: ['kubectl apply -f shop.yaml', 'kubectl apply -f service.yaml', 'kubectl apply -f client.yaml'],
    verify: [
      [
        'kubectl get endpointslices -l kubernetes.io/service-name=shop -o jsonpath={.items[*].endpoints[*].addresses[*]}',
        `kubectl patch service shop -p '{"spec":{"selector":{"app":"shop"}}}'`,
        'kubectl exec client -- wget -qO- -T 5 http://shop',
      ],
    ],
  },
  {
    // "Stuck in Pending": the pot wants a stall with disk=ssd. The list ends by taking the label off
    // again, because the real-cluster check does not reset node labels between lists.
    id: 'ns-k8s-pending',
    files: { 'soup.yaml': SOUP_YAML },
    steps: ['kubectl apply -f soup.yaml', { tick: 10 }],
    verify: [['kubectl get pods', 'kubectl label node dev-worker disk=ssd', 'kubectl rollout status deployment/soup --timeout=120s', 'kubectl get deployment soup', 'kubectl label node dev-worker disk-']],
  },
  {
    // ★★★ incident "Lunch rush outage": one hand-made release at noon changed two things at once.
    // The image tag has a typo (nginx:1.299: the new tray never starts, the rollout is stuck) and the
    // order number now asks for app=shop-v2 (no endpoints: customers get "Connection refused").
    // The old trays keep running (maxUnavailable rounds down to 0).
    id: 'ns-k8s-incident-release',
    files: { 'shop.yaml': SHOP_YAML, 'service.yaml': SHOP_SVC_YAML, 'client.yaml': CLIENT_YAML },
    steps: [
      'kubectl apply -f shop.yaml',
      'kubectl apply -f service.yaml',
      'kubectl apply -f client.yaml',
      { settle: true },
      'kubectl set image deployment/shop web=nginx:1.299',
      `kubectl patch service shop -p '{"spec":{"selector":{"app":"shop-v2"}}}'`,
      { tick: 30 },
    ],
    verify: [
      [
        'kubectl get deployment shop',
        'kubectl rollout undo deployment/shop',
        'kubectl rollout status deployment/shop --timeout=180s',
        `kubectl patch service shop -p '{"spec":{"selector":{"app":"shop"}}}'`,
        'kubectl exec client -- wget -qO- -T 5 http://shop',
      ],
    ],
  },

  // ---------------------------------------------------------------- Level Up drills (2026-11-01)
  {
    // ★ "OOMKilled": the soup pot needs about 150 MB; its cap is 100Mi.
    id: 'ns-k8s-oom',
    files: { 'soup.yaml': SOUP_OOM_YAML },
    steps: ['kubectl apply -f soup.yaml', { tick: 40 }],
    verify: [['kubectl get pod -l app=soup -o jsonpath={.items[0].status.containerStatuses[0].lastState.terminated.reason}', 'kubectl set resources deployment/soup --limits=memory=256Mi', 'kubectl rollout status deployment/soup --timeout=120s', 'kubectl get deployment soup']],
  },
  {
    // ★★ "Forbidden": the deploy bot's Role is there, but its RoleBinding was deleted in a clean-up.
    id: 'ns-k8s-bot-forbidden',
    files: { 'bot.yaml': BOT_YAML, 'shop.yaml': SHOP_YAML },
    steps: ['kubectl apply -f shop.yaml', 'kubectl apply -f bot.yaml'],
    verify: [
      [
        'kubectl auth can-i patch deployments --as=system:serviceaccount:default:ci-bot',
        'kubectl create rolebinding ci-bot-deployer --role=deployer --serviceaccount=default:ci-bot',
        'kubectl auth can-i patch deployments --as=system:serviceaccount:default:ci-bot',
        'kubectl auth can-i delete deployments --as=system:serviceaccount:default:ci-bot',
      ],
    ],
  },
  {
    // ★★ "The missing note": version 2 reads menu-config, which nobody made. The new tray waits in
    // CreateContainerConfigError; the old trays keep serving (maxUnavailable rounds down to 0).
    id: 'ns-k8s-configmap',
    files: { 'shop.yaml': SHOP_YAML, 'shop-v2.yaml': SHOP_NOTE_YAML },
    steps: ['kubectl apply -f shop.yaml', { settle: true }, 'kubectl apply -f shop-v2.yaml', { tick: 30 }],
    verify: [['kubectl get deployment shop', 'kubectl create configmap menu-config --from-literal=special=laksa', 'kubectl rollout status deployment/shop --timeout=180s', 'kubectl get deployment shop']],
  },
  {
    // ★★★ incident "Lunch release" (three faults): one hand-typed release at noon changed the image
    // (nginx:1.299), the Service selector (app=shop-v2) and the size (5 trays). The namespace's
    // quota only has room for 4 pods (3 trays + client), so new trays can't even be made.
    id: 'ns-k8s-incident-quota',
    files: { 'shop.yaml': SHOP_YAML, 'service.yaml': SHOP_SVC_YAML, 'client.yaml': CLIENT_YAML, 'quota.yaml': QUOTA_YAML },
    steps: [
      'kubectl apply -f quota.yaml',
      'kubectl apply -f shop.yaml',
      'kubectl apply -f service.yaml',
      'kubectl apply -f client.yaml',
      { settle: true },
      'kubectl set image deployment/shop web=nginx:1.299',
      `kubectl patch service shop -p '{"spec":{"selector":{"app":"shop-v2"}}}'`,
      'kubectl scale deployment shop --replicas=5',
      // Short: every tick the ReplicaSet tries again and is refused (a long wait only adds events).
      { tick: 5 },
    ],
    verify: [
      [
        'kubectl get deployment shop',
        'kubectl get resourcequota pods-cap',
        // Room first (12: 5 trays, the client and the surge, even if the broken ReplicaSet makes more).
        // A ReplicaSet the quota refused backs off; undoing first left kind at 3/5 for minutes.
        `kubectl patch resourcequota pods-cap -p '{"spec":{"hard":{"pods":"12"}}}'`,
        `kubectl patch service shop -p '{"spec":{"selector":{"app":"shop"}}}'`,
        'kubectl rollout undo deployment/shop',
        'kubectl rollout status deployment/shop --timeout=180s',
        'kubectl get deployment shop',
        'kubectl exec client -- wget -qO- -T 5 http://shop',
      ],
    ],
  },
  {
    // ★★★ incident "Guessed sizes": new memory numbers went in without measuring. soup's cap is
    // below what it uses (OOMKilled); rice asks for 16Gi, more than any stall has (Pending).
    id: 'ns-k8s-incident-sizes',
    files: { 'soup.yaml': SOUP_OOM_YAML, 'rice.yaml': RICE_BIG_YAML },
    steps: ['kubectl apply -f soup.yaml', 'kubectl apply -f rice.yaml', { tick: 40 }],
    verify: [
      [
        'kubectl get pods -l tier=kitchen -o custom-columns=NAME:.metadata.labels.app,PHASE:.status.phase',
        'kubectl set resources deployment/soup --limits=memory=256Mi',
        'kubectl set resources deployment/rice --requests=memory=256Mi',
        'kubectl rollout status deployment/soup --timeout=120s',
        'kubectl rollout status deployment/rice --timeout=120s',
        'kubectl get deployments',
      ],
    ],
  },
  {
    // ★★★ incident "Copied YAML": the noodle stall was copied from the burger stall's files.
    // Burger listens on 8080, so the readiness probe and the Service's targetPort both say 8080.
    id: 'ns-k8s-incident-copied',
    files: { 'noodle.yaml': NOODLE_YAML, 'service.yaml': NOODLE_SVC_YAML, 'client.yaml': CLIENT_YAML },
    steps: ['kubectl apply -f noodle.yaml', 'kubectl apply -f service.yaml', 'kubectl apply -f client.yaml', { tick: 30 }],
    verify: [
      [
        'kubectl get deployment noodle',
        `kubectl patch deployment noodle -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","readinessProbe":{"httpGet":{"port":80}}}]}}}}'`,
        `kubectl patch service noodle -p '{"spec":{"ports":[{"port":80,"targetPort":80}]}}'`,
        'kubectl rollout status deployment/noodle --timeout=180s',
        'kubectl exec client -- wget -qO- -T 5 http://noodle',
      ],
    ],
  },
  {
    // ★★★ incident "Meant for dev": a teammate tried a new tag and a smaller size "on dev", but the
    // terminal pointed at prod-like. The image tag doesn't exist, and the shop runs on 1 tray.
    id: 'ns-k8s-incident-wrong-cluster',
    clusters: [{ name: 'kind-dev' }, { name: 'prod-like', namespace: 'shop' }],
    files: { 'shop.yaml': SHOP_YAML },
    steps: [
      'kubectl apply -f shop.yaml',
      'kubectl config use-context prod-like',
      'kubectl create namespace shop',
      'kubectl apply -f shop.yaml -n shop',
      { settle: true },
      'kubectl set image deployment/shop web=nginx:1.299',
      'kubectl scale deployment shop --replicas=1',
      { tick: 10 },
      'kubectl config use-context kind-dev',
    ],
    engineOnly: 'needs a second cluster (prod-like)',
    verify: [['kubectl config use-context prod-like', 'kubectl rollout undo deployment/shop', 'kubectl scale deployment shop --replicas=3', 'kubectl rollout status deployment/shop --timeout=180s', 'kubectl get deployment shop']],
  },
  {
    // ★★★ incident "The move to food": the shop moved to namespace food, but only its Deployment
    // went. The menu note (ConfigMap) and the order number (Service) stayed in default.
    id: 'ns-k8s-incident-move',
    files: { 'namespace.yaml': FOOD_NS_YAML, 'menu.yaml': MENU_NOTE_YAML, 'shop.yaml': SHOP_NOTE_YAML, 'service.yaml': SHOP_SVC_YAML, 'client.yaml': CLIENT_YAML },
    steps: ['kubectl apply -f menu.yaml', 'kubectl apply -f service.yaml', 'kubectl apply -f client.yaml', 'kubectl apply -f namespace.yaml', 'kubectl apply -f shop.yaml -n food', { tick: 10 }],
    verify: [
      [
        'kubectl get pods -n food',
        'kubectl apply -f menu.yaml -n food',
        'kubectl rollout status deployment/shop -n food --timeout=180s',
        'kubectl apply -f service.yaml -n food',
        'kubectl exec client -- wget -qO- -T 5 http://shop.food',
      ],
    ],
  },
];
