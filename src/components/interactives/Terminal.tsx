// Mini terminal: xterm.js shows the output; a real <input> takes the typing.
// A real input works well with phone keyboards and screen readers.
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { Terminal as XTerm } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { T } from './shared';
import './terminal.css';

export interface TerminalHandle {
  write: (ansi: string) => void;
  clear: () => void;
  setInput: (text: string) => void;
  focus: () => void;
}

export interface TerminalProps {
  t: T;
  prompt: string; // e.g. "~/diary"
  customPrompt?: string | undefined; // e.g. git add -p question
  onRun: (line: string) => void;
  complete: (line: string) => string;
  history: string[];
  disabled?: boolean;
  ref?: Ref<TerminalHandle>;
  rows?: number;
  /** The phone key row. Default: the Git keys. Ship It terminals pass their own (see KEY_SETS). */
  keys?: readonly string[];
}

function readVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Key rows for the phone keyboard. `Tab` completes the word, `↑` recalls the last command.
 * Words and flags (git, docker, -m, --name) get a space after them; punctuation does not.
 */
export const KEY_SETS = {
  git: ['git', '-m', '.', '"', 'Tab', '↑'],
  docker: ['docker', '-p', '-d', '--name', ':', 'Tab', '↑'],
  compose: ['docker', 'compose', '-d', '-f', 'Tab', '↑'],
  kubectl: ['kubectl', '-n', '-f', '-o', '/', 'Tab', '↑'],
} as const satisfies Record<string, readonly string[]>;

/** A key that types a word or flag (and a space after it). */
const isWordKey = (k: string) => /^-{0,2}[A-Za-z][\w-]*$/.test(k);

export default function Terminal({ t, prompt, customPrompt, onRun, complete, history, disabled, ref, rows = 10, keys = KEY_SETS.git }: TerminalProps) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<XTerm | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const pending = useRef<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [histIdx, setHistIdx] = useState<number | null>(null);

  useImperativeHandle(ref, () => ({
    write: (ansi) => {
      if (term.current) term.current.write(ansi);
      else pending.current.push(ansi);
    },
    clear: () => {
      term.current?.clear();
      term.current?.write('\x1b[2J\x1b[H');
    },
    setInput: (text) => {
      setValue(text);
      requestAnimationFrame(() => {
        input.current?.focus();
        input.current?.setSelectionRange(text.length, text.length);
      });
    },
    focus: () => input.current?.focus(),
  }));

  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;
    (async () => {
      const [{ Terminal: XTermCtor }, { FitAddon: Fit }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]);
      if (disposed || !host.current) return;
      const x = new XTermCtor({
        convertEol: true,
        disableStdin: true,
        cursorBlink: false,
        cursorStyle: 'underline',
        cursorInactiveStyle: 'none',
        fontFamily: readVar('--font-mono', 'monospace'),
        fontSize: 14,
        lineHeight: 1.25,
        rows,
        scrollback: 500,
        theme: {
          background: readVar('--term-bg', '#16181d'),
          foreground: readVar('--term-fg', '#e8e8ec'),
          red: readVar('--term-red', '#ff7b72'),
          green: readVar('--term-green', '#7ee787'),
          yellow: readVar('--term-yellow', '#f2cc60'),
          blue: readVar('--term-blue', '#79c0ff'),
          magenta: readVar('--term-magenta', '#d2a8ff'),
          cyan: readVar('--term-cyan', '#76e3ea'),
          brightBlack: readVar('--term-muted', '#9ea3ad'),
        },
      });
      const f = new Fit();
      x.loadAddon(f);
      x.open(host.current);
      // The xterm output is mirrored in a live region, so hide its own textarea from tabbing.
      x.textarea?.setAttribute('tabindex', '-1');
      x.textarea?.setAttribute('aria-hidden', 'true');
      term.current = x;
      fit.current = f;
      const doFit = () => {
        try {
          f.fit();
        } catch {
          /* hidden: ignore */
        }
      };
      doFit();
      document.fonts?.ready.then(doFit).catch(() => undefined);
      ro = new ResizeObserver(doFit);
      ro.observe(host.current);
      for (const chunk of pending.current) x.write(chunk);
      pending.current = [];
    })();
    return () => {
      disposed = true;
      ro?.disconnect();
      term.current?.dispose();
      term.current = null;
    };
  }, [rows]);

  const insert = (text: string) => {
    const el = input.current;
    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const word = isWordKey(text);
    const needsSpace = word && start > 0 && value[start - 1] !== ' ';
    const add = (needsSpace ? ' ' : '') + text + (word ? ' ' : '');
    const next = value.slice(0, start) + add + value.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + add.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const recall = (dir: -1 | 1) => {
    if (history.length === 0) return;
    let idx = histIdx === null ? history.length : histIdx;
    idx = Math.min(history.length, Math.max(0, idx + dir));
    setHistIdx(idx === history.length ? null : idx);
    setValue(idx === history.length ? '' : (history[idx] ?? ''));
  };

  const doComplete = () => setValue((v) => complete(v));

  const submit = () => {
    const line = value;
    setValue('');
    setHistIdx(null);
    onRun(line);
  };

  return (
    <div className="term">
      <div className="term-screen" ref={host} aria-hidden="true" />
      <form
        className="term-input-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!disabled) submit();
        }}
      >
        <label className="term-prompt" htmlFor={`${prompt}-input`}>
          <span className="visually-hidden">{t('term.inputLabel')}. </span>
          {customPrompt ? <span className="term-custom-prompt">{customPrompt}</span> : <><span className="term-path">{prompt}</span> $</>}
        </label>
        <input
          ref={input}
          id={`${prompt}-input`}
          className="term-input"
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              recall(-1);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              recall(1);
            } else if (e.key === 'Tab' && value.trim()) {
              e.preventDefault();
              doComplete();
            } else if (e.key === 'l' && e.ctrlKey) {
              e.preventDefault();
              onRun('clear');
            }
          }}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          placeholder={t('term.placeholder')}
          data-terminal-input="true"
        />
        <button type="submit" className="btn term-run" disabled={disabled}>
          {t('term.run')}
        </button>
      </form>
      <div className="term-keys" role="group" aria-label={t('term.keys')}>
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            className="term-key"
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (k === 'Tab' ? doComplete() : k === '↑' ? recall(-1) : insert(k))}
          >
            {k}
            {(k === 'Tab' || k === '↑') && <span className="visually-hidden"> ({k === 'Tab' ? t('term.tab') : t('term.history')})</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
