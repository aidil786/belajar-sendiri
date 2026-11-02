// World O3 "Alarms & Screens": alert rules, symptoms vs causes, dashboards, burn rates.
// O3 lessons also reuse the models in examples.ts: o3-target-down (L01, M9), o3-flappy (L08, boss),
// o3-slow-burn (L06), o2-shop-requests (L04, L05).
// Series use promtool's notation ('0+600x30' = 0, 600, 1200 … 31 values, one per minute).
// Every `verify` entry is checked against the real promtool 3.13 (npm run verify:promql).
import type { ObsScenario } from '~/engine/promql-sim';

const ERROR_RATIO = 'sum(rate(http_requests_total{code=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))';
const SLO_RULES = [
  {
    name: 'slo',
    rules: [
      { record: 'job:shop_error_ratio:rate5m', expr: 'sum by (job) (rate(shop_errors_total[5m])) / sum by (job) (rate(shop_requests_total[5m]))' },
      { record: 'job:shop_error_ratio:rate1h', expr: 'sum by (job) (rate(shop_errors_total[1h])) / sum by (job) (rate(shop_requests_total[1h]))' },
    ],
  },
];
const FAST_BURN = 'job:shop_error_ratio:rate1h > (14.4 * 0.001) and job:shop_error_ratio:rate5m > (14.4 * 0.001)';

export const o3: ObsScenario[] = [
  {
    id: 'o3-symptoms',
    about: 'The CPU is very busy from 5m to 13m (a report job), but customers are fine. From 18m, 1 in 11 orders fails while the CPU is calm.',
    series: [
      { series: 'kedai:cpu_busy:ratio{instance="kedai-1"}', values: '0.3x4 0.95x8 0.35x16' },
      { series: 'http_requests_total{job="shop",code="200"}', values: '0+600x30' },
      { series: 'http_requests_total{job="shop",code="500"}', values: '0x17 60+60x12' },
    ],
    evalTime: '25m',
    metrics: ['kedai:cpu_busy:ratio', 'http_requests_total'],
    verify: [
      { expr: 'kedai:cpu_busy:ratio', at: ['10m', '25m'] },
      { expr: 'kedai:cpu_busy:ratio > 0.9', at: ['10m', '25m'] },
      { expr: ERROR_RATIO, at: ['10m', '25m'] },
      { expr: `${ERROR_RATIO} > 0.05`, at: ['10m', '25m'] },
      { alert: { alert: 'CpuBusy', expr: 'kedai:cpu_busy:ratio > 0.9', for: '2m', labels: { severity: 'page' } }, at: ['6m', '8m', '10m', '25m'] },
      {
        alert: { alert: 'OrdersFailing', expr: `${ERROR_RATIO} > 0.05`, for: '2m', labels: { severity: 'page' }, annotations: { summary: '{{ $value | humanizePercentage }} of orders fail' } },
        at: ['10m', '20m', '22m', '25m'],
      },
    ],
  },
  {
    id: 'o3-fast-burn',
    about: 'An SLO of 99.9%. Errors are 0.05%, with a 4-minute 5% spike at 20m, then 5% from 61m to 90m (a fast burn), then 0.05% again.',
    series: [
      { series: 'shop_requests_total{job="shop"}', values: '0+1000x120' },
      { series: 'shop_errors_total{job="shop"}', values: '0+0.5x19 59.5+50x3 210+0.5x36 278+50x29 1728.5+0.5x29' },
    ],
    rules: SLO_RULES,
    evalTime: '80m',
    metrics: ['shop_requests_total', 'shop_errors_total', 'job:shop_error_ratio:rate5m', 'job:shop_error_ratio:rate1h'],
    verify: [
      { expr: 'job:shop_error_ratio:rate5m', at: ['22m', '25m', '50m', '80m', '100m'] },
      { expr: 'job:shop_error_ratio:rate1h', at: ['25m', '50m', '80m', '100m'] },
      { expr: 'job:shop_error_ratio:rate1h / 0.001', at: ['50m', '80m', '100m'] },
      { expr: 'job:shop_error_ratio:rate5m / 0.001', at: ['80m', '100m'] },
      { expr: 'job:shop_error_ratio:rate1h > (14.4 * 0.001)', at: ['80m', '100m'] },
      { alert: { alert: 'FastBurn', expr: FAST_BURN, for: '2m', labels: { severity: 'page' } }, at: ['22m', '25m', '50m', '70m', '80m', '100m'] },
      { alert: { alert: 'FastBurnLongOnly', expr: 'job:shop_error_ratio:rate1h > (14.4 * 0.001)', for: '2m' }, at: ['25m', '80m', '100m'] },
      { alert: { alert: 'FastBurnShortOnly', expr: 'job:shop_error_ratio:rate5m > (14.4 * 0.001)', for: '2m' }, at: ['22m', '25m', '80m', '100m'] },
      { alert: { alert: 'OverSlo', expr: 'job:shop_error_ratio:rate5m > 0.001', for: '2m' }, at: ['25m', '50m', '80m', '100m'] },
    ],
  },
  {
    id: 'o3-runbook',
    about: 'The orders queue at the nasi lemak stall grows past 50 from 8m and stays there.',
    series: [{ series: 'kedai_queue_length{stall="nasi-lemak"}', values: '5 8 12 10 9 14 20 35 55 60 64 70 72 75 78 80 82 85 86 88 90' }],
    evalTime: '15m',
    metrics: ['kedai_queue_length'],
    verify: [
      { expr: 'kedai_queue_length > 50', at: ['7m', '15m'] },
      {
        alert: {
          alert: 'QueueTooLong',
          expr: 'kedai_queue_length > 50',
          for: '3m',
          labels: { severity: 'ticket' },
          annotations: { summary: 'Queue at {{ $labels.stall }} is {{ $value }}', runbook_url: 'https://wiki.example.com/runbooks/queue-too-long' },
        },
        at: ['9m', '11m', '15m'],
      },
    ],
  },
];
