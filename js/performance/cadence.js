import { summarize } from './stats.js';

export const DEFAULT_REFRESH_RATES = Object.freeze([
  30, 60, 75, 100, 120, 144, 165, 180, 200, 240,
]);

const DEFAULTS = Object.freeze({
  minSamples: 60,
  minRetainedSamples: 45,
  minDurationMs: 1000,
  maxDurationMs: 2500,
  // RAF timestamps are commonly quantized to whole milliseconds. A one-ms
  // floor keeps the adjacent 4/5 and 6/7 ms buckets together while MAD still
  // rejects materially longer stalls.
  jitterFloorMs: 1,
  outlierMadMultiplier: 3,
  maxMadRatio: 0.05,
  snapTolerance: 0.04,
});

function positiveIntervals(values) {
  if (values == null) return [];
  return Array.from(values, Number).filter(value => Number.isFinite(value) && value > 0);
}

function nearestRate(hertz, rates) {
  let nearest = Number.NaN;
  let error = Number.POSITIVE_INFINITY;
  for (const candidate of rates) {
    if (!Number.isFinite(candidate) || candidate <= 0) continue;
    const candidateError = Math.abs(hertz - candidate);
    if (candidateError < error) {
      nearest = candidate;
      error = candidateError;
    }
  }
  return nearest;
}

/**
 * Estimate display cadence from RAF intervals. Outliers are removed once
 * using the raw median and MAD, keeping actual long stalls out of cadence
 * identification while leaving them available to the runtime's frame stats.
 */
export function estimateCadence(intervals, options = {}) {
  const config = { ...DEFAULTS, ...options };
  const input = Array.isArray(intervals) ? intervals : Array.from(intervals ?? []);
  const valid = positiveIntervals(input);
  const raw = summarize(valid);
  const threshold = Number.isFinite(raw.mad)
    ? Math.max(config.jitterFloorMs, config.outlierMadMultiplier * raw.mad)
    : Number.POSITIVE_INFINITY;
  const retained = valid.filter(value => Math.abs(value - raw.median) <= threshold);
  const filtered = summarize(retained);
  const durationMs = Number.isFinite(config.durationMs)
    ? Math.max(0, config.durationMs)
    : raw.sum;
  const rawMadRatio = Number.isFinite(raw.median) && raw.median > 0
    ? raw.mad / raw.median
    : Number.POSITIVE_INFINITY;
  const retainedMadRatio = Number.isFinite(filtered.median) && filtered.median > 0
    ? filtered.mad / filtered.median
    : Number.POSITIVE_INFINITY;
  const stable = valid.length >= config.minSamples
    && retained.length >= config.minRetainedSamples
    && durationMs >= config.minDurationMs
    && rawMadRatio <= config.maxMadRatio;
  // A quantized high-refresh stream can have a median interval on one side of
  // the true cadence (for example, mostly 4 ms with occasional 5 ms samples).
  // Use the retained elapsed duration so those samples contribute their actual
  // time instead of biasing the estimate toward the shorter bucket.
  const observedHz = retained.length > 0 && Number.isFinite(filtered.sum) && filtered.sum > 0
    ? retained.length * 1000 / filtered.sum
    : Number.NaN;
  const rates = (config.snapRates ?? DEFAULT_REFRESH_RATES)
    .map(Number)
    .filter(rate => Number.isFinite(rate) && rate > 0);
  const snappedCandidate = nearestRate(observedHz, rates);
  const snapErrorRatio = Number.isFinite(snappedCandidate) && snappedCandidate > 0
    ? Math.abs(observedHz - snappedCandidate) / snappedCandidate
    : Number.POSITIVE_INFINITY;
  const snapped = stable && Number.isFinite(snappedCandidate) && snapErrorRatio <= config.snapTolerance;
  const targetHz = snapped ? snappedCandidate : observedHz;

  return {
    observedHz,
    snappedHz: snapped ? snappedCandidate : Number.NaN,
    targetHz,
    snapped,
    confidence: stable ? 'high' : retained.length >= config.minRetainedSamples ? 'provisional' : 'low',
    stable,
    durationMs,
    sampleCount: valid.length,
    retainedCount: retained.length,
    rejectedCount: valid.length - retained.length,
    invalidCount: input.length - valid.length,
    rawMedianMs: raw.median,
    rawMadMs: raw.mad,
    medianIntervalMs: filtered.median,
    madMs: filtered.mad,
    madRatio: rawMadRatio,
    rawMadRatio,
    retainedMadRatio,
    retainedDurationMs: filtered.sum,
    outlierThresholdMs: threshold,
    snapErrorRatio,
    raw: {
      medianMs: raw.median,
      madMs: raw.mad,
      p95Ms: raw.p95,
      p99Ms: raw.p99,
    },
  };
}

/**
 * Start a small RAF-only cadence probe. The promise resolves after a stable
 * minimum sample has been collected or after the bounded maximum duration.
 * `requestFrame` and `now` are injectable so the estimator remains testable.
 */
export function startCadenceProbe(options = {}) {
  const requestFrame = options.requestFrame
    ?? globalThis.requestAnimationFrame?.bind(globalThis);
  const now = options.now
    ?? globalThis.performance?.now?.bind(globalThis.performance)
    ?? (() => Date.now());
  if (typeof requestFrame !== 'function') {
    throw new TypeError('A requestAnimationFrame function is required for cadence probing.');
  }

  let cancelled = false;
  let finished = false;
  let frameHandle = null;
  const intervals = [];
  const startedAt = Number(now());
  let previousTimestamp = null;
  let resolveProbe;

  const promise = new Promise(resolve => {
    resolveProbe = resolve;
  });

  const finish = (timestamp, cancelledProbe = false) => {
    if (finished) return;
    finished = true;
    const durationMs = Math.max(0, Number(timestamp) - startedAt);
    resolveProbe({
      ...estimateCadence(intervals, { ...options, durationMs }),
      cancelled: cancelledProbe,
    });
  };

  const frame = timestampValue => {
    if (finished) return;
    const timestamp = Number.isFinite(Number(timestampValue)) ? Number(timestampValue) : Number(now());
    if (previousTimestamp !== null) {
      const interval = timestamp - previousTimestamp;
      if (interval > 0 && Number.isFinite(interval)) intervals.push(interval);
    }
    previousTimestamp = timestamp;
    options.onFrame?.(timestamp, intervals.length);

    const durationMs = Math.max(0, timestamp - startedAt);
    const estimate = estimateCadence(intervals, { ...options, durationMs });
    const minimumComplete = intervals.length >= (options.minSamples ?? DEFAULTS.minSamples)
      && durationMs >= (options.minDurationMs ?? DEFAULTS.minDurationMs);
    const maximumReached = durationMs >= (options.maxDurationMs ?? DEFAULTS.maxDurationMs);
    if ((minimumComplete && estimate.stable) || maximumReached) {
      finish(timestamp);
      return;
    }
    frameHandle = requestFrame(frame);
  };

  frameHandle = requestFrame(frame);

  return {
    promise,
    cancel() {
      if (finished) return;
      cancelled = true;
      if (typeof options.cancelFrame === 'function' && frameHandle !== null) {
        options.cancelFrame(frameHandle);
      }
      finish(Number(now()), cancelled);
    },
  };
}

export function createCadenceProbe(options = {}) {
  return startCadenceProbe(options).promise;
}
