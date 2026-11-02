// Kubernetes quantities ("500m", "1Gi", "2"), parsed like k8s.io/apimachinery's resource.ParseQuantity.

export const QUANTITY_MSG =
  "quantities must match the regular expression '^([+-]?[0-9.]+)([eEinumkKMGTP]*[-+]?[0-9]*)$'";

/** The value in base units (cores, bytes), or the API server's error text. */
export function parseQuantity(v: string | number): { value: number } | { error: string } {
  if (typeof v === 'number') return { value: v };
  const m = /^([+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+))([eEinumkKMGTP]*[-+]?[0-9]*)$/.exec(v);
  if (!m) return { error: QUANTITY_MSG };
  const num = Number(m[1]);
  const suffix = m[2]!;
  const bin: Record<string, number> = {
    Ki: 2 ** 10,
    Mi: 2 ** 20,
    Gi: 2 ** 30,
    Ti: 2 ** 40,
    Pi: 2 ** 50,
    Ei: 2 ** 60,
  };
  const dec: Record<string, number> = {
    '': 1,
    n: 1e-9,
    u: 1e-6,
    m: 1e-3,
    k: 1e3,
    M: 1e6,
    G: 1e9,
    T: 1e12,
    P: 1e15,
    E: 1e18,
  };
  if (suffix in bin) return { value: num * bin[suffix]! };
  if (suffix in dec) return { value: num * dec[suffix]! };
  const e = /^[eE]([-+]?[0-9]+)$/.exec(suffix);
  if (e) return { value: num * 10 ** Number(e[1]) };
  return { error: "unable to parse quantity's suffix" };
}
