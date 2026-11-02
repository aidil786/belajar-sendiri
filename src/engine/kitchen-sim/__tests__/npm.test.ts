// npm and `node --test` inside containers, checked on node:24-alpine (Node v24.22.2, npm 11.19.1).
import { describe, expect, it } from 'vitest';
import { kitchen, runs, text, write } from './helpers';

function app(pkg: string, extra: Record<string, string> = {}) {
  let s = runs(kitchen(['node:24-alpine']), 'mkdir app', 'cd app').state;
  s = write(s, 'package.json', pkg);
  for (const [p, c] of Object.entries(extra)) s = write(s, p, c);
  return s;
}

const RUN = 'docker run --rm -v ./:/app -w /app node:24-alpine';

describe('npm test', () => {
  it('runs the test script; `node --test` with no test files prints an empty summary and exits 0', () => {
    const r = runs(app('{"name":"api","version":"1.0.0","scripts":{"test":"node --test"}}'), `${RUN} npm test`, 'echo $?');
    const out = text(r.all[0]!);
    expect(out).toContain('> api@1.0.0 test');
    expect(out).toContain('> node --test');
    expect(out).toContain('ℹ tests 0');
    expect(out).toContain('ℹ fail 0');
    expect(text(r.last)).toBe('0');
  });

  it('a missing test script is npm\'s real error, not an endless loop', () => {
    const r = runs(app('{"name":"api","version":"1.0.0"}'), `${RUN} npm test`, 'echo $?');
    expect(text(r.all[0]!)).toContain('npm error Missing script: "test"');
    expect(text(r.last)).toBe('1');
  });

  it('an unknown npm command gets npm 11\'s answer and exit code 1', () => {
    const r = runs(app('{"name":"api","version":"1.0.0"}'), `${RUN} npm foo`, 'echo $?');
    expect(text(r.all[0]!)).toContain('Unknown command: "foo"');
    expect(text(r.all[0]!)).toContain('  npm help');
    expect(text(r.last)).toBe('1');
  });

  it('with test files present, says plainly that the kitchen does not run them', () => {
    const r = runs(app('{"name":"api","version":"1.0.0","scripts":{"test":"node --test"}}', { 'menu.test.js': "require('node:test');\n" }), `${RUN} npm test`);
    expect(text(r.last)).toContain("can't run test files");
  });
});
