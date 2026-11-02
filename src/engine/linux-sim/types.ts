// Core types for the Belajar Sendiri Linux simulator: a small Debian 13 server ("kedai").
// Pure TypeScript: no DOM, no React, no i18n strings. The state is plain data, so
// structuredClone copies it and lessons can save it.
import type { Line } from '../git-sim/types';

export type { Color, Line, Seg } from '../git-sim/types';

/** One file system entry. Paths are the keys of `LinuxState.fs` (absolute, no trailing slash). */
export interface FsNode {
  type: 'file' | 'dir' | 'link';
  /** Permission bits, with setuid (0o4000), setgid (0o2000) and sticky (0o1000), e.g. 0o644, 0o1777. */
  mode: number;
  uid: number;
  gid: number;
  /** Seconds since the epoch (the simulator's clock). */
  mtime: number;
  /** File text (files only). */
  content?: string;
  /** A size to show instead of the content's (programs in /usr/bin). */
  size?: number;
  /** Symlink target, as written (links only). */
  target?: string;
  /** Has an access control list (ls -l shows "+"), like /var/log/journal. */
  acl?: boolean;
}

export interface User {
  name: string;
  uid: number;
  gid: number;
  gecos: string;
  home: string;
  shell: string;
}

export interface Group {
  name: string;
  gid: number;
  members: string[];
}

export type ProcKind = 'system' | 'daemon' | 'worker' | 'shell' | 'sleep' | 'script' | 'tail' | 'ping' | 'top' | 'other';

export interface Proc {
  pid: number;
  ppid: number;
  user: string;
  /** The full command line, as `ps aux` shows it. */
  args: string;
  /** The short name (`ps -e`, `top`, `pkill`). */
  comm: string;
  /** S sleeping, R running, T stopped, Z zombie (+ s, l, + flags added when shown). */
  state: 'S' | 'R' | 'T' | 'Z';
  sessionLeader?: boolean;
  tty: string;
  start: number;
  vsz: number;
  rss: number;
  kind: ProcKind;
  /** The unit that owns it (nginx, cron, ssh …). */
  service?: string;
  /** Job number in the learner's shell. */
  job?: number;
  /** Ignores SIGTERM and SIGINT (a stuck script that traps them): only kill -9 ends it. */
  stubborn?: boolean;
  /** Clock time when it ends by itself (sleep N). */
  ends?: number;
  /** What it prints while running in the foreground (a snapshot). */
  prints?: string[];
}

export interface Job {
  id: number;
  pid: number;
  cmd: string;
  state: 'Running' | 'Stopped' | 'Done' | 'Terminated' | 'Killed';
  /** Shown once by the next prompt ("[1]+  Done …"), then removed. */
  notify?: boolean;
  /** Exit status of a finished job ("Exit 1"). */
  exit?: number;
}

export type ActiveState = 'active' | 'inactive' | 'failed';

export interface ServiceProcess {
  pid: number;
  what: string;
  /** "code=exited, status=0/SUCCESS" */
  status: string;
}

export interface Service {
  /** Unit name without ".service" (nginx, cron, ssh). */
  name: string;
  description: string;
  unitPath: string;
  docs: string[];
  enabled: boolean;
  preset: 'enabled' | 'disabled';
  active: ActiveState;
  since: number;
  /** When it last went from active to inactive (for "Duration:"). */
  startedAt?: number;
  mainPid?: number;
  /** Main PID line when it is not running: "120 (code=exited, status=0/SUCCESS)". */
  lastMain?: string;
  /** systemd unloaded it (inactive and not enabled): `status` shows no details of the last run. */
  gone?: boolean;
  invocation: string;
  result?: string;
  processes: ServiceProcess[];
  /** Static facts used to start it. */
  execStartPre?: string;
  execStart: string;
  execStop?: string;
  /** The real program name used in journal lines (nginx, cron, sshd). */
  ident: string;
  /** Memory shown by `systemctl status`, e.g. "4.7M". */
  memory: string;
  /** nginx: the ports it took when it last started or reloaded (a config change needs a reload). */
  ports?: number[];
}

export interface JournalEntry {
  time: number;
  /** The unit the entry belongs to ("nginx", "cron", "" for none). */
  unit: string;
  /** systemd, nginx, cron, sshd, CRON … */
  ident: string;
  pid: number;
  msg: string;
  /** syslog priority: 3 err, 4 warning, 5 notice, 6 info (journalctl -p, colours). */
  prio?: number;
  /** The sender's user id (_UID): a user without journal rights sees only their own lines. Default 0. */
  uid?: number;
}

export interface NetIface {
  index: number;
  name: string;
  mac: string;
  ipv4: string;
  prefix: number;
  mtu: number;
  up: boolean;
  loopback?: boolean;
}

/** A web page the simulated internet serves (curl) or a local site (nginx). */
export interface WebPage {
  status: number;
  body: string;
  headers?: Record<string, string>;
}

export interface RemoteHost {
  /** Reachable with ping / curl. */
  up: boolean;
  /** Round-trip time in ms for ping. */
  rtt?: number;
  /** TCP ports that answer (others refuse). Default [80, 443] when it has pages. */
  ports?: number[];
  /** path → page (port 80 and 443). */
  pages?: Record<string, WebPage>;
  /** Packets are silently dropped (a firewall): connections time out instead of being refused. */
  drops?: boolean;
}

export interface NetState {
  ifaces: NetIface[];
  gateway: string;
  /** The resolver in /etc/resolv.conf. */
  resolver: string;
  /** name → IPv4 addresses the DNS knows (outside world). */
  dns: Record<string, string[]>;
  /** CNAME records: name → target name. */
  cname: Record<string, string>;
  /** IPv4 → a remote machine. */
  hosts: Record<string, RemoteHost>;
  /** Programs listening on local TCP ports that are not services (python3 -m http.server …). */
  listeners: Listener[];
}

export interface Listener {
  port: number;
  /** 0.0.0.0 or 127.0.0.1 */
  addr: string;
  pid: number;
  prog: string;
  /** What it answers on GET (path → page). */
  pages?: Record<string, WebPage>;
}

export interface AptPackage {
  name: string;
  version: string;
  /** Short description (apt show / search). */
  summary: string;
  /** Download size in bytes, installed size in kB. */
  download: number;
  installedKb: number;
  /** Programs it adds to /usr/bin. */
  bins: string[];
  /** Other packages it pulls in. */
  depends?: string[];
}

export interface Shell {
  user: string;
  cwd: string;
  /** Shell variables (exported or not). */
  vars: Record<string, string>;
  exported: string[];
  /** A login shell: `exit` logs out of it (the first shell can't be left in the simulator). */
  login: boolean;
  /** How it started (sudo -i, su -, bash), for `exit` notes. */
  via?: string;
}

/** The terminal is busy with a program in the foreground (Ctrl+C / Ctrl+Z to get it back). */
export interface Foreground {
  pid: number;
  cmd: string;
}

export interface LinuxState {
  clock: number;
  hostname: string;
  fs: Record<string, FsNode>;
  users: User[];
  groups: Group[];
  /** Shell stack: [0] is the learner's login shell; sudo -i / su push more. */
  shells: Shell[];
  lastExit: number;
  procs: Record<number, Proc>;
  nextPid: number;
  jobs: Job[];
  services: Record<string, Service>;
  journal: JournalEntry[];
  apt: { updated: boolean; installed: Record<string, string> };
  net: NetState;
  fg: Foreground | null;
  /** Seed for generated ids (invocation ids, keys). */
  seed: number;
  /** Exit codes of scripts the learner ran: path → code. */
  scriptExits: Record<string, number>;
  aliases: Record<string, string>;
  /** Shell functions defined in the learner's shell: name → body source. */
  functions: Record<string, string>;
  /** Commands typed in this session (for `history`). */
  history: string[];
  /** A typed line waiting for the learner's answer (rm -i …). See ask.ts. */
  ask?: Ask | null;
}

/** A program asked a question at the terminal: the line is replayed from this state with the answers. */
export interface Ask {
  /** The typed line. */
  line: string;
  /** Answers typed so far. */
  answers: string[];
  /** What the terminal shows on the current line (the question), shown as the prompt. */
  prompt: string;
  /** How much of the line's output the screen already shows (characters). */
  shown: number;
  /** A password question: the terminal does not show the answer. */
  secret?: boolean;
}

/** An event for animations and the state picture. */
export type LinuxEvent =
  | { type: 'cwd'; path: string }
  | { type: 'fileWritten'; path: string }
  | { type: 'fileRemoved'; path: string }
  | { type: 'dirMade'; path: string }
  | { type: 'modeChanged'; path: string; mode: number }
  | { type: 'ownerChanged'; path: string; owner: string; group: string }
  | { type: 'userSwitched'; user: string }
  | { type: 'procStarted'; pid: number; cmd: string }
  | { type: 'procEnded'; pid: number; signal?: string }
  | { type: 'procStopped'; pid: number }
  | { type: 'serviceChanged'; name: string; active: ActiveState; enabled: boolean }
  | { type: 'packageInstalled'; name: string }
  | { type: 'packageRemoved'; name: string }
  | { type: 'request'; url: string; status: number | null }
  | { type: 'cleared' }
  | { type: 'error'; code: string };

export interface Explain {
  key: string;
  params?: Record<string, string | number>;
}

export interface LinuxResult {
  state: LinuxState;
  output: Line[];
  events: LinuxEvent[];
  /** Exit status 0. */
  ok: boolean;
  exitCode: number;
  explain?: Explain;
  /** Not a mistake even though the exit status is not 0 (grep found nothing, a test was false, Ctrl+C). */
  stopped?: boolean;
  /** The command deletes or overwrites things, or runs as root: the UI shows a "Careful" note. */
  danger?: boolean;
}
