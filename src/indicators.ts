// Technical indicators. Each returns an array aligned with the input (NaN until warmed up).

/** Simple moving average of the last n values, including i. */
export function sma(xs: number[], n: number): number[] {
  const out = new Array<number>(xs.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += xs[i];
    if (i >= n) sum -= xs[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** Highest of the previous n values (excluding i). */
export function prevMax(xs: number[], n: number): number[] {
  return xs.map((_, i) => (i < n ? NaN : Math.max(...xs.slice(i - n, i))));
}

/** Lowest of the previous n values (excluding i). */
export function prevMin(xs: number[], n: number): number[] {
  return xs.map((_, i) => (i < n ? NaN : Math.min(...xs.slice(i - n, i))));
}
