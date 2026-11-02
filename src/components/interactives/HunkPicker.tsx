// Hunk picker: choose which pieces of a change belong in this commit (simplified git add -p).
import { useState } from 'react';
import type { Lang } from '~/i18n';
import Inline from './Inline';
import { Feedback, cx, pickPraise, useCardEvents, useLearnerName, useT } from './shared';
import './widgets.css';

export interface HunkPickerProps {
  lang: Lang;
  file: string;
  hunks: { lines: string[]; take: boolean; why?: string }[];
  success?: string;
}

export default function HunkPicker({ lang, file, hunks, success }: HunkPickerProps) {
  const t = useT(lang);
  const name = useLearnerName();
  const { ref, emit } = useCardEvents();
  const [choice, setChoice] = useState<(boolean | null)[]>(() => hunks.map(() => null));
  const [checked, setChecked] = useState(false);
  const [done, setDone] = useState(false);
  const [tries, setTries] = useState(0);

  const set = (i: number, take: boolean) => {
    if (done) return;
    const next = [...choice];
    next[i] = take;
    setChoice(next);
    setChecked(false);
  };

  const check = () => {
    setTries((n) => n + 1);
    setChecked(true);
    if (hunks.every((h, i) => choice[i] === h.take)) {
      setDone(true);
      emit('fl:done');
    } else emit('fl:wrong');
  };

  return (
    <div className="hunks" ref={ref}>
      <p className="interactive-help">{t('hunk.instructions')}</p>
      <p className="hunks-file">
        <code>{file}</code>
      </p>
      <ol className="hunk-list">
        {hunks.map((h, i) => {
          const wrong = checked && choice[i] !== h.take;
          return (
            <li key={i} className={cx('hunk', choice[i] === true && 'is-taken', choice[i] === false && 'is-skipped', wrong && 'is-wrong')}>
              <pre className="hunk-diff">
                {h.lines.map((l, j) => (
                  <span key={j} className={cx('hunk-line', l.startsWith('+') && 'seg-add', l.startsWith('-') && 'seg-del')}>
                    {l}
                  </span>
                ))}
              </pre>
              <div className="hunk-btns" role="group" aria-label={`${i + 1}`}>
                <button type="button" className={cx('btn', choice[i] === true ? '' : 'btn-ghost')} aria-pressed={choice[i] === true} disabled={done} onClick={() => set(i, true)}>
                  {t('hunk.take')} (y)
                </button>
                <button type="button" className={cx('btn', choice[i] === false ? '' : 'btn-ghost')} aria-pressed={choice[i] === false} disabled={done} onClick={() => set(i, false)}>
                  {t('hunk.skip')} (n)
                </button>
              </div>
              {wrong && h.why && (
                <Feedback kind="almost">
                  {t('feedback.almost')} <Inline text={h.why} />
                </Feedback>
              )}
              {done && h.why && <p className="hunk-why">{h.take ? '✓ ' : '↷ '}<Inline text={h.why} /></p>}
            </li>
          );
        })}
      </ol>
      {!done && (
        <button type="button" className="btn" disabled={choice.some((c) => c === null)} onClick={check}>
          {t('quiz.check')}
        </button>
      )}
      {done && <Feedback kind="right">{success ?? pickPraise(t, name, tries)}</Feedback>}
    </div>
  );
}
