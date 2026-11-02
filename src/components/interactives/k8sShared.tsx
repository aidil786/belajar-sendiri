// Shared bits for the Kubernetes games: a kubectl output box, simple drawn icons, status chips.
// No vendor logos: every icon is a plain drawing of the food-court story.
import type { ReactNode } from 'react';
import { cx } from './shared';

export type IconName =
  | 'node'
  | 'pod'
  | 'lock'
  | 'key'
  | 'sign'
  | 'door'
  | 'route'
  | 'service'
  | 'slice'
  | 'user'
  | 'bot'
  | 'group'
  | 'role'
  | 'commit'
  | 'cluster'
  | 'warn'
  | 'ok'
  | 'browser';

const PATHS: Record<IconName, ReactNode> = {
  // A stall: awning + counter.
  node: (
    <>
      <path d="M3 8h14l-1.5-4h-11z" />
      <path d="M4 8v8h12V8M8 16v-4h4v4" />
    </>
  ),
  // A tray with two dishes.
  pod: (
    <>
      <rect x="2.5" y="10" width="15" height="5" rx="2" />
      <circle cx="7" cy="8" r="2.5" />
      <circle cx="13" cy="8" r="2.5" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="9" width="11" height="8" rx="1.5" />
      <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
    </>
  ),
  key: (
    <>
      <circle cx="6.5" cy="10" r="3.5" />
      <path d="M10 10h8M15 10v3M17.5 10v2" />
    </>
  ),
  sign: (
    <>
      <path d="M10 3v14M6 17h8" />
      <path d="M4 5h11l2 2-2 2H4z" />
    </>
  ),
  door: (
    <>
      <path d="M4 17V8a6 6 0 0 1 12 0v9z" />
      <path d="M10 17V9M2.5 17h15" />
    </>
  ),
  route: (
    <>
      <rect x="3" y="3.5" width="14" height="9" rx="1.5" />
      <path d="M6 8h6M10 6l2 2-2 2M10 12.5V17" />
    </>
  ),
  service: (
    <>
      <path d="M3 6h14v3a1.5 1.5 0 0 0 0 3v3H3v-3a1.5 1.5 0 0 0 0-3z" />
      <path d="M8 8l-.7 5M11.5 8l-.7 5M6.8 9.6h5.8M6.4 11.6h5.8" />
    </>
  ),
  slice: (
    <>
      <path d="M4 5h1M8 5h8M4 10h1M8 10h8M4 15h1M8 15h8" />
    </>
  ),
  user: (
    <>
      <circle cx="10" cy="7" r="3.2" />
      <path d="M3.5 17a6.5 6.5 0 0 1 13 0" />
    </>
  ),
  bot: (
    <>
      <rect x="4" y="6" width="12" height="9" rx="2" />
      <path d="M10 3v3M7.5 10h.01M12.5 10h.01M8 13h4" />
    </>
  ),
  group: (
    <>
      <circle cx="7" cy="7.5" r="2.6" />
      <circle cx="13.5" cy="8.5" r="2.2" />
      <path d="M2.5 16.5a4.5 4.5 0 0 1 9 0M11 16.5a3.6 3.6 0 0 1 6.5-1" />
    </>
  ),
  role: (
    <>
      <path d="M10 2.5l6 2.5v4.5c0 3.6-2.5 6.4-6 8-3.5-1.6-6-4.4-6-8V5z" />
      <path d="M7.5 10l2 2 3.5-4" />
    </>
  ),
  commit: (
    <>
      <circle cx="10" cy="10" r="3" />
      <path d="M2 10h5M13 10h5" />
    </>
  ),
  cluster: (
    <>
      <rect x="2.5" y="3" width="6.5" height="6" rx="1" />
      <rect x="11" y="3" width="6.5" height="6" rx="1" />
      <rect x="2.5" y="11" width="6.5" height="6" rx="1" />
      <rect x="11" y="11" width="6.5" height="6" rx="1" />
    </>
  ),
  warn: (
    <>
      <path d="M10 3l8 14H2z" />
      <path d="M10 8v4M10 14.5v.01" />
    </>
  ),
  ok: <path d="M4 10.5l4 4 8-9" />,
  browser: (
    <>
      <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
      <path d="M2.5 7h15M5 5.3h.01M7 5.3h.01" />
    </>
  ),
};

export function K8sIcon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={cx('k8g-icon', className)}
      viewBox="0 0 20 20"
      width="20"
      height="20"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  );
}

export interface OutLine {
  text: string;
  tone?: 'error' | 'ok' | 'muted';
}

/** A small terminal: the command, then its output. Error lines are red with a warning icon. */
export function KubectlBox({
  command,
  lines,
  label,
  title,
}: {
  command?: string;
  lines: OutLine[];
  label: string;
  title?: string;
}) {
  const firstError = lines.findIndex((l) => l.tone === 'error');
  return (
    <figure className="k8g-term" aria-label={label}>
      {title && <figcaption className="k8g-term-title">{title}</figcaption>}
      <pre className="k8g-term-body">
        {command && (
          <span className="k8g-term-line">
            <span className="k8g-term-prompt" aria-hidden="true">
              ${' '}
            </span>
            {command}
          </span>
        )}
        {lines.map((l, i) => (
          <span key={i} className={cx('k8g-term-line', l.tone && `is-${l.tone}`)}>
            {i === firstError && (
              <span className="k8g-term-mark" aria-hidden="true">
                ⚠{' '}
              </span>
            )}
            {l.tone === 'ok' && (
              <span className="k8g-term-mark" aria-hidden="true">
                ✓{' '}
              </span>
            )}
            {l.text || ' '}
          </span>
        ))}
      </pre>
    </figure>
  );
}

/** A coloured state chip. Failure is always red plus an icon. */
export function StateChip({
  tone,
  children,
}: {
  tone: 'ok' | 'wait' | 'fail' | 'idle' | 'here';
  children: ReactNode;
}) {
  const mark =
    tone === 'ok'
      ? '✓'
      : tone === 'fail'
        ? '⚠'
        : tone === 'wait'
          ? '◌'
          : tone === 'here'
            ? '●'
            : '○';
  return (
    <span className={cx('k8g-chip', `is-${tone}`)}>
      <span aria-hidden="true">{mark} </span>
      {children}
    </span>
  );
}

/** The plain-words line under a real error (rule 19). */
export function PlainWords({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="k8g-plain">
      <strong>{label}</strong> {children}
    </p>
  );
}
