// World D6 "Under the Hood": one process seen from both sides, cgroup limits, one kernel.
// Outputs and errors as Docker Engine 29.9.2 printed them (2026-10-31).
import { describe, expect, it } from 'vitest';
import { kitchen, runs, text } from './helpers';
import { run } from '../index';

describe('a container is a process on the laptop', () => {
  it('docker top, ps aux on the laptop and inspect State.Pid show the same PIDs', () => {
    const { state, all } = runs(kitchen(['nginx:1.30-alpine']), 'docker run -d --name web nginx:1.30-alpine', 'docker top web', 'docker inspect -f {{.State.Pid}} web', 'ps aux');
    const pid = text(all[2]!);
    const top = text(all[1]!).split('\n');
    expect(top[0]).toMatch(/^UID\s+PID\s+PPID\s+C\s+STIME\s+TTY\s+TIME\s+CMD$/);
    const master = top[1]!.trim().split(/\s+/);
    expect(master[1]).toBe(pid);
    const shim = master[2]!;
    // The workers run as uid 101: the laptop has no "nginx" user, so it shows the number.
    expect(top.slice(2).every((l) => l.startsWith('101 ') && l.includes(`${pid}`))).toBe(true);
    const ps = text(all[3]!).split('\n');
    expect(ps.find((l) => l.includes('nginx: master process'))).toMatch(new RegExp(`^root\\s+${pid}\\s`));
    expect(ps.find((l) => l.includes('containerd-shim-runc-v2'))).toMatch(new RegExp(`^root\\s+${shim}\\s`));
    // ps sorts by PID.
    const pids = ps.slice(1).map((l) => Number(l.trim().split(/\s+/)[1]));
    expect([...pids].sort((a, b) => a - b)).toEqual(pids);
    // Inside its own PID namespace, the same nginx is PID 1.
    expect(text(run(state, 'docker exec web ps')).split('\n')[1]).toMatch(/^\s+1 root\s+0:00 nginx: master process/);
  });

  it('one kernel: uname -r is the same inside and outside', () => {
    const { state } = runs(kitchen(['alpine:3.22']), 'docker run -d --name box alpine:3.22 sleep 1000');
    const outside = text(run(state, 'uname -r'));
    expect(outside).toMatch(/^\d+\.\d+/);
    expect(text(run(state, 'docker exec box uname -r'))).toBe(outside);
  });
});

describe('cgroup limits', () => {
  it('--memory, --cpus and --pids-limit land in inspect and docker stats', () => {
    const { state } = runs(kitchen(['nginx:1.30-alpine']), 'docker run -d --name web --memory 256m --cpus 1.5 --pids-limit 100 nginx:1.30-alpine', 'docker run -d --name free nginx:1.30-alpine');
    expect(text(run(state, "docker inspect -f '{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}} {{.HostConfig.PidsLimit}} {{.HostConfig.MemorySwap}}' web"))).toBe('268435456 1500000000 100 536870912');
    expect(text(run(state, "docker inspect -f '{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}} {{.HostConfig.PidsLimit}} {{.HostConfig.MemorySwap}}' free"))).toBe('0 0 <no value> 0');
    const stats = text(run(state, 'docker stats --no-stream'));
    expect(stats).toMatch(/web\s+0\.00%\s+\S+ \/ 256MiB/);
    expect(stats).toMatch(/free\s+0\.00%\s+\S+ \/ 15\.71GiB/);
  });

  it("Docker 29's words for limits that don't work", () => {
    const s = kitchen(['alpine:3.22']);
    expect(text(run(s, 'docker run --rm --memory 2m alpine:3.22 true'))).toBe("docker: Error response from daemon: Minimum memory limit allowed is 6MB\n\nRun 'docker run --help' for more information");
    expect(text(run(s, 'docker run --rm --cpus 9 alpine:3.22 true'))).toBe("docker: Error response from daemon: range of CPUs is from 0.01 to 4.00, as there are only 4 CPUs available\n\nRun 'docker run --help' for more information");
    const bad = run(s, 'docker run --rm --memory abc alpine:3.22 true');
    expect(text(bad).split('\n')[0]).toBe(`invalid argument "abc" for "-m, --memory" flag: invalid size: 'abc'`);
    expect(bad.exitCode).toBe(125);
    expect(text(run(s, 'docker run --rm --cpus abc alpine:3.22 true')).split('\n')[0]).toBe('invalid argument "abc" for "--cpus" flag: failed to parse abc as a rational number');
    expect(text(run(s, 'docker run --rm --pids-limit abc alpine:3.22 true')).split('\n')[0]).toBe('invalid argument "abc" for "--pids-limit" flag: strconv.ParseInt: parsing "abc": invalid syntax');
  });
});

describe('rescue fixes', () => {
  it('chown on a volume mount point changes the volume, so the next container can write', () => {
    const { all } = runs(
      kitchen(['alpine:3.22']),
      'docker run --rm --user 1000:1000 -v appdata:/data alpine:3.22 touch /data/x',
      'docker run --rm -v appdata:/data alpine:3.22 chown 1000:1000 /data',
      'docker run --rm --user 1000:1000 -v appdata:/data alpine:3.22 touch /data/x',
    );
    expect(text(all[0]!)).toBe('touch: /data/x: Permission denied');
    expect(all.map((r) => r.ok)).toEqual([false, true, true]);
  });

  it('redis-cli names the host it tried', () => {
    const { state } = runs(kitchen(['redis:8-alpine']), 'docker network create shopnet', 'docker run -d --name cache --network shopnet redis:8-alpine');
    expect(text(run(state, 'docker run --rm --network shopnet redis:8-alpine redis-cli -h localhost ping'))).toBe('Could not connect to Redis at localhost:6379: Connection refused');
    expect(text(run(state, 'docker run --rm --network shopnet redis:8-alpine redis-cli -h cache ping'))).toBe('PONG');
  });
});
