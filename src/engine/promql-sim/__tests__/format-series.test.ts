import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatValue,
  goFloatF,
  goFloatG,
  goFloatV,
  labelsString,
  parseDuration,
  roundTrip,
  seriesString,
} from '../format';
import { expandValues, parseSeriesLabels, pointsIn, SeriesStore } from '../series';

describe('numbers, printed like Go', () => {
  it('formatValue is the API / UI form: shortest digits, no exponent', () => {
    expect(formatValue(0.16666666666666666)).toBe('0.16666666666666666');
    expect(formatValue(1e21)).toBe('1000000000000000000000');
    expect(formatValue(1.5e-7)).toBe('0.00000015');
    expect(formatValue(-2)).toBe('-2');
    expect(formatValue(NaN)).toBe('NaN');
    expect(formatValue(Infinity)).toBe('+Inf');
    expect(formatValue(-Infinity)).toBe('-Inf');
  });

  it('goFloatV is %v: an exponent from 1e+06 and below 1e-04', () => {
    expect(goFloatV(100000)).toBe('100000');
    expect(goFloatV(1000000)).toBe('1e+06');
    expect(goFloatV(1234567)).toBe('1.234567e+06');
    expect(goFloatV(0.0001)).toBe('0.0001');
    expect(goFloatV(0.00001)).toBe('1e-05');
    expect(goFloatV(0.9999999999999993)).toBe('0.9999999999999993');
  });

  it('goFloatG rounds to significant digits, half to even on exact ties, no trailing zeros', () => {
    expect(goFloatG(1.5, 4)).toBe('1.5');
    expect(goFloatG(123.456, 4)).toBe('123.5');
    expect(goFloatG(12345, 4)).toBe('1.234e+04'); // 12345 is an exact tie: 4 is even
    expect(goFloatG(12355, 4)).toBe('1.236e+04');
    expect(goFloatG(100, 4)).toBe('100');
    expect(goFloatG(0.001234, 4)).toBe('0.001234');
    expect(goFloatG(999.9999999999993, 4)).toBe('1000');
  });

  it('goFloatF uses the exact binary value (0.125 → 0.12, 0.135 → 0.14)', () => {
    expect(goFloatF(0.125, 2)).toBe('0.12');
    expect(goFloatF(0.375, 2)).toBe('0.38');
    expect(goFloatF(0.135, 2)).toBe('0.14');
    expect(goFloatF(2, 1)).toBe('2.0');
    expect(goFloatF(-0.04, 1)).toBe('-0.0');
  });

  it('roundTrip writes YAML that Go reads back to the same double', () => {
    expect(roundTrip(0.1 + 0.2)).toBe('0.30000000000000004');
    expect(roundTrip(NaN)).toBe('.nan');
    expect(roundTrip(-Infinity)).toBe('-.inf');
  });
});

describe('durations', () => {
  it('parses Prometheus durations and refuses the rest', () => {
    expect(parseDuration('5m')).toBe(300_000);
    expect(parseDuration('1h30m')).toBe(5_400_000);
    expect(parseDuration('90s')).toBe(90_000);
    expect(parseDuration('250ms')).toBe(250);
    expect(parseDuration('0')).toBe(0);
    expect(parseDuration('5x')).toBeNull();
    expect(parseDuration('30m1h')).toBeNull();
    expect(parseDuration('')).toBeNull();
  });

  it('prints like model.Duration', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(90_000)).toBe('1m30s');
    expect(formatDuration(7 * 24 * 3600_000)).toBe('1w');
    expect(formatDuration(8 * 24 * 3600_000)).toBe('8d');
    expect(formatDuration(5_400_000)).toBe('1h30m');
  });
});

describe('promtool series notation', () => {
  it('a+bxn gives n+1 values by repeated addition', () => {
    expect(expandValues('0+10x3')).toEqual([0, 10, 20, 30]);
    expect(expandValues('5-1x2')).toEqual([5, 4, 3]);
    // Repeated addition, like promtool: 0.1 added ten times is not 1.1 exactly.
    expect(expandValues('0.1+0.1x10').at(-1)).toBe(1.0999999999999999);
  });

  it('axn repeats; _ and _xn are gaps; stale is a marker', () => {
    expect(expandValues('7x2')).toEqual([7, 7, 7]);
    expect(expandValues('1 _ 3')).toEqual([1, null, 3]);
    expect(expandValues('_x3 1')).toEqual([null, null, null, 1]);
    expect(expandValues('1 stale')).toEqual([1, 'stale']);
    expect(expandValues('Inf -Inf')).toEqual([Infinity, -Infinity]);
    expect(() => expandValues('1 two')).toThrow(/cannot read the value "two"/);
  });

  it('reads series labels in both forms', () => {
    expect(parseSeriesLabels('up{job="shop",instance="a:1"}')).toEqual({ __name__: 'up', instance: 'a:1', job: 'shop' });
    expect(parseSeriesLabels('{__name__="up", job="x\\"y"}')).toEqual({ __name__: 'up', job: 'x"y' });
    expect(parseSeriesLabels('kedai_clock')).toEqual({ __name__: 'kedai_clock' });
    expect(labelsString({ __name__: 'up', job: 'shop' })).toBe('{__name__="up", job="shop"}');
    expect(seriesString({ __name__: 'up', job: 'shop' })).toBe('up{job="shop"}');
    expect(seriesString({ job: 'shop' })).toBe('{job="shop"}');
  });

  it('keeps series in creation order: by the step that loads them, then input order', () => {
    const s = SeriesStore.fromInput(
      [
        { series: 'b', values: '_ _ 1' },
        { series: 'a', values: '1' },
        { series: 'c', values: '2' },
      ],
      60_000,
    );
    expect(s.all().map((x) => x.labels.__name__)).toEqual(['a', 'c', 'b']);
  });

  it('windows are left-open and right-closed', () => {
    const pts = [0, 1, 2, 3].map((i) => ({ t: i * 60_000, v: i }));
    expect(pointsIn(pts, 60_000, 180_000).map((p) => p.v)).toEqual([2, 3]);
    expect(pointsIn(pts, -1, 0).map((p) => p.v)).toEqual([0]);
  });
});
