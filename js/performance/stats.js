/**
 * Small, allocation-light statistics helpers used by the performance
 * qualification code. Inputs are copied before sorting, so callers can keep
 * their rolling sample buffers intact.
 */

function finiteSamples(values) {
  if (values == null) return [];
  return Array.from(values, Number).filter(Number.isFinite);
}

function sortedSamples(values) {
  return finiteSamples(values).sort((left, right) => left - right);
}

export function median(values) {
  const sorted = sortedSamples(values);
  if (sorted.length === 0) return Number.NaN;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/**
 * Return a nearest-rank percentile. `p` is a fraction in [0, 1]. The first
 * element is returned for p=0, and the last element for p=1.
 */
export function percentileNearestRank(values, p) {
  const sorted = sortedSamples(values);
  if (sorted.length === 0) return Number.NaN;
  const requested = Number(p);
  const fraction = Number.isFinite(requested)
    ? Math.min(1, Math.max(0, requested))
    : 0.5;
  const rank = Math.max(1, Math.ceil(fraction * sorted.length));
  return sorted[rank - 1];
}

export const nearestRankPercentile = percentileNearestRank;

export function mad(values, center = median(values)) {
  const numeric = finiteSamples(values);
  if (numeric.length === 0 || !Number.isFinite(center)) return Number.NaN;
  return median(numeric.map(value => Math.abs(value - center)));
}

export function summarize(values) {
  const sorted = sortedSamples(values);
  if (sorted.length === 0) {
    return {
      count: 0,
      min: Number.NaN,
      max: Number.NaN,
      median: Number.NaN,
      mad: Number.NaN,
      p50: Number.NaN,
      p95: Number.NaN,
      p99: Number.NaN,
      sum: 0,
    };
  }

  const middle = Math.floor(sorted.length / 2);
  const center = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  const deviations = sorted.map(value => Math.abs(value - center)).sort((left, right) => left - right);
  const deviationMiddle = Math.floor(deviations.length / 2);
  const medianDeviation = deviations.length % 2 === 0
    ? (deviations[deviationMiddle - 1] + deviations[deviationMiddle]) / 2
    : deviations[deviationMiddle];

  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median: center,
    mad: medianDeviation,
    p50: percentileFromSorted(sorted, 0.5),
    p95: percentileFromSorted(sorted, 0.95),
    p99: percentileFromSorted(sorted, 0.99),
    sum: sorted.reduce((total, value) => total + value, 0),
  };
}

function percentileFromSorted(sorted, p) {
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[rank - 1];
}
