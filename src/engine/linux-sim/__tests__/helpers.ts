// Test helpers: run commands on a fresh practice server and read the screen.
import { createMachine, plain, run, type LinuxResult, type LinuxState } from '..';

export interface Session {
  st: LinuxState;
  /** Run one line; returns the result (and keeps the new state). */
  sh(line: string): LinuxResult & { text: string };
  /** Run one line and return what the screen shows. */
  out(line: string): string;
}

export function session(st: LinuxState = createMachine()): Session {
  const s: Session = {
    st,
    sh(line) {
      const r = run(s.st, line);
      s.st = r.state;
      return { ...r, text: plain(r.output) };
    },
    out(line) {
      return s.sh(line).text;
    },
  };
  return s;
}
