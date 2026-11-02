// Bisect detective: Git checks out the middle commit; the learner runs the test,
// marks it good or bad, and the range halves until the first bad commit is found.
// Driven by the engine's `git bisect`, so it tests the same commits real Git would.
import { useMemo, useRef, useState } from 'react';
import { bisectInfo, buildScenario, findRepo, subject, type Scenario, type SimState } from '~/engine/git-sim';
import type { Lang } from '~/i18n';
import {
  culpritChange,
  defaultEnds,
  judge,
  markTested,
  maxSteps,
  outputText,
  rangeOf,
  rowsFor,
  startBisect,
  type BisectTest,
  type RowStatus,
  type Verdict,
} from '~/lib/bisectDetective';
import { splitLines } from '~/engine/git-sim/diff';
import { Announce, Feedback, cx, pickPraise, useCardEvents, useLearnerName, useMotionOK, useT } from './shared';
import './deep-git.css';

export interface BisectDetectiveProps {
  lang: Lang;
  scenario: Scenario;
  /** How to judge a commit: it is bad when a line of `file` matches `bad` (a regex). `label` explains it in words. */
  test: BisectTest & { label?: string };
  /** Known good commit (default: the oldest commit). */
  good?: string;
  /** Known bad commit (default: HEAD). */
  bad?: string;
  success?: string;
}

const STATUS_ICON: Record<RowStatus, string> = { good: '✓', bad: '✗', suspect: '?', testing: '▶', skipped: '↷', found: '⚠' };

export default function BisectDetective({ lang, scenario, test, good, bad, success }: BisectDetectiveProps) {
  const t = useT(lang);
  const learner = useLearnerName();
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();
  const initial = useMemo(() => buildScenario(scenario), [scenario]);
  const ends = useMemo(() => defaultEnds(initial, good, bad), [initial, good, bad]);
  const range = useMemo(() => (ends ? rangeOf(initial, ends.good, ends.bad) : []), [initial, ends]);
  const [sim, setSim] = useState<SimState>(initial);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [steps, setSteps] = useState(0);
  const [term, setTerm] = useState<{ cmd: string; out: string } | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'right' | 'almost'; text: string } | null>(null);
  const [announce, setAnnounce] = useState('');
  const [done, setDone] = useState(false);
  const tries = useRef(0);
  // Buttons that disappear or get disabled would drop focus on the page: move it to the next step.
  const focusNext = (selector: string) => window.requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(selector)?.focus());

  const info = bisectInfo(sim);
  const rows = rowsFor(sim, range);
  const testing = info.active && !info.found ? info.testing : null;
  const testingMsg = testing ? subject(findRepo(sim)!.commits[testing]!.message) : '';
  const suspectsAtStart = Math.max(range.length - 1, 1);
  const label = test.label ?? t('detective.test', { file: test.file, pattern: test.bad });

  const begin = () => {
    if (!ends) return;
    const r = startBisect(initial, ends);
    setSim(r.state);
    setTerm({ cmd: `git bisect start ${ends.bad.slice(0, 7)} ${ends.good.slice(0, 7)}`, out: outputText(r) });
    setVerdict(null);
    setFeedback(null);
    const next = bisectInfo(r.state).testing;
    if (next) setAnnounce(t('detective.testing', { short: next.slice(0, 7), message: subject(findRepo(r.state)!.commits[next]!.message) }));
    focusNext('.detective-run');
  };

  const runTest = () => {
    const v = judge(sim, test);
    setVerdict(v);
    setFeedback(null);
    setAnnounce(v.bad ? t('detective.resultBad', { line: v.line ?? 1 }) : t('detective.resultGood'));
    focusNext('.detective-mark-good');
  };

  const mark = (kind: 'good' | 'bad') => {
    if (!testing) return;
    if (!verdict) {
      setFeedback({ kind: 'almost', text: t('detective.testFirst') });
      emit('fl:hint');
      return;
    }
    if (verdict.bad !== (kind === 'bad')) {
      tries.current++;
      setFeedback({ kind: 'almost', text: verdict.bad ? t('detective.almostBad') : t('detective.almostGood') });
      emit('fl:wrong');
      return;
    }
    const r = markTested(sim, kind);
    const n = steps + 1;
    setSteps(n);
    setSim(r.state);
    setTerm({ cmd: `git bisect ${kind}`, out: outputText(r) });
    setVerdict(null);
    setFeedback(null);
    const after = bisectInfo(r.state);
    if (after.found) {
      const msg = subject(findRepo(r.state)!.commits[after.found]!.message);
      setAnnounce(t('detective.found', { short: after.found.slice(0, 7), message: msg }));
      focusNext('.detective-found-title');
      if (!done) {
        setDone(true);
        emit('fl:done');
      }
    } else if (after.testing) {
      focusNext('.detective-run');
      setAnnounce(t('detective.testing', { short: after.testing.slice(0, 7), message: subject(findRepo(r.state)!.commits[after.testing]!.message) }));
    }
  };

  const again = () => {
    setSim(initial);
    setSteps(0);
    setTerm(null);
    setVerdict(null);
    setFeedback(null);
    setAnnounce('');
    focusNext('.detective-start');
  };

  if (!ends || range.length < 2) return <p className="detective-empty">{t('detective.empty')}</p>;
  const found = info.found;
  const change = found ? culpritChange(sim, found, test.file) : null;

  return (
    <div className={cx('detective', motionOK && 'is-animated')} ref={ref}>
      <p className="detective-intro">{t('detective.intro')}</p>
      <p className="detective-test">
        <span aria-hidden="true">🧪 </span>
        {label}
      </p>

      <p className="detective-axis" aria-hidden="true">
        <span>{t('detective.older')}</span>
        <span>{t('detective.newer')}</span>
      </p>
      <ol className="detective-rows" aria-label={t('detective.list')}>
        {rows.map((row) => (
          <li key={row.id} className={cx('detective-row', `is-${row.status}`)}>
            <span className="detective-icon" aria-hidden="true">
              {STATUS_ICON[row.status]}
            </span>
            <code>{row.short}</code>
            <span className="detective-msg">{row.message}</span>
            <span className="detective-status">{t(`detective.status.${row.status}`)}</span>
          </li>
        ))}
      </ol>
      <p className="detective-steps">
        {t('detective.steps', { n: steps, max: maxSteps(suspectsAtStart), count: suspectsAtStart })}
      </p>

      {!info.active && !found && (
        <div className="detective-actions">
          <button type="button" className="btn detective-start" onClick={begin}>
            {t('detective.start')}
          </button>
        </div>
      )}

      {term && (
        <pre className="detective-term" aria-label={t('detective.term')}>
          <span className="detective-prompt">$ {term.cmd}</span>
          {'\n'}
          {term.out}
        </pre>
      )}

      {testing && (
        <div className="detective-lab">
          <p className="detective-now">{t('detective.testing', { short: testing.slice(0, 7), message: testingMsg })}</p>
          <div className="detective-actions">
            <button type="button" className="btn btn-ghost detective-run" onClick={runTest} disabled={Boolean(verdict)}>
              {t('detective.run')}
            </button>
          </div>
          {verdict && (
            <>
              <pre className="detective-file" aria-label={test.file}>
                <span className="detective-filename">{test.file}</span>
                {splitLines(verdict.content).map((l, i) => (
                  <span key={i} className={cx('detective-line', verdict.line === i + 1 && 'is-hit')}>
                    {verdict.line === i + 1 && <span aria-hidden="true">⚠ </span>}
                    {l || ' '}
                  </span>
                ))}
              </pre>
              <p className={cx('detective-verdict', verdict.bad ? 'is-bad' : 'is-good')}>
                <span aria-hidden="true">{verdict.bad ? '✗ ' : '✓ '}</span>
                {verdict.bad ? t('detective.resultBad', { line: verdict.line ?? 1 }) : t('detective.resultGood')}
              </p>
            </>
          )}
          <div className="detective-actions">
            <button type="button" className="btn detective-mark-good" onClick={() => mark('good')}>
              {t('detective.markGood')}
            </button>
            <button type="button" className="btn" onClick={() => mark('bad')}>
              {t('detective.markBad')}
            </button>
          </div>
        </div>
      )}

      {found && change && (
        <div className="detective-found">
          <p className="detective-found-title" tabIndex={-1}>
            <span aria-hidden="true">⚠ </span>
            {t('detective.found', { short: found.slice(0, 7), message: subject(findRepo(sim)!.commits[found]!.message) })}
          </p>
          <p>{t('detective.changed', { file: test.file })}</p>
          <pre className="detective-diff">
            {change.removed.map((l, i) => (
              <span key={`r${i}`} className="detective-del">
                - {l}
              </span>
            ))}
            {change.added.map((l, i) => (
              <span key={`a${i}`} className="detective-add">
                + {l}
              </span>
            ))}
          </pre>
          <Feedback kind="right">
            {pickPraise(t, learner, tries.current)} {success ?? t('detective.success', { n: steps })}
          </Feedback>
          <div className="detective-actions">
            <button type="button" className="btn btn-ghost" onClick={again}>
              {t('detective.again')}
            </button>
          </div>
        </div>
      )}

      {feedback && <Feedback kind={feedback.kind}>{feedback.text}</Feedback>}
      <Announce text={announce} />
    </div>
  );
}
