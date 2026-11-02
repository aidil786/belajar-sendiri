// World K9 "Cluster Admin", part 2 (lessons l07–l12, the boss) and the three node-level night shift
// drills. Most K9 cards reuse the node-shell scenarios in ./k9.ts (k9-drain, k9-etcd-backup,
// k9-etcd-restore, k9-etcd-kind, k9-certs, k9-boss); the ones below add what part 2 needs.
//
// Truth checks: `npm run verify:k8s` runs kubectl-only lists on a real kind cluster (CI). Lists that
// use the node shell or a node fault are engine-only; their node outputs come from
// src/engine/foodcourt-sim/fixtures/cka.json (recorded on the kind node image, refreshed by capture-cka.yml).
import type { KubeScenario } from '~/engine/foodcourt-sim';
import { SHOP_SVC_YAML, SHOP_YAML } from './model';

const NODE_SHELL = 'node shell: node outputs are recorded in fixtures/cka.json (refresh with capture-cka.yml)';

/** A small tray that only waits: the place to ask questions from (nslookup, wget). */
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

const SHOP_ALL = { 'shop.yaml': SHOP_YAML, 'service.yaml': SHOP_SVC_YAML, 'client.yaml': CLIENT_YAML };
const SHOP_ALL_STEPS = ['kubectl apply -f shop.yaml', 'kubectl apply -f service.yaml', 'kubectl apply -f client.yaml'];

export const k9AdminScenarios: KubeScenario[] = [
  {
    // L12: the food court's phone book (CoreDNS behind the kube-dns Service) and kube-proxy on every stall.
    id: 'k9-dns',
    files: SHOP_ALL,
    steps: SHOP_ALL_STEPS,
    verify: [
      ['kubectl get pods -n kube-system -l k8s-app=kube-dns', 'kubectl get svc -n kube-system'],
      ['kubectl get pods -n kube-system -l k8s-app=kube-proxy -o name', 'kubectl get endpointslice -l kubernetes.io/service-name=kube-dns -n kube-system -o name'],
    ],
  },
  {
    // L12: someone scaled CoreDNS to 0 "to save money". Bring the phone book back.
    // Where the sim breaks: names still resolve here while CoreDNS is away (the lesson says so).
    id: 'k9-coredns-down',
    files: SHOP_ALL,
    steps: [...SHOP_ALL_STEPS, { settle: true }, 'kubectl scale deployment coredns -n kube-system --replicas=0'],
    verify: [
      [
        'kubectl get pods -n kube-system -l k8s-app=kube-dns',
        'kubectl get deployment coredns -n kube-system',
        'kubectl scale deployment coredns -n kube-system --replicas=2',
        'kubectl rollout status deployment coredns -n kube-system --timeout=120s',
        'kubectl get deployment coredns -n kube-system',
      ],
    ],
    engineOnly: "it scales the real cluster's CoreDNS to 0; other lists need cluster DNS while they run",
  },
  {
    // L11: a new cook's certificate says CN=aina, O=kitchen. Give her (or the kitchen group) rights to read trays.
    id: 'k9-users',
    files: { 'shop.yaml': SHOP_YAML },
    steps: ['kubectl apply -f shop.yaml'],
    verify: [
      [
        'kubectl create role cook --verb=get --verb=list --resource=pods',
        'kubectl auth can-i list pods --as=aina',
        'kubectl create rolebinding cook-aina --role=cook --user=aina',
        'kubectl auth can-i list pods --as=aina',
        'kubectl auth can-i delete pods --as=aina',
      ],
      [
        'kubectl create role cook --verb=get --verb=list --resource=pods',
        'kubectl create rolebinding cook-kitchen --role=cook --group=kitchen',
        'kubectl auth can-i list pods --as=aina --as-group=kitchen',
        'kubectl auth can-i delete pods --as=aina --as-group=kitchen',
      ],
    ],
  },
  {
    // Night shift ★: the kubelet on dev-worker2 was stopped for a disk check and never started again.
    id: 'ns-k8s-kubelet-stopped',
    files: { 'shop.yaml': SHOP_YAML },
    steps: ['kubectl apply -f shop.yaml', { settle: true }, { fault: { type: 'stopKubelet', node: 'dev-worker2' } }, { tick: 60 }],
    verify: [['kubectl get nodes', 'ssh dev-worker2', 'systemctl status kubelet', 'systemctl start kubelet', 'exit', 'sleep 5', 'kubectl get nodes']],
    engineOnly: NODE_SHELL,
  },
  {
    // Night shift ★★: a typo in the scheduler's manifest (--bind-adress). The scheduler crash-loops,
    // so the fourth shop tray waits in Pending.
    id: 'ns-k8s-static-typo',
    files: { 'shop.yaml': SHOP_YAML },
    steps: [
      'kubectl apply -f shop.yaml',
      { settle: true },
      { fault: { type: 'breakStaticPod', component: 'kube-scheduler', how: 'flag' } },
      { tick: 40 },
      'kubectl scale deployment shop --replicas=4',
      { tick: 5 },
    ],
    verify: [
      [
        'kubectl get pods -n kube-system -l component=kube-scheduler',
        'kubectl logs -n kube-system kube-scheduler-dev-control-plane',
        'ssh dev-control-plane',
        'grep bind /etc/kubernetes/manifests/kube-scheduler.yaml',
        "sed -i 's/bind-adress/bind-address/' /etc/kubernetes/manifests/kube-scheduler.yaml",
        'exit',
        'sleep 20',
        'kubectl get pods -l app=shop',
      ],
    ],
    engineOnly: NODE_SHELL,
  },
  {
    // Night shift ★★★ incident: last night's maintenance was never undone. The scheduler's manifest
    // still sits in /root, and dev-worker2's kubelet is still stopped. The lunch order asks for 5 trays.
    id: 'ns-k8s-incident-node',
    files: { 'shop.yaml': SHOP_YAML },
    steps: [
      'kubectl apply -f shop.yaml',
      { settle: true },
      { fault: { type: 'breakStaticPod', component: 'kube-scheduler', how: 'move' } },
      { fault: { type: 'stopKubelet', node: 'dev-worker2' } },
      { tick: 60 },
      'kubectl scale deployment shop --replicas=5',
      { tick: 5 },
    ],
    verify: [
      [
        'kubectl get nodes',
        'kubectl get pods -l app=shop',
        'ssh dev-worker2',
        'systemctl start kubelet',
        'exit',
        'ssh dev-control-plane',
        'mv /root/kube-scheduler.yaml /etc/kubernetes/manifests/',
        'exit',
        'sleep 20',
        'kubectl get nodes',
        'kubectl get pods -l app=shop',
      ],
    ],
    engineOnly: NODE_SHELL,
  },
];
