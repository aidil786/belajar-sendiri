// Truth check for the Linux engine (src/engine/linux-sim): every Linux scenario's `verify` lists
// run in the engine AND on a real Debian 13 machine, then the outputs, exit codes and the learner's
// home folder are compared.
//
// The real machine is a Docker container built from ./Dockerfile: Debian 13 with systemd as PID 1
// (so systemctl and journalctl are real), nginx, cron, ssh, sudo and the user "you". Each command
// list gets a fresh container; its commands run as "you" in one bash login session, so `cd` and
// `export` carry on like in a terminal. The container gets two CPUs (nginx starts one worker per CPU,
// like the engine's 2-CPU server) and its home folder on a volume (ext4-like link counts).
//
// Only what truly differs is normalised: times, dates, PIDs, ids, IP and MAC addresses, memory and
// CPU numbers, curl's progress meter (shown only when output is not a terminal), the order of `find`
// and `grep -r` (directory order on disk), `ls` columns (a terminal shows columns, a script one name
// per line), `ps` rows of the checking session itself, and IPv6 lines (the practice server has none).
// Scenarios with engine-only steps (dns, remote, bigFile, listen) or `engineOnly` run in the engine
// only (the unit tests check them).
//
// Run it under the shared Docker lock: flock <lock> npm run verify:linux. Names use the prefix
// VERIFY_LINUX_PREFIX (default "fl-vl-"); everything is removed afterwards. VERIFY_ONLY=linux-net
// checks only scenarios whose id starts with that text; TRUTH_SHARD=2/3 runs every third list.
// In a sandbox whose internet goes through an HTTPS proxy, the image build uses the proxy (and the
// CA in /root/.ccr/ca-bundle.crt when present); CI needs nothing.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allScenarios } from '../../src/content/courses/linux/scenarios/index';
import { APT_CATALOG, buildLinuxScenario, HOSTS_FILE, plain, run, usesEngineOnlySteps, type LinuxScenario, type LinuxState } from '../../src/engine/linux-sim/index';

const PREFIX = process.env.VERIFY_LINUX_PREFIX ?? 'fl-vl-';
const IMAGE = `${PREFIX}debian13:local`;
const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = '/tmp/fl-verify.sh';

function sh(args: string[], input?: string): { code: number; out: string; err: string } {
  const r = spawnSync(args[0]!, args.slice(1), { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? 1, out: r.stdout ?? '', err: r.stderr ?? '' };
}

function docker(args: string[], input?: string) {
  return sh(['docker', ...args], input);
}

function sleep(secs: number) {
  spawnSync('sleep', [String(secs)]);
}

// ---------------------------------------------------------------------------
// The real machine

function buildImage() {
  const args = ['build', '-q', '-t', IMAGE];
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (proxy) {
    args.push('--network', 'host', '--build-arg', `http_proxy=${proxy}`, '--build-arg', `https_proxy=${proxy}`);
    const ca = process.env.VERIFY_LINUX_CA ?? '/root/.ccr/ca-bundle.crt';
    if (existsSync(ca)) args.push('--secret', `id=proxyca,src=${ca}`);
  }
  args.push(HERE);
  const r = docker(args);
  if (r.code !== 0) throw new Error(`docker build failed:\n${r.err || r.out}`);
}

const cpus = Number(sh(['nproc']).out.trim()) || 1;

function cleanup(name: string) {
  docker(['rm', '-f', name]);
  docker(['volume', 'rm', '-f', `${name}-home`]);
}

function startMachine(name: string): void {
  cleanup(name);
  const args = ['run', '-d', '--name', name, '--hostname', 'kedai', '--privileged', '--cgroupns=private', '--tmpfs', '/run', '--tmpfs', '/run/lock', '-v', `${name}-home:/home/you`];
  if (cpus >= 2) args.push('--cpuset-cpus', '0-1');
  const r = docker([...args, IMAGE]);
  if (r.code !== 0) throw new Error(`docker run failed: ${r.err}`);
  for (let i = 0; i < 60; i++) {
    const s = docker(['exec', name, 'systemctl', 'is-system-running']).out.trim();
    if (s === 'running' || s === 'degraded') break;
    sleep(0.5);
  }
  for (let i = 0; i < 40; i++) {
    const s = docker(['exec', name, 'systemctl', 'is-active', 'nginx', 'cron', 'ssh']).out.trim().split('\n');
    if (s.every((x) => x === 'active')) break;
    sleep(0.5);
  }
  // A real server has long since moved its journal to /var/log/journal (where each user gets their
  // own file): wait for journald's flush, or journalctl as "you" would depend on timing.
  for (let i = 0; i < 40; i++) {
    if (docker(['exec', name, 'bash', '-c', 'systemctl is-active -q systemd-journal-flush && ls /var/log/journal/*/system.journal']).code === 0) break;
    sleep(0.5);
  }
  // Same /etc/hosts as the engine's server (Docker writes its own).
  root(name, 'cat > /etc/hosts', HOSTS_FILE);
  // A new volume takes the folder's files but not its mode: Debian makes homes 0700.
  root(name, 'chmod 700 /home/you');
}

// `docker exec` skips PAM, so its processes start with umask 0000. A real login on Debian 13 runs
// pam_umask (USERGROUPS_ENAB yes): root gets 0022, a user whose main group has their own name (you,
// www-data) gets 0002. Every shell the check starts sets that umask, like the engine's logins.
const ROOT_UMASK = 'umask 0022';
const USER_UMASK = 'umask 0002';

/** A root shell (setup steps, the check's own work), in /home/you like the engine's root steps. */
function root(name: string, cmd: string, input?: string) {
  return docker(['exec', '-i', '-w', '/home/you', name, 'bash', '-c', `${ROOT_UMASK}; ${cmd}`], input);
}

const YOU_ENV = ['-e', 'HOME=/home/you', '-e', 'USER=you', '-e', 'LOGNAME=you', '-e', 'LANG=C.UTF-8', '-e', 'TERM=dumb', '-e', 'SHELL=/bin/bash'];

function asYou(name: string, cmd: string) {
  return docker(['exec', '-u', 'you', '-w', '/home/you', ...YOU_ENV, name, 'bash', '--login', '-c', `${USER_UMASK}; ${cmd}`]);
}

function homePath(p: string): string {
  return p.startsWith('~/') ? `/home/you/${p.slice(2)}` : p;
}

function applySteps(name: string, sc: LinuxScenario): string[] {
  const problems: string[] = [];
  for (const step of sc.steps) {
    if (typeof step === 'string') {
      const r = asYou(name, step);
      if (r.code !== 0) problems.push(`real setup step failed: ${step}\n${r.out}${r.err}`);
    } else if ('root' in step) {
      const r = root(name, step.root);
      if (r.code !== 0) problems.push(`real setup step failed (root): ${step.root}\n${r.out}${r.err}`);
    } else if ('write' in step) {
      const path = homePath(step.write);
      const owner = step.owner ?? 'you';
      root(name, `cat > '${path}' && chown ${owner.includes(':') ? owner : `${owner}:${owner === 'you' ? 'you' : owner}`} '${path}' && chmod ${step.mode ?? '644'} '${path}'`, step.content);
    } else if ('install' in step) {
      // The catalog's .deb files wait in /opt/fl-debs (see the Dockerfile): no network needed.
      const pkg = APT_CATALOG.find((p) => p.name === step.install);
      const names = [...(pkg?.depends ?? []), step.install];
      const r = root(name, `cd /opt/fl-debs && dpkg -i ${names.map((n) => `$(ls ${n}_*.deb 2>/dev/null)`).join(' ')} >/dev/null`);
      if (r.code !== 0) problems.push(`real setup step failed (install): ${step.install}\n${r.out}${r.err}`);
    } else if ('process' in step) {
      const user = step.process.user ?? 'you';
      docker(['exec', '-d', '-u', user, '-w', '/home/you', ...YOU_ENV, name, 'bash', '-c', `${user === 'root' ? ROOT_UMASK : USER_UMASK}; exec ${step.process.cmd}`]);
      sleep(0.5);
    } else if ('wait' in step) sleep(Math.min(step.wait, 3));
  }
  return problems;
}

/** Run a command list as "you" in one login session; returns each command's output and exit code. */
function runReal(name: string, cwd: string, cmds: string[]): { out: string; code: number }[] {
  // The marker keeps $? for the next command (printf would reset it). A learner's interactive bash
  // keeps a history (Debian's ~/.bashrc sets HISTCONTROL=ignoreboth), so this script turns history
  // on too and leaves the marker lines out of it: `history` then lists the commands like a terminal.
  // After systemctl starts something, a learner reads the screen before typing again: wait a moment,
  // so `systemctl status` shows the started program, not systemd's "(cron)" placeholder.
  const settle = (c: string) => (/\bsystemctl\s+(start|restart|reload|try-restart|reload-or-restart|enable\s+--now)\b|\bnginx\s+-s\s+reload\b/.test(c) ? ' sleep 0.5;' : '');
  // journald writes what it is sent a moment later: before reading the journal, wait like a learner
  // would (the line keeps $? and stays out of history).
  const before = (c: string) => (/\bjournalctl\b|\bsystemctl\s+status\b/.test(c) ? ['__fl=$?; sleep 0.3; (exit $__fl)'] : []);
  const script = [
    'exec 2>&1',
    USER_UMASK,
    `cd ${cwd}`,
    'HISTCONTROL=ignoreboth',
    "HISTIGNORE='__fl=*'",
    'set -o history',
    ...cmds.flatMap((c) => [...before(c), c, `__fl=$?; printf '\\n__FL_END__ %s\\n' "$__fl";${settle(c)} (exit $__fl)`]),
  ].join('\n');
  root(name, `cat > ${SCRIPT} && chmod 644 ${SCRIPT}`, `${script}\n`);
  const r = docker(['exec', '-u', 'you', '-w', '/home/you', ...YOU_ENV, name, 'bash', '--login', SCRIPT]);
  const text = r.out + r.err;
  const out: { out: string; code: number }[] = [];
  const re = /\n__FL_END__ (\d+)\n/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    out.push({ out: text.slice(last, m.index), code: Number(m[1]) });
    last = m.index! + m[0].length;
  }
  return out;
}

/** The learner's home folder: path, type, mode, owner, group, size (files). */
function realHome(name: string): string[] {
  const r = root(name, "cd /home/you && find . -mindepth 1 -printf '%p %y %m %u %g %s\\n'");
  return r.out
    .split('\n')
    .filter(Boolean)
    .map((l) => l.replace(/^(\S+ d \d+ \S+ \S+) \d+$/, '$1 -'))
    .filter((l) => !IGNORED_HOME.test(l))
    .sort();
}

const IGNORED_HOME = /^\.\/(\.config|\.cache|\.lesshst|\.local|\.bash_history|\.sudo_as_admin_successful)(\/|\s)/;

function engineHome(st: LinuxState): string[] {
  const out: string[] = [];
  for (const [path, n] of Object.entries(st.fs)) {
    if (!path.startsWith('/home/you/')) continue;
    const rel = `./${path.slice('/home/you/'.length)}`;
    const user = st.users.find((u) => u.uid === n.uid)?.name ?? String(n.uid);
    const group = st.groups.find((g) => g.gid === n.gid)?.name ?? String(n.gid);
    const size = n.type === 'dir' ? '-' : n.type === 'link' ? String(n.target!.length) : String(n.size ?? new TextEncoder().encode(n.content ?? '').length);
    out.push(`${rel} ${n.type === 'dir' ? 'd' : n.type === 'link' ? 'l' : 'f'} ${(n.mode & 0o7777).toString(8)} ${user} ${group} ${size}`);
  }
  return out.filter((l) => !IGNORED_HOME.test(l)).sort();
}

// ---------------------------------------------------------------------------
// Normalising

const PROGRESS = /^\s*\d+\s+[\d.]+[kMG]?\s+\d+\s+[\d.]+[kMG]?\s+\d+\s+[\d.]+[kMG]?\s+[\d.]+[kMG]?\s+[\d.]+[kMG]?\s+[-:\d]+\s+[-:\d]+\s+[-:\d]+\s+[\d.]+[kMG]?/;

function progressFree(text: string): string {
  return text
    .split('\n')
    .filter((l) => !/^\s+% Total\s+% Received/.test(l) && !/^\s+Dload\s+Upload/.test(l))
    .map((l) => {
      let x = l;
      while (PROGRESS.test(x)) x = x.replace(PROGRESS, '');
      return x;
    })
    .filter((l, i, arr) => !(l === '' && arr[i - 1] === undefined))
    .join('\n');
}

/** The program a command line starts with (after sudo, env assignments). */
function progOf(cmd: string): string {
  const words = cmd.trim().split(/\s+/);
  let i = 0;
  while (i < words.length && (/^[A-Z_]+=/.test(words[i]!) || words[i] === 'sudo' || /^-u$/.test(words[i]!) || (words[i - 1] === '-u' && words[i - 2] === 'sudo'))) i++;
  return words[i] ?? '';
}

function common(text: string): string {
  return progressFree(text)
    .replace(/^(?:\/tmp\/fl-verify\.sh: line \d+|-bash): /gm, '-bash: ')
    .replace(/^bash: -c: line \d+: /gm, 'bash: -c: line N: ')
    .replace(/\bpid=\d+/g, 'pid=N')
    .replace(/\bkill\(\d+, /g, 'kill(N, ')
    // A carriage return before the newline is invisible on a terminal (ssh ends its lines with \r\n).
    .replace(/\r$/gm, '')
    .replace(/\b\d+#\d+:/g, 'N#N:')
    .replace(/^([A-Z][a-z]{2}) \d{2} \d{2}:\d{2}:\d{2} (\S+) (\S+?)\[\d+\]:/gm, 'MON DD TT $2 $3[N]:')
    .replace(/\b\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}\b/g, 'YYYY/MM/DD TT')
    .replace(/since [A-Z][a-z]{2} \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC; .*? ago/g, 'since T; X ago')
    .replace(/^ Invocation: [0-9a-f]{32}$/gm, ' Invocation: ID')
    .replace(/^(\s+Tasks: )\d+ \(limit: \d+\)$/gm, '$1N')
    .replace(/^(\s+Memory: ).*$/gm, '$1M')
    // Only cgroup v2 hosts (CI, a real server) print the last run's peak; a cgroup v1 host (this sandbox) can't.
    .replace(/^\s+Mem peak: .*\n?/gm, '')
    .replace(/^\s+CPU: .*\n?/gm, '')
    .replace(/^(\s+Duration: ).*$/gm, '$1D')
    .replace(/(Process: )\d+/g, '$1N')
    .replace(/(Main PID: )\d+/g, '$1N')
    .replace(/([├└]─) *\d+/g, "$1N")
    // nginx starts one worker per CPU of the host: compare one worker line.
    .replace(/^(\s+)[├└]─N "nginx: worker process"$(?:\n\s+[├└]─N "nginx: worker process")*/gm, "$1└─N \"nginx: worker process\"")
    // sshd's goodbye and systemd's "Stopping" land in the same millisecond, in either order.
    .replace(/^MON DD TT kedai sshd\[N\]: Received signal 15; terminating\.\n?/gm, '')
    // Only a host with IPv6 (CI, a real server) also listens on ::; this sandbox's kernel has no IPv6.
    .replace(/^MON DD TT kedai sshd\[N\]: Server listening on :: port 22\.\n?/gm, '')
    // The checking session is not an ssh login.
    .replace(/^MON DD TT kedai sshd-session\[N\]: Accepted publickey .*\n?/gm, "")
    .replace(/^(Date|Last-Modified|ETag): .*$/gm, '$1: X')
    .replace(/^< (Date|Last-Modified|ETag): .*$/gm, '< $1: X')
    .replace(/after \d+ ms/g, 'after N ms')
    .replace(/^\* (IPv6: .*|Trying \[.*|connect to ::1.*|Immediate connect fail.*)\n?/gm, '')
    .replace(/^[{}] \[\d+ bytes data\]\n?/gm, '')
    .replace(/time=[\d.]+ ms/g, 'time=T ms')
    .replace(/, time \d+ms/g, ', time Tms')
    .replace(/^rtt min\/avg\/max\/mdev = .*$/gm, 'rtt X')
    // Shown only once journald has flushed the system journal to disk (a fresh container may not have).
    .replace(/\n*^Warning: some journal files were not opened due to insufficient permissions\.$/gm, '')
    // sudo's PAM line names the login user; the check's docker exec session has no login name.
    .replace(/ by \S*\(uid=(\d+)\)$/gm, ' by (uid=$1)')
    .replace(/\n+$/, '');
}

const LS_LONG = /^([-dlcbps][rwxsStT-]{9}[+.]?)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+([A-Z][a-z]{2}\s+\d+\s+(?:\d{4}|\d\d:\d\d))\s(.*)$/;
const IP = /\b(?!127\.)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;

function shaped(cmd: string, raw: string): string {
  let t = common(raw);
  const prog = progOf(cmd);
  const pipeline = cmd.includes('|');
  // ls -l rows: dates masked; folder link counts depend on the file system.
  t = t
    .split('\n')
    .map((l) => {
      const m = LS_LONG.exec(l);
      if (!m) return l;
      return `${m[1]} ${m[1]!.startsWith('d') ? 'N' : m[2]} ${m[3]} ${m[4]} ${m[5]} DATE ${m[7]}`;
    })
    .join('\n');
  if (prog === 'ls' && !/\s-\w*l/.test(cmd) && !pipeline) {
    // A terminal shows columns; a script one name per line. Compare the names.
    return t
      .split('\n')
      .flatMap((l) => (l.endsWith(':') ? [l] : l.split(/\s{2,}|\s(?=\S)/)))
      .filter(Boolean)
      .sort()
      .join('\n');
  }
  if (prog === 'find' && !pipeline) {
    // Outside your own folders the real disk has many more folders you may not read (/proc, /run,
    // systemd's private folders): their "Permission denied" lines are left out (the exit code stays).
    const start = cmd.trim().split(/\s+/)[1] ?? '.';
    const system = start.startsWith('/') && !/^\/(home\/you|tmp)(\/|$)/.test(start);
    return t
      .split('\n')
      .filter((l) => !(system && /^find: ‘.*’: Permission denied$/.test(l)))
      .sort()
      .join('\n');
  }
  if (prog === 'grep' && /\s-\w*r/.test(cmd) && !pipeline) return t.split('\n').sort().join('\n');
  // A folder's entries come in disk order (rm -r, cp -r, chmod -R, chown -R with -v or -c): compare as a set.
  if (['rm', 'cp', 'chmod', 'chown', 'chgrp'].includes(prog) && /\s-\w*[rR]/.test(cmd) && /\s-\w*[vc]|--verbose|--changes/.test(cmd) && !/\s-\w*[iI]/.test(cmd) && !pipeline) {
    return t.split('\n').sort().join('\n');
  }
  if (prog === 'ss') {
    // ss walks the kernel's socket table: the row order changes from boot to boot.
    const rows = t
      .split('\n')
      .filter((l) => !/\[::\]|\s\*:\S+\s/.test(l))
      .map((l) => l.replace(/\s+/g, ' ').trim().replace(/users:\((.*)\)$/, (_m, list: string) => `users:(${[...new Set(list.split(/,(?=\()/))].join(',')})`));
    return [rows[0] ?? '', ...rows.slice(1).sort()].join('\n');
  }
  if (prog === 'ps' && !/\baux\b/.test(cmd) && !/\s-\w*[ef]/.test(cmd) && !pipeline) {
    // ps, ps -u you, ps -C nginx: PIDs masked; the check's shell has no terminal (TTY "?", the
    // learner's is pts/0) and no ssh login; nginx starts one worker per host CPU (one row kept).
    const rows = t.split('\n').map((l) => l.replace(/^\s*\d+\s+(pts\/\d+)/, (_m, tty: string) => `N ${'?'.padEnd(tty.length)}`).replace(/^\s*\d+ /, 'N ').replace(/\s+/g, ' '));
    return rows.filter((r, i) => !/ sshd-session$/.test(r) && r !== rows[i - 1]).join('\n');
  }
  if (prog === 'ps' && /\baux\b/.test(cmd) && !pipeline) {
    // USER and COMMAND of each process; the checking session (and one row per extra nginx worker) left out.
    const rows = t.split('\n').slice(1).map((l) => {
      const f = l.trim().split(/\s+/);
      return `${f[0]} ${f.slice(10).join(' ')}`;
    });
    return [...new Set(rows.filter((r) => !/ (-bash|bash --login|ps aux|sshd-session:)/.test(r)))].sort().join('\n');
  }
  if (prog === 'pgrep') return t.replace(/\d+/g, 'N');
  if (prog === 'ip') {
    return t
      .split('\n')
      .filter((l) => /^\d+: |^\s+inet |^default|^\d+\.|^\S+\s+(UP|UNKNOWN|DOWN)/.test(l))
      .map((l) => l.replace(/@if\d+/g, '').replace(IP, 'IP').replace(/\/\d+/g, '/P').replace(/<[^>]+>.*$/, '').replace(/\s+/g, ' ').replace(/ (dynamic|noprefixroute)/g, '').trim().replace(/ ::1\/P$/, ''))
      .join('\n');
  }
  if (prog === 'hostname' && /-I/.test(cmd)) return t.replace(IP, 'IP');
  if (prog === 'ping') return t.replace(IP, 'IP');
  return t;
}

// ---------------------------------------------------------------------------

function verifyList(sc: LinuxScenario, cmds: string[], idx: number): string[] {
  const problems: string[] = [];
  // Engine
  let st: LinuxState;
  try {
    st = buildLinuxScenario(sc);
  } catch (e) {
    return [`engine: ${(e as Error).message}`];
  }
  const cwd = st.shells[0]!.cwd;
  const eng: { out: string; code: number }[] = [];
  for (const c of cmds) {
    // The check's real shell has no terminal on stdin (docker exec): run the engine the same way.
    const r = run(st, c, { tty: false });
    st = r.state;
    if (st.fg) {
      problems.push(`engine: "${c}" keeps the terminal busy (verify lists must finish)`);
      return problems;
    }
    eng.push({ out: plain(r.output), code: r.exitCode });
  }
  // Real
  const name = `${PREFIX}${sc.id}-${idx}`.toLowerCase().replace(/[^a-z0-9_.-]/g, '-');
  try {
    startMachine(name);
    problems.push(...applySteps(name, sc));
    const real = runReal(name, cwd, cmds);
    // The engine's calendar day is 2026-11-01; the real machine's is today. Dates a script puts in
    // file names (date +%F, +%Y%m%d) become the engine's day before comparing.
    const realDay = docker(['exec', name, 'date', '-u', '+%F']).out.trim();
    const engDay = new Date(st.clock * 1000).toISOString().slice(0, 10);
    const sameDay = (t: string) => (realDay && realDay !== engDay ? t.split(realDay).join(engDay).split(realDay.replace(/-/g, '')).join(engDay.replace(/-/g, '')) : t);
    if (real.length !== cmds.length) problems.push(`real: ran ${real.length} of ${cmds.length} commands (a command ended the session?)`);
    cmds.forEach((c, i) => {
      const e = eng[i]!;
      const r = real[i];
      if (!r) return;
      if (e.code !== r.code) problems.push(`exit code of "${c}" differs: engine ${e.code}, debian ${r.code}`);
      const a = shaped(c, e.out);
      const b = shaped(c, sameDay(r.out));
      if (a !== b) problems.push(`output of "${c}" differs\n      engine: ${JSON.stringify(a)}\n      debian: ${JSON.stringify(b)}`);
    });
    const ha = engineHome(st);
    const hb = realHome(name).map(sameDay).sort();
    if (JSON.stringify(ha) !== JSON.stringify(hb)) {
      const onlyE = ha.filter((x) => !hb.includes(x));
      const onlyR = hb.filter((x) => !ha.includes(x));
      problems.push(`home folder differs\n      engine only: ${JSON.stringify(onlyE)}\n      debian only: ${JSON.stringify(onlyR)}`);
    }
  } finally {
    if (!process.env.VERIFY_LINUX_KEEP) cleanup(name);
  }
  return problems;
}

const v = docker(['version', '--format', '{{.Server.Version}}']);
if (v.code !== 0) {
  console.error(`✗ No Docker daemon: ${v.err.trim()}`);
  process.exit(1);
}
console.log(`Docker ${v.out.trim()}; building the Debian 13 truth image (${IMAGE}) …`);
buildImage();
const ver = docker(['run', '--rm', '--entrypoint', 'cat', IMAGE, '/etc/debian_version']);
console.log(`Real machine: Debian ${ver.out.trim()} with systemd, nginx, cron, ssh (${cpus >= 2 ? '2 CPUs' : `${cpus} CPU`})`);

const SHARD = /^(\d+)\/(\d+)$/.exec(process.env.TRUTH_SHARD ?? '');
let listIndex = 0;
const mine = () => !SHARD || listIndex++ % Number(SHARD[2]) === Number(SHARD[1]) - 1;

const only = process.env.VERIFY_ONLY;
const chosen = allScenarios.filter((s) => !only || s.id.startsWith(only));
const failures: string[] = [];
let count = 0;
for (const sc of chosen) {
  if (sc.engineOnly || usesEngineOnlySteps(sc)) {
    console.log(`- ${sc.id}: engine only (${sc.engineOnly ?? 'engine-only steps'}); checked by the unit tests`);
    continue;
  }
  for (const [i, cmds] of (sc.verify ?? []).entries()) {
    if (!mine()) continue;
    count++;
    const problems = verifyList(sc, cmds, i);
    if (problems.length) failures.push(`✗ ${sc.id} #${i + 1}: [${cmds.join(' ; ')}]\n    - ${problems.join('\n    - ')}`);
    else console.log(`✓ ${sc.id} #${i + 1}: ${cmds.length} commands`);
  }
}
if (failures.length) {
  console.error(`\n${failures.join('\n\n')}\n\n✗ ${failures.length} of ${count} command lists differ from real Debian 13.`);
  process.exit(1);
}
console.log(`✓ ${count} command lists match real Debian 13.`);

