// Daily review deck: one card at a time, the same card look as lessons.
// Right answers move a card up a Leitner box; a miss moves it gently down one.
// Max 10 cards a day. No XP, no streak pressure, nothing pops up.
import { useStore } from '@nanostores/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Lang } from '~/i18n';
import { playSound } from '~/lib/sound';
import { buildQuestion, cardsFor, daysBetween, dueToday, isLearned, nextReviewDay, reviewedToday, type ReviewItem } from '~/lib/review';
import { $progress, dayKey, learnedLessons, recordReview } from '~/stores/progress';
import { Feedback, cx, pickPraise, useT } from '../interactives/shared';

export interface ReviewDeckProps {
  lang: Lang;
  items: ReviewItem[];
  /** First lesson, for learners who have not started yet. */
  startHref: string;
  homeHref: string;
}

/** Keys never fire while typing or while a link/button has focus (Enter/Space belong to it). */
function onControl(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, button, a, summary, [contenteditable="true"]'));
}

export default function ReviewDeck({ lang, items, startHref, homeHref }: ReviewDeckProps) {
  const t = useT(lang);
  const progress = useStore($progress);
  const cards = useMemo(() => cardsFor(items), [items]);
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  // Today's queue is fixed for this visit, so "card X of Y" stays steady.
  const [session] = useState(() => {
    const p = $progress.get();
    const today = dayKey();
    const learned = learnedLessons(p);
    const known = new Set(learned);
    return {
      today,
      before: reviewedToday(p.review.cards, today),
      queue: dueToday(cards, p.review.cards, learned, today),
      hasLearned: cards.some((c) => isLearned(c.needs, known)),
    };
  });
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const cardRef = useRef<HTMLElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const first = useRef(true);

  const card = byId.get(session.queue[index] ?? '');
  const question = useMemo(() => (card ? buildQuestion(card, items, session.today) : null), [card, items, session.today]);
  const finished = index >= session.queue.length;

  const pick = useCallback(
    (i: number) => {
      if (!question || picked !== null) return;
      setPicked(i);
      const right = i === question.answer;
      recordReview(question.cardId, right);
      playSound(right ? 'win' : 'oops');
    },
    [question, picked],
  );

  const next = useCallback(() => {
    if (finished) return;
    setPicked(null);
    setIndex((n) => n + 1);
  }, [finished]);

  // Move focus to the new card (screen readers hear the question), but not on first load.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    cardRef.current?.focus({ preventScroll: true });
  }, [index]);

  useEffect(() => {
    if (picked !== null) nextRef.current?.focus({ preventScroll: true });
  }, [picked]);

  // Keyboard: 1–3 pick an answer; Space/Enter go to the next card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const n = Number(e.key);
      if (question && Number.isInteger(n) && n >= 1 && n <= question.options.length) {
        e.preventDefault();
        pick(n - 1);
      } else if ((e.key === ' ' || e.key === 'Enter') && !onControl(e.target) && picked !== null) {
        e.preventDefault();
        next();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [question, picked, pick, next]);

  const resume = progress.resume;
  const continueHref = resume ? `${resume.path}#c=${resume.cardId}` : startHref;

  if (!question || finished) {
    const done = reviewedToday(progress.review.cards, session.today);
    let title: string;
    let text: string;
    if (!session.hasLearned) {
      title = t('review.emptyTitle');
      text = t('review.emptyText');
    } else if (done > 0) {
      title = t('review.doneTitle');
      text = done === 1 ? t('review.doneOne') : t('review.doneMany', { n: done });
    } else {
      const nextDay = nextReviewDay(cards, progress.review.cards, learnedLessons(progress), session.today);
      const days = nextDay ? daysBetween(session.today, nextDay) : 1;
      title = t('review.caughtUpTitle');
      text = days <= 1 ? t('review.nextTomorrow') : t('review.nextIn', { n: days });
    }
    return (
      <section className="lesson-card review-card review-end" ref={cardRef} tabIndex={-1} aria-labelledby="review-end-title" data-review-end>
        <p className="review-end-star calm-hide" aria-hidden="true">
          ★
        </p>
        <h2 id="review-end-title">{title}</h2>
        <p>{text}</p>
        <div className="review-end-links">
          <a className="btn btn-big" href={continueHref} data-review-continue>
            {session.hasLearned ? t('review.continue') : t('review.start')}
          </a>
          <a className="btn btn-quiet" href={homeHref}>
            {t('review.home')}
          </a>
        </div>
      </section>
    );
  }

  const total = session.before + session.queue.length;
  const pos = session.before + index + 1;
  const right = picked !== null && picked === question.answer;
  const isLast = index === session.queue.length - 1;
  const answer = question.options[question.answer]!;
  const [before, after] = t('review.q.term', { term: '\u0000' }).split('\u0000') as [string, string?];

  return (
    <div className="review-deck" data-review-deck>
      <div className="review-top">
        <div
          className="review-bar"
          role="progressbar"
          aria-label={t('review.progress')}
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={pos}
          aria-valuetext={t('lesson.cardOf', { n: pos, total })}
        >
          <div className="review-fill" style={{ width: `${(pos / total) * 100}%` }} />
        </div>
        <p className="review-count" data-review-count>
          {t('lesson.cardOf', { n: pos, total })} · {t('lesson.lessThanMin')}
        </p>
      </div>

      <section
        key={question.cardId}
        className="lesson-card review-card"
        ref={cardRef}
        tabIndex={-1}
        aria-labelledby="review-step review-q"
        data-review-card={question.cardId}
        data-kind={question.kind}
      >
        <p className="card-step" id="review-step">
          <span className="card-step-icon step-check" aria-hidden="true">
            ↻
          </span>
          {t('review.step')}
        </p>
        <div className="card-content">
          {question.kind === 'term' ? (
            <p className="review-q" id="review-q">
              {before}
              <strong>{question.ask}</strong>
              {after}
            </p>
          ) : (
            <>
              <p className="review-q" id="review-q">
                {t(question.kind === 'command' ? 'review.q.command' : 'review.q.meaning')}
              </p>
              <p className="review-ask">{question.ask}</p>
            </>
          )}
          <ul className="choice-list" role="list">
            {question.options.map((o, i) => {
              const state = picked === null ? null : i === question.answer ? 'right' : i === picked ? 'almost' : null;
              return (
                <li key={o}>
                  <button
                    type="button"
                    className={cx('choice-btn', state && `is-${state}`)}
                    aria-pressed={picked === i}
                    disabled={picked !== null && state === null}
                    onClick={() => pick(i)}
                  >
                    <span className="choice-mark" aria-hidden="true">
                      {state === 'right' ? '✓' : state === 'almost' ? '↻' : i + 1}
                    </span>
                    <span>{question.kind === 'command' ? <code>{o}</code> : o}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {picked !== null && right && <Feedback kind="right">{pickPraise(t, progress.name, pos)}</Feedback>}
          {picked !== null && !right && (
            <Feedback kind="almost">
              {t('review.almost', { answer })} {t('review.again')}
            </Feedback>
          )}
        </div>
      </section>

      <div className="review-controls">
        <button type="button" ref={nextRef} className={cx('btn btn-big', picked !== null && 'is-ready')} onClick={next} data-review-next>
          {isLast ? t('review.finish') : t('review.next')} <span aria-hidden="true">→</span>
        </button>
      </div>
      <p className="visually-hidden">{t('review.keys')}</p>
    </div>
  );
}
