// Time machine: slide through commits and watch one file change.
import { useMemo, useState } from 'react';
import { buildScenario, findRepo, headId, history, shortHash, subject, type Scenario } from '~/engine/git-sim';
import { diffLines } from '~/engine/git-sim/diff';
import type { Lang } from '~/i18n';
import { cx, useCardEvents, useT } from './shared';
import './widgets.css';

export interface TimeMachineProps {
  lang: Lang;
  scenario: Scenario;
  file: string;
  label?: string;
}

export default function TimeMachine({ lang, scenario, file, label }: TimeMachineProps) {
  const t = useT(lang);
  const { ref, emit } = useCardEvents();
  const commits = useMemo(() => {
    const s = buildScenario(scenario);
    const repo = findRepo(s);
    return repo ? history(repo, headId(repo)).reverse() : [];
  }, [scenario]);
  const [i, setI] = useState(commits.length - 1);
  const [seen, setSeen] = useState<Set<number>>(() => new Set([commits.length - 1]));
  const [done, setDone] = useState(false);
  const c = commits[i];
  const prev = commits[i - 1];
  const ops = c ? diffLines(prev?.snapshot[file] ?? '', c.snapshot[file] ?? '').filter((o) => o.kind !== '-') : [];

  const go = (n: number) => {
    setI(n);
    const next = new Set(seen).add(n);
    setSeen(next);
    if (!done && next.has(0) && next.has(commits.length - 1)) {
      setDone(true);
      emit('fl:done');
    }
  };

  if (!c) return null;
  return (
    <div className="timemachine" ref={ref}>
      <label className="tm-label" htmlFor={`tm-${scenario.id}`}>
        {label ?? t('slider.label')}
      </label>
      <input
        id={`tm-${scenario.id}`}
        className="tm-slider"
        type="range"
        min={0}
        max={commits.length - 1}
        step={1}
        value={i}
        onChange={(e) => go(Number(e.target.value))}
        aria-valuetext={`${t('slider.commit', { n: i + 1, total: commits.length })}: ${subject(c.message)}`}
      />
      <ol className="tm-dots" aria-hidden="true">
        {commits.map((x, n) => (
          <li key={x.id} className={cx(n === i && 'is-on', n <= i && 'is-past')} />
        ))}
      </ol>
      <p className="tm-commit">
        <code className="tm-hash">{shortHash(c.id)}</code> {subject(c.message)}
        <span className="tm-count"> · {t('slider.commit', { n: i + 1, total: commits.length })}</span>
      </p>
      <pre className="tm-file" aria-label={file}>
        <span className="tm-filename">{file}</span>
        {ops.length === 0 ? (
          <span className="tm-line tm-missing">—</span>
        ) : (
          ops.map((o, n) => (
            <span key={n} className={cx('tm-line', o.kind === '+' && i > 0 && 'is-new')}>
              {o.text || ' '}
            </span>
          ))
        )}
      </pre>
    </div>
  );
}
