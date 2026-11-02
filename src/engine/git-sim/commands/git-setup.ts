// git --version, help, config, init.
import { fail, line, lines, ok } from '../output';
import { resolve } from '../paths';
import { clone, dirExists, ensureDir, fileExists, findRepo, getConfig, newRepo } from '../state';
import { Args } from '../parse';
import type { CommandFn, Line } from '../types';

export const USAGE: Record<string, string[]> = {
  init: ['usage: git init [-b <branch-name>] [<directory>]'],
  config: [
    'usage: git config [<options>]',
    '   or: git config [--global | --local] <name> [<value>]',
    '   or: git config --list',
  ],
  status: ['usage: git status [<options>] [--] [<pathspec>...]', '', '    -s, --short           show status concisely'],
  add: [
    'usage: git add [<options>] [--] <pathspec>...',
    '',
    '    -A, --all             add changes from all tracked and untracked files',
    '    -p, --patch           select hunks interactively',
    '    -u, --update          update tracked files',
    '    -f, --force           allow adding otherwise ignored files',
  ],
  commit: [
    'usage: git commit [<options>] [--] <pathspec>...',
    '',
    '    -m, --message <message>  commit message',
    '    -a, --all                commit all changed files',
    '    --amend                  amend previous commit',
    '    --no-edit                use the selected message without launching an editor',
  ],
  log: [
    'usage: git log [<options>] [<revision-range>] [[--] <path>...]',
    '',
    '    --oneline             one line per commit',
    '    --graph               draw a text graph of the history',
    '    --all                 show all branches',
    '    -n <number>           limit the number of commits',
  ],
  show: ['usage: git show [<options>] <object>...'],
  diff: [
    'usage: git diff [<options>] [<commit>] [--] [<path>...]',
    '   or: git diff [<options>] --staged [<commit>] [--] [<path>...]',
    '   or: git diff [<options>] <commit> <commit> [--] [<path>...]',
  ],
  rm: [
    'usage: git rm [-f | --force] [--cached] [-r] [--] <pathspec>...',
    '',
    '    --cached              only remove from the index',
    '    -f, --force           override the up-to-date check',
  ],
  mv: ['usage: git mv [<options>] <source>... <destination>'],
  restore: [
    'usage: git restore [<options>] [--source=<branch>] <file>...',
    '',
    '    -s, --source <tree-ish>  which tree-ish to checkout from',
    '    -S, --staged             restore the index',
    '    -W, --worktree           restore the working tree (default)',
  ],
  reset: [
    'usage: git reset [--mixed | --soft | --hard] [<commit>]',
    '   or: git reset [<tree-ish>] [--] <pathspec>...',
  ],
  revert: ['usage: git revert [--[no-]edit] <commit>...'],
  checkout: [
    'usage: git checkout [<options>] <branch>',
    '   or: git checkout [<options>] [<branch>] -- <file>...',
    '',
    '    -b <branch>           create and checkout a new branch',
  ],
  switch: [
    'usage: git switch [<options>] [<branch>]',
    '',
    '    -c, --create <branch>  create and switch to a new branch',
    '    -C, --force-create <branch>',
    '                          create/reset and switch to a branch',
    '    -d, --detach          detach HEAD at named commit',
  ],
  branch: [
    'usage: git branch [<options>] [-r | -a] [--merged] [--no-merged]',
    '   or: git branch [<options>] <branch-name> [<start-point>]',
    '   or: git branch [<options>] (-m | -M) [<old-branch>] <new-branch>',
    '   or: git branch [<options>] (-d | -D) <branch-name>...',
  ],
  merge: [
    'usage: git merge [<options>] [<commit>...]',
    '   or: git merge --abort',
    '   or: git merge --continue',
    '',
    '    --ff-only             abort if fast-forward is not possible',
    '    --no-ff               always create a merge commit',
  ],
  rebase: [
    'usage: git rebase [-i] [options] [<upstream> [<branch>]]',
    '   or: git rebase --continue | --abort | --skip',
  ],
  'cherry-pick': [
    'usage: git cherry-pick [--edit] [-n] [-m <parent-number>] [-s] [-x] [--ff] <commit>...',
    '   or: git cherry-pick (--continue | --skip | --abort | --quit)',
  ],
  stash: [
    'usage: git stash list [<log-options>]',
    '   or: git stash show [-u | --include-untracked | --only-untracked] [<diff-options>] [<stash>]',
    '   or: git stash drop [-q | --quiet] [<stash>]',
    '   or: git stash pop [--index] [-q | --quiet] [<stash>]',
    '   or: git stash apply [--index] [-q | --quiet] [<stash>]',
    '   or: git stash clear',
    '   or: git stash [push [-u | --include-untracked] [-m | --message <message>]]',
  ],
  tag: [
    'usage: git tag [-a | -s | -u <key-id>] [-f] [-m <msg> | -F <file>] <tagname> [<commit> | <object>]',
    '   or: git tag -d <tagname>...',
    '   or: git tag [-n[<num>]] -l [<pattern>...]',
  ],
  remote: [
    'usage: git remote [-v | --verbose]',
    '   or: git remote add [-t <branch>] [-m <master>] [-f] [--tags | --no-tags] [--mirror=<fetch|push>] <name> <url>',
    '   or: git remote rename [--[no-]progress] <old> <new>',
    '   or: git remote remove <name>',
    '   or: git remote set-url [--push] <name> <newurl> [<oldurl>]',
  ],
  push: [
    'usage: git push [<options>] [<repository> [<refspec>...]]',
    '',
    '    -u, --set-upstream    set upstream for git pull/status',
    '    --tags                push tags (can\'t be used with --all or --branches or --mirror)',
    '    --force-with-lease[=<refname>:<expect>]',
    '                          require old value of ref to be at this value',
    '    -d, --delete          delete refs',
  ],
  fetch: ['usage: git fetch [<options>] [<repository> [<refspec>...]]', '   or: git fetch --all [<options>]'],
  pull: [
    'usage: git pull [<options>] [<repository> [<refspec>...]]',
    '',
    '    -r, --rebase          incorporate changes by rebasing rather than merging',
    '    --ff-only             abort if fast-forward is not possible',
  ],
  clone: ['usage: git clone [<options>] [--] <repo> [<dir>]'],
  clean: [
    'usage: git clean [-d] [-f] [-n] [--] <pathspec>...',
    '',
    '    -n, --dry-run         dry run',
    '    -f, --force           force',
    '    -d                    remove whole directories',
  ],
  reflog: ['usage: git reflog [show] [<log-options>] [<ref>]'],
  help: ['usage: git help [<command>]'],
  // World 10
  'cat-file': [
    'usage: git cat-file <type> <object>',
    '   or: git cat-file (-e | -p) <object>',
    '   or: git cat-file (-t | -s) <object>',
  ],
  'hash-object': ['usage: git hash-object [-t <type>] [-w] <file>...'],
  'ls-tree': [
    'usage: git ls-tree [<options>] <tree-ish> [<path>...]',
    '',
    '    -d                    only show trees',
    '    -r                    recurse into subtrees',
    '    -t                    show trees when recursing',
    '    -l, --long            include object size',
    '    --name-only           list only filenames',
  ],
  'rev-parse': [
    'usage: git rev-parse --parseopt [<options>] -- [<args>...]',
    '   or: git rev-parse --sq-quote [<arg>...]',
    '   or: git rev-parse [<options>] [<arg>...]',
  ],
  'show-ref': [
    'usage: git show-ref [--head] [-d | --dereference]',
    '                    [-s | --hash[=<n>]] [--abbrev[=<n>]] [--branches] [--tags]',
    '                    [--] [<pattern>...]',
  ],
  'pack-refs': ['usage: git pack-refs [--all] [--no-prune]'],
  grep: [
    'usage: git grep [<options>] [-e] <pattern> [<rev>...] [[--] <path>...]',
    '',
    '    -n, --line-number     show line numbers',
    '    -i, --ignore-case     case insensitive matching',
    '    -w, --word-regexp     match patterns only at word boundaries',
    '    -c, --count           show the number of matches instead of matching lines',
    '    -l, --files-with-matches',
    '                          show only filenames instead of matching lines',
  ],
  blame: ['usage: git blame [<options>] [<rev-opts>] [<rev>] [--] <file>', '', '    -L <range>            process only line range <start>,<end>', '    -e, --show-email      show author email instead of name'],
  shortlog: [
    'usage: git shortlog [<options>] [<revision-range>] [[--] <path>...]',
    '   or: git log --pretty=short | git shortlog [<options>]',
    '',
    '    -n, --numbered        sort output according to the number of commits per author',
    '    -s, --summary         suppress commit descriptions, only provides commit count',
    '    -e, --email           show the email address of each author',
  ],
  bisect: [
    'usage: git bisect [help|start|bad|good|new|old|terms|skip|next|reset|visualize|view|replay|log|run]',
  ],
  worktree: [
    'usage: git worktree add [-f] [--detach] [--checkout] [--lock [--reason <string>]]',
    '                        [--orphan] [(-b | -B) <new-branch>] <path> [<commit-ish>]',
    '   or: git worktree list [-v | --porcelain [-z]]',
    '   or: git worktree prune [-n] [-v] [--expire <expire>]',
    '   or: git worktree remove [-f] <worktree>',
  ],
};

export const version: CommandFn = (state) =>
  ok(state, [line(`git version ${state.gitVersion}`)], [], { key: 'sim.explain.version' });

export const help: CommandFn = (state, args) => {
  const topic = args.find((a) => !a.startsWith('-'));
  if (topic) {
    const usage = USAGE[topic];
    if (!usage) {
      return fail(state, lines(`No manual entry for git-${topic}`), 'noManual', { key: 'sim.err.noManual', params: { cmd: topic } });
    }
    return ok(
      state,
      [
        line(`GIT-${topic.toUpperCase()}(1)`, 'bold'),
        line(''),
        ...usage.map((u) => line(u)),
        line(''),
        line(`Full manual: https://git-scm.com/docs/git-${topic}`, 'cyan'),
      ],
      [],
      { key: 'sim.explain.helpTopic', params: { cmd: topic } },
    );
  }
  const out: Line[] = [
    line('usage: git [-v | --version] [-h | --help] <command> [<args>]'),
    line(''),
    line('start a working area', 'bold'),
    line('   clone      Clone a repository into a new directory'),
    line('   init       Create an empty Git repository'),
    line(''),
    line('work on the current change', 'bold'),
    line('   add        Add file contents to the index'),
    line('   mv         Move or rename a file'),
    line('   restore    Restore working tree files'),
    line('   rm         Remove files from the working tree and from the index'),
    line(''),
    line('examine the history and state (see also: git help revisions)', 'bold'),
    line('   bisect     Use binary search to find the commit that introduced a bug'),
    line('   diff       Show changes between commits, commit and working tree, etc'),
    line('   grep       Print lines matching a pattern'),
    line('   log        Show commit logs'),
    line('   show       Show various types of objects'),
    line('   status     Show the working tree status'),
    line(''),
    line('grow, mark and tweak your common history', 'bold'),
    line('   branch     List, create, or delete branches'),
    line('   commit     Record changes to the repository'),
    line('   merge      Join two or more development histories together'),
    line('   rebase     Reapply commits on top of another base tip'),
    line('   reset      Reset current HEAD to the specified state'),
    line('   revert     Revert some existing commits'),
    line('   switch     Switch branches'),
    line('   tag        Create, list, delete or verify a tag object'),
    line(''),
    line('collaborate', 'bold'),
    line('   fetch      Download objects and refs from another repository'),
    line('   pull       Fetch from and integrate with another repository or a local branch'),
    line('   push       Update remote refs along with associated objects'),
    line(''),
    line("See 'git help <command>' to read about a specific subcommand."),
  ];
  return ok(state, out, [], { key: 'sim.explain.help' });
};

const VALID_KEY = /^[a-zA-Z][a-zA-Z0-9-]*(\.[^\s=]+)?\.[a-zA-Z][a-zA-Z0-9-]*$/;

function normKey(key: string): string {
  const first = key.indexOf('.');
  const last = key.lastIndexOf('.');
  if (first === -1) return key.toLowerCase();
  // Section and variable names are case-insensitive; a middle subsection is not.
  return `${key.slice(0, first).toLowerCase()}${key.slice(first, last)}.${key.slice(last + 1).toLowerCase()}`;
}

export const config: CommandFn = (state, rawArgs) => {
  // Newer style: git config list | get | set | unset
  let args = rawArgs;
  type Sub = 'list' | 'get' | 'set' | 'unset';
  const SUBS: Sub[] = ['list', 'get', 'set', 'unset'];
  let sub: Sub | null = null;
  if (SUBS.includes(args[0] as Sub)) {
    sub = args[0] as Sub;
    args = args.slice(1);
  }
  const a = new Args(args, { flags: ['--global', '--local', '--list', '-l', '--get', '--unset', '--system', '--get-regexp', '--name-only'] });
  if (a.unknown.length) {
    return fail(state, lines(`error: unknown option '${a.unknown[0]!.replace(/^-+/, '')}'`), 'badOption', {
      key: 'sim.err.badOption',
      params: { option: a.unknown[0]! },
    });
  }
  if (a.has('--system')) {
    return fail(state, lines('error: this practice terminal has no system config. Use --global.'), 'noSystem');
  }
  const repo = findRepo(state);
  const isList = sub === 'list' || a.has('--list', '-l');
  const scope = a.has('--global') ? 'global' : a.has('--local') ? 'local' : null;

  if (scope === 'local' && !repo) {
    return fail(state, lines('fatal: --local can only be used inside a git repository'), 'notARepo', { key: 'sim.err.notARepo' });
  }

  if (isList) {
    const out: Line[] = [];
    if (scope !== 'local') for (const [k, v] of Object.entries(state.globalConfig)) out.push(line(`${k}=${v}`));
    if (scope !== 'global' && repo) {
      out.push(line('core.repositoryformatversion=0'));
      for (const [k, v] of Object.entries(repo.config)) out.push(line(`${k}=${v}`));
    }
    return ok(state, out, [], { key: 'sim.explain.configList' });
  }

  // `git config --get-regexp alias`: every key matching a regex, as "key value".
  if (a.has('--get-regexp')) {
    let re: RegExp;
    try {
      re = new RegExp(a.positional[0] ?? '');
    } catch {
      return fail(state, lines(`error: invalid key pattern: ${a.positional[0]}`), 'badKey', { key: 'sim.err.configKey', params: { key: a.positional[0] ?? '' } });
    }
    const out: Line[] = [];
    const entries = [
      ...(scope !== 'local' ? Object.entries(state.globalConfig) : []),
      ...(scope !== 'global' && repo ? Object.entries(repo.config) : []),
    ];
    for (const [k, v] of entries) if (re.test(k)) out.push(line(a.has('--name-only') ? k : `${k} ${v}`));
    if (!out.length) return { state, output: [], events: [], ok: false, explain: { key: 'sim.explain.configMissing', params: { key: a.positional[0] ?? '' } } };
    return ok(state, out, [], { key: 'sim.explain.configGetRegexp', params: { pattern: a.positional[0] ?? '' } });
  }

  const [rawKey, ...valueParts] = a.positional;
  if (!rawKey) return help(state, ['config'], { raw: '' });
  if (!rawKey.includes('.')) {
    return fail(state, lines(`error: key does not contain a section: ${rawKey}`), 'badKey', {
      key: 'sim.err.configKey',
      params: { key: rawKey },
    });
  }
  if (!VALID_KEY.test(rawKey)) {
    return fail(state, lines(`error: invalid key: ${rawKey}`), 'badKey', { key: 'sim.err.configKey', params: { key: rawKey } });
  }
  const key = normKey(rawKey);

  if (sub === 'unset' || a.has('--unset')) {
    const next = clone(state);
    const target = scope === 'global' || !repo ? next.globalConfig : findRepo(next)!.config;
    if (!(key in target)) return fail(state, [], 'configMissing');
    delete target[key];
    return ok(next, [], [], { key: 'sim.explain.configUnset', params: { key } });
  }

  const isGet = sub === 'get' || a.has('--get') || valueParts.length === 0;
  if (isGet) {
    let value: string | undefined;
    if (scope === 'global') value = state.globalConfig[key];
    else if (scope === 'local') value = repo?.config[key];
    else value = getConfig(state, repo, key);
    if (value === undefined) {
      return { state, output: [], events: [], ok: false, explain: { key: 'sim.explain.configMissing', params: { key } } };
    }
    return ok(state, [line(value)], [], { key: 'sim.explain.configGet', params: { key } });
  }

  const value = valueParts.join(' ');
  const useScope = scope ?? 'local';
  if (useScope === 'local' && !repo) {
    return fail(state, lines('fatal: not in a git directory'), 'notARepo', { key: 'sim.err.configNeedsGlobal' });
  }
  const next = clone(state);
  if (useScope === 'global') next.globalConfig[key] = value;
  else findRepo(next)!.config[key] = value;
  if (key.startsWith('alias.')) {
    return ok(next, [], [{ type: 'configSet', key, value, scope: useScope }], {
      key: 'sim.explain.configAlias',
      params: { alias: key.slice(6), cmd: value },
    });
  }
  return ok(next, [], [{ type: 'configSet', key, value, scope: useScope }], {
    key: useScope === 'global' ? 'sim.explain.configSetGlobal' : 'sim.explain.configSetLocal',
    params: { key, value },
  });
};

export const init: CommandFn = (state, args) => {
  const a = new Args(args, { flags: ['-q', '--quiet'], values: ['-b', '--initial-branch'] });
  if (a.unknown.length) {
    return fail(state, lines(`error: unknown option '${a.unknown[0]!.replace(/^-+/, '')}'`), 'badOption', {
      key: 'sim.err.badOption',
      params: { option: a.unknown[0]! },
    });
  }
  const dirArg = a.positional[0];
  const root = dirArg ? resolve(state.cwd, dirArg, state.home) : state.cwd;
  if (fileExists(state, root)) {
    return fail(state, lines(`fatal: cannot mkdir ${dirArg}: File exists`), 'fileExists');
  }
  const next = clone(state);
  if (!dirExists(next, root)) ensureDir(next, root);
  if (next.repos[root]) {
    return ok(next, a.has('-q', '--quiet') ? [] : [line(`Reinitialized existing Git repository in ${root}/.git/`)], [
      { type: 'repoInitialized', root, reinit: true },
    ], { key: 'sim.explain.reinit' });
  }
  const configured = next.globalConfig['init.defaultbranch'];
  const branch = a.get('-b', '--initial-branch') ?? configured ?? 'master';
  const out: Line[] = [];
  if (!a.get('-b', '--initial-branch') && !configured) {
    out.push(
      ...lines(
        [
          "hint: Using 'master' as the name for the initial branch. This default branch name",
          'hint: is subject to change. To configure the initial branch name to use in all',
          'hint: of your new repositories, which will suppress this warning, call:',
          'hint:',
          'hint: \tgit config --global init.defaultBranch <name>',
          'hint:',
          "hint: Names commonly chosen instead of 'master' are 'main', 'trunk' and",
          "hint: 'development'. The just-created branch can be renamed via this command:",
          'hint:',
          'hint: \tgit branch -m <name>',
        ].join('\n'),
        'yellow',
      ),
    );
  }
  next.repos[root] = newRepo(root, branch);
  if (!a.has('-q', '--quiet')) out.push(line(`Initialized empty Git repository in ${root}/.git/`));
  return ok(next, out, [{ type: 'repoInitialized', root, reinit: false }], {
    key: configured || a.get('-b', '--initial-branch') ? 'sim.explain.init' : 'sim.explain.initMaster',
    params: { branch },
  });
};
