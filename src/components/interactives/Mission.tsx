// Real mission: a small checklist done on the learner's own computer. Ticks are saved.
import { useStore } from '@nanostores/react';
import { useEffect, useRef, useState } from 'react';
import type { Lang } from '~/i18n';
import { $progress, tickMission } from '~/stores/progress';
import Inline from './Inline';
import { Feedback, cx, useCardEvents, useT } from './shared';
import './widgets.css';

export interface MissionStep {
  id: string;
  text: string;
  command?: string;
}

export interface MissionProps {
  lang: Lang;
  id: string;
  steps: MissionStep[];
  success?: string;
  title?: string;
}

export function MissionList({ lang, id, steps, success, title, onDone }: MissionProps & { onDone: () => void }) {
  const t = useT(lang);
  const saved = useStore($progress).missions[id] ?? [];
  const [copied, setCopied] = useState<string | null>(null);
  const done = steps.every((s) => saved.includes(s.id));
  const reported = useRef(done);

  useEffect(() => {
    if (done && !reported.current) {
      reported.current = true;
      onDone();
    }
  }, [done, onDone]);

  const copy = async (step: MissionStep) => {
    try {
      await navigator.clipboard.writeText(step.command ?? '');
      setCopied(step.id);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked: the command is still visible to copy by hand */
    }
  };

  return (
    <div className="mission">
      <p className="mission-title">
        <span aria-hidden="true">🎯 </span>
        {title ?? t('mission.title')}
      </p>
      <ol className="mission-steps">
        {steps.map((s) => {
          const ticked = saved.includes(s.id);
          return (
            <li key={s.id} className={cx('mission-step', ticked && 'is-done')}>
              <label className="mission-check">
                <input type="checkbox" checked={ticked} onChange={(e) => tickMission(id, s.id, e.target.checked)} />
                <span>
                  <Inline text={s.text} />
                </span>
              </label>
              {s.command && (
                <div className="mission-cmd">
                  <code>{s.command}</code>
                  <button type="button" className="btn btn-quiet mission-copy" onClick={() => copy(s)}>
                    {copied === s.id ? t('mission.copied') : t('mission.copy')}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mission-progress">
        {t('mission.steps', { done: steps.filter((s) => saved.includes(s.id)).length, total: steps.length })} · {t('mission.saved')}
      </p>
      {done && <Feedback kind="right">{success ?? t('mission.done')}</Feedback>}
    </div>
  );
}

export default function Mission(props: MissionProps) {
  const { ref, emit } = useCardEvents();
  return (
    <div ref={ref}>
      <MissionList {...props} onDone={() => emit('fl:done')} />
    </div>
  );
}
