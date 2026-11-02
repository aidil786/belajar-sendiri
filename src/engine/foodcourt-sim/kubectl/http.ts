// `curl` and `wget` output for requests made from the laptop or from inside a pod.
// Error texts were checked with curl 8.17 (nginx:1.29-alpine) and busybox 1.37 wget.
import type { HttpResult } from '../types';
import { rfc1123 } from '../util';

export interface CurlOpts {
  silent: boolean;
  include: boolean;
  headOnly: boolean;
  writeOut?: string;
  outNull: boolean;
  maxTime: number;
  host?: string;
  failFast: boolean;
  url: string;
}

/** Read curl's flags. Unknown flags are ignored (like most curl options in a lesson). */
export function parseCurl(args: string[]): CurlOpts | { error: string } {
  const o: CurlOpts = { silent: false, include: false, headOnly: false, outNull: false, maxTime: 10, failFast: false, url: '' };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '-s' || a === '--silent' || a === '-sS') o.silent = true;
    else if (a === '-i' || a === '--include') o.include = true;
    else if (a === '-I' || a === '--head') o.headOnly = true;
    else if (a === '-f' || a === '--fail') o.failFast = true;
    else if (a === '-sf' || a === '-fs' || a === '-fsS' || a === '-sfL' || a === '-sL' || a === '-L') {
      if (a.includes('s')) o.silent = true;
      if (a.includes('f')) o.failFast = true;
    } else if (a === '-m' || a === '--max-time' || a === '--connect-timeout') o.maxTime = Number(args[++i] ?? 10);
    else if (a.startsWith('--max-time=') || a.startsWith('--connect-timeout=')) o.maxTime = Number(a.split('=')[1]);
    else if (a === '-H' || a === '--header') {
      const h = args[++i] ?? '';
      const m = /^host:\s*(.+)$/i.exec(h);
      if (m) o.host = m[1]!.trim();
    } else if (a === '-o' || a === '--output') o.outNull = (args[++i] ?? '') === '/dev/null';
    else if (a === '-w' || a === '--write-out') o.writeOut = args[++i] ?? '';
    else if (a === '-v' || a === '-X' || a === '-d') {
      if (a !== '-v') i++;
    } else if (!a.startsWith('-')) o.url = a;
  }
  if (!o.url) return { error: "curl: try 'curl --help' or 'curl --manual' for more information" };
  return o;
}

const REASON: Record<number, string> = { 200: 'OK', 404: 'Not Found', 500: 'Internal Server Error', 503: 'Service Unavailable', 403: 'Forbidden' };

/** Output lines and exit code for curl. */
export function curlOutput(o: CurlOpts, r: HttpResult, clock: number, fromPod: boolean): { lines: string[]; code: number } {
  const out: string[] = [];
  const host = r.host ?? o.url;
  const u = /^(?:https?:\/\/)?([^/:]+)(?::(\d+))?/.exec(o.url);
  const port = u?.[2] ?? '80';
  const meter = () => {
    if (o.silent || !fromPod) return;
    out.push('  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current', '                                 Dload  Upload   Total   Spent    Left  Speed');
  };
  if (!r.ok || r.status === null) {
    meter();
    if (o.silent && !o.writeOut) return { lines: out, code: r.error === 'dns' ? 6 : r.error === 'timeout' ? 28 : 7 };
    const showErr = !o.silent;
    if (r.error === 'dns') {
      if (showErr) out.push(`curl: (6) Could not resolve host: ${u?.[1] ?? host}`);
      return { lines: out, code: 6 };
    }
    if (r.error === 'timeout') {
      if (showErr) out.push(`curl: (28) Connection timed out after ${o.maxTime * 1000 + 2} milliseconds`);
      return { lines: out, code: 28 };
    }
    if (showErr) out.push(`curl: (7) Failed to connect to ${u?.[1] ?? host} port ${port} after 0 ms: Could not connect to server`);
    return { lines: out, code: 7 };
  }
  const status = r.status;
  if (o.failFast && status >= 400) {
    meter();
    if (!o.silent) out.push(`curl: (22) The requested URL returned error: ${status}`);
    return { lines: out, code: 22 };
  }
  if (o.include || o.headOnly) {
    const envoy = r.hops.some((h) => h.startsWith('gateway/'));
    const len = new TextEncoder().encode(r.body).length;
    if (envoy && !r.pod) {
      out.push(`HTTP/1.1 ${status} ${REASON[status] ?? ''}`.trim(), `date: ${rfc1123(clock).replace('+0000', 'GMT')}`, `content-length: ${len}`);
      if (r.body) out.push('content-type: text/plain');
    } else {
      out.push(`HTTP/1.1 ${status} ${REASON[status] ?? ''}`.trim(), `Date: ${rfc1123(clock).replace('+0000', 'GMT')}`, `Content-Length: ${len}`);
    }
    out.push('');
  }
  if (!o.headOnly && !o.outNull) out.push(...r.body.replace(/\r/g, '').replace(/\n$/, '').split('\n').filter((l, _i, a) => !(a.length === 1 && l === '')));
  if (o.writeOut) out.push(...o.writeOut.replace(/%\{http_code\}/g, String(status)).replace(/\\n/g, '\n').replace(/\n$/, '').split('\n'));
  return { lines: out, code: 0 };
}

/** busybox wget -qO- … */
export function wgetOutput(url: string, r: HttpResult, quiet: boolean): { lines: string[]; code: number } {
  const host = /^(?:https?:\/\/)?([^/:]+)/.exec(url)?.[1] ?? url;
  if (r.error === 'dns') return { lines: [`wget: bad address '${host}'`], code: 1 };
  if (r.error === 'timeout') return { lines: ['wget: download timed out'], code: 1 };
  if (!r.ok || r.status === null) return { lines: [`wget: can't connect to remote host (${r.ip ?? host}): Connection refused`], code: 1 };
  if (r.status >= 400) return { lines: [`wget: server returned error: HTTP/1.1 ${r.status} ${REASON[r.status] ?? ''}`.trim()], code: 1 };
  const out = quiet ? [] : [`Connecting to ${host} (${r.ip ?? host}:80)`, "writing to stdout"];
  out.push(...r.body.replace(/\n$/, '').split('\n'));
  if (!quiet) out.push(`-                    100% |********************************|   ${new TextEncoder().encode(r.body).length}  0:00:00 ETA`, 'written to stdout');
  return { lines: out, code: 0 };
}
