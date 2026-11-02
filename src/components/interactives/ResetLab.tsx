// Reset lab: try --soft, --mixed and --hard on the same starting point and
// see which areas keep the changes and which lose them.
import { useMemo, useState } from 'react';
import { buildScenario, computeStatus, findRepo, run, type Scenario, type SimState } from '~/engine/git-sim';
import type { Lang } from '~/i18n';
import AreasBoard from './AreasBoard';
import CommitGraph from './CommitGraph';
import { layoutGraph } from './graphLayout';
import { DangerIcon } from './AreaIcons';
import { Feedback, cx, useCardEvents, useMotionOK, useT } from './shared';
import './widgets.css';

type Mode = 'soft' | 'mixed' | 'hard';
const MODES: Mode[] = ['soft', 'mixed', 'hard'];

export interface ResetLabProps {
  lang: Lang;
  scenario: Scenario;
}

export default function ResetLab({ lang, scenario }: ResetLabProps) {
  const t = useT(lang);
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();
  const start = useMemo(() => buildScenario(scenario), [scenario]);
  const [mode, setMode] = useState<Mode | null>(null);
  const [state, setState] = useState<SimState>(start);
  const [tried, setTried] = useState<Set<Mode>>(new Set());

  const pick = (m: Mode) => {
    const r = run(start, `git reset --${m} HEAD~1`);
    setState(r.state);
    setMode(m);
    const next = new Set(tried).add(m);
    setTried(next);
    if (next.size === 3 && tried.size < 3) emit('fl:done');
  };

  const repo = findRepo(state);
  const st = repo ? computeStatus(state, repo) : null;
  const box = st && st.staged.length > 0 ? 'kept' : 'wiped';
  const folder = st && (st.staged.length > 0 || st.unstaged.length > 0) ? 'kept' : 'wiped';

  return (
    <div className="resetlab" ref={ref}>
      <p className="interactive-help">{t('reset.pick')}</p>
      <div className="resetlab-modes" role="group" aria-label={t('reset.pick')}>
        {MODES.map((m) => (
          <button key={m} type="button" className={cx('btn', mode === m ? '' : 'btn-ghost')} aria-pressed={mode === m} onClick={() => pick(m)}>
            <code>git reset --{m}</code>
            {tried.has(m) && <span aria-hidden="true"> ✓</span>}
          </button>
        ))}
      </div>
      <div className="resetlab-board">
        <CommitGraph t={t} layout={layoutGraph(state, { showLost: true })} motionOK={motionOK} />
        <AreasBoard t={t} state={state} motionOK={motionOK} onCommand={() => undefined} />
      </div>
      {mode && (
        <dl className="resetlab-result" aria-live="polite">
          <div>
            <dt>{t('areas.repo')}</dt>
            <dd>{t('reset.moved')}</dd>
          </div>
          <div>
            <dt>{t('areas.staging')}</dt>
            <dd className={cx(box === 'wiped' && 'is-wiped')}>{box === 'kept' ? t('reset.kept') : mode === 'hard' ? t('reset.wiped') : '—'}</dd>
          </div>
          <div>
            <dt>{t('areas.working')}</dt>
            <dd className={cx(folder === 'wiped' && 'is-wiped')}>
              {folder === 'wiped' && <DangerIcon />} {folder === 'kept' ? t('reset.kept') : t('reset.wiped')}
            </dd>
          </div>
        </dl>
      )}
      <p className="resetlab-tried">{t('reset.tried', { n: tried.size })}</p>
      {tried.size === 3 && <Feedback kind="right">{t('feedback.right')}</Feedback>}
    </div>
  );
}
