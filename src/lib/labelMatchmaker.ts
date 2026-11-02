// Pure logic for LabelMatchmaker: labels on pods (trays), a selector on a Service (order number)
// or a Deployment (standing order). A Service sends traffic to every pod whose labels contain all
// of its selector's key=value pairs; no match means no endpoints. A Deployment's selector must
// match its own pod template's labels, or the API server refuses it.
import {
  kubectlTable,
  labelString,
  nameSuffix,
  podIP,
  selectorMismatchMessage,
} from './k8sMessages';

export type Labels = Record<string, string>;

export interface LmPod {
  name: string;
  labels: Labels;
}

export type LmTask =
  /** Make the Service select exactly these pods (by changing pod labels). */
  | { type: 'select'; pods: string[] }
  /** Make the Deployment's template labels match its selector. */
  | { type: 'template' };

const LABEL_RE = /^([A-Za-z0-9][-A-Za-z0-9_./]*)=([-A-Za-z0-9_.]*)$/;

/** "app=shop" → ["app", "shop"] (null when it is not a label). */
export function parseLabel(s: string): [string, string] | null {
  const m = LABEL_RE.exec(s.trim());
  return m ? [m[1]!, m[2]!] : null;
}

/** Add a label. A pod can have only one value per key, so app=web replaces app=shop. */
export function withLabel(labels: Labels, label: string): Labels {
  const kv = parseLabel(label);
  return kv ? { ...labels, [kv[0]]: kv[1] } : labels;
}

export function withoutLabel(labels: Labels, key: string): Labels {
  const next = { ...labels };
  delete next[key];
  return next;
}

/** Equality-based selector match. An empty selector selects nothing for a Service. */
export function selects(selector: Labels, labels: Labels): boolean {
  const keys = Object.keys(selector);
  return keys.length > 0 && keys.every((k) => labels[k] === selector[k]);
}

export function matched(selector: Labels, pods: LmPod[]): string[] {
  return pods.filter((p) => selects(selector, p.labels)).map((p) => p.name);
}

/** Why a pod is not picked: the first selector pair it lacks. */
export function missingPair(
  selector: Labels,
  labels: Labels,
): { key: string; want: string; has?: string } | null {
  for (const k of Object.keys(selector))
    if (labels[k] !== selector[k]) return { key: k, want: selector[k]!, has: labels[k] };
  return null;
}

/** `kubectl get endpointslices -l kubernetes.io/service-name=<svc>` (kubectl 1.37 layout). */
export function endpointSliceTable(
  service: string,
  pods: LmPod[],
  selector: Labels,
  port: number,
  age = '12s',
): string[] {
  const ips = pods
    .map((p, i) => ({ p, ip: podIP(p.name, i) }))
    .filter(({ p }) => selects(selector, p.labels))
    .map(({ ip }) => ip);
  const shown =
    ips.length > 3 ? `${ips.slice(0, 3).join(',')} + ${ips.length - 3} more...` : ips.join(',');
  return kubectlTable(
    ['NAME', 'ADDRESSTYPE', 'PORTS', 'ENDPOINTS', 'AGE'],
    [
      [
        `${service}-${nameSuffix(service)}`,
        'IPv4',
        ips.length ? String(port) : '<unset>',
        ips.length ? shown : '<unset>',
        age,
      ],
    ],
  );
}

export function endpointSliceCommand(service: string): string {
  return `kubectl get endpointslices -l kubernetes.io/service-name=${service}`;
}

/** What `kubectl apply` says for the Deployment. */
export function applyDeployment(
  name: string,
  selector: Labels,
  templateLabels: Labels,
): { ok: boolean; text: string } {
  const ok = Object.keys(selector).length > 0 && selects(selector, templateLabels);
  return ok
    ? { ok, text: `deployment.apps/${name} created` }
    : { ok, text: selectorMismatchMessage('Deployment', name, templateLabels) };
}

export function isDone(
  task: LmTask,
  selector: Labels,
  pods: LmPod[],
  templateLabels?: Labels,
): boolean {
  if (task.type === 'template') return applyDeployment('x', selector, templateLabels ?? {}).ok;
  const got = new Set(matched(selector, pods));
  return got.size === task.pods.length && task.pods.every((p) => got.has(p));
}

/** The Service as YAML (≤ 12 lines). */
export function serviceYaml(
  name: string,
  selector: Labels,
  port: number,
  targetPort: number,
): string {
  const sel = Object.entries(selector)
    .map(([k, v]) => `    ${k}: ${v}`)
    .join('\n');
  return `apiVersion: v1\nkind: Service\nmetadata:\n  name: ${name}\nspec:\n  selector:\n${sel}\n  ports:\n    - port: ${port}\n      targetPort: ${targetPort}\n`;
}

/** The Deployment as YAML. */
export function deploymentYaml(
  name: string,
  selector: Labels,
  templateLabels: Labels,
  replicas = 3,
  image = 'nginx:1.29-alpine',
): string {
  const block = (l: Labels, pad: string) =>
    Object.entries(l)
      .map(([k, v]) => `${pad}${k}: ${v}`)
      .join('\n');
  return [
    'apiVersion: apps/v1',
    'kind: Deployment',
    'metadata:',
    `  name: ${name}`,
    'spec:',
    `  replicas: ${replicas}`,
    '  selector:',
    '    matchLabels:',
    block(selector, '      '),
    '  template:',
    '    metadata:',
    '      labels:',
    block(templateLabels, '        '),
    '    spec:',
    '      containers:',
    '        - name: web',
    `          image: ${image}`,
  ]
    .filter((l) => l !== '')
    .join('\n')
    .concat('\n');
}

export { labelString };
