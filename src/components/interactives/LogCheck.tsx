// Real mission check: paste your own `git log --oneline` output.
// Everything stays in the browser. No network, no account.
import { useState } from 'react';
import { isCleanMessage } from '~/engine/git-sim';
import type { Lang } from '~/i18n';
import { Feedback, useCardEvents, useT } from './shared';
import './widgets.css';

export interface LogCheckProps {
  lang: Lang;
  min: number;
}

export function parseOneline(text: string): { hash: string; message: string }[] {
  const out: { hash: string; message: string }[] = [];
  for (const raw of text.split('\n')) {
    // Optional graph characters, then hash, optional (decorations), then the message.
    const m = /^[\s*|\\/]*([0-9a-f]{7,40})\s+(?:\([^)]*\)\s+)?(.+?)\s*$/.exec(raw);
    if (m) out.push({ hash: m[1]!, message: m[2]! });
  }
  return out;
}

export default function LogCheck({ lang, min }: LogCheckProps) {
  const t = useT(lang);
  const { ref, emit } = useCardEvents();
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ count: number; clean: number; tips: string[]; pass: boolean } | null>(null);

  const check = () => {
    const commits = parseOneline(text);
    const unclean = commits.filter((c) => !isCleanMessage(c.message));
    const clean = commits.length - unclean.length;
    const pass = commits.length >= min && clean >= min;
    setResult({ count: commits.length, clean, tips: unclean.slice(0, 3).map((c) => c.message), pass });
    if (pass) emit('fl:done');
    else emit('fl:wrong');
  };

  return (
    <div className="logcheck" ref={ref}>
      <label className="logcheck-label" htmlFor="logcheck-input">
        {t('log.label')}
      </label>
      <textarea
        id="logcheck-input"
        className="logcheck-input"
        rows={6}
        value={text}
        spellCheck={false}
        placeholder={'a1b2c3d (HEAD -> main) Add day 3 entry\n9f8e7d6 Add about page'}
        onChange={(e) => setText(e.target.value)}
      />
      <button type="button" className="btn" disabled={!text.trim()} onClick={check}>
        {t('log.check')}
      </button>
      {result && (
        <div aria-live="polite">
          <p className="logcheck-stats">
            {t('log.found', { n: result.count })} {t('log.goodMessages', { n: result.clean })}
          </p>
          {result.count < min && <Feedback kind="almost">{t('log.need', { n: min })}</Feedback>}
          {result.tips.map((m) => (
            <p key={m} className="logcheck-tip">
              {t('log.tipMessage', { message: m })}
            </p>
          ))}
          {result.pass && <Feedback kind="right">{t('log.pass')}</Feedback>}
        </div>
      )}
    </div>
  );
}
