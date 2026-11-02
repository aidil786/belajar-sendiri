// Helm 4, the honest way: `helm template` renders the built-in practice chart
// (./kedai — a Deployment and a Service) so learners see what a chart makes.
// Commands that change a cluster (install, upgrade, rollback, list, uninstall) are
// explain-only here: their real output depends on the Helm 4 build, so the lesson
// shows them with a Transcript instead of the simulator inventing it.
import { line } from '../git-sim/output';
import type { KObject, KubeResult, KubeState } from './types';
import { toYaml } from './yaml';

export const HELM_EXPLAIN_ONLY = ['install', 'upgrade', 'rollback', 'list', 'ls', 'uninstall', 'delete', 'history', 'status', 'repo', 'pull', 'push', 'version', 'create', 'lint', 'package', 'get', 'search', 'dependency', 'plugin', 'registry', 'show', 'test', 'env'];

export interface ChartValues {
  replicaCount: number;
  image: { repository: string; tag: string };
  service: { type: string; port: number };
}

export const KEDAI_DEFAULTS: ChartValues = { replicaCount: 2, image: { repository: 'nginx', tag: '1.29-alpine' }, service: { type: 'ClusterIP', port: 80 } };

/** The built-in chart's templates, already filled in with values. */
export function renderKedai(release: string, ns: string, v: ChartValues): { source: string; obj: KObject }[] {
  const name = release.includes('kedai') ? release : `${release}-kedai`;
  const labels = {
    'app.kubernetes.io/instance': release,
    'app.kubernetes.io/managed-by': 'Helm',
    'app.kubernetes.io/name': 'kedai',
    'app.kubernetes.io/version': '1.0.0',
    'helm.sh/chart': 'kedai-0.1.0',
  };
  const sel = { 'app.kubernetes.io/instance': release, 'app.kubernetes.io/name': 'kedai' };
  void ns;
  return [
    {
      source: 'kedai/templates/service.yaml',
      obj: { apiVersion: 'v1', kind: 'Service', metadata: { name, labels } as any, spec: { type: v.service.type, ports: [{ port: v.service.port, targetPort: 'http', protocol: 'TCP', name: 'http' }], selector: sel } },
    },
    {
      source: 'kedai/templates/deployment.yaml',
      obj: {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name, labels } as any,
        spec: {
          replicas: v.replicaCount,
          selector: { matchLabels: sel },
          template: {
            metadata: { labels },
            spec: { containers: [{ name: 'kedai', image: `${v.image.repository}:${v.image.tag}`, imagePullPolicy: 'IfNotPresent', ports: [{ name: 'http', containerPort: 80, protocol: 'TCP' }] }] },
          },
        },
      },
    },
  ];
}

function setValue(v: ChartValues, path: string, value: string): boolean {
  const num = /^\d+$/.test(value) ? Number(value) : value;
  switch (path) {
    case 'replicaCount':
      v.replicaCount = Number(value);
      return true;
    case 'image.repository':
      v.image.repository = value;
      return true;
    case 'image.tag':
      v.image.tag = value;
      return true;
    case 'service.type':
      v.service.type = value;
      return true;
    case 'service.port':
      v.service.port = Number(num);
      return true;
  }
  return false;
}

export function helm(state: KubeState, args: string[]): KubeResult {
  const [sub, ...rest] = args;
  const out = (text: string[]) => text.map((t) => line(t));
  if (!sub) return { state, output: out(['The Kubernetes package manager', '', 'Usage:', '  helm [command]']), events: [], ok: true, explain: { key: 'kube.explain.helmHelp' } };
  if (sub === 'template') {
    const words = rest.filter((w, i) => !w.startsWith('--') && !(rest[i - 1] === '--set' || rest[i - 1] === '-f' || rest[i - 1] === '--values' || rest[i - 1] === '-n' || rest[i - 1] === '--namespace'));
    const [release, chart] = words.length >= 2 ? words : ['release-name', words[0]];
    if (!chart || !/^(\.\/)?kedai\/?$/.test(chart)) {
      return {
        state,
        output: out([`Error: INSTALLATION FAILED: path "${chart ?? ''}" not found`.replace('INSTALLATION FAILED: ', '')]),
        events: [{ type: 'error', code: 'helmChart' }],
        ok: false,
        explain: { key: 'kube.err.helmChart' },
      };
    }
    const v: ChartValues = JSON.parse(JSON.stringify(KEDAI_DEFAULTS));
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--set' || rest[i]!.startsWith('--set=')) {
        const pairs = rest[i] === '--set' ? rest[++i] ?? '' : rest[i]!.slice(6);
        for (const p of pairs.split(',')) {
          const [k, val] = p.split('=');
          if (!setValue(v, k ?? '', val ?? '')) {
            // Unknown values are allowed by Helm; the templates just don't use them.
          }
        }
      }
    }
    const docs = renderKedai(release!, 'default', v);
    const text: string[] = [];
    for (const d of docs) text.push('---', `# Source: ${d.source}`, ...toYaml(d.obj).replace(/\n$/, '').split('\n'));
    return { state, output: out(text), events: [], ok: true, explain: { key: 'kube.explain.helmTemplate', params: { count: String(docs.length) } } };
  }
  if (HELM_EXPLAIN_ONLY.includes(sub)) {
    return { state, output: out([`# helm ${sub}: shown in the lesson, not run in this practice terminal`]), events: [], ok: false, stopped: true, explain: { key: `kube.explain.helmOnly`, params: { cmd: `helm ${sub}` } } };
  }
  return { state, output: out([`Error: unknown command "${sub}" for "helm"`, "Run 'helm --help' for usage."]), events: [{ type: 'error', code: 'helmUnknown' }], ok: false, explain: { key: 'kube.err.helmUnknown', params: { cmd: sub } } };
}
