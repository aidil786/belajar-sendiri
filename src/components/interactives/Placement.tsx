// Placement test: quick questions. Right answers mark lessons as "known"
// (they stay open, and show a tick on the map). No pressure: skip any question.
import { useState } from 'react';
import type { Lang } from '~/i18n';
import { markKnown } from '~/stores/progress';
import Inline from './Inline';
import { Feedback, cx, useCardEvents, useT } from './shared';
import './quiz.css';
import './widgets.css';

export interface PlacementProps {
  lang: Lang;
  questions: { q: string; options: { label: string; correct?: boolean }[]; marks: string[] }[];
}

export default function Placement({ lang, questions }: PlacementProps) {
  const t = useT(lang);
  const { ref, emit } = useCardEvents();
  const [i, setI] = useState(0);
  const [known, setKnown] = useState<string[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const q = questions[i];
  const finished = i >= questions.length;

  const advance = (marks: string[]) => {
    const next = [...known, ...marks];
    setKnown(next);
    setPicked(null);
    const n = i + 1;
    setI(n);
    if (n >= questions.length) {
      const unique = [...new Set(next)];
      markKnown(unique);
      emit('fl:done', { known: unique.length });
    }
  };

  const choose = (k: number) => {
    if (picked !== null || !q) return;
    setPicked(k);
    const right = Boolean(q.options[k]?.correct);
    window.setTimeout(() => advance(right ? q.marks : []), 700);
  };

  if (finished) {
    const n = new Set(known).size;
    return (
      <div className="placement" ref={ref}>
        <Feedback kind="right">{n > 0 ? t('placement.result', { n }) : t('placement.resultNone')}</Feedback>
      </div>
    );
  }

  return (
    <div className="placement" ref={ref}>
      <p className="interactive-help">{t('placement.intro')}</p>
      <p className="placement-count">{t('placement.question', { n: i + 1, total: questions.length })}</p>
      <p className="placement-q">
        <Inline text={q!.q} />
      </p>
      <ul className="choice-list">
        {q!.options.map((o, k) => (
          <li key={k}>
            <button
              type="button"
              className={cx('choice-btn', picked === k && (o.correct ? 'is-right' : 'is-almost'))}
              disabled={picked !== null}
              onClick={() => choose(k)}
            >
              <span className="choice-mark" aria-hidden="true">
                {String.fromCharCode(65 + k)}
              </span>
              <span>
                <Inline text={o.label} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-quiet" disabled={picked !== null} onClick={() => advance([])}>
        {t('placement.skip')}
      </button>
    </div>
  );
}
