// Sort cards into buckets (tap a card, then a bucket — or drag it).
import { LayoutGroup, motion } from 'motion/react';
import { useId, useMemo, useRef, useState } from 'react';
import type { Lang } from '~/i18n';
import Inline from './Inline';
import { Announce, Feedback, cx, pickPraise, seededShuffle, useCardEvents, useLearnerName, useMotionOK, useT } from './shared';
import './widgets.css';

export interface SortCardsProps {
  lang: Lang;
  buckets: { id: string; label: string }[];
  items: { label: string; bucket: string; why?: string }[];
  success?: string;
}

export default function SortCards({ lang, buckets, items, success }: SortCardsProps) {
  const t = useT(lang);
  const name = useLearnerName();
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();
  const uid = useId();
  const order = useMemo(() => seededShuffle(items.map((_, i) => i), items.map((i) => i.label).join('|')), [items]);
  const [placed, setPlaced] = useState<Record<number, string>>({});
  const [picked, setPicked] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ kind: 'right' | 'almost'; text: string } | null>(null);
  const [announce, setAnnounce] = useState('');
  const [bounce, setBounce] = useState<number | null>(null);
  const bucketRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const tries = useRef(0);
  const done = Object.keys(placed).length === items.length;

  const bucketAt = (x: number, y: number) =>
    buckets.find((b) => {
      const r = bucketRefs.current[b.id]?.getBoundingClientRect();
      return r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    })?.id;

  const place = (i: number, bucket: string) => {
    const item = items[i];
    if (!item) return;
    setPicked(null);
    tries.current++;
    if (item.bucket !== bucket) {
      setBounce(i);
      window.setTimeout(() => setBounce(null), 450);
      const text = item.why ?? t('drag.bounce');
      setMsg({ kind: 'almost', text: `${t('feedback.almost')} ${text}` });
      setAnnounce(text);
      emit('fl:wrong');
      return;
    }
    const next = { ...placed, [i]: bucket };
    setPlaced(next);
    const label = buckets.find((b) => b.id === bucket)?.label ?? bucket;
    setAnnounce(t('drag.placed', { item: item.label, zone: label }));
    if (Object.keys(next).length === items.length) {
      setMsg({ kind: 'right', text: success ?? pickPraise(t, name, tries.current) });
      emit('fl:done');
    } else setMsg(item.why ? { kind: 'right', text: item.why } : null);
  };

  return (
    <div className="sort" ref={ref}>
      <p className="interactive-help">{picked !== null ? t('drag.picked', { item: items[picked]?.label ?? '' }) : t('drag.instructions')}</p>
      <LayoutGroup id={uid}>
        <ul className="sort-pool" aria-label={t('drag.instructions')}>
          {order
            .filter((i) => placed[i] === undefined)
            .map((i) => (
              <motion.li key={i} layoutId={`${uid}-${i}`} layout={motionOK}>
                <motion.button
                  type="button"
                  className={cx('sort-card', picked === i && 'is-picked', bounce === i && 'is-bounce')}
                  aria-pressed={picked === i}
                  drag
                  dragSnapToOrigin
                  whileDrag={{ scale: 1.05, zIndex: 5 }}
                  onDragEnd={(_, info) => {
                    const b = bucketAt(info.point.x - window.scrollX, info.point.y - window.scrollY);
                    if (b) place(i, b);
                  }}
                  onClick={() => setPicked(picked === i ? null : i)}
                >
                  <Inline text={items[i]!.label} />
                </motion.button>
              </motion.li>
            ))}
          {done && <li className="sort-empty">{t('drag.allDone')}</li>}
        </ul>
        <div className={cx('sort-buckets', `sort-buckets-${buckets.length}`)}>
          {buckets.map((b) => (
            <div
              key={b.id}
              className={cx('sort-bucket', picked !== null && 'is-target')}
              ref={(el) => {
                bucketRefs.current[b.id] = el;
              }}
            >
              <button type="button" className="sort-bucket-head" disabled={picked === null} onClick={() => picked !== null && place(picked, b.id)}>
                {b.label}
              </button>
              <ul className="sort-in">
                {order
                  .filter((i) => placed[i] === b.id)
                  .map((i) => (
                    <motion.li key={i} layoutId={`${uid}-${i}`} layout={motionOK} className="sort-placed">
                      <span aria-hidden="true">✓ </span>
                      <Inline text={items[i]!.label} />
                    </motion.li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </LayoutGroup>
      {msg && <Feedback kind={msg.kind}>{msg.text}</Feedback>}
      <Announce text={announce} />
    </div>
  );
}
