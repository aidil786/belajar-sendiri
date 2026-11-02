import { describe, expect, it } from 'vitest';
import { buildScenario, run, type ScenarioStep, type SimState } from '~/engine/git-sim';
import {
  checkCourierProps,
  courierGoalMet,
  courierView,
  freshIds,
  runAction,
  type CourierOptions,
  type Counters,
} from './courier';

const URL = 'https://github.com/you/diary.git';
const diary: ScenarioStep[] = [
  'mkdir diary',
  'cd diary',
  'git init',
  { write: 'README.md', content: '# My Diary\n' },
  'git add README.md',
  'git commit -m "Add README"',
  { write: 'index.html', content: '<h1>My Diary</h1>\n' },
  'git add index.html',
  'git commit -m "Add home page"',
];
const team: ScenarioStep[] = [
  { server: URL },
  ...diary,
  `git remote add origin ${URL}`,
  'git push -u origin main',
  'mkdir -p /home/aisyah',
  'cd /home/aisyah',
  `git clone ${URL}`,
  'cd diary',
  'git config user.name "Aisyah"',
  'git config user.email "aisyah@example.com"',
  'cd /home/you/diary',
];
const opts: CourierOptions = {
  teammate: { name: 'Aisyah', dir: '/home/aisyah/diary', commits: [{ file: 'index.html', append: '<p>Aisyah was here</p>\n', message: "Add Aisyah's note" }] },
  mine: [{ file: 'style.css', content: 'h1 { color: teal; }\n', message: 'Make titles teal' }],
};
const zero: Counters = { mineUsed: 0, teamUsed: 0 };
const build = (steps: ScenarioStep[]) => buildScenario({ id: 'courier-test', steps });

/** Run actions one after another; return the last result and the counters. */
function chain(state: SimState, actions: string[]) {
  let s = state;
  let c = zero;
  let last = runAction(s, actions[0]!, opts, c);
  for (const a of actions) {
    last = runAction(s, a, opts, c);
    s = last.state;
    c = { mineUsed: last.mineUsed, teamUsed: last.teamUsed };
  }
  return { state: s, last, counters: c };
}

describe('courierView', () => {
  it('shows both sides in sync after the first push', () => {
    const v = courierView(build(team));
    expect(v.laptop).toMatchObject({ where: '~/diary', branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, hasRemote: true, more: 0 });
    expect(v.laptop!.commits.map((c) => [c.message, c.status])).toEqual([
      ['Add home page', 'synced'],
      ['Add README', 'synced'],
    ]);
    expect(v.laptop!.commits[0]!.labels).toEqual([
      { name: 'main', kind: 'branch', head: true },
      { name: 'origin/main', kind: 'remote' },
    ]);
    expect(v.github).toMatchObject({ url: URL, where: 'github.com/you/diary', branch: 'main' });
    expect(v.github!.commits.map((c) => c.status)).toEqual(['synced', 'synced']);
  });

  it('has an empty GitHub side before the first push, and no laptop without a repo', () => {
    const v = courierView(build([{ server: URL }, ...diary]));
    expect(v.laptop).toMatchObject({ upstream: null, hasRemote: false, ahead: 0, behind: 0 });
    expect(v.github!.commits).toEqual([]);
    const none = courierView(build([{ server: URL }]));
    expect(none.laptop).toBeNull();
    expect(none.github).not.toBeNull();
  });

  it('limits the list and counts the rest', () => {
    const v = courierView(build(team), { limit: 1 });
    expect(v.laptop!.commits).toHaveLength(1);
    expect(v.laptop!.more).toBe(1);
  });
});

describe('runAction', () => {
  it('a new commit stays on the laptop; push carries it up', () => {
    const start = build(team);
    const c = runAction(start, 'commit', opts, zero);
    expect(c.ok).toBe(true);
    expect(c.trip).toBeNull();
    expect(c.mineUsed).toBe(1);
    expect(c.explain).toEqual({ key: 'courier.committed', params: { message: 'Make titles teal' } });
    expect(c.lines.map((l) => l.cmd)).toEqual(['git add style.css', 'git commit -m "Make titles teal"']);
    const v = courierView(c.state);
    expect(v.laptop).toMatchObject({ ahead: 1, behind: 0 });
    expect(v.laptop!.commits[0]).toMatchObject({ message: 'Make titles teal', status: 'local' });

    const p = runAction(c.state, 'push', opts, { mineUsed: 1, teamUsed: 0 });
    expect(p.ok).toBe(true);
    expect(p.trip).toMatchObject({ dir: 'up', from: 'laptop', bounced: false, tags: [], dropped: [] });
    expect(p.trip!.commits.map((x) => x.message)).toEqual(['Make titles teal']);
    expect(p.typed).toEqual(['git push']);
    expect(courierView(p.state).laptop).toMatchObject({ ahead: 0, behind: 0 });
    // The commit turns synced on the laptop and appears on GitHub: one id glows on both sides.
    expect([...freshIds(v, courierView(p.state))]).toEqual([v.laptop!.commits[0]!.id]);
  });

  it('runs out of scripted commits kindly', () => {
    const { last } = chain(build(team), ['commit', 'commit']);
    expect(last.ok).toBe(false);
    expect(last.explain).toEqual({ key: 'courier.noMore' });
  });

  it('a teammate push lands on GitHub only; fetch brings it to origin/main; pull joins it', () => {
    const t = runAction(build(team), '@teammate', opts, zero);
    expect(t.ok).toBe(true);
    expect(t.teamUsed).toBe(1);
    expect(t.state.cwd).toBe('/home/you/diary');
    expect(t.trip).toMatchObject({ dir: 'up', from: 'teammate', bounced: false });
    expect(t.trip!.commits.map((x) => x.message)).toEqual(["Add Aisyah's note"]);
    expect(t.explain).toEqual({ key: 'courier.teammatePushed', params: { name: 'Aisyah', message: "Add Aisyah's note" } });
    const v1 = courierView(t.state);
    expect(v1.github!.commits[0]).toMatchObject({ message: "Add Aisyah's note", status: 'remote', by: 'Aisyah' });
    expect(v1.laptop).toMatchObject({ ahead: 0, behind: 0 }); // the laptop doesn't know yet

    const f = runAction(t.state, 'fetch', opts, zero);
    expect(f.trip).toMatchObject({ dir: 'down', from: 'github' });
    expect(f.trip!.commits.map((x) => x.message)).toEqual(["Add Aisyah's note"]);
    const v2 = courierView(f.state);
    expect(v2.laptop).toMatchObject({ ahead: 0, behind: 1 });
    expect(v2.laptop!.commits[0]).toMatchObject({ status: 'fetched', labels: [{ name: 'origin/main', kind: 'remote' }] });
    expect(v2.github!.commits[0]!.status).toBe('synced');

    const p = runAction(f.state, 'pull', opts, zero);
    expect(p.ok).toBe(true);
    expect(p.trip).toBeNull(); // nothing new to carry: it was fetched already
    expect(courierView(p.state).laptop).toMatchObject({ ahead: 0, behind: 0 });
    expect(courierGoalMet(p.state, { branchAt: { main: 'Aisyah' }, aheadBehind: { behind: 0 } }, p.typed)).toBe(true);
  });

  it('a push that GitHub refuses bounces back with what it tried to carry', () => {
    const { state } = chain(build(team), ['@teammate', '@commit']);
    const r = runAction(state, 'push', opts, zero);
    expect(r.ok).toBe(false);
    expect(r.explain?.key).toBe('sim.err.pushFetchFirst');
    expect(r.trip).toMatchObject({ dir: 'up', bounced: true });
    expect(r.trip!.commits.map((x) => x.message)).toEqual(['Make titles teal']);
    expect(r.lines[0]!.output).toContain('! [rejected]');
    // A pull that needs a choice also explains itself (and still fetches).
    const pull = runAction(state, 'pull', opts, zero);
    expect(pull.ok).toBe(false);
    expect(pull.explain?.key).toBe('sim.err.pullDivergent');
    expect(pull.trip?.dir).toBe('down');
    const fix = runAction(pull.state, { cmd: 'git pull --rebase' }, opts, zero);
    expect(fix.ok).toBe(true);
    const push = runAction(fix.state, 'push', opts, zero);
    expect(push.ok).toBe(true);
    expect(courierGoalMet(push.state, { pushed: ['main'], serverHas: { url: URL, branch: 'main', hasMessage: 'Aisyah' } }, push.typed)).toBe(true);
  });

  it('force with lease stops when GitHub moved; a plain force drops the teammate commit', () => {
    let s = run(build(team), 'git commit --amend -m "Add the home page"').state;
    s = runAction(s, '@teammate', opts, zero).state;
    const lease = runAction(s, { cmd: 'git push --force-with-lease' }, opts, zero);
    expect(lease.ok).toBe(false);
    expect(lease.explain?.key).toBe('sim.err.pushStale');
    expect(lease.trip?.bounced).toBe(true);
    const force = runAction(s, { cmd: 'git push --force' }, opts, zero);
    expect(force.ok).toBe(true);
    expect(force.trip!.dropped.map((x) => x.message).sort()).toEqual(["Add Aisyah's note", 'Add home page']);
    expect(force.trip!.commits.map((x) => x.message)).toEqual(['Add the home page']);
  });

  it('tags travel with push --tags, and serverTags goals see them', () => {
    const s = run(build(team), 'git tag -a v1.0.0 -m "First release"').state;
    expect(courierGoalMet(s, { serverTags: ['v1.0.0'] }, [])).toBe(false);
    const plainPush = runAction(s, 'push', opts, zero);
    expect(plainPush.trip).toBeNull();
    expect(plainPush.explain?.key).toBe('sim.explain.pushUpToDate');
    const tags = runAction(s, { cmd: 'git push --tags' }, opts, zero);
    expect(tags.trip).toMatchObject({ dir: 'up', tags: ['v1.0.0'], commits: [] });
    expect(courierGoalMet(tags.state, { serverTags: ['v1.0.0'], tags: ['v1.0.0'] }, tags.typed)).toBe(true);
    expect(courierView(tags.state).github!.commits[0]!.labels).toEqual([
      { name: 'main', kind: 'branch' },
      { name: 'v1.0.0', kind: 'tag' },
    ]);
  });

  it('the first push without -u explains how to set the upstream', () => {
    const s = build([{ server: URL }, ...diary, `git remote add origin ${URL}`]);
    const r = runAction(s, 'push', opts, zero);
    expect(r.ok).toBe(false);
    expect(r.explain?.key).toBe('sim.err.pushNoUpstream');
    expect(r.trip).toBeNull();
    const u = runAction(s, { cmd: 'git push -u origin main' }, opts, zero);
    expect(u.trip!.commits).toHaveLength(2);
    expect(courierGoalMet(u.state, { pushed: ['main'], upstream: { main: 'origin/main' } }, u.typed)).toBe(true);
  });

  it('default specs make simple files', () => {
    const { last, counters } = chain(build(team), ['commit', 'commit']);
    const free: CourierOptions = { teammate: { name: 'Mei Ling', dir: '/home/aisyah/diary' } };
    const a = runAction(build(team), 'commit', free, zero);
    expect(a.lines[1]!.cmd).toBe('git commit -m "Add entry 1"');
    const b = runAction(build(team), 'teammate', free, zero);
    expect(b.explain?.params?.message).toBe("Add Mei Ling's note 1");
    expect(last.ok).toBe(false);
    expect(counters.mineUsed).toBe(1);
  });
});

describe('checkCourierProps', () => {
  it('accepts good props', () => {
    expect(checkCourierProps({ actions: ['push', 'fetch', { cmd: 'git pull --rebase' }] })).toEqual([]);
    expect(checkCourierProps({ commands: ['git push'], label: 'The courier carries main up.' })).toEqual([]);
    expect(checkCourierProps({ actions: ['teammate'], teammate: { name: 'Aisyah', dir: '/home/aisyah/diary' } })).toEqual([]);
  });
  it('explains bad props', () => {
    expect(checkCourierProps({ actions: ['jump'] })).toEqual(['unknown action "jump"']);
    expect(checkCourierProps({ actions: [{ cmd: 'rm -rf /' }] })).toEqual(['a custom action needs cmd: "git ..."']);
    expect(checkCourierProps({ commands: ['git push'] })).toEqual(['a demo (commands) needs a label (text alternative)']);
    expect(checkCourierProps({ commands: ['@teammate'], label: 'x' })).toEqual(['the teammate action needs teammate={{ name, dir: "/home/..." }}']);
  });
});
