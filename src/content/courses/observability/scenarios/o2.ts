// World O2 "Counters": Prometheus and PromQL on Kedai Kancil's numbers.
// Series use promtool's input_series notation ('0+30x30' = 0, 30, 60 … 900; one value per minute).
// Rates are kept to round binary numbers (0.25, 0.5, 0.75 per second) so sums never depend on
// the order promtool loads series in. Every `verify` entry is checked against the real promtool
// (npm run verify:promql).
import type { ObsScenario } from '~/engine/promql-sim';

/** Scrape targets: Prometheus itself, a node exporter, two shop instances. shop-2 goes down at 10m. */
const TARGETS = [
  { series: 'up{job="prometheus",instance="localhost:9090"}', values: '1x30' },
  { series: 'up{job="node",instance="kedai-1:9100"}', values: '1x30' },
  { series: 'up{job="shop",instance="shop-1:8080"}', values: '1x30' },
  { series: 'up{job="shop",instance="shop-2:8080"}', values: '1x9 0x20' },
  { series: 'scrape_samples_scraped{job="prometheus",instance="localhost:9090"}', values: '682x30' },
  { series: 'scrape_samples_scraped{job="node",instance="kedai-1:9100"}', values: '579x30' },
  { series: 'scrape_samples_scraped{job="shop",instance="shop-1:8080"}', values: '120x30' },
  { series: 'scrape_samples_scraped{job="shop",instance="shop-2:8080"}', values: '120x9 0x20' },
];

/** Orders per stall and outlet (counters). The Bangsar till restarts at 16m: its counters reset. */
const ORDERS = [
  { series: 'kedai_orders_total{stall="nasi-lemak",outlet="ss15"}', values: '0+30x30' },
  { series: 'kedai_orders_total{stall="nasi-lemak",outlet="bangsar"}', values: '0+15x15 0+15x14' },
  { series: 'kedai_orders_total{stall="roti-canai",outlet="ss15"}', values: '0+45x30' },
  { series: 'kedai_orders_total{stall="roti-canai",outlet="bangsar"}', values: '0+15x15 0+15x14' },
  { series: 'kedai_orders_total{stall="cendol",outlet="ss15"}', values: '0+15x30' },
];

/** Customers waiting per stall (gauges: up and down). */
const WAITING = [
  { series: 'kedai_customers_waiting{stall="nasi-lemak"}', values: '2 3 5 8 6 4 3 5 9 12 10 7 5 4 3 3 4 6 8 7 5 4 3 2 2 3 4 3 2 2 1' },
  { series: 'kedai_customers_waiting{stall="roti-canai"}', values: '1 1 2 3 3 2 2 1 1 2 4 6 5 3 2 1 1 2 2 3 2 2 1 1 1 2 2 1 1 1 0' },
];

/** The web shop's requests by instance and status code: 13 per second, 0.5 of them 500s. */
const HTTP = [
  { series: 'http_requests_total{job="shop",instance="shop-1",code="200"}', values: '0+240x30' },
  { series: 'http_requests_total{job="shop",instance="shop-1",code="500"}', values: '0+15x30' },
  { series: 'http_requests_total{job="shop",instance="shop-2",code="200"}', values: '0+480x30' },
  { series: 'http_requests_total{job="shop",instance="shop-2",code="500"}', values: '0+15x30' },
  { series: 'http_requests_total{job="shop",instance="shop-2",code="404"}', values: '0+30x30' },
];

/** Checkout time as a classic histogram. shop-1 gets slow after 10m; shop-2 stays quick. */
const CHECKOUT = [
  { series: 'kedai_checkout_duration_seconds_bucket{instance="shop-1",le="0.1"}', values: '0+60x10 612+12x19' },
  { series: 'kedai_checkout_duration_seconds_bucket{instance="shop-1",le="0.25"}', values: '0+100x10 1030+30x19' },
  { series: 'kedai_checkout_duration_seconds_bucket{instance="shop-1",le="0.5"}', values: '0+114x10 1200+60x19' },
  { series: 'kedai_checkout_duration_seconds_bucket{instance="shop-1",le="1"}', values: '0+118x10 1276+96x19' },
  { series: 'kedai_checkout_duration_seconds_bucket{instance="shop-1",le="2.5"}', values: '0+120x10 1317+117x19' },
  { series: 'kedai_checkout_duration_seconds_bucket{instance="shop-1",le="+Inf"}', values: '0+120x10 1320+120x19' },
  { series: 'kedai_checkout_duration_seconds_sum{instance="shop-1"}', values: '0+18x10 258+78x19' },
  { series: 'kedai_checkout_duration_seconds_count{instance="shop-1"}', values: '0+120x10 1320+120x19' },
  { series: 'kedai_checkout_duration_seconds_bucket{instance="shop-2",le="0.1"}', values: '0+72x30' },
  { series: 'kedai_checkout_duration_seconds_bucket{instance="shop-2",le="0.25"}', values: '0+108x30' },
  { series: 'kedai_checkout_duration_seconds_bucket{instance="shop-2",le="0.5"}', values: '0+117x30' },
  { series: 'kedai_checkout_duration_seconds_bucket{instance="shop-2",le="1"}', values: '0+120x30' },
  { series: 'kedai_checkout_duration_seconds_bucket{instance="shop-2",le="2.5"}', values: '0+120x30' },
  { series: 'kedai_checkout_duration_seconds_bucket{instance="shop-2",le="+Inf"}', values: '0+120x30' },
  { series: 'kedai_checkout_duration_seconds_sum{instance="shop-2"}', values: '0+15x30' },
  { series: 'kedai_checkout_duration_seconds_count{instance="shop-2"}', values: '0+120x30' },
];

const RATE = 'rate(http_requests_total[5m])';
const P95 = 'histogram_quantile(0.95, sum by (le) (rate(kedai_checkout_duration_seconds_bucket[5m])))';

export const o2: ObsScenario[] = [
  {
    id: 'o2-targets',
    about: 'Four scrape targets and their up series. shop-2 stops answering at 10m.',
    series: TARGETS,
    evalTime: '12m',
    metrics: ['up', 'scrape_samples_scraped'],
    verify: [
      { expr: 'up', at: ['5m', '12m'] },
      { expr: 'up == 0', at: ['5m', '12m'] },
      { expr: 'up{job="shop"}', at: ['12m'] },
      { expr: 'count(up)', at: ['12m'] },
      { expr: 'sum(up)', at: ['12m'] },
      { expr: 'scrape_samples_scraped', at: ['12m'] },
      { expr: 'sum(scrape_samples_scraped)', at: ['5m', '12m'] },
    ],
  },
  {
    id: 'o2-machines',
    about: 'Two machines seen by node exporter, and two shop pages probed by blackbox. The home page fails its probe from 10m.',
    series: [
      { series: 'node_memory_MemTotal_bytes{job="node",instance="kedai-1:9100"}', values: '8000000000x30' },
      { series: 'node_memory_MemTotal_bytes{job="node",instance="kedai-2:9100"}', values: '4000000000x30' },
      { series: 'node_memory_MemAvailable_bytes{job="node",instance="kedai-1:9100"}', values: '6000000000-100000000x30' },
      { series: 'node_memory_MemAvailable_bytes{job="node",instance="kedai-2:9100"}', values: '1000000000x30' },
      { series: 'node_filesystem_avail_bytes{job="node",instance="kedai-1:9100",mountpoint="/"}', values: '40000000000x30' },
      { series: 'node_filesystem_avail_bytes{job="node",instance="kedai-2:9100",mountpoint="/"}', values: '5000000000-100000000x30' },
      { series: 'node_load1{job="node",instance="kedai-1:9100"}', values: '0.4x30' },
      { series: 'node_load1{job="node",instance="kedai-2:9100"}', values: '0.5 0.9 1.6 2.4 3.1x26' },
      { series: 'up{job="node",instance="kedai-1:9100"}', values: '1x30' },
      { series: 'up{job="node",instance="kedai-2:9100"}', values: '1x30' },
      { series: 'up{job="blackbox",instance="https://kedai.example/"}', values: '1x30' },
      { series: 'up{job="blackbox",instance="https://kedai.example/menu"}', values: '1x30' },
      { series: 'probe_success{job="blackbox",instance="https://kedai.example/"}', values: '1x9 0x20' },
      { series: 'probe_success{job="blackbox",instance="https://kedai.example/menu"}', values: '1x30' },
      { series: 'probe_http_status_code{job="blackbox",instance="https://kedai.example/"}', values: '200x9 503x20' },
      { series: 'probe_http_status_code{job="blackbox",instance="https://kedai.example/menu"}', values: '200x30' },
    ],
    evalTime: '12m',
    metrics: ['node_memory_MemAvailable_bytes', 'node_memory_MemTotal_bytes', 'node_filesystem_avail_bytes', 'node_load1', 'probe_success', 'up'],
    verify: [
      { expr: 'node_memory_MemAvailable_bytes', at: ['12m'] },
      { expr: 'node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes', at: ['5m', '12m'] },
      { expr: 'node_memory_MemAvailable_bytes / 1e9', at: ['12m'] },
      { expr: 'node_filesystem_avail_bytes', at: ['12m'] },
      { expr: 'node_load1', at: ['2m', '12m'] },
      { expr: 'probe_success', at: ['5m', '12m'] },
      { expr: 'probe_success == 0', at: ['5m', '12m'] },
      { expr: 'probe_http_status_code', at: ['12m'] },
      { expr: 'up{job="blackbox"}', at: ['12m'] },
    ],
  },
  {
    id: 'o2-kedai',
    about: 'Kedai Kancil: orders per stall and outlet (Bangsar restarts at 16m), customers waiting, and web requests by code.',
    series: [...ORDERS, ...WAITING, ...HTTP],
    evalTime: '10m',
    metrics: ['kedai_orders_total', 'kedai_customers_waiting', 'http_requests_total'],
    verify: [
      { expr: 'kedai_orders_total', at: ['10m', '15m', '16m', '20m'] },
      { expr: 'kedai_customers_waiting', at: ['8m', '10m'] },
      { expr: 'kedai_orders_total{stall="nasi-lemak"}', at: ['10m'] },
      { expr: 'kedai_orders_total{outlet="ss15"}', at: ['10m'] },
      { expr: 'kedai_orders_total{stall!="cendol"}', at: ['10m'] },
      { expr: 'kedai_orders_total{stall=~"nasi-lemak|cendol"}', at: ['10m'] },
      { expr: 'count(kedai_orders_total)', at: ['10m'] },
      { expr: 'count by (outlet) (kedai_orders_total)', at: ['10m'] },
      { expr: 'max_over_time(kedai_customers_waiting[10m])', at: ['10m', '20m'] },
      { expr: 'avg_over_time(kedai_customers_waiting[10m])', at: ['10m'] },
      { expr: 'rate(kedai_orders_total[5m])', at: ['10m', '18m', '20m'] },
      { expr: 'rate(kedai_orders_total[5m]) * 60', at: ['10m', '18m'] },
      { expr: 'irate(kedai_orders_total[5m])', at: ['18m'] },
      { expr: 'kedai_orders_total{outlet="bangsar"}', at: ['15m', '16m'] },
      { expr: 'rate(kedai_orders_total{outlet="bangsar"}[5m])', at: ['16m', '18m'] },
      { expr: 'increase(kedai_orders_total[10m])', at: ['10m', '20m'] },
      { expr: 'increase(kedai_orders_total{stall="nasi-lemak"}[10m])', at: ['10m', '20m'] },
      { expr: 'resets(kedai_orders_total[30m])', at: ['30m'] },
      { expr: 'sum(rate(kedai_orders_total[5m]))', at: ['10m', '18m'] },
      { expr: 'sum by (stall) (rate(kedai_orders_total[5m]))', at: ['10m', '18m'] },
      { expr: 'sum by (outlet) (rate(kedai_orders_total[5m]))', at: ['10m'] },
      { expr: 'sum without (outlet) (rate(kedai_orders_total[5m]))', at: ['10m'] },
      { expr: 'sum by (stall) (rate(kedai_orders_total[5m])) * 60', at: ['10m'] },
      { expr: 'max by (stall) (rate(kedai_orders_total[5m]))', at: ['10m'] },
      { expr: 'topk(1, sum by (stall) (rate(kedai_orders_total[5m])))', at: ['10m'] },
      { expr: 'sum(kedai_customers_waiting)', at: ['10m'] },
      { expr: RATE, at: ['10m'] },
      { expr: `sum(${RATE})`, at: ['10m'] },
      { expr: `sum by (code) (${RATE})`, at: ['10m'] },
      { expr: `sum by (instance) (${RATE})`, at: ['10m'] },
      { expr: 'rate(http_requests_total{code=~"5.."}[5m])', at: ['10m'] },
      { expr: 'increase(http_requests_total{code="500"}[10m])', at: ['10m', '20m'] },
      { expr: 'sum(increase(http_requests_total{code="500"}[10m]))', at: ['20m'] },
      { expr: `sum(rate(http_requests_total{code=~"5.."}[5m])) / sum(${RATE})`, at: ['10m'] },
      // Mistakes the lessons show: promtool's own words.
      { expr: 'rate(kedai_orders_total)', at: ['10m'], error: true },
      { expr: 'max_over_time(kedai_customers_waiting)', at: ['10m'], error: true },
      { expr: 'sum by (stall) (kedai_orders_total[5m])', at: ['10m'], error: true },
      { expr: 'kedai_orders_total{stall=nasi-lemak}', at: ['10m'], error: true },
    ],
  },
  {
    id: 'o2-checkout',
    about: 'Checkout time as a classic histogram (buckets 0.1 to 2.5 s). shop-1 gets slow after 10m; shop-2 stays quick.',
    series: CHECKOUT,
    evalTime: '20m',
    metrics: ['kedai_checkout_duration_seconds_bucket', 'kedai_checkout_duration_seconds_sum', 'kedai_checkout_duration_seconds_count'],
    verify: [
      { expr: 'kedai_checkout_duration_seconds_bucket{instance="shop-1"}', at: ['10m'] },
      { expr: 'rate(kedai_checkout_duration_seconds_bucket[5m])', at: ['20m'] },
      { expr: P95, at: ['8m', '20m'] },
      { expr: 'histogram_quantile(0.5, sum by (le) (rate(kedai_checkout_duration_seconds_bucket[5m])))', at: ['8m', '20m'] },
      { expr: 'histogram_quantile(0.95, sum by (le, instance) (rate(kedai_checkout_duration_seconds_bucket[5m])))', at: ['8m', '20m'] },
      { expr: 'histogram_quantile(0.95, rate(kedai_checkout_duration_seconds_bucket[5m]))', at: ['20m'] },
      { expr: 'histogram_quantile(0.95, sum by (instance) (rate(kedai_checkout_duration_seconds_bucket[5m])))', at: ['20m'] },
      { expr: 'sum(rate(kedai_checkout_duration_seconds_sum[5m])) / sum(rate(kedai_checkout_duration_seconds_count[5m]))', at: ['8m', '20m'] },
      { expr: 'rate(kedai_checkout_duration_seconds_sum[5m]) / rate(kedai_checkout_duration_seconds_count[5m])', at: ['20m'] },
      { expr: `${P95} > 1`, at: ['8m', '20m'] },
      { expr: 'sum(rate(kedai_checkout_duration_seconds_bucket{le="0.5"}[5m])) / sum(rate(kedai_checkout_duration_seconds_count[5m]))', at: ['8m', '20m'] },
    ],
  },
  {
    id: 'o2-rules',
    about: 'The Kedai orders and web requests, plus two recording rules that save the busy sums as new series.',
    series: [...ORDERS, ...HTTP],
    rules: [
      {
        name: 'kedai',
        rules: [
          { record: 'stall:kedai_orders:rate5m', expr: 'sum by (stall) (rate(kedai_orders_total[5m]))' },
          { record: 'job:http_requests:rate5m', expr: `sum by (job) (${RATE})` },
        ],
      },
    ],
    evalTime: '10m',
    metrics: ['kedai_orders_total', 'stall:kedai_orders:rate5m', 'http_requests_total', 'job:http_requests:rate5m'],
    verify: [
      { expr: 'stall:kedai_orders:rate5m', at: ['10m', '20m'] },
      { expr: 'stall:kedai_orders:rate5m{stall="cendol"}', at: ['10m'] },
      { expr: 'stall:kedai_orders:rate5m * 60', at: ['10m'] },
      { expr: 'sum(stall:kedai_orders:rate5m)', at: ['10m'] },
      { expr: 'job:http_requests:rate5m', at: ['10m'] },
      { expr: 'max_over_time(stall:kedai_orders:rate5m[10m])', at: ['20m'] },
    ],
  },
  {
    id: 'o2-boss',
    about: 'Boss day at Kedai Kancil: targets (shop-2 down from 10m), orders, web requests and checkout time together.',
    series: [...TARGETS, ...ORDERS, ...HTTP, ...CHECKOUT],
    evalTime: '28m',
    metrics: ['up', 'kedai_orders_total', 'http_requests_total', 'kedai_checkout_duration_seconds_bucket'],
    verify: [
      { expr: 'up == 0', at: ['28m'] },
      { expr: 'up', at: ['28m'] },
      { expr: 'sum by (stall) (rate(kedai_orders_total[5m])) * 60', at: ['28m'] },
      { expr: 'sum by (stall) (rate(kedai_orders_total[5m]))', at: ['28m'] },
      { expr: `sum(rate(http_requests_total{code=~"5.."}[5m])) / sum(${RATE})`, at: ['28m'] },
      { expr: `sum(rate(http_requests_total{code="500"}[5m])) / sum(${RATE})`, at: ['28m'] },
      { expr: P95, at: ['28m'] },
      { expr: 'sum(increase(kedai_orders_total[10m]))', at: ['28m'] },
      { expr: 'sum by (outlet) (increase(kedai_orders_total[10m]))', at: ['28m'] },
      { expr: 'increase(kedai_orders_total[10m])', at: ['28m'] },
    ],
  },
];
