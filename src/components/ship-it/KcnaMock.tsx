// The KCNA mock: one question per screen (ADHD rule 1), a progress bar and "question X of Y",
// learn mode (kind feedback after each question, try again) or exam style (feedback at the end),
// an optional timer in exam mode (Settings), results per domain and a review list with lesson links.
// Rendered with client:only on /<lang>/ship-it/exam/kcna/, so saved settings and the separate
// attempts store (fahamlah:exams:v1) are read before the first paint. Saves after every answer.
import { useStore } from '@nanostores/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Lang } from '~/i18n';
import { celebrate } from '~/lib/celebrate';
import { loadExams, newSeed, optionOrder, pickSet, saveAttempt, saveInProgress, scoreByDomain, targetMinutes, type InProgress, type Mode } from '~/lib/mockExam';
import { $progress, dayKey } from '~/stores/progress';
import Inline from '../interactives/Inline';
import { Feedback, cx, pickPraise, useLearnerName, useT } from '../interactives/shared';
import { DomainScores, MockProgress, MockTimer, shortDay } from './examParts';
import '../interactives/quiz.css';
import './exam.css';

/** One question, already in the page's language. */
export interface KcnaView {
  id: string;
  domain: string;
  question: string;
  options: string[];
  why: string;
  answer: number;
  lesson: { href: string; title: string };
}

export interface KcnaMockProps {
  lang: Lang;
  questions: KcnaView[];
  /** Domains in the official order, with their weight and name in the page's language. */
  domains: { id: string; weight: number; name: string }[];
  /** Questions in a mock (60), the real exam's count and minutes (60, 90). */
  size: number;
  fullCount: number;
  fullMinutes: number;
  hubHref: string;
}

type Phase = 'start' | 'quiz' | 'results';

export default function KcnaMock({ lang, questions, domains, size, fullCount, fullMinutes, hubHref }: KcnaMockProps) {
  const t = useT(lang);
  const name = useLearnerName();
  const settings = useStore($progress).settings;
  const byId = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);
  const names = useMemo(() => Object.fromEntries(domains.map((d) => [d.id, d.name])), [domains]);
  const setSize = Math.min(size, questions.length);
  const target = targetMinutes(setSize, fullCount, fullMinutes);

  // An unfinished set is kept only if every question is still in the bank.
  const [saved] = useState(() => {
    const store = loadExams();
    const cur = store.current.kcna;
    const usable = cur && cur.ids.every((id) => byId.has(id)) ? cur : null;
    const last = store.attempts.filter((a) => a.exam === 'kcna').at(-1) ?? null;
    return { cur: usable, last };
  });
  const [cur, setCur] = useState<InProgress | null>(saved.cur);
  const [phase, setPhase] = useState<Phase>('start');
  const [mode, setMode] = useState<Mode>(saved.cur?.mode ?? 'learn');
  const [canSave, setCanSave] = useState(true);
  // Learn mode, this screen only: the option picked last (display position) and whether it was right.
  const [picked, setPicked] = useState<number | null>(null);
  const [tries, setTries] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const resultsHead = useRef<HTMLHeadingElement>(null);

  const persist = (next: InProgress | null) => {
    setCur(next);
    setCanSave(saveInProgress('kcna', next));
  };

  const begin = (m: Mode) => {
    const seed = newSeed();
    const ids = pickSet(questions, size, seed, domains).map((q) => q.id);
    persist({ seed, mode: m, ids, at: 0, answers: {}, started: Date.now() });
    setPicked(null);
    setTries(0);
    setPhase('quiz');
  };

  const resume = () => {
    if (!cur) return;
    setMode(cur.mode);
    setPicked(null);
    setTries(0);
    setPhase(cur.at >= cur.ids.length ? 'results' : 'quiz');
  };

  // Move focus to the new question (or the results) so keyboard and screen-reader users start there.
  useEffect(() => {
    if (phase === 'quiz') heading.current?.focus();
    if (phase === 'results') resultsHead.current?.focus();
  }, [phase, cur?.at]);

  const items = cur ? cur.ids.map((id) => byId.get(id)!).filter(Boolean) : [];
  const results = cur
    ? scoreByDomain(
        items.map((q) => ({ domain: q.domain, right: cur.answers[q.id] === q.answer })),
        domains,
      )
    : null;

  // Celebrate and save once, when the results first show.
  const finishedFor = useRef<number | null>(null);
  useEffect(() => {
    if (phase !== 'results' || !cur || !results || finishedFor.current === cur.seed) return;
    finishedFor.current = cur.seed;
    setCanSave(
      saveAttempt({
        exam: 'kcna',
        day: dayKey(),
        mode: cur.mode,
        right: results.right,
        total: results.total,
        domains: results.domains.map(({ domain, right, total }) => ({ domain, right, total })),
      }),
    );
    if (resultsHead.current) celebrate(resultsHead.current, 30);
  }, [phase, cur, results]);

  // ---------------------------------------------------------------- start screen
  if (phase === 'start') {
    const resumable = cur && cur.at < cur.ids.length;
    return (
      <div className="mock" data-mock="kcna" data-phase="start">
        {resumable && (
          <p>
            <button type="button" className="btn btn-big" onClick={resume} data-mock-continue>
              {t('mock.continue', { x: cur.at + 1, y: cur.ids.length })}
            </button>
          </p>
        )}
        <fieldset className="mock-modes">
          <legend>{t('mock.modeLabel')}</legend>
          {(['learn', 'exam'] as const).map((m) => (
            <label key={m} className="mock-mode">
              <input type="radio" name="kcna-mode" value={m} checked={mode === m} onChange={() => setMode(m)} />
              <span>{t(m === 'learn' ? 'mock.modeLearn' : 'mock.modeExam')}</span>
            </label>
          ))}
        </fieldset>
        <p className="mock-meta">
          {t('mock.setSize', { n: setSize })} {settings.examMode ? t('mock.timerOn', { n: target }) : t('mock.timerOff')}
        </p>
        <p>
          <button type="button" className={cx('btn', resumable ? 'btn-ghost' : 'btn-big')} onClick={() => begin(mode)} data-mock-start>
            {resumable ? t('mock.startNew') : t('mock.start')}
          </button>
        </p>
        {saved.last && (
          <p className="mock-last" data-mock-last>
            {t('mock.lastScore', { right: saved.last.right, total: saved.last.total, day: shortDay(saved.last.day, lang) })}
          </p>
        )}
        {!canSave && <p className="mock-note">{t('mock.saveBlocked')}</p>}
      </div>
    );
  }

  if (!cur) return null;

  // ---------------------------------------------------------------- results
  if (phase === 'results' && results) {
    const misses = items.filter((q) => cur.answers[q.id] !== q.answer);
    return (
      <div className="mock" data-mock="kcna" data-phase="results">
        <h2 ref={resultsHead} tabIndex={-1} className="mock-results-h">
          {t('mock.results')}
        </h2>
        <p className="mock-score" data-mock-score>
          {t('mock.score', { right: results.right, total: results.total, percent: results.percent })}
        </p>
        <h3>{t('mock.byDomain')}</h3>
        <DomainScores t={t} scores={results.domains} names={names} />
        <p className="mock-note">{t('mock.realPass')}</p>

        <h3>{t('mock.review')}</h3>
        {misses.length === 0 ? (
          <p data-mock-no-misses>{t('mock.reviewNone')}</p>
        ) : (
          <ol className="mock-review" data-mock-review>
            {misses.map((q) => {
              const mine = cur.answers[q.id];
              return (
                <li key={q.id} data-review={q.id}>
                  <p className="mock-review-q">
                    <Inline text={q.question} />
                  </p>
                  <p className="mock-review-mine">
                    {mine === undefined || mine < 0 ? (
                      t('mock.noAnswer')
                    ) : (
                      <>
                        {t('mock.yourAnswer')} <Inline text={q.options[mine] ?? ''} />
                      </>
                    )}
                  </p>
                  <p className="mock-review-right">
                    <span aria-hidden="true">✓ </span>
                    {t('mock.rightAnswer')} <Inline text={q.options[q.answer] ?? ''} />
                  </p>
                  <p className="mock-review-why">
                    <Inline text={q.why} />
                  </p>
                  <p>
                    <a href={q.lesson.href} data-review-lesson>
                      {t('mock.readLesson', { title: q.lesson.title })} →
                    </a>
                  </p>
                </li>
              );
            })}
          </ol>
        )}
        <div className="mock-actions">
          <button type="button" className="btn btn-big" onClick={() => begin(cur.mode)} data-mock-again>
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

  // ---------------------------------------------------------------- one question
  const q = items[cur.at]!;
  const order = optionOrder(cur.seed, q.id, q.options.length);
  const recorded = cur.answers[q.id];
  const learn = cur.mode === 'learn';
  const solved = learn && picked !== null && order[picked] === q.answer;
  const last = cur.at >= cur.ids.length - 1;

  const choose = (pos: number) => {
    const dataIndex = order[pos]!;
    if (learn) {
      if (solved) return;
      setPicked(pos);
      setTries((n) => n + 1);
      // Only the first answer counts for the score (-1: skipped before, so this is the first).
      if (recorded === undefined || recorded < 0) persist({ ...cur, answers: { ...cur.answers, [q.id]: dataIndex } });
    } else {
      persist({ ...cur, answers: { ...cur.answers, [q.id]: dataIndex } });
    }
  };

  const go = (to: number) => {
    // Moving on without an answer counts as blank (-1); going back changes nothing.
    const answers = recorded === undefined && to > cur.at ? { ...cur.answers, [q.id]: -1 } : cur.answers;
    const next = { ...cur, answers, at: to };
    persist(next);
    setPicked(null);
    setTries(0);
    if (to >= cur.ids.length) setPhase('results');
  };

  const shownPick = learn ? picked : recorded !== undefined && recorded >= 0 ? order.indexOf(recorded) : null;
  const current = shownPick === null ? null : q.options[order[shownPick]!];

  return (
    <div className="mock" data-mock="kcna" data-phase="quiz" data-mode={cur.mode}>
      <MockProgress t={t} at={cur.at} total={cur.ids.length} labelKey="mock.question" />
      {settings.examMode && <MockTimer t={t} started={cur.started} target={target} calm={settings.calm} />}
      <p className="mock-domain" data-question-domain={q.domain}>
        {t('mock.domain', { name: names[q.domain] ?? q.domain })}
      </p>
      <h2 className="mock-question" ref={heading} tabIndex={-1} data-question={q.id}>
        <Inline text={q.question} />
      </h2>
      <p className="visually-hidden" id="mock-pick">
        {t('quiz.pick')}
      </p>
      <ul className="choice-list" role="list" aria-labelledby="mock-pick">
        {order.map((dataIndex, pos) => {
          const state = learn && picked === pos ? (dataIndex === q.answer ? 'right' : 'almost') : null;
          return (
            <li key={dataIndex}>
              <button
                type="button"
                className={cx('choice-btn', state && `is-${state}`, !learn && shownPick === pos && 'is-picked')}
                aria-pressed={shownPick === pos}
                disabled={solved && picked !== pos}
                onClick={() => choose(pos)}
                data-option={pos}
              >
                <span className="choice-mark" aria-hidden="true">
                  {state === 'right' ? '✓' : state === 'almost' ? '↻' : String.fromCharCode(65 + pos)}
                </span>
                <span>
                  <Inline text={q.options[dataIndex] ?? ''} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {learn && current !== null && !solved && (
        <Feedback kind="almost">
          {t('feedback.almost')} <Inline text={q.why} /> {t('mock.tryOnce')}
        </Feedback>
      )}
      {learn && solved && (
        <Feedback kind="right">
          {pickPraise(t, name, tries)} <Inline text={q.why} />
        </Feedback>
      )}
      {!learn && shownPick !== null && <p className="mock-note">{t('mock.picked')}</p>}
      {learn && recorded !== undefined && recorded >= 0 && recorded !== q.answer && <p className="mock-note">{t('mock.firstTry')}</p>}
      <div className="mock-actions">
        {cur.at > 0 && (
          <button type="button" className="btn btn-ghost" onClick={() => go(cur.at - 1)} data-mock-back>
            ← {t('mock.back')}
          </button>
        )}
        <button type="button" className="btn btn-big" onClick={() => go(cur.at + 1)} data-mock-next>
          {last ? t('mock.finish') : `${t('mock.next')} →`}
        </button>
      </div>
      {!canSave && <p className="mock-note">{t('mock.saveBlocked')}</p>}
    </div>
  );
}
