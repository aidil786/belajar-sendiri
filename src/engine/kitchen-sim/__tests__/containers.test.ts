import { describe, expect, it } from 'vitest';
import { kitchenPicture, run } from '../index';
import { humanDuration, humanSize } from '../format';
import { kitchen, runs, text } from './helpers';

describe('docker run', () => {
  it('pulls, creates and starts hello-world, and prints its real message', () => {
    const r = run(kitchen(), 'docker run hello-world');
    expect(r.ok).toBe(true);
    const out = text(r);
    expect(out).toContain("Unable to find image 'hello-world:latest' locally");
    expect(out).toContain('latest: Pulling from library/hello-world');
    expect(out).not.toContain('Using default tag');
    expect(out).toContain('Status: Downloaded newer image for hello-world:latest');
    expect(out).toContain('Hello from Docker!');
    expect(out).toContain(' 2. The Docker daemon pulled the "hello-world" image from the Docker Hub.\n    (amd64)');
    expect(r.events.map((e) => e.type)).toEqual(expect.arrayContaining(['imagePulled', 'containerCreated', 'containerStarted', 'containerExited']));
    // A second run doesn't pull again.
    expect(text(run(r.state, 'docker run hello-world'))).not.toContain('Pulling');
  });

  it('docker ps -a shows stable, fake-clock times and Docker-style columns', () => {
    const { state } = runs(kitchen(['hello-world:latest']), 'docker run --name hi hello-world');
    const ps = text(run(state, 'docker ps -a')).split('\n');
    expect(ps[0]).toBe('CONTAINER ID   IMAGE         COMMAND    CREATED         STATUS                     PORTS     NAMES');
    expect(ps[1]).toMatch(/^[0-9a-f]{12} {3}hello-world {3}"\/hello" {3}3 seconds ago {3}Exited \(0\) 3 seconds ago {13}hi$/);
    expect(text(run(state, 'docker ps'))).toBe('CONTAINER ID   IMAGE     COMMAND   CREATED   STATUS    PORTS     NAMES');
  });

  it('runs nginx in the background, maps a port and serves the welcome page', () => {
    const { state, all } = runs(kitchen(['nginx:1.30-alpine']), 'docker run -d --name web -p 8080:80 nginx:1.30-alpine', 'docker ps', 'curl localhost:8080', 'curl -I localhost:8080');
    expect(text(all[0]!)).toMatch(/^[0-9a-f]{64}$/);
    expect(text(all[1]!)).toContain('"/docker-entrypoint.…"');
    expect(text(all[1]!)).toContain('Up 3 seconds   0.0.0.0:8080->80/tcp   web');
    expect(text(all[2]!)).toContain('<h1>Welcome to nginx!</h1>');
    expect(text(all[2]!)).toContain('reverse proxy, \nAPI gateway');
    expect(text(all[3]!)).toContain('HTTP/1.1 200 OK\nServer: nginx/1.30.6');
    expect(text(all[3]!)).toContain('Content-Length: 896');
    expect(text(all[3]!)).toContain('ETag: "6abfe677-380"');
    const logs = text(run(state, 'docker logs web'));
    expect(logs).toContain('/docker-entrypoint.sh: Configuration complete; ready for start up');
    expect(logs).toMatch(/"GET \/ HTTP\/1\.1" 200 896 "-" "curl\/8\.5\.0" "-"/);
    expect(kitchenPicture(state).laptop.ports).toEqual([{ host: 8080, container: 'web', containerPort: 80 }]);
  });

  it('orders the PORTS column like the Docker CLI: unpublished and same-number ports first, other mappings last', () => {
    const { state } = runs(kitchen(['nginx:1.30-alpine']), 'docker run -d --name web -p 8080:8080 nginx:1.30-alpine', 'docker run -d --name api -p 9090:80 -p 3000:3000 nginx:1.30-alpine');
    const ps = text(run(state, 'docker ps'));
    // Checked on Docker 29.9: nginx exposes 80; `-p 8080:8080` leaves 80 unpublished.
    expect(ps).toMatch(/Up \d+ seconds\s+80\/tcp, 0\.0\.0\.0:8080->8080\/tcp\s+web/);
    expect(ps).toMatch(/Up \d+ seconds\s+0\.0\.0\.0:3000->3000\/tcp, 0\.0\.0\.0:9090->80\/tcp\s+api/);
  });

  it('quotes arguments with spaces in the COMMAND column, like Docker 29', () => {
    const { state } = runs(kitchen(['alpine:3.22']), 'docker run --name job alpine:3.22 echo "Lunch is ready"', `docker run --name tt alpine:3.22 sh -c 'echo "a b"; exit 0'`);
    expect(text(run(state, 'docker ps -a'))).toContain(`"echo 'Lunch is read…"`);
    // --no-trunc: Go's strconv.Quote escapes the inner double quotes.
    expect(text(run(state, 'docker ps -a --no-trunc'))).toContain(`"sh -c 'echo \\"a b\\"; exit 0'"`);
  });

  it('refuses a second container on the same host port, leaving it Created', () => {
    const { state, last } = runs(kitchen(['nginx:1.30-alpine']), 'docker run -d --name web -p 8080:80 nginx:1.30-alpine', 'docker run -d --name web2 -p 8080:80 nginx:1.30-alpine');
    expect(last.ok).toBe(false);
    expect(last.exitCode).toBe(125);
    expect(text(last)).toMatch(/Bind for 0\.0\.0\.0:8080 failed: port is already allocated\n\nRun 'docker run --help' for more information$/);
    expect(last.explain?.key).toBe('sim.docker.err.portTaken');
    expect(text(run(state, 'docker ps -a'))).toMatch(/Created\s+web2/);
  });

  it('curl: refused without a hatch, reset when the app listens on 127.0.0.1 inside', () => {
    let s = kitchen(['node:24-alpine']);
    expect(text(run(s, 'curl localhost:3000'))).toBe("curl: (7) Failed to connect to localhost port 3000 after 0 ms: Couldn't connect to server");
    expect(run(s, 'curl -s localhost:3000').output).toEqual([]);
    s = runs(s, 'mkdir app', 'cd app').state;
    s = { ...s, fs: { ...s.fs, files: { ...s.fs.files, '/home/you/app/server.js': "require('node:http').createServer((q, r) => r.end('hi\\n')).listen(3000, '127.0.0.1', () => console.log('listening on 127.0.0.1:3000'));\n" } } };
    const r = runs(s, 'docker run -d --name api -p 3000:3000 -v ./:/app -w /app node:24-alpine node server.js', 'curl localhost:3000', 'docker exec api wget -qO- http://localhost:3000');
    expect(text(r.all[1]!)).toBe('curl: (56) Recv failure: Connection reset by peer');
    expect(r.all[1]!.explain?.key).toBe('sim.docker.err.connectionReset');
    expect(text(r.all[2]!)).toBe('hi');
  });

  it('a container with no foreground program exits at once', () => {
    const { state } = runs(kitchen(['alpine:3.22']), 'docker run -d --name box alpine:3.22');
    expect(state.containers[Object.keys(state.containers)[0]!]!.status).toBe('exited');
    expect(text(run(state, 'docker ps -a'))).toContain('"/bin/sh"   3 seconds ago   Exited (0) 3 seconds ago');
  });

  it('postgres without POSTGRES_PASSWORD prints the real error and exits 1', () => {
    const r = run(kitchen(['postgres:18-alpine']), 'docker run --name pg postgres:18-alpine');
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(text(r)).toContain('Error: Database is uninitialized and superuser password is not specified.');
  });

  it('exit codes reach $?', () => {
    const { all } = runs(kitchen(['alpine:3.22']), 'docker run --rm alpine:3.22 sh -c "exit 3"', 'echo $?');
    expect(all[0]!.exitCode).toBe(3);
    expect(text(all[1]!)).toBe('3');
  });

  it('a missing program is a runc error with exit code 127', () => {
    const r = run(kitchen(['alpine:3.22']), 'docker run --rm alpine:3.22 nope');
    expect(r.exitCode).toBe(127);
    expect(text(r)).toContain('exec: "nope": executable file not found in $PATH');
  });

  it('the wrong CPU type: exec format error (255) and a platform warning', () => {
    const r = run(kitchen(['busybox:1.37']), 'docker run --rm --platform linux/arm64 busybox:1.37 echo hi');
    expect(r.exitCode).toBe(255);
    expect(text(r)).toContain('exec /bin/echo: exec format error');
    expect(r.explain?.key).toBe('sim.docker.err.execFormat');
  });

  it('names: conflicts and too-short names are refused like Docker', () => {
    const { last } = runs(kitchen(['alpine:3.22']), 'docker run --name box alpine:3.22', 'docker run --name box alpine:3.22');
    expect(text(last)).toContain('Conflict. The container name "/box" is already in use by container');
    expect(text(run(kitchen(['alpine:3.22']), 'docker run --name b alpine:3.22'))).toContain('Invalid container name (b)');
  });

  it('stop, start, pause, kill, rm: Docker words and exit codes', () => {
    const base = runs(kitchen(['nginx:1.30-alpine']), 'docker run -d --name web nginx:1.30-alpine').state;
    expect(text(run(base, 'docker rm web'))).toBe('Error response from daemon: cannot remove container "web": container is running: stop the container before removing or force remove');
    const stopped = runs(base, 'docker stop web', 'docker ps -a --format "{{.Status}}"');
    expect(text(stopped.last)).toBe('Exited (0) 3 seconds ago');
    const paused = runs(base, 'docker pause web', 'docker ps --format "{{.Names}} {{.Status}}"');
    expect(text(paused.last)).toBe('web Up 6 seconds (Paused)');
    const killed = runs(base, 'docker kill web', 'docker kill web');
    expect(text(killed.all[0]!)).toBe('web');
    expect(text(killed.last)).toMatch(/^Error response from daemon: cannot kill container: web: container [0-9a-f]{64} is not running$/);
    expect(text(run(base, 'docker stop nope'))).toBe('Error response from daemon: No such container: nope');
  });

  it('a node app ignores the polite stop: Docker waits 10 seconds and kills it (137)', () => {
    let s = kitchen(['node:24-alpine']);
    s = runs(s, 'mkdir app').state;
    s.fs.files['/home/you/app/server.js'] = "const http = require('node:http');\nhttp.createServer((q, r) => r.end('ok')).listen(3000, () => console.log('up'));\n";
    const r = runs(s, 'docker run -d --name api -v ./app:/app -w /app node:24-alpine node server.js', 'docker stop api', 'docker ps -a --format "{{.Status}}"');
    expect(r.all[1]!.explain?.key).toBe('sim.docker.explain.stopSlow');
    expect(text(r.last)).toBe('Exited (137) 3 seconds ago');
  });

  it('--rm removes the container when it ends; restart policies bring crashed ones back', () => {
    const rm = runs(kitchen(['alpine:3.22']), 'docker run --rm alpine:3.22 echo hi', 'docker ps -a -q');
    expect(text(rm.all[0]!)).toBe('hi');
    expect(text(rm.last)).toBe('');
    const crash = runs(kitchen(['alpine:3.22']), 'docker run -d --name cc --restart on-failure:3 alpine:3.22 sh -c "exit 1"', 'docker ps -a --format "{{.Status}}"');
    expect(text(crash.last)).toMatch(/^(Restarting \(1\)|Up)/);
  });

  it('docker exec -it opens a shell session; exit returns to the laptop', () => {
    const s = runs(kitchen(['nginx:1.30-alpine']), 'docker run -d --name web nginx:1.30-alpine').state;
    const r = runs(s, 'docker exec -it web sh', 'cd /usr/share/nginx/html', 'ls', 'whoami', 'docker ps', 'exit');
    expect(r.all[0]!.prompt).toBe('/ # ');
    expect(r.all[1]!.prompt).toBe('/usr/share/nginx/html # ');
    expect(text(r.all[2]!)).toBe('50x.html\nindex.html');
    expect(text(r.all[3]!)).toBe('root');
    expect(text(r.all[4]!)).toBe('sh: docker: not found');
    expect(r.last.state.session).toBeNull();
    expect(r.last.state.containers[Object.keys(r.last.state.containers)[0]!]!.status).toBe('running');
  });

  it('docker run -it alpine sh: exiting the main shell stops the container with that code', () => {
    const r = runs(kitchen(['alpine:3.22']), 'docker run -it --name box alpine:3.22 sh', 'echo hello', 'exit 2', 'docker ps -a --format "{{.Names}} {{.Status}}"', 'echo $?');
    expect(text(r.all[1]!)).toBe('hello');
    expect(text(r.all[3]!)).toBe('box Exited (2) 3 seconds ago');
  });

  it('docker cp copies both ways with Docker 29 wording', () => {
    const s = runs(kitchen(['nginx:1.30-alpine']), 'docker run -d --name web -p 8080:80 nginx:1.30-alpine').state;
    s.fs.files['/home/you/index.html'] = '<h1>My diary</h1>\n';
    const r = runs(s, 'docker cp index.html web:/usr/share/nginx/html/', 'curl localhost:8080', 'docker cp web:/etc/nginx/conf.d/default.conf ./copy.conf');
    expect(text(r.all[0]!)).toBe('Successfully copied 18B (transferred 2.05kB) to web:/usr/share/nginx/html/');
    expect(text(r.all[1]!)).toBe('<h1>My diary</h1>');
    expect(text(r.all[2]!)).toBe('Successfully copied 1.07kB (transferred 3.07kB) to /home/you/copy.conf');
  });

  it('inspect --format reads fields, and a missing key is Go template error', () => {
    const s = runs(kitchen(['nginx:1.30-alpine']), 'docker run -d --name web nginx:1.30-alpine').state;
    expect(text(run(s, "docker inspect --format '{{.State.Status}}' web"))).toBe('running');
    expect(text(run(s, "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' web"))).toBe('172.17.0.2');
    expect(text(run(s, "docker inspect -f '{{.NetworkSettings.IPAddress}}' web"))).toBe(
      '\ntemplate parsing error: template: :1:18: executing "" at <.NetworkSettings.IPAddress>: map has no entry for key "IPAddress"',
    );
    const json = JSON.parse(text(run(s, 'docker inspect web')));
    expect(json[0].Config.Image).toBe('nginx:1.30-alpine');
    expect(json[0].HostConfig.RestartPolicy).toEqual({ Name: 'no', MaximumRetryCount: 0 });
  });

  it('docker rm -f $(docker ps -aq) removes every container', () => {
    const { last } = runs(kitchen(['alpine:3.22']), 'docker run --name one alpine:3.22', 'docker run --name two alpine:3.22', 'docker rm -f $(docker ps -aq)', 'docker ps -aq');
    expect(text(last)).toBe('');
  });

  it('ps filters and format', () => {
    const s = runs(kitchen(['alpine:3.22', 'nginx:1.30-alpine']), 'docker run --name one alpine:3.22', 'docker run -d --name web nginx:1.30-alpine').state;
    expect(text(run(s, 'docker ps -a --filter status=exited --format "{{.Names}}"'))).toBe('one');
    expect(text(run(s, 'docker ps --format "table {{.Names}}\\t{{.Image}}"'))).toBe('NAMES     IMAGE\nweb       nginx:1.30-alpine');
  });

  it('the fake clock prints Docker durations', () => {
    expect(humanDuration(0)).toBe('Less than a second');
    expect(humanDuration(1)).toBe('1 second');
    expect(humanDuration(75)).toBe('About a minute');
    expect(humanDuration(3600 * 3)).toBe('3 hours');
    expect(humanDuration(86400 * 9)).toBe('9 days');
    expect(humanSize(26048096)).toBe('26MB');
    expect(humanSize(8192, 4)).toBe('8.192kB');
  });

  it('is deterministic: the same commands give the same ids', () => {
    const a = runs(kitchen(['alpine:3.22']), 'docker run -d alpine:3.22 sleep 100', 'docker ps -q');
    const b = runs(kitchen(['alpine:3.22']), 'docker run -d alpine:3.22 sleep 100', 'docker ps -q');
    expect(text(a.last)).toBe(text(b.last));
    expect(Object.values(a.state.containers)[0]!.name).toBe(Object.values(b.state.containers)[0]!.name);
  });
});
