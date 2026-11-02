// Making clusters: a local kind cluster (`kind-dev`: dev-control-plane + 2 workers, like
// `kind create cluster --name dev` with a 3-node config) and a managed "prod-like" cluster,
// with the system namespaces, pods and objects a real one starts with.
import { apiCreate } from './api';
import { builtinRbac } from './rbac';
import { getObj } from './store';
import type { Cluster, KObject, KubeState } from './types';
import { iso } from './util';
import { reconcileCluster } from './clock';
import { initialStaticPods, mirrorPod } from './node/os';

export interface NodeSetup {
  name: string;
  role?: 'control-plane' | 'worker';
  cpu?: string;
  memory?: string;
  labels?: Record<string, string>;
  taints?: { key: string; value?: string; effect: string }[];
}

export interface ClusterSetup {
  /** Context name, e.g. kind-dev or prod-like. The cluster is named the same. */
  name: string;
  preset?: 'kind' | 'cloud';
  /** Nodes (default: kind → <name>-control-plane, <name>-worker, <name>-worker2). */
  nodes?: NodeSetup[];
  /** metrics-server is installed (needed by `kubectl top` and the HPA). */
  metricsServer?: boolean;
  /** Gateway API CRDs + an Envoy Gateway–like controller with GatewayClass `eg`. */
  gateway?: boolean;
  /** LoadBalancer Services get an address (cloud-provider-kind / a cloud). */
  loadBalancer?: boolean;
  /** Namespace the context starts in. */
  namespace?: string;
  /** User name in the kubeconfig. */
  user?: string;
  /** K9: exam-style nodes: etcdctl and etcdutl on the control-plane node, and sudo works (kind nodes have neither). */
  etcdTools?: boolean;
}

const EPOCH = Date.UTC(2026, 9, 31, 1, 0, 0) / 1000; // 31 Oct 2026, 09:00 in Malaysia

export function emptyState(seed: string): KubeState {
  return {
    clusters: {},
    contexts: {},
    currentContext: '',
    files: {},
    dirs: ['/home/you'],
    cwd: '/home/you',
    home: '/home/you',
    clock: EPOCH,
    seed,
    counter: 0,
    forwards: [],
    users: {},
    kubectlVersion: 'v1.37.2',
    kustomizeVersion: 'v5.8.1',
  };
}

function kindNodes(short: string): NodeSetup[] {
  return [{ name: `${short}-control-plane`, role: 'control-plane' }, { name: `${short}-worker` }, { name: `${short}-worker2` }];
}

/** Add a cluster and its context to the state (changes the state). Built 5 minutes "ago". */
export function addCluster(state: KubeState, setup: ClusterSetup): Cluster {
  const kind = setup.preset ?? (setup.name.startsWith('kind-') ? 'kind' : 'cloud');
  const short = setup.name.replace(/^kind-/, '');
  const c: Cluster = {
    name: setup.name,
    version: kind === 'kind' ? 'v1.37.0' : 'v1.37.2',
    server: kind === 'kind' ? `https://127.0.0.1:${41000 + (Object.keys(state.clusters).length * 1373) % 900}` : `https://${short}.k8s.example.com`,
    rv: 300,
    objects: {},
    pods: {},
    nodes: {},
    ipNext: {},
    svcNext: 1,
    portNext: 30080,
    addons: { metricsServer: setup.metricsServer ?? kind === 'cloud', gateway: setup.gateway ?? false, networkPolicy: true, loadBalancer: setup.loadBalancer ?? kind === 'cloud' },
    rr: {},
    kind,
    lost: {},
    load: {},
    hpaSync: {},
    unschedulable: {},
    ...(setup.etcdTools ? { etcdTools: true } : {}),
  };
  state.clusters[setup.name] = c;
  const user = setup.user ?? (kind === 'kind' ? setup.name : `admin@${short}`);
  state.contexts[setup.name] = { cluster: setup.name, user, ...(setup.namespace ? { namespace: setup.namespace } : {}) };
  // kind's admin certificate is kubernetes-admin in the kubeadm:cluster-admins group.
  state.users[user] = kind === 'kind' ? { user: 'kubernetes-admin', groups: ['kubeadm:cluster-admins', 'system:authenticated'] } : { user: `you@${short}.example.com`, groups: ['system:authenticated'] };
  if (!state.currentContext) state.currentContext = setup.name;

  const now = state.clock;
  state.clock = now - 300;
  const add = (o: any) => apiCreate(state, c, o as KObject).obj!;
  for (const ns of ['default', 'kube-node-lease', 'kube-public', 'kube-system', ...(kind === 'kind' ? ['local-path-storage'] : [])]) {
    add({ apiVersion: 'v1', kind: 'Namespace', metadata: { name: ns } });
  }
  for (const r of builtinRbac()) add(r.obj);
  if (kind === 'cloud') {
    add({
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'ClusterRoleBinding',
      metadata: { name: 'you-cluster-admin' },
      roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name: 'cluster-admin' },
      subjects: [{ apiGroup: 'rbac.authorization.k8s.io', kind: 'User', name: `you@${short}.example.com` }],
    });
  }
  // Nodes.
  const nodes = setup.nodes ?? (kind === 'kind' ? kindNodes(short) : [{ name: `${short}-pool-a1` }, { name: `${short}-pool-b2` }, { name: `${short}-pool-c3` }]);
  nodes.forEach((n, i) => {
    const cp = n.role === 'control-plane';
    const labels: Record<string, string> = {
      'beta.kubernetes.io/arch': 'amd64',
      'beta.kubernetes.io/os': 'linux',
      'kubernetes.io/arch': 'amd64',
      'kubernetes.io/hostname': n.name,
      'kubernetes.io/os': 'linux',
      ...(cp ? { 'node-role.kubernetes.io/control-plane': '', 'node.kubernetes.io/exclude-from-external-load-balancers': '' } : {}),
      ...(kind === 'cloud' ? { 'topology.kubernetes.io/zone': `zone-${'abc'[i % 3]}` } : {}),
      ...(n.labels ?? {}),
    };
    const cpu = n.cpu ?? '4';
    const memory = n.memory ?? '8Gi';
    const ip = kind === 'kind' ? `172.18.0.${2 + i}` : `10.0.0.${10 + i}`;
    const taints = [...(cp ? [{ effect: 'NoSchedule', key: 'node-role.kubernetes.io/control-plane' }] : []), ...(n.taints ?? [])];
    const t = iso(state.clock);
    add({
      apiVersion: 'v1',
      kind: 'Node',
      metadata: { name: n.name, labels, annotations: { 'node.alpha.kubernetes.io/ttl': '0', 'volumes.kubernetes.io/controller-managed-attach-detach': 'true' } },
      spec: { podCIDR: `10.244.${i}.0/24`, podCIDRs: [`10.244.${i}.0/24`], ...(kind === 'kind' ? { providerID: `kind://docker/${short}/${n.name}` } : {}), ...(taints.length ? { taints } : {}) },
      status: {
        addresses: [
          { address: ip, type: 'InternalIP' },
          { address: n.name, type: 'Hostname' },
        ],
        allocatable: { cpu, 'ephemeral-storage': '100Gi', memory, pods: '110' },
        capacity: { cpu, 'ephemeral-storage': '100Gi', memory, pods: '110' },
        conditions: [
          { lastHeartbeatTime: t, lastTransitionTime: t, message: 'kubelet has sufficient memory available', reason: 'KubeletHasSufficientMemory', status: 'False', type: 'MemoryPressure' },
          { lastHeartbeatTime: t, lastTransitionTime: t, message: 'kubelet has no disk pressure', reason: 'KubeletHasNoDiskPressure', status: 'False', type: 'DiskPressure' },
          { lastHeartbeatTime: t, lastTransitionTime: t, message: 'kubelet has sufficient PID available', reason: 'KubeletHasSufficientPID', status: 'False', type: 'PIDPressure' },
          { lastHeartbeatTime: t, lastTransitionTime: t, message: 'kubelet is posting ready status', reason: 'KubeletReady', status: 'True', type: 'Ready' },
        ],
        nodeInfo: {
          architecture: 'amd64',
          bootID: '',
          containerRuntimeVersion: kind === 'kind' ? 'containerd://2.3.4' : 'containerd://2.1.4',
          kernelVersion: '6.8.0-1021-azure',
          kubeProxyVersion: '',
          kubeletVersion: c.version,
          machineID: '',
          operatingSystem: 'linux',
          osImage: kind === 'kind' ? 'Debian GNU/Linux 13 (trixie)' : 'Ubuntu 24.04.3 LTS',
          systemUUID: '',
        },
      },
    });
    c.nodes[n.name] = { up: true, heartbeat: state.clock, images: [], notReadySince: null };
  });
  // Default objects in every namespace: the `default` ServiceAccount and the root CA ConfigMap.
  for (const ns of ['default', 'kube-node-lease', 'kube-public', 'kube-system', ...(kind === 'kind' ? ['local-path-storage'] : [])]) {
    add({ apiVersion: 'v1', kind: 'ServiceAccount', metadata: { name: 'default', namespace: ns } });
    add({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'kube-root-ca.crt', namespace: ns, annotations: { 'kubernetes.io/description': 'Contains a CA bundle that can be used to verify the kube-apiserver when using internal endpoints such as the internal service IPs or kubernetes.default.svc. No other usage is guaranteed across distributions of Kubernetes clusters.' } }, data: { 'ca.crt': '-----BEGIN CERTIFICATE-----\n(practice certificate)\n-----END CERTIFICATE-----\n' } });
  }
  add({
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name: 'kubernetes', namespace: 'default', labels: { component: 'apiserver', provider: 'kubernetes' } },
    spec: { clusterIP: '10.96.0.1', ports: [{ name: 'https', port: 443, protocol: 'TCP', targetPort: 6443 }], sessionAffinity: 'None', type: 'ClusterIP' },
  });
  add({
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name: 'kube-dns', namespace: 'kube-system', labels: { 'k8s-app': 'kube-dns', 'kubernetes.io/cluster-service': 'true', 'kubernetes.io/name': 'CoreDNS' } },
    spec: {
      clusterIP: '10.96.0.10',
      ports: [
        { name: 'dns', port: 53, protocol: 'UDP', targetPort: 53 },
        { name: 'dns-tcp', port: 53, protocol: 'TCP', targetPort: 53 },
        { name: 'metrics', port: 9153, protocol: 'TCP', targetPort: 9153 },
      ],
      selector: { 'k8s-app': 'kube-dns' },
    },
  });
  if (kind === 'kind') {
    add({
      apiVersion: 'storage.k8s.io/v1',
      kind: 'StorageClass',
      metadata: { name: 'standard', annotations: { 'storageclass.kubernetes.io/is-default-class': 'true' } },
      provisioner: 'rancher.io/local-path',
      reclaimPolicy: 'Delete',
      volumeBindingMode: 'WaitForFirstConsumer',
    });
  } else {
    add({
      apiVersion: 'storage.k8s.io/v1',
      kind: 'StorageClass',
      metadata: { name: 'standard-rwo', annotations: { 'storageclass.kubernetes.io/is-default-class': 'true' } },
      provisioner: 'pd.csi.storage.gke.io',
      reclaimPolicy: 'Delete',
      volumeBindingMode: 'WaitForFirstConsumer',
      allowVolumeExpansion: true,
    });
  }
  // System workloads (their images are already on the nodes).
  const sysImages = systemImages(c);
  for (const nrt of Object.values(c.nodes)) nrt.images.push(...sysImages);
  const cpName = nodes.find((n) => n.role === 'control-plane')?.name;
  const cpTol = [{ effect: 'NoSchedule', key: 'node-role.kubernetes.io/control-plane' }, { key: 'CriticalAddonsOnly', operator: 'Exists' }];
  add({
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: 'coredns', namespace: 'kube-system', labels: { 'k8s-app': 'kube-dns' } },
    spec: {
      replicas: 2,
      selector: { matchLabels: { 'k8s-app': 'kube-dns' } },
      strategy: { type: 'RollingUpdate', rollingUpdate: { maxSurge: '25%', maxUnavailable: 1 } },
      template: {
        metadata: { labels: { 'k8s-app': 'kube-dns' } },
        spec: {
          containers: [{ name: 'coredns', image: 'registry.k8s.io/coredns/coredns:v1.14.6', args: ['-conf', '/etc/coredns/Corefile'], ports: [{ containerPort: 53, name: 'dns', protocol: 'UDP' }], resources: { limits: { memory: '170Mi' }, requests: { cpu: '100m', memory: '70Mi' } } }],
          priorityClassName: 'system-cluster-critical',
          tolerations: cpTol,
          ...(cpName ? { nodeSelector: { 'kubernetes.io/os': 'linux' } } : {}),
        },
      },
    },
  });
  for (const [name, image] of [
    ['kube-proxy', `registry.k8s.io/kube-proxy:${c.version}`],
    ...(kind === 'kind' ? [['kindnet', 'docker.io/kindest/kindnetd:v20260820-69b56db7']] : []),
  ] as const) {
    add({
      apiVersion: 'apps/v1',
      kind: 'DaemonSet',
      metadata: { name, namespace: 'kube-system', labels: { 'k8s-app': name } },
      spec: {
        selector: { matchLabels: { 'k8s-app': name } },
        template: { metadata: { labels: { 'k8s-app': name } }, spec: { containers: [{ name, image }], hostNetwork: true, tolerations: [{ operator: 'Exists' }], priorityClassName: 'system-node-critical' } },
      },
    });
  }
  if (cpName) {
    // The control plane: static pods from the kubeadm v1.37.0 manifests, shown as mirror pods
    // (named <component>-<node>, owned by the Node, with the kubernetes.io/config.* annotations).
    for (const sp of initialStaticPods(c, cpName)) add(mirrorPod(c, cpName, sp, state.clock));
  }
  if (kind === 'kind') {
    add({
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'local-path-provisioner', namespace: 'local-path-storage' },
      spec: {
        replicas: 1,
        selector: { matchLabels: { app: 'local-path-provisioner' } },
        template: { metadata: { labels: { app: 'local-path-provisioner' } }, spec: { containers: [{ name: 'local-path-provisioner', image: 'docker.io/kindest/local-path-provisioner:v20260820-69b56db7' }], tolerations: cpTol } },
      },
    });
  }
  if (c.addons.metricsServer) {
    add({
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'metrics-server', namespace: 'kube-system', labels: { 'k8s-app': 'metrics-server' } },
      spec: {
        replicas: 1,
        selector: { matchLabels: { 'k8s-app': 'metrics-server' } },
        template: { metadata: { labels: { 'k8s-app': 'metrics-server' } }, spec: { containers: [{ name: 'metrics-server', image: 'registry.k8s.io/metrics-server/metrics-server:v0.8.0', args: ['--secure-port=10250'] }] } },
      },
    });
  }
  if (c.addons.gateway) {
    add({ apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'envoy-gateway-system' } });
    add({ apiVersion: 'v1', kind: 'ServiceAccount', metadata: { name: 'default', namespace: 'envoy-gateway-system' } });
    add({
      apiVersion: 'gateway.networking.k8s.io/v1',
      kind: 'GatewayClass',
      metadata: { name: 'eg' },
      spec: { controllerName: 'gateway.envoyproxy.io/gatewayclass-controller' },
    });
  }
  // Let the system pods start, then jump to "now" (they were made 5 minutes ago).
  for (let i = 0; i < 12; i += 1) {
    state.clock += 1;
    reconcileCluster(state, c, [], true);
  }
  state.clock = now;
  for (const nrt of Object.values(c.nodes)) nrt.heartbeat = now;
  // Old events from start-up are noise for learners.
  for (const [k, o] of Object.entries(c.objects)) if (o.kind === 'Event') delete c.objects[k];
  void getObj;
  return c;
}

/** Images every node already has (system components). */
function systemImages(c: Cluster): string[] {
  return [
    'registry.k8s.io/coredns/coredns:v1.14.6',
    `registry.k8s.io/kube-proxy:${c.version}`,
    'docker.io/kindest/kindnetd:v20260820-69b56db7',
    'registry.k8s.io/etcd:3.7.0-0',
    `registry.k8s.io/kube-apiserver:${c.version}`,
    `registry.k8s.io/kube-controller-manager:${c.version}`,
    `registry.k8s.io/kube-scheduler:${c.version}`,
    'docker.io/kindest/local-path-provisioner:v20260820-69b56db7',
    'registry.k8s.io/metrics-server/metrics-server:v0.8.0',
    'registry.k8s.io/pause:3.10',
  ];
}
