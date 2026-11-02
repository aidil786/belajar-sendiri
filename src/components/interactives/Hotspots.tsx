// Hotspots: tap glowing dots on an original illustration to explore it.
import { useState } from 'react';
import type { Lang } from '~/i18n';
import Inline from './Inline';
import { PICTURES } from './pictures';
import { Feedback, cx, pickPraise, useCardEvents, useLearnerName, useT } from './shared';
import './widgets.css';

export interface HotspotsProps {
  lang: Lang;
  picture: string;
  spots: { id: string; x: number; y: number; title: string; text: string }[];
}

export default function Hotspots({ lang, picture, spots }: HotspotsProps) {
  const t = useT(lang);
  const name = useLearnerName();
  const { ref, emit } = useCardEvents();
  const [open, setOpen] = useState<string | null>(null);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const Picture = PICTURES[picture];
  const current = spots.find((s) => s.id === open);
  const done = seen.size === spots.length;

  const tap = (id: string) => {
    setOpen(id);
    const next = new Set(seen).add(id);
    setSeen(next);
    if (next.size === spots.length && seen.size < spots.length) emit('fl:done');
  };

  return (
    <div className="hotspots" ref={ref}>
      <p className="interactive-help">{t('hotspot.instructions')}</p>
      <div className="hotspots-pic">
        {Picture && <Picture />}
        {spots.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={cx('hotspot', seen.has(s.id) && 'is-seen', open === s.id && 'is-open')}
            style={{ left: `${s.x}%`, top: `${s.y}%` }}
            aria-pressed={open === s.id}
            aria-label={`${i + 1}. ${s.title}`}
            onClick={() => tap(s.id)}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <p className="spot-count">{t('hotspot.found', { n: seen.size, total: spots.length })}</p>
      <div className="hotspot-info" aria-live="polite">
        {current && (
          <>
            <p className="hotspot-title">{current.title}</p>
            <p>
              <Inline text={current.text} />
            </p>
          </>
        )}
      </div>
      {done && <Feedback kind="right">{pickPraise(t, name, spots.length)}</Feedback>}
    </div>
  );
}
