// World D2 (Recipes) engine behaviour, each checked against Docker Engine 29.9.2 + BuildKit.
import { describe, expect, it } from 'vitest';
import { findImage, run } from '../index';
import { kitchen, runs, text, write } from './helpers';

function project(images: string[], files: Record<string, string>) {
  let s = runs(kitchen(images), 'mkdir app', 'cd app').state;
  for (const [p, c] of Object.entries(files)) s = write(s, p, c);
  return s;
}

const PKG = '{\n  "name": "api",\n  "version": "1.0.0",\n  "private": true\n}\n';
const LOCK = '{\n  "name": "api",\n  "version": "1.0.0",\n  "lockfileVersion": 3,\n  "requires": true,\n  "packages": {\n    "": {\n      "name": "api",\n      "version": "1.0.0"\n    }\n  }\n}\n';

describe('RUN --mount', () => {
  it('a secret mount needs --secret when required, never lands in history, and labels the stage stage-0', () => {
    const s = project(['node:24-alpine'], {
      'package.json': PKG,
      'package-lock.json': LOCK,
      'token.txt': 'test-token-123\n',
      Dockerfile: 'FROM node:24-alpine\nWORKDIR /app\nCOPY package.json package-lock.json ./\nRUN --mount=type=secret,id=npm_token,env=NPM_TOKEN,required=true npm ci\n',
    });
    const missing = run(s, 'docker build -t api:1.0 .');
    expect(missing.ok).toBe(false);
    expect(text(missing)).toContain('ERROR: failed to build: failed to solve: secret npm_token: not found');
    expect(text(missing)).toContain(' => ERROR [stage-0 4/4] RUN --mount=type=secret,id=npm_token');
    expect(text(run(s, 'docker build --secret id=npm_token,src=nope.txt -t api:1.0 .'))).toBe('ERROR: failed to build: failed to stat nope.txt: stat nope.txt: no such file or directory');
    const r = runs(s, 'docker build --secret id=npm_token,src=token.txt -t api:1.0 .', 'docker history --no-trunc --format "{{.CreatedBy}}" api:1.0');
    expect(r.all[0]!.ok).toBe(true);
    expect(text(r.all[0]!)).toContain(' => [stage-0 4/4] RUN --mount=type=secret,id=npm_token,env=NPM_TOKEN,requi');
    expect(text(r.last).split('\n')[0]).toBe('RUN /bin/sh -c npm ci # buildkit');
    expect(text(r.last)).not.toContain('test-token-123');
    // A new secret value does not bake the step again (BuildKit leaves secrets out of the cache key).
    const again = runs(write(r.state, 'token.txt', 'other-token\n'), 'docker build --secret id=npm_token,src=token.txt -t api:1.0 .');
    expect(text(again.last)).toContain(' => CACHED [stage-0 4/4] RUN --mount=type=secret');
  });

  it('a cache mount runs the command and keeps the flags out of the layer', () => {
    const s = project(['node:24-alpine'], {
      'package.json': PKG,
      'package-lock.json': LOCK,
      Dockerfile: 'FROM node:24-alpine\nWORKDIR /app\nCOPY package.json package-lock.json ./\nRUN --mount=type=cache,target=/root/.npm npm ci\n',
    });
    const r = runs(s, 'docker build -t api:cache .', 'docker history --format "{{.CreatedBy}}" api:cache');
    expect(text(r.all[0]!)).toContain(' => [stage-0 4/4] RUN --mount=type=cache,target=/root/.npm npm ci');
    expect(text(r.last).split('\n')[0]).toBe('RUN /bin/sh -c npm ci # buildkit');
  });
});

describe('platforms', () => {
  it('builds one platform; several at once get a kind note, not a fake build', () => {
    const s = project(['alpine:3.22'], { 'hello.txt': 'hi\n', Dockerfile: 'FROM alpine:3.22\nCOPY hello.txt /hello.txt\nCMD ["cat", "/hello.txt"]\n' });
    const one = runs(s, 'docker build --platform linux/amd64 -t hello:amd64 .', 'docker run --rm hello:amd64');
    expect(text(one.last)).toBe('hi');
    const two = run(s, 'docker buildx build --platform linux/amd64,linux/arm64 -t hello:1.0 .');
    expect(two.ok).toBe(false);
    expect(two.stopped).toBe(true);
    expect(two.explain?.key).toBe('sim.docker.explain.notInSim');
  });
});

describe('BuildKit step names', () => {
  it('fill in ARG and ENV values, and leave unknown ones as written', () => {
    const s = project(['alpine:3.22'], {
      Dockerfile: 'FROM alpine:3.22\nARG SHOP=kancil\nENV GREETING="Selamat datang"\nRUN echo "$GREETING to ${SHOP}, $HOME" > /a.txt\nWORKDIR /w/$SHOP\n',
    });
    const r = run(s, 'docker build --build-arg SHOP=pasar -t menu:1.0 .');
    expect(text(r)).toContain(' => [2/3] RUN echo "Selamat datang to pasar, $HOME" > /a.txt');
    expect(text(r)).toContain(' => [3/3] WORKDIR /w/pasar');
    expect(text(runs(r.state, 'docker history --no-trunc --format "{{.CreatedBy}}" menu:1.0').last)).toContain('RUN |1 SHOP=pasar /bin/sh -c echo "$GREETING to ${SHOP}, $HOME" > /a.txt # buildkit');
  });
});

describe('non-root users', () => {
  it('nginx as USER nginx stops on its cache folder, and runs once it owns its folders', () => {
    const quick = project(['nginx:1.30-alpine'], { Dockerfile: 'FROM nginx:1.30-alpine\nUSER nginx\n' });
    const q = runs(quick, 'docker build -t web:quick .', 'docker run -d --name web web:quick', 'docker ps -a', 'docker logs web');
    expect(text(q.all[2]!)).toMatch(/Exited \(1\)/);
    expect(text(q.last)).toContain('[warn] 1#1: the "user" directive makes sense only if the master process runs with super-user privileges, ignored in /etc/nginx/nginx.conf:2');
    expect(text(q.last)).toContain('nginx: [emerg] mkdir() "/var/cache/nginx/client_temp" failed (13: Permission denied)');

    const cacheOnly = project(['nginx:1.30-alpine'], { Dockerfile: 'FROM nginx:1.30-alpine\nRUN chown -R nginx:nginx /var/cache/nginx\nUSER nginx\n' });
    const c = runs(cacheOnly, 'docker build -t web:half .', 'docker run -d --name web web:half', 'docker logs web');
    expect(text(c.last)).toContain('nginx: [emerg] open() "/run/nginx.pid" failed (13: Permission denied)');

    const good = project(['nginx:1.30-alpine'], {
      'index.html': '<h1>My diary</h1>\n',
      Dockerfile: 'FROM nginx:1.30-alpine\nCOPY index.html /usr/share/nginx/html/\nRUN chown -R nginx:nginx /var/cache/nginx && touch /run/nginx.pid && chown nginx:nginx /run/nginx.pid\nUSER nginx\n',
    });
    // Port 80 is fine: Docker lets non-root processes open low ports inside a container.
    const g = runs(good, 'docker build -t web:1.0 .', 'docker run -d --name web -p 8080:80 web:1.0', 'curl -s localhost:8080', 'docker exec web whoami');
    expect(text(g.all[2]!)).toBe('<h1>My diary</h1>');
    expect(text(g.last)).toBe('nginx');
    expect(findImage(g.state, 'web:1.0')?.config.User).toBe('nginx');
  });

  it('apk as a normal user fails with the message of that Alpine version', () => {
    const s = project(['node:24-alpine', 'alpine:3.22'], {
      'a/Dockerfile': 'FROM node:24-alpine\nUSER node\nRUN apk add --no-cache curl\n',
      'b/Dockerfile': 'FROM alpine:3.22\nUSER guest\nRUN apk add --no-cache curl\n',
    });
    const a = run(s, 'docker build -t oops:a a');
    expect(text(a)).toContain('ERROR: Unable to open log: Permission denied');
    expect(text(a)).toContain('did not complete successfully: exit code: 99');
    expect(text(run(s, 'docker build -t oops:b b'))).toContain('ERROR: Failed to open apk database: Permission denied');
  });
});

describe('health checks', () => {
  it('curl -f fails on an error page, so a check of a missing page turns unhealthy', () => {
    const s = project(['nginx:1.30-alpine'], {
      'index.html': '<h1>My diary</h1>\n',
      Dockerfile: 'FROM nginx:1.30-alpine\nCOPY index.html /usr/share/nginx/html/\nHEALTHCHECK --interval=5s CMD curl -fs http://localhost/health || exit 1\n',
    });
    const r = runs(s, 'docker build -t web:1.0 .', 'docker run -d --name web web:1.0', 'sleep 20', 'docker inspect --format "{{.State.Health.Status}}" web', 'docker exec web curl -f http://localhost/health');
    expect(text(r.all[3]!)).toBe('unhealthy');
    expect(text(r.last)).toBe('curl: (22) The requested URL returned error: 404');
  });
});
