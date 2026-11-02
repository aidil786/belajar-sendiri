import { describe, expect, it } from 'vitest';
import { instantQuery } from '../eval';
import { seriesString } from '../format';
import { alertsAt, evaluateRules, type AlertRuleDef } from '../rules';
import { buildScenario, runAlertRule, timeStops, type ObsScenario } from '../scenario';
import { SeriesStore } from '../series';
import { checkTemplate, expandTemplate, goSprintf } from '../template';

const M = 60_000;

const updown = SeriesStore.fromInput(
  [
    { series: 'up{instance="a"}', values: '1x3 0x6 1x5' }, // 0x6 is 7 values: down from 4m to 10m
    { series: 'up{instance="b"}', values: '1x15' },
  ],
  M,
);

function states(rule: AlertRuleDef, until = 15 * M) {
  const { result } = evaluateRules(updown, [{ name: 'g', rules: [rule] }], until, M);
  const tl = result.alerts[0]!;
  return tl.evals.map((e) => e.alerts.map((a) => a.state[0]).join('') || '-').join(' ');
}

describe('alerting rules', () => {
  it('inactive → pending → firing after `for`, then resolved', () => {
    // t = 0 … 15m: down at 4m, firing once it has been true for 3m (7m), back up at 11m.
    expect(states({ alert: 'Down', expr: 'up == 0', for: '3m' })).toBe('- - - - p p p f f f f - - - - -');
  });

  it('without `for` it fires at the first evaluation', () => {
    expect(states({ alert: 'Down', expr: 'up == 0' })).toBe('- - - - f f f f f f f - - - - -');
  });

  it('keep_firing_for holds a firing alert after the expression clears', () => {
    expect(states({ alert: 'Down', expr: 'up == 0', for: '3m', keep_firing_for: '2m' })).toBe('- - - - p p p f f f f f f - - -');
  });

  it('labels and annotations use templates; alertname is added; the metric name goes', () => {
    const { result, store } = evaluateRules(
      updown,
      [{ name: 'g', rules: [{ alert: 'Down', expr: 'up == 0', labels: { severity: 'page', who: '{{ $labels.instance }}' }, annotations: { summary: '{{ $labels.instance }} is {{ $value }}' } }] }],
      6 * M,
      M,
    );
    const firing = alertsAt(result.alerts[0]!, 5 * M);
    expect(firing).toEqual([{ labels: { alertname: 'Down', instance: 'a', severity: 'page', who: 'a' }, annotations: { summary: 'a is 0' }, state: 'firing', activeAt: 4 * M, value: 0 }]);
    // Prometheus writes ALERTS and ALERTS_FOR_STATE series too.
    const alerts = instantQuery(store, 'ALERTS', 5 * M);
    expect(alerts.type === 'vector' && alerts.samples.map((s) => seriesString(s.labels))).toEqual(['ALERTS{alertname="Down", alertstate="firing", instance="a", severity="page", who="a"}']);
    expect(instantQuery(store, 'ALERTS_FOR_STATE', 5 * M)).toMatchObject({ samples: [{ value: 240 }] });
  });

  it('alertsAt reads the latest evaluation at or before t', () => {
    const { result } = evaluateRules(updown, [{ name: 'g', rules: [{ alert: 'Down', expr: 'up == 0' }] }], 15 * M, 2 * M);
    expect(alertsAt(result.alerts[0]!, 5 * M).length).toBe(1); // the 4m evaluation
    expect(alertsAt(result.alerts[0]!, 3 * M).length).toBe(0);
  });

  it('a rule that fails is reported, not thrown', () => {
    const { result } = evaluateRules(updown, [{ name: 'g', rules: [{ alert: 'Bad', expr: 'up', labels: { instance: 'x' } }] }], M, M);
    expect(result.errors[0]).toMatchObject({ rule: 'Bad', message: 'vector contains metrics with the same labelset after applying alert labels' });
  });
});

describe('recording rules', () => {
  it('save a result as a new series, and write a stale marker when it disappears', () => {
    const { store } = evaluateRules(updown, [{ name: 'g', rules: [{ record: 'instance:down', expr: 'up == 0', labels: { team: 'kedai' } }] }], 15 * M, M);
    const at = (t: number) => {
      const v = instantQuery(store, 'instance:down', t);
      return v.type === 'vector' ? v.samples.map((s) => seriesString(s.labels)) : [];
    };
    expect(at(5 * M)).toEqual(['instance:down{instance="a", team="kedai"}']);
    // Gone right after recovery (stale marker), not 5 minutes later.
    expect(at(10 * M)).toHaveLength(1);
    expect(at(11 * M)).toEqual([]);
  });

  it('a later rule in the group sees an earlier rule’s output at the same time', () => {
    const { store } = evaluateRules(
      updown,
      [{ name: 'g', rules: [{ record: 'job:up:sum', expr: 'sum(up)' }, { record: 'job:up:double', expr: 'job:up:sum * 2' }] }],
      2 * M,
      M,
    );
    expect(instantQuery(store, 'job:up:double', 0)).toMatchObject({ samples: [{ value: 4 }] });
  });
});

describe('alert templates (Go text/template subset)', () => {
  const data = { labels: { __name__: 'up', instance: 'shop-1', job: 'shop' }, value: 1234567 };
  it('prints $value like Go %v, and the Prometheus helpers', () => {
    expect(expandTemplate('{{ $value }}', data)).toBe('1.234567e+06');
    expect(expandTemplate('{{ $value | humanize }}', data)).toBe('1.235M');
    expect(expandTemplate('{{ humanize 0.0123 }}', data)).toBe('12.3m');
    expect(expandTemplate('{{ 0.123456 | humanizePercentage }}', data)).toBe('12.35%');
    expect(expandTemplate('{{ 3661 | humanizeDuration }}', data)).toBe('1h 1m 1s');
    expect(expandTemplate('{{ 0.5 | humanizeDuration }}', data)).toBe('500ms');
    expect(expandTemplate('{{ printf "%.2f" 3.14159 }}', data)).toBe('3.14');
    expect(expandTemplate('{{ $value | printf "%.1f" }}', data)).toBe('1234567.0');
  });

  it('reads labels both ways, pipes into toUpper, trims with {{- -}}', () => {
    expect(expandTemplate('{{ $labels.instance }} / {{ .Labels.job | toUpper }}', data)).toBe('shop-1 / SHOP');
    expect(expandTemplate('{{ $labels.missing }}!', data)).toBe('!');
    expect(expandTemplate('a   {{- " b " -}}   c', data)).toBe('a b c');
  });

  it('refuses what it does not run (never a wrong guess)', () => {
    expect(() => checkTemplate('{{ if gt $value 1.0 }}big{{ end }}')).toThrow(/does not run \{\{ if \}\}/);
    expect(() => checkTemplate('{{ $value | reReplaceAll "a" "b" }}')).toThrow(/reReplaceAll/);
    expect(() => checkTemplate('{{ $labels.job')).toThrow(/unclosed action/);
  });

  it('goSprintf handles verbs and mistakes like Go', () => {
    expect(goSprintf('%d', [{ kind: 'num', v: 1.5 }])).toBe('%!d(float64=1.5)');
    expect(goSprintf('%s and %s', [{ kind: 'str', v: 'a' }])).toBe('a and %!s(MISSING)');
    expect(goSprintf('%5.1f|%-4s|', [{ kind: 'num', v: 2.25 }, { kind: 'str', v: 'ab' }])).toBe('  2.2|ab  |');
  });
});

describe('scenarios', () => {
  const sc: ObsScenario = {
    id: 't-mini',
    interval: '30s',
    series: [{ series: 'q', values: '1 30 31 32 33 34 35 2' }],
    verify: [],
  };
  it('build a store, an end time and slider stops at the scrape interval', () => {
    const b = buildScenario(sc);
    expect(b.end).toBe(7 * 30_000);
    expect(timeStops(b)).toHaveLength(8);
    expect(buildScenario(sc)).toBe(b); // cached
  });

  it('runAlertRule gives the learner’s rule its own timeline', () => {
    const b = buildScenario(sc);
    const r = runAlertRule(b, { alert: 'Long', expr: 'q > 25', for: '1m' });
    expect(r.errors).toEqual([]);
    expect(r.timeline.evals.map((e) => e.alerts.map((a) => a.state[0]).join('') || '-').join(' ')).toBe('- p f f');
  });
});
