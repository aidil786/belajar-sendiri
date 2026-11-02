// The practice server "kedai": a fresh Debian 13 VPS with nginx, cron and ssh, and the
// learner "you" (in the sudo group, passwordless sudo like a cloud server's first user).
import { BASE_FILES } from './base-files';
import { CPUS, hexId, journal, nginxConfigPorts } from './services';
import type { FsNode, Group, LinuxState, Proc, Service, User } from './types';

/** 2026-11-01 09:00:00 UTC: the simulator's clock starts here (booted 30 minutes earlier). */
export const START_CLOCK = Date.UTC(2026, 10, 1, 9, 0, 0) / 1000;
const BOOT = START_CLOCK - 30 * 60;
/** When the image's files were written (like a package build date). */
const OLD = Date.UTC(2025, 6, 12, 16, 58, 0) / 1000;
const INSTALL = Date.UTC(2026, 9, 28, 7, 41, 0) / 1000;
/** The sudo package's files (sudoers). */
const SUDO_PKG = Date.UTC(2026, 3, 11, 12, 21, 2) / 1000;

export const USERS: User[] = [
  { name: 'root', uid: 0, gid: 0, gecos: 'root', home: '/root', shell: '/bin/bash' },
  { name: 'daemon', uid: 1, gid: 1, gecos: 'daemon', home: '/usr/sbin', shell: '/usr/sbin/nologin' },
  { name: 'bin', uid: 2, gid: 2, gecos: 'bin', home: '/bin', shell: '/usr/sbin/nologin' },
  { name: 'sys', uid: 3, gid: 3, gecos: 'sys', home: '/dev', shell: '/usr/sbin/nologin' },
  { name: 'sync', uid: 4, gid: 65534, gecos: 'sync', home: '/bin', shell: '/bin/sync' },
  { name: 'games', uid: 5, gid: 60, gecos: 'games', home: '/usr/games', shell: '/usr/sbin/nologin' },
  { name: 'man', uid: 6, gid: 12, gecos: 'man', home: '/var/cache/man', shell: '/usr/sbin/nologin' },
  { name: 'lp', uid: 7, gid: 7, gecos: 'lp', home: '/var/spool/lpd', shell: '/usr/sbin/nologin' },
  { name: 'mail', uid: 8, gid: 8, gecos: 'mail', home: '/var/mail', shell: '/usr/sbin/nologin' },
  { name: 'news', uid: 9, gid: 9, gecos: 'news', home: '/var/spool/news', shell: '/usr/sbin/nologin' },
  { name: 'uucp', uid: 10, gid: 10, gecos: 'uucp', home: '/var/spool/uucp', shell: '/usr/sbin/nologin' },
  { name: 'proxy', uid: 13, gid: 13, gecos: 'proxy', home: '/bin', shell: '/usr/sbin/nologin' },
  { name: 'www-data', uid: 33, gid: 33, gecos: 'www-data', home: '/var/www', shell: '/usr/sbin/nologin' },
  { name: 'backup', uid: 34, gid: 34, gecos: 'backup', home: '/var/backups', shell: '/usr/sbin/nologin' },
  { name: 'list', uid: 38, gid: 38, gecos: 'Mailing List Manager', home: '/var/list', shell: '/usr/sbin/nologin' },
  { name: 'irc', uid: 39, gid: 39, gecos: 'ircd', home: '/run/ircd', shell: '/usr/sbin/nologin' },
  { name: '_apt', uid: 42, gid: 65534, gecos: '', home: '/nonexistent', shell: '/usr/sbin/nologin' },
  { name: 'nobody', uid: 65534, gid: 65534, gecos: 'nobody', home: '/nonexistent', shell: '/usr/sbin/nologin' },
  { name: 'systemd-network', uid: 998, gid: 998, gecos: 'systemd Network Management', home: '/', shell: '/usr/sbin/nologin' },
  { name: 'messagebus', uid: 996, gid: 996, gecos: 'System Message Bus', home: '/nonexistent', shell: '/usr/sbin/nologin' },
  { name: 'sshd', uid: 995, gid: 65534, gecos: 'sshd user', home: '/run/sshd', shell: '/usr/sbin/nologin' },
  { name: 'you', uid: 1000, gid: 1000, gecos: '', home: '/home/you', shell: '/bin/bash' },
];

const GROUP_LIST: [string, number, string[]?][] = [
  ['root', 0], ['daemon', 1], ['bin', 2], ['sys', 3], ['adm', 4], ['tty', 5], ['disk', 6], ['lp', 7], ['mail', 8], ['news', 9], ['uucp', 10],
  ['man', 12], ['proxy', 13], ['kmem', 15], ['dialout', 20], ['fax', 21], ['voice', 22], ['cdrom', 24], ['floppy', 25], ['tape', 26],
  ['sudo', 27, ['you']], ['audio', 29], ['dip', 30], ['www-data', 33], ['backup', 34], ['operator', 37], ['list', 38], ['irc', 39], ['src', 40],
  ['shadow', 42], ['utmp', 43], ['video', 44], ['sasl', 45], ['plugdev', 46], ['staff', 50], ['games', 60], ['users', 100], ['nogroup', 65534],
  ['systemd-journal', 999], ['systemd-network', 998], ['crontab', 997], ['messagebus', 996], ['_ssh', 101], ['you', 1000],
];

export const GROUPS: Group[] = GROUP_LIST.map(([name, gid, members]) => ({ name, gid, members: members ?? [] }));

/** Programs on the server: name → folder and size (sizes as on Debian 13 amd64). */
const BINS: Record<string, [string, number]> = {
  ls: ['/usr/bin', 151344], cat: ['/usr/bin', 44016], less: ['/usr/bin', 203464], more: ['/usr/bin', 39200], head: ['/usr/bin', 47968], tail: ['/usr/bin', 72784],
  mkdir: ['/usr/bin', 76128], rmdir: ['/usr/bin', 43952], touch: ['/usr/bin', 101008], cp: ['/usr/bin', 150880], mv: ['/usr/bin', 146704], rm: ['/usr/bin', 72720],
  ln: ['/usr/bin', 76144], find: ['/usr/bin', 228632], stat: ['/usr/bin', 88792], du: ['/usr/bin', 105504], basename: ['/usr/bin', 39824], dirname: ['/usr/bin', 39720],
  realpath: ['/usr/bin', 52112], grep: ['/usr/bin', 203152], wc: ['/usr/bin', 48080], sort: ['/usr/bin', 121072], uniq: ['/usr/bin', 48080], cut: ['/usr/bin', 48080],
  tr: ['/usr/bin', 52136], tee: ['/usr/bin', 39824], sed: ['/usr/bin', 121288], mawk: ['/usr/bin', 154440], seq: ['/usr/bin', 52112], xargs: ['/usr/bin', 64560],
  whoami: ['/usr/bin', 35664], id: ['/usr/bin', 48016], groups: ['/usr/bin', 35728], sudo: ['/usr/bin', 306456], su: ['/usr/bin', 84360], passwd: ['/usr/bin', 118168],
  chmod: ['/usr/bin', 72712], chown: ['/usr/bin', 76712], chgrp: ['/usr/bin', 72712], ps: ['/usr/bin', 146608], top: ['/usr/bin', 134296], kill: ['/usr/bin', 31104],
  killall: ['/usr/bin', 35216], pkill: ['/usr/bin', 35208], pgrep: ['/usr/bin', 35208], sleep: ['/usr/bin', 39776], systemctl: ['/usr/bin', 314424],
  journalctl: ['/usr/bin', 92392], date: ['/usr/bin', 105416], env: ['/usr/bin', 48208], printenv: ['/usr/bin', 35656], which: ['/usr/bin', 1013],
  hostname: ['/usr/bin', 22616], uname: ['/usr/bin', 39784], nproc: ['/usr/bin', 39752], free: ['/usr/bin', 27088], uptime: ['/usr/bin', 18832], df: ['/usr/bin', 97224],
  clear: ['/usr/bin', 14624], true: ['/usr/bin', 35560], false: ['/usr/bin', 35560], mktemp: ['/usr/bin', 43992], yes: ['/usr/bin', 35664], bash: ['/usr/bin', 1446024],
  dash: ['/usr/bin', 129784], crontab: ['/usr/bin', 51840], 'ssh-keygen': ['/usr/bin', 501536], ssh: ['/usr/bin', 1043984], scp: ['/usr/bin', 138936],
  apt: ['/usr/bin', 18800], 'apt-get': ['/usr/bin', 30160], dpkg: ['/usr/bin', 326904], curl: ['/usr/bin', 309984], ip: ['/usr/bin', 805208], ss: ['/usr/bin', 154376],
  echo: ['/usr/bin', 43432], printf: ['/usr/bin', 68008], pwd: ['/usr/bin', 43432], test: ['/usr/bin', 47528], '[': ['/usr/bin', 55720],
  ping: ['/usr/bin', 89768], getent: ['/usr/bin', 35888], dig: ['/usr/bin', 167832], host: ['/usr/bin', 139160],
  useradd: ['/usr/sbin', 162200], usermod: ['/usr/sbin', 125368], groupadd: ['/usr/sbin', 85184], userdel: ['/usr/sbin', 96016], nginx: ['/usr/sbin', 1293448],
  cron: ['/usr/sbin', 59496], sshd: ['/usr/sbin', 1006976], nologin: ['/usr/sbin', 22912],
};

const SYSTEM_DIRS: [string, number?][] = [
  ['/'], ['/boot'], ['/dev'], ['/etc'], ['/etc/apt'], ['/etc/cron.d'], ['/etc/cron.daily'], ['/etc/cron.hourly'], ['/etc/cron.monthly'], ['/etc/cron.weekly'],
  ['/etc/nginx'], ['/etc/nginx/conf.d'], ['/etc/nginx/modules-enabled'], ['/etc/nginx/sites-available'], ['/etc/nginx/sites-enabled'], ['/etc/skel'],
  ['/etc/ssh'], ['/etc/sudoers.d'], ['/etc/systemd'], ['/etc/systemd/system'], ['/etc/systemd/system/multi-user.target.wants'], ['/home'],
  ['/media'], ['/mnt'], ['/opt'], ['/proc', 0o555], ['/root', 0o700], ['/run'], ['/run/sshd', 0o755], ['/srv'], ['/sys', 0o555], ['/tmp', 0o1777],
  ['/usr'], ['/usr/bin'], ['/usr/games'], ['/usr/lib'], ['/usr/lib/systemd'], ['/usr/lib/systemd/system'], ['/usr/lib64'], ['/usr/local'],
  ['/usr/local/bin'], ['/usr/local/sbin'], ['/usr/sbin'], ['/usr/share'], ['/var'], ['/var/backups'], ['/var/cache'], ['/var/lib'], ['/var/lib/apt'],
  ['/var/lib/dpkg'], ['/var/log'], ['/var/log/apt'], ['/var/log/journal', 0o2755], ['/var/log/nginx'], ['/var/log/private', 0o700], ['/var/mail', 0o2775], ['/var/spool'], ['/var/spool/cron'],
  ['/var/spool/cron/crontabs', 0o1730], ['/var/tmp', 0o1777], ['/var/www'], ['/var/www/html'],
];

function dir(mode = 0o755, uid = 0, gid = 0, mtime = INSTALL): FsNode {
  return { type: 'dir', mode, uid, gid, mtime };
}

function file(content: string, mode = 0o644, uid = 0, gid = 0, mtime = INSTALL): FsNode {
  return { type: 'file', mode, uid, gid, mtime, content };
}

export const HOSTS_FILE = '127.0.0.1\tlocalhost\n127.0.1.1\tkedai\n';

function passwdText(users: User[]): string {
  return `${users.map((u) => `${u.name}:x:${u.uid}:${u.gid}:${u.gecos}:${u.home}:${u.shell}`).join('\n')}\n`;
}

/**
 * /etc/shadow as on Debian 13: the base system's accounts locked with "*", the ones packages and
 * useradd made later with "!*" / "!" (the learner has no password: sudo needs none). The day
 * numbers are when the image was built (sizes match a real one).
 */
function shadowText(users: User[]): string {
  return `${users
    .map((u) => {
      if (u.uid < 100 || u.uid === 65534) return `${u.name}:*:20753:0:99999:7:::`;
      if (u.name === 'systemd-network') return `${u.name}:!*:20758:::::1:`;
      if (u.uid < 1000) return `${u.name}:!*:20758::::::`;
      return `${u.name}:!:20758:0:99999:7:::`;
    })
    .join('\n')}\n`;
}

/** /etc/gshadow: "*" for the base groups, "!*" for system groups packages added, "!" for user groups. */
function gshadowText(groups: Group[]): string {
  return `${groups.map((g) => `${g.name}:${g.gid < 100 || g.gid === 65534 || g.gid === 100 ? '*' : g.gid >= 1000 || g.name === '_ssh' ? '!' : '!*'}::${g.members.join(',')}`).join('\n')}\n`;
}

function groupText(groups: Group[]): string {
  return `${groups.map((g) => `${g.name}:x:${g.gid}:${g.members.join(',')}`).join('\n')}\n`;
}

const SERVICE_FACTS: Omit<Service, 'active' | 'since' | 'invocation' | 'processes' | 'enabled'>[] = [
  { name: 'cron', description: 'Regular background program processing daemon', unitPath: '/usr/lib/systemd/system/cron.service', docs: ['man:cron(8)'], preset: 'enabled', execStart: '/usr/sbin/cron -f $EXTRA_OPTS', ident: 'cron', memory: '300K' },
  { name: 'ssh', description: 'OpenBSD Secure Shell server', unitPath: '/usr/lib/systemd/system/ssh.service', docs: ['man:sshd(8)', 'man:sshd_config(5)'], preset: 'enabled', execStartPre: '/usr/sbin/sshd -t', execStart: '/usr/sbin/sshd -D $SSHD_OPTS', ident: 'sshd', memory: '1.3M' },
  {
    name: 'nginx',
    description: 'A high performance web server and a reverse proxy server',
    unitPath: '/usr/lib/systemd/system/nginx.service',
    docs: ['man:nginx(8)'],
    preset: 'enabled',
    execStartPre: '/usr/sbin/nginx -t -q -g daemon on; master_process on;',
    execStart: '/usr/sbin/nginx -g daemon on; master_process on;',
    execStop: '/sbin/start-stop-daemon --quiet --stop --retry QUIT/5 --pidfile /run/nginx.pid',
    ident: 'nginx',
    memory: '4.7M',
  },
];

/** The machine at the moment the learner logs in. */
export function createMachine(): LinuxState {
  const fs: Record<string, FsNode> = {};
  for (const [p, mode] of SYSTEM_DIRS) fs[p] = dir(mode ?? 0o755, 0, p === '/var/spool/cron/crontabs' ? 997 : p === '/var/log/journal' ? 999 : p === '/var/mail' ? 8 : p === '/var/log/nginx' ? 4 : 0, p === '/tmp' ? BOOT : INSTALL);
  // Merged /usr: /bin, /sbin, /lib are links.
  fs['/bin'] = { type: 'link', mode: 0o777, uid: 0, gid: 0, mtime: OLD, target: 'usr/bin' };
  fs['/sbin'] = { type: 'link', mode: 0o777, uid: 0, gid: 0, mtime: OLD, target: 'usr/sbin' };
  fs['/lib'] = { type: 'link', mode: 0o777, uid: 0, gid: 0, mtime: OLD, target: 'usr/lib' };
  fs['/lib64'] = { type: 'link', mode: 0o777, uid: 0, gid: 0, mtime: OLD, target: 'usr/lib64' };
  for (const [name, [where, size]] of Object.entries(BINS)) {
    const setuid = name === 'sudo' || name === 'passwd' || name === 'su';
    fs[`${where}/${name}`] = { type: 'file', mode: setuid ? 0o4755 : name === 'crontab' ? 0o2755 : 0o755, uid: 0, gid: name === 'crontab' ? 997 : 0, mtime: OLD, size };
  }
  fs['/usr/bin/sh'] = { type: 'link', mode: 0o777, uid: 0, gid: 0, mtime: OLD, target: 'dash' };
  fs['/usr/bin/awk'] = { type: 'link', mode: 0o777, uid: 0, gid: 0, mtime: OLD, target: '/etc/alternatives/awk' };
  fs['/etc/alternatives'] = dir();
  fs['/etc/alternatives/awk'] = { type: 'link', mode: 0o777, uid: 0, gid: 0, mtime: OLD, target: '/usr/bin/mawk' };
  fs['/usr/bin/apt-cache'] = { type: 'file', mode: 0o755, uid: 0, gid: 0, mtime: OLD, size: 30160 };
  for (const [path, content] of Object.entries(BASE_FILES)) fs[path] = file(content, 0o644, 0, 0, path.startsWith('/etc/skel') ? OLD : INSTALL);
  fs['/etc/os-release'] = { type: 'link', mode: 0o777, uid: 0, gid: 0, mtime: OLD, target: '../usr/lib/os-release' };
  fs['/etc/hostname'] = file('kedai\n');
  fs['/etc/hosts'] = file(HOSTS_FILE);
  fs['/etc/resolv.conf'] = file('nameserver 10.0.0.2\n');
  fs['/etc/passwd'] = file(passwdText(USERS));
  fs['/etc/group'] = file(groupText(GROUPS));
  fs['/etc/shadow'] = file(shadowText(USERS), 0o640, 0, 42);
  fs['/etc/gshadow'] = file(gshadowText(GROUPS), 0o640, 0, 42);
  // Debian's sudoers files are read-only (0440), from the sudo package.
  fs['/etc/sudoers']!.mode = 0o440;
  fs['/etc/sudoers']!.mtime = SUDO_PKG;
  fs['/etc/sudoers.d/README']!.mode = 0o440;
  fs['/etc/sudoers.d/README']!.mtime = SUDO_PKG;
  // journald gives its folder an access list (ls -l shows drwxr-sr-x+).
  fs['/var/log/journal']!.acl = true;
  fs['/etc/sudoers.d/90-you'] = file('you ALL=(ALL) NOPASSWD:ALL\n', 0o440);
  fs['/etc/nginx/sites-enabled/default'] = { type: 'link', mode: 0o777, uid: 0, gid: 0, mtime: INSTALL, target: '/etc/nginx/sites-available/default' };
  for (const u of ['cron', 'ssh', 'nginx']) fs[`/etc/systemd/system/multi-user.target.wants/${u}.service`] = { type: 'link', mode: 0o777, uid: 0, gid: 0, mtime: INSTALL, target: `/usr/lib/systemd/system/${u}.service` };
  fs['/var/log/nginx/access.log'] = file('', 0o640, 33, 4);
  fs['/var/log/nginx/error.log'] = file('', 0o640, 33, 4);
  fs['/proc/uptime'] = file(`${BOOT} 0.00\n`, 0o444);
  // The learner's home.
  fs['/home/you'] = dir(0o700, 1000, 1000, START_CLOCK - 600);
  for (const n of ['.bashrc', '.profile', '.bash_logout']) fs[`/home/you/${n}`] = { ...fs[`/etc/skel/${n}`]!, uid: 1000, gid: 1000 };
  fs['/root/.bashrc'] = file(BASE_FILES['/etc/skel/.bashrc']!, 0o644, 0, 0, OLD);
  fs['/root/.profile'] = file('# ~/.profile: executed by Bourne-compatible login shells.\n\nif [ "$BASH" ]; then\n  if [ -f ~/.bashrc ]; then\n    . ~/.bashrc\n  fi\nfi\n\nmesg n 2> /dev/null || true\n', 0o644, 0, 0, OLD);

  const st: LinuxState = {
    clock: BOOT,
    hostname: 'kedai',
    fs,
    users: structuredClone(USERS),
    groups: structuredClone(GROUPS),
    shells: [
      {
        user: 'you',
        cwd: '/home/you',
        vars: { HOME: '/home/you', USER: 'you', LOGNAME: 'you', SHELL: '/bin/bash', PATH: '/usr/local/bin:/usr/bin:/bin:/usr/local/games:/usr/games', LANG: 'C.UTF-8', TERM: 'xterm-256color', PWD: '/home/you', HOSTNAME: 'kedai' },
        exported: ['HOME', 'USER', 'LOGNAME', 'SHELL', 'PATH', 'LANG', 'TERM', 'PWD'],
        login: true,
      },
    ],
    lastExit: 0,
    procs: {},
    nextPid: 2,
    jobs: [],
    services: {},
    journal: [],
    apt: { updated: false, installed: { nginx: '1.26.3-3+deb13u1', curl: '8.14.1-2+deb13u2', cron: '3.0pl1-197', 'openssh-server': '1:10.0p1-7' } },
    net: {
      ifaces: [
        { index: 1, name: 'lo', mac: '00:00:00:00:00:00', ipv4: '127.0.0.1', prefix: 8, mtu: 65536, up: true, loopback: true },
        { index: 2, name: 'eth0', mac: '52:54:00:4b:61:6e', ipv4: '10.0.0.5', prefix: 24, mtu: 1500, up: true },
      ],
      gateway: '10.0.0.1',
      resolver: '10.0.0.2',
      dns: { 'kedai.example': ['203.0.113.10'], 'api.kedai.example': ['203.0.113.11'], 'pasar.example': ['198.51.100.7'] },
      cname: { 'www.kedai.example': 'kedai.example' },
      hosts: {
        '10.0.0.1': { up: true, rtt: 0.4 },
        '10.0.0.2': { up: true, rtt: 0.5 },
        '203.0.113.10': { up: true, rtt: 12.3, pages: { '/': { status: 200, body: '<h1>Kedai Kancil</h1>\n<p>Open 8am to 10pm.</p>\n', headers: { 'Content-Type': 'text/html' } } } },
        '203.0.113.11': { up: true, rtt: 12.8, pages: { '/health': { status: 200, body: '{"ok":true}\n', headers: { 'Content-Type': 'application/json' } }, '/': { status: 404, body: '{"error":"not found"}\n', headers: { 'Content-Type': 'application/json' } } } },
        '198.51.100.7': { up: true, rtt: 31.5, pages: { '/': { status: 200, body: '<h1>Pasar</h1>\n', headers: { 'Content-Type': 'text/html' } } } },
      },
      listeners: [],
    },
    fg: null,
    seed: 20261101,
    scriptExits: {},
    aliases: { ls: 'ls --color=auto' },
    functions: {},
    history: [],
  };
  // Boot: systemd and friends, then the services, then the learner's ssh login.
  const sys: [string, string, string, number, number][] = [
    ['root', '/lib/systemd/systemd', 'systemd', 23076, 14048],
    ['root', '/usr/lib/systemd/systemd-journald', 'systemd-journal', 34536, 12580],
  ];
  st.nextPid = 1;
  for (const [user, args, comm, vsz, rss] of sys) {
    addProc(st, { user, args, comm, vsz, rss, ppid: st.nextPid === 1 ? 0 : 1, kind: 'system' }, true);
    st.nextPid = 28;
  }
  st.nextPid = 69;
  st.clock = BOOT + 1;
  for (const facts of SERVICE_FACTS) st.services[facts.name] = { ...facts, enabled: true, active: 'inactive', since: BOOT, invocation: hexId(st), processes: [] };
  bootService(st, 'cron');
  addProc(st, { user: 'messagebus', args: '/usr/bin/dbus-daemon --system --address=systemd: --nofork --nopidfile --systemd-activation --syslog-only', comm: 'dbus-daemon', vsz: 7960, rss: 4456, ppid: 1, kind: 'system' }, true);
  st.nextPid = 73;
  addProc(st, { user: 'root', args: '/usr/lib/systemd/systemd-logind', comm: 'systemd-logind', vsz: 18428, rss: 8504, ppid: 1, kind: 'system' }, true);
  st.nextPid = 84;
  bootService(st, 'ssh');
  addProc(st, { user: 'root', args: '/sbin/agetty -o -- \\u --noreset --noclear - linux', comm: 'agetty', vsz: 5176, rss: 2760, ppid: 1, kind: 'system', tty: 'tty1' }, true);
  st.nextPid = 117;
  bootService(st, 'nginx');
  // The learner logs in over ssh at START_CLOCK.
  st.clock = START_CLOCK - 5;
  st.nextPid = 1201;
  const priv = addProc(st, { user: 'root', args: 'sshd-session: you [priv]', comm: 'sshd-session', vsz: 19512, rss: 11240, ppid: st.services.ssh!.mainPid!, kind: 'system' }, true);
  const sess = addProc(st, { user: 'you', args: 'sshd-session: you@pts/0', comm: 'sshd-session', vsz: 19788, rss: 7064, ppid: priv, kind: 'system' }, false);
  addProc(st, { user: 'you', args: '-bash', comm: 'bash', vsz: 8216, rss: 5124, ppid: sess, kind: 'shell', tty: 'pts/0' }, true);
  journal(st, 'ssh', 'sshd-session', priv, 'Accepted publickey for you from 10.0.0.9 port 52114 ssh2: ED25519 SHA256:kancil-practice-key');
  st.nextPid = 1240;
  st.clock = START_CLOCK;
  return st;
}

function addProc(st: LinuxState, p: Partial<Proc> & { user: string; args: string; comm: string; kind: Proc['kind'] }, leader: boolean): number {
  const pid = st.nextPid++;
  st.procs[pid] = { pid, ppid: p.ppid ?? 1, user: p.user, args: p.args, comm: p.comm, state: 'S', tty: p.tty ?? '?', start: st.clock, vsz: p.vsz ?? 5000, rss: p.rss ?? 2000, kind: p.kind, ...(p.service ? { service: p.service } : {}), ...(leader ? { sessionLeader: true } : {}) };
  return pid;
}

/** Start a service while booting (no learner context). */
function bootService(st: LinuxState, name: string) {
  const svc = st.services[name]!;
  const unit = `${name}.service`;
  svc.invocation = hexId(st);
  if (name !== 'cron') journal(st, name, 'systemd', 1, `Starting ${unit} - ${svc.description}...`);
  svc.processes = [];
  if (svc.execStartPre) svc.processes.push({ pid: st.nextPid++, what: `ExecStartPre=${svc.execStartPre}`, status: 'code=exited, status=0/SUCCESS' });
  if (name === 'nginx') {
    svc.processes.push({ pid: st.nextPid++, what: `ExecStart=${svc.execStart}`, status: 'code=exited, status=0/SUCCESS' });
    const master = addProc(st, { user: 'root', args: 'nginx: master process /usr/sbin/nginx -g daemon on; master_process on;', comm: 'nginx', vsz: 14652, rss: 2496, kind: 'daemon', service: 'nginx' }, true);
    for (let i = 0; i < CPUS; i++) addProc(st, { user: 'www-data', args: 'nginx: worker process', comm: 'nginx', vsz: 15008, rss: 3644, kind: 'worker', service: 'nginx', ppid: master }, false);
    svc.mainPid = master;
    svc.ports = nginxConfigPorts(st);
    journal(st, name, 'systemd', 1, `Started ${unit} - ${svc.description}.`);
  } else if (name === 'cron') {
    const pid = addProc(st, { user: 'root', args: '/usr/sbin/cron -f', comm: 'cron', vsz: 4296, rss: 2796, kind: 'daemon', service: 'cron' }, true);
    svc.mainPid = pid;
    journal(st, name, 'systemd', 1, `Started ${unit} - ${svc.description}.`);
    journal(st, name, 'cron', pid, '(CRON) INFO (pidfile fd = 3)');
    journal(st, name, 'cron', pid, '(CRON) INFO (Running @reboot jobs)');
  } else {
    const pid = addProc(st, { user: 'root', args: 'sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups', comm: 'sshd', vsz: 11780, rss: 8220, kind: 'daemon', service: 'ssh' }, true);
    svc.mainPid = pid;
    journal(st, name, 'sshd', pid, 'Server listening on 0.0.0.0 port 22.');
    journal(st, name, 'sshd', pid, 'Server listening on :: port 22.');
    journal(st, name, 'systemd', 1, `Started ${unit} - ${svc.description}.`);
  }
  svc.active = 'active';
  svc.since = st.clock;
  svc.startedAt = st.clock;
}

export { BOOT };
