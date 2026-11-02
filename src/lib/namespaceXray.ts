// Pure logic for NamespaceXray: a container is a normal Linux process with switches on.
// Namespaces change what it can SEE; cgroups limit what it can USE.
// Facts (man7.org namespaces(7), cgroups(7), unshare(1); docs.docker.com):
//   - Linux has 8 namespace types: cgroup, IPC, network, mount, PID, time, user, UTS.
//   - docker run gives each container new PID, mount, network, UTS and IPC namespaces
//     (and a cgroup namespace on cgroup v2). User namespaces only in rootless mode or with
//     userns-remap, so by default root inside is root on the host.
//   - A new PID namespace makes the process PID 1, but ps reads /proc: Docker also mounts a
//     fresh /proc in the new mount namespace (like `unshare --pid --fork --mount-proc`).
//   - Docker always puts a container in its own cgroup; limits apply only when asked:
//     --memory (memory.max), --cpus (cpu.max), --pids-limit (pids.max).

export type NsSwitch = 'pid' | 'mnt' | 'net' | 'uts' | 'ipc' | 'user';
export type CgSwitch = 'memory' | 'cpu' | 'pids';
export type Switch = NsSwitch | CgSwitch;

export const NAMESPACES: NsSwitch[] = ['pid', 'mnt', 'net', 'uts', 'ipc', 'user'];
export const CGROUPS: CgSwitch[] = ['memory', 'cpu', 'pids'];
export const SWITCHES: Switch[] = [...NAMESPACES, ...CGROUPS];
/** What `docker run` turns on by default (besides its own cgroup). */
export const DOCKER_DEFAULT: NsSwitch[] = ['pid', 'mnt', 'net', 'uts', 'ipc'];

/** How you would switch it on yourself: the unshare(1) flag, or the docker run flag for a limit. */
export const HOW: Record<Switch, string> = {
  pid: 'unshare --pid --fork --mount-proc',
  mnt: 'unshare --mount',
  net: 'unshare --net',
  uts: 'unshare --uts',
  ipc: 'unshare --ipc',
  user: 'unshare --user --map-root-user',
  memory: 'docker run --memory 512m',
  cpu: 'docker run --cpus 1.5',
  pids: 'docker run --pids-limit 100',
};

/** The cgroup v2 file each limit writes, with its value. */
export const CGROUP_FILE: Record<CgSwitch, string> = {
  memory: 'memory.max = 536870912',
  cpu: 'cpu.max = 150000 100000',
  pids: 'pids.max = 100',
};

export type Question = 'hideProcesses' | 'ownHostname' | 'ownNetwork' | 'ownFiles' | 'privateIpc' | 'fakeRoot' | 'capMemory' | 'capCpu' | 'capProcesses';
export const ANSWER: Record<Question, Switch> = {
  hideProcesses: 'pid',
  ownHostname: 'uts',
  ownNetwork: 'net',
  ownFiles: 'mnt',
  privateIpc: 'ipc',
  fakeRoot: 'user',
  capMemory: 'memory',
  capCpu: 'cpu',
  capProcesses: 'pids',
};

export type XrayTask = { type: 'all' } | { type: 'docker' } | { type: 'find'; what: Question } | { type: 'turnOn'; switches: Switch[] };

export interface ProcessRow {
  pid: number;
  cmd: string;
  mine: boolean;
}

export interface XrayView {
  processes: ProcessRow[];
  /** PID namespace on but no fresh /proc yet: ps would still list the laptop's processes. */
  procNote: boolean;
  hostname: string;
  interfaces: { name: string; addr: string }[];
  files: string[];
  ipc: string[];
  uid: { inside: number; outside: number };
  limits: { memory: string | null; cpu: string | null; pids: number | null };
}

const HOST_PROCESSES: ProcessRow[] = [
  { pid: 1, cmd: '/sbin/init', mine: false },
  { pid: 412, cmd: 'sshd', mine: false },
  { pid: 655, cmd: 'containerd', mine: false },
  { pid: 701, cmd: 'dockerd', mine: false },
  { pid: 1880, cmd: 'firefox', mine: false },
  { pid: 4242, cmd: 'node server.js', mine: true },
];

export const HOST_NAME = 'aina-laptop';
export const CONTAINER_NAME = '3f9c2a7b1d04';

export function view(on: ReadonlySet<Switch>): XrayView {
  return {
    processes: on.has('pid') ? [{ pid: 1, cmd: 'node server.js', mine: true }] : HOST_PROCESSES,
    procNote: on.has('pid') && !on.has('mnt'),
    hostname: on.has('uts') ? CONTAINER_NAME : HOST_NAME,
    interfaces: on.has('net')
      ? [
          { name: 'lo', addr: '127.0.0.1' },
          { name: 'eth0', addr: '172.17.0.2' },
        ]
      : [
          { name: 'lo', addr: '127.0.0.1' },
          { name: 'wlan0', addr: '192.168.1.20' },
          { name: 'docker0', addr: '172.17.0.1' },
        ],
    files: on.has('mnt') ? ['/app/server.js', '/usr/local/bin/node', '/etc/alpine-release'] : ['/home/aina/kedai/server.js', '/home/aina/.ssh/id_ed25519', '/home/aina/Photos/', '/var/lib/docker/'],
    ipc: on.has('ipc') ? [] : ['firefox', 'pulseaudio'],
    uid: { inside: 0, outside: on.has('user') ? 100000 : 0 },
    limits: {
      memory: on.has('memory') ? '512 MB' : null,
      cpu: on.has('cpu') ? '1.5' : null,
      pids: on.has('pids') ? 100 : null,
    },
  };
}

/** Docker's default set is on: it sees the world like a container does. */
export function isContainer(on: ReadonlySet<Switch>): boolean {
  return DOCKER_DEFAULT.every((s) => on.has(s));
}

/** Is the task done? For `all`: every switch on show (`shown`, default all nine). */
export function taskDone(task: XrayTask, on: ReadonlySet<Switch>, flipped: Switch | null, shown: readonly Switch[] = SWITCHES): boolean {
  if (task.type === 'all') return shown.every((s) => on.has(s));
  if (task.type === 'docker') return isContainer(on);
  if (task.type === 'turnOn') return task.switches.every((s) => on.has(s));
  return flipped === ANSWER[task.what] && on.has(flipped);
}

/** Which panel a switch changes (for the glow and the screen reader note). */
export function panelOf(s: Switch): 'processes' | 'files' | 'network' | 'hostname' | 'ipc' | 'user' | 'limits' {
  const map: Record<Switch, ReturnType<typeof panelOf>> = { pid: 'processes', mnt: 'files', net: 'network', uts: 'hostname', ipc: 'ipc', user: 'user', memory: 'limits', cpu: 'limits', pids: 'limits' };
  return map[s];
}

/** The switches to show: the lesson's list (in the usual order), or all nine. */
export function shownSwitches(list?: Switch[]): Switch[] {
  return list?.length ? SWITCHES.filter((s) => list.includes(s)) : SWITCHES;
}

export function startSet(start?: Switch[]): Set<Switch> {
  return new Set((start ?? []).filter((s) => SWITCHES.includes(s)));
}
