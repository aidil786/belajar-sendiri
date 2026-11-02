// The PORTS column on a host with IPv6, checked on Docker 29.9.2 (GitHub's ubuntu runner).
import { describe, expect, it } from 'vitest';
import { kitchen, runs, text } from './helpers';

describe('docker ps PORTS with IPv6', () => {
  it('brackets the IPv6 address for a same-number and a different-number mapping', () => {
    const s = kitchen(['nginx:1.30-alpine']);
    s.host.ipv6 = true;
    const same = runs(s, 'docker run -d --name web -p 8080:8080 nginx:1.30-alpine', 'docker ps --format "{{.Ports}}"');
    expect(text(same.last)).toBe('80/tcp, 0.0.0.0:8080->8080/tcp, [::]:8080->8080/tcp');
    const other = runs(same.state, 'docker rm -f web', 'docker run -d --name web -p 8080:80 nginx:1.30-alpine', 'docker ps --format "{{.Ports}}"');
    expect(text(other.last)).toBe('0.0.0.0:8080->80/tcp, [::]:8080->80/tcp');
  });
});

describe('BusyBox wget to localhost', () => {
  it('names 127.0.0.1 without IPv6, and no address when localhost is ::1', () => {
    const cmd = 'docker run --rm alpine:3.22 wget -qO- http://localhost';
    expect(text(runs(kitchen(['alpine:3.22']), cmd).last)).toBe("wget: can't connect to remote host (127.0.0.1): Connection refused");
    const s = kitchen(['alpine:3.22']);
    s.host.ipv6 = true;
    expect(text(runs(s, cmd).last)).toBe("wget: can't connect to remote host: Connection refused");
    expect(text(runs(s, 'docker run --rm alpine:3.22 wget -O- http://localhost').last)).toContain('Connecting to localhost ([::1]:80)');
  });
});
