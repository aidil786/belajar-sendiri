// Lesson player: shows one card at a time, saves after every card,
// handles Next/Back, Peek, Hint, keys, and the win card.
import { format } from '~/i18n';
import { earnedBadges, type BadgeRule } from '~/lib/badges';
import { celebrate } from '~/lib/celebrate';
import { playSound } from '~/lib/sound';
import { $progress, applySettings, completeLesson, markCardDone, recordCard, vote, type Vote } from '~/stores/progress';

interface LessonData {
  lessonId: string;
  kind: 'lesson' | 'boss';
  minutes: number;
  xp: number;
  lang: 'en' | 'ms';
  badgeRules: BadgeRule[];
  /** Badge id → name (from course.yaml, or i18n for older badges). */
  badgeNames: Record<string, string>;
  strings: Record<string, string>;
}

const $ = <T extends Element>(root: ParentNode, sel: string) => root.querySelector<T>(sel);

/** Keys never fire while typing (terminal, inputs) or while a button has focus. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    Boolean(target.closest('.xterm, .term'))
  );
}

function reducedMotion(): boolean {
  return $progress.get().settings.calm || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function initPlayer(): void {
  const root = $<HTMLElement>(document, '[data-player-root]');
  const dataEl = $<HTMLScriptElement>(document, '[data-lesson-data]');
  if (!root || !dataEl) return;
  applySettings();
  const data = JSON.parse(dataEl.textContent ?? '{}') as LessonData;
  const s = (key: string, params?: Record<string, string | number>) => format(data.strings[key] ?? key, params);

  const player = $<HTMLElement>(root, '[data-player]')!;
  const cards = [...player.querySelectorAll<HTMLElement>('.lesson-card')];
  const deeper = player.querySelector<HTMLElement>('.deeper');
  const total = cards.length;
  const progress = $<HTMLElement>(root, '[data-progress]')!;
  const fill = $<HTMLElement>(root, '[data-progress-fill]')!;
  const count = $<HTMLElement>(root, '[data-count]')!;
  const backBtn = $<HTMLButtonElement>(root, '[data-back]')!;
  const nextBtn = $<HTMLButtonElement>(root, '[data-next]')!;
  const nextLabel = $<HTMLElement>(root, '[data-next-label]')!;
  const hintBtn = $<HTMLButtonElement>(root, '[data-hint-btn]')!;
  const peekBtn = $<HTMLButtonElement>(root, '[data-peek-btn]')!;
  const peekPanel = $<HTMLElement>(root, '[data-peek-panel]')!;
  const peekBody = $<HTMLElement>(root, '[data-peek-body]')!;
  const peekStore = $<HTMLElement>(root, '[data-peek-store]')!;
  const win = $<HTMLElement>(root, '[data-win-extras]')!;
  const mascot = $<HTMLElement>(root, '[data-mascot]');
  const toggles = [...document.querySelectorAll<HTMLAnchorElement>('[data-lang-toggle]')];
  const nextLesson = $<HTMLAnchorElement>(root, '[data-next-lesson]');

  let index = Math.max(0, cards.findIndex((c) => c.classList.contains('is-active')));
  let moodTimer = 0;
  let completedNow = false;

  const setMood = (mood: 'idle' | 'happy' | 'thinking' | 'oops', ms = 1600) => {
    if (!mascot) return;
    mascot.dataset.mood = mood;
    window.clearTimeout(moodTimer);
    if (mood !== 'idle') moodTimer = window.setTimeout(() => (mascot.dataset.mood = 'idle'), ms);
  };

  const finishLesson = () => {
    if (completedNow) return;
    completedNow = true;
    const result = completeLesson(data.lessonId, data.xp, (p) => earnedBadges(data.badgeRules, p.completed));
    const xpEl = $<HTMLElement>(win, '[data-win-xp]')!;
    const repeat = $<HTMLElement>(win, '[data-win-repeat]')!;
    if (result.xp > 0) xpEl.textContent = s('lesson.xp', { xp: result.xp });
    else {
      xpEl.textContent = '';
      repeat.hidden = false;
    }
    const list = $<HTMLElement>(win, '[data-win-badges]')!;
    list.replaceChildren(
      ...result.badges.map((b) => {
        const li = document.createElement('li');
        li.className = 'win-badge';
        li.textContent = `★ ${s('win.badge', { badge: data.badgeNames?.[b] ?? s(`badge.${b}`) })}`;
        return li;
      }),
    );
    playSound('win');
    setMood('happy', 2500);
    // The whole lesson is done: a bigger burst from the star.
    const star = $<HTMLElement>(win, '.win-burst');
    if (star) window.requestAnimationFrame(() => celebrate(star, 30));
  };

  const show = (i: number, opts: { focus?: boolean } = {}) => {
    index = Math.min(total - 1, Math.max(0, i));
    const card = cards[index]!;
    cards.forEach((c, j) => c.classList.toggle('is-active', j === index));
    const id = card.dataset.cardId!;
    const type = card.dataset.cardType;
    const isWin = type === 'win';

    // Progress: "card 4 of 8", "2 min left". Moving forward sweeps a light across the bar.
    const pct = ((index + 1) / total) * 100;
    const forward = pct > parseFloat(fill.style.width || '0');
    fill.style.width = `${pct}%`;
    if (forward && opts.focus) {
      fill.classList.remove('is-bump');
      void fill.offsetWidth; // restart the sweep
      fill.classList.add('is-bump');
    }
    progress.setAttribute('aria-valuemax', String(total));
    progress.setAttribute('aria-valuenow', String(index + 1));
    progress.setAttribute('aria-valuetext', s('lesson.cardOf', { n: index + 1, total }));
    const left = (data.minutes * (total - index - 1)) / total;
    const leftText = left < 1 ? s('lesson.lessThanMin') : s('lesson.minLeft', { n: Math.ceil(left) });
    count.textContent = `${s('lesson.cardOf', { n: index + 1, total })} · ${leftText}`;

    backBtn.disabled = index === 0;
    nextLabel.textContent = isWin ? s('lesson.finish') : s('lesson.next');
    nextBtn.hidden = isWin && Boolean(nextLesson);
    nextBtn.classList.toggle('is-ready', card.dataset.done === 'true');

    // Hint button only when this card has a hint.
    const hint = card.querySelector<HTMLElement>('[data-hint]');
    hintBtn.hidden = !hint;
    hintBtn.setAttribute('aria-expanded', String(Boolean(hint && !hint.hidden)));

    closePeek();
    win.hidden = !isWin;
    if (deeper) {
      deeper.hidden = !isWin;
      if (isWin) win.after(deeper);
    }

    // Keep the language switch on the same card.
    for (const a of toggles) {
      const url = new URL(a.href, location.href);
      url.hash = `c=${id}`;
      a.href = url.toString();
    }
    history.replaceState(null, '', `#c=${id}`);
    recordCard(data.lessonId, id, index, location.pathname);
    if (isWin) finishLesson();

    if (opts.focus) {
      card.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
  };

  const next = () => {
    player.dataset.dir = 'forward';
    if (index < total - 1) show(index + 1, { focus: true });
    else if (nextLesson) location.href = nextLesson.href;
  };
  const back = () => {
    player.dataset.dir = 'back';
    if (index > 0) show(index - 1, { focus: true });
  };

  const toggleHint = () => {
    const hint = cards[index]?.querySelector<HTMLElement>('[data-hint]');
    if (!hint) return;
    hint.hidden = !hint.hidden;
    hintBtn.setAttribute('aria-expanded', String(!hint.hidden));
    if (!hint.hidden) setMood('thinking');
  };

  function closePeek() {
    peekPanel.hidden = true;
    peekBtn.setAttribute('aria-expanded', 'false');
    peekBtn.textContent = s('lesson.peek');
  }

  const togglePeek = () => {
    if (!peekPanel.hidden) {
      closePeek();
      return;
    }
    const id = cards[index]?.dataset.cardId;
    const tpl = peekStore.querySelector<HTMLTemplateElement>(`template[data-peek-for="${id}"]`);
    peekBody.replaceChildren();
    if (tpl && tpl.content.textContent?.trim()) peekBody.append(tpl.content.cloneNode(true));
    else peekBody.textContent = s('lesson.peekNoText');
    peekPanel.hidden = false;
    // Place the panel right under the active card.
    cards[index]?.after(peekPanel);
    peekBtn.setAttribute('aria-expanded', 'true');
    peekBtn.textContent = s('lesson.peekClose');
  };

  nextBtn.addEventListener('click', next);
  backBtn.addEventListener('click', back);
  hintBtn.addEventListener('click', toggleHint);
  peekBtn.addEventListener('click', togglePeek);

  // Interactives report what happened.
  player.addEventListener('fl:done', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.lesson-card');
    if (!card) return;
    // First time this card is done: a small burst from the Next button ("go on!").
    if (card.dataset.done !== 'true' && card === cards[index]) celebrate(nextBtn);
    card.dataset.done = 'true';
    markCardDone(data.lessonId, card.dataset.cardId!);
    if (card === cards[index]) nextBtn.classList.add('is-ready');
    setMood('happy');
  });
  player.addEventListener('fl:wrong', () => setMood('oops'));
  player.addEventListener('fl:hint', () => setMood('thinking'));

  // Feedback vote (stored locally; exportable from settings).
  const voteBox = $<HTMLElement>(win, '[data-vote]')!;
  const previous = $progress.get().votes.find((v) => v.lessonId === data.lessonId)?.vote;
  for (const btn of voteBox.querySelectorAll<HTMLButtonElement>('[data-vote-value]')) {
    if (btn.dataset.voteValue === previous) btn.setAttribute('aria-pressed', 'true');
    btn.addEventListener('click', () => {
      vote(data.lessonId, btn.dataset.voteValue as Vote);
      voteBox.querySelectorAll('[data-vote-value]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      $<HTMLElement>(voteBox, '[data-vote-thanks]')!.hidden = false;
    });
  }

  // Keyboard: Space/Enter next, Backspace back, ? hint, L language.
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return;
    const onControl = e.target instanceof HTMLElement && e.target.closest('button, a, summary, [role="button"], details');
    if ((e.key === ' ' || e.key === 'Enter') && !onControl) {
      e.preventDefault();
      next();
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      back();
    } else if (e.key === '?') {
      e.preventDefault();
      toggleHint();
    } else if (e.key === 'l' || e.key === 'L') {
      const a = toggles[0];
      if (a) {
        e.preventDefault();
        a.click();
      }
    }
  });

  window.addEventListener('hashchange', () => {
    const m = /c=([\w-]+)/.exec(location.hash);
    const i = m ? cards.findIndex((c) => c.dataset.cardId === m[1]) : -1;
    if (i >= 0 && i !== index) show(i, { focus: true });
  });

  // Restore "done" marks from earlier visits.
  const saved = $progress.get().lessons[data.lessonId];
  for (const c of cards) if (saved?.done.includes(c.dataset.cardId!)) c.dataset.done = 'true';

  show(index);
}
