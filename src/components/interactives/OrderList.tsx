// Put items in order. Arrow buttons (keyboard friendly) or drag to reorder.
import { Reorder } from 'motion/react';
import { useMemo, useState } from 'react';
import type { Lang } from '~/i18n';
import Inline from './Inline';
import { Announce, Feedback, cx, pickPraise, seededShuffle, useCardEvents, useLearnerName, useMotionOK, useT } from './shared';
import './widgets.css';

export interface OrderListProps {
  lang: Lang;
  /** The correct order, top first. The learner sees them shuffled. */
  items: string[];
  label?: string;
  success?: string;
}

export default function OrderList({ lang, items, label, success }: OrderListProps) {
  const t = useT(lang);
  const name = useLearnerName();
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();
  const start = useMemo(() => {
    let s = seededShuffle(items, items.join('|'));
    if (s.every((x, i) => x === items[i])) s = [...s.slice(1), s[0]!];
    return s;
  }, [items]);
  const [order, setOrder] = useState<string[]>(start);
  const [msg, setMsg] = useState<{ kind: 'right' | 'almost'; text: string } | null>(null);
  const [done, setDone] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [checks, setChecks] = useState(0);

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setOrder(next);
    setMsg(null);
    setAnnounce(`${next[j]} → ${j + 1}`);
  };

  const check = () => {
    setChecks((c) => c + 1);
    const wrongAt = order.findIndex((x, i) => x !== items[i]);
    if (wrongAt === -1) {
      setDone(true);
      setMsg({ kind: 'right', text: success ?? pickPraise(t, name, checks) });
      emit('fl:done');
    } else {
      setMsg({ kind: 'almost', text: `${t('feedback.almost')} ${order[wrongAt]} (${wrongAt + 1})` });
      emit('fl:wrong');
    }
  };

  return (
    <div className="order" ref={ref}>
      <p className="interactive-help">{label ? `${label}. ` : ''}{t('order.instructions')}</p>
      <Reorder.Group axis="y" values={order} onReorder={done ? () => undefined : setOrder} className="order-list">
        {order.map((item, i) => (
          <Reorder.Item key={item} value={item} className={cx('order-item', done && 'is-done')} dragListener={!done && motionOK}>
            <span className="order-num" aria-hidden="true">
              {i + 1}
            </span>
            <span className="order-text">
              <Inline text={item} />
            </span>
            <span className="order-btns">
              <button type="button" className="order-btn" disabled={done || i === 0} onClick={() => move(i, -1)} aria-label={t('order.up', { item })}>
                ↑
              </button>
              <button type="button" className="order-btn" disabled={done || i === order.length - 1} onClick={() => move(i, 1)} aria-label={t('order.down', { item })}>
                ↓
              </button>
            </span>
          </Reorder.Item>
        ))}
      </Reorder.Group>
      {!done && (
        <button type="button" className="btn" onClick={check}>
          {t('order.check')}
        </button>
      )}
      {msg && <Feedback kind={msg.kind}>{msg.text}</Feedback>}
      <Announce text={announce} />
    </div>
  );
}
