// The cluster network: DNS names, Services (ClusterIP → a ready pod), NodePort,
// LoadBalancer, port-forward, Gateway → HTTPRoute → Service, and NetworkPolicy.
import type { Ctx } from './controllers/workloads';
import { behaviorOf } from './controllers/kubelet';
import { getObj, listObjs, podReady } from './store';
import type { HttpResult, KObject, KubeEvent } from './types';
import { mapSelects, selectorMatches } from './util';

export type Source = { kind: 'pod'; pod: KObject } | { kind: 'laptop'; context: string };

interface Target {
  kind: 'pod' | 'service' | 'gateway' | 'forward';
  pod?: KObject;
  svc?: KObject;
  gw?: KObject;
  port: number;
  ip: string;
  host: string;
}

export function parseUrl(raw: string): { host: string; port: number | null; path: string } | null {
  const m = /^(?:(https?):\/\/)?([^/:]+)(?::(\d+))?(\/.*)?$/.exec(raw.trim());
  if (!m) return null;
  return { host: m[2]!, port: m[3] ? Number(m[3]) : m[1] === 'https' ? 443 : null, path: m[4] ?? '/' };
}

/** Resolve a name like a pod would (search: <ns>.svc.cluster.local, svc.cluster.local, cluster.local). */
export function resolveName(ctx: Ctx, host: string, ns: string): { svc?: KObject; pod?: KObject; ip: string } | null {
  const { c } = ctx;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const svc = listObjs(c, 'Service').find((s) => s.spec.clusterIP === host);
    if (svc) return { svc, ip: host };
    const pod = listObjs(c, 'Pod').find((p) => p.status?.podIP === host && !p.spec.hostNetwork);
    if (pod) return { pod, ip: host };
    return { ip: host };
  }
  const parts = host.replace(/\.$/, '').split('.');
  const tail = parts.slice(1).join('.');
  // service, service.ns, service.ns.svc, service.ns.svc.cluster.local
  const svcNs = !tail ? ns : tail.replace(/\.svc(\.cluster\.local)?$/, '');
  if (!svcNs.includes('.')) {
    const svc = getObj(c, 'Service', svcNs, parts[0]!);
    if (svc) {
      if (svc.spec.clusterIP === 'None') {
        const pod = listObjs(c, 'Pod', svcNs).find((p) => mapSelects(svc.spec.selector, p.metadata.labels) && podReady(p));
        return pod ? { pod, svc, ip: pod.status.podIP } : null;
      }
      return { svc, ip: svc.spec.clusterIP };
    }
  }
  // pod-name.headless-service(.ns.svc.cluster.local) for StatefulSets
  if (parts.length >= 2) {
    const sns = parts.length >= 3 && parts[2] !== 'svc' ? parts[2]! : ns;
    const pod = listObjs(c, 'Pod', sns).find((p) => p.spec.hostname === parts[0] && p.spec.subdomain === parts[1]);
    if (pod?.status?.podIP) return { pod, ip: pod.status.podIP };
  }
  return null;
}

function policyAllowsIngress(ctx: Ctx, dest: KObject, port: number, src: Source): boolean {
  const ns = dest.metadata.namespace!;
  const pols = listObjs(ctx.c, 'NetworkPolicy', ns).filter((p) => (p.spec.policyTypes ?? ['Ingress']).includes('Ingress') && selectorMatches(p.spec.podSelector ?? {}, dest.metadata.labels));
  if (!pols.length) return true;
  return pols.some((p) =>
    (p.spec.ingress ?? []).some((rule: any) => {
      const portOk = !rule.ports?.length || rule.ports.some((rp: any) => rp.port === undefined || Number(rp.port) === port || (typeof rp.port === 'string' && portByName(dest, rp.port) === port));
      if (!portOk) return false;
      if (!rule.from?.length) return true;
      return rule.from.some((f: any) => peerMatches(ctx, f, src, ns));
    }),
  );
}

function policyAllowsEgress(ctx: Ctx, src: KObject, dest: KObject | null, port: number, dns = false): boolean {
  const ns = src.metadata.namespace!;
  const pols = listObjs(ctx.c, 'NetworkPolicy', ns).filter((p) => (p.spec.policyTypes ?? []).includes('Egress') && selectorMatches(p.spec.podSelector ?? {}, src.metadata.labels));
  if (!pols.length) return true;
  return pols.some((p) =>
    (p.spec.egress ?? []).some((rule: any) => {
      const portOk = !rule.ports?.length || rule.ports.some((rp: any) => rp.port === undefined || Number(rp.port) === port);
      if (!portOk) return false;
      if (!rule.to?.length) return true;
      if (dns) return rule.to.some((t: any) => t.namespaceSelector && selectorMatches(t.namespaceSelector, { 'kubernetes.io/metadata.name': 'kube-system' }));
      return dest ? rule.to.some((t: any) => peerMatches(ctx, t, { kind: 'pod', pod: dest }, ns)) : false;
    }),
  );
}

function portByName(pod: KObject, name: string): number | null {
  for (const ctr of pod.spec.containers ?? []) for (const p of ctr.ports ?? []) if (p.name === name) return p.containerPort;
  return null;
}

function peerMatches(ctx: Ctx, peer: any, src: Source, policyNs: string): boolean {
  if (peer.ipBlock) return src.kind === 'laptop' || (src.kind === 'pod' && ipIn(src.pod.status?.podIP ?? '', peer.ipBlock));
  if (src.kind !== 'pod') return false;
  const pod = src.pod;
  const nsObj = getObj(ctx.c, 'Namespace', undefined, pod.metadata.namespace!);
  const nsOk = peer.namespaceSelector ? selectorMatches(peer.namespaceSelector, nsObj?.metadata.labels) : pod.metadata.namespace === policyNs;
  const podOk = peer.podSelector ? selectorMatches(peer.podSelector, pod.metadata.labels) : true;
  return nsOk && podOk;
}

function ipIn(ip: string, block: any): boolean {
  const toNum = (s: string) => s.split('.').reduce((n, x) => n * 256 + Number(x), 0);
  const inCidr = (cidr: string) => {
    const [base, bits] = cidr.split('/');
    const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
    return ((toNum(ip) & mask) >>> 0) === ((toNum(base!) & mask) >>> 0);
  };
  return inCidr(block.cidr) && !(block.except ?? []).some(inCidr);
}

function readyEndpoints(ctx: Ctx, svc: KObject): KObject[] {
  return listObjs(ctx.c, 'Pod', svc.metadata.namespace).filter((p) => mapSelects(svc.spec.selector, p.metadata.labels) && podReady(p) && !p.metadata.deletionTimestamp);
}

/** Pick the next ready pod behind a Service (kube-proxy picks at random; the sim takes turns). */
function pickEndpoint(ctx: Ctx, svc: KObject): KObject | null {
  const eps = readyEndpoints(ctx, svc);
  if (!eps.length) return null;
  const key = `${svc.metadata.namespace}/${svc.metadata.name}`;
  const i = ctx.c.rr[key] ?? 0;
  ctx.c.rr[key] = i + 1;
  return eps[i % eps.length]!;
}

function servicePort(svc: KObject, port: number | null): { port: number; target: any } | null {
  const ports: any[] = svc.spec.ports ?? [];
  const p = port === null ? ports[0] : ports.find((x) => x.port === port);
  return p ? { port: p.port, target: p.targetPort ?? p.port } : null;
}

/** Deliver a request to a pod's program. */
function deliver(ctx: Ctx, pod: KObject, port: number, path: string, src: Source, hops: string[], viaPolicy = true): HttpResult {
  const name = pod.metadata.name;
  if (viaPolicy && !policyAllowsIngress(ctx, pod, port, src)) return { ok: false, status: null, body: '', pod: name, hops, error: 'timeout' };
  for (const ctr of pod.spec.containers ?? []) {
    const rt = ctx.c.pods[pod.metadata.uid]?.containers[ctr.name];
    if (!rt || rt.startedAt === null) continue;
    const b = behaviorOf(ctx, pod, ctr);
    if (!b || !b.ports.includes(port)) continue;
    if (ctx.state.clock - rt.startedAt < b.warmup) break;
    if (!b.http) return { ok: false, status: null, body: '', pod: name, hops, error: 'refused' };
    let { status, body } = b.http(path);
    if (rt.sick) {
      status = 503;
      body = 'Service Unavailable\n';
    }
    rt.requests++;
    const from = src.kind === 'pod' ? (src.pod.status?.podIP ?? '127.0.0.1') : '127.0.0.1';
    const agent = src.kind === 'pod' && src.pod.metadata.name ? 'curl/8.17.0' : 'curl/8.17.0';
    rt.logs.push({ t: ctx.state.clock, text: `${from} - - [@CLF] "GET ${path} HTTP/1.1" ${status} ${new TextEncoder().encode(body).length} "-" "${agent}" "-"` });
    return { ok: true, status, body, pod: name, hops: [...hops, `pod/${name}`] };
  }
  return { ok: false, status: null, body: '', pod: name, hops, error: 'refused' };
}

export interface RequestOptions {
  /** Host header (for Gateway hostnames). */
  hostHeader?: string;
  events?: KubeEvent[];
}

/** One HTTP GET, from a pod or from the learner's laptop. */
export function httpGet(ctx: Ctx, src: Source, url: string, opts: RequestOptions = {}): HttpResult {
  const u = parseUrl(url);
  const fromText = src.kind === 'pod' ? `pod/${src.pod.metadata.name}` : 'laptop';
  const done = (r: HttpResult) => {
    opts.events?.push({ type: 'requestRouted', from: fromText, hops: r.hops, pod: r.pod, status: r.status, ...(r.error ? { error: r.error } : {}) });
    return r;
  };
  if (!u) return done({ ok: false, status: null, body: '', pod: null, hops: [], error: 'dns' });
  const { c } = ctx;
  if (src.kind === 'laptop') {
    // localhost: an open port-forward.
    if (u.host === 'localhost' || u.host === '127.0.0.1') {
      const fw = ctx.state.forwards.find((f) => f.local === (u.port ?? 80) && f.context === src.context);
      if (!fw) return done({ ok: false, status: null, body: '', pod: null, hops: [], error: 'refused', host: u.host, ip: '127.0.0.1' });
      const pod = getObj(c, 'Pod', fw.namespace, fw.pod);
      if (!pod || pod.metadata.deletionTimestamp) return done({ ok: false, status: null, body: '', pod: null, hops: [`forward/${fw.local}`], error: 'refused', host: u.host, ip: '127.0.0.1' });
      return done({ ...deliver(ctx, pod, fw.podPort, u.path, src, [`forward/${fw.local}`], false), host: u.host });
    }
    // A Gateway address.
    const gw = listObjs(c, 'Gateway').find((g) => g.status?.addresses?.some((a: any) => a.value === u.host));
    if (gw) return done(viaGateway(ctx, gw, u.port ?? 80, u.path, opts.hostHeader ?? u.host, src));
    // A LoadBalancer address.
    const lb = listObjs(c, 'Service').find((s) => s.status?.loadBalancer?.ingress?.some((i: any) => i.ip === u.host));
    if (lb) {
      const sp = servicePort(lb, u.port ?? 80);
      if (!sp) return done({ ok: false, status: null, body: '', pod: null, hops: [], error: 'refused', host: u.host, ip: u.host });
      return done(toService(ctx, lb, sp, u.path, src, [`loadbalancer/${u.host}`]));
    }
    // A node address and a NodePort.
    const node = listObjs(c, 'Node').find((n) => n.status?.addresses?.some((a: any) => a.address === u.host));
    if (node && u.port) {
      const svc = listObjs(c, 'Service').find((s) => (s.spec.ports ?? []).some((p: any) => p.nodePort === u.port));
      if (!svc) return done({ ok: false, status: null, body: '', pod: null, hops: [], error: 'refused', host: u.host, ip: u.host });
      const p = svc.spec.ports.find((x: any) => x.nodePort === u.port);
      return done(toService(ctx, svc, { port: p.port, target: p.targetPort }, u.path, src, [`node/${node.metadata.name}:${u.port}`]));
    }
    return done({ ok: false, status: null, body: '', pod: null, hops: [], error: 'dns', host: u.host });
  }
  // From inside a pod.
  const me = src.pod;
  if (u.host === 'localhost' || u.host === '127.0.0.1') return done(deliver(ctx, me, u.port ?? 80, u.path, src, [], false));
  const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(u.host);
  if (!isIp && !policyAllowsEgress(ctx, me, null, 53, true)) return done({ ok: false, status: null, body: '', pod: null, hops: [], error: 'dns', host: u.host });
  const r = resolveName(ctx, u.host, me.metadata.namespace!);
  if (!r) return done({ ok: false, status: null, body: '', pod: null, hops: [], error: 'dns', host: u.host });
  if (r.svc && !r.pod) {
    const sp = servicePort(r.svc, u.port ?? 80);
    if (!sp) return done({ ok: false, status: null, body: '', pod: null, hops: [`service/${r.svc.metadata.name}`], error: 'timeout', host: u.host, ip: r.ip });
    return done({ ...toService(ctx, r.svc, sp, u.path, src, [`service/${r.svc.metadata.name}`]), host: u.host, ip: r.ip });
  }
  if (r.pod) {
    if (!policyAllowsEgress(ctx, me, r.pod, u.port ?? 80)) return done({ ok: false, status: null, body: '', pod: null, hops: [], error: 'timeout', host: u.host, ip: r.ip });
    return done({ ...deliver(ctx, r.pod, u.port ?? 80, u.path, src, []), host: u.host, ip: r.ip });
  }
  return done({ ok: false, status: null, body: '', pod: null, hops: [], error: 'timeout', host: u.host, ip: r.ip });
}

function toService(ctx: Ctx, svc: KObject, sp: { port: number; target: any }, path: string, src: Source, hops: string[]): HttpResult {
  const pod = pickEndpoint(ctx, svc);
  if (!pod) return { ok: false, status: null, body: '', pod: null, hops, error: 'refused' };
  if (src.kind === 'pod' && !policyAllowsEgress(ctx, src.pod, pod, sp.port)) return { ok: false, status: null, body: '', pod: null, hops, error: 'timeout' };
  const target = typeof sp.target === 'number' ? sp.target : (portByName(pod, sp.target) ?? Number(sp.target));
  return deliver(ctx, pod, target, path, src, hops);
}

function viaGateway(ctx: Ctx, gw: KObject, port: number, path: string, host: string, src: Source): HttpResult {
  const hops = [`gateway/${gw.metadata.name}`];
  const listener = (gw.spec.listeners ?? []).find((l: any) => l.port === port && (!l.hostname || l.hostname === host));
  if (!listener) return { ok: false, status: null, body: '', pod: null, hops, error: 'refused' };
  const routes = listObjs(ctx.c, 'HTTPRoute').filter(
    (r) =>
      (r.spec.parentRefs ?? []).some((p: any) => p.name === gw.metadata.name && (p.namespace ?? r.metadata.namespace) === gw.metadata.namespace) &&
      (!r.spec.hostnames?.length || r.spec.hostnames.includes(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host) === false && r.spec.hostnames.some((h: string) => h.startsWith('*.') && host.endsWith(h.slice(1)))),
  );
  // Longest matching path wins (Exact beats PathPrefix).
  let best: { route: KObject; rule: any; score: number } | null = null;
  for (const r of routes) {
    for (const rule of r.spec.rules ?? []) {
      const ms = rule.matches?.length ? rule.matches : [{ path: { type: 'PathPrefix', value: '/' } }];
      for (const m of ms) {
        const type = m.path?.type ?? 'PathPrefix';
        const value = m.path?.value ?? '/';
        const ok = type === 'Exact' ? path.split('?')[0] === value : value === '/' || path === value || path.startsWith(value.endsWith('/') ? value : `${value}/`) || path.split('?')[0] === value;
        if (!ok) continue;
        const score = (type === 'Exact' ? 10000 : 0) + value.length;
        if (!best || score > best.score) best = { route: r, rule, score };
      }
    }
  }
  if (!best) return { ok: true, status: 404, body: '', pod: null, hops, error: 'noRoute' };
  hops.push(`httproute/${best.route.metadata.name}`);
  const backends: any[] = best.rule.backendRefs ?? [];
  if (!backends.length) return { ok: true, status: 500, body: '', pod: null, hops, error: 'badGateway' };
  const total = backends.reduce((n, b) => n + (b.weight ?? 1), 0);
  const roll = (ctx.c.rr[`gw/${gw.metadata.name}`] = (ctx.c.rr[`gw/${gw.metadata.name}`] ?? 0) + 1) % Math.max(1, total);
  let acc = 0;
  const ref = backends.find((b) => (acc += b.weight ?? 1) > roll) ?? backends[0];
  const svc = getObj(ctx.c, 'Service', ref.namespace ?? best.route.metadata.namespace, ref.name);
  if (!svc) return { ok: true, status: 500, body: '', pod: null, hops, error: 'badGateway' };
  hops.push(`service/${svc.metadata.name}`);
  const sp = servicePort(svc, ref.port ?? null);
  if (!sp) return { ok: true, status: 500, body: '', pod: null, hops, error: 'badGateway' };
  const r = toService(ctx, svc, sp, path, { kind: 'laptop', context: src.kind === 'laptop' ? src.context : '' }, hops);
  if (!r.ok) return { ok: true, status: 503, body: 'no healthy upstream', pod: null, hops, error: 'noEndpoints' };
  return r;
}

export type { Target };
