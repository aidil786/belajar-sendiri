import { describe, expect, it } from 'vitest';
import { buildLinuxScenario } from '..';
import { relTime } from '../services';
import { session } from './helpers';

describe('systemctl', () => {
  it('status of a running service (systemd 257 layout)', () => {
    const s = session();
    const out = s.out('systemctl status nginx');
    expect(out.split('\n').slice(0, 2)).toEqual([
      '● nginx.service - A high performance web server and a reverse proxy server',
      '     Loaded: loaded (/usr/lib/systemd/system/nginx.service; enabled; preset: enabled)',
    ]);
    expect(out).toMatch(/^ {5}Active: active \(running\) since Sun 2026-11-01 08:30:01 UTC; 29min ago$/m);
    expect(out).toMatch(/^ {13}├─\d+ "nginx: master process \/usr\/sbin\/nginx -g daemon on; master_process on;"$/m);
    expect(out).toMatch(/^Warning: some journal files were not opened due to insufficient permissions\.$/m);
  });

  it('changing services needs root; with sudo they stop and start', () => {
    const s = session();
    const denied = s.sh('systemctl stop nginx');
    expect(denied.text).toBe("Failed to stop nginx.service: Access denied\nSee system logs and 'systemctl status nginx.service' for details.");
    expect(denied.exitCode).toBe(4);
    s.sh('sudo systemctl stop nginx');
    const st = s.sh('systemctl is-active nginx');
    expect(st.text).toBe('inactive');
    expect(st.exitCode).toBe(3);
    expect(s.out('curl localhost')).toBe('curl: (7) Failed to connect to localhost port 80 after 0 ms: Could not connect to server');
    s.sh('sudo systemctl start nginx');
    expect(s.out('systemctl is-active nginx')).toBe('active');
  });

  it('enable and disable print what systemd prints', () => {
    const s = session();
    expect(s.out('sudo systemctl disable nginx')).toBe(
      "Synchronizing state of nginx.service with SysV service script with /usr/lib/systemd/systemd-sysv-install.\nExecuting: /usr/lib/systemd/systemd-sysv-install disable nginx\nRemoved '/etc/systemd/system/multi-user.target.wants/nginx.service'.",
    );
    expect(s.out('systemctl is-enabled nginx')).toBe('disabled');
    expect(s.out('sudo systemctl enable nginx')).toMatch(/Created symlink '\/etc\/systemd\/system\/multi-user\.target\.wants\/nginx\.service' → '\/usr\/lib\/systemd\/system\/nginx\.service'\.$/);
  });

  it('an unknown unit', () => {
    const s = session();
    expect(s.out('systemctl status nope')).toBe('Unit nope.service could not be found.');
    expect(s.sh('systemctl status nope').exitCode).toBe(4);
    expect(s.out('sudo systemctl start nope')).toBe('Failed to start nope.service: Unit nope.service not found.');
  });

  it('a broken nginx config: start fails, nginx -t names the line, the fix works', () => {
    const st = buildLinuxScenario({ id: 't', steps: [{ root: "sed -i 's/^\\tlisten 80 default_server;/\\tlisen 80 default_server;/' /etc/nginx/sites-available/default" }, { root: 'systemctl stop nginx' }] });
    const s = session(st);
    const start = s.sh('sudo systemctl start nginx');
    expect(start.text).toBe('Job for nginx.service failed because the control process exited with error code.\nSee "systemctl status nginx.service" and "journalctl -xeu nginx.service" for details.');
    expect(s.out('systemctl is-active nginx')).toBe('failed');
    expect(s.out('sudo nginx -t')).toMatch(/\[emerg\] \d+#\d+: unknown directive "lisen" in \/etc\/nginx\/sites-enabled\/default:22\nnginx: configuration file \/etc\/nginx\/nginx\.conf test failed$/);
    expect(s.out('sudo journalctl -u nginx -n 2')).toMatch(/Failed with result 'exit-code'\.\n.*Failed to start nginx\.service/);
    s.sh("sudo sed -i 's/lisen/listen/' /etc/nginx/sites-available/default");
    expect(s.out('sudo nginx -t')).toBe('nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\nnginx: configuration file /etc/nginx/nginx.conf test is successful');
    s.sh('sudo systemctl start nginx');
    expect(s.out('systemctl is-active nginx')).toBe('active');
  });

  it('relative times like systemd', () => {
    expect(relTime(48)).toBe('48s ago');
    expect(relTime(66)).toBe('1min 6s ago');
    expect(relTime(13 * 60)).toBe('13min ago');
    expect(relTime(3 * 3600 + 120)).toBe('3h 2min ago');
    expect(relTime(3 * 86400)).toBe('3 days ago');
  });
});

describe('journalctl', () => {
  it('needs adm or sudo for system logs; without them you see only your own lines', () => {
    const s = session();
    const hint = "Hint: You are currently not seeing messages from other users and the system.\n      Users in groups 'adm', 'systemd-journal' can see all messages.\n      Pass -q to turn off this notice.";
    // No journal file of your own yet (like a fresh Debian 13 login): nothing can be opened.
    const first = s.sh('journalctl -u cron');
    expect(first.text).toBe(`${hint}\nNo journal files were opened due to insufficient permissions.`);
    expect(first.exitCode).toBe(1);
    expect(s.out('journalctl -q')).toBe('No journal files were opened due to insufficient permissions.');
    expect(s.out('sudo journalctl -u cron')).toBe(
      'Nov 01 08:30:01 kedai systemd[1]: Started cron.service - Regular background program processing daemon.\nNov 01 08:30:01 kedai cron[69]: (CRON) INFO (pidfile fd = 3)\nNov 01 08:30:01 kedai cron[69]: (CRON) INFO (Running @reboot jobs)',
    );
    // sudo logged as you, so now your own journal file holds those lines.
    expect(s.sh('journalctl -u cron').text).toBe(`${hint}\n-- No entries --`);
    const own = s.sh('journalctl -n 2');
    expect(own.exitCode).toBe(0);
    expect(own.text).toBe(`${hint}\nNov 01 09:00:04 kedai sudo[1242]: pam_unix(sudo:session): session opened for user root(uid=0) by you(uid=1000)\nNov 01 09:00:04 kedai sudo[1242]: pam_unix(sudo:session): session closed for user root`);
  });

  it('-p keeps lines of that priority and worse', () => {
    const s = session();
    s.sh("echo broken | sudo tee /etc/nginx/sites-enabled/bad");
    s.sh('sudo systemctl restart nginx');
    expect(s.out('sudo journalctl -p err -u nginx')).toMatch(/^Nov 01 \S+ kedai systemd\[1\]: Failed to start nginx\.service - A high performance web server and a reverse proxy server\.$/);
    expect(s.out('sudo journalctl -p warning -u nginx').split('\n').map((l) => l.replace(/^.*?\]: /, ''))).toEqual(["nginx.service: Failed with result 'exit-code'.", 'Failed to start nginx.service - A high performance web server and a reverse proxy server.']);
    expect(s.out('sudo journalctl -p 5 -u nginx').split('\n')).toHaveLength(3);
    expect(s.sh('sudo journalctl -p err..warning -u nginx').text.split('\n')).toHaveLength(2);
    const bad = s.sh('sudo journalctl -p loud');
    expect(bad.text).toBe('Unknown log level loud');
    expect(bad.exitCode).toBe(1);
    // journalctl colours by priority: err red, warning yellow.
    const r = s.sh('sudo journalctl -p warning -u nginx');
    expect(r.output.map((l) => l[0]?.c)).toEqual(['yellow', 'red']);
  });

  it('-x adds the catalog lines', () => {
    const s = session();
    s.sh('sudo systemctl stop cron');
    expect(s.out('sudo journalctl -xeu cron')).toMatch(/Stopped cron\.service - .*\n░░ Subject: A stop job for unit cron\.service has finished/);
  });
});
