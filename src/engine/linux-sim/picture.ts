// The state picture under the LinuxSim terminal: the folder you are in (who owns what), who you
// are, the services as lights, busy programs and (optionally) the network.
import { childNames, gidName, joinPath, lookup, modeString, uidName, userByName } from './fs';
import { listeners } from './programs/net';
import { shellOf } from './shell';
import type { ActiveState, LinuxState } from './types';

export interface PicEntry {
  name: string;
  path: string;
  kind: 'dir' | 'file' | 'link';
  mode: string;
  owner: string;
  group: string;
  /** The owner may run it (files) / a folder. */
  exec: boolean;
  /** The learner may change it. */
  mine: boolean;
  /** Children names for folders (one level, first few). */
  children?: string[];
  more?: number;
}

export interface LinuxPicture {
  user: string;
  root: boolean;
  host: string;
  cwd: string;
  /** cwd as the prompt shows it (~/shop). */
  cwdShort: string;
  entries: PicEntry[];
  hidden: number;
  canRead: boolean;
  services: { name: string; active: ActiveState; enabled: boolean }[];
  /** Programs worth noticing: scripts, background jobs, the foreground one. */
  procs: { pid: number; user: string; args: string; state: 'running' | 'stopped' | 'busy'; fg: boolean; job?: number }[];
  ports: { port: number; addr: string; prog: string }[];
  ip: string;
  fg: string | null;
}

export function linuxPicture(st: LinuxState, max = 14): LinuxPicture {
  const sh = shellOf(st);
  const me = userByName(st, sh.user);
  const home = sh.vars.HOME ?? '';
  const cwdShort = home && (sh.cwd === home || sh.cwd.startsWith(`${home}/`)) ? `~${sh.cwd.slice(home.length)}` : sh.cwd;
  const dir = lookup(st, sh.user, sh.cwd);
  let entries: PicEntry[] = [];
  let hidden = 0;
  let canRead = false;
  if (dir.ok && dir.node.type === 'dir') {
    const readable = lookup(st, 'root', sh.cwd);
    canRead = me?.uid === 0 || (readable.ok && ((dir.node.uid === me?.uid ? dir.node.mode & 0o400 : dir.node.mode & 0o004) !== 0 || (dir.node.mode & 0o040) !== 0));
    const names = childNames(st, dir.path);
    hidden = names.filter((n) => n.startsWith('.')).length;
    entries = names
      .filter((n) => !n.startsWith('.'))
      .slice(0, max)
      .map((name) => {
        const path = joinPath(dir.path, name);
        const n = st.fs[path]!;
        const e: PicEntry = {
          name,
          path,
          kind: n.type,
          mode: modeString(n),
          owner: uidName(st, n.uid),
          group: gidName(st, n.gid),
          exec: n.type === 'dir' || (n.mode & 0o100) !== 0,
          mine: me?.uid === 0 || n.uid === me?.uid,
        };
        if (n.type === 'dir') {
          const kids = childNames(st, path).filter((k) => !k.startsWith('.'));
          e.children = kids.slice(0, 4);
          if (kids.length > 4) e.more = kids.length - 4;
        }
        return e;
      });
  }
  const procs = Object.values(st.procs)
    .filter((p) => p.kind === 'script' || p.kind === 'sleep' || p.kind === 'tail' || p.kind === 'ping' || p.kind === 'top' || (p.kind === 'other' && p.job !== undefined) || st.fg?.pid === p.pid)
    .sort((a, b) => a.pid - b.pid)
    .map((p) => ({ pid: p.pid, user: p.user, args: p.args, state: (p.state === 'T' ? 'stopped' : p.kind === 'script' && p.state === 'R' ? 'busy' : 'running') as 'running' | 'stopped' | 'busy', fg: st.fg?.pid === p.pid, ...(p.job !== undefined ? { job: p.job } : {}) }));
  return {
    user: sh.user,
    root: me?.uid === 0,
    host: st.hostname,
    cwd: sh.cwd,
    cwdShort,
    entries,
    hidden,
    canRead,
    services: Object.values(st.services).map((s) => ({ name: s.name, active: s.active, enabled: s.enabled })),
    procs,
    ports: listeners(st).map((l) => ({ port: l.port, addr: l.addr, prog: l.prog })),
    ip: st.net.ifaces.find((i) => !i.loopback)?.ipv4 ?? '',
    fg: st.fg?.cmd ?? null,
  };
}
