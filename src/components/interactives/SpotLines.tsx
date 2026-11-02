// Spot the lines: tap every line in real Git output that matches the question.
import { useMemo, useState } from 'react';
import { buildScenario, prettyPath, run, type Line, type Scenario } from '~/engine/git-sim';
import type { Lang } from '~/i18n';
import { Feedback, cx, pickPraise, useCardEvents, useLearnerName, useT } from './shared';
import './quiz.css';
import './widgets.css';

export interface SpotLinesProps {
  lang: Lang;
  scenario?: Scenario;
  commands?: string[];
  /** Regex: output lines that match are the answers. */
  targets?: string;
  /** Or give the lines directly. */
  lines?: { text: string; color?: 'red' | 'green' | 'cyan' | 'yellow'; target?: boolean }[];
  prompt?: string;
  success?: string;
}

interface Row {
  kind: 'cmd' | 'out';
  text: string;
  segs?: Line;
  target: boolean;
}

export default function SpotLines({ lang, scenario, commands = [], targets, lines, prompt, success }: SpotLinesProps) {
  const t = useT(lang);
  const name = useLearnerName();
  const { ref, emit } = useCardEvents();
  const rows = useMemo<Row[]>(() => {
    if (lines) return lines.map((l) => ({ kind: 'out', text: l.text, segs: [l.color ? { t: l.text, c: l.color } : { t: l.text }], target: Boolean(l.target) }));
    if (!scenario) return [];
    const re = targets ? new RegExp(targets) : null;
    let s = buildScenario(scenario);
    const out: Row[] = [];
    for (const c of commands) {
      out.push({ kind: 'cmd', text: `${prettyPath(s.cwd, s.home)} $ ${c}`, target: false });
      const r = run(s, c);
      s = r.state;
      for (const l of r.output) {
        const text = l.map((x) => x.t).join('');
        out.push({ kind: 'out', text, segs: l, target: Boolean(re && text.trim() && re.test(text)) });
      }
    }
    return out;
  }, [scenario, commands, targets, lines]);

  const total = rows.filter((r) => r.target).length;
  const [found, setFound] = useState<Set<number>>(new Set());
  const [miss, setMiss] = useState<number | null>(null);
  const done = found.size === total && total > 0;

  const tap = (i: number) => {
    if (done) return;
    const row = rows[i]!;
    if (row.target) {
      const next = new Set(found).add(i);
      setFound(next);
      setMiss(null);
      if (next.size === total) emit('fl:done');
    } else {
      setMiss(i);
      emit('fl:wrong');
    }
  };

  return (
    <div className="spot" ref={ref}>
      <p className="interactive-help">{prompt ?? t('spot.instructions')}</p>
      <div className="replay spot-lines" role="group" aria-label={prompt ?? t('spot.instructions')}>
        {rows.map((r, i) =>
          r.kind === 'cmd' || !r.text.trim() ? (
            <span key={i} className={cx('replay-line', r.kind === 'cmd' && 'replay-cmd')} aria-hidden={!r.text.trim()}>
              {r.text.replace(/\t/g, '    ') || ' '}
            </span>
          ) : (
            <button
              key={i}
              type="button"
              className={cx('spot-line', found.has(i) && 'is-found', miss === i && 'is-miss')}
              aria-pressed={found.has(i)}
              onClick={() => tap(i)}
            >
              {(r.segs ?? [{ t: r.text }]).map((s, j) => (
                <span key={j} className={s.c ? `seg-${s.c}` : undefined}>
                  {s.t.replace(/\t/g, '    ')}
                </span>
              ))}
              {found.has(i) && <span className="spot-tick"> ✓</span>}
            </button>
          ),
        )}
      </div>
      <p className="spot-count" aria-live="polite">
        {t('spot.found', { n: found.size, total })}
      </p>
      {miss !== null && !done && <Feedback kind="almost">{t('feedback.almost')} {prompt ?? t('spot.instructions')}</Feedback>}
      {done && <Feedback kind="right">{success ?? pickPraise(t, name, found.size)}</Feedback>}
    </div>
  );
}
