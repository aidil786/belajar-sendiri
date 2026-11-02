// Markdown playground: type on the left, see the page on the right (stacked on phones).
// The goal is a list of regexes on the source; all must match to finish.
import { useId, useMemo, useRef, useState } from 'react';
import type { Lang } from '~/i18n';
import MarkdownView from './MarkdownView';
import { Feedback, cx, pickPraise, useCardEvents, useLearnerName, useT } from './shared';

export interface MarkdownPlaygroundProps {
  lang: Lang;
  /** Starting text in the editor. */
  initial?: string;
  /** One short instruction above the editor. */
  prompt?: string;
  /** Regexes (multiline flag on) that must all match the source. hint[i] helps with mustMatch[i]. */
  goal?: { mustMatch: string[]; hint?: string[] };
  success?: string;
}

function compile(list: string[]): (RegExp | null)[] {
  return list.map((src) => {
    try {
      return new RegExp(src, 'm');
    } catch {
      return null;
    }
  });
}

export default function MarkdownPlayground({ lang, initial = '', prompt, goal, success }: MarkdownPlaygroundProps) {
  const t = useT(lang);
  const name = useLearnerName();
  const { ref, emit } = useCardEvents();
  const id = useId();
  const [src, setSrc] = useState(initial);
  const [previewOnly, setPreviewOnly] = useState(false);
  const [done, setDone] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const tries = useRef(0);
  const regexes = useMemo(() => compile(goal?.mustMatch ?? []), [goal]);
  const met = (text: string) => regexes.map((re) => Boolean(re?.test(text)));
  const metNow = met(src);
  const count = metNow.filter(Boolean).length;

  const change = (text: string) => {
    setSrc(text);
    setHint(null);
    if (!goal || done) return;
    if (regexes.length && met(text).every(Boolean)) {
      setDone(true);
      emit('fl:done', { tries: tries.current });
    }
  };

  const check = () => {
    tries.current++;
    const missing = metNow.findIndex((m) => !m);
    if (missing === -1) return;
    setHint(goal?.hint?.[missing] ?? t('mdplay.keepGoing'));
    emit('fl:wrong');
  };

  return (
    <div className="mdplay" ref={ref}>
      {prompt && <p className="interactive-help">{prompt}</p>}
      <div className="mdplay-toolbar">
        <button type="button" className="btn btn-ghost scene-btn" aria-pressed={previewOnly} onClick={() => setPreviewOnly(!previewOnly)}>
          {previewOnly ? '✎ ' : '👁 '}
          {t('mdplay.previewOnly')}
        </button>
      </div>
      <div className={cx('mdplay-panes', previewOnly && 'is-preview-only')}>
        <div className="mdplay-pane mdplay-edit">
          <label className="mdplay-label" htmlFor={`${id}-src`}>
            {t('mdplay.editor')}
          </label>
          <textarea
            id={`${id}-src`}
            className="mdplay-input"
            rows={9}
            value={src}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(e) => change(e.target.value)}
          />
        </div>
        <section className="mdplay-pane mdplay-preview" aria-labelledby={`${id}-pv`}>
          <p className="mdplay-label" id={`${id}-pv`}>
            {t('mdplay.preview')}
          </p>
          <div className="mdplay-preview-box">
            {src.trim() ? <MarkdownView lang={lang} source={src} /> : <p className="mdplay-empty">{t('mdplay.empty')}</p>}
          </div>
        </section>
      </div>
      {goal && regexes.length > 0 && (
        <div className="mdplay-foot">
          <p className="mdplay-goals">
            <span aria-hidden="true">{done ? '✓ ' : '○ '}</span>
            {t('mdplay.goals', { done: count, total: regexes.length })}
          </p>
          {!done && (
            <button type="button" className="btn btn-ghost scene-btn" onClick={check}>
              {t('mdplay.check')}
            </button>
          )}
        </div>
      )}
      {hint && !done && (
        <Feedback kind="almost">
          {t('feedback.almost')} {hint}
        </Feedback>
      )}
      {done && <Feedback kind="right">{success ?? `${pickPraise(t, name, tries.current)} ${t('mdplay.done')}`}</Feedback>}
    </div>
  );
}
