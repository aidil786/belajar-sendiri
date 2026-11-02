// World O4 "The Diary & One Order": logs, traces and one slow order.
// Most O4 lessons teach with the generic games (logs, spans and configs are not PromQL). These
// scenarios hold the metrics side: OpenTelemetry's HTTP server histogram, as Prometheus stores it
// (http.server.request.duration → http_server_request_duration_seconds; service.name → job).
// Every `verify` entry is checked against the real promtool 3.13 (npm run verify:promql).
import type { InputSeries, ObsScenario } from '~/engine/promql-sim';

const LE = ['0.1', '0.25', '0.5', '1', '2.5', '+Inf'];

/** A classic histogram per job: requests per minute in each bucket, before and from 10m. */
function histogram(job: string, before: number[], after: number[]): InputSeries[] {
  return LE.map((le, i) => {
    const b = before[i]!;
    const a = after[i]!;
    return { series: `http_server_request_duration_seconds_bucket{job="${job}",le="${le}"}`, values: `0+${b}x9 ${9 * b + a}+${a}x10` };
  });
}

const P95 = 'histogram_quantile(0.95, sum by (le, job) (rate(http_server_request_duration_seconds_bucket[5m])))';

export const o4: ObsScenario[] = [
  {
    id: 'o4-slow-step',
    about: 'Three services of one order: web, api and pay. From 10m the pay service gets slow, and the api waits for it.',
    series: [
      ...histogram('kedai-web', [540, 590, 598, 600, 600, 600], [540, 590, 598, 600, 600, 600]),
      ...histogram('kedai-api', [500, 580, 597, 600, 600, 600], [300, 420, 480, 540, 594, 600]),
      ...histogram('kedai-pay', [550, 595, 600, 600, 600, 600], [100, 200, 300, 420, 590, 600]),
    ],
    evalTime: '18m',
    metrics: ['http_server_request_duration_seconds_bucket'],
    verify: [
      { expr: P95, at: ['8m', '18m'] },
      { expr: `topk(1, ${P95})`, at: ['18m'] },
      { expr: `${P95} > 1`, at: ['8m', '18m'] },
      { expr: 'histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{job="kedai-pay"}[5m])))', at: ['8m', '18m'] },
      { expr: 'histogram_quantile(0.5, sum by (le, job) (rate(http_server_request_duration_seconds_bucket[5m])))', at: ['18m'] },
      { expr: 'sum by (job) (rate(http_server_request_duration_seconds_bucket{le="+Inf"}[5m]))', at: ['18m'] },
      {
        alert: { alert: 'OrderStepSlow', expr: `${P95} > 1`, for: '2m', labels: { severity: 'ticket' }, annotations: { summary: '{{ $labels.job }} p95 is {{ $value | humanize }}s' } },
        at: ['8m', '12m', '18m'],
      },
    ],
  },
];
