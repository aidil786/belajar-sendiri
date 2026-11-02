import { describe, expect, it } from 'vitest';
import { buildLinuxScenario } from '..';
import { signalNumber } from '../procs';
import { session } from './helpers';

describe('processes', () => {
  it('ps aux lists systemd, the services and your shell', () => {
    const s = session();
    const out = s.out('ps aux');
    const lines = out.split('\n');
    expect(lines[0]).toBe('USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND');
    expect(out).toMatch(/^root {11}1 .* \/lib\/systemd\/systemd$/m);
    expect(out).toMatch(/^www-data .* nginx: worker process$/m);
    expect(out).toMatch(/^you .*pts\/0 +Ss .* -bash$/m);
    expect(out).toMatch(/^you .*pts\/0 +R\+ .* ps aux$/m);
  });

  it('ps -ef and plain ps', () => {
    const s = session();
    expect(s.out('ps -ef').split('\n')[0]).toBe('UID          PID    PPID  C STIME TTY          TIME CMD');
    expect(s.out('ps')).toMatch(/^ {4}PID TTY {10}TIME CMD\n +\d+ pts\/0 {4}00:00:00 bash\n +\d+ pts\/0 {4}00:00:00 ps$/);
  });

  it('a stuck script: pgrep finds it, kill ends it, kill -9 ends a stubborn one', () => {
    const st = buildLinuxScenario({ id: 't', steps: [{ process: { cmd: 'bash /home/you/stuck.sh' } }, { process: { cmd: 'bash /home/you/stubborn.sh', stubborn: true } }] });
    const s = session(st);
    const pids = s.out('pgrep -f stuck').split('\n');
    expect(pids).toHaveLength(1);
    expect(s.out(`ps aux | grep -c "[s]tuck.sh"`)).toBe('1');
    s.sh(`kill ${pids[0]}`);
    expect(s.sh('pgrep -f stuck').exitCode).toBe(1);
    const stub = s.out('pgrep -f stubborn');
    s.sh(`kill ${stub}`);
    expect(s.out('pgrep -f stubborn')).toBe(stub);
    const r = s.sh(`kill -9 ${stub}`);
    expect(r.danger).toBe(true);
    expect(s.sh('pgrep -f stubborn').exitCode).toBe(1);
  });

  it('kill errors use bash words; signals by name or number', () => {
    const s = session();
    expect(s.out('kill 999999')).toBe('-bash: kill: (999999) - No such process');
    expect(s.out('kill 1')).toBe('-bash: kill: (1) - Operation not permitted');
    expect(s.out('kill -9 abc')).toBe('-bash: kill: abc: arguments must be process or job IDs');
    expect(s.out('killall nope')).toBe('nope: no process found');
    expect(signalNumber('KILL')).toBe(9);
    expect(signalNumber('SIGTERM')).toBe(15);
    expect(signalNumber('9')).toBe(9);
  });

  it('killing an nginx worker: the master starts a new one', () => {
    const s = session();
    const before = s.out('pgrep -u www-data nginx').split('\n');
    s.sh(`sudo kill ${before[0]}`);
    const after = s.out('pgrep -u www-data nginx').split('\n');
    expect(after).toHaveLength(before.length);
    expect(after).not.toContain(before[0]);
  });
});

describe('jobs', () => {
  it('& starts a job; jobs lists it; kill %1 ends it', () => {
    const s = session();
    const r = s.sh('sleep 300 &');
    expect(r.text).toMatch(/^\[1\] \d+$/);
    expect(s.out('jobs')).toBe('[1]+  Running                 sleep 300 &');
    expect(s.out('kill %1')).toBe('[1]+  Terminated              sleep 300');
    expect(s.out('jobs')).toBe('');
  });

  it('a long sleep holds the terminal; Ctrl+Z pauses it; bg and fg', () => {
    const s = session();
    s.sh('sleep 100');
    expect(s.st.fg?.cmd).toBe('sleep 100');
    expect(s.sh('ls').explain?.key).toBe('linux.explain.busy');
    expect(s.out('^Z')).toBe('^Z\n[1]+  Stopped                 sleep 100');
    expect(s.st.fg).toBeNull();
    expect(s.out('jobs')).toBe('[1]+  Stopped                 sleep 100');
    expect(s.out('bg')).toBe('[1]+ sleep 100 &');
    expect(s.out('fg')).toBe('sleep 100');
    expect(s.st.fg).not.toBeNull();
    expect(s.out('^C')).toBe('^C');
    expect(s.st.fg).toBeNull();
  });

  it('background jobs finish by themselves as time passes', () => {
    const s = session();
    s.sh('sleep 5 &');
    expect(s.out('sleep 10')).toBe('[1]+  Done                    sleep 5');
  });

  it('ping without -c runs until Ctrl+C, then prints its summary', () => {
    const s = session();
    s.sh('ping localhost');
    expect(s.st.fg?.cmd).toBe('ping localhost');
    expect(s.out('^C')).toMatch(/^\^C\n--- localhost ping statistics ---\n4 packets transmitted, 4 received, 0% packet loss/);
  });
});
