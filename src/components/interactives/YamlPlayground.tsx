// YamlPlayground: edit a small YAML file and watch how a computer reads it (a tree of keys, lists
// and values, each with its kind). A reading problem shows the YAML reader's real words (go-yaml,
// what Docker Compose and kubectl use) and one plain line (rule 19). With `expect`, the card is
// done when the YAML says what the task asks. Logic: src/lib/yamlPlayground.ts (unit-tested).
// The editor is the YamlDoctor one: a normal textarea with line numbers, indent guides and the
// problem line marked (red + icon); "Add a space" / "Remove a space" buttons help on phones.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Lang } from '~/i18n';
import { evaluate, problemText, toTree, type YamlExpect, type YamlKind, type YamlTreeNode } from '~/lib/yamlPlayground';
import { DangerIcon } from './AreaIcons';
import { Announce, Feedback, cx, pickPraise, useCardEvents, useLearnerName, useT, type T } from './shared';
import './k8s-games.css';
import './yaml-play.css';

export interface YamlPlaygroundProps {
  lang: Lang;
  /** The YAML the editor starts with (~15 lines max, rule 18). */
  initial: string;
  /** File name on the tab (default menu.yaml). */
  file?: string;
  /** One short task sentence above the editor. */
  prompt?: string;
  /** What the finished YAML must say. Without it the card is free play (done after any edit). */
  expect?: YamlExpect[];
  /** Shown when the learner asks for a hint. */
  hint?: string;
  /** A YAML that meets `expect`. Never shown; `npm run check:mdx` checks it. */
  solution?: string;
  success?: string;
}

const KIND_ICON: Record<YamlKind, string> = { map: '▤', list: '☰', text: 'Aa', number: '#', bool: '◐', null: '∅' };

function Leaf({ node, t }: { node: YamlTreeNode; t: T }) {
  const label = node.key !== undefined ? node.key : t('yamlPlay.item', { n: (node.index ?? 0) + 1 });
  const nested = node.kind === 'map' || node.kind === 'list';
  const count = node.children?.length ?? 0;
  return (
    <li className={cx('yp-node', `is-${node.kind}`)}>
      <span className="yp-row">
        <span className={cx('yp-key', node.key === undefined && 'is-index')}>{label}</span>
        {!nested && (
          <span className="yp-val">{node.kind === 'null' ? <em>{t('yamlPlay.empty')}</em> : node.text}</span>
        )}
        <span className="yp-kind">
          <span aria-hidden="true">{KIND_ICON[node.kind]} </span>
          {t(`yamlPlay.kind.${node.kind}`)}
          {nested && ` · ${t(node.kind === 'list' ? 'yamlPlay.items' : 'yamlPlay.keys', { n: count })}`}
        </span>
      </span>
      {nested && count > 0 && (
        <ul className="yp-tree">
          {node.children!.map((c, i) => (
            <Leaf key={i} node={c} t={t} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function YamlPlayground({ lang, initial, file = 'menu.yaml', prompt, expect, hint, success }: YamlPlaygroundProps) {
  const t = useT(lang);
  const learner = useLearnerName();
  const { ref, emit } = useCardEvents();
  const id = useId();
  const [text, setText] = useState(initial);
  // The error box waits until typing pauses, so a half-typed line doesn't shout.
  const [settled, setSettled] = useState(initial);
  const [checked, setChecked] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [done, setDone] = useState(false);
  const [announce, setAnnounce] = useState('');
  const tries = useRef(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const back = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = window.setTimeout(() => setSettled(text), 700);
    return () => window.clearTimeout(h);
  }, [text]);

  const live = useMemo(() => evaluate(text, expect ?? []), [text, expect]);
  const shown = useMemo(() => evaluate(settled, expect ?? []), [settled, expect]);
  // The tree follows every key press when the YAML reads fine; the error waits for a pause.
  const result = live.ok ? live : shown;
  const problem = !result.ok ? result.problem : null;
  const badLine = problem?.line;
  const lines = text.split('\n');

  useEffect(() => {
    if (done) return;
    const met = live.ok && (expect ? expect.length > 0 && live.failed.length === 0 : text !== initial);
    if (met) {
      setDone(true);
      setChecked(null);
      setAnnounce(success ?? t('yamlPlay.done'));
      emit('fl:done', { tries: tries.current });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, done]);

  const check = () => {
    tries.current++;
    setSettled(text);
    if (done) return;
    let msg: string;
    if (!live.ok) msg = t('yamlPlay.fixFirst', { line: live.problem.line });
    else msg = live.failed[0]?.hint ?? t('yamlPlay.notYet');
    setChecked(msg);
    setAnnounce(`${t('feedback.almost')} ${msg}`);
    emit('fl:wrong');
  };

  const edit = (next: string, caret?: [number, number]) => {
    setText(next);
    setChecked(null);
    if (caret && area.current) {
      const el = area.current;
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(caret[0], caret[1]);
      });
    }
  };

  // Add or remove one space at the start of the line(s) the caret is on (phones have no Tab key).
  const shift = (dir: 1 | -1) => {
    const el = area.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const from = text.lastIndexOf('\n', start - 1) + 1;
    const toNl = text.indexOf('\n', end);
    const to = toNl < 0 ? text.length : toNl;
    let first = 0;
    let total = 0;
    const changed = text
      .slice(from, to)
      .split('\n')
      .map((l, i) => {
        const d = dir === 1 ? 1 : l.startsWith(' ') ? -1 : 0;
        if (i === 0) first = d;
        total += d;
        return d === 1 ? ` ${l}` : d === -1 ? l.slice(1) : l;
      });
    edit(text.slice(0, from) + changed.join('\n') + text.slice(to), [Math.max(from, start + first), Math.max(from, end + total)]);
    const line = text.slice(0, from).split('\n').length;
    setAnnounce(t(dir === 1 ? 'yamlPlay.indented' : 'yamlPlay.outdented', { line }));
  };

  const syncScroll = () => {
    if (back.current && area.current) {
      back.current.scrollTop = area.current.scrollTop;
      back.current.scrollLeft = area.current.scrollLeft;
    }
  };

  const tree = result.ok ? toTree(result.value) : null;

  return (
    <div className="k8g yp" ref={ref}>
      <p className="interactive-help">{prompt ?? t('yamlPlay.help')}</p>
      <div className="k8g-file">
        <span className="k8g-file-tab">
          <span aria-hidden="true">📄 </span>
          {file}
        </span>
        <span className="k8g-file-note">{t('yamlPlay.lines', { n: lines.length })}</span>
      </div>
      <div className={cx('k8g-editor', done && 'is-done')}>
        <div className="k8g-editor-back" ref={back} aria-hidden="true">
          {lines.map((l, i) => {
            const ind = l.length - l.trimStart().length;
            const tab = /^ *\t/.test(l);
            return (
              <div key={i} className={cx('k8g-eline', badLine === i + 1 && 'is-bad')}>
                <span className="k8g-enum">
                  {badLine === i + 1 && <span className="k8g-enum-mark">⚠</span>}
                  {i + 1}
                </span>
                <span className={cx('k8g-guides', tab && 'has-tab')} style={{ width: `${ind}ch` }} />
              </div>
            );
          })}
        </div>
        <label className="visually-hidden" htmlFor={`${id}-yaml`}>
          {t('yamlPlay.editor', { file })}
        </label>
        <textarea
          id={`${id}-yaml`}
          ref={area}
          className="k8g-editor-input"
          value={text}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          wrap="off"
          rows={Math.min(15, Math.max(4, lines.length))}
          aria-describedby={problem ? `${id}-why` : undefined}
          onScroll={syncScroll}
          onChange={(e) => {
            setText(e.target.value);
            setChecked(null);
          }}
        />
      </div>
      <div className="k8g-row">
        <button type="button" className="btn btn-ghost scene-btn" onClick={() => shift(1)}>
          <span aria-hidden="true">→ </span>
          {t('yamlPlay.indent')}
        </button>
        <button type="button" className="btn btn-ghost scene-btn" onClick={() => shift(-1)}>
          <span aria-hidden="true">← </span>
          {t('yamlPlay.outdent')}
        </button>
        <button
          type="button"
          className="btn btn-ghost scene-btn"
          onClick={() => {
            edit(initial);
            setSettled(initial);
            setAnnounce(t('yamlPlay.resetDone'));
          }}
        >
          <span aria-hidden="true">↺ </span>
          {t('yamlPlay.reset')}
        </button>
        {hint && !done && (
          <button
            type="button"
            className="btn btn-ghost scene-btn"
            aria-expanded={showHint}
            onClick={() => {
              setShowHint(!showHint);
              if (!showHint) emit('fl:hint');
            }}
          >
            <span aria-hidden="true">💡 </span>
            {t('yamlPlay.hint')}
          </button>
        )}
        {expect && !done && (
          <button type="button" className="btn scene-btn" onClick={check}>
            <span aria-hidden="true">✓ </span>
            {t('yamlPlay.check')}
          </button>
        )}
      </div>
      {showHint && hint && !done && <p className="k8g-hint">{hint}</p>}

      <section className="yp-reads" aria-labelledby={`${id}-reads`}>
        <h4 className="k8g-head" id={`${id}-reads`}>
          {t('yamlPlay.reads')}
        </h4>
        {problem ? (
          <div id={`${id}-why`} className="yp-problem">
            <p className="yp-error">
              <DangerIcon />
              <code>{problemText(problem)}</code>
            </p>
            <p className="yp-plain">
              <strong>{t('yamlPlay.plain')}</strong> {t(`yamlPlay.why.${problem.code}`, { line: problem.line })}
            </p>
          </div>
        ) : tree && (tree.kind === 'map' || tree.kind === 'list') && tree.children?.length ? (
          <ul className="yp-tree is-top">
            {tree.children.map((c, i) => (
              <Leaf key={i} node={c} t={t} />
            ))}
          </ul>
        ) : tree && tree.kind !== 'null' ? (
          <ul className="yp-tree is-top">
            <Leaf node={tree} t={t} />
          </ul>
        ) : (
          <p className="k8g-empty">{t('yamlPlay.nothing')}</p>
        )}
      </section>

      {checked && !done && (
        <Feedback kind="almost">
          {t('feedback.almost')} {checked}
        </Feedback>
      )}
      {done && <Feedback kind="right">{success ?? `${pickPraise(t, learner, tries.current)} ${t('yamlPlay.done')}`}</Feedback>}
      <Announce text={announce} />
    </div>
  );
}
