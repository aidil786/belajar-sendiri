import { describe, expect, it } from 'vitest';
import { kubectlApply } from './k8sSchema';
import {
  applyBreaks,
  manifests,
  matchRule,
  pathMatches,
  taskDone,
  trace,
  type TraceConfig,
} from './requestTracer';

const cfg: TraceConfig = {
  host: 'kedai.example',
  gateway: { name: 'entrance', port: 80 },
  route: {
    name: 'shop',
    rules: [
      { path: '/', service: 'web', port: 80 },
      { path: '/api', service: 'api', port: 80 },
    ],
  },
  services: [
    { name: 'web', port: 80, targetPort: 8080, selector: { app: 'web' } },
    { name: 'api', port: 80, targetPort: 3000, selector: { app: 'api' } },
  ],
  pods: [
    { name: 'api-1', labels: { app: 'api' }, containerPort: 3000 },
    { name: 'api-2', labels: { app: 'api' }, containerPort: 3000 },
    { name: 'web-1', labels: { app: 'web' }, containerPort: 8080 },
  ],
  request: { path: '/api/menu' },
};

describe('Gateway API path matching', () => {
  it('PathPrefix matches whole segments', () => {
    expect(pathMatches({ path: '/api' }, '/api')).toBe(true);
    expect(pathMatches({ path: '/api' }, '/api/menu')).toBe(true);
    expect(pathMatches({ path: '/api' }, '/apiv2')).toBe(false);
    expect(pathMatches({ path: '/' }, '/anything')).toBe(true);
    expect(pathMatches({ path: '/api', type: 'Exact' }, '/api/menu')).toBe(false);
  });
  it('the longest prefix wins', () => {
    expect(matchRule(cfg.route.rules, '/api/menu')!.service).toBe('api');
    expect(matchRule(cfg.route.rules, '/about')!.service).toBe('web');
  });
});

describe('one request, hop by hop', () => {
  it('reaches a pod: 200 OK', () => {
    const t = trace(cfg);
    expect(t).toMatchObject({
      outcome: '200',
      stopAt: 'pod',
      answer: 'HTTP/1.1 200 OK',
      command: 'curl -i -m 5 http://kedai.example/api/menu',
    });
    expect(t.pods.map((p) => p.name)).toEqual(['api-1', 'api-2']);
  });
  it('wrong path: 404 (no rule)', () => {
    const only = { ...cfg, route: { ...cfg.route, rules: [cfg.route.rules[1]!] } };
    expect(trace(applyBreaks(only, ['path']))).toMatchObject({
      outcome: '404',
      stopAt: 'route',
      why: 'noRoute',
      answer: 'HTTP/1.1 404 Not Found',
    });
  });
  it('wrong listener port: connection refused (curl 8.x words)', () => {
    const t = trace(applyBreaks(cfg, ['listener']));
    expect(t).toMatchObject({
      outcome: 'refused',
      stopAt: 'gateway',
      answer:
        "curl: (7) Failed to connect to kedai.example port 8080 after 0 ms: Couldn't connect to server",
    });
    expect(t.evidence[0]!.lines[0]).toBe('NAME       CLASS    ADDRESS        PROGRAMMED   AGE');
  });
  it('backendRef to a missing Service: 500 and BackendNotFound', () => {
    const t = trace(applyBreaks(cfg, ['serviceName']));
    expect(t).toMatchObject({
      outcome: '500',
      stopAt: 'service',
      answer: 'HTTP/1.1 500 Internal Server Error',
    });
    expect(t.evidence[0]!.lines).toEqual(['BackendNotFound']);
  });
  it('selector matches nothing: 503, EndpointSlice <unset>', () => {
    const t = trace(applyBreaks(cfg, ['selector']));
    expect(t).toMatchObject({ outcome: '503', why: 'noEndpoints', stopAt: 'endpoints' });
    expect(t.evidence[0]!.lines[1]).toMatch(/IPv4\s+<unset>\s+<unset>/);
  });
  it('pods not ready: 503, READY 0/1', () => {
    const t = trace(applyBreaks(cfg, ['ready']));
    expect(t).toMatchObject({ outcome: '503', why: 'notReady' });
    expect(t.evidence[0]!.command).toBe('kubectl get pods -l app=api');
    expect(t.evidence[0]!.lines[1]).toMatch(/^api-1\s+0\/1\s+Running\s+0\s+3m$/);
  });
  it('NetworkPolicy drops packets: timeout', () => {
    expect(trace(applyBreaks(cfg, ['policy']))).toMatchObject({
      outcome: 'timeout',
      why: 'policy',
      answer: 'curl: (28) Operation timed out after 5002 milliseconds with 0 bytes received',
    });
  });
  it('wrong targetPort: the pod refuses the connection', () => {
    const t = trace(applyBreaks(cfg, ['targetPort']));
    expect(t).toMatchObject({
      outcome: 'refused',
      why: 'wrongTargetPort',
      stopAt: 'pod',
      answer: 'HTTP/1.1 503 Service Unavailable',
    });
    expect(t.evidence[0]!.lines[1]).toMatch(/IPv4\s+9090\s+10\.244/);
  });
  it('checks tasks', () => {
    expect(taskDone({ type: 'outcome', want: '503' }, trace(applyBreaks(cfg, ['ready'])))).toBe(
      true,
    );
    expect(taskDone({ type: 'deliver' }, trace(applyBreaks(cfg, ['ready'])))).toBe(false);
    expect(taskDone({ type: 'deliver' }, trace(cfg))).toBe(true);
  });
});

describe('manifests', () => {
  it('Gateway, HTTPRoute, Services and NetworkPolicy all apply', () => {
    const r = kubectlApply(
      manifests({ ...cfg, policy: { name: 'lock-api', allowGateway: true } }),
      'shop.yaml',
    );
    expect(r.lines.map((l) => l.text)).toEqual([
      'gateway.gateway.networking.k8s.io/entrance created',
      'httproute.gateway.networking.k8s.io/shop created',
      'service/web created',
      'service/api created',
      'networkpolicy.networking.k8s.io/lock-api created',
    ]);
  });
});
