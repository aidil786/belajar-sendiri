// Who can reach whom: the laptop reaches containers only through published ports
// (-p host:container); containers reach each other by name only on a user-defined network.
import { serve, type HttpRes } from './programs';
import { networkByName } from './state';
import type { Container, KitchenEvent, KitchenState } from './types';

export type Origin = { kind: 'host' } | { kind: 'container'; id: string };

export type FetchError = 'refused' | 'reset' | 'resolve' | 'unreachable' | 'empty' | 'timeout' | 'internet';

export type FetchResult =
  | { ok: true; res: HttpRes; ip: string; port: number; target: Container; event: KitchenEvent }
  | { ok: false; error: FetchError; host: string; ip: string; port: number };

export interface Url {
  scheme: string;
  host: string;
  port: number;
  path: string;
}

export function parseUrl(text: string): Url | null {
  const m = /^(?:(https?):\/\/)?([^/:?#\s]+)(?::(\d+))?(\/[^\s]*)?$/.exec(text);
  if (!m) return null;
  const scheme = m[1] ?? 'http';
  return { scheme, host: m[2]!, port: m[3] ? Number(m[3]) : scheme === 'https' ? 443 : 80, path: m[4] ?? '/' };
}

const LOCAL = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

function running(c: Container): boolean {
  return c.status === 'running' || c.status === 'paused';
}

/** Containers that share a user-defined network with `c`, by DNS name (name, service, aliases). */
export function dnsLookup(state: KitchenState, from: Container, name: string): { c: Container; ip: string } | null {
  for (const [netName, ep] of Object.entries(from.networks)) {
    if (netName === 'bridge') continue; // the default bridge has no DNS for names
    void ep;
    for (const other of Object.values(state.containers)) {
      if (!running(other)) continue;
      const theirs = other.networks[netName];
      if (!theirs) continue;
      if (other.name === name || theirs.aliases.includes(name) || other.id.startsWith(name) && name.length === 12) return { c: other, ip: theirs.ip };
    }
  }
  return null;
}

function byIp(state: KitchenState, ip: string): Container | null {
  for (const c of Object.values(state.containers)) {
    if (!running(c)) continue;
    if (Object.values(c.networks).some((n) => n.ip === ip)) return c;
  }
  return null;
}

/** Send one HTTP request. */
export function httpFetch(state: KitchenState, from: Origin, url: Url, method: 'GET' | 'HEAD', ua: string): FetchResult {
  const port = url.port;
  const fromC = from.kind === 'container' ? state.containers[from.id] : undefined;
  let target: Container | null;
  let ip = url.host;
  let client: string;
  let targetPort = port;

  if (from.kind === 'host') {
    if (!LOCAL.has(url.host) && url.host !== state.host.name) {
      if (/^\d+\.\d+\.\d+\.\d+$/.test(url.host)) return { ok: false, error: 'timeout', host: url.host, ip: url.host, port };
      const known = Object.values(state.containers).some((c) => c.name === url.host || Object.values(c.networks).some((n) => n.aliases.includes(url.host)));
      return { ok: false, error: known || !url.host.includes('.') ? 'resolve' : 'internet', host: url.host, ip: url.host, port };
    }
    ip = '127.0.0.1';
    // Host networking: the container's ports are the laptop's ports.
    const hostNet = Object.values(state.containers).find((c) => running(c) && c.networkMode === 'host' && c.proc?.listeners.some((l) => l.port === port));
    if (hostNet) {
      target = hostNet;
      client = '127.0.0.1';
    } else {
      const mapped = Object.values(state.containers).find((c) => running(c) && c.ports.some((p) => p.hostPort === port));
      if (!mapped) {
        if (state.host.busyPorts.includes(port)) {
          return {
            ok: true,
            res: { status: 200, reason: 'OK', headers: [['Content-Type', 'text/plain']], body: 'Hello from a program on your laptop\n' },
            ip,
            port,
            target: null as unknown as Container,
            event: { type: 'requestServed', from: 'laptop', to: 'laptop', port, status: 200 },
          };
        }
        return { ok: false, error: 'refused', host: url.host, ip, port };
      }
      target = mapped;
      targetPort = mapped.ports.find((p) => p.hostPort === port)!.containerPort;
      // docker-proxy connects from the bridge gateway.
      const net = Object.keys(mapped.networks)[0];
      client = net ? (networkByName(state, net)?.gateway || '172.17.0.1') : '172.17.0.1';
      if (mapped.status === 'paused') return { ok: false, error: 'timeout', host: url.host, ip, port };
      const l = mapped.proc?.listeners.find((x) => x.port === targetPort);
      if (!l || l.host === '127.0.0.1') return { ok: false, error: 'reset', host: url.host, ip, port };
    }
  } else {
    if (!fromC) return { ok: false, error: 'refused', host: url.host, ip, port };
    if (LOCAL.has(url.host) || url.host === fromC.hostname || url.host === fromC.name) {
      target = fromC;
      // With IPv6 on (GitHub's runners, most laptops), a container's `localhost` is ::1 first.
      ip = url.host === 'localhost' && state.host.ipv6 ? '::1' : '127.0.0.1';
      client = '127.0.0.1';
    } else if (/^\d+\.\d+\.\d+\.\d+$/.test(url.host)) {
      target = byIp(state, url.host);
      if (!target) return { ok: false, error: 'unreachable', host: url.host, ip: url.host, port };
      client = Object.values(fromC.networks)[0]?.ip ?? '172.17.0.2';
    } else {
      const hit = dnsLookup(state, fromC, url.host);
      if (!hit) return { ok: false, error: url.host.includes('.') && !Object.values(state.containers).some((c) => c.name === url.host) ? 'internet' : 'resolve', host: url.host, ip: url.host, port };
      target = hit.c;
      ip = hit.ip;
      const shared = Object.keys(fromC.networks).find((n) => hit.c.networks[n]);
      client = (shared && fromC.networks[shared]?.ip) || '172.18.0.3';
    }
    if (target.status === 'paused') return { ok: false, error: 'timeout', host: url.host, ip, port };
    const l = target.proc?.listeners.find((x) => x.port === port);
    if (!l || (l.host === '127.0.0.1' && target !== fromC)) return { ok: false, error: 'refused', host: url.host, ip, port };
  }

  const l = target!.proc!.listeners.find((x) => x.port === targetPort)!;
  const res = serve(state, target!, l, { method, path: url.path, client, ua, host: `${url.host}${url.port === 80 ? '' : `:${url.port}`}` });
  if (!res) return { ok: false, error: 'empty', host: url.host, ip, port };
  return {
    ok: true,
    res,
    ip,
    port,
    target: target!,
    event: { type: 'requestServed', from: from.kind === 'host' ? 'laptop' : (fromC?.name ?? ''), to: target!.name, port: targetPort, status: res.status },
  };
}

/** Text of the response as curl prints it (-I head only, -i head + body). */
export function curlText(res: HttpRes, head: boolean, body: boolean): string {
  const lines: string[] = [];
  if (head) {
    lines.push(`${res.proto ?? 'HTTP/1.1'} ${res.status} ${res.reason}`);
    for (const [k, v] of res.headers) lines.push(`${k}: ${v}`);
    lines.push('');
  }
  let text = lines.join('\n');
  if (head && !body) return text;
  if (head) text += '\n';
  return text + (body ? res.body : '');
}

/** curl's own error line for a failed request (stderr), and its exit code. */
export function curlError(r: Extract<FetchResult, { ok: false }>): { text: string; code: number } {
  const host = r.host;
  switch (r.error) {
    case 'refused':
      return { text: `curl: (7) Failed to connect to ${host} port ${r.port} after 0 ms: Couldn't connect to server`, code: 7 };
    case 'reset':
      return { text: 'curl: (56) Recv failure: Connection reset by peer', code: 56 };
    case 'resolve':
      return { text: `curl: (6) Could not resolve host: ${host}`, code: 6 };
    case 'empty':
      return { text: 'curl: (52) Empty reply from server', code: 52 };
    case 'timeout':
    case 'unreachable':
      return { text: `curl: (28) Failed to connect to ${host} port ${r.port} after 133971 ms: Couldn't connect to server`, code: 28 };
    default:
      return { text: `curl: (6) Could not resolve host: ${host}`, code: 6 };
  }
}

/** BusyBox's "address:port" (an IPv6 address gets brackets), as in its "Connecting to" line. */
export function dotted(ip: string, port: number): string {
  return `${ip.includes(':') ? `[${ip}]` : ip}:${port}`;
}

/** BusyBox wget's error line. It names the address only for IPv4 (checked on Docker 29.9 runners). */
export function wgetError(r: Extract<FetchResult, { ok: false }>): string {
  const at = r.ip.includes(':') ? '' : ` (${r.ip})`;
  switch (r.error) {
    case 'refused':
      return `wget: can't connect to remote host${at}: Connection refused`;
    case 'unreachable':
    case 'timeout':
      return `wget: can't connect to remote host${at}: Host is unreachable`;
    case 'empty':
      return 'wget: error getting response';
    default:
      return `wget: bad address '${r.host}'`;
  }
}
