// Commit graph: SVG dots and lines that animate after every command.
// Branches fork into lanes and merge back. Labels show full names: branches (green),
// remote-tracking branches (purple) and tags. HEAD is a glowing pink marker.
// A stopped merge/rebase shows a red conflict badge with an icon. Nodes have
// screen-reader labels; the scroll area is keyboard-focusable.
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { GEOM, type GraphLabel, type GraphLayout, type GraphNode } from './graphLayout';
import { cx, type T } from './shared';
import './graph.css';

export interface CommitGraphProps {
  t: T;
  layout: GraphLayout;
  motionOK: boolean;
  /** When set, commits are buttons the learner can pick. */
  onPick?: ((node: GraphNode) => void) | undefined;
  picked?: string | null | undefined;
  /** Highlight these commit ids (e.g. right / almost feedback). */
  highlight?: Record<string, 'right' | 'almost'> | undefined;
  /** Extra SVG drawn behind the graph, in graph coordinates (e.g. UniverseSplitter's lane bands). */
  underlay?: ReactNode;
}

/** Centre (y, relative to the dot) of the i-th label in a node's stack. */
const labelY = (i: number) => -(GEOM.dot + 14 + i * GEOM.labelStep);

/** Always a cubic curve, so paths can morph smoothly when commits move. */
function edgePath(a: { px: number; py: number }, b: { px: number; py: number }): string {
  if (a.py === b.py) return `M${a.px},${a.py} C${a.px},${a.py} ${b.px},${b.py} ${b.px},${b.py}`;
  const dx = Math.min(Math.abs(b.px - a.px) / 2, GEOM.col);
  // Leave the parent's lane, then glide into the child's.
  return `M${a.px},${a.py} C${a.px + dx},${a.py} ${b.px - dx},${b.py} ${b.px},${b.py}`;
}

function LabelPill({ label, y }: { label: GraphLabel; y: number }) {
  const w = label.width;
  return (
    <g transform={`translate(0, ${y})`} className={cx('graph-label', `graph-label-${label.kind}`, label.current && 'is-current')}>
      <rect x={-w / 2} y={-GEOM.labelH / 2} width={w} height={GEOM.labelH} rx={GEOM.labelH / 2} className="graph-label-box" />
      {label.kind === 'tag' && <circle cx={-w / 2 + 9} cy={0} r={2.5} className="graph-tag-hole" />}
      <text x={label.kind === 'tag' ? 5 : 0} y={4} textAnchor="middle" className="graph-label-text">
        {label.name}
      </text>
    </g>
  );
}

function WarningIcon() {
  return (
    <g aria-hidden="true">
      <path d="M0,-6 L6,5 L-6,5 Z" className="graph-warn-icon" />
      <rect x={-0.9} y={-2.5} width={1.8} height={4} className="graph-warn-mark" />
      <rect x={-0.9} y={2.6} width={1.8} height={1.6} className="graph-warn-mark" />
    </g>
  );
}

export default function CommitGraph({ t, layout, motionOK, onPick, picked, highlight, underlay }: CommitGraphProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const { nodes, edges, width, height, pending } = layout;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const transition = { duration: motionOK ? 0.5 : 0, ease: [0.22, 1, 0.36, 1] as const };

  // Keep the newest commit in view (also when labels make the graph wider).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const toEnd = () => {
      el.scrollLeft = el.scrollWidth;
    };
    toEnd();
    // The browser may size the SVG a frame later: scroll again when it really grows.
    const svg = el.querySelector('svg');
    if (!svg || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(toEnd);
    ro.observe(svg);
    return () => ro.disconnect();
  }, [nodes.length, width]);

  if (nodes.length === 0) {
    return <p className="graph-empty">{t('graph.empty')}</p>;
  }

  const head = nodes.find((n) => n.isHead);
  const conflict = Boolean(pending && pending.paths.length);
  const incoming = pending?.commit ? byId.get(pending.commit) : undefined;

  const describe = (n: GraphNode) =>
    [
      t('graph.node', { hash: n.short, message: n.message }),
      n.branches.length ? t('graph.onBranch', { branch: n.branches.join(', ') }) : '',
      ...n.remotes.map((r) => t('graph.onRemote', { name: r })),
      ...n.tags.map((tag) => t('graph.tagged', { name: tag })),
      n.merge ? t('graph.mergeCommit') : '',
      n.isHead ? t('graph.headHere') : '',
      n.isHead && conflict ? t('graph.conflict', { count: pending!.paths.length }) : '',
      incoming && incoming.id === n.id && !n.isHead ? t('graph.incoming', { hash: n.short }) : '',
      n.lost ? t('graph.lost') : '',
    ]
      .filter(Boolean)
      .join(' ');

  return (
    // Focusable so keyboard users can scroll a long history sideways.
    <div className={cx('graph', conflict && 'has-conflict')} ref={scroller} tabIndex={onPick ? undefined : 0} role="region" aria-label={t('graph.title')}>
      <svg width={width} height={height} className="graph-svg" role="group" aria-label={t('graph.title')}>
        {underlay}
        <g aria-hidden="true">
          {edges.map((e) => {
            const a = byId.get(e.from);
            const b = byId.get(e.to);
            if (!a || !b) return null;
            const d = edgePath(a, b);
            return (
              <motion.path
                key={`e-${e.from}-${e.to}`}
                className={cx('graph-edge', e.lost && 'is-lost', e.kind === 'merge' && 'is-merge', b.reach === 'remote' && 'is-remote')}
                initial={motionOK ? { pathLength: 0, d } : false}
                animate={{ pathLength: 1, d }}
                transition={transition}
              />
            );
          })}
          {incoming && head && incoming.id !== head.id && (
            <motion.path
              key="incoming"
              className="graph-edge is-incoming"
              d={edgePath(incoming, head)}
              initial={motionOK ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              transition={transition}
            />
          )}
        </g>
        <AnimatePresence initial={false}>
          {nodes.map((n) => {
            const pickable = Boolean(onPick);
            return (
              <motion.g
                key={n.id}
                className={cx(
                  'graph-node',
                  n.lost && 'is-lost',
                  n.reach === 'remote' && 'is-remote',
                  n.merge && 'is-merge',
                  picked === n.id && 'is-picked',
                  highlight?.[n.id] && `is-${highlight[n.id]}`,
                )}
                initial={motionOK ? { opacity: 0, x: n.px, y: n.py } : false}
                animate={{ opacity: 1, x: n.px, y: n.py }}
                exit={{ opacity: 0 }}
                transition={transition}
                {...(pickable
                  ? {
                      role: 'button',
                      tabIndex: 0,
                      'aria-pressed': picked === n.id,
                      onClick: () => onPick?.(n),
                      onKeyDown: (e: React.KeyboardEvent) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onPick?.(n);
                        }
                      },
                    }
                  : { role: 'img' })}
                aria-label={describe(n)}
              >
                <motion.circle
                  className="graph-dot"
                  initial={motionOK ? { r: 4 } : false}
                  animate={{ r: pickable ? 15 : GEOM.dot }}
                  transition={transition}
                />
                {n.merge && <circle r={5} className="graph-merge-core" />}
                <text y={30} className="graph-hash" textAnchor="middle">
                  {n.short}
                </text>
              </motion.g>
            );
          })}
        </AnimatePresence>
        {/* Labels live in their own layer, so a pickable commit's visible text is just its hash
            (its accessible name already lists the branches and tags: WCAG 2.5.3). */}
        <g aria-hidden="true" className="graph-labels">
          <AnimatePresence initial={false}>
            {nodes.map((n) => {
              const pills = n.labels.filter((l) => l.kind !== 'head');
              if (!pills.length) return null;
              return (
                <motion.g
                  key={`labels-${n.id}`}
                  initial={motionOK ? { opacity: 0, x: n.px, y: n.py } : false}
                  animate={{ opacity: 1, x: n.px, y: n.py }}
                  exit={{ opacity: 0 }}
                  transition={transition}
                >
                  {pills.map((l, i) => (
                    <LabelPill key={`${l.kind}:${l.name}`} label={l} y={labelY(i)} />
                  ))}
                </motion.g>
              );
            })}
          </AnimatePresence>
        </g>
        {head && (
          <motion.g aria-hidden="true" className="graph-head" initial={false} animate={{ x: head.px, y: head.py }} transition={transition}>
            <circle r={GEOM.dot + 7} className="graph-head-ring" />
            <motion.g initial={false} animate={{ y: labelY(head.labels.length - 1) }} transition={transition}>
              <rect x={-24} y={-GEOM.labelH / 2} width={48} height={GEOM.labelH} rx={GEOM.labelH / 2} className="graph-head-tag" />
              <text y={4} textAnchor="middle" className="graph-head-text">
                HEAD
              </text>
            </motion.g>
            {conflict && (
              <g className="graph-conflict" transform="translate(0, 50)">
                <rect x={-46} y={-11} width={92} height={22} rx={11} className="graph-conflict-box" />
                <g transform="translate(-30, 0)">
                  <WarningIcon />
                </g>
                <text x={8} y={4} textAnchor="middle" className="graph-conflict-text">
                  {t('graph.conflictLabel')}
                </text>
              </g>
            )}
          </motion.g>
        )}
      </svg>
    </div>
  );
}
