// Fault injection for lessons: kill a node, a bad image, a memory leak, failing
// readiness, a crashed container, a deleted pod, a lunch-rush of traffic.
import { apiDelete, apiUpdate } from './api';
import { reconcileAll } from './clock';
import { cpNode, ensureOs, MANIFESTS, noteKubelet, startKubelet, stopKubelet, writeNodeFile } from './node/os';
import { currentCluster, currentNamespace, getObj, isTerminating, listObjs, ownedBy } from './store';
import type { Cluster, KObject, KubeEvent, KubeResult, KubeState } from './types';
import { clone, matches, parseSelector } from './util';

export type Fault =
  /** The stall closes: its kubelet stops. NotReady after 50 s, pods replaced after 5 more minutes. */
  | { type: 'killNode'; node?: string }
  | { type: 'restoreNode'; node?: string }
  /** Like `kubectl delete pod` (no waiting). Default: the first pod matching `selector`. */
  | { type: 'deletePod'; pod?: string; selector?: string; namespace?: string }
  /** A release with a typo in its image tag (a real `set image`). */
  | { type: 'badImage'; deployment: string; image?: string; namespace?: string }
  /** The app's memory grows every second until its limit: OOMKilled. */
  | { type: 'memoryLeak'; deployment?: string; pod?: string; mibPerSecond?: number; namespace?: string }
  /** The app answers 503 on every path (readiness fails, endpoints go away). `on: false` heals it. */
  | { type: 'readinessFail'; deployment?: string; pod?: string; on?: boolean; namespace?: string }
  /** The main process exits once (the container restarts inside the same pod). */
  | { type: 'crash'; pod?: string; selector?: string; namespace?: string }
  /** Requests per second hitting a Service (drives CPU, `kubectl top` and the HPA). */
  | { type: 'traffic'; service: string; rps: number; namespace?: string }
  /** K9: `systemctl stop kubelet` on a node (default: the busiest worker). NotReady after 50 s. */
  | { type: 'stopKubelet'; node?: string }
  | { type: 'startKubelet'; node?: string }
  /**
   * K9: someone edits a control-plane manifest on the control-plane node and breaks it:
   * `yaml` (a missing colon: the pod goes away), `image` (a tag typo: ImagePullBackOff),
   * `flag` (a misspelt flag: CrashLoopBackOff), `path` (a kubeconfig that is not there: CrashLoopBackOff),
   * `move` (the file moved to /root: the pod goes away). The kubelet notices a few seconds later.
   */
  | { type: 'breakStaticPod'; component: 'kube-scheduler' | 'kube-controller-manager' | 'kube-apiserver' | 'etcd'; how: 'yaml' | 'image' | 'flag' | 'path' | 'move' };

function podsOf(c: Cluster, ns: string, f: { deployment?: string; pod?: string; selector?: string }): KObject[] {
  if (f.pod) return listObjs(c, 'Pod', ns).filter((p) => p.metadata.name === f.pod);
  if (f.deployment) {
    const d = getObj(c, 'Deployment', ns, f.deployment);
    if (!d) return [];
    return ownedBy(c, d, 'ReplicaSet').flatMap((rs) => ownedBy(c, rs, 'Pod'));
  }
  if (f.selector) {
    const reqs = parseSelector(f.selector);
    return listObjs(c, 'Pod', ns).filter((p) => matches(p.metadata.labels, reqs));
  }
  return listObjs(c, 'Pod', ns);
}

/** The worker with the most of the learner's pods (the most interesting one to lose). */
function busiestWorker(c: Cluster, ns: string): string | undefined {
  const workers = listObjs(c, 'Node').filter((n) => !n.metadata.labels?.['node-role.kubernetes.io/control-plane'] && c.nodes[n.metadata.name]?.up);
  const count = (n: KObject) => listObjs(c, 'Pod', ns).filter((p) => p.spec.nodeName === n.metadata.name).length;
  return workers.sort((a, b) => count(b) - count(a) || a.metadata.name.localeCompare(b.metadata.name))[0]?.metadata.name;
}

export function injectFault(state: KubeState, fault: Fault): KubeResult {
  const s = clone(state);
  const c = currentCluster(s);
  const ev: KubeEvent[] = [];
  const fail = (key: string): KubeResult => ({ state, output: [], events: [{ type: 'error', code: key }], ok: false, explain: { key } });
  if (!c) return fail('kube.err.noCluster');
  const ns = ('namespace' in fault && fault.namespace) || currentNamespace(s);
  switch (fault.type) {
    case 'killNode': {
      const node = fault.node ?? busiestWorker(c, ns);
      if (!node || !c.nodes[node]) return fail('kube.err.faultNoNode');
      c.nodes[node]!.up = false;
      noteKubelet(s, c, node, false);
      ev.push({ type: 'nodeDown', node });
      break;
    }
    case 'restoreNode': {
      const node = fault.node ?? Object.keys(c.nodes).find((n) => !c.nodes[n]!.up);
      if (!node || !c.nodes[node]) return fail('kube.err.faultNoNode');
      c.nodes[node]!.up = true;
      noteKubelet(s, c, node, true);
      break;
    }
    case 'stopKubelet': {
      const node = fault.node ?? busiestWorker(c, ns);
      if (!node || !c.nodes[node]) return fail('kube.err.faultNoNode');
      stopKubelet(s, c, node, ev);
      break;
    }
    case 'startKubelet': {
      const node = fault.node ?? Object.keys(c.nodes).find((n) => !c.nodes[n]!.up);
      if (!node || !c.nodes[node]) return fail('kube.err.faultNoNode');
      startKubelet(s, c, node, ev);
      break;
    }
    case 'breakStaticPod': {
      const node = cpNode(c);
      if (!node) return fail('kube.err.faultNoNode');
      const os = ensureOs(s, c, node);
      const file = `${MANIFESTS}/${fault.component}.yaml`;
      const text = os.files[file];
      if (text === undefined) return fail('kube.err.faultNoPod');
      if (fault.how === 'move') {
        writeNodeFile(os, `/root/${fault.component}.yaml`, text);
        delete os.files[file];
      } else {
        const next =
          fault.how === 'yaml'
            ? text.replace(/^ {2}containers:$/m, '  containers')
            : fault.how === 'image'
              ? text.replace(/^(\s+image: \S+:v?\d[\w.-]*?)(\d)$/m, '$1$2$2')
              : fault.how === 'flag'
                ? text.replace(/--bind-address=/, '--bind-adress=').replace(/--advertise-address=/, '--advertize-address=')
                : text.replace(/--kubeconfig=\/etc\/kubernetes\/([\w-]+)\.conf/, (_m, f: string) => `--kubeconfig=/etc/kubernetes/${f.replace(/er$/, 'r')}.conf`);
        if (next === text) return fail('kube.err.faultNoPod');
        writeNodeFile(os, file, next);
      }
      os.mtime[file] = s.clock;
      os.dirty = s.clock;
      ev.push({ type: 'manifestChanged', node, file });
      break;
    }
    case 'deletePod': {
      const pod = podsOf(c, ns, fault).find((p) => !isTerminating(p));
      if (!pod) return fail('kube.err.faultNoPod');
      apiDelete(s, c, 'Pod', ns, pod.metadata.name, { by: 'user', events: ev });
      break;
    }
    case 'badImage': {
      const d = getObj(c, 'Deployment', ns, fault.deployment);
      if (!d) return fail('kube.err.faultNoPod');
      const next = clone(d);
      const ctr = next.spec.template.spec.containers[0];
      ctr.image = fault.image ?? String(ctr.image).replace(/:(\S+)$/, (_m: string, tag: string) => `:${tag.replace(/\d+$/, (n) => `${n}9`)}`);
      apiUpdate(s, c, next, { events: ev });
      break;
    }
    case 'memoryLeak':
    case 'readinessFail':
    case 'crash': {
      const pods = podsOf(c, ns, fault as { deployment?: string; pod?: string; selector?: string }).filter((p) => !isTerminating(p));
      if (!pods.length) return fail('kube.err.faultNoPod');
      for (const p of fault.type === 'crash' ? pods.slice(0, 1) : pods) {
        for (const r of Object.values(c.pods[p.metadata.uid]?.containers ?? {})) {
          if (fault.type === 'memoryLeak') r.leak = fault.mibPerSecond ?? 8;
          if (fault.type === 'readinessFail') r.sick = fault.on ?? true;
          if (fault.type === 'crash' && r.startedAt !== null) {
            r.killAt = s.clock;
            r.killReason = 'crash';
          }
        }
      }
      break;
    }
    case 'traffic': {
      if (!getObj(c, 'Service', ns, fault.service)) return fail('kube.err.faultNoService');
      c.load[`${ns}/${fault.service}`] = fault.rps;
      break;
    }
  }
  reconcileAll(s, ev);
  const k9 = fault.type === 'stopKubelet' || fault.type === 'startKubelet' || fault.type === 'breakStaticPod';
  return { state: s, output: [], events: ev, ok: true, changed: true, explain: { key: k9 ? `k9.explain.fault.${fault.type}` : `kube.explain.fault.${fault.type}` } };
}
