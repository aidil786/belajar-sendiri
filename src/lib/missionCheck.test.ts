import { describe, expect, it } from 'vitest';
import {
  cleanRepo,
  cleanUser,
  lastPage,
  makeGetter,
  rateLimitMinutes,
  runCheck,
  runChecks,
  validRepo,
  validUser,
  type Fetcher,
  type MissionCheckSpec,
} from './missionCheck';

type Route = { status?: number; json?: unknown; headers?: Record<string, string> } | 'offline';

/** A fake fetch: maps exact URLs to answers and records every call. */
function fake(routes: Record<string, Route>) {
  const calls: string[] = [];
  const fetcher: Fetcher = async (url) => {
    calls.push(url);
    const r = routes[url] ?? { status: 404, json: { message: 'Not Found' } };
    if (r === 'offline') throw new TypeError('Failed to fetch');
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status: r.status ?? 200, headers: r.headers });
  };
  return { fetcher, calls };
}

const A = 'https://api.github.com';
const who = { user: 'aina', repo: 'diary' };
const check = async (spec: Omit<MissionCheckSpec, 'label'>, routes: Record<string, Route>) => {
  const { fetcher, calls } = fake(routes);
  const outcome = await runCheck({ label: 'x', ...spec }, who, makeGetter(fetcher, () => 1_800_000_000_000));
  return { outcome, calls };
};

describe('input cleaning', () => {
  it('usernames', () => {
    expect(cleanUser(' @aina ')).toBe('aina');
    expect(cleanUser('https://github.com/aina-dev')).toBe('aina-dev');
    expect(cleanUser('github.com/aina/diary')).toBe('aina');
    expect(validUser('aina-dev')).toBe(true);
    expect(validUser('-aina')).toBe(false);
    expect(validUser('ai--na')).toBe(false);
    expect(validUser('a'.repeat(40))).toBe(false);
    expect(validUser('../x')).toBe(false);
    expect(validUser('')).toBe(false);
  });

  it('repo names', () => {
    expect(cleanRepo('https://github.com/aina/my-diary.git')).toBe('my-diary');
    expect(cleanRepo('aina/diary')).toBe('diary');
    expect(cleanRepo(' diary ')).toBe('diary');
    expect(validRepo('my.site_2-x')).toBe(true);
    expect(validRepo('..')).toBe(false);
    expect(validRepo('a b')).toBe(false);
    expect(validRepo('a?b')).toBe(false);
  });
});

describe('headers', () => {
  it('reads the last page from a Link header', () => {
    const link = '<https://api.github.com/repositories/1/commits?per_page=1&page=2>; rel="next", <https://api.github.com/repositories/1/commits?per_page=1&page=37>; rel="last"';
    expect(lastPage(link)).toBe(37);
    expect(lastPage(null)).toBeNull();
    expect(lastPage('<https://x?page=2>; rel="next"')).toBeNull();
  });

  it('rate limits: reset time, retry-after, or not a limit', () => {
    const now = 1_800_000_000_000;
    const h = (o: Record<string, string>) => new Headers(o);
    expect(rateLimitMinutes(403, h({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(now / 1000 + 600) }), now)).toBe(10);
    expect(rateLimitMinutes(429, h({ 'retry-after': '90' }), now)).toBe(2);
    expect(rateLimitMinutes(429, h({}), now)).toBe(1);
    expect(rateLimitMinutes(403, h({ 'x-ratelimit-remaining': '12' }), now)).toBeNull();
    expect(rateLimitMinutes(404, h({}), now)).toBeNull();
    expect(rateLimitMinutes(403, h({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(now / 1000 - 5) }), now)).toBe(1);
  });
});

describe('checks', () => {
  it('repo: found, not found', async () => {
    expect((await check({ type: 'repo' }, { [`${A}/repos/aina/diary`]: { json: { full_name: 'aina/diary' } } })).outcome).toEqual({ status: 'pass' });
    expect((await check({ type: 'repo' }, {})).outcome).toEqual({ status: 'notYet', reason: 'notFound' });
  });

  it('commits: counts with the Link header, or the list length', async () => {
    const url = `${A}/repos/aina/diary/commits?per_page=1`;
    const link = `<${A}/repositories/9/commits?per_page=1&page=6>; rel="last"`;
    expect((await check({ type: 'commits', min: 5 }, { [url]: { json: [{}], headers: { link } } })).outcome).toEqual({ status: 'pass', count: 6 });
    expect((await check({ type: 'commits', min: 5 }, { [url]: { json: [{}] } })).outcome).toEqual({ status: 'notYet', reason: 'tooFew', count: 1, need: 5 });
    expect((await check({ type: 'commits' }, { [url]: { status: 409, json: { message: 'Git Repository is empty.' } } })).outcome).toEqual({ status: 'notYet', reason: 'tooFew', count: 0, need: 1 });
  });

  it('file: encodes the path', async () => {
    const r = await check({ type: 'file', path: 'docs/My Notes.md' }, { [`${A}/repos/aina/diary/contents/docs/My%20Notes.md`]: { json: {} } });
    expect(r.outcome).toEqual({ status: 'pass' });
    expect((await check({ type: 'file', path: '.github/workflows/ci.yml' }, {})).outcome).toEqual({ status: 'notYet', reason: 'noFile' });
  });

  it('profile README: needs the user/user repo and its README', async () => {
    const repo = `${A}/repos/aina/aina`;
    expect((await check({ type: 'profileReadme' }, { [repo]: { json: {} }, [`${repo}/readme`]: { json: {} } })).outcome).toEqual({ status: 'pass' });
    expect((await check({ type: 'profileReadme' }, { [repo]: { json: {} } })).outcome).toEqual({ status: 'notYet', reason: 'noReadme' });
    expect((await check({ type: 'profileReadme' }, {})).outcome).toEqual({ status: 'notYet', reason: 'notFound' });
  });

  it('pull request: searches by author (optionally one repo)', async () => {
    const any = `${A}/search/issues?q=type%3Apr%20author%3Aaina&per_page=1`;
    expect((await check({ type: 'pullRequest' }, { [any]: { json: { total_count: 3 } } })).outcome).toEqual({ status: 'pass', count: 3 });
    expect((await check({ type: 'pullRequest' }, { [any]: { json: { total_count: 0 } } })).outcome).toMatchObject({ status: 'notYet', reason: 'tooFew' });
    const one = `${A}/search/issues?q=type%3Apr%20author%3Aaina%20repo%3Afahamlah%2Fpractice&per_page=1`;
    expect((await check({ type: 'pullRequest', repo: 'fahamlah/practice' }, { [one]: { json: { total_count: 1 } } })).outcome).toEqual({ status: 'pass', count: 1 });
    expect((await check({ type: 'pullRequest' }, { [any]: { status: 422, json: {} } })).outcome).toEqual({ status: 'notYet', reason: 'notFound' });
    const own = `${A}/search/issues?q=type%3Apr%20author%3Aaina%20repo%3Aaina%2Fdiary&per_page=1`;
    expect((await check({ type: 'pullRequest', repo: '{user}/diary' }, { [own]: { json: { total_count: 2 } } })).outcome).toEqual({ status: 'pass', count: 2 });
  });

  it('workflow runs, tags, pages', async () => {
    expect((await check({ type: 'workflowRuns' }, { [`${A}/repos/aina/diary/actions/runs?per_page=1`]: { json: { total_count: 2, workflow_runs: [{}] } } })).outcome).toEqual({ status: 'pass', count: 2 });
    expect((await check({ type: 'tags', min: 2 }, { [`${A}/repos/aina/diary/tags?per_page=100`]: { json: [{ name: 'v1.0.0' }] } })).outcome).toMatchObject({ status: 'notYet', count: 1 });
    expect((await check({ type: 'pages' }, { [`${A}/repos/aina/diary`]: { json: { has_pages: true } } })).outcome).toEqual({ status: 'pass' });
    expect((await check({ type: 'pages' }, { [`${A}/repos/aina/diary`]: { json: { has_pages: false } } })).outcome).toEqual({ status: 'notYet', reason: 'noPages' });
  });

  it('rate limited, offline, server errors', async () => {
    const url = `${A}/repos/aina/diary`;
    const reset = String(1_800_000_000 + 300);
    expect((await check({ type: 'repo' }, { [url]: { status: 403, json: {}, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset } } })).outcome).toEqual({ status: 'rateLimited', minutes: 5 });
    expect((await check({ type: 'repo' }, { [url]: 'offline' })).outcome).toEqual({ status: 'offline' });
    expect((await check({ type: 'repo' }, { [url]: { status: 500, json: {} } })).outcome).toEqual({ status: 'error', code: 500 });
  });

  it('only ever calls api.github.com, once per URL', async () => {
    const { fetcher, calls } = fake({ [`${A}/repos/aina/diary`]: { json: { has_pages: true } } });
    const specs: MissionCheckSpec[] = [
      { type: 'repo', repo: 'diary', label: 'Repo' },
      { type: 'pages', repo: 'diary', label: 'Pages' },
      { type: 'commits', repo: 'diary', label: 'Commits' },
    ];
    const seen: number[] = [];
    const out = await runChecks(specs, () => 'diary', 'aina', fetcher, (i) => seen.push(i));
    expect(out.map((o) => o?.status)).toEqual(['pass', 'pass', 'notYet']);
    expect(seen).toEqual([0, 1, 2]);
    expect(calls).toEqual([`${A}/repos/aina/diary`, `${A}/repos/aina/diary/commits?per_page=1`]);
    for (const c of calls) expect(new URL(c).host).toBe('api.github.com');
  });

  it('stops early when GitHub asks us to wait', async () => {
    const { fetcher, calls } = fake({ [`${A}/repos/aina/diary`]: { status: 429, json: {}, headers: { 'retry-after': '60' } } });
    const specs: MissionCheckSpec[] = [
      { type: 'repo', label: 'Repo' },
      { type: 'tags', label: 'Tags' },
    ];
    const out = await runChecks(specs, () => 'diary', 'aina', fetcher);
    expect(out).toEqual([{ status: 'rateLimited', minutes: 1 }, undefined]);
    expect(calls).toHaveLength(1);
  });
});
