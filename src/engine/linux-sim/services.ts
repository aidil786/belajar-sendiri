// systemd services (nginx, cron, ssh): systemctl, journalctl, `nginx -t` and the journal.
// Outputs follow systemd 257 and nginx 1.26 on Debian 13 (checked in a systemd container).
import { setExplain, type Ctx, type IO } from './ctx';
import { gidsOf, groupByName, joinPath, lookup, userByName } from './fs';
import { spawn } from './procs';
import type { JournalEntry, LinuxState, Proc, Service } from './types';

const SYSV = new Set(['nginx', 'cron', 'ssh']);

export function hexId(st: LinuxState, n = 32): string {
  let out = '';
  let h = (st.seed ^ 0x9e3779b9) >>> 0;
  while (out.length < n) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    h ^= h >>> 16;
    out += (h >>> 0).toString(16).padStart(8, '0');
  }
  st.seed = (st.seed + 1) >>> 0;
  return out.slice(0, n);
}

/**
 * The syslog priority a real Debian 13 journal gives these lines (checked with journalctl -o json):
 * systemd's "Failed to start" is err (3), "Failed with result" warning (4), "process exited" notice
 * (5); sudo's command line is notice; everything else here (nginx's [emerg] on stderr too) is info.
 */
function priorityOf(ident: string, msg: string): number {
  if (ident === 'systemd') {
    if (/^Failed to start /.test(msg)) return 3;
    if (/: Failed with result /.test(msg)) return 4;
    if (/: (Control|Main) process exited/.test(msg)) return 5;
  }
  if (ident === 'sudo' && / : .*COMMAND=/.test(msg)) return 5;
  return 6;
}

/** Add a journal line. `uid` is the sender (sudo logs as the user who ran it). */
export function journal(st: LinuxState, unit: string, ident: string, pid: number, msg: string, uid = 0) {
  const e: JournalEntry = { time: st.clock, unit, ident, pid, msg, prio: priorityOf(ident, msg) };
  if (uid) e.uid = uid;
  st.journal.push(e);
}

/** journalctl's colours: err and worse red, warning yellow, notice bold. */
function prioColor(e: JournalEntry): 'red' | 'yellow' | 'bold' | undefined {
  const p = e.prio ?? 6;
  return p <= 3 ? 'red' : p === 4 ? 'yellow' : p === 5 ? 'bold' : undefined;
}

/** Number of CPUs of the practice server (nginx starts one worker per CPU). */
export const CPUS = 2;

/** Start the processes of a service. Returns false (and logs why) when it fails to start. */
export function startService(ctx: Ctx, svc: Service): boolean {
  const st = ctx.st;
  const unit = `${svc.name}.service`;
  journal(st, svc.name, 'systemd', 1, `Starting ${unit} - ${svc.description}...`);
  svc.processes = [];
  svc.invocation = hexId(st);
  // A new run forgets the old main process: a start that fails early shows no "Main PID" line.
  delete svc.lastMain;
  delete svc.gone;
  if (svc.name === 'nginx') {
    const pre = st.nextPid++;
    const problem = nginxConfigProblem(st);
    if (problem) {
      for (const l of problem.lines(pre)) journal(st, svc.name, 'nginx', pre, l);
      svc.processes.push({ pid: pre, what: `ExecStartPre=${svc.execStartPre}`, status: 'code=exited, status=1/FAILURE' });
      journal(st, svc.name, 'systemd', 1, `${unit}: Control process exited, code=exited, status=1/FAILURE`);
      failService(st, svc, 'exit-code');
      return false;
    }
    const busy = portBusy(st, 80, svc.name);
    svc.processes.push({ pid: pre, what: `ExecStartPre=${svc.execStartPre}`, status: 'code=exited, status=0/SUCCESS' });
    const start = st.nextPid++;
    if (busy) {
      const msgs = [`[emerg] ${start}#${start}: bind() to 0.0.0.0:80 failed (98: Address already in use)`];
      for (const m of msgs) journal(st, svc.name, 'nginx', start, `${nginxStamp(st)} ${m}`);
      journal(st, svc.name, 'nginx', start, `${nginxStamp(st)} [emerg] ${start}#${start}: still could not bind()`);
      svc.processes.push({ pid: start, what: `ExecStart=${svc.execStart}`, status: 'code=exited, status=1/FAILURE' });
      journal(st, svc.name, 'systemd', 1, `${unit}: Control process exited, code=exited, status=1/FAILURE`);
      failService(st, svc, 'exit-code');
      return false;
    }
    svc.processes.push({ pid: start, what: `ExecStart=${svc.execStart}`, status: 'code=exited, status=0/SUCCESS' });
    svc.ports = nginxConfigPorts(st);
    const master = st.nextPid++;
    spawn(ctx, { pid: master, args: 'nginx: master process /usr/sbin/nginx -g daemon on; master_process on;', comm: 'nginx', kind: 'daemon', user: 'root', ppid: 1, tty: '?', service: 'nginx', vsz: 14652, rss: 2496 });
    st.procs[master]!.sessionLeader = true;
    for (let i = 0; i < CPUS; i++) spawn(ctx, { args: 'nginx: worker process', comm: 'nginx', kind: 'worker', user: 'www-data', ppid: master, tty: '?', service: 'nginx', vsz: 15008, rss: 3644 });
    svc.mainPid = master;
  } else {
    if (svc.execStartPre) {
      const pre = st.nextPid++;
      svc.processes.push({ pid: pre, what: `ExecStartPre=${svc.execStartPre}`, status: 'code=exited, status=0/SUCCESS' });
    }
    const pid = st.nextPid++;
    const args = svc.name === 'cron' ? '/usr/sbin/cron -f' : 'sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups';
    spawn(ctx, { pid, args, comm: svc.name === 'cron' ? 'cron' : 'sshd', kind: 'daemon', user: 'root', ppid: 1, tty: '?', service: svc.name, vsz: svc.name === 'cron' ? 4296 : 11780, rss: svc.name === 'cron' ? 2796 : 8220 });
    st.procs[pid]!.sessionLeader = true;
    svc.mainPid = pid;
    if (svc.name === 'cron') {
      journal(st, svc.name, 'systemd', 1, `Started ${unit} - ${svc.description}.`);
      journal(st, svc.name, 'cron', pid, '(CRON) INFO (pidfile fd = 3)');
      journal(st, svc.name, 'cron', pid, '(CRON) INFO (Running @reboot jobs)');
      setActive(st, svc);
      return true;
    }
    if (svc.name === 'ssh') journal(st, svc.name, 'sshd', pid, 'Server listening on 0.0.0.0 port 22.');
    if (svc.name === 'ssh') journal(st, svc.name, 'sshd', pid, 'Server listening on :: port 22.');
  }
  journal(st, svc.name, 'systemd', 1, `Started ${unit} - ${svc.description}.`);
  setActive(st, svc);
  return true;
}

/**
 * systemd unloads a unit that is inactive (not failed) and that nothing wants (not enabled): its
 * last run is forgotten, so `systemctl status` then shows only "inactive (dead)".
 */
export function collectUnit(svc: Service) {
  if (svc.active === 'inactive' && !svc.enabled) svc.gone = true;
}

function setActive(st: LinuxState, svc: Service) {
  svc.active = 'active';
  svc.since = st.clock;
  svc.startedAt = st.clock;
  delete svc.result;
  delete svc.lastMain;
}

function failService(st: LinuxState, svc: Service, result: string) {
  const unit = `${svc.name}.service`;
  journal(st, svc.name, 'systemd', 1, `${unit}: Failed with result '${result}'.`);
  journal(st, svc.name, 'systemd', 1, `Failed to start ${unit} - ${svc.description}.`);
  svc.active = 'failed';
  svc.result = result;
  svc.since = st.clock;
  delete svc.mainPid;
}

export function stopService(ctx: Ctx, svc: Service) {
  const st = ctx.st;
  const unit = `${svc.name}.service`;
  // Stopping a unit that is not running changes nothing: a failed one stays failed (reset-failed or
  // a new start clears it).
  if (svc.active !== 'active') return;
  journal(st, svc.name, 'systemd', 1, `Stopping ${unit} - ${svc.description}...`);
  if (svc.name === 'ssh' && svc.mainPid) journal(st, svc.name, 'sshd', svc.mainPid, 'Received signal 15; terminating.');
  if (svc.execStop) {
    const pid = st.nextPid++;
    svc.processes.push({ pid, what: `ExecStop=${svc.execStop}`, status: 'code=exited, status=0/SUCCESS' });
  }
  for (const p of Object.values(st.procs)) if (p.service === svc.name) delete st.procs[p.pid];
  journal(st, svc.name, 'systemd', 1, `${unit}: Deactivated successfully.`);
  journal(st, svc.name, 'systemd', 1, `Stopped ${unit} - ${svc.description}.`);
  if (svc.mainPid) {
    if (svc.execStop) svc.lastMain = `${svc.mainPid} (code=exited, status=0/SUCCESS)`;
    else {
      // No ExecStop: systemd sends TERM to the main process. sshd exits cleanly; cron is killed by it.
      const status = svc.name === 'ssh' ? 'code=exited, status=0/SUCCESS' : 'code=killed, signal=TERM';
      svc.processes.push({ pid: svc.mainPid, what: `ExecStart=${svc.execStart}`, status });
      svc.lastMain = `${svc.mainPid} (${status})`;
    }
  }
  delete svc.mainPid;
  svc.active = 'inactive';
  svc.since = st.clock;
}

/** A service's process was killed from outside (kill, pkill). */
export function serviceProcGone(ctx: Ctx, p: Proc, sig: string) {
  const st = ctx.st;
  const svc = st.services[p.service!];
  if (!svc) return;
  if (p.kind === 'worker' && svc.active === 'active' && svc.mainPid && st.procs[svc.mainPid]) {
    // The nginx master starts a new worker at once.
    spawn(ctx, { args: 'nginx: worker process', comm: 'nginx', kind: 'worker', user: 'www-data', ppid: svc.mainPid, tty: '?', service: svc.name, vsz: 15008, rss: 3644 });
    return;
  }
  if (p.pid !== svc.mainPid) return;
  for (const q of Object.values(st.procs)) if (q.service === svc.name) delete st.procs[q.pid];
  const unit = `${svc.name}.service`;
  const signum = { KILL: 9, TERM: 15, INT: 2, HUP: 1, QUIT: 3 }[sig] ?? 15;
  if (sig === 'TERM' || sig === 'INT' || sig === 'QUIT' || sig === 'HUP') {
    journal(st, svc.name, 'systemd', 1, `${unit}: Deactivated successfully.`);
    svc.lastMain = `${p.pid} (code=exited, status=0/SUCCESS)`;
    svc.active = 'inactive';
  } else {
    journal(st, svc.name, 'systemd', 1, `${unit}: Main process exited, code=killed, status=${signum}/${sig}`);
    journal(st, svc.name, 'systemd', 1, `${unit}: Failed with result 'signal'.`);
    svc.lastMain = `${p.pid} (code=killed, signal=${sig})`;
    svc.active = 'failed';
    svc.result = 'signal';
  }
  delete svc.mainPid;
  svc.since = st.clock;
  collectUnit(svc);
  ctx.events.push({ type: 'serviceChanged', name: svc.name, active: svc.active, enabled: svc.enabled });
}

// ---------------------------------------------------------------------------
// nginx config

function nginxStamp(st: LinuxState): string {
  const d = new Date(st.clock * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

const NGINX_DIRECTIVES = new Set([
  'user', 'worker_processes', 'pid', 'error_log', 'include', 'events', 'worker_connections', 'http', 'sendfile', 'tcp_nopush', 'types_hash_max_size',
  'default_type', 'ssl_protocols', 'ssl_prefer_server_ciphers', 'access_log', 'gzip', 'server', 'listen', 'root', 'index', 'server_name', 'location',
  'try_files', 'return', 'proxy_pass', 'proxy_set_header', 'add_header', 'alias', 'autoindex', 'server_tokens', 'keepalive_timeout', 'client_max_body_size',
  'multi_accept', 'ssl_certificate', 'ssl_certificate_key', 'deny', 'allow', 'rewrite', 'error_page', 'expires', 'charset', 'types', 'upstream', 'gzip_types',
  'gzip_vary', 'fastcgi_pass', 'log_format',
]);

interface NginxProblem {
  lines(pid: number): string[];
  test(pid: number): string[];
}

/** The first problem `nginx -t` would report in /etc/nginx/nginx.conf and sites-enabled. */
export function nginxConfigProblem(st: LinuxState): NginxProblem | null {
  const files = ['/etc/nginx/sites-enabled/default', ...Object.keys(st.fs).filter((k) => k.startsWith('/etc/nginx/sites-enabled/') && k !== '/etc/nginx/sites-enabled/default').sort()];
  for (const shown of files) {
    const f = lookup(st, 'root', shown);
    if (!f.ok || f.node.type !== 'file') continue;
    const text = f.node.content ?? '';
    const lines = text.split('\n');
    let depth = 0;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]!.replace(/#.*$/, '').trim();
      if (!raw) continue;
      for (const stmt of raw.split(/(?<=[;{}])/)) {
        const s = stmt.trim();
        if (!s) continue;
        if (s === '}') {
          depth--;
          if (depth < 0) return problem(st, `unexpected "}" in ${shown}:${i + 1}`);
          continue;
        }
        const word = s.split(/\s+/)[0]!.replace(/[;{]$/, '');
        // nginx judges a directive once it reads its ";" or "{": at the end of the file first, it
        // says so (on the last line); an unknown name is reported on the line of its ";".
        let endLine = i;
        if (!/[;{]$/.test(s)) {
          endLine = -1;
          for (let j = i + 1; j < lines.length && endLine < 0; j++) if (/[;{}]/.test(lines[j]!.replace(/#.*$/, ''))) endLine = j;
          if (endLine < 0) return problem(st, `unexpected end of file, expecting ";" or "}" in ${shown}:${lines.length}`);
        }
        if (!NGINX_DIRECTIVES.has(word)) return problem(st, `unknown directive "${word}" in ${shown}:${endLine + 1}`);
        if (s.endsWith('{')) {
          depth++;
          continue;
        }
        if (!s.endsWith(';')) {
          // A missing semicolon: nginx reads on and complains about the next line's words.
          const parts = s.split(/\s+/);
          if (['root', 'index', 'server_name', 'listen', 'try_files'].includes(word) && i + 1 < lines.length) {
            if (word === 'root' || word === 'listen') return problem(st, `invalid number of arguments in "${word}" directive in ${shown}:${nextLine(lines, i) + 1}`);
            return problem(st, `directive "${word}" is not terminated by ";" in ${shown}:${nextLine(lines, i) + 1}`);
          }
          if (parts.length) return problem(st, `directive "${word}" is not terminated by ";" in ${shown}:${i + 1}`);
        }
        if (word === 'listen') {
          const port = /listen\s+(?:[\d.]+:)?(\d+)/.exec(s);
          if (!port) return problem(st, `invalid port in "${s.split(/\s+/)[1]?.replace(/;$/, '')}" of the "listen" directive in ${shown}:${i + 1}`);
        }
      }
    }
    if (depth > 0) return problem(st, `unexpected end of file, expecting "}" in ${shown}:${lines.length}`);
  }
  return null;
}

function nextLine(lines: string[], i: number): number {
  for (let j = i + 1; j < lines.length; j++) if (lines[j]!.replace(/#.*$/, '').trim()) return j;
  return i;
}

function problem(st: LinuxState, msg: string): NginxProblem {
  return {
    lines: (pid) => [`${nginxStamp(st)} [emerg] ${pid}#${pid}: ${msg}`, 'nginx: configuration file /etc/nginx/nginx.conf test failed'],
    test: (pid) => [`${nginxStamp(st)} [emerg] ${pid}#${pid}: ${msg}`, 'nginx: configuration file /etc/nginx/nginx.conf test failed'],
  };
}

/** The ports the enabled nginx sites ask for (read at start and reload, like the real nginx). */
export function nginxConfigPorts(st: LinuxState): number[] {
  const ports = new Set<number>();
  for (const [path, node] of Object.entries(st.fs)) {
    if (!path.startsWith('/etc/nginx/sites-enabled/')) continue;
    const target = node.type === 'link' ? st.fs[node.target!] : node;
    for (const m of (target?.content ?? '').replace(/#.*$/gm, '').matchAll(/listen\s+(?:[\d.]+:)?(\d+)/g)) ports.add(Number(m[1]));
  }
  return [...ports].sort((a, b) => a - b);
}

function portBusy(st: LinuxState, port: number, except: string): boolean {
  return st.net.listeners.some((l) => l.port === port) || (except !== 'nginx' && st.services.nginx?.active === 'active' && port === 80);
}

export function nginxProgram(ctx: Ctx, argv: string[], io: IO): number {
  const args = argv.slice(1);
  if (args.includes('-v')) {
    io.err('nginx version: nginx/1.26.3\n');
    return 0;
  }
  if (args.includes('-V')) {
    io.err('nginx version: nginx/1.26.3\n');
    return 0;
  }
  const isRoot = userByName(ctx.st, ctx.sh.user)?.uid === 0;
  if (args.includes('-t') || args.includes('-T')) {
    const pid = ctx.curPid;
    const prob = nginxConfigProblem(ctx.st);
    if (prob) {
      for (const l of prob.test(pid)) io.err(`${l}\n`);
      setExplain(ctx, 'linux.explain.nginxBad');
      return 1;
    }
    if (!isRoot) {
      io.err(`${nginxStamp(ctx.st)} [warn] ${pid}#${pid}: the "user" directive makes sense only if the master process runs with super-user privileges, ignored in /etc/nginx/nginx.conf:1\n`);
      io.err('nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\n');
      io.err(`${nginxStamp(ctx.st)} [emerg] ${pid}#${pid}: open() "/run/nginx.pid" failed (13: Permission denied)\n`);
      io.err('nginx: configuration file /etc/nginx/nginx.conf test failed\n');
      setExplain(ctx, 'linux.explain.nginxNeedsRoot');
      return 1;
    }
    io.err('nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\n');
    io.err('nginx: configuration file /etc/nginx/nginx.conf test is successful\n');
    setExplain(ctx, 'linux.explain.nginxOk');
    return 0;
  }
  if (args[0] === '-s' && args[1] === 'reload') {
    const svc = ctx.st.services.nginx;
    const pid = ctx.curPid;
    if (!isRoot && svc?.active === 'active' && svc.mainPid) {
      // Only root may signal the master process.
      io.err(`${nginxStamp(ctx.st)} [warn] ${pid}#${pid}: the "user" directive makes sense only if the master process runs with super-user privileges, ignored in /etc/nginx/nginx.conf:1\n`);
      io.err(`${nginxStamp(ctx.st)} [notice] ${pid}#${pid}: signal process started\n`);
      io.err(`${nginxStamp(ctx.st)} [alert] ${pid}#${pid}: kill(${svc.mainPid}, 1) failed (1: Operation not permitted)\n`);
      setExplain(ctx, 'linux.explain.nginxNeedsRoot');
      return 1;
    }
    if (!svc || svc.active !== 'active') {
      io.err(`${nginxStamp(ctx.st)} [notice] ${ctx.curPid}#${ctx.curPid}: signal process started\n`);
      io.err(`${nginxStamp(ctx.st)} [error] ${ctx.curPid}#${ctx.curPid}: invalid PID number "" in "/run/nginx.pid"\n`);
      return 1;
    }
    io.err(`${nginxStamp(ctx.st)} [notice] ${ctx.curPid}#${ctx.curPid}: signal process started\n`);
    if (!nginxConfigProblem(ctx.st)) svc.ports = nginxConfigPorts(ctx.st);
    return 0;
  }
  io.err('nginx: [alert] could not open error log file: open() "/var/log/nginx/error.log" failed (13: Permission denied)\n');
  return 1;
}

// ---------------------------------------------------------------------------
// systemctl

/** systemd's format_timestamp_relative. */
export function relTime(seconds: number): string {
  const d = Math.max(0, seconds);
  if (d >= 2 * 86400) return `${Math.floor(d / 86400)} days ago`;
  if (d >= 25 * 3600) return `1 day ${Math.floor((d - 86400) / 3600)}h ago`;
  if (d >= 6 * 3600) return `${Math.floor(d / 3600)}h ago`;
  if (d >= 3600) return `${Math.floor(d / 3600)}h ${Math.floor((d % 3600) / 60)}min ago`;
  if (d >= 300) return `${Math.floor(d / 60)}min ago`;
  if (d >= 60) return `${Math.floor(d / 60)}min ${d % 60}s ago`;
  if (d >= 1) return `${d}s ago`;
  return '3ms ago';
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function sdStamp(t: number): string {
  const d = new Date(t * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${DAYS[d.getUTCDay()]} ${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`;
}

export function journalStamp(t: number): string {
  const d = new Date(t * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${MONTHS[d.getUTCMonth()]} ${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function duration(s: number): string {
  if (s < 1) return '16ms';
  if (s < 60) return `${s}.${String((s * 137) % 1000).padStart(3, '0')}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min ${s % 60}.${String((s * 137) % 1000).padStart(3, '0')}s`;
  return `${Math.floor(m / 60)}h ${m % 60}min ${s % 60}.${String((s * 137) % 1000).padStart(3, '0')}s`;
}

function canReadJournal(st: LinuxState, user: string): boolean {
  if (userByName(st, user)?.uid === 0) return true;
  const gids = gidsOf(st, user);
  return ['adm', 'systemd-journal'].some((g) => {
    const grp = groupByName(st, g);
    return grp ? gids.includes(grp.gid) : false;
  });
}

function unitName(arg: string): string {
  return arg.replace(/\.service$/, '');
}

export function statusLines(st: LinuxState, svc: Service, user: string): { lines: { text: string; color?: 'green' | 'red' | 'yellow' | 'bold' | 'dim' }[]; code: number } {
  const out: { text: string; color?: 'green' | 'red' | 'yellow' | 'bold' | 'dim' }[] = [];
  const unit = `${svc.name}.service`;
  const dot = svc.active === 'active' ? '●' : svc.active === 'failed' ? '×' : '○';
  out.push({ text: `${dot} ${unit} - ${svc.description}`, color: svc.active === 'active' ? 'green' : svc.active === 'failed' ? 'red' : undefined as never });
  out.push({ text: `     Loaded: loaded (${svc.unitPath}; ${svc.enabled ? 'enabled' : 'disabled'}; preset: ${svc.preset})` });
  if (svc.gone && svc.active === 'inactive') {
    // Unloaded: systemd loads the unit file again just to answer, with nothing about its last run.
    out.push({ text: '     Active: inactive (dead)' });
    svc.docs.forEach((d, i) => out.push({ text: `${i === 0 ? '       Docs: ' : '             '}${d}` }));
    statusJournal(st, svc, user, out);
    return { lines: out, code: 3 };
  }
  const ago = relTime(st.clock - svc.since);
  if (svc.active === 'active') out.push({ text: `     Active: active (running) since ${sdStamp(svc.since)}; ${ago}`, color: 'green' });
  else if (svc.active === 'failed') out.push({ text: `     Active: failed (Result: ${svc.result ?? 'exit-code'}) since ${sdStamp(svc.since)}; ${ago}`, color: 'red' });
  else out.push({ text: `     Active: inactive (dead)${svc.startedAt !== undefined ? ` since ${sdStamp(svc.since)}; ${ago}` : ''}` });
  if (svc.active !== 'active' && svc.startedAt !== undefined) out.push({ text: `   Duration: ${duration(svc.since - svc.startedAt)}` });
  if (svc.startedAt !== undefined || svc.active !== 'inactive') out.push({ text: ` Invocation: ${svc.invocation}` });
  svc.docs.forEach((d, i) => out.push({ text: `${i === 0 ? '       Docs: ' : '             '}${d}` }));
  for (const p of svc.processes) out.push({ text: `    Process: ${p.pid} ${p.what} (${p.status})`, ...(p.status.includes('FAILURE') ? { color: 'red' as const } : {}) });
  if (svc.active === 'active' && svc.mainPid) {
    const procs = Object.values(st.procs).filter((p) => p.service === svc.name).sort((a, b) => a.pid - b.pid);
    out.push({ text: `   Main PID: ${svc.mainPid} (${st.procs[svc.mainPid]?.comm ?? svc.name})` });
    out.push({ text: `      Tasks: ${procs.length} (limit: 2275)` });
    out.push({ text: `     Memory: ${svc.memory} (peak: ${svc.memory})` });
    out.push({ text: `        CPU: ${20 + procs.length * 3}ms` });
    out.push({ text: `     CGroup: /system.slice/${unit}` });
    // systemd right-aligns the PIDs in the tree.
    const w = Math.max(...procs.map((p) => String(p.pid).length));
    procs.forEach((p, i) => {
      const shown = p.args.includes(' ') && p.service !== 'cron' ? `"${p.args}"` : p.args;
      out.push({ text: `             ${i === procs.length - 1 ? '└─' : '├─'}${String(p.pid).padStart(w)} ${shown}`, color: 'dim' });
    });
  } else if (svc.lastMain || (svc.active === 'failed' && svc.processes.length)) {
    if (svc.lastMain) out.push({ text: `   Main PID: ${svc.lastMain}` });
    // On cgroup v2 (a real Debian 13 server; seen in CI) systemd keeps the last run's peak memory and
    // CPU time, also after a start that failed in ExecStartPre.
    out.push({ text: `   Mem peak: ${svc.lastMain ? svc.memory : '1.6M'}` });
    out.push({ text: `        CPU: ${svc.lastMain ? 20 + svc.memory.length * 3 : 9}ms` });
  }
  statusJournal(st, svc, user, out);
  return { lines: out, code: svc.active === 'active' ? 0 : 3 };
}

/** The unit's last 10 journal lines under its status (a user without journal rights gets a warning). */
function statusJournal(st: LinuxState, svc: Service, user: string, out: { text: string; color?: 'green' | 'red' | 'yellow' | 'bold' | 'dim' }[]) {
  if (canReadJournal(st, user)) {
    const entries = st.journal.filter((e) => e.unit === svc.name).slice(-10);
    if (entries.length) out.push({ text: '' });
    for (const e of entries) {
      const c = prioColor(e);
      out.push(c ? { text: journalLine(st, e), color: c } : { text: journalLine(st, e) });
    }
  } else if (!svc.gone) out.push({ text: '' }, { text: 'Warning: some journal files were not opened due to insufficient permissions.' });
}

export function journalLine(st: LinuxState, e: JournalEntry): string {
  return `${journalStamp(e.time)} ${st.hostname} ${e.ident}[${e.pid}]: ${e.msg}`;
}

const DENIED = (verb: string, unit: string) => `Failed to ${verb} ${unit}: Access denied\nSee system logs and 'systemctl status ${unit}' for details.\n`;

export function systemctlProgram(ctx: Ctx, argv: string[], io: IO): number {
  const st = ctx.st;
  const args = argv.slice(1).filter((a) => a !== '--no-pager' && a !== '-l' && a !== '--full' && a !== '--now' && a !== '-q' && a !== '--quiet');
  const now = argv.includes('--now');
  const quiet = argv.includes('-q') || argv.includes('--quiet');
  const verb = args[0] ?? 'list-units';
  const units = args.slice(1).filter((a) => !a.startsWith('-'));
  const root = userByName(st, ctx.sh.user)?.uid === 0;
  const find = (u: string) => st.services[unitName(u)];
  switch (verb) {
    case 'status': {
      if (!units.length) {
        io.out(`● ${st.hostname}\n    State: running\n    Units: 212 loaded (incl. loaded aliases)\n     Jobs: 0 queued\n   Failed: 0 units\n    Since: ${sdStamp(bootTime(st))}; ${relTime(st.clock - bootTime(st))}\n  systemd: 257.9-1~deb13u1\n   CGroup: /\n`);
        return 0;
      }
      let code = 0;
      units.forEach((u, i) => {
        const svc = find(u);
        if (!svc) {
          io.err(`Unit ${unitName(u)}.service could not be found.\n`);
          code = 4;
          setExplain(ctx, 'linux.err.noUnit', { name: unitName(u) });
          return;
        }
        if (i > 0) io.out('\n');
        const s = statusLines(st, svc, ctx.sh.user);
        for (const l of s.lines) io.out(`${l.text}\n`, l.color);
        code = Math.max(code, s.code);
        setExplain(ctx, `linux.explain.status.${svc.active}`, { name: svc.name });
      });
      return code;
    }
    case 'is-active':
    case 'is-failed':
    case 'is-enabled': {
      let code = verb === 'is-failed' ? 1 : 0;
      let anyBad = false;
      for (const u of units) {
        const svc = find(u);
        let word: string;
        if (verb === 'is-enabled') word = svc ? (svc.enabled ? 'enabled' : 'disabled') : 'not-found';
        else word = svc ? svc.active : 'inactive';
        if (!quiet) io.out(`${word}\n`);
        if (verb === 'is-active' && word !== 'active') anyBad = true;
        if (verb === 'is-failed' && word === 'failed') code = 0;
        if (verb === 'is-enabled' && word !== 'enabled') anyBad = true;
      }
      if (verb === 'is-enabled' && units.some((u) => !find(u))) {
        io.err(`Failed to get unit file state for ${unitName(units.find((u) => !find(u))!)}.service: No such file or directory\n`);
      }
      if (verb !== 'is-failed') code = anyBad ? (verb === 'is-active' ? 3 : 1) : 0;
      const svc = units[0] ? find(units[0]) : undefined;
      setExplain(ctx, `linux.explain.${verb === 'is-enabled' ? 'isEnabled' : 'isActive'}`, { name: unitName(units[0] ?? ''), state: svc ? (verb === 'is-enabled' ? (svc.enabled ? 'enabled' : 'disabled') : svc.active) : 'inactive' });
      return code;
    }
    case 'start':
    case 'stop':
    case 'restart':
    case 'reload':
    case 'try-restart':
    case 'reload-or-restart': {
      if (!units.length) {
        io.err(`Too few arguments.\n`);
        return 1;
      }
      ctx.danger = true;
      for (const u of units) {
        const name = `${unitName(u)}.service`;
        if (!root) {
          io.err(DENIED(verb, name));
          setExplain(ctx, 'linux.err.needRoot', { cmd: `sudo systemctl ${verb} ${unitName(u)}` });
          return 4;
        }
        const svc = find(u);
        if (!svc) {
          io.err(`Failed to ${verb} ${name}: Unit ${name} not found.\n`);
          setExplain(ctx, 'linux.err.noUnit', { name: unitName(u) });
          return 5;
        }
        if (verb === 'stop') {
          stopService(ctx, svc);
          collectUnit(svc);
        }
        else if (verb === 'reload') {
          if (svc.active !== 'active') {
            io.err(`${svc.name}.service is not active, cannot reload.\n`);
            return 1;
          }
          if (svc.name === 'nginx' && nginxConfigProblem(st)) {
            // Real systemd 257 (checked 2026-11-01): a failed reload says only "failed", and nginx keeps
            // serving with the old settings.
            io.err(`Job for ${name} failed.\nSee "systemctl status ${name}" and "journalctl -xeu ${name}" for details.\n`);
            return 1;
          }
          journal(st, svc.name, 'systemd', 1, `Reloading ${name} - ${svc.description}...`);
          journal(st, svc.name, 'systemd', 1, `Reloaded ${name} - ${svc.description}.`);
          if (svc.name === 'nginx') svc.ports = nginxConfigPorts(st);
        } else {
          if (verb !== 'start' || svc.active !== 'active') {
            if (svc.active === 'active') stopService(ctx, svc);
            if (svc.active === 'failed') svc.active = 'inactive';
            if (!startService(ctx, svc)) {
              io.err(`Job for ${name} failed because the control process exited with error code.\nSee "systemctl status ${name}" and "journalctl -xeu ${name}" for details.\n`);
              ctx.events.push({ type: 'serviceChanged', name: svc.name, active: svc.active, enabled: svc.enabled });
              setExplain(ctx, 'linux.err.startFailed', { name: svc.name });
              return 1;
            }
          }
        }
        ctx.events.push({ type: 'serviceChanged', name: svc.name, active: svc.active, enabled: svc.enabled });
        setExplain(ctx, `linux.explain.${verb === 'try-restart' || verb === 'reload-or-restart' ? 'restart' : verb}`, { name: svc.name });
      }
      return 0;
    }
    case 'enable':
    case 'disable': {
      for (const u of units) {
        const svc = find(u);
        const name = `${unitName(u)}.service`;
        if (!svc) {
          io.err(`Failed to ${verb} unit: Unit ${name} does not exist\n`);
          return 1;
        }
        if (SYSV.has(svc.name)) {
          io.err(`Synchronizing state of ${name} with SysV service script with /usr/lib/systemd/systemd-sysv-install.\nExecuting: /usr/lib/systemd/systemd-sysv-install ${verb} ${svc.name}\n`);
        }
        if (!root) {
          if (verb === 'enable') io.err('Reload daemon failed: Access denied\nReload daemon failed: Access denied\nFailed to enable unit: Access denied\n');
          else io.err('Reload daemon failed: Access denied\nupdate-rc.d: error: Permission denied\n');
          setExplain(ctx, 'linux.err.needRoot', { cmd: `sudo systemctl ${verb} ${svc.name}` });
          return 1;
        }
        const link = `/etc/systemd/system/multi-user.target.wants/${name}`;
        if (verb === 'enable' && !svc.enabled) {
          io.err(`Created symlink '${link}' → '${svc.unitPath}'.\n`);
          st.fs[link] = { type: 'link', mode: 0o777, uid: 0, gid: 0, mtime: st.clock, target: svc.unitPath };
        }
        if (verb === 'disable' && svc.enabled) {
          io.err(`Removed '${link}'.\n`);
          delete st.fs[link];
        }
        svc.enabled = verb === 'enable';
        if (now) {
          if (verb === 'enable' && svc.active !== 'active') startService(ctx, svc);
          if (verb === 'disable') stopService(ctx, svc);
        }
        collectUnit(svc);
        ctx.events.push({ type: 'serviceChanged', name: svc.name, active: svc.active, enabled: svc.enabled });
        setExplain(ctx, `linux.explain.${verb}${now ? 'Now' : ''}`, { name: svc.name });
      }
      return 0;
    }
    case 'reset-failed': {
      for (const u of units.length ? units : Object.keys(st.services)) {
        const svc = find(u);
        if (!root) {
          io.err(`Failed to reset failed state of unit ${unitName(u)}.service: Access denied\n`);
          setExplain(ctx, 'linux.err.needRoot', { cmd: `sudo systemctl reset-failed ${unitName(u)}` });
          return 1;
        }
        if (!svc) continue;
        if (svc.active === 'failed') {
          svc.active = 'inactive';
          delete svc.result;
          collectUnit(svc);
          ctx.events.push({ type: 'serviceChanged', name: svc.name, active: svc.active, enabled: svc.enabled });
        }
      }
      return 0;
    }
    case 'daemon-reload':
      if (!root) {
        io.err('Failed to reload daemon: Access denied\n');
        return 1;
      }
      return 0;
    case 'list-units':
    case 'list-unit-files': {
      const stateFilter = argv.find((a) => a.startsWith('--state='))?.slice(8);
      const rows = BASE_UNITS.map((u) => {
        const svc = st.services[u.name.replace(/\.service$/, '')];
        const active = svc ? svc.active : 'active';
        const sub = svc ? (svc.active === 'active' ? 'running' : svc.active === 'failed' ? 'failed' : 'dead') : u.sub;
        return { unit: u.name, load: 'loaded', active, sub, desc: svc?.description ?? u.desc };
      }).filter((r) => r.sub !== 'dead' && (!stateFilter || r.sub === stateFilter || r.active === stateFilter));
      const w = Math.max(...rows.map((r) => r.unit.length), 4);
      io.out(`  ${'UNIT'.padEnd(w)} LOAD   ACTIVE SUB     DESCRIPTION\n`);
      for (const r of rows) io.out(`${r.active === 'failed' ? '●' : ' '} ${r.unit.padEnd(w)} ${r.load} ${r.active.padEnd(6)} ${r.sub.padEnd(7)} ${r.desc}\n`, r.active === 'failed' ? 'red' : undefined);
      io.out('\nLegend: LOAD   → Reflects whether the unit definition was properly loaded.\n        ACTIVE → The high-level unit activation state, i.e. generalization of SUB.\n        SUB    → The low-level unit activation state, values depend on unit type.\n\n');
      io.out(`${rows.length} loaded units listed.\n`);
      setExplain(ctx, 'linux.explain.listUnits', { n: rows.length });
      return 0;
    }
    case 'cat': {
      const svc = units[0] ? find(units[0]) : undefined;
      if (!svc) {
        io.err(`No files found for ${unitName(units[0] ?? '')}.service.\n`);
        return 1;
      }
      const f = lookup(st, ctx.sh.user, svc.unitPath);
      io.out(`# ${svc.unitPath}\n${f.ok ? (f.node.content ?? '') : ''}`);
      return 0;
    }
  }
  io.err(`Unknown command verb '${verb}'.\n`);
  return 1;
}

const BASE_UNITS = [
  { name: 'cron.service', sub: 'running', desc: '' },
  { name: 'dbus.service', sub: 'running', desc: 'D-Bus System Message Bus' },
  { name: 'getty@tty1.service', sub: 'running', desc: 'Getty on tty1' },
  { name: 'nginx.service', sub: 'running', desc: '' },
  { name: 'ssh.service', sub: 'running', desc: '' },
  { name: 'systemd-journald.service', sub: 'running', desc: 'Journal Service' },
  { name: 'systemd-logind.service', sub: 'running', desc: 'User Login Management' },
];

export function bootTime(st: LinuxState): number {
  return Number(st.fs['/proc/uptime']?.content?.split(' ')[0] ?? st.clock);
}

// ---------------------------------------------------------------------------
// journalctl

const PRIORITIES = ['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug'];

/** "err", "3" → 3; null when unknown. */
function priorityNumber(s: string): number | null {
  if (/^[0-7]$/.test(s)) return Number(s);
  const i = PRIORITIES.indexOf(s.toLowerCase());
  return i < 0 ? null : i;
}

export function journalctlProgram(ctx: Ctx, argv: string[], io: IO): number {
  const st = ctx.st;
  const args = argv.slice(1);
  let unit: string | undefined;
  let n: number | undefined;
  let follow = false;
  let explainCat = false;
  let grep: string | undefined;
  let quiet = false;
  let prio: [number, number] | undefined;
  let prioArg: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '-u' || a === '--unit') unit = unitName(args[++i] ?? '');
    else if (a.startsWith('--unit=')) unit = unitName(a.slice(7));
    else if (a === '-n' || a === '--lines') n = Number(args[++i] ?? 10);
    else if (a.startsWith('-n') && /^-n\d+$/.test(a)) n = Number(a.slice(2));
    else if (a.startsWith('--lines=')) n = Number(a.slice(8));
    else if (a === '-f' || a === '--follow') follow = true;
    else if (a === '-g' || a === '--grep') grep = args[++i];
    else if (a === '-p' || a === '--priority') prioArg = args[++i] ?? '';
    else if (a.startsWith('--priority=')) prioArg = a.slice(11);
    else if (/^-p\w+$/.test(a)) prioArg = a.slice(2);
    else if (a === '-q' || a === '--quiet') quiet = true;
    else if (/^-[xeufq]+$/.test(a)) {
      if (a.includes('x')) explainCat = true;
      if (a.includes('e') && n === undefined) n = 1000;
      if (a.includes('f')) follow = true;
      if (a.includes('q')) quiet = true;
      if (a.includes('u')) unit = unitName(args[++i] ?? '');
    } else if (a === '--no-pager' || a === '-b' || a === '--boot' || a === '-e' || a === '--pager-end') continue;
  }
  if (prioArg !== undefined) {
    // -p err shows err and worse (0–3); -p warning..err a range.
    const [from, to] = prioArg.includes('..') ? prioArg.split('..') : ['0', prioArg];
    const a = priorityNumber(from || '0');
    const b = priorityNumber(to || '7');
    if (a === null || b === null) {
      io.err(prioArg.includes('..') ? `Failed to parse log level range ${prioArg}\n` : `Unknown log level ${prioArg}\n`);
      return 1;
    }
    prio = [Math.min(a, b), Math.max(a, b)];
  }
  let entries = st.journal;
  const reader = canReadJournal(st, ctx.sh.user);
  if (!reader) {
    // Without adm or systemd-journal you only see your own journal file (your sudo lines, say).
    const uid = userByName(st, ctx.sh.user)?.uid ?? -1;
    entries = entries.filter((e) => (e.uid ?? 0) === uid);
    if (!quiet) io.err("Hint: You are currently not seeing messages from other users and the system.\n      Users in groups 'adm', 'systemd-journal' can see all messages.\n      Pass -q to turn off this notice.\n");
    if (!entries.length) {
      // No journal file of your own yet: none could be opened.
      io.err('No journal files were opened due to insufficient permissions.\n');
      setExplain(ctx, 'linux.err.journalNeedsRoot');
      return 1;
    }
  }
  entries = entries.filter((e) => (!unit || e.unit === unit) && (!prio || ((e.prio ?? 6) >= prio[0] && (e.prio ?? 6) <= prio[1])));
  if (grep) {
    const re = new RegExp(grep, 'i');
    entries = entries.filter((e) => re.test(e.msg));
  }
  if (follow && n === undefined) n = 10;
  if (n !== undefined) entries = entries.slice(-n);
  if (!entries.length) io.out('-- No entries --\n');
  for (const e of entries) {
    io.out(`${journalLine(st, e)}\n`, prioColor(e));
    if (explainCat) for (const l of catalog(e)) io.out(`${l}\n`, 'dim');
  }
  if (!reader) setExplain(ctx, 'linux.err.journalNeedsRoot');
  else setExplain(ctx, prio ? 'linux.explain.journalPrio' : unit ? 'linux.explain.journalUnit' : 'linux.explain.journal', { name: unit ?? '', n: entries.length, prio: prioArg ?? '' });
  if (follow && ctx.interactive) {
    spawn(ctx, { pid: ctx.curPid, args: argv.join(' '), comm: 'journalctl', kind: 'tail' });
    st.fg = { pid: ctx.curPid, cmd: argv.join(' ') };
  }
  return 0;
}

/** The `-x` explanation lines for the messages systemd's catalog explains. */
function catalog(e: JournalEntry): string[] {
  const head = (subject: string) => [`░░ Subject: ${subject}`, '░░ Defined-By: systemd', '░░ Support: https://www.debian.org/support', '░░ '];
  const unit = /(\S+\.service)/.exec(e.msg)?.[1];
  if (!unit || e.ident !== 'systemd') return [];
  if (/^Starting /.test(e.msg)) return [...head(`A start job for unit ${unit} has begun execution`), `░░ A start job for unit ${unit} has begun execution.`, '░░ ', '░░ The job identifier is 376.'];
  if (/^Started /.test(e.msg)) return [...head(`A start job for unit ${unit} has finished successfully`), `░░ A start job for unit ${unit} has finished successfully.`, '░░ ', '░░ The job identifier is 376.'];
  if (/^Stopped /.test(e.msg)) return [...head(`A stop job for unit ${unit} has finished`), `░░ A stop job for unit ${unit} has finished.`, '░░ ', '░░ The job identifier is 376 and the job result is done.'];
  if (/Control process exited/.test(e.msg)) return [...head('Unit process exited'), `░░ An ExecStartPre= process belonging to unit ${unit} has exited.`, '░░ ', "░░ The process' exit code is 'exited' and its exit status is 1."];
  if (/Failed with result/.test(e.msg)) {
    const r = /'([^']+)'/.exec(e.msg)?.[1] ?? 'exit-code';
    return [...head('Unit failed'), `░░ The unit ${unit} has entered the 'failed' state with result '${r}'.`];
  }
  if (/^Failed to start /.test(e.msg)) return [...head(`A start job for unit ${unit} has failed`), `░░ A start job for unit ${unit} has finished with a failure.`, '░░ ', '░░ The job identifier is 376 and the job result is failed.'];
  return [];
}

export { joinPath };
