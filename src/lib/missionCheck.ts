// Real-world mission checks with the public GitHub REST API.
// No login, no token: only public data. The only host ever called is api.github.com.
// `fetch` is passed in, so tests (and e2e) never touch the real network.

export const API = 'https://api.github.com';

export type MissionCheckType = 'repo' | 'commits' | 'file' | 'profileReadme' | 'pullRequest' | 'workflowRuns' | 'tags' | 'pages';
export const CHECK_TYPES: MissionCheckType[] = ['repo', 'commits', 'file', 'profileReadme', 'pullRequest', 'workflowRuns', 'tags', 'pages'];

export interface MissionCheckSpec {
  type: MissionCheckType;
  /**
   * Suggested repository name (the learner can change it). For `pullRequest`,
   * "owner/name" limits the search to that repository, and "{user}/name" to the
   * learner's own repository of that name.
   */
  repo?: string;
  /** For `file`: path inside the repository, e.g. "README.md". */
  path?: string;
  /** For counts (commits, pullRequest, workflowRuns, tags). Default 1. */
  min?: number;
  label: string;
}

export type NotYetReason = 'notFound' | 'noFile' | 'noReadme' | 'tooFew' | 'noPages';

export type CheckOutcome =
  | { status: 'pass'; count?: number }
  | { status: 'notYet'; reason: NotYetReason; count?: number; need?: number }
  | { status: 'rateLimited'; minutes: number }
  | { status: 'offline' }
  | { status: 'error'; code: number };

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** Checks that look inside one of the learner's repositories. */
export function needsRepo(type: MissionCheckType): boolean {
  return type !== 'profileReadme' && type !== 'pullRequest';
}

const USER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

export const validUser = (u: string) => USER.test(u);
export const validRepo = (r: string) => REPO.test(r) && r !== '.' && r !== '..';

/** Accept "@name", "name" or a pasted profile/repo URL. */
export function cleanUser(input: string): string {
  let s = input.trim().replace(/^@/, '');
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#\s]+)/i.exec(s);
  if (m) s = m[1]!;
  return s;
}

/** Accept "name", "owner/name", "name.git" or a pasted repo URL. */
export function cleanRepo(input: string): string {
  let s = input.trim();
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/[^/\s]+\/([^/?#\s]+)/i.exec(s);
  if (m) s = m[1]!;
  else if (s.includes('/')) s = s.split('/').pop() ?? '';
  return s.replace(/\.git$/i, '');
}

/** Page number of rel="last" in a Link header. */
export function lastPage(link: string | null): number | null {
  if (!link) return null;
  for (const part of link.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="last"/.exec(part);
    if (m) {
      const page = /[?&]page=(\d+)/.exec(m[1]!);
      if (page) return Number(page[1]);
    }
  }
  return null;
}

/** Minutes to wait when GitHub says "slow down", or null if this is not a rate limit. */
export function rateLimitMinutes(status: number, headers: Headers, now = Date.now()): number | null {
  const retry = headers.get('retry-after');
  const remaining = headers.get('x-ratelimit-remaining');
  const reset = headers.get('x-ratelimit-reset');
  const limited = status === 429 || (status === 403 && (remaining === '0' || retry !== null));
  if (!limited) return null;
  if (retry !== null && Number.isFinite(Number(retry))) return Math.max(1, Math.ceil(Number(retry) / 60));
  if (reset !== null && Number.isFinite(Number(reset))) return Math.max(1, Math.ceil((Number(reset) * 1000 - now) / 60_000));
  return 1;
}

interface Got {
  status: number;
  link: string | null;
  json: unknown;
}

type Getter = (path: string) => Promise<Got | CheckOutcome>;

const isOutcome = (x: Got | CheckOutcome): x is CheckOutcome => 'status' in x && typeof x.status === 'string';

/** One GET per URL per round (the answers are cached), with rate-limit and offline handling. */
export function makeGetter(fetcher: Fetcher, now: () => number = Date.now): Getter {
  const cache = new Map<string, Promise<Got | CheckOutcome>>();
  return (path) => {
    const url = `${API}${path}`;
    let p = cache.get(url);
    if (!p) {
      p = (async () => {
        let res: Response;
        try {
          res = await fetcher(url, { headers: { Accept: 'application/vnd.github+json' } });
        } catch {
          return { status: 'offline' } as CheckOutcome;
        }
        const wait = rateLimitMinutes(res.status, res.headers, now());
        if (wait !== null) return { status: 'rateLimited', minutes: wait } as CheckOutcome;
        let json: unknown;
        try {
          json = res.status === 204 ? null : await res.json();
        } catch {
          json = null;
        }
        return { status: res.status, link: res.headers.get('link'), json };
      })();
      cache.set(url, p);
    }
    return p;
  };
}

const enc = encodeURIComponent;
const encPath = (path: string) =>
  path
    .replace(/^\/+/, '')
    .split('/')
    .map((s) => enc(s))
    .join('/');

function countOf(json: unknown, key?: string): number {
  if (Array.isArray(json)) return json.length;
  if (key && json && typeof json === 'object' && typeof (json as Record<string, unknown>)[key] === 'number') {
    return (json as Record<string, number>)[key]!;
  }
  return 0;
}

function enough(count: number, min = 1): CheckOutcome {
  return count >= min ? { status: 'pass', count } : { status: 'notYet', reason: 'tooFew', count, need: min };
}

function other(got: Got): CheckOutcome {
  return got.status === 404 ? { status: 'notYet', reason: 'notFound' } : { status: 'error', code: got.status };
}

/** Run one check for this learner. */
export async function runCheck(spec: MissionCheckSpec, who: { user: string; repo: string }, get: Getter): Promise<CheckOutcome> {
  const u = enc(who.user);
  const r = enc(who.repo);
  const repoPath = `/repos/${u}/${r}`;
  const min = spec.min ?? 1;

  switch (spec.type) {
    case 'repo': {
      const got = await get(repoPath);
      if (isOutcome(got)) return got;
      return got.status === 200 ? { status: 'pass' } : other(got);
    }
    case 'pages': {
      const got = await get(repoPath);
      if (isOutcome(got)) return got;
      if (got.status !== 200) return other(got);
      return (got.json as { has_pages?: boolean } | null)?.has_pages ? { status: 'pass' } : { status: 'notYet', reason: 'noPages' };
    }
    case 'commits': {
      const got = await get(`${repoPath}/commits?per_page=1`);
      if (isOutcome(got)) return got;
      if (got.status === 409) return enough(0, min); // an empty repository
      if (got.status !== 200) return other(got);
      return enough(lastPage(got.link) ?? countOf(got.json), min);
    }
    case 'file': {
      const got = await get(`${repoPath}/contents/${encPath(spec.path ?? 'README.md')}`);
      if (isOutcome(got)) return got;
      if (got.status === 200) return { status: 'pass' };
      return got.status === 404 ? { status: 'notYet', reason: 'noFile' } : other(got);
    }
    case 'profileReadme': {
      const profile = `/repos/${u}/${u}`;
      const repo = await get(profile);
      if (isOutcome(repo)) return repo;
      if (repo.status !== 200) return other(repo);
      const readme = await get(`${profile}/readme`);
      if (isOutcome(readme)) return readme;
      if (readme.status === 200) return { status: 'pass' };
      return readme.status === 404 ? { status: 'notYet', reason: 'noReadme' } : other(readme);
    }
    case 'pullRequest': {
      // "owner/name" limits the search to one repo; "{user}/name" means the learner's own repo.
      const target = spec.repo?.replace(/^\{user\}\//, `${who.user}/`);
      const scope = target?.includes('/') ? ` repo:${target}` : '';
      const got = await get(`/search/issues?q=${enc(`type:pr author:${who.user}${scope}`)}&per_page=1`);
      if (isOutcome(got)) return got;
      if (got.status === 422) return { status: 'notYet', reason: 'notFound' };
      if (got.status !== 200) return other(got);
      return enough(countOf(got.json, 'total_count'), min);
    }
    case 'workflowRuns': {
      const got = await get(`${repoPath}/actions/runs?per_page=1`);
      if (isOutcome(got)) return got;
      if (got.status !== 200) return other(got);
      return enough(countOf(got.json, 'total_count'), min);
    }
    case 'tags': {
      const got = await get(`${repoPath}/tags?per_page=100`);
      if (isOutcome(got)) return got;
      if (got.status !== 200) return other(got);
      return enough(lastPage(got.link) ? 100 : countOf(got.json), min);
    }
  }
}

/**
 * Run checks one after another (gentle on GitHub's limits). Stops early when
 * GitHub asks us to wait or we are offline; later checks stay undefined.
 */
export async function runChecks(
  specs: MissionCheckSpec[],
  repoFor: (spec: MissionCheckSpec) => string,
  user: string,
  fetcher: Fetcher,
  onResult?: (index: number, outcome: CheckOutcome) => void,
  now: () => number = Date.now,
): Promise<(CheckOutcome | undefined)[]> {
  const get = makeGetter(fetcher, now);
  const out: (CheckOutcome | undefined)[] = specs.map(() => undefined);
  for (const [i, spec] of specs.entries()) {
    const outcome = await runCheck(spec, { user, repo: repoFor(spec) }, get);
    out[i] = outcome;
    onResult?.(i, outcome);
    if (outcome.status === 'rateLimited' || outcome.status === 'offline') break;
  }
  return out;
}
