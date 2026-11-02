// Commit message judge: swipe right = good, left = needs work (or tap the buttons).
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import type { Lang } from '~/i18n';
import Inline from './Inline';
import { Feedback, cx, pickPraise, useCardEvents, useLearnerName, useMotionOK, useT } from './shared';
import './widgets.css';

export interface SwipeJudgeProps {
  lang: Lang;
  cards: { text: string; good: boolean; why: string }[];
  /** Cards are sentences, not commit messages or code: show them in the normal font. */
  prose?: boolean;
}

export default function SwipeJudge({ lang, cards, prose = false }: SwipeJudgeProps) {
  const t = useT(lang);
  const name = useLearnerName();
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();
  const [i, setI] = useState(0);
  const [score, setScore] = useState(0);
  const [last, setLast] = useState<{ right: boolean; why: string; dir: 1 | -1 } | null>(null);
  const done = i >= cards.length;
  const card = cards[i];

  const judge = (good: boolean) => {
    if (!card) return;
    const right = card.good === good;
    setLast({ right, why: card.why, dir: good ? 1 : -1 });
    if (right) setScore((s) => s + 1);
    else emit('fl:wrong');
    const next = i + 1;
    setI(next);
    if (next >= cards.length) emit('fl:done', { score: score + (right ? 1 : 0) });
  };

  return (
    <div className="swipe" ref={ref}>
      <p className="interactive-help">{t('swipe.instructions')}</p>
      <div className="swipe-stage">
        <AnimatePresence mode="popLayout" initial={false}>
          {card && (
            <motion.div
              key={i}
              className="swipe-card"
              drag={motionOK ? 'x' : false}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.7}
              onDragEnd={(_, info) => {
                if (info.offset.x > 90) judge(true);
                else if (info.offset.x < -90) judge(false);
              }}
              initial={motionOK ? { opacity: 0, y: 16 } : false}
              animate={{ opacity: 1, y: 0, x: 0, rotate: 0 }}
              exit={motionOK ? { opacity: 0, x: (last?.dir ?? 1) * 220, rotate: (last?.dir ?? 1) * 12 } : { opacity: 0 }}
              transition={{ duration: motionOK ? 0.35 : 0 }}
            >
              <span className="swipe-count">
                {i + 1} / {cards.length}
              </span>
              {prose ? (
                <p className="swipe-text swipe-prose">
                  <Inline text={card.text} />
                </p>
              ) : (
                <code className="swipe-text">{card.text}</code>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        {done && (
          <p className="swipe-score">
            {t('swipe.score', { n: score, total: cards.length })}
          </p>
        )}
      </div>
      {!done && (
        <div className="swipe-btns">
          <button type="button" className="btn btn-ghost swipe-bad" onClick={() => judge(false)}>
            ← {t('swipe.bad')}
          </button>
          <button type="button" className="btn swipe-good" onClick={() => judge(true)}>
            {t('swipe.good')} →
          </button>
        </div>
      )}
      {last && (
        <Feedback kind={last.right ? 'right' : 'almost'}>
          {last.right ? t('feedback.right') : t('feedback.almost')} <Inline text={last.why} />
        </Feedback>
      )}
      {done && <Feedback kind="right">{pickPraise(t, name, score)}</Feedback>}
      <span className={cx('visually-hidden')} aria-live="polite">
        {card ? card.text : ''}
      </span>
    </div>
  );
}
