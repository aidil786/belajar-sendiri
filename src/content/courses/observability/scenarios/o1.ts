// World O1 "The Control Room": Kedai Kancil's lunch rush, as the control room screens see it.
// Series use promtool's input_series notation ('20+1x20' = 20, 21 … 40; one value per minute).
// O1 teaches no PromQL yet: lessons type metric names, one division and one comparison.
// Every `verify` entry is checked against the real promtool (npm run verify:promql).
import type { ObsScenario } from '~/engine/promql-sim';

/** The lunch rush (0–30m). The queue fills first (from 10m), then checkout slows (18m) and fails (19m). */
const LUNCH_RUSH = [
  // Traffic: orders per minute, up to 40 at 20m, then calmer.
  { series: 'kedai_orders_per_minute', values: '20+1x20 39-1x9' },
  // Latency: how long a checkout takes (seconds).
  { series: 'kedai_checkout_seconds', values: '0.3x17 0.9 1.6 2.4 2.8x9' },
  // Errors: the share of checkouts that fail (0.06 = 6%).
  { series: 'kedai_checkout_errors_ratio', values: '0x18 0.01 0.03 0.06x9' },
  // Saturation: orders waiting in the queue.
  { series: 'kedai_queue_orders', values: '2x9 4 7 11 16 22 28 34 38x13' },
  // USE for the stove: how busy it is (1 = busy all the time).
  { series: 'kedai_stove_busy_ratio', values: '0.5x9 0.6 0.7 0.8 0.9 1x16' },
];

export const o1: ObsScenario[] = [
  {
    id: 'o1-lunch-rush',
    about: 'The lunch rush on five screens: traffic, latency, errors, a filling queue and a busy stove. Trouble starts at 10m.',
    series: LUNCH_RUSH,
    evalTime: '25m',
    metrics: ['kedai_orders_per_minute', 'kedai_checkout_seconds', 'kedai_checkout_errors_ratio', 'kedai_queue_orders'],
    verify: [
      { expr: 'kedai_orders_per_minute', at: ['5m', '20m', '25m'] },
      { expr: 'kedai_checkout_seconds', at: ['5m', '25m'] },
      { expr: 'kedai_checkout_errors_ratio', at: ['5m', '19m', '25m'] },
      { expr: 'kedai_queue_orders', at: ['5m', '12m', '25m'] },
      { expr: 'kedai_stove_busy_ratio', at: ['5m', '25m'] },
      { expr: 'kedai_queue_orders > 20', at: ['12m', '15m', '25m'] },
      { expr: 'kedai_checkout_errors_ratio > 0.02', at: ['19m', '25m'] },
      { expr: 'kedai_checkout_errors_ratio * 100', at: ['25m'] },
      {
        alert: { alert: 'CheckoutFailing', expr: 'kedai_checkout_errors_ratio > 0.02', for: '5m', labels: { severity: 'page' } },
        at: ['20m', '24m', '25m', '30m'],
      },
      {
        alert: { alert: 'CheckoutFailingNow', expr: 'kedai_checkout_errors_ratio > 0.02' },
        at: ['19m', '20m'],
      },
      {
        alert: { alert: 'StoveBusy', expr: 'kedai_stove_busy_ratio > 0.8', for: '5m', labels: { severity: 'page' } },
        at: ['13m', '18m'],
      },
    ],
  },
  {
    id: 'o1-checkout-slo',
    about: 'An hour of checkouts: 2000 a minute. 1 fails a minute (0.05%) until 40m, then 20 a minute (1%): an outage.',
    series: [
      { series: 'kedai_checkout_total', values: '0+2000x60' },
      { series: 'kedai_checkout_good_total', values: '0+1999x40 81940+1980x19' },
    ],
    evalTime: '30m',
    metrics: ['kedai_checkout_total', 'kedai_checkout_good_total'],
    verify: [
      { expr: 'kedai_checkout_total', at: ['30m', '60m'] },
      { expr: 'kedai_checkout_good_total', at: ['30m', '60m'] },
      { expr: 'kedai_checkout_good_total / kedai_checkout_total', at: ['30m', '60m'] },
      { expr: '1 - kedai_checkout_good_total / kedai_checkout_total', at: ['30m', '60m'] },
      { expr: 'kedai_checkout_total - kedai_checkout_good_total', at: ['30m', '60m'] },
      { expr: '(kedai_checkout_total - kedai_checkout_good_total) / (kedai_checkout_total * 0.001)', at: ['30m', '60m'] },
      { expr: 'kedai_checkout_good_total / kedai_checkout_total < 0.999', at: ['30m', '60m'] },
    ],
  },
];
