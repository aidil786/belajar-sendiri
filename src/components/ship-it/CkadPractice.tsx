// CKAD practice: one hands-on task per screen in FoodCourtSim (lazy-loaded, like the night shift
// drills), checked live by the engine. "Skip", "Back" and "Next" are always there (nothing is
// locked). Exam mode (Settings) adds a count-up timer and the docs-only rule card, and hides hints.
// Results: tasks done per domain, and the ones to try again with their docs link.
// Rendered with client:only on /<lang>/ship-it/exam/ckad/. Saves after every task (fahamlah:exams:v1).
import { useStore } from '@nanostores/react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { KubeGoal, KubeScenario } from '~/engine/foodcourt-sim';
import type { Lang } from '~/i18n';
import { celebrate } from '~/lib/celebrate';
import { loadExams, newSeed, pickSet, saveAttempt, saveInProgress, scoreByDomain, targetMinutes, type InProgress } from '~/lib/mockExam';
import { $progress, dayKey } from '~/stores/progress';
import Inline from '../interactives/Inline';
import { Feedback, useT } from '../interactives/shared';
import { DomainScores, MockProgress, MockTimer, shortDay } from './examParts';
import LoadGuard from './LoadGuard';
import './night-shift.css';
import './exam.css';

const KubeSim = lazy(() => import('../interactives/KubeSim'));

/** One task, already in the page's language, with its starting cluster. */
export interface CkadView {
  id: string;
  domain: string;
  task: string;
  hint: string;
  docs: { label: string; url: string };
  scenario: KubeScenario;
  goal: KubeGoal;
}

export interface CkadPracticeProps {
  lang: Lang;
  tasks: CkadView[];
  domains: { id: string; weight: number; name: string }[];
  /** Tasks in a set (15), the real exam's minutes (120) for that many tasks. */
  size: number;
  fullMinutes: number;
  /** The sites the real exam allows (shown in exam mode). */
  examDocs: readonly string[];
  hubHref: string;
}

type Phase = 'start' | 'task' | 'results';
const SOLVED = 1;
const SKIPPED = 0;

export default function CkadPractice({ lang, tasks, domains, size, fullMinutes, examDocs, hubHref }: CkadPracticeProps) {
  const t = useT(lang);
  const settings = useStore($progress).settings;
  const exam = settings.examMode;
  const byId = useMemo(() => new Map(tasks.map((x) => [x.id, x])), [tasks]);
  const names = useMemo(() => Object.fromEntries(domains.map((d) => [d.id, d.name])), [domains]);
  const setSize = Math.min(size, tasks.length);
  const target = targetMinutes(setSize, size, fullMinutes);

  const [saved] = useState(() => {
    const store = loadExams();
    const cur = store.current.ckad;
    const usable = cur && cur.ids.every((id) => byId.has(id)) ? cur : null;
    const last = store.attempts.filter((a) => a.exam === 'ckad').at(-1) ?? null;
    return { cur: usable, last };
  });
  const [cur, setCur] = useState<InProgress | null>(saved.cur);
  const [phase, setPhase] = useState<Phase>('start');
  const [canSave, setCanSave] = useState(true);
  const [justSolved, setJustSolved] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const resultsHead = useRef<HTMLHeadingElement>(null);
  const simWrap = useRef<HTMLDivElement>(null);
  const curRef = useRef(cur);
  curRef.current = cur;

  const persist = (next: InProgress | null) => {
    setCur(next);
    setCanSave(saveInProgress('ckad', next));
  };

  const begin = () => {
    const seed = newSeed();
    const ids = pickSet(tasks, size, seed, domains).map((x) => x.id);
    persist({ seed, mode: exam ? 'exam' : 'learn', ids, at: 0, answers: {}, started: Date.now() });
    setJustSolved(false);
    setPhase('task');
  };

  const resume = () => {
    setJustSolved(false);
    setPhase('task');
  };

  useEffect(() => {
    if (phase === 'task') heading.current?.focus();
    if (phase === 'results') resultsHead.current?.focus();
  }, [phase, cur?.at]);

  // The simulator says "fl:done" (a bubbling DOM event) when the task's goal is met.
  useEffect(() => {
    const el = simWrap.current;
    if (!el || phase !== 'task') return;
    const onDone = (e: Event) => {
      const c = curRef.current;
      const id = c?.ids[c.at];
      if (!c || !id) return;
      if (e.target instanceof Element) celebrate(e.target, 22);
      setJustSolved(true);
      persist({ ...c, answers: { ...c.answers, [id]: SOLVED } });
    };
    el.addEventListener('fl:done', onDone);
    return () => el.removeEventListener('fl:done', onDone);
  }, [phase, cur?.at]);

  const items = cur ? cur.ids.map((id) => byId.get(id)!).filter(Boolean) : [];
  const results = cur ? scoreByDomain(items.map((x) => ({ domain: x.domain, right: cur.answers[x.id] === SOLVED })), domains) : null;

  const finishedFor = useRef<number | null>(null);
  useEffect(() => {
    if (phase !== 'results' || !cur || !results || finishedFor.current === cur.seed) return;
    finishedFor.current = cur.seed;
    setCanSave(
      saveAttempt({
        exam: 'ckad',
        day: dayKey(),
        mode: cur.mode,
        right: results.right,
        total: results.total,
        domains: results.domains.map(({ domain, right, total }) => ({ domain, right, total })),
      }),
    );
    if (resultsHead.current && results.right > 0) celebrate(resultsHead.current, 30);
  }, [phase, cur, results]);

  const rules = exam && (
    <section className="ns-exam mock-rules" aria-labelledby="mock-rules-h" data-exam-card>
      <h2 id="mock-rules-h">{t('exam.rulesTitle')}</h2>
      <ul>
        <li>
          {t('exam.rulesDocs')}{' '}
          {examDocs.map((d, i) => (
            <span key={d}>
              <a href={`https://${d}/`} rel="noopener">
                {d}
              </a>
              {i < examDocs.length - 1 ? ', ' : ''}
            </span>
          ))}
        </li>
        <li>{t('exam.rulesHints')}</li>
        <li>{t('exam.rulesKind')}</li>
      </ul>
    </section>
  );

  // ---------------------------------------------------------------- start screen
  if (phase === 'start') {
    const resumable = cur && cur.at < cur.ids.length;
    return (
      <div className="mock" data-mock="ckad" data-phase="start">
        {resumable && (
          <p>
            <button type="button" className="btn btn-big" onClick={resume} data-mock-continue>
              {t('mock.continueTask', { x: cur.at + 1, y: cur.ids.length })}
            </button>
          </p>
        )}
        <p className="mock-meta">
          {t('mock.setSizeTasks', { n: setSize })} {exam ? t('mock.timerOn', { n: target }) : t('mock.timerOff')}
        </p>
        <p>
          <button type="button" className={resumable ? 'btn btn-ghost' : 'btn btn-big'} onClick={begin} data-mock-start>
            {resumable ? t('mock.startNew') : t('mock.start')}
          </button>
        </p>
        {saved.last && (
          <p className="mock-last" data-mock-last>
            {t('mock.lastTasks', { right: saved.last.right, total: saved.last.total, day: shortDay(saved.last.day, lang) })}
          </p>
        )}
        {!canSave && <p className="mock-note">{t('mock.saveBlocked')}</p>}
      </div>
    );
  }

  if (!cur) return null;

  // ---------------------------------------------------------------- results
  if (phase === 'results' && results) {
    const open = items.filter((x) => cur.answers[x.id] !== SOLVED);
    return (
      <div className="mock" data-mock="ckad" data-phase="results">
        <h2 ref={resultsHead} tabIndex={-1} className="mock-results-h">
          {t('mock.results')}
        </h2>
        <p className="mock-score" data-mock-score>
          {t('mock.scoreTasks', { right: results.right, total: results.total, percent: results.percent })}
        </p>
        <h3>{t('mock.byDomain')}</h3>
        <DomainScores t={t} scores={results.domains} names={names} />
        <p className="mock-note">{t('mock.realPass')}</p>
        <h3>{t('mock.reviewTasks')}</h3>
        {open.length === 0 ? (
          <p data-mock-no-misses>{t('mock.reviewNoneTasks')}</p>
        ) : (
          <ol className="mock-review" data-mock-review>
            {open.map((x) => (
              <li key={x.id} data-review={x.id}>
                <p className="mock-review-q">
                  <Inline text={x.task} />
                </p>
                <p className="mock-review-mine">{t('mock.notDone')}</p>
                <p>
                  <a href={x.docs.url} rel="noopener">
                    {x.docs.label}
                  </a>
                </p>
              </li>
            ))}
          </ol>
        )}
        <div className="mock-actions">
          <button type="button" className="btn btn-big" onClick={begin} data-mock-again>
            {t('mock.tryAgain')}
          </button>
          <a className="btn btn-ghost" href={hubHref}>
            {t('mock.backHub')}
          </a>
        </div>
        {!canSave && <p className="mock-note">{t('mock.saveBlocked')}</p>}
      </div>
    );
  }

  // ---------------------------------------------------------------- one task
  const task = items[cur.at]!;
  const solved = cur.answers[task.id] === SOLVED;
  const last = cur.at >= cur.ids.length - 1;
  const go = (to: number, skip: boolean) => {
    const answers = skip && !solved ? { ...cur.answers, [task.id]: SKIPPED } : cur.answers;
    persist({ ...cur, answers, at: to });
    setJustSolved(false);
    if (to >= cur.ids.length) setPhase('results');
  };

  return (
    <div className="mock" data-mock="ckad" data-phase="task" data-task-solved={solved ? 'true' : 'false'}>
      <MockProgress t={t} at={cur.at} total={cur.ids.length} labelKey="mock.task" />
      {rules}
      {exam && <MockTimer t={t} started={cur.started} target={target} calm={settings.calm} />}
      <p className="mock-domain" data-task-domain={task.domain}>
        {t('mock.domain', { name: names[task.domain] ?? task.domain })}
      </p>
      <h2 className="mock-question" ref={heading} tabIndex={-1} data-task={task.id}>
        <Inline text={task.task} />
      </h2>
      <p className="mock-docs">
        {t('mock.docs')}{' '}
        <a href={task.docs.url} rel="noopener" data-task-docs>
          {task.docs.label}
        </a>
      </p>
      <p className="mock-docs" data-task-tools>
        <Inline text={t('mock.ckadTools')} />
      </p>
      {!exam && (
        <details className="ns-help mock-hint" data-task-hint>
          <summary>{t('mock.hint')}</summary>
          <p>
            <Inline text={task.hint} />
          </p>
        </details>
      )}
      <div className="ns-sim" ref={simWrap}>
        <LoadGuard
          fallback={
            <div className="feedback feedback-almost ns-load-failed" role="status">
              <p>{t('nightshift.loadFailed')}</p>
              <button type="button" className="btn btn-ghost" onClick={() => window.location.reload()}>
                {t('nightshift.reload')}
              </button>
            </div>
          }
        >
          <Suspense fallback={<p className="ns-loading">{t('nightshift.loading')}</p>}>
            <KubeSim key={`${cur.seed}-${task.id}`} lang={lang} scenario={task.scenario} goal={task.goal} hints={[]} success={t('mock.solved')} />
          </Suspense>
        </LoadGuard>
      </div>
      {solved && !justSolved && <Feedback kind="right">{t('mock.solvedBefore')}</Feedback>}
      <div className="mock-actions">
        {cur.at > 0 && (
          <button type="button" className="btn btn-ghost" onClick={() => go(cur.at - 1, false)} data-mock-back>
            ← {t('mock.back')}
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={() => go(cur.at + 1, true)} data-mock-skip>
          {t('mock.skip')}
        </button>
        <button type="button" className="btn btn-big" onClick={() => go(cur.at + 1, true)} data-mock-next>
          {last ? t('mock.finish') : `${t('mock.next')} →`}
        </button>
      </div>
      {!canSave && <p className="mock-note">{t('mock.saveBlocked')}</p>}
    </div>
  );
}
