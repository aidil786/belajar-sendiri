// Small pieces shared by the KCNA mock and the CKAD practice runner: the progress bar,
// the optional exam timer (exam mode only; it never stops anyone), and the per-domain scores.
import { useEffect, useState } from 'react';
import type { DomainScore } from '~/lib/mockExam';
import { clockText } from '~/lib/nightShift';
import type { T } from '../interactives/shared';

/** "Question 3 of 12" + a bar. The bar is decoration; the words carry the meaning. */
export function MockProgress({ t, at, total, labelKey }: { t: T; at: number; total: number; labelKey: 'mock.question' | 'mock.task' }) {
  const shown = Math.min(at + 1, total);
  return (
    <div className="mock-progress-wrap">
      <p className="mock-count" data-mock-count>
        {t(labelKey, { x: shown, y: total })}
      </p>
      <div className="mock-progress" role="progressbar" aria-label={t('mock.progress')} aria-valuemin={1} aria-valuemax={total} aria-valuenow={shown} aria-valuetext={t(labelKey, { x: shown, y: total })}>
        <div className="mock-progress-fill" style={{ width: `${Math.round((100 * shown) / Math.max(1, total))}%` }} />
      </div>
    </div>
  );
}

/**
 * Exam mode only: a count-up timer from when the set started, with the suggested time.
 * Calm mode shows whole minutes (the text changes once a minute). After the suggested time it
 * only says so, kindly. `aria-live="off"`: screen readers are never interrupted.
 */
export function MockTimer({ t, started, target, calm, stopped }: { t: T; started: number; target: number; calm: boolean; stopped?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (stopped) return;
    const timer = window.setInterval(() => setNow(Date.now()), calm ? 15_000 : 1_000);
    return () => window.clearInterval(timer);
  }, [calm, stopped]);
  const elapsed = Math.max(0, (now - started) / 1000);
  return (
    <div className="mock-timer">
      <p className="mock-timer-line">
        <span id="mock-timer-label">{t('exam.timer')}</span>{' '}
        <span className="mock-clock" role="timer" aria-live="off" aria-labelledby="mock-timer-label" data-timer>
          {calm ? t('exam.timerMin', { n: clockText(elapsed, true) }) : clockText(elapsed)}
        </span>{' '}
        <span className="mock-target">· {t('mock.target', { n: target })}</span>
      </p>
      {elapsed >= target * 60 && (
        <p className="mock-timeup" data-time-up>
          {t('mock.timeUp', { n: target })}
        </p>
      )}
    </div>
  );
}

/** Score per domain: words first ("4 of 5"), a small bar beside them. No red, no "fail". */
export function DomainScores({ t, scores, names }: { t: T; scores: DomainScore[]; names: Record<string, string> }) {
  return (
    <ul className="mock-domains" data-mock-domains>
      {scores.map((d) => (
        <li key={d.domain} data-domain={d.domain}>
          <span className="mock-domain-name">{names[d.domain] ?? d.domain}</span>
          <span className="mock-domain-score">{t('mock.domainScore', { right: d.right, total: d.total, percent: d.percent })}</span>
          <span className="mock-domain-bar" aria-hidden="true">
            <span style={{ width: `${d.percent}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A day key (YYYY-MM-DD) in a short local date, for "Last time: … (1 Nov 2026)". */
export function shortDay(day: string, lang: 'en' | 'ms'): string {
  const d = new Date(`${day}T00:00:00`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString(lang === 'ms' ? 'ms-MY' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
