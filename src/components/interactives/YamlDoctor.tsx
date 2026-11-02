// YamlDoctor: fix a broken Kubernetes manifest until `kubectl apply` turns green.
// The output is what kubectl 1.37 prints (see src/lib/k8sSchema.ts); a plain line explains it.
// The editor is a normal textarea (screen readers and phones work as usual) with line numbers,
// indent guides and the problem line marked (red + icon). Rule 18: ~15 lines show at a time.
import { useId, useMemo, useRef, useState } from 'react';
import type { Lang } from '~/i18n';
import { kubectlApply, type ApplyIssue, type ApplyResult } from '~/lib/k8sSchema';
import { KubectlBox, PlainWords } from './k8sShared';
import {
  Announce,
  Feedback,
  cx,
  pickPraise,
  useCardEvents,
  useLearnerName,
  useT,
  type T,
} from './shared';
import './k8s-games.css';

export interface YamlDoctorProps {
  lang: Lang;
  /** The broken manifest. */
  manifest: string;
  /** File name shown in `kubectl apply -f <file>` (default manifest.yaml). */
  file?: string;
  /** One short instruction above the editor. */
  prompt?: string;
  /** Shown when the learner asks for a hint. */
  hint?: string;
  /** Regexes (multiline) that must still match when it applies, so deleting the problem isn't a fix. */
  keep?: string[];
  /** Kind message when a `keep` regex no longer matches. */
  keepHint?: string;
  /** Namespaces that exist in the practice cluster (besides default and the kube-* ones). */
  namespaces?: string[];
  /** The fixed manifest. Never shown; `npm run check:mdx` and `npm run verify:manifests` check it. */
  solution?: string;
  success?: string;
}

/** The plain-words sentence for an issue. */
function plain(t: T, issue: ApplyIssue): string {
  const params = {
    line: issue.line,
    field: issue.field ?? '',
    detail: issue.detail ?? '',
    suggest: issue.suggest ?? '',
  };
  const key =
    issue.code === 'noMatch' && !issue.suggest
      ? 'k8sDoctor.why.noMatchUnknown'
      : `k8sDoctor.why.${issue.code}`;
  return t(key, params);
}

export default function YamlDoctor({
  lang,
  manifest,
  file = 'manifest.yaml',
  prompt,
  hint,
  keep,
  keepHint,
  namespaces,
  success,
}: YamlDoctorProps) {
  const t = useT(lang);
  const learner = useLearnerName();
  const { ref, emit } = useCardEvents();
  const id = useId();
  const [text, setText] = useState(manifest);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [keepMsg, setKeepMsg] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [done, setDone] = useState(false);
  const [announce, setAnnounce] = useState('');
  const tries = useRef(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const back = useRef<HTMLDivElement>(null);
  const keepRes = useMemo(() => (keep ?? []).map((k) => new RegExp(k, 'm')), [keep]);

  const lines = text.split('\n');
  const issue = result && !result.ok ? result.issues[0] : undefined;
  const badLine = issue?.line;

  const apply = () => {
    tries.current++;
    const r = kubectlApply(text, file, { namespaces });
    setResult(r);
    setKeepMsg(null);
    if (!r.ok) {
      const first = r.issues[0];
      setAnnounce(`${t('k8sDoctor.failed')} ${first ? plain(t, first) : ''}`);
      emit('fl:wrong');
      return;
    }
    if (keepRes.some((re) => !re.test(text))) {
      setKeepMsg(keepHint ?? t('k8sDoctor.keep'));
      setAnnounce(keepHint ?? t('k8sDoctor.keep'));
      emit('fl:wrong');
      return;
    }
    setDone(true);
    setAnnounce(t('k8sDoctor.applied'));
    emit('fl:done', { tries: tries.current });
  };

  const edit = (next: string, caret?: [number, number]) => {
    setText(next);
    if (caret && area.current) {
      const el = area.current;
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(caret[0], caret[1]);
      });
    }
  };

  // Add or remove one space at the start of the line(s) the caret is on (phones have no Tab key,
  // and an off-by-one indent needs exactly one space).
  const shift = (dir: 1 | -1) => {
    const el = area.current;
    if (!el || done) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const from = text.lastIndexOf('\n', start - 1) + 1;
    const toNl = text.indexOf('\n', end);
    const to = toNl < 0 ? text.length : toNl;
    const block = text.slice(from, to).split('\n');
    let first = 0;
    let total = 0;
    const changed = block.map((l, i) => {
      const d = dir === 1 ? 1 : l.startsWith(' ') ? -1 : 0;
      if (i === 0) first = d;
      total += d;
      return d === 1 ? ` ${l}` : d === -1 ? l.slice(1) : l;
    });
    edit(text.slice(0, from) + changed.join('\n') + text.slice(to), [
      Math.max(from, start + first),
      Math.max(from, end + total),
    ]);
    const line = text.slice(0, from).split('\n').length;
    setAnnounce(t(dir === 1 ? 'k8sDoctor.indented' : 'k8sDoctor.outdented', { line }));
  };

  const syncScroll = () => {
    if (back.current && area.current) {
      back.current.scrollTop = area.current.scrollTop;
      back.current.scrollLeft = area.current.scrollLeft;
    }
  };

  const out =
    result?.lines.map((l) => ({
      text: l.text,
      tone: l.error ? ('error' as const) : ('ok' as const),
    })) ?? [];

  return (
    <div className="k8g k8g-doctor" ref={ref}>
      <p className="interactive-help">{prompt ?? t('k8sDoctor.help')}</p>
      <div className="k8g-file">
        <span className="k8g-file-tab">
          <span aria-hidden="true">📄 </span>
          {file}
        </span>
        <span className="k8g-file-note">{t('k8sDoctor.lines', { n: lines.length })}</span>
      </div>
      <div className={cx('k8g-editor', done && 'is-done')}>
        {/* Behind the textarea: line numbers, indent guides and the marked line (the text itself is the textarea's). */}
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
                <span
                  className={cx('k8g-guides', tab && 'has-tab')}
                  style={{ width: `${ind}ch` }}
                />
              </div>
            );
          })}
        </div>
        <label className="visually-hidden" htmlFor={`${id}-yaml`}>
          {t('k8sDoctor.editor', { file })}
        </label>
        <textarea
          id={`${id}-yaml`}
          ref={area}
          className="k8g-editor-input"
          value={text}
          readOnly={done}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          wrap="off"
          rows={Math.min(15, Math.max(6, lines.length))}
          aria-describedby={issue ? `${id}-why` : undefined}
          onScroll={syncScroll}
          onChange={(e) => {
            setText(e.target.value);
            setKeepMsg(null);
          }}
        />
      </div>
      {!done && (
        <div className="k8g-row">
          <button type="button" className="btn btn-ghost scene-btn" onClick={() => shift(1)}>
            <span aria-hidden="true">→ </span>
            {t('k8sDoctor.indent')}
          </button>
          <button type="button" className="btn btn-ghost scene-btn" onClick={() => shift(-1)}>
            <span aria-hidden="true">← </span>
            {t('k8sDoctor.outdent')}
          </button>
          <button
            type="button"
            className="btn btn-ghost scene-btn"
            onClick={() => {
              setText(manifest);
              setResult(null);
              setKeepMsg(null);
              setAnnounce(t('k8sDoctor.resetDone'));
            }}
          >
            <span aria-hidden="true">↺ </span>
            {t('k8sDoctor.reset')}
          </button>
          {hint && (
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
              {t('k8sDoctor.hint')}
            </button>
          )}
          <button type="button" className="btn scene-btn k8g-apply" onClick={apply}>
            <span aria-hidden="true">▶ </span>
            {t('k8sDoctor.apply')}
          </button>
        </div>
      )}
      {showHint && hint && !done && <p className="k8g-hint">{hint}</p>}
      {result && (
        <KubectlBox
          command={`kubectl apply -f ${file}`}
          lines={out}
          label={t('k8sDoctor.output')}
        />
      )}
      {issue && (
        <div id={`${id}-why`}>
          <PlainWords label={t('k8sGame.plain')}>{plain(t, issue)}</PlainWords>
        </div>
      )}
      {keepMsg && (
        <Feedback kind="almost">
          {t('feedback.almost')} {keepMsg}
        </Feedback>
      )}
      {result && !result.ok && !keepMsg && (
        <Feedback kind="almost">
          {t('feedback.almost')} {t('k8sDoctor.tryAgain', { line: issue?.line ?? 1 })}
        </Feedback>
      )}
      {done && (
        <Feedback kind="right">
          {success ?? `${pickPraise(t, learner, tries.current)} ${t('k8sDoctor.done')}`}
        </Feedback>
      )}
      <Announce text={announce} />
    </div>
  );
}
