// Real-world mission check: the learner types their GitHub username (and repo name),
// we ask the public GitHub API (no login, no token) and tick what we can see.
// The username is saved in this browser so later missions fill it in.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Lang } from '~/i18n';
import {
  cleanRepo,
  cleanUser,
  needsRepo,
  runChecks,
  validRepo,
  validUser,
  type CheckOutcome,
  type Fetcher,
  type MissionCheckSpec,
} from '~/lib/missionCheck';
import { $progress, forgetGithub, setGithub } from '~/stores/progress';
import { Feedback, cx, useCardEvents, useT } from './shared';
import './mission-check.css';

export interface MissionCheckProps {
  lang: Lang;
  checks: MissionCheckSpec[];
  success?: string;
  title?: string;
}

const browserFetch: Fetcher = (url, init) => fetch(url, init);

export default function MissionCheck({ lang, checks, success, title }: MissionCheckProps) {
  const t = useT(lang);
  const { ref, emit } = useCardEvents();
  const id = useId();
  // One input per suggested repo name ('' = no suggestion).
  const repoKeys = useMemo(() => [...new Set(checks.filter((c) => needsRepo(c.type)).map((c) => c.repo ?? ''))], [checks]);
  const [user, setUser] = useState('');
  const [repos, setRepos] = useState<Record<string, string>>(() => Object.fromEntries(repoKeys.map((k) => [k, k])));
  const [saved, setSaved] = useState(false);
  const [results, setResults] = useState<(CheckOutcome | undefined)[]>(() => checks.map(() => undefined));
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [summary, setSummary] = useState('');
  const reported = useRef(false);

  // Fill in what the learner typed in earlier missions (after hydration, so the
  // server HTML and the first client render match).
  useEffect(() => {
    const g = $progress.get().settings.github;
    if (g.user) {
      setUser(g.user);
      setSaved(true);
    }
    setRepos((r) => Object.fromEntries(Object.keys(r).map((k) => [k, (k && g.repos[k]) || r[k] || ''])));
  }, []);

  const check = async () => {
    const u = cleanUser(user);
    if (!validUser(u)) {
      setFormError(t('ghcheck.badUser'));
      return;
    }
    const cleaned: Record<string, string> = {};
    for (const k of repoKeys) {
      const r = cleanRepo(repos[k] ?? '');
      if (!validRepo(r)) {
        setFormError(t('ghcheck.badRepo'));
        return;
      }
      cleaned[k] = r;
    }
    setFormError(null);
    setUser(u);
    setRepos((r) => ({ ...r, ...cleaned }));
    setGithub({ user: u, repos: Object.fromEntries(Object.entries(cleaned).filter(([k]) => k)) });
    setSaved(true);
    setBusy(true);
    setSummary(t('ghcheck.checking'));
    const fresh: (CheckOutcome | undefined)[] = checks.map(() => undefined);
    setResults(fresh);
    let out: (CheckOutcome | undefined)[];
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      out = [{ status: 'offline' }, ...checks.slice(1).map(() => undefined)];
    } else {
      out = await runChecks(checks, (c) => cleaned[c.repo ?? ''] ?? '', u, browserFetch, (i, o) => {
        fresh[i] = o;
        setResults([...fresh]);
      });
    }
    setResults(out);
    setBusy(false);
    const left = out.filter((o) => o?.status !== 'pass').length;
    if (left === 0) {
      setSummary(t('ghcheck.allDone'));
      if (!reported.current) {
        reported.current = true;
        emit('fl:done');
      }
    } else {
      setSummary(t('ghcheck.left', { n: left }));
      emit('fl:hint');
    }
  };

  const forget = () => {
    forgetGithub();
    setUser('');
    setRepos(Object.fromEntries(repoKeys.map((k) => [k, k])));
    setSaved(false);
  };

  const why = (c: MissionCheckSpec, o: CheckOutcome | undefined): string | null => {
    if (!o) return null;
    if (o.status === 'error') return t('ghcheck.error');
    if (o.status !== 'notYet') return null;
    if (o.reason === 'noFile') return t('ghcheck.why.noFile', { path: c.path ?? 'README.md' });
    if (o.reason === 'tooFew') return t('ghcheck.why.tooFew', { count: o.count ?? 0, need: o.need ?? 1 });
    return t(`ghcheck.why.${o.reason}`);
  };

  const stopper = results.find((o) => o?.status === 'rateLimited' || o?.status === 'offline');
  const allPass = results.every((o) => o?.status === 'pass');

  return (
    <div className="ghc" ref={ref}>
      <p className="ghc-title">
        <span aria-hidden="true">🎯 </span>
        {title ?? t('ghcheck.title')}
      </p>
      <form
        className="ghc-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void check();
        }}
      >
        <div className="ghc-field">
          <label htmlFor={`${id}-user`}>{t('ghcheck.user')}</label>
          <input
            id={`${id}-user`}
            className="ghc-input"
            value={user}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={t('ghcheck.userPlaceholder')}
            onChange={(e) => setUser(e.target.value)}
          />
        </div>
        {repoKeys.map((k, i) => (
          <div className="ghc-field" key={k || `repo-${i}`}>
            <label htmlFor={`${id}-repo-${i}`}>{repoKeys.length > 1 && k ? t('ghcheck.repoFor', { name: k }) : t('ghcheck.repo')}</label>
            <input
              id={`${id}-repo-${i}`}
              className="ghc-input"
              value={repos[k] ?? ''}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setRepos({ ...repos, [k]: e.target.value })}
            />
          </div>
        ))}
        <p className="ghc-privacy">
          <span aria-hidden="true">🔒 </span>
          {t('ghcheck.privacy')}
        </p>
        <div className="ghc-actions">
          <button type="submit" className="btn" disabled={busy || !user.trim()}>
            {busy ? t('ghcheck.checking') : t('ghcheck.check')}
          </button>
          {saved && !busy && (
            <button type="button" className="btn btn-quiet" onClick={forget}>
              {t('ghcheck.forget')}
            </button>
          )}
        </div>
      </form>
      {formError && (
        <Feedback kind="almost">
          {t('feedback.almost')} {formError}
        </Feedback>
      )}
      <ul className="ghc-list">
        {checks.map((c, i) => {
          const o = results[i];
          const pass = o?.status === 'pass';
          const text = why(c, o);
          return (
            <li key={i} className={cx('ghc-item', pass && 'is-pass', o && !pass && 'is-not-yet')}>
              <span className="ghc-mark" aria-hidden="true">
                {pass ? '✓' : o ? '○' : '·'}
              </span>
              <span className="ghc-body">
                <span className="ghc-label">{c.label}</span>
                <span className="ghc-state">{pass ? t('ghcheck.pass') : o ? t('ghcheck.notYet') : t('ghcheck.idle')}</span>
                {text && <span className="ghc-why">{text}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {stopper && (
        <Feedback kind="almost">{stopper.status === 'rateLimited' ? t('ghcheck.rateLimited', { n: stopper.minutes }) : t('ghcheck.offline')}</Feedback>
      )}
      {allPass && <Feedback kind="right">{success ?? t('ghcheck.allDone')}</Feedback>}
      <p className="visually-hidden" aria-live="polite">
        {summary}
      </p>
    </div>
  );
}
