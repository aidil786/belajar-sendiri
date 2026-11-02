// World K9 "Cluster Admin" (CKA pack): the node shell. `ssh dev-worker` (exam style) or
// `docker exec -it dev-worker bash` (kind style) opens a shell on a node: systemctl and
// journalctl for the kubelet, crictl, static pod manifests, kubeadm certs, etcd backups.
//
// Truth checks: `npm run verify:k8s` can only run kubectl on a real kind cluster, so only
// kubectl-only lists are compared there (k9-static-pods). Lists that use the node shell or a
// node fault are engine-only; their node outputs come from src/engine/foodcourt-sim/fixtures/cka.json,
// recorded from the real kind node image and refreshed by .github/workflows/capture-cka.yml.
import type { KubeScenario } from '~/engine/foodcourt-sim';
import { SHOP_YAML } from './model';

const NODE_SHELL = 'node shell: node outputs are recorded in fixtures/cka.json (refresh with capture-cka.yml)';

/** The oven tray on stall dev-worker2: it starts, says why it gives up, and exits (CrashLoopBackOff). */
const OVEN_YAML = `apiVersion: v1
kind: Pod
metadata:
  name: oven
  labels:
    app: oven
spec:
  nodeSelector:
    kubernetes.io/hostname: dev-worker2
  containers:
    - name: oven
      image: busybox:1.37
      command: ["sh", "-c", "echo oven: no gas, cannot heat; exit 1"]
`;

/** The etcd certificate flags (kubeadm's paths). */
export const ETCD_TLS = '--cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key';
/** Exam style: etcdctl on the control-plane node. */
export const ETCD_SAVE = `etcdctl --endpoints=https://127.0.0.1:2379 ${ETCD_TLS} snapshot save /opt/backup.db`;
/** Kind style: etcdctl inside the etcd pod (kind nodes have no etcdctl). */
export const ETCD_SAVE_KIND = `kubectl -n kube-system exec etcd-dev-control-plane -- etcdctl --endpoints=https://127.0.0.1:2379 ${ETCD_TLS} snapshot save /var/lib/etcd/backup.db`;

const SHOP = { 'shop.yaml': SHOP_YAML };
const EXAM = [{ name: 'kind-dev', etcdTools: true }];

export const k9Scenarios: KubeScenario[] = [
  {
    // A healthy stall: look at its kubelet from inside.
    id: 'k9-kubelet',
    files: SHOP,
    steps: ['kubectl apply -f shop.yaml'],
    verify: [['ssh dev-worker', 'systemctl status kubelet', 'systemctl is-active kubelet', 'journalctl -u kubelet -n 5 --no-pager', 'exit']],
    engineOnly: NODE_SHELL,
  },
  {
    // The kubelet on dev-worker stopped a minute ago: the node is NotReady. Start it again.
    id: 'k9-notready',
    files: SHOP,
    steps: ['kubectl apply -f shop.yaml', { settle: true }, { fault: { type: 'stopKubelet', node: 'dev-worker' } }, { tick: 60 }],
    verify: [['kubectl get nodes', 'ssh dev-worker', 'systemctl status kubelet', 'systemctl start kubelet', 'exit', 'sleep 5', 'kubectl get nodes']],
    engineOnly: NODE_SHELL,
  },
  {
    // The manager's office runs as static pods: mirror pods named <component>-<node>, owned by the Node.
    id: 'k9-static-pods',
    verify: [
      [
        'kubectl get pods -n kube-system -l tier=control-plane -o name',
        'kubectl get pod kube-scheduler-dev-control-plane -n kube-system -o jsonpath={.metadata.annotations.kubernetes\\.io/config\\.source}',
        'kubectl get pod kube-scheduler-dev-control-plane -n kube-system -o jsonpath={.metadata.ownerReferences[0].kind}',
      ],
    ],
  },
  {
    // Someone moved the scheduler's manifest out of the folder: new trays wait in Pending, with no events.
    id: 'k9-scheduler-down',
    steps: [{ fault: { type: 'breakStaticPod', component: 'kube-scheduler', how: 'move' } }, { tick: 5 }, 'kubectl run tray --image=nginx:1.29-alpine'],
    verify: [['kubectl get pods', 'kubectl get pods -n kube-system -l component=kube-scheduler', 'ssh dev-control-plane', 'ls /etc/kubernetes/manifests', 'mv /root/kube-scheduler.yaml /etc/kubernetes/manifests/', 'exit', 'sleep 10', 'kubectl get pods']],
    engineOnly: NODE_SHELL,
  },
  {
    // A typo in the scheduler's --kubeconfig path: the scheduler crashes over and over.
    id: 'k9-scheduler-crash',
    steps: [{ fault: { type: 'breakStaticPod', component: 'kube-scheduler', how: 'path' } }, { tick: 40 }],
    verify: [
      [
        'kubectl get pods -n kube-system -l component=kube-scheduler',
        'kubectl logs -n kube-system kube-scheduler-dev-control-plane',
        'ssh dev-control-plane',
        'grep kubeconfig /etc/kubernetes/manifests/kube-scheduler.yaml',
        "sed -i 's/schedulr.conf/scheduler.conf/' /etc/kubernetes/manifests/kube-scheduler.yaml",
        'exit',
        'sleep 10',
        'kubectl get pods -n kube-system -l component=kube-scheduler',
      ],
    ],
    engineOnly: NODE_SHELL,
  },
  {
    // The oven tray keeps crashing on dev-worker2: look under the kubelet with crictl.
    id: 'k9-crictl',
    files: { 'oven.yaml': OVEN_YAML },
    steps: ['kubectl apply -f oven.yaml'],
    verify: [['kubectl get pods -o wide', 'docker exec -it dev-worker2 bash', 'crictl pods --name oven', 'crictl ps -a --name oven', 'exit']],
    engineOnly: NODE_SHELL,
  },
  {
    // Admin view of maintenance: drain a stall, see the trays move, open it again.
    id: 'k9-drain',
    files: SHOP,
    steps: ['kubectl apply -f shop.yaml'],
    verify: [['kubectl drain dev-worker --ignore-daemonsets', 'kubectl get nodes', 'kubectl get pods -o wide', 'kubectl uncordon dev-worker', 'kubectl get nodes']],
    engineOnly: 'drain output depends on where the real scheduler put the CoreDNS and local-path pods',
  },
  {
    // Exam-style control plane (etcdctl and etcdutl installed): take an etcd snapshot.
    id: 'k9-etcd-backup',
    clusters: EXAM,
    files: SHOP,
    steps: ['kubectl apply -f shop.yaml'],
    verify: [['ssh dev-control-plane', ETCD_SAVE, 'etcdutl --write-out=table snapshot status /opt/backup.db', 'exit']],
    engineOnly: NODE_SHELL,
  },
  {
    // A snapshot was taken, then the shop's Deployment was deleted by mistake. Restore etcd.
    id: 'k9-etcd-restore',
    clusters: EXAM,
    files: SHOP,
    steps: ['kubectl apply -f shop.yaml', { settle: true }, 'ssh dev-control-plane', ETCD_SAVE, 'exit', 'kubectl delete deployment shop'],
    verify: [
      [
        'kubectl get deployments',
        'ssh dev-control-plane',
        'etcdutl --data-dir /var/lib/etcd-restore snapshot restore /opt/backup.db',
        "sed -i 's#/var/lib/etcd$#/var/lib/etcd-restore#' /etc/kubernetes/manifests/etcd.yaml",
        'exit',
        'sleep 30',
        'kubectl get deployments',
      ],
    ],
    engineOnly: NODE_SHELL,
  },
  {
    // On kind: etcdctl and etcdutl live in the etcd pod, so you run them with kubectl exec.
    id: 'k9-etcd-kind',
    files: SHOP,
    steps: ['kubectl apply -f shop.yaml'],
    verify: [[ETCD_SAVE_KIND, 'kubectl -n kube-system exec etcd-dev-control-plane -- etcdutl --write-out=table snapshot status /var/lib/etcd/backup.db']],
    engineOnly: 'etcd prints times, sizes and hashes that change every run; recorded in fixtures/cka.json (capture-cka.yml)',
  },
  {
    // The control-plane node: its static pod manifests, and the certificates' expiry dates.
    id: 'k9-certs',
    verify: [
      ['docker exec -it dev-control-plane bash', 'ls /etc/kubernetes/manifests', 'grep image: /etc/kubernetes/manifests/kube-scheduler.yaml', 'exit'],
      ['docker exec -it dev-control-plane bash', 'kubeadm certs check-expiration', 'exit'],
    ],
    engineOnly: NODE_SHELL,
  },
  {
    // Boss: dev-worker2's kubelet is stopped, and the shop's Deployment is gone. A snapshot waits in /opt.
    id: 'k9-boss',
    clusters: EXAM,
    files: SHOP,
    steps: [
      'kubectl apply -f shop.yaml',
      { settle: true },
      'ssh dev-control-plane',
      ETCD_SAVE,
      'exit',
      'kubectl delete deployment shop',
      { fault: { type: 'stopKubelet', node: 'dev-worker2' } },
      { tick: 60 },
    ],
    verify: [
      [
        'kubectl get nodes',
        'ssh dev-worker2',
        'systemctl start kubelet',
        'exit',
        'ssh dev-control-plane',
        'etcdutl --data-dir /var/lib/etcd-restore snapshot restore /opt/backup.db',
        "sed -i 's#/var/lib/etcd$#/var/lib/etcd-restore#' /etc/kubernetes/manifests/etcd.yaml",
        'exit',
        'sleep 30',
        'kubectl get nodes',
        'kubectl get deployments',
      ],
    ],
    engineOnly: NODE_SHELL,
  },
];
