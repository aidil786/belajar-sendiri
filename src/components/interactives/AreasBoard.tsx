// Live Three Areas board for the simulator. It reads the engine state.
// Tapping a file puts the matching command in the terminal, ready to run.
import { LayoutGroup, motion } from 'motion/react';
import { useId } from 'react';
import { computeStatus, findRepo, headId, history, subject, type SimState } from '~/engine/git-sim';
import { ZoneIcon, type Zone } from './AreaIcons';
import { ChipView, type Chip } from './AreasScene';
import { cx, type T } from './shared';
import './areas.css';

interface BoardChip extends Chip {
  zone: Zone;
  command: string | null;
}

function chipsFor(state: SimState): BoardChip[] {
  const repo = findRepo(state);
  if (!repo) return [];
  const st = computeStatus(state, repo);
  const out: BoardChip[] = [];
  for (const e of st.unstaged) {
    out.push({ name: e.path, tag: e.kind === 'deleted' ? 'deleted' : 'changed', zone: 'working', command: `git add ${e.path}` });
  }
  for (const p of st.untracked) out.push({ name: p, tag: 'new', zone: 'working', command: `git add ${p}` });
  // Conflicted files wait in the folder until you fix them and git add them.
  for (const e of st.unmerged) out.push({ name: e.path, tag: 'changed', zone: 'working', command: `git add ${e.path}` });
  for (const e of st.staged) {
    const tag = e.kind === 'new file' ? 'new' : e.kind === 'deleted' ? 'deleted' : 'changed';
    const name = e.kind === 'renamed' ? `${e.from} → ${e.path}` : e.path;
    // A file can be both staged and changed again: keep keys unique.
    out.push({ name, tag, zone: 'staging', command: `git restore --staged ${e.path}` });
  }
  return out;
}

export default function AreasBoard({ t, state, motionOK, onCommand }: { t: T; state: SimState; motionOK: boolean; onCommand: (cmd: string) => void }) {
  const uid = useId();
  const repo = findRepo(state);
  const chips = chipsFor(state);
  const log = repo ? history(repo, headId(repo)) : [];
  const zones: Zone[] = ['working', 'staging', 'repo'];
  return (
    <LayoutGroup id={uid}>
      <div className="areas areas-3 areas-live">
        {zones.map((zone) => (
          <div key={zone} className={cx('area', `area-${zone}`)}>
            <div className="area-head">
              <ZoneIcon zone={zone} />
              <span>{t(`areas.${zone}`)}</span>
            </div>
            <ul className="area-list">
              {zone === 'repo' ? (
                <>
                  <li className="area-count">
                    {log.length === 0 ? t('areas.noCommits') : log.length === 1 ? t('areas.oneCommit') : t('areas.commits', { n: log.length })}
                  </li>
                  {log.slice(0, 3).map((c) => (
                    <motion.li key={c.id} layout={motionOK} initial={motionOK ? { opacity: 0, x: -40, scale: 0.7 } : false} animate={{ opacity: 1, x: 0, scale: 1 }} transition={{ duration: motionOK ? 0.5 : 0 }}>
                      <ChipView chip={{ name: subject(c.message), kind: 'commit' }} t={t} />
                    </motion.li>
                  ))}
                </>
              ) : (
                <>
                  {chips
                    .filter((c) => c.zone === zone)
                    .map((c) => (
                      <motion.li key={`${c.zone}:${c.name}`} layoutId={`${uid}-${c.name}`} layout={motionOK} transition={{ duration: motionOK ? 0.45 : 0 }}>
                        <button
                          type="button"
                          className="board-chip"
                          onClick={() => c.command && onCommand(c.command)}
                        >
                          <ChipView chip={c} t={t} />
                          <span className="visually-hidden">. {t('areas.commandShown', { command: c.command ?? '' })}</span>
                        </button>
                      </motion.li>
                    ))}
                  {chips.every((c) => c.zone !== zone) && <li className="area-empty">{t('areas.empty')}</li>}
                </>
              )}
            </ul>
          </div>
        ))}
      </div>
    </LayoutGroup>
  );
}
