// Gaps found while writing L3/L4, checked against a real Debian 13 machine (linux-fid-cron,
// linux-fid-ssh and linux-fid-nginx-sites run them there; ping's own network is engine-only).
import { describe, expect, it } from 'vitest';
import { plain, run } from '..';
import { session } from './helpers';

describe('gaps found writing L3/L4', () => {
  it('crontab names the bad field and counts lines like Vixie cron', () => {
    const s = session();
    expect(s.out("echo '* 25 * * * x' | crontab -")).toBe('"-":0: bad hour\nerrors in crontab file, can\'t install.');
    expect(s.out("echo '0 9' | crontab -")).toBe('"-":1: bad day-of-month\nerrors in crontab file, can\'t install.');
    expect(s.out("printf '0 9 * * * ok\\nabc\\n' | crontab -")).toBe('"-":2: bad minute\nerrors in crontab file, can\'t install.');
    expect(s.out("printf '0 9 * * * ok' | crontab -")).toBe("new crontab file is missing newline before EOF, can't install.");
    expect(s.sh("echo '0 9 * jan mon-fri echo hi' | crontab -").exitCode).toBe(0);
  });

  it('ssh to the server itself asks to trust its key; with no terminal it fails', () => {
    const s = session();
    const r = run(s.st, 'ssh localhost true', { tty: false });
    expect(plain(r.output)).toBe('Host key verification failed.');
    expect(r.exitCode).toBe(255);
    s.sh('ssh localhost');
    expect(s.st.ask?.prompt).toBe('Are you sure you want to continue connecting (yes/no/[fingerprint])? ');
    const yes = s.sh('yes');
    expect(yes.text).toBe("Warning: Permanently added 'localhost' (ED25519) to the list of known hosts.");
    expect(s.st.ask?.prompt).toBe("you@localhost's password: ");
    expect(s.st.ask?.secret).toBe(true);
    s.sh('guess');
    s.sh('guess');
    const last = s.sh('guess');
    expect(last.text).toBe('you@localhost: Permission denied (publickey,password).');
    expect(last.exitCode).toBe(255);
    // The key is known now: no second question.
    s.sh('ssh localhost');
    expect(s.st.ask?.prompt).toBe("you@localhost's password: ");
  });

  it('ssh-keygen -f names the file as typed and makes no folder but ~/.ssh', () => {
    const s = session();
    s.sh('mkdir keys');
    expect(s.out("ssh-keygen -t ed25519 -N '' -f keys/k").split('\n')[1]).toBe('Your identification has been saved in keys/k');
    expect(s.out("ssh-keygen -t ed25519 -N '' -f missing/k 2>&1 >/dev/null")).toBe('Saving key "missing/k" failed: No such file or directory');
  });

  it('ping: ttl 64 on our own network; nobody there is "Destination Host Unreachable"', () => {
    const s = session();
    expect(s.out('ping -c 1 10.0.0.1')).toMatch(/ttl=64 /);
    expect(s.out('ping -c 1 kedai.example')).toMatch(/ttl=57 /);
    const r = s.sh('ping -c 1 10.0.0.9');
    expect(r.text).toBe(
      'PING 10.0.0.9 (10.0.0.9) 56(84) bytes of data.\nFrom 10.0.0.5 icmp_seq=1 Destination Host Unreachable\n\n--- 10.0.0.9 ping statistics ---\n1 packets transmitted, 0 received, +1 errors, 100% packet loss, time 0ms',
    );
    expect(r.exitCode).toBe(1);
  });

  it('nginx serves each port from its own server block; only root signals nginx', () => {
    const s = session();
    s.sh('sudo mkdir -p /var/www/shop');
    s.sh("printf 'server {\\n\\tlisten 8080;\\n\\troot /var/www/shop;\\n\\tindex index.html;\\n}\\n' | sudo tee /etc/nginx/sites-available/shop");
    s.sh('sudo ln -s /etc/nginx/sites-available/shop /etc/nginx/sites-enabled/shop');
    s.sh('sudo systemctl reload nginx');
    expect(s.out('curl -s localhost:8080')).toMatch(/403 Forbidden/);
    s.sh('echo hi | sudo tee /var/www/shop/index.html');
    expect(s.out('curl -s localhost:8080')).toBe('hi');
    expect(s.out('curl -s localhost')).toMatch(/Welcome to nginx/);
    const r = s.sh('/usr/sbin/nginx -s reload');
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/\[alert\] \d+#\d+: kill\(\d+, 1\) failed \(1: Operation not permitted\)$/);
    expect(s.out('du /var/log 2>&1 >/dev/null')).toBe("du: cannot read directory '/var/log/private': Permission denied");
  });
});
