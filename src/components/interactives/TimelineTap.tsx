// Tap each point on a timeline to reveal what happened.
import { useState } from 'react';
import type { Lang } from '~/i18n';
import Inline from './Inline';
import { Feedback, cx, pickPraise, useCardEvents, useLearnerName, useT } from './shared';
import './widgets.css';

export interface TimelineTapProps {
  lang: Lang;
  events: { when: string; title: string; text: string }[];
}

export default function TimelineTap({ lang, events }: TimelineTapProps) {
  const t = useT(lang);
  const name = useLearnerName();
  const { ref, emit } = useCardEvents();
  const [open, setOpen] = useState<number | null>(null);
  const [seen, setSeen] = useState<Set<number>>(new Set());

  const tap = (i: number) => {
    setOpen(i);
    const next = new Set(seen).add(i);
    setSeen(next);
    if (next.size === events.length && seen.size < events.length) emit('fl:done');
  };

  return (
    <div className="timeline" ref={ref}>
      <p className="interactive-help">{t('timeline.instructions')}</p>
      <ol className="timeline-list">
        {events.map((e, i) => (
          <li key={i} className={cx('timeline-item', seen.has(i) && 'is-seen', open === i && 'is-open')}>
            <button type="button" className="timeline-dot" aria-expanded={open === i} onClick={() => tap(i)}>
              <span className="timeline-when">{e.when}</span>
              <span className="timeline-title">{e.title}</span>
            </button>
            {open === i && (
              <p className="timeline-text">
                <Inline text={e.text} />
              </p>
            )}
          </li>
        ))}
      </ol>
      {seen.size === events.length && <Feedback kind="right">{pickPraise(t, name, events.length)}</Feedback>}
    </div>
  );
}
