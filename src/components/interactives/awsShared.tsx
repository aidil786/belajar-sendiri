// Shared bits for the AWS games (Level Up): simple drawn icons from the mall story, and the policy box.
// No AWS logos, no console screenshots: every picture is a plain line drawing.
import type { ReactNode } from 'react';
import { cx } from './shared';

export type AwsIconName =
  | 'mall'
  | 'unit'
  | 'key'
  | 'sign'
  | 'fence'
  | 'stop'
  | 'user'
  | 'role'
  | 'gate'
  | 'door'
  | 'road'
  | 'bill'
  | 'shelf'
  | 'globe'
  | 'server'
  | 'ok'
  | 'warn';

const PATHS: Record<AwsIconName, ReactNode> = {
  // The mall: a big roof with a flag (the owner's rules, SCPs).
  mall: (
    <>
      <path d="M2.5 9L10 4l7.5 5" />
      <path d="M4 9v8h12V9M8 17v-4h4v4" />
      <path d="M10 4V1.5l3 1-3 1" />
    </>
  ),
  // One rented unit: an awning over a door.
  unit: (
    <>
      <path d="M3 8h14l-1.5-4h-11z" />
      <path d="M4 8v9h12V8M8.5 17v-5h3v5" />
    </>
  ),
  key: (
    <>
      <circle cx="6.5" cy="10" r="3.5" />
      <path d="M10 10h8M15 10v3M17.5 10v2" />
    </>
  ),
  // The unit's own signboard (a resource-based policy).
  sign: (
    <>
      <rect x="3" y="3" width="14" height="9" rx="1.5" />
      <path d="M6 6.5h8M6 9h5M7 12v5M13 12v5" />
    </>
  ),
  // A fence: the most you may ever do (permissions boundary).
  fence: (
    <>
      <path d="M4 17V6l1.5-2L7 6v11M9.25 17V6l1.5-2 1.5 2v11M14.5 17V6L16 4l1.5 2v11" />
      <path d="M2.5 9h16M2.5 14h16" />
    </>
  ),
  // A stop sign (an explicit Deny).
  stop: (
    <>
      <path d="M7 2.5h6l4.5 4.5v6L13 17.5H7L2.5 13V7z" />
      <path d="M6.5 10h7" />
    </>
  ),
  user: (
    <>
      <circle cx="10" cy="7" r="3.2" />
      <path d="M3.5 17a6.5 6.5 0 0 1 13 0" />
    </>
  ),
  // A staff lanyard badge (a role you put on for a while).
  role: (
    <>
      <path d="M6 2.5l4 5 4-5" />
      <rect x="5" y="7.5" width="10" height="10" rx="1.5" />
      <circle cx="10" cy="11" r="1.6" />
      <path d="M7.5 15.5h5" />
    </>
  ),
  // The row gate (network ACL): a barrier arm.
  gate: (
    <>
      <rect x="2.5" y="8" width="3" height="9" rx="0.8" />
      <path d="M5.5 10h12M8 10l1.5 2M11 10l1.5 2M14 10l1.5 2" />
    </>
  ),
  // The unit door (security group).
  door: (
    <>
      <rect x="5" y="2.5" width="10" height="15" rx="1" />
      <path d="M12 10.5h.01M2.5 17.5h15" />
    </>
  ),
  road: (
    <>
      <path d="M6 2.5L3 17.5M14 2.5l3 15" />
      <path d="M10 3v2.5M10 8.5v3M10 14.5v3" />
    </>
  ),
  // The monthly bill (a receipt with a torn bottom).
  bill: (
    <>
      <path d="M5 2.5h10v15l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5z" />
      <path d="M7.5 6.5h5M7.5 9.5h5M7.5 12.5h3" />
    </>
  ),
  shelf: (
    <>
      <path d="M2.5 16.5h15M2.5 9.5h15M3.5 3v14M16.5 3v14" />
      <rect x="5.5" y="5" width="3" height="4.5" rx="0.5" />
      <rect x="11" y="12" width="3.5" height="4.5" rx="0.5" />
    </>
  ),
  globe: (
    <>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M2.5 10h15M10 2.5c2.5 2.5 2.5 12.5 0 15M10 2.5c-2.5 2.5-2.5 12.5 0 15" />
    </>
  ),
  server: (
    <>
      <rect x="3" y="3" width="14" height="6" rx="1.2" />
      <rect x="3" y="11" width="14" height="6" rx="1.2" />
      <path d="M6 6h.01M6 14h.01M9 6h5M9 14h5" />
    </>
  ),
  ok: <path d="M4 10.5l4 4 8-9" />,
  warn: (
    <>
      <path d="M10 3l8 14H2z" />
      <path d="M10 8v4M10 14.5v.01" />
    </>
  ),
};

export function AwsIcon({ name, className }: { name: AwsIconName; className?: string }) {
  return (
    <svg
      className={cx('awg-icon', className)}
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

/** A short status mark: green tick, or red + warning icon (never colour alone). */
export function Mark({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cx('awg-mark', ok ? 'is-ok' : 'is-bad')}>
      <AwsIcon name={ok ? 'ok' : 'warn'} />
      <span>{label}</span>
    </span>
  );
}

export interface CodeLine {
  text: string;
  /** Highlight: an Allow that counted (green), a Deny that won (red + icon). */
  tone?: 'allow' | 'deny';
  /** Show the ✓ / ⚠ mark in the gutter (the first line of a highlighted statement). */
  mark?: boolean;
}

/**
 * A policy (JSON) with line numbers. One line can be an input (the edit game). Long lines scroll inside
 * the box, never the page.
 */
export function PolicyBox({
  title,
  icon,
  lines,
  label,
  edit,
}: {
  title: string;
  icon: AwsIconName;
  lines: CodeLine[];
  label: string;
  edit?: { line: number; value: string; onChange: (v: string) => void; inputLabel: string; disabled?: boolean };
}) {
  return (
    <figure className="awg-policy" aria-label={label}>
      <figcaption className="awg-policy-title">
        <AwsIcon name={icon} />
        <span>{title}</span>
      </figcaption>
      {/* Long lines scroll sideways on phones: the box takes focus so keyboards can scroll it too. */}
      <div className="awg-code" tabIndex={0} role="region" aria-label={label}>
        {lines.map((l, i) => {
          const n = i + 1;
          const editing = edit && edit.line === n;
          const indent = /^\s*/.exec(l.text)![0].length;
          return (
            <div key={i} className={cx('awg-code-line', l.tone && `is-${l.tone}`, editing && 'is-edit')}>
              <span className="awg-code-no" aria-hidden="true">
                {n}
              </span>
              <span className="awg-code-mark" aria-hidden="true">
                {l.mark && l.tone === 'deny' ? '⚠' : l.mark && l.tone === 'allow' ? '✓' : editing ? '✎' : ''}
              </span>
              {editing ? (
                <input
                  className="awg-code-input"
                  style={{ marginInlineStart: `${indent}ch` }}
                  value={edit.value}
                  size={Math.max(18, edit.value.length + 2)}
                  onChange={(e) => edit.onChange(e.target.value)}
                  aria-label={edit.inputLabel}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoComplete="off"
                  disabled={edit.disabled}
                />
              ) : (
                <code className="awg-code-text">{l.text}</code>
              )}
            </div>
          );
        })}
      </div>
    </figure>
  );
}
