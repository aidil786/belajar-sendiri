// World L3 "Phone Lines" (networking): the shophouse's phone lines on the practice server "kedai".
// Story: an IP address is the shop's phone number, a port is an extension, DNS is the phone book,
// localhost is the intercom inside the shop, a firewall is the guard who screens callers.
// Scenarios with `verify` run on a real Debian 13 machine too (npm run verify:linux). The ones that
// need the practice internet (other shops, their firewalls, DNS names) are engine-only.
import type { LinuxScenario } from '~/engine/linux-sim';

const MENU_HTML = '<h1>Menu</h1>\n<p>Nasi lemak RM5</p>\n';
const STAFF_HTML = '<h1>Staff only</h1>\n';

export const l3: LinuxScenario[] = [
  {
    // L3-01: the shop's numbers: ip addr, ip route, hostname -I.
    id: 'linux-l3-ip',
    network: true,
    steps: [],
    task: { goal: { lastTyped: '^ip (-br )?a' }, solution: ['ip -br addr'] },
    verify: [['ip -br addr', 'hostname -I', 'ip route', 'ip addr']],
  },
  {
    // L3-03: extensions: ss -tln, sudo ss -tlnp; stop nginx and port 80 goes quiet.
    id: 'linux-l3-ports',
    network: true,
    steps: [],
    task: { goal: { portClosed: [80], serviceInactive: ['nginx'] }, solution: ['sudo systemctl stop nginx'] },
    verify: [
      ['ss -tln', 'ss -tl', 'sudo ss -tlnp', 'sudo systemctl stop nginx', 'ss -tln', 'curl -sS localhost', 'sudo systemctl start nginx', 'ss -tln'],
    ],
  },
  {
    // L3-04: the intercom vs every line: an app that only answers on 127.0.0.1 (engine only: the
    // practice app "kedai-app" listens without a real program behind it).
    id: 'linux-l3-intercom',
    network: true,
    engineOnly: 'A practice app listens on 127.0.0.1:3000; no real program runs it in a test container.',
    steps: [
      {
        listen: {
          port: 3000,
          addr: '127.0.0.1',
          prog: 'node',
          cmd: 'node /home/you/app/server.js',
          pages: { '/': { status: 200, body: '{"orders":3}\n', headers: { 'Content-Type': 'application/json' } } },
        },
      },
    ],
    task: { goal: { lastTyped: '^curl .*10\\.0\\.0\\.5:3000' }, solution: ['curl -sS 10.0.0.5:3000'] },
    verify: [['ss -tln', 'curl -s localhost:3000', 'curl -sS 10.0.0.5:3000', 'curl -sI 10.0.0.5']],
  },
  {
    // L3-05: the phone book: /etc/hosts first, then DNS (dig). Add a name to /etc/hosts.
    id: 'linux-l3-hosts',
    network: true,
    steps: [{ root: "printf '10.0.0.20\\tdb.kedai\\n' >> /etc/hosts" }],
    task: { goal: { resolves: { 'stock.kedai': '10.0.0.21' } }, solution: ["echo '10.0.0.21 stock.kedai' | sudo tee -a /etc/hosts"] },
    verify: [
      ['cat /etc/hosts', 'getent hosts db.kedai', 'getent hosts stock.kedai', 'echo $?', "echo '10.0.0.21 stock.kedai' | sudo tee -a /etc/hosts", 'getent hosts stock.kedai', 'tail -n 2 /etc/hosts'],
      ['getent hosts localhost', 'getent hosts kedai'],
    ],
  },
  {
    // L3-05: DNS on the practice internet (engine only: dig answers come from the practice DNS).
    id: 'linux-l3-dns',
    network: true,
    engineOnly: 'dig asks the practice DNS (kedai.example and friends), which a test container cannot reach.',
    steps: [{ dns: { 'menu.kedai.example': '203.0.113.20' } }],
    task: { goal: { lastTyped: '^dig (\\+short )?menu\\.kedai\\.example' }, solution: ['dig +short menu.kedai.example'] },
    verify: [['dig kedai.example', 'dig +short www.kedai.example', 'dig +short menu.kedai.example', 'dig nope.kedai.example', 'getent hosts kedai.example']],
  },
  {
    // L3-06: HTTP with curl: status codes 200, 404, 403 and the headers (nginx serves /var/www/html).
    id: 'linux-l3-http',
    network: true,
    steps: [
      { write: '/var/www/html/menu.html', content: MENU_HTML, owner: 'root' },
      { write: '/var/www/html/staff.html', content: STAFF_HTML, owner: 'root', mode: '600' },
    ],
    task: { goal: { lastTyped: '^curl .*-v.*localhost/menu\\.html|^curl .*localhost/menu\\.html.*-v' }, solution: ['curl -v localhost/menu.html'] },
    verify: [
      ['curl -s localhost/menu.html', 'curl -sI localhost/menu.html', 'curl -sI localhost/promo.html', 'curl -sI localhost/staff.html', 'curl -sS -o menu-copy.html localhost/menu.html', 'cat menu-copy.html'],
      ['curl -s -o /dev/null localhost/menu.html', 'curl -sf localhost/promo.html', 'echo $?', 'curl -si localhost/staff.html | head -n 1'],
    ],
  },
  {
    // L3-07: no HTTPS on this server yet: nothing answers on 443.
    id: 'linux-l3-https',
    network: true,
    steps: [],
    verify: [['ss -tln', 'curl -sS https://localhost', 'echo $?']],
  },
  {
    // L3-08: refused vs timed out: a shop with nobody at the counter, and a shop behind a guard that
    // drops callers (engine only: two practice shops on the internet).
    id: 'linux-l3-guard',
    network: true,
    engineOnly: 'Two practice shops on the internet: one refuses, one drops packets (a firewall).',
    steps: [
      { dns: { 'closed.kedai.example': '203.0.113.30', 'guarded.kedai.example': '203.0.113.31' } },
      { remote: { ip: '203.0.113.30', up: true, rtt: 14, ports: [22] } },
      { remote: { ip: '203.0.113.31', up: true, rtt: 14, ports: [22], drops: true } },
    ],
    task: { goal: { typed: '^curl .*guarded\\.kedai\\.example' }, solution: ['curl -sS guarded.kedai.example'] },
    verify: [['curl -sS closed.kedai.example', 'curl -sS guarded.kedai.example', 'ping -c 2 closed.kedai.example', 'ping -c 2 guarded.kedai.example']],
  },
  {
    // L3-09: ping: who answers? (engine only: the practice internet).
    id: 'linux-l3-ping',
    network: true,
    engineOnly: 'Pings the practice internet (kedai.example, pasar.example, a shop that is down).',
    steps: [{ dns: { 'tutup.kedai.example': '203.0.113.40' } }, { remote: { ip: '203.0.113.40', up: false } }],
    task: { goal: { lastTyped: '^ping -c ?\\d+ pasar\\.example$' }, solution: ['ping -c 3 pasar.example'] },
    verify: [['ping -c 2 localhost', 'ping -c 3 kedai.example', 'ping -c 3 pasar.example', 'ping -c 2 tutup.kedai.example', 'ping -c 1 nope.example']],
  },
  {
    // L3-10: the can't-connect ladder on four practice shops, each broken on a different rung
    // (engine only: practice DNS and shops).
    id: 'linux-l3-ladder',
    network: true,
    engineOnly: 'Four practice shops on the internet, each broken on a different rung of the ladder.',
    steps: [
      { dns: { 'satu.kedai.example': '203.0.113.51', 'dua.kedai.example': '203.0.113.52', 'tiga.kedai.example': '203.0.113.53' } },
      { remote: { ip: '203.0.113.51', up: true, rtt: 13, ports: [22] } },
      { remote: { ip: '203.0.113.52', up: true, rtt: 13, ports: [22], drops: true } },
      { remote: { ip: '203.0.113.53', up: true, rtt: 13, pages: { '/': { status: 503, body: '<h1>503 Service Temporarily Unavailable</h1>\n', headers: { 'Content-Type': 'text/html' } } } } },
    ],
    task: { goal: { typed: '^curl .*tiga\\.kedai\\.example' }, solution: ['curl -sI tiga.kedai.example'] },
    verify: [['curl -sS empat.kedai.example', 'curl -sS satu.kedai.example', 'curl -sS dua.kedai.example', 'curl -sI tiga.kedai.example', 'getent hosts empat.kedai.example']],
  },
  {
    // L3-10: your own counter is down (nginx stopped): climb the ladder on the server itself.
    id: 'linux-l3-fixlocal',
    network: true,
    steps: [{ root: 'systemctl stop nginx' }],
    task: { goal: { serviceActive: ['nginx'], reachable: { localhost: 200 } }, solution: ['sudo systemctl start nginx'] },
    verify: [['curl -sS localhost', 'getent hosts localhost', 'ss -tln', 'systemctl is-active nginx', 'sudo systemctl start nginx', 'ss -tln', 'curl -sI localhost']],
  },
  {
    // L3 boss, rung 1 (name): a typo in /etc/hosts, so menu.kedai has no number.
    id: 'linux-l3-boss-name',
    network: true,
    steps: [{ root: "printf '10.0.0.5\\tmenu.kedia\\n' >> /etc/hosts" }],
    task: { goal: { resolves: { 'menu.kedai': '10.0.0.5' } }, solution: ["echo '10.0.0.5 menu.kedai' | sudo tee -a /etc/hosts"] },
    verify: [['getent hosts menu.kedai', 'echo $?', 'cat /etc/hosts', "echo '10.0.0.5 menu.kedai' | sudo tee -a /etc/hosts", 'getent hosts menu.kedai']],
  },
  {
    // L3 boss, rung 2 (port): someone moved the web counter to 8080.
    id: 'linux-l3-boss-port',
    network: true,
    steps: [{ root: "sed -i 's/listen 80 default_server;/listen 8080 default_server;/' /etc/nginx/sites-available/default" }, { root: 'systemctl restart nginx' }],
    task: {
      goal: { portListening: [80], reachable: { localhost: 200 } },
      solution: ["sudo sed -i 's/listen 8080 default_server/listen 80 default_server/' /etc/nginx/sites-available/default", 'sudo nginx -t', 'sudo systemctl restart nginx'],
    },
    verify: [
      ['curl -sS localhost', 'ss -tln', 'grep listen /etc/nginx/sites-available/default', "sudo sed -i 's/listen 8080 default_server/listen 80 default_server/' /etc/nginx/sites-available/default", 'sudo nginx -t', 'sudo systemctl restart nginx', 'ss -tln', 'curl -sI localhost'],
    ],
  },
  {
    // L3 boss, rung 4 (service): nginx is stopped and won't come back after a restart.
    id: 'linux-l3-boss-service',
    network: true,
    steps: [{ root: 'systemctl disable --now nginx' }],
    task: { goal: { serviceActive: ['nginx'], serviceEnabled: ['nginx'], reachable: { localhost: 200 } }, solution: ['sudo systemctl enable --now nginx'] },
    verify: [['curl -sS localhost', 'systemctl is-active nginx', 'systemctl is-enabled nginx', 'sudo systemctl enable --now nginx', 'systemctl is-active nginx', 'systemctl is-enabled nginx', 'curl -sI localhost']],
  },
];
