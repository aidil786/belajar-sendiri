// Build a GitHub Actions workflow by stacking blocks. The YAML and a little
// pipeline update live; "Run" lights up trigger → job → steps when the order is right.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Lang } from '~/i18n';
import { buildYaml, checkOrder, highlightYaml, pipeline, type YamlBlock } from '~/lib/yamlBuilder';
import { Announce, Feedback, cx, pickPraise, seededShuffle, useCardEvents, useLearnerName, useMotionOK, useT } from './shared';
import './yaml-builder.css';

export interface YamlBuilderProps {
  lang: Lang;
  /** All blocks the learner can pick from (the goal blocks plus decoys). */
  blocks: YamlBlock[];
  /** Block ids in the required order. */
  goal: { order: string[] };
  /** The workflow's `name:` (called `workflow` because `name` picks the interactive). */
  workflow: string;
  success?: string;
}

const ICON: Record<YamlBlock['kind'], string> = { trigger: '⚡', job: '⚙', step: '▸', permissions: '🔒', env: '≡' };

export default function YamlBuilder({ lang, blocks, goal, workflow, success }: YamlBuilderProps) {
  const t = useT(lang);
  const learner = useLearnerName();
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();
  const byId = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks]);
  const palette = useMemo(() => seededShuffle(blocks, blocks.map((b) => b.id).join('|')), [blocks]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const [runAt, setRunAt] = useState(-1);
  const [done, setDone] = useState(false);
  const tries = useRef(0);
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const stack = chosen.map((id) => byId.get(id)!).filter(Boolean);
  const yaml = buildYaml(workflow, stack, t('yaml.orphan'));
  const pipe = pipeline(stack);
  // Order the pipeline lights up in: trigger, then each job and its steps.
  const nodes: string[] = [];
  if (pipe.triggers.length) nodes.push('trigger');
  pipe.jobs.forEach((j, ji) => {
    nodes.push(`job-${ji}`);
    j.steps.forEach((_, si) => nodes.push(`step-${ji}-${si}`));
  });
  const state = (key: string): 'pass' | 'running' | 'idle' => {
    if (runAt < 0) return 'idle';
    const i = nodes.indexOf(key);
    // A job keeps running until its last step has passed.
    const last = key.startsWith('job-') ? i + (pipe.jobs[Number(key.slice(4))]?.steps.length ?? 0) : i;
    return last < runAt ? 'pass' : i <= runAt ? 'running' : 'idle';
  };

  const edit = (next: string[]) => {
    if (done) return;
    window.clearTimeout(timer.current);
    setRunAt(-1);
    setChosen(next);
    setMsg(null);
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= chosen.length) return;
    const next = [...chosen];
    [next[i], next[j]] = [next[j]!, next[i]!];
    edit(next);
    setAnnounce(t('yaml.moved', { label: byId.get(next[j]!)?.label ?? '', n: j + 1 }));
  };

  const run = () => {
    tries.current++;
    const r = checkOrder(goal.order, chosen);
    if (!r.ok) {
      let text: string;
      if (r.reason === 'missing') text = r.index === 0 ? t('yaml.missingStart') : t('yaml.missing', { label: byId.get(chosen[r.index - 1]!)?.label ?? '' });
      else if (r.reason === 'decoy') text = byId.get(r.id)?.why ?? t('yaml.decoy', { label: byId.get(r.id)?.label ?? '' });
      else text = t(r.belongs > r.index ? 'yaml.orderDown' : 'yaml.orderUp', { label: byId.get(r.id)?.label ?? '' });
      setMsg(`${t('feedback.almost')} ${text}`);
      emit('fl:wrong');
      return;
    }
    setMsg(null);
    const finish = () => {
      setRunAt(nodes.length);
      setDone(true);
      emit('fl:done', { tries: tries.current });
    };
    if (!motionOK) {
      finish();
      return;
    }
    let i = 0;
    setRunAt(0);
    const step = () => {
      i++;
      if (i >= nodes.length) finish();
      else {
        setRunAt(i);
        timer.current = window.setTimeout(step, 450);
      }
    };
    timer.current = window.setTimeout(step, 450);
  };

  const running = runAt >= 0 && runAt < nodes.length;
  const mark = (s: 'pass' | 'running' | 'idle') => (s === 'pass' ? '✓' : s === 'running' ? '◌' : '○');
  const srState = (s: 'pass' | 'running' | 'idle') => (s === 'pass' ? t('yaml.passed') : s === 'running' ? t('yaml.running') : t('yaml.waiting'));

  return (
    <div className="yb" ref={ref}>
      <p className="interactive-help">{t('yaml.instructions')}</p>

      <p className="yb-head">{t('yaml.blocks')}</p>
      <ul className="yb-palette">
        {palette.map((b) => {
          const used = chosen.includes(b.id);
          return (
            <li key={b.id}>
              <button type="button" className={cx('yb-pick', `yb-k-${b.kind}`, used && 'is-used')} disabled={used || done} onClick={() => edit([...chosen, b.id])}>
                <span className="yb-kind">
                  <span aria-hidden="true">{ICON[b.kind]} </span>
                  {t(`yaml.kind.${b.kind}`)}
                </span>
                <span className="yb-label">{b.label}</span>
                <span className="yb-plus" aria-hidden="true">
                  {used ? '✓' : '+'}
                </span>
                {used && <span className="visually-hidden">({t('yaml.added')})</span>}
              </button>
            </li>
          );
        })}
      </ul>

      <p className="yb-head">{t('yaml.stack')}</p>
      {stack.length === 0 ? (
        <p className="yb-empty">{t('yaml.empty')}</p>
      ) : (
        <ol className="yb-stack">
          {stack.map((b, i) => (
            <li key={b.id} className={cx('yb-item', `yb-k-${b.kind}`, done && 'is-done')}>
              <span className="yb-num" aria-hidden="true">
                {i + 1}
              </span>
              <span className="yb-item-text">
                <span className="yb-kind">
                  <span aria-hidden="true">{ICON[b.kind]} </span>
                  {t(`yaml.kind.${b.kind}`)}
                </span>{' '}
                <span className="yb-label">{b.label}</span>
                <span className="yb-means">{b.means}</span>
              </span>
              {!done && (
                <span className="yb-btns">
                  <button type="button" className="yb-btn" disabled={i === 0} aria-label={t('yaml.up', { label: b.label })} onClick={() => move(i, -1)}>
                    ↑
                  </button>
                  <button type="button" className="yb-btn" disabled={i === stack.length - 1} aria-label={t('yaml.down', { label: b.label })} onClick={() => move(i, 1)}>
                    ↓
                  </button>
                  <button
                    type="button"
                    className="yb-btn"
                    aria-label={t('yaml.remove', { label: b.label })}
                    onClick={() => {
                      edit(chosen.filter((x) => x !== b.id));
                      setAnnounce(t('yaml.remove', { label: b.label }));
                    }}
                  >
                    ✕
                  </button>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      <div className="yb-out">
        <section className="yb-panel" aria-label={t('yaml.file')}>
          <p className="yb-head">
            {t('yaml.file')} <code className="yb-path">.github/workflows/</code>
          </p>
          <pre className="yb-yaml">
            {yaml
              .replace(/\n$/, '')
              .split('\n')
              .map((line, i) => (
                <span key={i} className="yb-line">
                  {highlightYaml(line).map((tok, j) => (
                    <span key={j} className={tok.c ? `ybt-${tok.c}` : undefined}>
                      {tok.t}
                    </span>
                  ))}
                  {'\n'}
                </span>
              ))}
          </pre>
        </section>
        <section className="yb-panel" aria-label={t('yaml.pipeline')}>
          <p className="yb-head">{t('yaml.pipeline')}</p>
          {nodes.length === 0 ? (
            <p className="yb-empty">{t('yaml.noRun')}</p>
          ) : (
            <ol className="yb-pipe">
              {pipe.triggers.length > 0 && (
                <li className={cx('yb-node yb-node-trigger', `is-${state('trigger')}`)}>
                  <span className="yb-mark" aria-hidden="true">
                    {mark(state('trigger'))}
                  </span>
                  <span>
                    <span aria-hidden="true">⚡ </span>
                    {pipe.triggers.map((b) => b.label).join(' · ')}
                    <span className="visually-hidden"> ({srState(state('trigger'))})</span>
                  </span>
                </li>
              )}
              {pipe.jobs.map((j, ji) => (
                <li key={j.job.id} className={cx('yb-node yb-node-job', `is-${state(`job-${ji}`)}`)}>
                  <span className="yb-mark" aria-hidden="true">
                    {mark(state(`job-${ji}`))}
                  </span>
                  <span className="yb-job-body">
                    <span>
                      <span aria-hidden="true">⚙ </span>
                      {j.job.label}
                      <span className="visually-hidden"> ({srState(state(`job-${ji}`))})</span>
                    </span>
                    {j.steps.length > 0 && (
                      <ol className="yb-steps">
                        {j.steps.map((s, si) => {
                          const st = state(`step-${ji}-${si}`);
                          return (
                            <li key={s.id} className={cx('yb-step', `is-${st}`)}>
                              <span className="yb-mark" aria-hidden="true">
                                {mark(st)}
                              </span>
                              <span>
                                {s.label}
                                <span className="visually-hidden"> ({srState(st)})</span>
                              </span>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {!done && (
        <button type="button" className="btn yb-run" disabled={stack.length === 0 || running} onClick={run}>
          ▶ {running ? t('yaml.running') : t('yaml.run')}
        </button>
      )}
      {msg && <Feedback kind="almost">{msg}</Feedback>}
      {done && <Feedback kind="right">{success ?? `${pickPraise(t, learner, tries.current)} ${t('yaml.done')}`}</Feedback>}
      <Announce text={announce} />
    </div>
  );
}
