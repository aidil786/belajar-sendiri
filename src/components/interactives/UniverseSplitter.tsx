// Universe splitter: branches as parallel universes. Each branch is a lane of the
// commit graph. Tap a lane (or use the universe buttons / arrow keys) to switch:
// HEAD moves and you see that universe's files. Or pick a commit and stick a new
// branch on it. Every move is a real command run by the engine.
import { AnimatePresence, motion } from 'motion/react';
import { useId, useMemo, useState } from 'react';
import { buildScenario, run, type Line, type Scenario, type SimState } from '~/engine/git-sim';
import type { Lang } from '~/i18n';
import { createCommand, currentBranch, filesIn, laneTarget, taskDone, universes, type UniverseTask } from '~/lib/universe';
import CommitGraph from './CommitGraph';
import { layoutGraph, type GraphNode } from './graphLayout';
import Inline from './Inline';
import { Feedback, cx, pickPraise, useCardEvents, useLearnerName, useMotionOK, useT } from './shared';
import './branch-lab.css';
import './quiz.css';

export interface UniverseSplitterProps {
  lang: Lang;
  scenario: Scenario;
  /** Commands run (silently) after the scenario, before the learner starts. */
  commands?: string[];
  /** File to show from the current universe (default: the first file that differs between universes). */
  file?: string;
  task: UniverseTask;
  prompt?: string;
  success?: string;
}

const NONE: string[] = [];

export default function UniverseSplitter({ lang, scenario, commands = NONE, file, task, prompt, success }: UniverseSplitterProps) {
  const t = useT(lang);
  const name = useLearnerName();
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();
  const radio = useId();
  const inputId = useId();

  const start = useMemo(() => {
    let s = buildScenario(scenario);
    for (const c of commands) s = run(s, c).state;
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario.id, commands.join('\n')]);
  const startBranches = useMemo(() => universes(start).map((u) => u.branch), [start]);

  const [state, setState] = useState<SimState>(start);
  const [visited, setVisited] = useState<Set<string>>(() => new Set([currentBranch(start) ?? '']));
  const [last, setLast] = useState<{ cmd: string; lines: Line[]; explain: string } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [newName, setNewName] = useState(task.type === 'create' ? (task.name ?? '') : '');
  const [msg, setMsg] = useState<string | null>(null);
  const [wrongPick, setWrongPick] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [tries, setTries] = useState(0);

  const creating = task.type === 'create';
  const layout = layoutGraph(state);
  const list = universes(state);
  const here = currentBranch(state);
  const files = filesIn(state);
  const shownFile = useMemo(() => {
    if (file) return file;
    // The first file that is different (or missing) in another universe.
    const mine = filesIn(start);
    for (const u of universes(start)) {
      const other = filesIn(run(start, `git switch ${u.branch}`).state);
      const diff = [...new Set([...Object.keys(mine), ...Object.keys(other)])].sort().find((p) => mine[p] !== other[p]);
      if (diff && diff in mine) return diff;
    }
    return Object.keys(mine).sort()[0] ?? '';
  }, [file, start]);

  const finish = (next: SimState, seen: Set<string>) => {
    if (!done && taskDone(task, next, seen, startBranches)) {
      setDone(true);
      setMsg(null);
      emit('fl:done');
    }
  };

  const runCmd = (cmd: string): SimState | null => {
    const r = run(state, cmd);
    setLast({ cmd, lines: r.output, explain: r.explain ? t(r.explain.key, r.explain.params) : '' });
    if (!r.ok) return null;
    setState(r.state);
    return r.state;
  };

  const switchTo = (branch: string) => {
    if (branch === here) return;
    const next = runCmd(`git switch ${branch}`);
    if (!next) return;
    const seen = new Set(visited).add(branch);
    setVisited(seen);
    setTries((x) => x + 1);
    finish(next, seen);
  };

  const pick = (n: GraphNode) => {
    if (done) return;
    setPicked(n.id);
    setWrongPick(null);
    setMsg(null);
  };

  const create = () => {
    if (task.type !== 'create' || !picked || done) return;
    setTries((x) => x + 1);
    const node = layout.nodes.find((n) => n.id === picked);
    if (!node) return;
    if (!new RegExp(task.at, 'i').test(node.message)) {
      setWrongPick(node.id);
      setMsg(t('universe.wrongCommit', { message: node.message }));
      emit('fl:wrong');
      return;
    }
    const label = newName.trim();
    if (!label) {
      setMsg(t('universe.needName'));
      emit('fl:wrong');
      return;
    }
    if (task.name && label !== task.name) {
      setMsg(t('universe.wrongName', { name: task.name }));
      emit('fl:wrong');
      return;
    }
    const next = runCmd(createCommand(label, node.short, Boolean(task.switch)));
    if (!next) {
      setMsg(t('universe.gitSaidNo'));
      emit('fl:wrong');
      return;
    }
    const seen = new Set(visited);
    const cur = currentBranch(next);
    if (cur) seen.add(cur);
    setVisited(seen);
    finish(next, seen);
  };

  const reset = () => {
    setState(start);
    setVisited(new Set([currentBranch(start) ?? '']));
    setLast(null);
    setPicked(null);
    setWrongPick(null);
    setMsg(null);
    setDone(false);
  };

  // Lane bands behind the graph: tap a lane to jump into that universe (pointer only;
  // the universe buttons below are the keyboard and screen-reader path).
  const laneRows = [...new Set(list.map((u) => u.lane))].sort((a, b) => a - b);
  const rowY = (lane: number) => layout.nodes.find((n) => n.lane === lane)?.py ?? 0;
  const underlay = creating ? null : (
    <g aria-hidden="true">
      {laneRows.map((lane) => {
        const target = laneTarget(list, lane);
        const isHere = list.some((u) => u.lane === lane && u.current);
        return (
          <rect
            key={lane}
            x={4}
            y={rowY(lane) - 24}
            width={Math.max(0, layout.width - 8)}
            height={48}
            rx={24}
            className={cx('us-band', isHere && 'is-here', target && 'is-target')}
            onClick={target ? () => switchTo(target) : undefined}
          />
        );
      })}
    </g>
  );

  const helpKey = creating ? 'universe.helpCreate' : task.type === 'switch' ? 'universe.helpSwitch' : 'universe.helpVisit';
  const content = files[shownFile];
  const pickedNode = picked ? layout.nodes.find((n) => n.id === picked) : undefined;

  return (
    <div className={cx('us', creating ? 'us-create' : 'us-switch')} ref={ref}>
      <p className="interactive-help">
        {prompt ? <Inline text={prompt} /> : t(helpKey)}
      </p>

      <CommitGraph
        t={t}
        layout={layout}
        motionOK={motionOK}
        onPick={creating && !done ? pick : undefined}
        picked={picked}
        highlight={wrongPick ? { [wrongPick]: 'almost' } : done && pickedNode ? { [pickedNode.id]: 'right' } : undefined}
        underlay={underlay}
      />

      {!creating && (
        <fieldset className="us-switcher">
          <legend className="us-legend">{t('universe.legend')}</legend>
          <div className="us-options">
            {list.map((u) => (
              <label key={u.branch} className={cx('us-option', u.current && 'is-current')}>
                <input type="radio" name={radio} checked={u.current} onChange={() => switchTo(u.branch)} />
                <span className="us-planet" aria-hidden="true">
                  {u.current ? '●' : '○'}
                </span>
                <code>{u.branch}</code>
                {task.type === 'visitAll' && visited.has(u.branch) && (
                  <span className="us-seen">
                    <span aria-hidden="true">✓</span>
                    <span className="visually-hidden">{t('universe.visited')}</span>
                  </span>
                )}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {creating && (
        <form
          className="us-create-form"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <p className="us-picked" aria-live="polite">
            {pickedNode ? t('universe.picked', { hash: pickedNode.short, message: pickedNode.message }) : t('universe.pickFirst')}
          </p>
          <label htmlFor={inputId} className="us-label">
            {t('universe.nameLabel')}
          </label>
          <div className="us-create-row">
            <input id={inputId} className="us-input" value={newName} disabled={done} autoComplete="off" spellCheck={false} onChange={(e) => setNewName(e.target.value)} />
            <button type="submit" className="btn" disabled={!picked || done}>
              {task.type === 'create' && task.switch ? t('universe.makeSwitch') : t('universe.make')}
            </button>
          </div>
        </form>
      )}

      {last && (
        <pre className="replay us-term" aria-label={t('universe.terminal')}>
          <span className="replay-line">
            <span className="replay-prompt">$</span> {last.cmd}
          </span>
          {last.lines.map((l, i) => (
            <span key={i} className="replay-line">
              {l.map((s, j) => (
                <span key={j} className={s.c ? `seg-${s.c}` : undefined}>
                  {s.t.replace(/\t/g, '    ')}
                </span>
              ))}
            </span>
          ))}
        </pre>
      )}
      {creating && last?.explain && <p className="us-explain">{last.explain}</p>}

      {!creating && (
        <section className="us-files" aria-live="polite" aria-label={t('universe.filesIn', { branch: here ?? '' })}>
          <p className="us-files-head">
            <span aria-hidden="true">◐ </span>
            {t('universe.filesIn', { branch: here ?? '' })}
          </p>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={here ?? ''}
              initial={motionOK ? { opacity: 0, y: 6 } : false}
              animate={{ opacity: 1, y: 0 }}
              exit={motionOK ? { opacity: 0, y: -6 } : { opacity: 1 }}
              transition={{ duration: motionOK ? 0.25 : 0 }}
            >
              <ul className="us-chips">
                {Object.keys(files)
                  .sort()
                  .map((p) => (
                    <li key={p} className={cx('us-chip', p === shownFile && 'is-shown')}>
                      {p}
                    </li>
                  ))}
              </ul>
              {shownFile && (
                <>
                  <p className="us-file-name">
                    <code>{shownFile}</code>
                  </p>
                  {content === undefined ? <p className="us-nofile">{t('universe.noFile', { file: shownFile })}</p> : <pre className="us-file">{content}</pre>}
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </section>
      )}

      {msg && !done && (
        <Feedback kind="almost">
          {t('feedback.almost')} {msg}
        </Feedback>
      )}
      {done && (
        <Feedback kind="right">
          {success ? <Inline text={success} /> : `${pickPraise(t, name, tries)} ${t(creating ? 'universe.doneCreate' : 'universe.doneSwitch')}`}
        </Feedback>
      )}
      {(last || picked) && (
        <div className="us-toolbar">
          <button type="button" className="btn btn-quiet" onClick={reset}>
            ↺ {t('feedback.reset')}
          </button>
        </div>
      )}
    </div>
  );
}
