import { describe, expect, it } from 'vitest';
import { findImage, parseDockerfile, run } from '../index';
import { kitchen, runs, text, write } from './helpers';

function diary(images = ['nginx:1.30-alpine']) {
  let s = runs(kitchen(images), 'mkdir diary', 'cd diary').state;
  s = write(s, 'index.html', '<h1>My diary</h1>\n');
  s = write(s, 'style.css', 'body { color: teal; }\n');
  s = write(s, 'notes.txt', 'secret\n');
  s = write(s, '.dockerignore', 'notes.txt\n');
  s = write(s, 'Dockerfile', 'FROM nginx:1.30-alpine\nWORKDIR /usr/share/nginx/html\nCOPY index.html .\nCOPY style.css .\nEXPOSE 80\n');
  return s;
}

describe('docker build', () => {
  it('builds layers, then takes them from the cache, then rebuilds only what changed', () => {
    let s = diary();
    const first = run(s, 'docker build -t diary:1.0 .');
    expect(first.ok).toBe(true);
    const out = text(first);
    expect(out).toMatch(/^\[\+\] Building [\d.]+s \(9\/9\) FINISHED\s+docker:default$/m);
    expect(out).toContain(' => [2/4] WORKDIR /usr/share/nginx/html');
    expect(out).toContain(' => => naming to docker.io/library/diary:1.0');
    expect(first.events.filter((e) => e.type === 'layerBuilt')).toHaveLength(3);
    s = first.state;
    const again = run(s, 'docker build -t diary:1.0 .');
    expect(text(again)).toContain(' => CACHED [3/4] COPY index.html .');
    expect(again.explain?.key).toBe('sim.docker.explain.buildAllCached');
    s = write(again.state, 'style.css', 'body { color: hotpink; }\n');
    const third = run(s, 'docker build -t diary:1.1 .');
    expect(text(third)).toContain(' => CACHED [3/4] COPY index.html .');
    expect(text(third)).toMatch(/ => \[4\/4\] COPY style\.css \.\s+0\.0s/);
    expect(third.state.lastBuild).toMatchObject({ cached: 2, built: 1 });
    // The old image lost its tag: it shows as <untagged>.
    expect(text(run(third.state, 'docker images'))).toContain('<untagged>');
  });

  it('.dockerignore keeps files out of the image; the image serves the copied page', () => {
    const s = runs(diary(), 'docker build -t diary:1.0 .', 'docker run -d --name diary -p 8080:80 diary:1.0').state;
    expect(text(run(s, 'curl localhost:8080'))).toBe('<h1>My diary</h1>');
    expect(text(run(s, 'curl -s localhost:8080/notes.txt'))).toContain('404 Not Found');
  });

  it('history shows the real BuildKit rows on top of the measured base image', () => {
    const s = runs(diary(), 'docker build -t diary:1.0 .').state;
    const h = text(run(s, 'docker history diary:1.0')).split('\n');
    expect(h[0]).toBe('IMAGE          CREATED         CREATED BY                                      SIZE      COMMENT');
    expect(h[1]).toMatch(/EXPOSE \[80\/tcp\]\s+0B\s+buildkit\.dockerfile\.v0$/);
    expect(h[2]).toMatch(/COPY style\.css \. # buildkit\s+24\.6kB/);
    expect(h[4]).toMatch(/WORKDIR \/usr\/share\/nginx\/html\s+4\.1kB/);
    expect(h[h.length - 1]).toMatch(/ADD alpine-minirootfs-3\.24\.3-x86_64\.tar\.gz \/…\s+9\.08MB/);
    const img = findImage(s, 'diary:1.0')!;
    expect(img.diskSize).toBeGreaterThan(92_600_000);
    expect(text(run(s, 'docker images diary'))).toMatch(/diary:1\.0\s+[0-9a-f]{12}\s+92\.7MB\s+26\.1MB/);
  });

  it('shows BuildKit errors with the Dockerfile lines and arrows', () => {
    let s = diary();
    s = write(s, 'Bad.Dockerfile', 'FROM nginx:1.30-alpine\nCOPY missing.txt .\n');
    const r = run(s, 'docker build -t diary:bad -f Bad.Dockerfile .');
    expect(r.ok).toBe(false);
    expect(text(r)).toContain(' > [2/2] COPY missing.txt .:');
    expect(text(r)).toContain('   2 | >>> COPY missing.txt .');
    expect(text(r)).toMatch(/ERROR: failed to build: failed to solve: failed to compute cache key: failed to calculate checksum of ref \w+::\w+: "\/missing\.txt": not found$/);
    s = write(s, 'Bad2.Dockerfile', 'FROM nginx:1.30-alpine\nCOPYY index.html .\n');
    expect(text(run(s, 'docker build -f Bad2.Dockerfile .'))).toContain('ERROR: failed to build: failed to solve: dockerfile parse error on line 2: unknown instruction: COPYY (did you mean COPY?)');
    s = write(s, 'Bad3.Dockerfile', 'FROM alpine:3.22\nRUN exit 3\n');
    expect(text(run(s, 'docker build -f Bad3.Dockerfile .'))).toContain('ERROR: failed to build: failed to solve: process "/bin/sh -c exit 3" did not complete successfully: exit code: 3');
    s = write(s, 'Bad4.Dockerfile', 'FROM alpine:3.22\nRUN curl https://example.com\n');
    expect(text(run(s, 'docker build -f Bad4.Dockerfile .'))).toContain('0.215 /bin/sh: curl: not found');
    expect(text(run(s, 'docker build -t diary:1 -f Nope.Dockerfile .'))).toContain('ERROR: failed to build: failed to solve: failed to read dockerfile: open Nope.Dockerfile: no such file or directory');
  });

  it('build checks warn about shell-form CMD and secrets in ENV', () => {
    let s = runs(kitchen(['node:24-alpine']), 'mkdir api', 'cd api').state;
    s = write(s, 'server.js', "require('http').createServer((q, r) => r.end('ok')).listen(3000);\n");
    s = write(s, 'Dockerfile', 'FROM node:24-alpine\nENV DB_PASSWORD=oops\nWORKDIR /app\nCOPY server.js .\nCMD node server.js\n');
    const r = run(s, 'docker build -t api:1 .');
    expect(text(r)).toContain(' 2 warnings found (use docker --debug to expand):');
    expect(text(r)).toContain(' - SecretsUsedInArgOrEnv: Do not use ARG or ENV instructions for sensitive data (ENV "DB_PASSWORD") (line 2)');
    expect(text(r)).toContain(' - JSONArgsRecommended: JSON arguments recommended for CMD to prevent unintended behavior related to OS signals (line 5)');
  });

  it('multi-stage builds, --target, USER and package installs that add size', () => {
    let s = runs(kitchen(['node:24-alpine', 'alpine:3.22']), 'mkdir app', 'cd app').state;
    s = write(s, 'package.json', '{\n  "name": "app",\n  "dependencies": { "express": "^5.1.0" }\n}\n');
    s = write(s, 'package-lock.json', '{}\n');
    s = write(s, 'server.js', "const express = require('express');\nconst app = express();\napp.get('/', (req, res) => res.json({ ok: true }));\napp.listen(3000, () => console.log('ready'));\n");
    s = write(s, 'Dockerfile', 'FROM node:24-alpine AS build\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\n\nFROM node:24-alpine\nWORKDIR /app\nCOPY --from=build /app .\nUSER node\nEXPOSE 3000\nCMD ["node", "server.js"]\n');
    const r = run(s, 'docker build -t app:1 .');
    expect(r.ok).toBe(true);
    expect(text(r)).toContain(' => [build 4/5] RUN npm ci');
    expect(text(r)).toContain(' => [stage-1 3/3] COPY --from=build /app .');
    const img = findImage(r.state, 'app:1')!;
    expect(img.config.User).toBe('node');
    expect(img.diskSize).toBeGreaterThan(findImage(r.state, 'node:24-alpine')!.diskSize);
    const t = run(r.state, 'docker build -t app:build --target build .');
    expect(text(t)).not.toContain('stage-1');
    const started = runs(r.state, 'docker run -d --name app -p 3000:3000 app:1', 'curl localhost:3000', 'docker exec app whoami');
    expect(text(started.all[1]!)).toBe('{"ok":true}');
    expect(text(started.all[2]!)).toBe('node');
    // apk add grows the image by the measured package size.
    let a = write(r.state, 'Dockerfile.curl', 'FROM alpine:3.22\nRUN apk add --no-cache curl\n');
    a = run(a, 'docker build -t withcurl -f Dockerfile.curl .').state;
    const grown = findImage(a, 'withcurl')!.diskSize - (12_800_000);
    expect(grown).toBeGreaterThan(5_000_000);
  });

  it('a missing express (no npm ci) crashes the app with Node\'s real error', () => {
    let s = runs(kitchen(['node:24-alpine']), 'mkdir app', 'cd app').state;
    s = write(s, 'server.js', "const express = require('express');\nexpress().listen(3000);\n");
    s = write(s, 'Dockerfile', 'FROM node:24-alpine\nWORKDIR /app\nCOPY server.js .\nCMD ["node", "server.js"]\n');
    const r = runs(s, 'docker build -t app:1 .', 'docker run app:1');
    expect(r.last.exitCode).toBe(1);
    expect(text(r.last)).toContain("Error: Cannot find module 'express'\nRequire stack:\n- /app/server.js");
  });

  it('parses continuation lines, comments and stages', () => {
    const p = parseDockerfile('# syntax=docker/dockerfile:1\nARG V=1\nFROM alpine:3.22 AS base\nRUN echo a \\\n  && echo b\nFROM base\nCMD ["sh"]\n');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.stages).toHaveLength(2);
    expect(p.stages[0]!.name).toBe('base');
    expect(p.stages[0]!.instrs[1]!.args).toBe('echo a  && echo b');
    expect(p.globalArgs).toHaveLength(1);
  });

  it('builds for another CPU, which then cannot run here', () => {
    const s = runs(diary(['busybox:1.37']), 'docker build -q --platform linux/arm64 -t armbox .').state;
    const r = run(s, 'docker run --rm armbox');
    expect(r.exitCode).toBe(255);
    expect(text(r)).toContain("WARNING: The requested image's platform (linux/arm64) does not match the detected host platform (linux/amd64/v3) and no specific platform was requested");
    expect(text(r)).toContain('exec /docker-entrypoint.sh: exec format error');
  });
});
