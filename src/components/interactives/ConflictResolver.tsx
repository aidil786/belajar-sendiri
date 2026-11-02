// Conflict resolver game: a conflicted file with Git's real markers. For each
// conflict, keep yours, theirs, both, or edit it by hand. Finish = the engine's
// resolveConflict (write + git add) and the command that ends the merge/rebase.
// Conflict = red plus an icon, never colour alone. Every action is a button.
import { useMemo, useState } from 'react';
import { buildScenario, conflictInfo, resolveConflict, run, type ConflictInfo, type Line, type Scenario, type SimState } from '~/engine/git-sim';
import type { Lang } from '~/i18n';
import {
  applyChoices,
  checkResolved,
  conflictCount,
  hasMarkers,
  normalizeExpect,
  parseConflicts,
  type Choice,
  type ExpectSpec,
  type ParsedFile,
  type Segment,
} from '~/lib/conflictResolver';
import CommitGraph from './CommitGraph';
import { layoutGraph } from './graphLayout';
import Inline from './Inline';
import { Feedback, cx, pickPraise, useCardEvents, useLearnerName, useMotionOK, useT, type T } from './shared';
import './branch-lab.css';
import './quiz.css';

export interface ConflictResolverProps {
  lang: Lang;
  scenario: Scenario;
  /** Commands that make the conflict, e.g. ['git merge cake']. */
  commands?: string[];
  /** Only this conflicted file (default: all of them). */
  file?: string;
  /** Regex(es) the fixed text must match: one file (string / list) or { path: regex | regex[] }. */
  expect?: ExpectSpec;
  /** Regex(es) the fixed text must NOT match. Same shapes as `expect`. */
  avoid?: ExpectSpec;
  /** Commands run after `git add` (default: git commit --no-edit / git rebase --continue / git cherry-pick --continue). */
  finish?: string[];
  /** 'editor' uses the button words of a code editor (Accept Current Change …). */
  look?: 'game' | 'editor';
  /** Show the commit graph (it moves when you finish). */
  graph?: boolean;
  prompt?: string;
  /** Shown when the text is not what `expect` / `avoid` want. */
  why?: string;
  success?: string;
}

const NONE: string[] = [];
type Marker = 'start' | 'base' | 'mid' | 'end';
const MARKER: [RegExp, Marker][] = [
  [/^<{7}(?: .*)?$/, 'start'],
  [/^\|{7}(?: .*)?$/, 'base'],
  [/^={7}$/, 'mid'],
  [/^>{7}(?: .*)?$/, 'end'],
];
const markerOf = (line: string): Marker | null => MARKER.find(([re]) => re.test(line))?.[1] ?? null;

function defaultFinish(op: ConflictInfo['op']): string[] {
  if (op === 'merge') return ['git commit --no-edit'];
  if (op === 'rebase') return ['git rebase --continue'];
  if (op === 'cherry-pick') return ['git cherry-pick --continue'];
  return [];
}

function WarnIcon() {
  return (
    <svg className="cr-warn" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.5 15 14.5H1Z" />
      <rect x="7.1" y="5.5" width="1.8" height="5" rx="0.6" />
      <rect x="7.1" y="11.6" width="1.8" height="1.8" rx="0.6" />
    </svg>
  );
}

interface FileState {
  path: string;
  kind: string;
  parsed: ParsedFile;
  /** One side is missing (added / deleted on one side): keep or delete the whole file. */
  presence: boolean;
  content: string | null;
}

export default function ConflictResolver(props: ConflictResolverProps) {
  const { lang, scenario, commands = NONE, file, expect, avoid, finish, look = 'game', graph, prompt, why, success } = props;
  const t = useT(lang);
  const name = useLearnerName();
  const motionOK = useMotionOK();
  const { ref, emit } = useCardEvents();

  const start = useMemo(() => {
    let s = buildScenario(scenario);
    for (const c of commands) s = run(s, c).state;
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario.id, commands.join('\n')]);
  const info = useMemo(() => conflictInfo(start), [start]);
  const files = useMemo<FileState[]>(
    () =>
      (info?.files ?? [])
        .filter((f) => !file || f.path === file)
        .map((f) => ({
          path: f.path,
          kind: f.kind,
          parsed: parseConflicts(f.merged ?? ''),
          presence: f.ours === null || f.theirs === null,
          content: f.merged ?? f.ours ?? f.theirs,
        })),
    [info, file],
  );
  const first = files[0]?.path ?? '';
  const want = useMemo(() => normalizeExpect(expect, first), [expect, first]);
  const avoidRe = useMemo(() => normalizeExpect(avoid, first), [avoid, first]);
  const op = info?.op ?? 'merge';
  const words = look === 'editor' || op !== 'merge' ? 'current' : 'yours';

  const fresh = () => Object.fromEntries(files.map((f) => [f.path, f.presence ? [null] : new Array<Choice>(conflictCount(f.parsed)).fill(null)]));
  const [choices, setChoices] = useState<Record<string, Choice[]>>(fresh);
  const [presence, setPresence] = useState<Record<string, 'keep' | 'delete' | null>>({});
  const [editing, setEditing] = useState<{ path: string; k: number; text: string; warn: boolean } | null>(null);
  const [tab, setTab] = useState(first);
  const [msg, setMsg] = useState<string | null>(null);
  const [result, setResult] = useState<{ state: SimState; log: { cmd: string; lines: Line[] }[] } | null>(null);
  const [tries, setTries] = useState(0);

  if (!info || !files.length) return <p className="graph-empty">{t('conflict.none')}</p>;

  const done = Boolean(result);
  const total = files.reduce((n, f) => n + (f.presence ? 1 : conflictCount(f.parsed)), 0);
  const decided = files.reduce((n, f) => n + (f.presence ? (presence[f.path] ? 1 : 0) : (choices[f.path] ?? []).filter((c) => c !== null).length), 0);
  const textOf = (f: FileState): string | null =>
    f.presence ? (presence[f.path] === 'delete' ? null : (f.content ?? '')) : applyChoices(f.parsed, choices[f.path] ?? []);

  const choose = (path: string, k: number, c: Choice) => {
    if (done) return;
    setChoices((all) => ({ ...all, [path]: (all[path] ?? []).map((x, i) => (i === k ? c : x)) }));
    setMsg(null);
  };

  const saveEdit = () => {
    if (!editing) return;
    if (hasMarkers(editing.text)) {
      setEditing({ ...editing, warn: true });
      emit('fl:wrong');
      return;
    }
    choose(editing.path, editing.k, { edit: editing.text.endsWith('\n') || editing.text === '' ? editing.text : `${editing.text}\n` });
    setEditing(null);
  };

  const finishAll = () => {
    if (done) return;
    setTries((x) => x + 1);
    // 1. Check every file the kind way: markers first, then what the lesson wants.
    for (const f of files) {
      const text = textOf(f);
      if (text === null) {
        if (want[f.path]?.length) {
          setMsg(`${t('conflict.fbDeleted', { file: f.path })}${why ? ` ${why}` : ''}`);
          setTab(f.path);
          emit('fl:wrong');
          return;
        }
        continue;
      }
      const c = checkResolved(text, want[f.path], avoidRe[f.path]);
      if (!c.ok) {
        setMsg(c.markers ? t('conflict.fbMarkers', { file: f.path }) : `${t('conflict.fbExpect', { file: f.path })}${why ? ` ${why}` : ''}`);
        setTab(f.path);
        emit('fl:wrong');
        return;
      }
    }
    // 2. Apply with the engine, like saving the file and running git add.
    let s = start;
    const log: { cmd: string; lines: Line[] }[] = [];
    for (const f of files) {
      const r = resolveConflict(s, f.path, textOf(f));
      s = r.state;
      log.push({ cmd: textOf(f) === null ? `git rm ${f.path}` : `git add ${f.path}`, lines: r.output });
    }
    // 3. Finish the merge / rebase / cherry-pick, once nothing is left to fix.
    if (!conflictInfo(s)?.files.length) {
      for (const cmd of finish ?? defaultFinish(op)) {
        const r = run(s, cmd);
        log.push({ cmd, lines: r.output });
        s = r.state;
      }
    }
    setMsg(null);
    setResult({ state: s, log });
    emit('fl:done');
  };

  const reset = () => {
    setChoices(fresh());
    setPresence({});
    setEditing(null);
    setMsg(null);
    setResult(null);
  };

  const shown = files.find((f) => f.path === tab) ?? files[0]!;
  const graphState = result?.state ?? start;

  return (
    <div className={cx('cr', look === 'editor' && 'cr-editor')} ref={ref}>
      <p className="interactive-help">{prompt ? <Inline text={prompt} /> : t('conflict.help')}</p>

      {graph && <CommitGraph t={t} layout={layoutGraph(graphState)} motionOK={motionOK} />}

      <p className="cr-count" aria-live="polite">
        <span className={cx('cr-badge', decided < total && 'is-open')}>
          {decided < total ? <WarnIcon /> : <span aria-hidden="true">✓</span>}
          {t('conflict.count', { left: total - decided, total })}
        </span>
      </p>

      {files.length > 1 && (
        <div className="cr-tabs" role="group" aria-label={t('conflict.files')}>
          {files.map((f) => {
            const left = f.presence ? (presence[f.path] ? 0 : 1) : (choices[f.path] ?? []).filter((c) => c === null).length;
            return (
              <button key={f.path} type="button" className={cx('cr-tab', f.path === shown.path && 'is-on')} aria-pressed={f.path === shown.path} onClick={() => setTab(f.path)}>
                <code>{f.path}</code>{' '}
                <span className="cr-tab-left">{left ? t('conflict.tabLeft', { n: left }) : '✓'}</span>
              </button>
            );
          })}
        </div>
      )}

      <section className="cr-file" aria-label={t('conflict.fileLabel', { file: shown.path })}>
        <p className="cr-file-head">
          <code>{shown.path}</code>
          {look === 'editor' && <span className="cr-file-kind">{shown.kind}</span>}
        </p>
        {shown.presence ? (
          <PresenceChoice t={t} f={shown} value={presence[shown.path] ?? null} disabled={done} onChange={(v) => setPresence((p) => ({ ...p, [shown.path]: v }))} />
        ) : (
          <FileBody
            t={t}
            f={shown}
            words={words}
            look={look}
            labels={info.labels}
            choices={choices[shown.path] ?? []}
            editing={editing?.path === shown.path ? editing : null}
            disabled={done}
            onChoose={(k, c) => choose(shown.path, k, c)}
            onEdit={(k, text) => setEditing({ path: shown.path, k, text, warn: false })}
            onEditText={(text) => editing && setEditing({ ...editing, text })}
            onSaveEdit={saveEdit}
            onCancelEdit={() => setEditing(null)}
          />
        )}
      </section>

      {!done && (
        <div className="cr-actions">
          <button type="button" className="btn" disabled={decided < total || Boolean(editing)} onClick={finishAll}>
            ✓ {t(op === 'merge' ? 'conflict.finishMerge' : op === 'rebase' ? 'conflict.finishRebase' : op === 'cherry-pick' ? 'conflict.finishPick' : 'conflict.finish')}
          </button>
          {decided > 0 && (
            <button type="button" className="btn btn-quiet" onClick={reset}>
              ↺ {t('feedback.reset')}
            </button>
          )}
        </div>
      )}

      {result && (
        <pre className="replay cr-log" aria-label={t('conflict.log')}>
          {result.log.map((entry, i) => (
            <span key={i}>
              <span className="replay-line">
                <span className="replay-prompt">$</span> {entry.cmd}
              </span>
              {entry.lines.map((l, j) => (
                <span key={j} className="replay-line">
                  {l.map((s, k) => (
                    <span key={k} className={s.c ? `seg-${s.c}` : undefined}>
                      {s.t.replace(/\t/g, '    ')}
                    </span>
                  ))}
                </span>
              ))}
            </span>
          ))}
        </pre>
      )}

      {msg && (
        <Feedback kind="almost">
          {t('feedback.almost')} <Inline text={msg} />
        </Feedback>
      )}
      {result && (
        <Feedback kind="right">
          {success ? <Inline text={success} /> : `${pickPraise(t, name, tries)} ${t('conflict.done')}`}
        </Feedback>
      )}
    </div>
  );
}

function PresenceChoice({ t, f, value, disabled, onChange }: { t: T; f: FileState; value: 'keep' | 'delete' | null; disabled: boolean; onChange: (v: 'keep' | 'delete') => void }) {
  return (
    <div className="cr-block is-open">
      <p className="cr-presence">
        <WarnIcon /> {t('conflict.presence', { kind: f.kind })}
      </p>
      {f.content !== null && <pre className="cr-plain">{f.content}</pre>}
      <div className="cr-bar" role="group" aria-label={t('conflict.chooseFor', { n: 1 })}>
        <button type="button" className="cr-act" aria-pressed={value === 'keep'} disabled={disabled} onClick={() => onChange('keep')}>
          {t('conflict.keepFile')}
        </button>
        <button type="button" className="cr-act" aria-pressed={value === 'delete'} disabled={disabled} onClick={() => onChange('delete')}>
          {t('conflict.deleteFile')}
        </button>
      </div>
    </div>
  );
}

interface FileBodyProps {
  t: T;
  f: FileState;
  words: 'yours' | 'current';
  look: 'game' | 'editor';
  labels: { ours: string; theirs: string };
  choices: Choice[];
  editing: { k: number; text: string; warn: boolean } | null;
  disabled: boolean;
  onChoose: (k: number, c: Choice) => void;
  onEdit: (k: number, text: string) => void;
  onEditText: (text: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
}

function FileBody({ t, f, words, look, labels, choices, editing, disabled, onChoose, onEdit, onEditText, onSaveEdit, onCancelEdit }: FileBodyProps) {
  let k = -1;
  const n = conflictCount(f.parsed);
  const act = (key: string) => t(look === 'editor' ? `conflict.editor.${key}` : `conflict.${words}.${key}`);
  return (
    <div className="cr-body">
      {f.parsed.segments.map((seg: Segment, i) => {
        if (seg.kind === 'text') {
          return (
            <pre key={i} className="cr-plain">
              {seg.lines.join('\n')}
            </pre>
          );
        }
        k++;
        const idx = k;
        const choice = choices[idx] ?? null;
        if (editing && editing.k === idx) {
          return (
            <div key={i} className="cr-block is-editing">
              <label className="cr-edit-label" htmlFor={`cr-edit-${f.path}-${idx}`}>
                {t('conflict.editLabel', { n: idx + 1 })}
              </label>
              <textarea
                id={`cr-edit-${f.path}-${idx}`}
                className="cr-textarea"
                value={editing.text}
                rows={Math.min(10, editing.text.split('\n').length + 1)}
                spellCheck={false}
                onChange={(e) => onEditText(e.target.value)}
              />
              {editing.warn && (
                <Feedback kind="almost">
                  {t('feedback.almost')} {t('conflict.editMarkers')}
                </Feedback>
              )}
              <div className="cr-bar">
                <button type="button" className="cr-act" onClick={onSaveEdit}>
                  ✓ {t('conflict.editDone')}
                </button>
                <button type="button" className="cr-act" onClick={onCancelEdit}>
                  {t('term.cancel')}
                </button>
              </div>
            </div>
          );
        }
        if (choice !== null) {
          const how = typeof choice === 'object' ? 'edited' : choice;
          const lines = applyChoices({ segments: [seg], endsWithNewline: false }, [choice]).split('\n');
          return (
            <div key={i} className="cr-block is-fixed">
              <p className="cr-fixed-head">
                <span aria-hidden="true">✓ </span>
                {t(`conflict.kept.${how === 'edited' ? 'edited' : `${words}.${how}`}`, { n: idx + 1 })}
                {!disabled && (
                  <button type="button" className="cr-change" onClick={() => onChoose(idx, null)}>
                    {t('conflict.change')}
                    <span className="visually-hidden"> ({t('conflict.chooseFor', { n: idx + 1 })})</span>
                  </button>
                )}
              </p>
              <pre className="cr-plain cr-result">{lines.join('\n') || ' '}</pre>
            </div>
          );
        }
        return (
          <div key={i} className="cr-block is-open">
            <div className="cr-bar" role="group" aria-label={n > 1 ? t('conflict.chooseFor', { n: idx + 1 }) : t('conflict.choose')}>
              <button type="button" className="cr-act" disabled={disabled} onClick={() => onChoose(idx, 'ours')}>
                {act('ours')}
              </button>
              <button type="button" className="cr-act" disabled={disabled} onClick={() => onChoose(idx, 'theirs')}>
                {act('theirs')}
              </button>
              <button type="button" className="cr-act" disabled={disabled} onClick={() => onChoose(idx, 'both')}>
                {act('both')}
              </button>
              <button type="button" className="cr-act" disabled={disabled} onClick={() => onEdit(idx, `${seg.raw.join('\n')}\n`)}>
                ✎ {t('conflict.edit')}
              </button>
            </div>
            <div className="cr-lines">
              {(() => {
                let part: 'ours' | 'base' | 'theirs' = 'ours';
                return seg.raw.map((line, j) => {
                  const m = markerOf(line);
                  if (m) {
                    if (m === 'base') part = 'base';
                    if (m === 'mid') part = 'theirs';
                    const tag = m === 'start' ? t(`conflict.side.${words}.ours`, { label: labels.ours }) : m === 'end' ? t(`conflict.side.${words}.theirs`, { label: labels.theirs }) : '';
                    return (
                      <div key={j} className="cr-line cr-marker">
                        <WarnIcon />
                        <code className="cr-code">{line}</code>
                        <span className="visually-hidden"> ({t('conflict.markerSr')})</span>
                        {tag && (
                          <span className={cx('cr-tag', m === 'start' ? 'cr-tag-ours' : 'cr-tag-theirs')} aria-hidden="true">
                            {tag}
                          </span>
                        )}
                      </div>
                    );
                  }
                  return (
                    <div key={j} className={cx('cr-line', `cr-${part}`)}>
                      <span className="visually-hidden">{t(`conflict.sr.${part === 'base' ? 'base' : `${words}.${part}`}`)}: </span>
                      <code className="cr-code">{line || ' '}</code>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        );
      })}
    </div>
  );
}
