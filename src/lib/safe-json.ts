// JSON for a <script type="application/json"> block: "<" becomes \u003c, so text like
// "</script>" inside the data can never end the block early (no HTML injection).
export function safeJson(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
