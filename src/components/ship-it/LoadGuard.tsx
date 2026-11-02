// If a lazy simulator's code can't download (a flaky phone network), show a kind fallback
// instead of an empty box. Used by the night shift drills and the CKAD practice runner.
import { Component, type ReactNode } from 'react';

export default class LoadGuard extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
