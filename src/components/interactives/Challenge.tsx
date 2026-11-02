// Boss challenge: several simulator stages in a row (escape room, diary site).
// Hints appear after 2 tries. Each stage starts fresh. Retry any time.
import { useState } from 'react';
import type { Goal, Scenario } from '~/engine/git-sim';
import type { Lang } from '~/i18n';
import Inline from './Inline';
import Sim, { type Panel } from './Sim';
import { Feedback, useCardEvents, useT } from './shared';
import './widgets.css';

export interface ChallengeProps {
  lang: Lang;
  stages: { title: string; text: string; scenario: Scenario; goal: Goal; hints?: string[]; panels?: Panel[] }[];
  /** "escape" uses escape-room words ("Disaster 2 of 6"). Default: neutral steps. */
  theme?: 'steps' | 'escape';
}

export default function Challenge({ lang, stages, theme = 'steps' }: ChallengeProps) {
  const t = useT(lang);
  const k = (key: string) => (theme === 'escape' ? `challenge.escape.${key}` : `challenge.${key}`);
  const { ref, emit } = useCardEvents();
  const [i, setI] = useState(0);
  const [solved, setSolved] = useState<Set<number>>(new Set());
  const stage = stages[i];
  const allDone = solved.size === stages.length;

  const onSolved = () => {
    const next = new Set(solved).add(i);
    setSolved(next);
    if (next.size === stages.length) emit('fl:done');
  };

  return (
    <div className="challenge" ref={ref}>
      <ol className="challenge-steps" aria-label={t(k('step'), { n: i + 1, total: stages.length })}>
        {stages.map((s, idx) => (
          <li key={idx}>
            <button type="button" className={`challenge-dot${idx === i ? ' is-on' : ''}${solved.has(idx) ? ' is-done' : ''}`} aria-current={idx === i ? 'step' : undefined} onClick={() => setI(idx)}>
              {solved.has(idx) ? '✓' : idx + 1}
              <span className="visually-hidden"> {s.title}</span>
            </button>
          </li>
        ))}
      </ol>
      {stage && (
        <div className="challenge-stage">
          <p className="challenge-title">
            {t(k('step'), { n: i + 1, total: stages.length })}: <strong>{stage.title}</strong>
          </p>
          <p>
            <Inline text={stage.text} />
          </p>
          <Sim
            key={i}
            lang={lang}
            scenario={stage.scenario}
            goal={stage.goal}
            hints={stage.hints ?? []}
            panels={stage.panels ?? ['areas', 'graph']}
            quiet
            onGoal={onSolved}
            success={t('challenge.solved')}
          />
          {solved.has(i) && i < stages.length - 1 && (
            <button type="button" className="btn challenge-next" onClick={() => setI(i + 1)}>
              {t(k('next'))} →
            </button>
          )}
        </div>
      )}
      {allDone && <Feedback kind="right">{t(k('allDone'))}</Feedback>}
    </div>
  );
}
