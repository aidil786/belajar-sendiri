// The small network: ip, ss, ping, getent, dig, host, curl (iproute2 6.15, iputils 20240905,
// BIND 9.20, curl 8.14 on Debian 13).
import { parseOpts, setExplain, type Ctx } from '../ctx';
import { absPath, lookup, userByName } from '../fs';
import { goLong } from '../procs';
import { lq, type Program } from './files';
import type { Listener, LinuxState, WebPage } from '../types';

// ---------------------------------------------------------------------------
// Name resolution: /etc/hosts first, then the DNS table.

export function hostsFile(st: LinuxState): { ip: string; names: string[] }[] {
  const text = st.fs['/etc/hosts']?.content ?? '';
  return text
    .split('\n')
    .map((l) => l.replace(/#.*/, '').trim())
    .filter(Boolean)
    .map((l) => {
      const [ip, ...names] = l.split(/\s+/);
      return { ip: ip!, names };
    })
    .filter((e) => /^\d+\.\d+\.\d+\.\d+$/.test(e.ip));
}

export function dnsLookup(st: LinuxState, name: string): string[] {
  let n = name.replace(/\.$/, '').toLowerCase();
  for (let i = 0; i < 5 && st.net.cname[n]; i++) n = st.net.cname[n]!;
  return st.net.dns[n] ?? [];
}

/** getaddrinfo: an IP, /etc/hosts, then DNS. */
export function resolve(st: LinuxState, name: string): string | null {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) return name;
  if (name === 'localhost') return '127.0.0.1';
  const h = hostsFile(st).find((e) => e.names.includes(name));
  if (h) return h.ip;
  if (name === st.hostname) return st.net.ifaces.find((i) => !i.loopback)?.ipv4 ?? '127.0.1.1';
  return dnsLookup(st, name)[0] ?? null;
}

function isLocal(st: LinuxState, ip: string): boolean {
  return ip.startsWith('127.') || st.net.ifaces.some((i) => i.ipv4 === ip);
}

/** Local TCP listeners: services (nginx 80, ssh 22) and programs. */
export function listeners(st: LinuxState): { addr: string; port: number; prog: string; pids: number[]; backlog: number }[] {
  const out: { addr: string; port: number; prog: string; pids: number[]; backlog: number }[] = [];
  const procsOf = (svc: string) =>
    Object.values(st.procs)
      .filter((p) => p.service === svc)
      .map((p) => p.pid)
      .sort((a, b) => b - a);
  if (st.services.ssh?.active === 'active') out.push({ addr: '0.0.0.0', port: 22, prog: 'sshd', pids: procsOf('ssh'), backlog: 128 });
  if (st.services.nginx?.active === 'active') for (const port of st.services.nginx.ports ?? nginxPorts(st)) out.push({ addr: '0.0.0.0', port, prog: 'nginx', pids: procsOf('nginx'), backlog: 511 });
  for (const l of st.net.listeners) if (st.procs[l.pid]) out.push({ addr: l.addr, port: l.port, prog: l.prog, pids: [l.pid], backlog: 5 });
  return out.sort((a, b) => a.port - b.port);
}

export function nginxPorts(st: LinuxState): number[] {
  const ports = new Set<number>();
  for (const [path, node] of Object.entries(st.fs)) {
    if (!path.startsWith('/etc/nginx/sites-enabled/')) continue;
    const target = node.type === 'link' ? st.fs[node.target!] : node;
    for (const m of (target?.content ?? '').replace(/#.*$/gm, '').matchAll(/listen\s+(?:[\d.]+:)?(\d+)/g)) ports.add(Number(m[1]));
  }
  return [...ports].sort((a, b) => a - b);
}

/** What answers http://ip:port/path from this server. */
function httpFetch(st: LinuxState, host: string, ip: string, port: number, path: string): { kind: 'refused' } | { kind: 'timeout' } | { kind: 'ok'; page: WebPage; server: string } {
  if (isLocal(st, ip)) {
    const l = listeners(st).find((x) => x.port === port && (x.addr === '0.0.0.0' || x.addr === ip || (x.addr === '127.0.0.1' && ip.startsWith('127.'))));
    if (!l) return { kind: 'refused' };
    if (l.prog === 'nginx') return { kind: 'ok', page: nginxServe(st, path, port), server: 'nginx' };
    if (l.prog === 'sshd') return { kind: 'ok', page: { status: 0, body: 'SSH-2.0-OpenSSH_10.0p2 Debian-7\r\n' }, server: 'ssh' };
    const prog = st.net.listeners.find((x) => x.pid === l.pids[0]);
    const page = prog?.pages?.[path] ?? { status: 404, body: '' };
    return { kind: 'ok', page, server: prog?.prog ?? 'python3' };
  }
  const remote = st.net.hosts[ip];
  if (!remote || !remote.up) return { kind: 'timeout' };
  const ports = remote.ports ?? (remote.pages ? [80, 443] : []);
  if (!ports.includes(port)) return remote.drops ? { kind: 'timeout' } : { kind: 'refused' };
  const page = remote.pages?.[path] ?? remote.pages?.['*'] ?? { status: 404, body: '<html>\r\n<head><title>404 Not Found</title></head>\r\n<body>\r\n<center><h1>404 Not Found</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n' };
  void host;
  return { kind: 'ok', page, server: page.headers?.Server ?? 'nginx' };
}

const NOT_FOUND = '<html>\r\n<head><title>404 Not Found</title></head>\r\n<body>\r\n<center><h1>404 Not Found</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n';
const FORBIDDEN = '<html>\r\n<head><title>403 Forbidden</title></head>\r\n<body>\r\n<center><h1>403 Forbidden</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n';

/** nginx serving the default site's root (index.html, then index.nginx-debian.html). */
/** One `server { }` block of an enabled site: its ports, root and index files. */
interface NginxServer {
  ports: number[];
  def: boolean;
  root: string;
  index: string[];
}

/**
 * The enabled sites' server blocks (sites-enabled/*, in nginx's include order). A block without
 * root or index gets nginx's built-in ones: /usr/share/nginx/html and index.html.
 */
export function nginxServers(st: LinuxState): NginxServer[] {
  const out: NginxServer[] = [];
  const files = Object.keys(st.fs).filter((k) => k.startsWith('/etc/nginx/sites-enabled/')).sort();
  for (const path of files) {
    const node = st.fs[path]!;
    const target = node.type === 'link' ? st.fs[absPath('/etc/nginx/sites-enabled', node.target!)] : node;
    const text = (target?.content ?? '').replace(/#.*$/gm, '');
    for (const m of text.matchAll(/(^|[;{}\s])server\s*\{/g)) {
      // The block: up to its matching "}"; directives in nested blocks (location) don't count.
      let depth = 1;
      let top = '';
      for (let i = m.index! + m[0].length; i < text.length && depth > 0; i++) {
        const c = text[i]!;
        if (c === '{') depth++;
        else if (c === '}') depth--;
        else if (depth === 1) top += c;
      }
      const ports = [...top.matchAll(/(?:^|;)\s*listen\s+(?:[\d.]+:)?(\d+)([^;]*)/g)];
      out.push({
        ports: ports.length ? ports.map((p) => Number(p[1])) : [80],
        def: ports.some((p) => /\bdefault_server\b/.test(p[2]!)),
        root: /(?:^|;)\s*root\s+([^;\s]+)\s*;/.exec(top)?.[1] ?? '/usr/share/nginx/html',
        index: /(?:^|;)\s*index\s+([^;]+);/.exec(top)?.[1]!.trim().split(/\s+/) ?? ['index.html'],
      });
    }
  }
  return out;
}

export function nginxServe(st: LinuxState, path: string, port = 80): WebPage {
  // The server for this port: its default_server, else the first one that listens there.
  const on = nginxServers(st).filter((s) => s.ports.includes(port));
  const srv = on.find((s) => s.def) ?? on[0] ?? { root: '/var/www/html', index: ['index.html', 'index.htm', 'index.nginx-debian.html'] };
  const root = srv.root.replace(/\/$/, '');
  const clean = decodeURIComponent(path.split('?')[0]!);
  let file = `${root}${clean}`;
  const node0 = lookup(st, 'www-data', file);
  if (node0.ok && node0.node.type === 'dir') {
    for (const idx of srv.index) {
      const f = lookup(st, 'www-data', `${file.replace(/\/$/, '')}/${idx}`);
      if (f.ok && f.node.type === 'file') {
        file = f.path;
        break;
      }
    }
  }

  const f = lookup(st, 'www-data', file);
  if (!f.ok) {
    if (f.err === 'EACCES') return { status: 403, body: FORBIDDEN, headers: { 'Content-Type': 'text/html' } };
    return { status: 404, body: NOT_FOUND, headers: { 'Content-Type': 'text/html' } };
  }
  if (f.node.type === 'dir') return { status: 403, body: FORBIDDEN, headers: { 'Content-Type': 'text/html' } };
  const www = userByName(st, 'www-data')!;
  const readable = f.node.uid === www.uid ? f.node.mode & 0o400 : f.node.gid === www.gid ? f.node.mode & 0o040 : f.node.mode & 0o004;
  if (!readable) return { status: 403, body: FORBIDDEN, headers: { 'Content-Type': 'text/html' } };
  const type = /\.html?$/.test(f.path) ? 'text/html' : /\.css$/.test(f.path) ? 'text/css' : /\.json$/.test(f.path) ? 'application/json' : 'text/plain';
  return { status: 200, body: f.node.content ?? '', headers: { 'Content-Type': type, 'Last-Modified': httpDate(f.node.mtime), ETag: `"${f.node.mtime.toString(16)}-${new TextEncoder().encode(f.node.content ?? '').length.toString(16)}"`, 'Accept-Ranges': 'bytes' } };
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function httpDate(t: number): string {
  const d = new Date(t * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${DAYS[d.getUTCDay()]}, ${p(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT`;
}

const REASONS: Record<number, string> = { 200: 'OK', 201: 'Created', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Time-out' };

// ---------------------------------------------------------------------------
// curl

export const curl: Program = (ctx, argv, io) => {
  const raw = argv.slice(1);
  const flags = new Set<string>();
  let url: string | undefined;
  let method: string | undefined;
  let out: string | undefined;
  const headers: string[] = [];
  /** --connect-timeout / --max-time, in seconds (curl waits for the kernel without one: ~2 minutes). */
  let limit: number | undefined;
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i]!;
    if (a === '-X' || a === '--request') method = raw[++i];
    else if (a === '-o' || a === '--output') out = raw[++i];
    else if (a === '-H' || a === '--header') headers.push(raw[++i] ?? '');
    else if (a === '-d' || a === '--data') {
      method ??= 'POST';
      i++;
    } else if (a === '--connect-timeout' || a === '-m' || a === '--max-time') {
      const secs = Number(raw[++i]);
      if (secs > 0) limit = Math.min(limit ?? secs, secs);
    }
    else if (a.startsWith('--')) flags.add(a.slice(2));
    else if (a.startsWith('-') && a.length > 1) for (const c of a.slice(1)) flags.add(c);
    else url = a;
  }
  if (!url) {
    io.err("curl: try 'curl --help' or 'curl --manual' for more information\n");
    return 2;
  }
  const silent = flags.has('s') || flags.has('silent');
  const showErr = !silent || flags.has('S') || flags.has('show-error');
  const verbose = flags.has('v') || flags.has('verbose');
  const head = flags.has('I') || flags.has('head');
  const incl = flags.has('i') || flags.has('include');
  const fail = flags.has('f') || flags.has('fail');
  const m = /^(?:(https?):\/\/)?([^/:]+)(?::(\d+))?(\/.*)?$/.exec(url);
  if (!m) {
    if (showErr) io.err(`curl: (3) URL rejected: Malformed input to a URL function\n`);
    return 3;
  }
  const scheme = m[1] ?? 'http';
  const host = m[2]!;
  const port = Number(m[3] ?? (scheme === 'https' ? 443 : 80));
  const path = m[4] ?? '/';
  const ip = resolve(ctx.st, host);
  const verb = head ? 'HEAD' : (method ?? 'GET');
  if (!ip) {
    if (verbose) io.err(`* Could not resolve host: ${host}\n* shutting down connection #0\n`);
    if (showErr) io.err(`curl: (6) Could not resolve host: ${host}\n`);
    setExplain(ctx, 'linux.err.curlResolve', { host });
    ctx.events.push({ type: 'request', url, status: null });
    return 6;
  }
  if (verbose) {
    if (host === 'localhost') io.err('* Host localhost:' + port + ' was resolved.\n* IPv6: ::1\n* IPv4: 127.0.0.1\n');
    else if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) io.err(`* Host ${host}:${port} was resolved.\n* IPv6: (none)\n* IPv4: ${ip}\n`);
    io.err(`*   Trying ${ip}:${port}...\n`);
  }
  const r = httpFetch(ctx.st, host, ip, port, path);
  if (r.kind === 'refused') {
    if (verbose) io.err(`* connect to ${ip} port ${port} from ${isLocal(ctx.st, ip) ? '127.0.0.1' : ctx.st.net.ifaces.find((x) => !x.loopback)?.ipv4} port 41234 failed: Connection refused\n* Failed to connect to ${host} port ${port} after 0 ms: Could not connect to server\n* closing connection #0\n`);
    if (showErr) io.err(`curl: (7) Failed to connect to ${host} port ${port} after 0 ms: Could not connect to server\n`);
    setExplain(ctx, 'linux.err.curlRefused', { host, port });
    ctx.events.push({ type: 'request', url, status: null });
    return 7;
  }
  if (r.kind === 'timeout') {
    // Real curl 8.14 on Debian 13 (checked 2026-11-01 against a host whose firewall drops packets):
    // with --connect-timeout 5 it says "Connection timed out after 5004 milliseconds"; without one it
    // waits for the kernel to give up (about 2 minutes) and says "after 134844 ms: Could not connect".
    const from = ctx.st.net.ifaces.find((x) => !x.loopback)?.ipv4;
    if (limit !== undefined) {
      const ms = Math.round(limit * 1000) + 4;
      if (verbose) io.err(`* Connection timed out after ${ms} milliseconds\n* closing connection #0\n`);
      if (showErr) io.err(`curl: (28) Connection timed out after ${ms} milliseconds\n`);
      ctx.st.clock += Math.ceil(limit);
    } else {
      if (verbose) io.err(`* connect to ${ip} port ${port} from ${from} port 41234 failed: Connection timed out\n* Failed to connect to ${host} port ${port} after 134844 ms: Could not connect to server\n* closing connection #0\n`);
      if (showErr) io.err(`curl: (28) Failed to connect to ${host} port ${port} after 134844 ms: Could not connect to server\n`);
      ctx.st.clock += 135;
    }
    setExplain(ctx, 'linux.err.curlTimeout', { host, port });
    ctx.events.push({ type: 'request', url, status: null });
    return 28;
  }
  if (r.server === 'ssh') {
    if (showErr) io.err(`curl: (1) Received HTTP/0.9 when not allowed\n`);
    return 1;
  }
  if (scheme === 'https' && isLocal(ctx.st, ip)) {
    if (verbose) io.err(`* Connected to ${host} (${ip}) port ${port}\n`);
    if (showErr) io.err(`curl: (7) Failed to connect to ${host} port ${port} after 0 ms: Could not connect to server\n`);
    return 7;
  }
  const page = r.page;
  const bodyLen = new TextEncoder().encode(page.body).length;
  const hdrs: [string, string][] = [
    ['Server', r.server === 'nginx' ? 'nginx' : r.server],
    ['Date', httpDate(ctx.st.clock)],
    ['Content-Type', page.headers?.['Content-Type'] ?? 'text/html'],
    ['Content-Length', String(bodyLen)],
  ];
  if (page.headers?.['Last-Modified']) hdrs.push(['Last-Modified', page.headers['Last-Modified']]);
  hdrs.push(['Connection', 'keep-alive']);
  for (const [k, v] of Object.entries(page.headers ?? {})) if (!hdrs.some(([h]) => h === k)) hdrs.push([k, v]);
  const statusLine = `HTTP/1.1 ${page.status} ${REASONS[page.status] ?? ''}`;
  if (verbose) {
    io.err(`* Connected to ${host} (${ip}) port ${port}\n* using HTTP/1.x\n`);
    io.err(`> ${verb} ${path} HTTP/1.1\n> Host: ${host}${m[3] ? `:${port}` : ''}\n> User-Agent: curl/8.14.1\n> Accept: */*\n`);
    for (const h of headers) io.err(`> ${h}\n`);
    io.err('> \n* Request completely sent off\n');
    io.err(`< ${statusLine}\n`);
    for (const [k, v] of hdrs) io.err(`< ${k}: ${v}\n`);
    io.err('< \n');
  }
  ctx.events.push({ type: 'request', url, status: page.status });
  if (fail && page.status >= 400) {
    if (showErr) io.err(`curl: (22) The requested URL returned error: ${page.status}\n`);
    return 22;
  }
  let text = '';
  if (head || incl) text += `${statusLine}\r\n${hdrs.map(([k, v]) => `${k}: ${v}\r\n`).join('')}\r\n`;
  if (!head) text += page.body;
  if (out) {
    const code = ctx.exec(['__write', out, 'replace', text, 'curl'], io);
    if (code) return 23;
  } else io.out(text);
  if (verbose) io.err(`* Connection #0 to host ${host} left intact\n`);
  setExplain(ctx, head ? 'linux.explain.curlHead' : verbose ? 'linux.explain.curlV' : page.status >= 400 ? 'linux.explain.curlStatus' : 'linux.explain.curl', { status: page.status, host });
  return 0;
};

// ---------------------------------------------------------------------------
// ip

export const ip: Program = (ctx, argv, io) => {
  const args = argv.slice(1);
  const brief = args.includes('-br') || args.includes('-brief');
  const rest = args.filter((a) => !a.startsWith('-'));
  const obj = rest[0] ?? '';
  const st = ctx.st;
  if (!obj) {
    io.err('Usage: ip [ OPTIONS ] OBJECT { COMMAND | help }\n');
    return 255;
  }
  if ('address'.startsWith(obj) || obj === 'a') {
    for (const i of st.net.ifaces) {
      if (brief) {
        // The loopback also has the IPv6 ::1 (seen on a real Debian 13 container in CI).
        io.out(`${i.name.padEnd(16)} ${(i.loopback ? 'UNKNOWN' : i.up ? 'UP' : 'DOWN').padEnd(14)} ${i.ipv4}/${i.prefix} ${i.loopback ? '::1/128 ' : ''}\n`);
        continue;
      }
      const flagsTxt = i.loopback ? '<LOOPBACK,UP,LOWER_UP>' : i.up ? '<BROADCAST,MULTICAST,UP,LOWER_UP>' : '<BROADCAST,MULTICAST>';
      io.out(`${i.index}: ${i.name}: ${flagsTxt} mtu ${i.mtu} qdisc noqueue state ${i.loopback ? 'UNKNOWN' : i.up ? 'UP' : 'DOWN'} group default ${i.loopback ? 'qlen 1000' : ''}\n`);
      io.out(`    link/${i.loopback ? 'loopback' : 'ether'} ${i.mac} brd ${i.loopback ? '00:00:00:00:00:00' : 'ff:ff:ff:ff:ff:ff'}\n`);
      if (i.loopback) io.out(`    inet ${i.ipv4}/${i.prefix} scope host lo\n`);
      else io.out(`    inet ${i.ipv4}/${i.prefix} brd ${broadcast(i.ipv4, i.prefix)} scope global ${i.name}\n`);
      io.out('       valid_lft forever preferred_lft forever\n');
      if (i.loopback) io.out('    inet6 ::1/128 scope host noprefixroute \n       valid_lft forever preferred_lft forever\n');
    }
    setExplain(ctx, 'linux.explain.ipAddr', { ip: st.net.ifaces.find((x) => !x.loopback)?.ipv4 ?? '' });
    return 0;
  }
  if ('route'.startsWith(obj) || obj === 'r') {
    const eth = st.net.ifaces.find((x) => !x.loopback)!;
    io.out(`default via ${st.net.gateway} dev ${eth.name} \n`);
    io.out(`${network(eth.ipv4, eth.prefix)}/${eth.prefix} dev ${eth.name} proto kernel scope link src ${eth.ipv4} \n`);
    setExplain(ctx, 'linux.explain.ipRoute', { gw: st.net.gateway });
    return 0;
  }
  if ('link'.startsWith(obj)) {
    for (const i of st.net.ifaces) {
      io.out(`${i.index}: ${i.name}: ${i.loopback ? '<LOOPBACK,UP,LOWER_UP>' : '<BROADCAST,MULTICAST,UP,LOWER_UP>'} mtu ${i.mtu} qdisc noqueue state ${i.loopback ? 'UNKNOWN' : 'UP'} mode DEFAULT group default ${i.loopback ? 'qlen 1000' : ''}\n`);
      io.out(`    link/${i.loopback ? 'loopback' : 'ether'} ${i.mac} brd ${i.loopback ? '00:00:00:00:00:00' : 'ff:ff:ff:ff:ff:ff'}\n`);
    }
    return 0;
  }
  io.err(`Object "${obj}" is unknown, try "ip help".\n`);
  return 1;
};

function toNum(ip: string): number {
  return ip.split('.').reduce((a, b) => a * 256 + Number(b), 0);
}

function toIp(n: number): string {
  return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
}

export function network(ip: string, prefix: number): string {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return toIp((toNum(ip) & mask) >>> 0);
}

function broadcast(ip: string, prefix: number): string {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return toIp(((toNum(ip) & mask) | (~mask >>> 0)) >>> 0);
}

// ---------------------------------------------------------------------------
// ss

const SERVICES: Record<number, string> = { 22: 'ssh', 80: 'http', 443: 'https', 25: 'smtp', 53: 'domain', 3306: 'mysql', 5432: 'postgresql', 8080: 'http-alt' };

export const ss: Program = (ctx, argv, io) => {
  const p = parseOpts(argv.slice(1), 'tulnpa4', ['tcp', 'udp', 'listening', 'numeric', 'processes', 'all'], []);
  const f = p.flags;
  const numeric = f.has('n') || f.has('numeric');
  const proc = f.has('p') || f.has('processes');
  const udpOnly = (f.has('u') || f.has('udp')) && !(f.has('t') || f.has('tcp'));
  const root = userByName(ctx.st, ctx.sh.user)?.uid === 0;
  const rows = udpOnly ? [] : listeners(ctx.st);
  const local = rows.map((r) => ({ addr: r.addr, port: numeric ? String(r.port) : (SERVICES[r.port] ?? String(r.port)) }));
  const aw = Math.max(13, ...local.map((l) => l.addr.length));
  const pw = Math.max(4, ...local.map((l) => l.port.length));
  const head = `${'State'.padEnd(6)} Recv-Q Send-Q ${'Local Address'.padStart(aw)}:${'Port'.padEnd(pw)} ${'Peer Address'.padStart(12)}:${proc ? 'PortProcess' : 'Port'}`;
  if (!f.has('t') && !f.has('l') && !f.has('tcp') && !f.has('listening')) {
    io.out('Netid State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process\n');
    setExplain(ctx, 'linux.explain.ssAll');
    return 0;
  }
  io.out(`${head}\n`);
  rows.forEach((r, i) => {
    const l = local[i]!;
    let line = `LISTEN ${String(0).padEnd(6)} ${String(r.backlog).padEnd(6)} ${l.addr.padStart(aw)}:${l.port.padEnd(pw)} ${'0.0.0.0'.padStart(12)}:${'*'.padEnd(4)}`;
    if (proc && root) line += ` users:(${r.pids.map((pid) => `("${r.prog}",pid=${pid},fd=${r.prog === 'nginx' ? 5 : r.prog === 'sshd' ? 6 : 3})`).join(',')})`;
    io.out(`${line}\n`);
  });
  setExplain(ctx, proc && !root ? 'linux.explain.ssNoProc' : 'linux.explain.ss', { n: rows.length, ports: rows.map((r) => r.port).join(', ') });
  return 0;
};

// ---------------------------------------------------------------------------
// ping

export const ping: Program = (ctx, argv, io) => {
  const p = parseOpts(argv.slice(1), 'qn4', [], ['c', 'i', 'W', 'w']);
  const target = p.args[0];
  if (!target) {
    io.err('ping: usage error: Destination address required\n');
    return 1;
  }
  const ip = resolve(ctx.st, target);
  if (!ip) {
    io.err(`ping: ${target}: Name or service not known\n`);
    setExplain(ctx, 'linux.err.pingResolve', { host: target });
    return 2;
  }
  const count = p.values.c ? Number(p.values.c) : null;
  const local = isLocal(ctx.st, ip);
  const remote = ctx.st.net.hosts[ip];
  const up = local || (remote?.up && !remote.drops);
  const rtt = local ? 0.04 : (remote?.rtt ?? 12);
  // A machine on our own network answers with its own TTL (64 for Linux); internet hosts are a few
  // routers away. Nobody at an address on our network: ARP gets no answer, so the kernel reports
  // "Destination Host Unreachable" (iputils 20240905 wording).
  const eth = ctx.st.net.ifaces.find((i) => !i.loopback);
  const lan = !local && !!eth && network(ip, eth.prefix) === network(eth.ipv4, eth.prefix);
  const unreachable = lan && !up;
  const ttl = local || lan ? 64 : 57;
  const shownFrom = (seq: number) => {
    const t = (rtt * (1 + ((seq * 7) % 5) / 40)).toFixed(local ? 3 : 1);
    const from = target === ip ? ip : target === 'localhost' || /^\d/.test(target) ? `${target} (${ip})` : ip;
    return `64 bytes from ${from}: icmp_seq=${seq} ttl=${ttl} time=${t} ms`;
  };
  io.out(`PING ${target} (${ip}) 56(84) bytes of data.\n`);
  const n = count ?? 4;
  if (up) for (let s = 1; s <= n; s++) io.out(`${shownFrom(s)}\n`);
  const errors = unreachable ? Math.min(n, 3) : 0;
  for (let s = 1; s <= errors; s++) io.out(`From ${eth!.ipv4} icmp_seq=${s} Destination Host Unreachable\n`);
  if (unreachable && n > 3) io.err('ping: sendmsg: No route to host\n');
  const finish = () => {
    io.out(`\n--- ${target} ping statistics ---\n`);
    const got = up ? n : 0;
    io.out(`${n} packets transmitted, ${got} received, ${errors ? `+${errors} errors, ` : ''}${up ? 0 : 100}% packet loss, time ${n > 1 ? (n - 1) * 1001 + 2 : 0}ms\n`);
    if (errors > 1) io.out(`pipe ${errors}\n`);
    if (up) {
      const vals = Array.from({ length: n }, (_v, i) => rtt * (1 + (((i + 1) * 7) % 5) / 40));
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const avg = vals.reduce((a, b) => a + b, 0) / n;
      const mdev = Math.sqrt(vals.reduce((a, b) => a + (b - avg) ** 2, 0) / n);
      io.out(`rtt min/avg/max/mdev = ${min.toFixed(3)}/${avg.toFixed(3)}/${max.toFixed(3)}/${mdev.toFixed(3)} ms\n`);
    }
  };
  ctx.st.clock += Math.max(0, n - 1);
  if (count === null && goLong(ctx, { args: argv.join(' '), comm: 'ping', kind: 'ping', prints: [] })) {
    setExplain(ctx, up ? 'linux.explain.pingForever' : 'linux.err.pingNoReply', { host: target });
    return 0;
  }
  finish();
  setExplain(ctx, up ? 'linux.explain.ping' : 'linux.err.pingNoReply', { host: target, ip });
  return up ? 0 : 1;
};

/** What ping prints when the learner presses Ctrl+C (the statistics). */
export function pingStats(ctx: Ctx, cmd: string): string[] {
  const target = cmd.split(/\s+/).filter((a) => !a.startsWith('-')).pop() ?? '';
  const ip = resolve(ctx.st, target) ?? target;
  const up = isLocal(ctx.st, ip) || ctx.st.net.hosts[ip]?.up;
  return [`--- ${target} ping statistics ---`, `4 packets transmitted, ${up ? 4 : 0} received, ${up ? 0 : 100}% packet loss, time 3005ms`, ...(up ? [`rtt min/avg/max/mdev = 0.040/0.041/0.043/0.001 ms`] : [])];
}

// ---------------------------------------------------------------------------
// getent, dig, host

export const getent: Program = (ctx, argv, io) => {
  const [db, ...keys] = argv.slice(1);
  if (db === 'hosts' || db === 'ahosts') {
    if (!keys.length) {
      for (const e of hostsFile(ctx.st)) io.out(`${e.ip.padEnd(15)} ${e.names.join(' ')}\n`);
      return 0;
    }
    let code = 0;
    for (const k of keys) {
      const h = hostsFile(ctx.st).find((e) => e.names.includes(k) || e.ip === k);
      if (h) {
        io.out(`${h.ip.padEnd(15)} ${h.names.join(' ')}\n`);
        continue;
      }
      const ipAddr = resolve(ctx.st, k);
      if (ipAddr) io.out(`${ipAddr.padEnd(15)} ${k}\n`);
      else code = 2;
    }
    setExplain(ctx, code ? 'linux.explain.getentNone' : 'linux.explain.getent', { name: keys[0]! });
    return code;
  }
  if (db === 'passwd' || db === 'group') {
    const text = ctx.st.fs[`/etc/${db}`]?.content ?? '';
    const lines = text.split('\n').filter(Boolean);
    const pick = keys.length ? lines.filter((l) => keys.includes(l.split(':')[0]!)) : lines;
    for (const l of pick) io.out(`${l}\n`);
    return keys.length && pick.length < keys.length ? 2 : 0;
  }
  io.err(`Unknown database: ${db ?? ''}\nTry \`getent --help' or \`getent --usage' for more information.\n`);
  return 1;
};

const MONTHS3 = MONTHS;

export const dig: Program = (ctx, argv, io) => {
  const args = argv.slice(1);
  const short = args.includes('+short');
  let server = ctx.st.net.resolver;
  const names = args.filter((a) => !a.startsWith('+') && !a.startsWith('-') && !a.startsWith('@'));
  const at = args.find((a) => a.startsWith('@'));
  if (at) server = at.slice(1);
  const type = names.find((n) => /^(A|AAAA|MX|TXT|NS|CNAME|SOA)$/i.test(n))?.toUpperCase() ?? 'A';
  const name = names.find((n) => !/^(A|AAAA|MX|TXT|NS|CNAME|SOA)$/i.test(n)) ?? '.';
  const fq = name.endsWith('.') ? name : `${name}.`;
  const chain: [string, string][] = [];
  let n = name.toLowerCase().replace(/\.$/, '');
  for (let i = 0; i < 5 && ctx.st.net.cname[n]; i++) {
    chain.push([n, ctx.st.net.cname[n]!]);
    n = ctx.st.net.cname[n]!;
  }
  const ips = type === 'A' ? (ctx.st.net.dns[n] ?? []) : [];
  const exists = ips.length > 0 || chain.length > 0 || Object.keys(ctx.st.net.dns).some((k) => k.endsWith(`.${n}`));
  if (short) {
    for (const [, t] of chain) io.out(`${t}.\n`);
    for (const a of ips) io.out(`${a}\n`);
    setExplain(ctx, ips.length ? 'linux.explain.digShort' : 'linux.explain.digNone', { name, ip: ips[0] ?? '' });
    return 0;
  }
  const id = 4000 + ((ctx.st.clock * 31) % 60000);
  const answers = chain.length + ips.length;
  io.out(`\n; <<>> DiG 9.20.30-1~deb13u1-Debian <<>> ${args.join(' ')}\n`);
  if (at) io.out('; (1 server found)\n');
  io.out(';; global options: +cmd\n;; Got answer:\n');
  io.out(`;; ->>HEADER<<- opcode: QUERY, status: ${exists ? 'NOERROR' : 'NXDOMAIN'}, id: ${id}\n`);
  io.out(`;; flags: qr rd ra; QUERY: 1, ANSWER: ${answers}, AUTHORITY: ${exists && answers ? 0 : 1}, ADDITIONAL: 1\n\n`);
  io.out(';; OPT PSEUDOSECTION:\n; EDNS: version: 0, flags:; udp: 1232\n;; QUESTION SECTION:\n');
  io.out(`;${fq.padEnd(31)}IN\t${type}\n\n`);
  if (answers) {
    io.out(';; ANSWER SECTION:\n');
    for (const [from, to] of chain) io.out(`${`${from}.`.padEnd(24)}300\tIN\tCNAME\t${to}.\n`);
    for (const a of ips) io.out(`${`${n}.`.padEnd(24)}300\tIN\tA\t${a}\n`, 'green');
    io.out('\n');
  } else {
    io.out(';; AUTHORITY SECTION:\n');
    io.out(`example.\t\t\t900\tIN\tSOA\tns.example. hostmaster.example. 2026110101 7200 3600 1209600 900\n\n`);
  }
  const d = new Date(ctx.st.clock * 1000);
  const p2 = (x: number) => String(x).padStart(2, '0');
  io.out(`;; Query time: 12 msec\n;; SERVER: ${server}#53(${server}) (UDP)\n;; WHEN: ${DAYS[d.getUTCDay()]} ${MONTHS3[d.getUTCMonth()]} ${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} UTC ${d.getUTCFullYear()}\n;; MSG SIZE  rcvd: ${40 + fq.length + answers * 16}\n\n`);
  setExplain(ctx, ips.length ? 'linux.explain.dig' : 'linux.explain.digNone', { name, ip: ips[0] ?? '' });
  return 0;
};

export const host: Program = (ctx, argv, io) => {
  const name = argv.slice(1).find((a) => !a.startsWith('-'));
  if (!name) {
    io.err('Usage: host [-aCdilrTvVw] [-c class] [-N ndots] [-t type] [-W time]\n');
    return 1;
  }
  let n = name.toLowerCase().replace(/\.$/, '');
  for (let i = 0; i < 5 && ctx.st.net.cname[n]; i++) {
    io.out(`${n} is an alias for ${ctx.st.net.cname[n]}.\n`);
    n = ctx.st.net.cname[n]!;
  }
  const ips = ctx.st.net.dns[n] ?? [];
  if (!ips.length) {
    io.out(`Host ${name} not found: 3(NXDOMAIN)\n`);
    setExplain(ctx, 'linux.explain.digNone', { name });
    return 1;
  }
  for (const a of ips) io.out(`${n} has address ${a}\n`);
  setExplain(ctx, 'linux.explain.dig', { name, ip: ips[0]! });
  return 0;
};

/** python3 -m http.server [port]: a tiny web server (a background program on a port). */
export function addListener(ctx: Ctx, l: Omit<Listener, 'pid'>, pid: number) {
  ctx.st.net.listeners.push({ ...l, pid });
}

export { lq };
