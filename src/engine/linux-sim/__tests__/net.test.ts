import { describe, expect, it } from 'vitest';
import { buildLinuxScenario } from '..';
import { network } from '../programs/net';
import { session } from './helpers';

describe('network', () => {
  it('ip addr / route / -br', () => {
    const s = session();
    expect(s.out('ip addr')).toMatch(/^2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP group default $/m);
    expect(s.out('ip addr')).toMatch(/^ {4}inet 10\.0\.0\.5\/24 brd 10\.0\.0\.255 scope global eth0$/m);
    expect(s.out('ip route')).toBe('default via 10.0.0.1 dev eth0 \n10.0.0.0/24 dev eth0 proto kernel scope link src 10.0.0.5 ');
    expect(s.out('ip -br addr')).toBe('lo               UNKNOWN        127.0.0.1/8 ::1/128 \neth0             UP             10.0.0.5/24 ');
    expect(network('192.168.1.77', 24)).toBe('192.168.1.0');
  });

  it('ss shows listening ports; the process column needs root', () => {
    const s = session();
    expect(s.out('ss -tln')).toBe(
      'State  Recv-Q Send-Q Local Address:Port Peer Address:Port\nLISTEN 0      128          0.0.0.0:22        0.0.0.0:*   \nLISTEN 0      511          0.0.0.0:80        0.0.0.0:*   ',
    );
    expect(s.out('ss -tl')).toMatch(/0\.0\.0\.0:ssh/);
    expect(s.out('sudo ss -tlnp')).toMatch(/users:\(\("nginx",pid=\d+,fd=5\)/);
  });

  it('curl: headers with CRLF, -v, errors', () => {
    const s = session();
    expect(s.out('curl -sI localhost').split('\r\n')[0]).toBe('HTTP/1.1 200 OK');
    expect(s.out('curl -s localhost')).toMatch(/<title>Welcome to nginx!<\/title>/);
    expect(s.out('curl -s localhost/nope')).toMatch(/<title>404 Not Found<\/title>/);
    expect(s.out('curl localhost:8080')).toBe('curl: (7) Failed to connect to localhost port 8080 after 0 ms: Could not connect to server');
    expect(s.out('curl nope.example')).toBe('curl: (6) Could not resolve host: nope.example');
    const v = s.out('curl -v localhost/nope');
    expect(v).toMatch(/^> GET \/nope HTTP\/1\.1$/m);
    expect(v).toMatch(/^< HTTP\/1\.1 404 Not Found$/m);
  });

  it('/etc/hosts, getent, ping', () => {
    const s = session();
    expect(s.out('getent hosts localhost')).toBe('127.0.0.1       localhost');
    s.sh("echo '10.0.0.30 cafe.kedai' | sudo tee -a /etc/hosts");
    expect(s.out('getent hosts cafe.kedai')).toBe('10.0.0.30       cafe.kedai');
    expect(s.out('ping -c 1 127.0.0.1')).toMatch(/^PING 127\.0\.0\.1 \(127\.0\.0\.1\) 56\(84\) bytes of data\.\n64 bytes from 127\.0\.0\.1: icmp_seq=1 ttl=64 time=[\d.]+ ms\n\n--- 127\.0\.0\.1 ping statistics ---\n1 packets transmitted, 1 received, 0% packet loss, time 0ms/);
    expect(s.out('ping -c 1 nope.example')).toBe('ping: nope.example: Name or service not known');
  });

  it('DNS: dig, host, a host behind a firewall times out', () => {
    const st = buildLinuxScenario({ id: 't', steps: [{ dns: { 'promo.kedai.example': '203.0.113.12' } }, { remote: { ip: '203.0.113.12', up: true, drops: true } }] });
    const s = session(st);
    expect(s.out('dig +short www.kedai.example')).toBe('kedai.example.\n203.0.113.10');
    expect(s.out('host kedai.example')).toBe('kedai.example has address 203.0.113.10');
    expect(s.out('host nope.example')).toBe('Host nope.example not found: 3(NXDOMAIN)');
    expect(s.out('dig kedai.example')).toMatch(/;; ANSWER SECTION:\nkedai\.example\. {10}300\tIN\tA\t203\.0\.113\.10/);
    expect(s.out('curl -s kedai.example')).toBe('<h1>Kedai Kancil</h1>\n<p>Open 8am to 10pm.</p>');
    expect(s.out('curl -sS promo.kedai.example')).toMatch(/^curl: \(28\) /);
  });

  it('nginx takes new ports on reload, not when the file changes', () => {
    const s = session();
    s.sh("sudo sed -i 's/listen 80 default_server;/listen 8080 default_server;/' /etc/nginx/sites-available/default");
    expect(s.out('ss -tln')).toMatch(/0\.0\.0\.0:80 /);
    expect(s.out('ss -tln')).not.toMatch(/:8080/);
    s.sh('sudo systemctl reload nginx');
    expect(s.out('ss -tln')).toMatch(/0\.0\.0\.0:8080 /);
    expect(s.out('curl -s localhost:8080')).toMatch(/Welcome to nginx!/);
    expect(s.out('curl -sS localhost')).toBe('curl: (7) Failed to connect to localhost port 80 after 0 ms: Could not connect to server');
  });

  it('a dropped connection: curl waits for the kernel, or for --connect-timeout (real curl 8.14 words)', () => {
    const st = buildLinuxScenario({ id: 't', steps: [{ dns: { 'promo.kedai.example': '203.0.113.12' } }, { remote: { ip: '203.0.113.12', up: true, drops: true } }] });
    const s = session(st);
    expect(s.out('curl -sS promo.kedai.example')).toBe('curl: (28) Failed to connect to promo.kedai.example port 80 after 134844 ms: Could not connect to server');
    expect(s.out('curl -sS --connect-timeout 5 promo.kedai.example')).toBe('curl: (28) Connection timed out after 5004 milliseconds');
    expect(s.out('curl -v -m 5 promo.kedai.example')).toMatch(/\* Connection timed out after 5004 milliseconds\n\* closing connection #0\ncurl: \(28\) Connection timed out after 5004 milliseconds$/);
  });
});
