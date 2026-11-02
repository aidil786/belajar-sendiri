// PromQL syntax tree (the subset this engine runs).
import type { ValueType } from './types';

export type MatchOp = '=' | '!=' | '=~' | '!~';

export interface Matcher {
  name: string;
  op: MatchOp;
  value: string;
}

interface Node {
  /** Start and end offsets in the query text (for error positions). */
  pos: number;
  end: number;
}

export interface NumberLiteral extends Node {
  type: 'number';
  value: number;
}

export interface StringLiteral extends Node {
  type: 'string';
  value: string;
}

export interface VectorSelector extends Node {
  type: 'vector';
  name?: string;
  matchers: Matcher[];
  /** offset in ms (may be negative). */
  offset: number;
  /** @ modifier: a time in ms, or the query's start / end. */
  at?: number | 'start' | 'end';
}

export interface MatrixSelector extends Node {
  type: 'matrix';
  vector: VectorSelector;
  /** Range in ms. */
  range: number;
}

export interface Call extends Node {
  type: 'call';
  func: string;
  args: Expr[];
}

export type AggregateOp = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'group' | 'topk' | 'bottomk' | 'quantile' | 'stddev' | 'stdvar';

export interface Aggregate extends Node {
  type: 'aggregate';
  op: AggregateOp;
  expr: Expr;
  param?: Expr;
  grouping: string[];
  without: boolean;
}

export type Card = 'one-to-one' | 'many-to-one' | 'one-to-many' | 'many-to-many';

export interface VectorMatching {
  card: Card;
  on: boolean;
  labels: string[];
  include: string[];
}

export type BinaryOp = '+' | '-' | '*' | '/' | '%' | '^' | 'atan2' | '==' | '!=' | '<' | '>' | '<=' | '>=' | 'and' | 'or' | 'unless';

export interface Binary extends Node {
  type: 'binary';
  op: BinaryOp;
  lhs: Expr;
  rhs: Expr;
  bool: boolean;
  matching: VectorMatching | null;
  /** Where the operator sits (error positions). */
  opPos: number;
}

export interface Unary extends Node {
  type: 'unary';
  op: '-' | '+';
  expr: Expr;
}

export interface Paren extends Node {
  type: 'paren';
  expr: Expr;
}

export type Expr = NumberLiteral | StringLiteral | VectorSelector | MatrixSelector | Call | Aggregate | Binary | Unary | Paren;

export const COMPARISON_OPS = new Set<BinaryOp>(['==', '!=', '<', '>', '<=', '>=']);
export const SET_OPS = new Set<BinaryOp>(['and', 'or', 'unless']);

/** Functions: argument types (the last ones optional when `optional` > 0; -1 = repeat the last). */
export interface FunctionDef {
  args: ValueType[];
  optional?: number;
  ret: ValueType;
}

const V: ValueType = 'vector';
const M: ValueType = 'matrix';
const S: ValueType = 'scalar';
const STR: ValueType = 'string';

export const FUNCTIONS: Record<string, FunctionDef> = {
  abs: { args: [V], ret: V },
  absent: { args: [V], ret: V },
  absent_over_time: { args: [M], ret: V },
  avg_over_time: { args: [M], ret: V },
  ceil: { args: [V], ret: V },
  changes: { args: [M], ret: V },
  clamp: { args: [V, S, S], ret: V },
  clamp_max: { args: [V, S], ret: V },
  clamp_min: { args: [V, S], ret: V },
  count_over_time: { args: [M], ret: V },
  delta: { args: [M], ret: V },
  deriv: { args: [M], ret: V },
  exp: { args: [V], ret: V },
  floor: { args: [V], ret: V },
  histogram_quantile: { args: [S, V], ret: V },
  idelta: { args: [M], ret: V },
  increase: { args: [M], ret: V },
  irate: { args: [M], ret: V },
  label_join: { args: [V, STR, STR, STR], optional: -1, ret: V },
  label_replace: { args: [V, STR, STR, STR, STR], ret: V },
  last_over_time: { args: [M], ret: V },
  ln: { args: [V], ret: V },
  log10: { args: [V], ret: V },
  log2: { args: [V], ret: V },
  max_over_time: { args: [M], ret: V },
  min_over_time: { args: [M], ret: V },
  predict_linear: { args: [M, S], ret: V },
  present_over_time: { args: [M], ret: V },
  quantile_over_time: { args: [S, M], ret: V },
  rate: { args: [M], ret: V },
  resets: { args: [M], ret: V },
  round: { args: [V, S], optional: 1, ret: V },
  scalar: { args: [V], ret: S },
  sgn: { args: [V], ret: V },
  sort: { args: [V], ret: V },
  sort_desc: { args: [V], ret: V },
  sqrt: { args: [V], ret: V },
  sum_over_time: { args: [M], ret: V },
  time: { args: [], ret: S },
  timestamp: { args: [V], ret: V },
  vector: { args: [S], ret: V },
};

export const AGGREGATORS = new Set<AggregateOp>(['sum', 'avg', 'min', 'max', 'count', 'group', 'topk', 'bottomk', 'quantile', 'stddev', 'stdvar']);
export const AGGREGATORS_WITH_PARAM = new Set<AggregateOp>(['topk', 'bottomk', 'quantile']);

/** The value type an expression evaluates to. */
export function typeOf(e: Expr): ValueType {
  switch (e.type) {
    case 'number':
      return 'scalar';
    case 'string':
      return 'string';
    case 'vector':
      return 'vector';
    case 'matrix':
      return 'matrix';
    case 'call':
      return FUNCTIONS[e.func]?.ret ?? 'vector';
    case 'aggregate':
      return 'vector';
    case 'binary':
      return typeOf(e.lhs) === 'scalar' && typeOf(e.rhs) === 'scalar' ? 'scalar' : 'vector';
    case 'unary':
    case 'paren':
      return typeOf(e.expr);
  }
}

/** Every function and aggregation name used in an expression (for goals like usesFunction). */
export function functionsIn(e: Expr, out = new Set<string>()): Set<string> {
  switch (e.type) {
    case 'call':
      out.add(e.func);
      e.args.forEach((a) => functionsIn(a, out));
      break;
    case 'aggregate':
      out.add(e.op);
      functionsIn(e.expr, out);
      if (e.param) functionsIn(e.param, out);
      break;
    case 'binary':
      functionsIn(e.lhs, out);
      functionsIn(e.rhs, out);
      break;
    case 'unary':
    case 'paren':
      functionsIn(e.expr, out);
      break;
    default:
      break;
  }
  return out;
}

/** Metric names an expression reads (selectors with a name). */
export function metricsIn(e: Expr, out = new Set<string>()): Set<string> {
  switch (e.type) {
    case 'vector':
      if (e.name) out.add(e.name);
      for (const m of e.matchers) if (m.name === '__name__' && m.op === '=') out.add(m.value);
      break;
    case 'matrix':
      metricsIn(e.vector, out);
      break;
    case 'call':
      e.args.forEach((a) => metricsIn(a, out));
      break;
    case 'aggregate':
      metricsIn(e.expr, out);
      if (e.param) metricsIn(e.param, out);
      break;
    case 'binary':
      metricsIn(e.lhs, out);
      metricsIn(e.rhs, out);
      break;
    case 'unary':
    case 'paren':
      metricsIn(e.expr, out);
      break;
    default:
      break;
  }
  return out;
}
