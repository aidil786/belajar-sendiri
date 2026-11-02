// PracticeRepo: a small, clearly labelled *practice* repository page (original design,
// no real-site branding). Lessons set up the situation with data; the learner does one
// task (approve, merge, label, find the failing step…), checked live.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Lang } from '~/i18n';
import {
  availableLabels,
  canReview,
  closingRefs,
  initialState,
  isTaskDone,
  lineText,
  MERGE_METHODS,
  mergeBlockers,
  reduce,
  type Issue,
  type MergeMethod,
  type Pull,
  type PullComment,
  type RepoAction,
  type RepoInfo,
  type RepoState,
  type RepoTask,
  type Rule,
  type Run,
  type StepStatus,
} from '~/lib/practiceRepo';
import MarkdownView from './MarkdownView';
import { Announce, Feedback, cx, pickPraise, useCardEvents, useLearnerName, useT, type T } from './shared';
import './practice-repo.css';

export type RepoScreen = 'code' | 'issues' | 'issue' | 'pulls' | 'pull' | 'pull-files' | 'actions' | 'run' | 'settings' | 'markdown-file';

export interface PracticeRepoProps {
  lang: Lang;
  repo: RepoInfo;
  /** Screen to start on (default "code"). */
  screen?: RepoScreen;
  /** Which issue / pull request number, run id or file path the detail screen shows (default: the first). */
  at?: number | string;
  issues?: Issue[];
  pulls?: Pull[];
  runs?: Run[];
  settings?: { rules?: Rule[] };
  /** Labels the learner can add (default: a usual starter set). */
  labels?: string[];
  task?: RepoTask;
  /** The learner's name in the practice repo (default "you" / "anda"). */
  me?: string;
  success?: string;
}

type Tab = 'code' | 'issues' | 'pulls' | 'actions' | 'settings';
const TAB_OF: Record<RepoScreen, Tab> = {
  code: 'code',
  'markdown-file': 'code',
  issues: 'issues',
  issue: 'issues',
  pulls: 'pulls',
  pull: 'pulls',
  'pull-files': 'pulls',
  actions: 'actions',
  run: 'actions',
  settings: 'settings',
};
const TAB_SCREEN: Record<Tab, RepoScreen> = { code: 'code', issues: 'issues', pulls: 'pulls', actions: 'actions', settings: 'settings' };
const STATUS_ICON: Record<StepStatus, string> = { pass: '✓', fail: '✗', running: '◌', skipped: '⊘' };

type Notice = { kind: 'right' | 'almost'; text: string } | null;

/** "you merged this" → "You merged this" (names start sentences here). */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function StatusBadge({ t, status }: { t: T; status: StepStatus }) {
  return (
    <span className={cx('prepo-status', `is-${status}`)}>
      <span className="prepo-status-icon" aria-hidden="true">
        {STATUS_ICON[status]}
      </span>{' '}
      {t(`repo.status.${status}`)}
    </span>
  );
}

function StateBadge({ t, state }: { t: T; state: 'open' | 'closed' | 'merged' | 'draft' }) {
  const icon = { open: '●', closed: '✓', merged: '⑂', draft: '✎' }[state];
  return (
    <span className={cx('prepo-state', `is-${state}`)}>
      <span aria-hidden="true">{icon} </span>
      {t(`repo.state.${state}`)}
    </span>
  );
}

function Back({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="prepo-back" onClick={onClick}>
      <span aria-hidden="true">← </span>
      {label}
    </button>
  );
}

function Who({ name }: { name: string }) {
  return (
    <span className="prepo-who">
      <span className="prepo-avatar" aria-hidden="true">
        {name.slice(0, 1).toUpperCase()}
      </span>
      {name}
    </span>
  );
}

function Labels({ names }: { names?: string[] }) {
  if (!names?.length) return null;
  return (
    <span className="prepo-labels">
      {names.map((l) => (
        <span key={l} className="prepo-label">
          {l}
        </span>
      ))}
    </span>
  );
}

export default function PracticeRepo(props: PracticeRepoProps) {
  const { lang, repo, issues, pulls, runs, settings, labels, task, success } = props;
  const t = useT(lang);
  const learner = useLearnerName();
  const me = props.me ?? t('repo.you');
  const { ref, emit } = useCardEvents();
  const uid = useId();
  const defaultBranch = repo.defaultBranch ?? 'main';
  const files = repo.files ?? [];
  const readme = repo.readme ?? files.find((f) => /^readme\.md$/i.test(f.path))?.content;

  const [state, setState] = useState<RepoState>(() => initialState({ issues, pulls, runs, rules: settings?.rules }));
  const [view, setView] = useState<{ screen: RepoScreen; at?: number | string }>({ screen: props.screen ?? 'code', at: props.at });
  const [done, setDone] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [announce, setAnnounce] = useState('');
  const main = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const tries = useRef(0);

  // Opening a file from the start counts for an openFile task only when the learner does it.
  useEffect(() => {
    if (!moved.current) return;
    main.current?.focus();
  }, [view]);

  const go = (screen: RepoScreen, at?: number | string) => {
    moved.current = true;
    setNotice(null);
    setView({ screen, at });
  };

  const almost = (text: string) => {
    tries.current++;
    setNotice({ kind: 'almost', text: `${t('feedback.almost')} ${text}` });
    emit('fl:wrong');
  };

  const act = (action: RepoAction, say?: string) => {
    // The task wants one merge method: another method gets a kind retry, not a merged dead end.
    if (task?.type === 'merge' && task.method && !done && action.type === 'merge' && action.pr === task.pr && action.method !== task.method) {
      almost(t('repo.useMethod', { method: t(`repo.method.${task.method}`) }));
      return state;
    }
    const next = reduce(state, action);
    setState(next);
    if (say) setAnnounce(say);
    if (task && !done && isTaskDone(task, next)) {
      setDone(true);
      setNotice(null);
      emit('fl:done', { tries: tries.current });
    }
    return next;
  };

  const openFile = (path: string) => {
    act({ type: 'openFile', path });
    go('markdown-file', path);
  };

  // Which tabs have something to show.
  const tabs: Tab[] = ['code'];
  if (issues?.length || TAB_OF[view.screen] === 'issues') tabs.push('issues');
  if (pulls?.length || TAB_OF[view.screen] === 'pulls') tabs.push('pulls');
  if (runs?.length || TAB_OF[view.screen] === 'actions') tabs.push('actions');
  if (settings?.rules?.length || view.screen === 'settings') tabs.push('settings');
  const counts: Partial<Record<Tab, number>> = {
    issues: state.issues.filter((i) => i.state === 'open').length,
    pulls: state.pulls.filter((p) => p.state === 'open').length,
  };

  const issue = state.issues.find((i) => String(i.number) === String(view.at)) ?? state.issues[0];
  const pull = state.pulls.find((p) => String(p.number) === String(view.at)) ?? state.pulls[0];
  const run = state.runs.find((r) => String(r.id) === String(view.at)) ?? state.runs[0];

  let body: ReactNode;
  switch (view.screen) {
    case 'code':
      body = <CodeScreen t={t} lang={lang} files={files} readme={readme} branch={defaultBranch} onOpen={openFile} />;
      break;
    case 'markdown-file': {
      const path = typeof view.at === 'string' ? view.at : (files[0]?.path ?? '');
      body = <FileScreen t={t} lang={lang} files={files} path={path} onBack={() => go('code')} onOpen={openFile} />;
      break;
    }
    case 'issues':
      body = <IssueList t={t} issues={state.issues} onOpen={(n) => go('issue', n)} />;
      break;
    case 'issue':
      body = issue ? (
        <IssueScreen
          key={issue.number}
          t={t}
          lang={lang}
          issue={issue}
          state={state}
          me={me}
          labels={availableLabels(state, labels)}
          act={act}
          almost={almost}
          onBack={() => go('issues')}
          onPull={(n) => go('pull', n)}
        />
      ) : (
        <div className="prepo-empty">{t('repo.noIssues')}</div>
      );
      break;
    case 'pulls':
      body = <PullList t={t} pulls={state.pulls} onOpen={(n) => go('pull', n)} />;
      break;
    case 'pull':
    case 'pull-files':
      body = pull ? (
        <PullScreen
          key={pull.number}
          t={t}
          lang={lang}
          uid={uid}
          pull={pull}
          state={state}
          me={me}
          files={view.screen === 'pull-files'}
          defaultBranch={defaultBranch}
          act={act}
          almost={almost}
          onBack={() => go('pulls')}
          onTab={(f) => go(f ? 'pull-files' : 'pull', pull.number)}
        />
      ) : (
        <div className="prepo-empty">{t('repo.noPulls')}</div>
      );
      break;
    case 'actions':
      body = <RunList t={t} runs={state.runs} onOpen={(id) => go('run', id)} />;
      break;
    case 'run':
      body = run ? (
        <RunScreen
          key={String(run.id)}
          t={t}
          run={run}
          onBack={() => go('actions')}
          onStep={(job, step) => {
            const status = run.jobs[job]?.steps[step]?.status;
            const watching = task?.type === 'findFailingStep' && String(task.run) === String(run.id);
            act({ type: 'tapStep', run: run.id, job, step });
            if (watching && !done) {
              if (status === 'fail') setNotice({ kind: 'right', text: t('repo.stepFound') });
              else almost(t('repo.stepPassed'));
            }
          }}
        />
      ) : (
        <div className="prepo-empty">{t('repo.noRuns')}</div>
      );
      break;
    case 'settings':
      body = (
        <SettingsScreen
          t={t}
          rules={state.rules}
          branch={defaultBranch}
          onToggle={(rule, on) => act({ type: 'toggleRule', rule, on }, `${state.rules.find((r) => r.id === rule)?.label ?? rule}: ${on ? t('repo.ruleOn') : t('repo.ruleOff')}`)}
        />
      );
      break;
  }

  return (
    <div className="prepo" ref={ref}>
      <div className="prepo-frame">
        <div className="prepo-top">
          <div className="prepo-badge">
            <span aria-hidden="true">🧪 </span>
            {t('repo.practice')}
          </div>
          <div className="prepo-name">
            <span className="prepo-repo-icon" aria-hidden="true">
              ▣
            </span>
            <span>
              {repo.owner} / <strong>{repo.name}</strong>
            </span>
          </div>
          {repo.description && <div className="prepo-desc">{repo.description}</div>}
        </div>
        <nav className="prepo-tabs" aria-label={t('repo.nav')}>
          <ul>
            {tabs.map((tab) => (
              <li key={tab}>
                <button type="button" className="prepo-tab" aria-current={TAB_OF[view.screen] === tab ? 'page' : undefined} onClick={() => go(TAB_SCREEN[tab])}>
                  {t(`repo.tab.${tab}`)}
                  {counts[tab] !== undefined && <span className="prepo-count">{counts[tab]}</span>}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="prepo-main" ref={main} tabIndex={-1}>
          {body}
        </div>
      </div>
      {notice && !done && <Feedback kind={notice.kind}>{notice.text}</Feedback>}
      {done && (
        <Feedback kind="right">{success ?? `${pickPraise(t, learner, tries.current)}${task?.type === 'findFailingStep' ? ` ${t('repo.stepFound')}` : ''}`}</Feedback>
      )}
      <Announce text={announce} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Code and files

function CodeScreen({ t, lang, files, readme, branch, onOpen }: { t: T; lang: Lang; files: { path: string }[]; readme?: string; branch: string; onOpen: (p: string) => void }) {
  return (
    <>
      <div className="prepo-branch">
        <span aria-hidden="true">⑂ </span>
        {branch}
      </div>
      {files.length > 0 && (
        <ul className="prepo-files" aria-label={t('repo.files')}>
          {files.map((f) => (
            <li key={f.path}>
              <button type="button" className="prepo-file" onClick={() => onOpen(f.path)}>
                <span aria-hidden="true">📄 </span>
                {f.path}
              </button>
            </li>
          ))}
        </ul>
      )}
      <section className="prepo-box" aria-label="README.md">
        <div className="prepo-box-head">README.md</div>
        <div className="prepo-box-body">
          {readme ? <MarkdownView lang={lang} source={readme} onRelativeLink={(href) => openRelative(href, '', files, onOpen)} /> : <div className="prepo-empty">{t('repo.noReadme')}</div>}
        </div>
      </section>
    </>
  );
}

/** Follow a relative link inside the practice repo (only to files that exist). */
function openRelative(href: string, from: string, files: { path: string }[], onOpen: (p: string) => void) {
  const clean = href.split(/[?#]/)[0] ?? '';
  if (!clean) return;
  const base = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : '';
  const parts: string[] = [];
  for (const seg of (clean.startsWith('/') ? clean.slice(1) : base + clean).split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  const path = parts.join('/');
  if (files.some((f) => f.path === path)) onOpen(path);
}

function FileScreen({ t, lang, files, path, onBack, onOpen }: { t: T; lang: Lang; files: { path: string; content: string }[]; path: string; onBack: () => void; onOpen: (p: string) => void }) {
  const file = files.find((f) => f.path === path);
  const lines = (file?.content ?? '').replace(/\n$/, '').split('\n');
  return (
    <>
      <Back label={t('repo.allFiles')} onClick={onBack} />
      <section className="prepo-box" aria-label={path}>
        <div className="prepo-box-head">
          {path} <span className="prepo-muted">· {t('repo.lines', { n: lines.length })}</span>
        </div>
        <div className="prepo-box-body">
          {/\.(md|markdown)$/i.test(path) ? (
            <MarkdownView lang={lang} source={file?.content ?? ''} onRelativeLink={(href) => openRelative(href, path, files, onOpen)} />
          ) : (
            <pre className="prepo-codeview">
              {lines.map((l, i) => (
                <span key={i} className="prepo-codeline">
                  <span className="prepo-ln" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span>{l || ' '}</span>
                  {'\n'}
                </span>
              ))}
            </pre>
          )}
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Issues

function IssueList({ t, issues, onOpen }: { t: T; issues: Issue[]; onOpen: (n: number) => void }) {
  if (!issues.length) return <div className="prepo-empty">{t('repo.noIssues')}</div>;
  return (
    <ul className="prepo-list">
      {issues.map((i) => (
        <li key={i.number}>
          <button type="button" className="prepo-row" onClick={() => onOpen(i.number)}>
            <StateBadge t={t} state={i.state} />
            <span className="prepo-row-title">{i.title}</span>
            <span className="prepo-meta">{t('repo.openedBy', { n: i.number, author: i.author })}</span>
            <Labels names={i.labels} />
          </button>
        </li>
      ))}
    </ul>
  );
}

interface IssueScreenProps {
  t: T;
  lang: Lang;
  issue: Issue;
  state: RepoState;
  me: string;
  labels: string[];
  act: (a: RepoAction, say?: string) => RepoState;
  almost: (text: string) => void;
  onBack: () => void;
  onPull: (n: number) => void;
}

function IssueScreen({ t, lang, issue, state, me, labels, act, almost, onBack, onPull }: IssueScreenProps) {
  const id = useId();
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const linked = state.pulls.filter((p) => closingRefs(p.body).includes(issue.number));
  const send = () => {
    if (!text.trim()) return almost(t('repo.needText'));
    act({ type: 'comment', issue: issue.number, body: text, me }, cap(t('repo.commented', { who: me })));
    setText('');
  };
  const toggleLabel = (name: string, on: boolean) => {
    const now = issue.labels ?? [];
    act({ type: 'setLabels', issue: issue.number, labels: on ? [...now, name] : now.filter((l) => l !== name) }, `${name}: ${on ? '✓' : '✕'}`);
  };
  return (
    <>
      <Back label={t('repo.allIssues')} onClick={onBack} />
      <div className="prepo-h">
        {issue.title} <span className="prepo-muted">#{issue.number}</span>
      </div>
      <div className="prepo-sub">
        <StateBadge t={t} state={issue.state} /> <span className="prepo-meta">{t('repo.openedBy', { n: issue.number, author: issue.author })}</span>
      </div>
      <dl className="prepo-side">
        <div>
          <dt>{t('repo.labels')}</dt>
          <dd>
            {issue.labels?.length ? <Labels names={issue.labels} /> : <span className="prepo-muted">{t('repo.noLabels')}</span>}{' '}
            {issue.state === 'open' && (
              <button type="button" className="prepo-link" aria-expanded={editing} aria-controls={editing ? `${id}-labels` : undefined} onClick={() => setEditing(!editing)}>
                {editing ? t('repo.labelsDone') : t('repo.editLabels')}
              </button>
            )}
          </dd>
        </div>
        {issue.milestone && (
          <div>
            <dt>{t('repo.milestone')}</dt>
            <dd>{issue.milestone}</dd>
          </div>
        )}
        {issue.type && (
          <div>
            <dt>{t('repo.type')}</dt>
            <dd>{issue.type}</dd>
          </div>
        )}
      </dl>
      {editing && (
        <fieldset className="prepo-label-pick" id={`${id}-labels`}>
          <legend className="visually-hidden">{t('repo.labels')}</legend>
          {labels.map((l) => (
            <label key={l} className="prepo-check">
              <input type="checkbox" checked={issue.labels?.includes(l) ?? false} onChange={(e) => toggleLabel(l, e.target.checked)} />
              <span className="prepo-label">{l}</span>
            </label>
          ))}
        </fieldset>
      )}
      {linked.length > 0 && (
        <div className="prepo-linked">
          <span aria-hidden="true">⑂ </span>
          {t('repo.linkedPulls', { list: '' })}
          {linked.map((p) => (
            <button key={p.number} type="button" className="prepo-link" onClick={() => onPull(p.number)}>
              #{p.number}
            </button>
          ))}
        </div>
      )}
      <ol className="prepo-timeline">
        <li className="prepo-comment">
          <div className="prepo-comment-head">
            <Who name={issue.author} />
          </div>
          <MarkdownView lang={lang} source={issue.body} breaks className="prepo-comment-body" />
        </li>
        {(issue.comments ?? []).map((c, i) => (
          <li key={i} className={cx('prepo-comment', c.mine && 'is-mine')}>
            <div className="prepo-comment-head">
              <Who name={c.author} /> <span className="prepo-muted">{t('repo.commented', { who: '' }).trim()}</span>
            </div>
            <MarkdownView lang={lang} source={c.body} breaks className="prepo-comment-body" />
          </li>
        ))}
      </ol>
      <div className="prepo-form">
        <label htmlFor={`${id}-c`}>{t('repo.commentLabel')}</label>
        <textarea id={`${id}-c`} className="prepo-input" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="prepo-actions">
          <button type="button" className="btn prepo-btn" onClick={send}>
            {t('repo.commentBtn')}
          </button>
          <button
            type="button"
            className="btn btn-ghost prepo-btn"
            onClick={() => {
              const closing = issue.state === 'open';
              act({ type: 'setIssueState', issue: issue.number, state: closing ? 'closed' : 'open' }, t(`repo.state.${closing ? 'closed' : 'open'}`));
            }}
          >
            {issue.state === 'open' ? t('repo.closeIssue') : t('repo.reopenIssue')}
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Pull requests

function prState(p: Pull): 'open' | 'closed' | 'merged' | 'draft' {
  return p.state === 'open' && p.draft ? 'draft' : p.state;
}

function PullList({ t, pulls, onOpen }: { t: T; pulls: Pull[]; onOpen: (n: number) => void }) {
  if (!pulls.length) return <div className="prepo-empty">{t('repo.noPulls')}</div>;
  return (
    <ul className="prepo-list">
      {pulls.map((p) => (
        <li key={p.number}>
          <button type="button" className="prepo-row" onClick={() => onOpen(p.number)}>
            <StateBadge t={t} state={prState(p)} />
            <span className="prepo-row-title">{p.title}</span>
            <span className="prepo-meta">{t('repo.openedBy', { n: p.number, author: p.author })}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

interface PullScreenProps {
  t: T;
  lang: Lang;
  uid: string;
  pull: Pull;
  state: RepoState;
  me: string;
  files: boolean;
  defaultBranch: string;
  act: (a: RepoAction, say?: string) => RepoState;
  almost: (text: string) => void;
  onBack: () => void;
  onTab: (files: boolean) => void;
}

function PullScreen(p: PullScreenProps) {
  const { t, pull, onBack, onTab, files } = p;
  const changed = pull.files?.length ?? 0;
  return (
    <>
      <Back label={t('repo.allPulls')} onClick={onBack} />
      <div className="prepo-h">
        {pull.title} <span className="prepo-muted">#{pull.number}</span>
      </div>
      <div className="prepo-sub">
        <StateBadge t={t} state={prState(pull)} />{' '}
        <span className="prepo-meta">
          {t('repo.wantsMerge', { author: pull.author })
            .split(/(\{from\}|\{to\})/)
            .map((part, i) => (part === '{from}' ? <code key={i}>{pull.from}</code> : part === '{to}' ? <code key={i}>{pull.to}</code> : <span key={i}>{part}</span>))}
        </span>
      </div>
      <ul className="prepo-subtabs">
        <li>
          <button type="button" aria-current={!files ? 'page' : undefined} onClick={() => onTab(false)}>
            {t('repo.conversation')}
          </button>
        </li>
        <li>
          <button type="button" aria-current={files ? 'page' : undefined} onClick={() => onTab(true)}>
            {t('repo.filesChanged')} <span className="prepo-count">{changed}</span>
          </button>
        </li>
      </ul>
      {files ? <PullFiles {...p} /> : <PullConversation {...p} />}
    </>
  );
}

function PullConversation({ t, lang, uid, pull, state, me, defaultBranch, act, almost }: PullScreenProps) {
  const [editing, setEditing] = useState(false);
  const [draftBody, setDraftBody] = useState(pull.body);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<'commented' | 'approved' | 'changes'>('commented');
  const [method, setMethod] = useState<MergeMethod>('merge');
  const own = !canReview(pull, me) && pull.state === 'open';
  const blockers = mergeBlockers(state, pull.number, method);
  const closes = pull.to === defaultBranch ? closingRefs(pull.body) : [];
  const failing = pull.checks?.some((c) => c.status === 'fail');
  const general = (pull.comments ?? []).filter((c) => c.line === undefined);

  const submit = () => {
    if (kind === 'commented') {
      if (!text.trim()) return almost(t('repo.needText'));
      act({ type: 'comment', pr: pull.number, body: text, me }, cap(t('repo.commented', { who: me })));
    } else {
      if (own) return almost(t('repo.review.own'));
      if (kind === 'changes' && !text.trim()) return almost(t('repo.review.needsBody'));
      act({ type: 'review', pr: pull.number, state: kind, body: text, me }, cap(t(`repo.reviewed.${kind}`, { who: me })));
    }
    setText('');
  };

  return (
    <>
      <ol className="prepo-timeline">
        <li className="prepo-comment">
          <div className="prepo-comment-head">
            <Who name={pull.author} />
            {pull.state === 'open' && !editing && (
              <button
                type="button"
                className="prepo-link"
                onClick={() => {
                  setDraftBody(pull.body);
                  setEditing(true);
                }}
              >
                {t('repo.editBody')}
              </button>
            )}
          </div>
          {editing ? (
            <div className="prepo-form">
              <label htmlFor={`${uid}-body`}>{t('repo.bodyLabel')}</label>
              <textarea id={`${uid}-body`} className="prepo-input" rows={5} value={draftBody} onChange={(e) => setDraftBody(e.target.value)} />
              <div className="prepo-actions">
                <button
                  type="button"
                  className="btn prepo-btn"
                  onClick={() => {
                    act({ type: 'editBody', pr: pull.number, body: draftBody }, t('repo.save'));
                    setEditing(false);
                  }}
                >
                  {t('repo.save')}
                </button>
                <button type="button" className="btn btn-ghost prepo-btn" onClick={() => setEditing(false)}>
                  {t('repo.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <MarkdownView lang={lang} source={pull.body} breaks className="prepo-comment-body" />
          )}
        </li>
        {(pull.reviews ?? []).map((r, i) => (
          <li key={`r${i}`} className={cx('prepo-comment', `is-review-${r.state}`, r.mine && 'is-mine')}>
            <div className="prepo-comment-head">
              <span className="prepo-review-icon" aria-hidden="true">
                {r.state === 'approved' ? '✓' : r.state === 'changes' ? '✎' : '💬'}
              </span>
              {cap(t(`repo.reviewed.${r.state}`, { who: r.author }))}
            </div>
            {r.body && <MarkdownView lang={lang} source={r.body} breaks className="prepo-comment-body" />}
          </li>
        ))}
        {general.map((c, i) => (
          <li key={`c${i}`} className={cx('prepo-comment', c.mine && 'is-mine')}>
            <div className="prepo-comment-head">
              <Who name={c.author} />
            </div>
            <MarkdownView lang={lang} source={c.body} breaks className="prepo-comment-body" />
          </li>
        ))}
        {pull.state === 'merged' && (
          <li className="prepo-event is-merged">
            <span aria-hidden="true">⑂ </span>
            {cap(t('repo.mergedBy', { who: me, method: t(`repo.method.${pull.mergedWith ?? 'merge'}`) }))}
          </li>
        )}
        {pull.state === 'closed' && <li className="prepo-event">{t('repo.closedPr')}</li>}
      </ol>

      {pull.state === 'open' && (
        <section className="prepo-merge" aria-labelledby={`${uid}-merge`}>
          <div className="prepo-box-head" id={`${uid}-merge`}>
            {t('repo.checks')}
          </div>
          {pull.checks?.length ? (
            <ul className="prepo-checks">
              {pull.checks.map((c) => (
                <li key={c.name}>
                  <StatusBadge t={t} status={c.status} /> <span className="prepo-check-name">{c.name}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {closes.length > 0 && <div className="prepo-note">{t('repo.willClose', { list: closes.map((n) => `#${n}`).join(', ') })}</div>}
          {pull.draft && (
            <button type="button" className="btn btn-ghost prepo-btn" onClick={() => act({ type: 'ready', pr: pull.number }, t('repo.ready'))}>
              {t('repo.ready')}
            </button>
          )}
          <fieldset className="prepo-methods">
            <legend>{t('repo.mergeMethod')}</legend>
            {MERGE_METHODS.map((m) => (
              <label key={m} className="prepo-check">
                <input type="radio" name={`${uid}-method`} value={m} checked={method === m} onChange={() => setMethod(m)} />
                <span>{t(`repo.method.${m}`)}</span>
              </label>
            ))}
          </fieldset>
          {blockers.length > 0 ? (
            <div className="prepo-blocked" role="status">
              <div className="prepo-blocked-title">
                <span aria-hidden="true">🔒 </span>
                {t('repo.blocked')}
              </div>
              <ul>
                {blockers.map((b) => (
                  <li key={b}>{t(`repo.block.${b}`)}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="prepo-note">
              {failing && (
                <>
                  <span aria-hidden="true">⚠ </span>
                  {t('repo.checksWarn')}{' '}
                </>
              )}
              {!failing && t('repo.canMerge')}
            </div>
          )}
          <button
            type="button"
            className="btn prepo-btn prepo-merge-btn"
            disabled={blockers.length > 0}
            onClick={() => act({ type: 'merge', pr: pull.number, method, defaultBranch, me }, t('repo.state.merged'))}
          >
            {t('repo.mergeBtn')}
          </button>
        </section>
      )}

      {pull.state === 'open' && (
        <fieldset className="prepo-form prepo-review">
          <legend>{t('repo.reviewTitle')}</legend>
          <label htmlFor={`${uid}-review`} className="visually-hidden">
            {t('repo.commentLabel')}
          </label>
          <textarea id={`${uid}-review`} className="prepo-input" rows={3} value={text} placeholder={t('repo.commentLabel')} onChange={(e) => setText(e.target.value)} />
          <div className="prepo-kinds">
            {(['commented', 'approved', 'changes'] as const).map((k) => (
              <label key={k} className="prepo-check">
                <input type="radio" name={`${uid}-kind`} value={k} checked={kind === k} onChange={() => setKind(k)} />
                <span>{t(`repo.review.${k}`)}</span>
              </label>
            ))}
          </div>
          {own && kind !== 'commented' && <div className="prepo-note">{t('repo.review.own')}</div>}
          <button type="button" className="btn prepo-btn" onClick={submit}>
            {kind === 'commented' ? t('repo.commentBtn') : t('repo.review.submit')}
          </button>
        </fieldset>
      )}
    </>
  );
}

function SuggestionBox({ t, c }: { t: T; c: PullComment }) {
  if (c.suggestion === undefined) return null;
  return (
    <div className="prepo-suggestion">
      <div className="prepo-suggestion-head">{t('repo.suggested')}</div>
      <pre className="prepo-diff">
        <span className="prepo-dl is-del">
          <span className="prepo-dmark" aria-hidden="true">
            −
          </span>
          <span className="visually-hidden">{t('repo.lineRemoved')}: </span>
          {c.original ?? ''}
          {'\n'}
        </span>
        {c.suggestion.split('\n').map((l, i) => (
          <span key={i} className="prepo-dl is-add">
            <span className="prepo-dmark" aria-hidden="true">
              +
            </span>
            <span className="visually-hidden">{t('repo.lineAdded')}: </span>
            {l}
            {'\n'}
          </span>
        ))}
      </pre>
    </div>
  );
}

function PullFiles({ t, lang, uid, pull, me, act, almost }: PullScreenProps) {
  const [open, setOpen] = useState<{ path: string; line: number } | null>(null);
  const [text, setText] = useState('');
  const comments = (pull.comments ?? []).filter((c) => c.line !== undefined);
  const firstPath = pull.files?.[0]?.path;

  const post = (path: string, line: number, original: string) => {
    if (!text.trim()) return almost(t('repo.needText'));
    const m = /```suggestion[^\n]*\n([\s\S]*?)\n?```/.exec(text);
    if (m && (m[1] ?? '').trim() === original.trim()) return almost(t('repo.suggestSame'));
    act({ type: 'lineComment', pr: pull.number, path, line, body: text, me }, cap(t('repo.commented', { who: me })));
    setText('');
    setOpen(null);
  };

  return (
    <>
      {(pull.files ?? []).map((f) => (
        <section key={f.path} className="prepo-box" aria-label={f.path}>
          <div className="prepo-box-head">{f.path}</div>
          <div className="prepo-diff">
            {f.diff.map((raw, i) => {
              const line = i + 1;
              const hunk = raw.startsWith('@@');
              const kind = hunk ? 'hunk' : raw.startsWith('+') ? 'add' : raw.startsWith('-') ? 'del' : 'ctx';
              const here = comments.filter((c) => c.line === line && (c.path ?? firstPath) === f.path);
              const isOpen = open?.path === f.path && open.line === line;
              const content = (
                <>
                  <span className="prepo-dmark" aria-hidden="true">
                    {kind === 'add' ? '+' : kind === 'del' ? '−' : ' '}
                  </span>
                  {kind === 'add' && <span className="visually-hidden">{t('repo.lineAdded')}: </span>}
                  {kind === 'del' && <span className="visually-hidden">{t('repo.lineRemoved')}: </span>}
                  <span className="prepo-dtext">{hunk ? raw : lineText(raw) || ' '}</span>
                </>
              );
              return (
                <div key={i} className="prepo-drow">
                  {hunk || pull.state !== 'open' ? (
                    <div className={cx('prepo-dl', `is-${kind}`)}>{content}</div>
                  ) : (
                    <button
                      type="button"
                      className={cx('prepo-dl', `is-${kind}`, isOpen && 'is-open')}
                      aria-expanded={isOpen}
                      title={t('repo.commentOnLine', { n: line })}
                      onClick={() => {
                        setOpen(isOpen ? null : { path: f.path, line });
                        setText('');
                      }}
                    >
                      <span className="visually-hidden">{t('repo.line', { n: line })}, </span>
                      {content}
                      <span className="prepo-dadd" aria-hidden="true">
                        +💬
                      </span>
                    </button>
                  )}
                  {here.map((c, j) => (
                    <div key={j} className={cx('prepo-inline', c.mine && 'is-mine')}>
                      <div className="prepo-comment-head">
                        <Who name={c.author} />
                      </div>
                      {c.body && <MarkdownView lang={lang} source={c.body} breaks className="prepo-comment-body" />}
                      <SuggestionBox t={t} c={c} />
                    </div>
                  ))}
                  {isOpen && (
                    <div className="prepo-inline prepo-form">
                      <label htmlFor={`${uid}-line`}>{t('repo.commentOnLine', { n: line })}</label>
                      <textarea id={`${uid}-line`} className="prepo-input is-code" rows={4} value={text} autoFocus onChange={(e) => setText(e.target.value)} />
                      <div className="prepo-actions">
                        <button
                          type="button"
                          className="btn btn-ghost prepo-btn"
                          onClick={() => {
                            if (!text.includes('```suggestion')) setText((x) => `${x}${x && !x.endsWith('\n') ? '\n' : ''}\`\`\`suggestion\n${lineText(raw)}\n\`\`\``);
                          }}
                        >
                          {t('repo.suggestBtn')}
                        </button>
                        <button type="button" className="btn prepo-btn" onClick={() => post(f.path, line, lineText(raw))}>
                          {t('repo.addComment')}
                        </button>
                        <button type="button" className="btn btn-quiet prepo-btn" onClick={() => setOpen(null)}>
                          {t('repo.cancel')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Actions

function RunList({ t, runs, onOpen }: { t: T; runs: Run[]; onOpen: (id: string | number) => void }) {
  if (!runs.length) return <div className="prepo-empty">{t('repo.noRuns')}</div>;
  return (
    <ul className="prepo-list">
      {runs.map((r) => (
        <li key={String(r.id)}>
          <button type="button" className="prepo-row" onClick={() => onOpen(r.id)}>
            <StatusBadge t={t} status={r.status} />
            <span className="prepo-row-title">
              {r.workflow} <span className="prepo-muted">#{r.id}</span>
            </span>
            <span className="prepo-meta">{t('repo.runOn', { event: r.event, branch: r.branch })}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function RunScreen({ t, run, onBack, onStep }: { t: T; run: Run; onBack: () => void; onStep: (job: number, step: number) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <Back label={t('repo.allRuns')} onClick={onBack} />
      <div className="prepo-h">
        {run.workflow} <span className="prepo-muted">#{run.id}</span>
      </div>
      <div className="prepo-sub">
        <StatusBadge t={t} status={run.status} /> <span className="prepo-meta">{t('repo.runOn', { event: run.event, branch: run.branch })}</span>
      </div>
      <div className="prepo-note">{t('repo.runSteps')}</div>
      {run.jobs.map((job, ji) => (
        <section key={ji} className="prepo-box" aria-label={job.name}>
          <div className="prepo-box-head">
            <span aria-hidden="true">⚙ </span>
            {job.name}
          </div>
          <ol className="prepo-steps">
            {job.steps.map((s, si) => {
              const key = `${ji}-${si}`;
              const isOpen = open === key;
              return (
                <li key={key} className={cx('prepo-step', `is-${s.status}`)}>
                  <button
                    type="button"
                    className="prepo-step-btn"
                    aria-expanded={isOpen}
                    onClick={() => {
                      setOpen(isOpen ? null : key);
                      onStep(ji, si);
                    }}
                  >
                    <StatusBadge t={t} status={s.status} />
                    <span className="prepo-step-name">{s.name}</span>
                    <span className="prepo-caret" aria-hidden="true">
                      {isOpen ? '▾' : '▸'}
                    </span>
                  </button>
                  {isOpen && <pre className="prepo-log">{s.log?.length ? s.log.join('\n') : t('repo.noLog')}</pre>}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Settings

function SettingsScreen({ t, rules, branch, onToggle }: { t: T; rules: Rule[]; branch: string; onToggle: (rule: string, on: boolean) => void }) {
  return (
    <section className="prepo-box" aria-label={t('repo.rulesFor', { branch })}>
      <div className="prepo-box-head">
        <span aria-hidden="true">🛡 </span>
        {t('repo.rulesFor', { branch })}
      </div>
      {rules.length === 0 ? (
        <div className="prepo-empty">{t('repo.noRules')}</div>
      ) : (
        <ul className="prepo-rules">
          {rules.map((r) => (
            <li key={r.id}>
              <label className="prepo-switch">
                <input type="checkbox" role="switch" checked={r.on} onChange={(e) => onToggle(r.id, e.target.checked)} />
                <span className="prepo-rule-label">{r.label}</span>
                <span className={cx('prepo-onoff', r.on && 'is-on')} aria-hidden="true">
                  {r.on ? t('repo.ruleOn') : t('repo.ruleOff')}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
