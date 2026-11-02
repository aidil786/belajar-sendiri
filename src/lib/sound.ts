// Tiny optional sound effects made with WebAudio (no audio files).
// Off by default; never plays in calm mode.
import { $progress } from '~/stores/progress';

let ctx: AudioContext | null = null;

const TONES: Record<'win' | 'oops' | 'tap', [number, number][]> = {
  win: [
    [660, 0],
    [880, 0.09],
  ],
  oops: [[330, 0]],
  tap: [[520, 0]],
};

export function playSound(kind: keyof typeof TONES): void {
  const s = $progress.get().settings;
  if (!s.sound || s.calm || typeof window === 'undefined') return;
  try {
    ctx ??= new AudioContext();
    for (const [freq, at] of TONES[kind]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      const start = ctx.currentTime + at;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.06, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.2);
    }
  } catch {
    // Sound is a bonus; ignore failures.
  }
}
