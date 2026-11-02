// Object X-ray: click a commit to open its tree, then folders and files (blobs).
// Every id is a real SHA-1 from the engine; the panel shows `git cat-file -p` output.
import { useMemo, useRef, useState } from 'react';
import { buildScenario, type Scenario } from '~/engine/git-sim';
import type { Lang } from '~/i18n';
import { xrayCommits, xrayRoute, xrayStart, xrayTarget, xrayView, xrayWrongTurn, type XrayStep, type XrayTask } from '~/lib/objectXray';
import { Announce, Feedback, cx, pickPraise, useCardEvents, useLearnerName, useMotionOK, useT } from './shared';
import './deep-git.css';

export interface ObjectXrayProps {
  lang: Lang;
  scenario: Scenario;
  /** Optional job: find a blob, a tree, or a commit's parent. Done when the learner opens it. */
  task?: XrayTask;
  /** Your own words for the task (default: built from the task). */
  prompt?: string;
  success?: string;
}

const ICON = { commit: '●', tree: '▤', blob: '▢', tag: '⚑' } as const;

export default function ObjectXray({ lang, scenario, task, prompt, success }: ObjectXrayProps) {
  const t = useT(lang);
  const learner = useLearnerName();
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();
  const state = useMemo(() => buildScenario(scenario), [scenario]);
  const commits = useMemo(() => xrayCommits(state), [state]);
  const target = useMemo(() => (task ? xrayTarget(state, task) : null), [state, task]);
  const start = useMemo(() => xrayStart(state, task), [state, task]);
  const [chain, setChain] = useState<XrayStep[]>([]);
  const [feedback, setFeedback] = useState<{ kind: 'right' | 'almost'; text: string } | null>(null);
  const [announce, setAnnounce] = useState('');
  const [done, setDone] = useState(false);
  const panelHead = useRef<HTMLHeadingElement>(null);
  const tries = useRef(0);

  const current = chain[chain.length - 1];
  const view = current ? xrayView(state, current.id) : null;
  const short = (id: string) => id.slice(0, 7);
  const typeName = (type: string) => t(`xray.type.${type}`);
  const pathTask = task && task.type !== 'findParent' ? (task.path ?? '') : '';

  const taskText = (): string => {
    if (!task) return '';
    if (prompt) return prompt;
    if (task.type === 'findBlob') return t('xray.task.findBlob', { path: task.path });
    if (task.type === 'findTree') return task.path ? t('xray.task.findTree', { path: task.path }) : t('xray.task.findRootTree');
    return t('xray.task.findParent', { short: short(start ?? '') });
  };

  const open = (next: XrayStep[]) => {
    setChain(next);
    const step = next[next.length - 1];
    if (!step) return;
    setAnnounce(t('xray.opened', { type: typeName(step.type), short: short(step.id) }));
    // The old panel is replaced, so move focus into the new one: its first id to open, else its heading.
    window.requestAnimationFrame(() => {
      const first = panelHead.current?.closest('.xray-panel')?.querySelector<HTMLButtonElement>('.xray-ref');
      (first ?? panelHead.current)?.focus();
    });
    if (!task || done) return;
    if (step.id === target) {
      setDone(true);
      const key = task.type === 'findBlob' ? 'xray.right.findBlob' : task.type === 'findTree' ? (task.path ? 'xray.right.findTree' : 'xray.right.findRootTree') : 'xray.right.findParent';
      setFeedback({ kind: 'right', text: `${pickPraise(t, learner, tries.current)} ${success ?? t(key, { short: short(step.id), path: pathTask })}` });
      emit('fl:done');
    } else if (xrayWrongTurn(task, step, target)) {
      tries.current++;
      const almost =
        step.type === 'blob'
          ? t('xray.almost.blob', { name: step.via, path: pathTask })
          : t('xray.almost.commit', { short: short(start ?? '') });
      setFeedback({ kind: 'almost', text: almost });
      emit('fl:wrong');
    } else setFeedback(null);
  };

  const hint = () => {
    if (!task) return;
    const route = xrayRoute(state, task);
    const next = route.find((r, i) => chain[i]?.id !== r.id);
    let text: string;
    if (!next) text = t('xray.hint.done');
    else if (route.indexOf(next) === 0) text = t('xray.hint.commit', { short: short(next.id) });
    else if (next.name === 'tree') text = t('xray.hint.tree');
    else if (next.name === 'parent') text = t('xray.hint.parent');
    else text = t('xray.hint.name', { name: next.name });
    setFeedback({ kind: 'almost', text });
    emit('fl:hint');
  };

  if (!commits.length) return <p className="xray-empty">{t('xray.empty')}</p>;

  return (
    <div className={cx('xray', motionOK && 'is-animated')} ref={ref}>
      {task && (
        <p className="xray-task">
          <span aria-hidden="true">🔎 </span>
          {taskText()}
        </p>
      )}
      <h3 className="xray-subtitle" id={`xray-list-${scenario.id}`}>
        {t('xray.pick')}
      </h3>
      <ul className="xray-commits" aria-labelledby={`xray-list-${scenario.id}`}>
        {commits.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className={cx('xray-commit', chain[0]?.id === c.id && 'is-open')}
              aria-pressed={chain[0]?.id === c.id}
              onClick={() => open([{ id: c.id, type: 'commit', via: short(c.id) }])}
            >
              <span className="xray-icon xray-icon-commit" aria-hidden="true">
                {ICON.commit}
              </span>
              <code>{c.short}</code> <span className="xray-msg">{c.message}</span>
              {c.head && <span className="xray-head-tag">HEAD</span>}
            </button>
          </li>
        ))}
      </ul>

      {chain.length > 0 && (
        <nav className="xray-trail" aria-label={t('xray.path')}>
          <ol>
            {chain.map((s, i) => (
              <li key={`${s.id}-${i}`}>
                {i < chain.length - 1 ? (
                  <button type="button" className="xray-crumb" onClick={() => open(chain.slice(0, i + 1))}>
                    <span aria-hidden="true">{ICON[s.type]} </span>
                    {typeName(s.type)} <code>{short(s.id)}</code>
                    {s.via !== short(s.id) && s.via !== 'tree' && s.via !== 'parent' ? ` ${s.via}` : ''}
                  </button>
                ) : (
                  <span className="xray-crumb is-here" aria-current="location">
                    <span aria-hidden="true">{ICON[s.type]} </span>
                    {typeName(s.type)} <code>{short(s.id)}</code>
                    {s.via !== short(s.id) && s.via !== 'tree' && s.via !== 'parent' ? ` ${s.via}` : ''}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}

      {view && current && (
        <section className={cx('xray-panel', `xray-panel-${view.type}`)} key={`${view.id}-${chain.length}`} aria-labelledby={`xray-h-${scenario.id}`}>
          <h3 className="xray-panel-head" id={`xray-h-${scenario.id}`} tabIndex={-1} ref={panelHead}>
            <span className={cx('xray-badge', `xray-badge-${view.type}`)}>
              <span aria-hidden="true">{ICON[view.type]} </span>
              {typeName(view.type)}
            </span>{' '}
            <code className="xray-id">{view.id}</code>
          </h3>
          <p className="xray-meta">{t('xray.size', { size: view.size })}</p>
          <pre className="xray-body">
            <code className="xray-cmd">$ git cat-file -p {view.short}</code>
            {'\n'}
            {view.lines.map((l, i) => (
              <span className="xray-line" key={i}>
                {l.text}
                {l.ref && (
                  <button
                    type="button"
                    className={cx('xray-ref', `xray-ref-${l.ref.type}`)}
                    onClick={() => open([...chain, { id: l.ref!.id, type: l.ref!.type, via: l.ref!.name ?? (l.text.startsWith('parent') ? 'parent' : 'tree') }])}
                  >
                    {/* The name screen readers hear starts with what the button does, then the id you see. */}
                    <span className="visually-hidden">
                      {l.ref.name ? t('xray.openNamed', { type: typeName(l.ref.type), name: l.ref.name }) : t('xray.open', { type: typeName(l.ref.type) })}{' '}
                    </span>
                    {l.ref.id}
                  </button>
                )}
                {l.after}
                {'\n'}
              </span>
            ))}
          </pre>
          <p className="xray-caption">{t(`sim.explain.catFilePretty.${view.type}`)}</p>
        </section>
      )}

      {task && !done && (
        <div className="xray-actions">
          <button type="button" className="btn btn-quiet" onClick={hint}>
            {t('xray.hintBtn')}
          </button>
        </div>
      )}
      {feedback && <Feedback kind={feedback.kind}>{feedback.text}</Feedback>}
      <Announce text={announce} />
    </div>
  );
}
