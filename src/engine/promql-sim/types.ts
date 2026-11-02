// Types shared by the PromQL engine. Times are milliseconds since time 0 (the scenario start),
// like Prometheus timestamps; durations are milliseconds too.

/** A label set. Keys are label names (`__name__` is the metric name). */
export type Labels = Readonly<Record<string, string>>;

/** One stored sample. `stale` is Prometheus's staleness marker (a special NaN). */
export interface Point {
  t: number;
  v: number;
  stale?: boolean;
}

export interface StoredSeries {
  labels: Labels;
  /** Canonical key of the label set (see labelsKey). */
  key: string;
  /**
   * Creation order. Prometheus returns series in the order they were created (not sorted), and
   * that order decides float sums, topk ties and which duplicate an error names.
   */
  seq: number[];
  /** Sorted by time, one sample per timestamp. */
  points: Point[];
}

/** One element of an instant vector. `t` is the sample's own time (for timestamp()). */
export interface InstantSample {
  labels: Labels;
  value: number;
  t?: number;
}

export interface RangeSeries {
  labels: Labels;
  points: { t: number; v: number }[];
}

export type Value =
  | { type: 'scalar'; value: number }
  | { type: 'string'; value: string }
  | { type: 'vector'; samples: InstantSample[] }
  | { type: 'matrix'; series: RangeSeries[] };

export type ValueType = Value['type'];

/**
 * A PromQL problem. `message` is the text Prometheus 3 prints (parse errors start with
 * "1:6: parse error: …"); `key` + `params` pick the plain explanation (i18n `promql.err.<key>`).
 */
export class PromQLError extends Error {
  readonly key: string;
  readonly params: Record<string, string | number>;
  readonly pos?: number;
  constructor(message: string, key = 'generic', params: Record<string, string | number> = {}, pos?: number) {
    super(message);
    this.name = 'PromQLError';
    this.key = key;
    this.params = params;
    this.pos = pos;
  }
}
