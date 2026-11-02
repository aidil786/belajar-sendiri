// Pure logic for RequestTracer: one HTTP request, hop by hop, through Gateway API to a pod.
//
//   browser → Gateway (listener port) → HTTPRoute (path match) → Service (port → targetPort)
//           → EndpointSlice (ready pods) → Pod (container port)
//
// What the user gets when a hop breaks follows the Gateway API v1.6 spec where it says so:
// no matching route → 404; a backendRef to a Service that doesn't exist → 500 (route condition
// ResolvedRefs=False, reason BackendNotFound); a Service with no ready endpoints → 503. Lower down
// it is plain TCP: nothing listening → connection refused; a NetworkPolicy that drops the packets →
// nobody answers, so the request times out. The user's lines are curl 8.x output.
import { kubectlTable, labelString, nameSuffix, podIP } from './k8sMessages';

export interface TraceRule {
  path: string;
  type?: 'PathPrefix' | 'Exact';
  /** backendRef: Service name and port. */
  service: string;
  port: number;
}

export interface TraceService {
  name: string;
  port: number;
  targetPort: number;
  selector: Record<string, string>;
}

export interface TracePod {
  name: string;
  labels: Record<string, string>;
  ready?: boolean;
  containerPort: number;
}

export interface TraceConfig {
  host?: string;
  gateway: { name: string; port: number };
  route: { name: string; rules: TraceRule[] };
  services: TraceService[];
  pods: TracePod[];
  /** A NetworkPolicy on the pods; allowGateway false = default deny (packets from the gateway dropped). */
  policy?: { name: string; allowGateway: boolean };
  request: { path: string; port?: number };
}

export type HopId = 'browser' | 'gateway' | 'route' | 'service' | 'endpoints' | 'pod';
export const HOPS: HopId[] = ['browser', 'gateway', 'route', 'service', 'endpoints', 'pod'];

export type OutcomeCode = '200' | '404' | '500' | '503' | 'refused' | 'timeout';

export type Why =
  | 'ok'
  | 'noListener'
  | 'noRoute'
  | 'noService'
  | 'noServicePort'
  | 'noEndpoints'
  | 'notReady'
  | 'policy'
  | 'wrongTargetPort';

export interface Trace {
  /** The last hop the request reached. */
  stopAt: HopId;
  outcome: OutcomeCode;
  why: Why;
  /** The rule / service / pods used along the way. */
  rule?: TraceRule;
  service?: TraceService;
  pods: TracePod[];
  /** What the user's terminal shows. */
  command: string;
  answer: string;
  /** What Kubernetes shows about it (real kubectl output), or [] */
  evidence: { command: string; lines: string[] }[];
}

export type BreakId =
  'path' | 'listener' | 'serviceName' | 'selector' | 'targetPort' | 'ready' | 'policy';
export const BREAKS: BreakId[] = [
  'path',
  'listener',
  'serviceName',
  'selector',
  'targetPort',
  'ready',
  'policy',
];

/** Gateway API path match. PathPrefix matches whole path segments: /api matches /api and /api/x, not /apiv2. */
export function pathMatches(rule: Pick<TraceRule, 'path' | 'type'>, path: string): boolean {
  if ((rule.type ?? 'PathPrefix') === 'Exact') return path === rule.path;
  const prefix = rule.path.replace(/\/+$/, '');
  if (prefix === '') return true;
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** The rule that wins: Exact first, then the longest prefix. */
export function matchRule(rules: TraceRule[], path: string): TraceRule | undefined {
  const hits = rules.filter((r) => pathMatches(r, path));
  return hits.sort(
    (a, b) =>
      Number((b.type ?? 'PathPrefix') === 'Exact') - Number((a.type ?? 'PathPrefix') === 'Exact') ||
      b.path.length - a.path.length,
  )[0];
}

const selects = (sel: Record<string, string>, labels: Record<string, string>) =>
  Object.keys(sel).length > 0 && Object.entries(sel).every(([k, v]) => labels[k] === v);

/** Apply the learner's breaks to a working setup. */
export function applyBreaks(cfg: TraceConfig, breaks: BreakId[]): TraceConfig {
  const c: TraceConfig = structuredClone(cfg);
  const rule = matchRule(c.route.rules, c.request.path);
  const svc = c.services.find((s) => s.name === rule?.service);
  for (const b of breaks) {
    if (b === 'path') c.request.path = '/menu';
    if (b === 'listener') c.request.port = c.gateway.port === 8080 ? 8081 : 8080;
    if (b === 'serviceName' && rule) rule.service = `${rule.service}s`;
    if (b === 'selector' && svc)
      svc.selector = Object.fromEntries(
        Object.entries(svc.selector).map(([k, v]) => [k, `${v}-v2`]),
      );
    if (b === 'targetPort' && svc) svc.targetPort = svc.targetPort === 9090 ? 9091 : 9090;
    if (b === 'ready') for (const p of c.pods) p.ready = false;
    if (b === 'policy') c.policy = { name: c.policy?.name ?? 'lock-pods', allowGateway: false };
  }
  return c;
}

/** Follow one request. */
export function trace(cfg: TraceConfig): Trace {
  const host = cfg.host ?? 'kedai.example';
  const port = cfg.request.port ?? 80;
  const url = `http://${host}${port === 80 ? '' : `:${port}`}${cfg.request.path}`;
  const command = `curl -i -m 5 ${url}`;
  const base = { command, pods: [] as TracePod[], evidence: [] as Trace['evidence'] };
  const status = (code: string, text: string) => `HTTP/1.1 ${code} ${text}`;

  if (port !== cfg.gateway.port) {
    return {
      ...base,
      stopAt: 'gateway',
      outcome: 'refused',
      why: 'noListener',
      answer: `curl: (7) Failed to connect to ${host} port ${port} after 0 ms: Couldn't connect to server`,
      evidence: [
        {
          command: `kubectl get gateway ${cfg.gateway.name}`,
          lines: kubectlTable(
            ['NAME', 'CLASS', 'ADDRESS', 'PROGRAMMED', 'AGE'],
            [[cfg.gateway.name, 'kancil', '203.0.113.10', 'True', '5m']],
          ),
        },
      ],
    };
  }
  const rule = matchRule(cfg.route.rules, cfg.request.path);
  if (!rule)
    return {
      ...base,
      stopAt: 'route',
      outcome: '404',
      why: 'noRoute',
      answer: status('404', 'Not Found'),
    };
  const service = cfg.services.find((s) => s.name === rule.service);
  const routeReason = (reason: string) => ({
    command: `kubectl get httproute ${cfg.route.name} -o jsonpath='{.status.parents[0].conditions[?(@.type=="ResolvedRefs")].reason}'`,
    lines: [reason],
  });
  if (!service)
    return {
      ...base,
      rule,
      stopAt: 'service',
      outcome: '500',
      why: 'noService',
      answer: status('500', 'Internal Server Error'),
      evidence: [routeReason('BackendNotFound')],
    };
  if (service.port !== rule.port)
    return {
      ...base,
      rule,
      service,
      stopAt: 'service',
      outcome: '500',
      why: 'noServicePort',
      answer: status('500', 'Internal Server Error'),
    };
  const matching = cfg.pods.filter((p) => selects(service.selector, p.labels));
  const ready = matching.filter((p) => p.ready !== false);
  const slice = (pods: TracePod[]) => {
    const ips = pods.map((p) => podIP(p.name, cfg.pods.indexOf(p)));
    return {
      command: `kubectl get endpointslices -l kubernetes.io/service-name=${service.name}`,
      lines: kubectlTable(
        ['NAME', 'ADDRESSTYPE', 'PORTS', 'ENDPOINTS', 'AGE'],
        [
          [
            `${service.name}-${nameSuffix(service.name)}`,
            'IPv4',
            ips.length ? String(service.targetPort) : '<unset>',
            ips.length
              ? ips.length > 3
                ? `${ips.slice(0, 3).join(',')} + ${ips.length - 3} more...`
                : ips.join(',')
              : '<unset>',
            '3m',
          ],
        ],
      ),
    };
  };
  if (!matching.length)
    return {
      ...base,
      rule,
      service,
      stopAt: 'endpoints',
      outcome: '503',
      why: 'noEndpoints',
      answer: status('503', 'Service Unavailable'),
      evidence: [slice([])],
    };
  if (!ready.length) {
    return {
      ...base,
      rule,
      service,
      pods: matching,
      stopAt: 'endpoints',
      outcome: '503',
      why: 'notReady',
      answer: status('503', 'Service Unavailable'),
      evidence: [
        {
          command: `kubectl get pods -l ${labelString(service.selector)}`,
          lines: kubectlTable(
            ['NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE'],
            matching.map((p) => [p.name, '0/1', 'Running', '0', '3m']),
          ),
        },
      ],
    };
  }
  if (cfg.policy && !cfg.policy.allowGateway) {
    return {
      ...base,
      rule,
      service,
      pods: ready,
      stopAt: 'pod',
      outcome: 'timeout',
      why: 'policy',
      answer: 'curl: (28) Operation timed out after 5002 milliseconds with 0 bytes received',
      evidence: [
        {
          command: 'kubectl get networkpolicy',
          lines: kubectlTable(
            ['NAME', 'POD-SELECTOR', 'AGE'],
            [[cfg.policy.name, labelString(service.selector), '1m']],
          ),
        },
      ],
    };
  }
  if (!ready.some((p) => p.containerPort === service.targetPort)) {
    return {
      ...base,
      rule,
      service,
      pods: ready,
      stopAt: 'pod',
      outcome: 'refused',
      why: 'wrongTargetPort',
      answer: status('503', 'Service Unavailable'),
      evidence: [slice(ready)],
    };
  }
  return {
    ...base,
    rule,
    service,
    pods: ready,
    stopAt: 'pod',
    outcome: '200',
    why: 'ok',
    answer: status('200', 'OK'),
  };
}

export type TraceTask =
  /** Send a request and watch every hop (done when one request finishes). */
  | { type: 'trace' }
  /** Get a 200 OK (start from `broken`, undo the break). */
  | { type: 'deliver' }
  /** Make the user get this outcome by breaking one hop. */
  | { type: 'outcome'; want: OutcomeCode };

export function taskDone(task: TraceTask, t: Trace): boolean {
  if (task.type === 'trace') return true;
  if (task.type === 'deliver') return t.outcome === '200';
  return t.outcome === task.want;
}

/** Gateway + HTTPRoute + Service + NetworkPolicy YAML for the config (checked by kubeconform in CI). */
export function manifests(cfg: TraceConfig): string {
  const docs: string[] = [];
  docs.push(
    `apiVersion: gateway.networking.k8s.io/v1\nkind: Gateway\nmetadata:\n  name: ${cfg.gateway.name}\nspec:\n  gatewayClassName: kancil\n  listeners:\n    - name: http\n      protocol: HTTP\n      port: ${cfg.gateway.port}\n`,
  );
  docs.push(
    `apiVersion: gateway.networking.k8s.io/v1\nkind: HTTPRoute\nmetadata:\n  name: ${cfg.route.name}\nspec:\n  parentRefs:\n    - name: ${cfg.gateway.name}\n  rules:\n` +
      cfg.route.rules
        .map(
          (r) =>
            `    - matches:\n        - path:\n            type: ${r.type ?? 'PathPrefix'}\n            value: ${r.path}\n      backendRefs:\n        - name: ${r.service}\n          port: ${r.port}\n`,
        )
        .join(''),
  );
  for (const s of cfg.services) {
    docs.push(
      `apiVersion: v1\nkind: Service\nmetadata:\n  name: ${s.name}\nspec:\n  selector:\n${Object.entries(
        s.selector,
      )
        .map(([k, v]) => `    ${k}: ${v}\n`)
        .join('')}  ports:\n    - port: ${s.port}\n      targetPort: ${s.targetPort}\n`,
    );
  }
  if (cfg.policy) {
    const sel = cfg.services[0]?.selector ?? {};
    docs.push(
      `apiVersion: networking.k8s.io/v1\nkind: NetworkPolicy\nmetadata:\n  name: ${cfg.policy.name}\nspec:\n  podSelector:\n    matchLabels:\n${Object.entries(
        sel,
      )
        .map(([k, v]) => `      ${k}: ${v}\n`)
        .join('')}  policyTypes:\n    - Ingress\n` +
        (cfg.policy.allowGateway
          ? `  ingress:\n    - from:\n        - namespaceSelector:\n            matchLabels:\n              kubernetes.io/metadata.name: gateway\n`
          : ''),
    );
  }
  return docs.join('---\n');
}
