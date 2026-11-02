// Choose / predict card: pick an answer, get kind feedback, optionally watch the answer.
import { useId, useState } from 'react';
import type { Lang } from '~/i18n';
import AreasScene, { type AreasSceneProps } from './AreasScene';
import Inline from './Inline';
import { Feedback, cx, pickPraise, useCardEvents, useLearnerName, useT } from './shared';
import './quiz.css';

export interface ChoiceOption {
  label: string;
  correct?: boolean;
  /** Why this answer is right or not. Shown after picking it. */
  why?: string;
}

export interface ChoiceProps {
  lang: Lang;
  options: ChoiceOption[];
  /** Animation that shows the answer after a correct pick. */
  reveal?: Omit<AreasSceneProps, 'lang'>;
  /** Show options as a row of big buttons (e.g. for short commands). */
  compact?: boolean;
}

export default function Choice({ lang, options, reveal, compact }: ChoiceProps) {
  const t = useT(lang);
  const name = useLearnerName();
  const { ref, emit } = useCardEvents();
  const group = useId();
  const [picked, setPicked] = useState<number | null>(null);
  const [solved, setSolved] = useState(false);
  const [tries, setTries] = useState(0);

  const choose = (i: number) => {
    if (solved) return;
    setPicked(i);
    setTries((n) => n + 1);
    if (options[i]?.correct) {
      setSolved(true);
      emit('fl:done', { tries: tries + 1 });
    } else emit('fl:wrong');
  };

  const current = picked === null ? null : options[picked];

  return (
    <div className="choice" ref={ref}>
      <p className="visually-hidden" id={`${group}-label`}>
        {t('quiz.pick')}
      </p>
      <ul className={cx('choice-list', compact && 'choice-compact')} role="list" aria-labelledby={`${group}-label`}>
        {options.map((o, i) => {
          const state = picked === i ? (o.correct ? 'right' : 'almost') : solved && o.correct ? 'right' : null;
          return (
            <li key={i}>
              <button
                type="button"
                className={cx('choice-btn', state && `is-${state}`)}
                aria-pressed={picked === i}
                disabled={solved && !o.correct && picked !== i}
                onClick={() => choose(i)}
              >
                <span className="choice-mark" aria-hidden="true">
                  {state === 'right' ? '✓' : state === 'almost' ? '↻' : String.fromCharCode(65 + i)}
                </span>
                <span>
                  <Inline text={o.label} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {current && !current.correct && (
        <Feedback kind="almost">
          {t('feedback.almost')} {current.why ? <Inline text={current.why} /> : t('feedback.tryAgain')}
        </Feedback>
      )}
      {solved && current && (
        <Feedback kind="right">
          {pickPraise(t, name, tries)} {current.why && <Inline text={current.why} />}
        </Feedback>
      )}
      {solved && reveal && (
        <div className="choice-reveal">
          <p className="choice-reveal-label">{t('quiz.reveal')}</p>
          <AreasScene lang={lang} {...reveal} />
        </div>
      )}
    </div>
  );
}
