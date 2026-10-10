import { QUALITY_STEPS } from './profiles.js';

export { QUALITY_STEPS } from './profiles.js';

const DEFAULTS = Object.freeze({
  minHz: 30,
  overloadLoad: 0.92,
  comfortLoad: 0.70,
  overloadDelivery: 0.88,
  overloadLateFraction: 0.06,
  minDeliveryFailures: 6,
  deliveryOverloadWindows: 3,
  deliveryOverloadMs: 6000,
  comfortDelivery: 0.99,
  comfortLateFraction: 0.005,
  promotionCooldownMs: 10_000,
  failedCadenceRetryMs: 60_000,
  stablePromotionMs: 15_000,
  stablePromotionWindows: 5,
  trialTimeoutMs: 12_000,
});
const EPSILON = 1e-6;

export function getCadenceFallbacks(nativeHz, minHz = DEFAULTS.minHz) {
  const native = Number(nativeHz);
  const minimum = Math.max(0, Number(minHz));
  if (!Number.isFinite(native) || native <= 0) return [];
  if (native < minimum) return [native];
  const rates = [native];
  for (let divisor = 2; divisor <= 10_000; divisor++) {
    const rate = native / divisor;
    if (rate < minimum - EPSILON) break;
    rates.push(rate);
  }
  return rates;
}

/**
 * Return the single adaptive quality/cadence ladder used in both directions.
 *
 * The order is intentionally explicit: quality is reduced before cadence at
 * each rate, Q2 becomes available at the last rate that is still at least
 * 60Hz, and Q3 is reserved for the cadence floor.  A native rate below 60Hz
 * is already below the heavy-quality boundary, so it retains the historical
 * all-quality behavior at its floor.
 */
export function getAdaptiveCandidates(nativeHz, minHz = DEFAULTS.minHz) {
  const rates = getCadenceFallbacks(nativeHz, minHz);
  if (!rates.length) return [];
  const q2Start = Math.max(0, rates.findLastIndex(rate => rate >= 60 - EPSILON));
  const floorIndex = rates.length - 1;
  const candidates = [];
  rates.forEach((targetHz, index) => {
    candidates.push({ targetHz, qualityStep: 0 });
    candidates.push({ targetHz, qualityStep: 1 });
    if (index >= q2Start) candidates.push({ targetHz, qualityStep: 2 });
    if (index === floorIndex) candidates.push({ targetHz, qualityStep: 3 });
  });
  return candidates;
}

function near(left, right) {
  return Number.isFinite(left) && Number.isFinite(right)
    && Math.abs(left - right) <= Math.max(EPSILON, Math.abs(right) * 1e-5);
}
function finiteOr(value, fallback) {
  return value != null && Number.isFinite(Number(value)) ? Number(value) : fallback;
}
function directLoad(summary, key, targetHz) {
  const nested = summary?.[key];
  const load = nested?.load;
  const p95Ms = nested?.p95Ms ?? nested?.p95 ?? summary?.[`${key}P95Ms`] ?? summary?.[`${key}P95`];
  return finiteOr(load, finiteOr(p95Ms, NaN) * targetHz / 1000);
}
function gpuEvidence(summary) {
  const samples = finiteOr(summary.gpuSamples ?? summary.gpu?.samples, Infinity);
  const available = summary.gpuAvailable !== false
    && (summary.gpuAvailable === true
      || Number.isFinite(finiteOr(summary.gpuP95Ms ?? summary.gpu?.p95Ms ?? summary.gpu?.p95 ?? summary.gpuLoad, NaN)));
  return available && samples >= 20
    && finiteOr(summary.gpuValidFraction ?? summary.gpu?.validFraction, 1) >= 0.8;
}
function deliveryRatio(summary, targetHz) {
  const direct = finiteOr(summary.deliveryRatio ?? summary.deliveredRatio, NaN);
  if (Number.isFinite(direct)) return direct;
  const deliveredHz = finiteOr(summary.deliveredHz, NaN);
  if (Number.isFinite(deliveredHz)) return deliveredHz / targetHz;
  const count = finiteOr(summary.presentedFrames ?? summary.frameCount, NaN);
  const duration = finiteOr(summary.durationMs, NaN);
  return count >= 0 && duration > 0 ? count * 1000 / duration / targetHz : NaN;
}

export function classifyPerformanceWindow(summary = {}, options = {}) {
  const config = { ...DEFAULTS, ...options };
  const targetHz = finiteOr(summary.targetHz, finiteOr(options.targetHz, 60));
  const cpuLoad = finiteOr(summary.cpuLoad, directLoad(summary, 'cpu', targetHz));
  const hasGpu = gpuEvidence(summary);
  const gpuLoad = hasGpu ? finiteOr(summary.gpuLoad, directLoad(summary, 'gpu', targetHz)) : NaN;
  const lateCount = finiteOr(summary.lateCount ?? summary.lateFrames, NaN);
  const missedFrames = finiteOr(summary.missedFrames, NaN);
  const frameCount = finiteOr(summary.frameCount ?? summary.presentedFrames, NaN);
  const lateFraction = finiteOr(summary.lateFraction ?? summary.lateRate,
    frameCount > 0 ? lateCount / frameCount : NaN);
  const delivered = deliveryRatio(summary, targetHz);
  const cpuOverloaded = Number.isFinite(cpuLoad) && cpuLoad > config.overloadLoad;
  const gpuOverloaded = Number.isFinite(gpuLoad) && gpuLoad > config.overloadLoad;
  const poorDelivery = delivered < config.overloadDelivery && missedFrames >= config.minDeliveryFailures;
  const frequentLateFrames = lateFraction >= config.overloadLateFraction && lateCount >= config.minDeliveryFailures;
  const loadOverloaded = cpuOverloaded || gpuOverloaded;
  const deliveryOverloaded = poorDelivery || frequentLateFrames;
  const sustainable = Number.isFinite(cpuLoad) && cpuLoad < 0.8
    && (!hasGpu || (Number.isFinite(gpuLoad) && gpuLoad < 0.8))
    && Number.isFinite(delivered) && delivered >= 0.97
    && Number.isFinite(lateFraction) && lateFraction < 0.01;
  const promotionEligible = sustainable && cpuLoad <= config.comfortLoad
    && (!hasGpu || gpuLoad <= config.comfortLoad)
    && delivered >= config.comfortDelivery && lateFraction <= config.comfortLateFraction;
  return {
    targetHz, cpuLoad, gpuLoad, gpuAvailable: hasGpu,
    gpuValidFraction: finiteOr(summary.gpuValidFraction ?? summary.gpu?.validFraction, NaN),
    deliveredRatio: delivered, lateFraction, lateCount, missedFrames,
    loadOverloaded, deliveryOverloaded, overloaded: loadOverloaded || deliveryOverloaded,
    sustainable, comfortable: sustainable, promotionEligible,
    overloadCauses: [cpuOverloaded && 'cpu-p95', gpuOverloaded && 'gpu-p95',
      poorDelivery && 'delivery-deficit', frequentLateFrames && 'late-frames'].filter(Boolean),
    evidence: hasGpu ? 'cpu-gpu-delivery' : 'cpu-delivery-gpu-unavailable',
  };
}

export class AdaptiveController {
  constructor(options = {}) {
    this.config = { ...DEFAULTS, ...options };
    this.now = options.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
    this.nativeHz = finiteOr(options.nativeHz, 60);
    this.reset(options);
    for (const key of ['loadOverloadStreak', 'deliveryOverloadStreak', 'deliveryOverloadDurationMs',
      'stableDurationMs', 'stableWindowCount', 'lastTransitionAtMs', 'lastWindowEndMs']) {
      if (options[key] !== undefined) this[key] = options[key];
    }
    this.lastWindowKey = options.lastWindowKey ?? null;
    this.failedTrials = { ...options.failedTrials };
    this.pendingTrial = options.pendingTrial ? { ...options.pendingTrial } : null;
    this.lastAdaptiveDecision = options.lastAdaptiveDecision ? { ...options.lastAdaptiveDecision } : null;
  }

  reset(options = {}) {
    if (options.nativeHz !== undefined) this.nativeHz = finiteOr(options.nativeHz, this.nativeHz);
    this.cadenceRates = getCadenceFallbacks(this.nativeHz, this.config.minHz);
    if (!this.cadenceRates.length) this.cadenceRates = [this.nativeHz];
    this.adaptiveCandidates = getAdaptiveCandidates(this.nativeHz, this.config.minHz);
    if (!this.adaptiveCandidates.length) {
      this.adaptiveCandidates = [{ targetHz: this.nativeHz, qualityStep: 0 }];
    }
    this.heavyQualityBoundaryIndex = Math.max(0, this.cadenceRates.findLastIndex(rate => rate >= 60 - EPSILON));
    this.targetHz = finiteOr(options.targetHz, this.cadenceRates[0]);
    this.qualityStep = Math.max(0, Math.min(QUALITY_STEPS.length - 1, Math.round(finiteOr(options.qualityStep, 0))));
    this.clearEvidence();
    this.lastTransitionAtMs = -Infinity;
    this.failedTrials = {};
    this.pendingTrial = null;
    this.lastWindowKey = null;
    this.lastWindowEndMs = NaN;
    this.lastClassification = null;
    this.lastAdaptiveDecision = null;
    return this.snapshot();
  }

  requalify() {
    this.clearEvidence();
    this.pendingTrial = null;
    this.lastClassification = null;
    this.lastWindowKey = null;
    this.lastWindowEndMs = NaN;
    return this.snapshot();
  }

  clearEvidence() {
    this.loadOverloadStreak = this.deliveryOverloadStreak = this.deliveryOverloadDurationMs = 0;
    this.stableDurationMs = this.stableWindowCount = 0;
  }

  observe(summary = {}) {
    const atMs = finiteOr(summary.endMs ?? summary.timestampMs ?? summary.timeMs, Number(this.now()));
    if (!near(finiteOr(summary.targetHz, this.targetHz), this.targetHz)
      || Math.round(finiteOr(summary.qualityStep, this.qualityStep)) !== this.qualityStep) {
      return this.decision('configuration-mismatch', false);
    }
    if (summary.settled === false) return this.decision('trial-settling', false);
    if (!this.acceptWindow(summary, atMs)) return this.decision('overlapping-or-duplicate-window', false);
    const current = classifyPerformanceWindow(summary, { ...this.config, targetHz: this.targetHz });
    this.lastClassification = current;
    const durationMs = Math.max(0, finiteOr(summary.durationMs,
      finiteOr(summary.endMs, NaN) - finiteOr(summary.startMs, NaN)) || 0);
    this.loadOverloadStreak = current.loadOverloaded ? this.loadOverloadStreak + 1 : 0;
    this.deliveryOverloadStreak = current.deliveryOverloaded ? this.deliveryOverloadStreak + 1 : 0;
    this.deliveryOverloadDurationMs = current.deliveryOverloaded ? this.deliveryOverloadDurationMs + durationMs : 0;
    this.stableWindowCount = current.promotionEligible ? this.stableWindowCount + 1 : 0;
    this.stableDurationMs = current.promotionEligible ? this.stableDurationMs + durationMs : 0;
    this.lastWindowEvidence = {
      loadOverloadStreak: this.loadOverloadStreak,
      deliveryOverloadStreak: this.deliveryOverloadStreak,
      deliveryOverloadDurationMs: this.deliveryOverloadDurationMs,
      stableWindowCount: this.stableWindowCount,
      stableDurationMs: this.stableDurationMs,
    };
    const sustainedOverload = this.loadOverloadStreak >= 2
      || (this.deliveryOverloadStreak >= this.config.deliveryOverloadWindows
        && this.deliveryOverloadDurationMs >= this.config.deliveryOverloadMs);

    if (this.pendingTrial) {
      const trial = this.pendingTrial;
      trial.observedDurationMs += durationMs;
      trial.sustainableWindows = current.sustainable ? trial.sustainableWindows + 1 : 0;
      if (sustainedOverload) {
        if (trial.direction === 'promotion') return this.restoreTrial(atMs, current, 'failed');
        this.pendingTrial = null;
        return this.chooseDemotion(atMs, current);
      }
      if (trial.sustainableWindows >= 2) {
        this.pendingTrial = null;
        this.clearEvidence();
        return this.decision(`${trial.kind}-trial-accepted`, false, { classification: current, trial });
      }
      if (trial.observedDurationMs >= this.config.trialTimeoutMs) {
        if (trial.direction === 'promotion') return this.restoreTrial(atMs, current, 'inconclusive');
        this.pendingTrial = null;
        this.clearEvidence();
        return this.decision(`${trial.kind}-demotion-trial-inconclusive-kept`, false, { classification: current, trial });
      }
      return this.decision('trial-observing', false, { classification: current });
    }
    if (sustainedOverload) return this.chooseDemotion(atMs, current);
    if (this.canPromote(atMs, current)) {
      const promotion = this.choosePromotion(atMs, current);
      if (promotion) return promotion;
    }
    return this.decision('hold', false, { classification: current });
  }

  acceptWindow(summary, atMs) {
    const key = summary.windowId ?? summary.id ?? null;
    const startMs = finiteOr(summary.startMs, NaN);
    const endMs = finiteOr(summary.endMs, atMs);
    if (key !== null && key === this.lastWindowKey) return false;
    if (Number.isFinite(this.lastWindowEndMs)) {
      if (endMs <= this.lastWindowEndMs + EPSILON) return false;
      if (Number.isFinite(startMs) && startMs < this.lastWindowEndMs - EPSILON) return false;
      if (Number.isFinite(startMs) && startMs - this.lastWindowEndMs > Math.max(1, 2000 / this.targetHz)) {
        this.clearEvidence();
        if (this.pendingTrial) this.pendingTrial.sustainableWindows = 0;
      }
    }
    this.lastWindowKey = key;
    this.lastWindowEndMs = endMs;
    return true;
  }

  chooseDemotion(atMs, classification) {
    const index = this.findCandidateIndex(this.targetHz, this.qualityStep);
    const next = index >= 0 ? this.adaptiveCandidates[index + 1] : null;
    if (!next) return this.decision('overload-at-floor', false, { classification });
    const kind = near(next.targetHz, this.targetHz) ? 'quality' : 'cadence';
    const reason = kind === 'quality' ? 'overload-lower-quality' : 'overload-lower-rate';
    return this.transition(next.targetHz, next.qualityStep, reason, kind, 'demotion', atMs, classification);
  }

  canPromote(atMs, classification) {
    return classification.promotionEligible && this.stableWindowCount >= this.config.stablePromotionWindows
      && this.stableDurationMs >= this.config.stablePromotionMs
      && atMs - this.lastTransitionAtMs >= this.config.promotionCooldownMs;
  }

  choosePromotion(atMs, classification) {
    const index = this.findCandidateIndex(this.targetHz, this.qualityStep);
    const previous = index > 0 ? this.adaptiveCandidates[index - 1] : null;
    if (!previous) return null;
    // A failed adjacent candidate blocks this step until its own retry time;
    // recovery must never skip over it to a more ambitious pair.
    if (atMs < (this.failedTrials[this.trialKey(previous.targetHz, previous.qualityStep)] ?? -Infinity)) return null;
    const kind = near(previous.targetHz, this.targetHz) ? 'quality' : 'cadence';
    const reason = kind === 'quality' ? 'stable-raise-quality' : 'stable-raise-rate';
    return this.transition(previous.targetHz, previous.qualityStep, reason, kind, 'promotion', atMs, classification);
  }

  findCandidateIndex(targetHz, qualityStep) {
    return this.adaptiveCandidates.findIndex(candidate => near(candidate.targetHz, targetHz)
      && candidate.qualityStep === qualityStep);
  }

  trialKey(targetHz, qualityStep) { return `${targetHz}:${qualityStep}`; }

  restoreTrial(atMs, classification, outcome) {
    const trial = this.pendingTrial;
    this.failedTrials[this.trialKey(trial.targetHz, trial.qualityStep)] = atMs + this.config.failedCadenceRetryMs;
    this.pendingTrial = null;
    return this.transition(trial.fromTargetHz, trial.fromQualityStep,
      `${trial.kind}-trial-${outcome}-restore`, trial.kind, null, atMs, classification);
  }

  transition(targetHz, qualityStep, reason, kind, direction, atMs, classification) {
    const fromTargetHz = this.targetHz;
    const fromQualityStep = this.qualityStep;
    this.targetHz = targetHz;
    this.qualityStep = qualityStep;
    this.pendingTrial = direction ? {
      kind, direction, reason, fromTargetHz, fromQualityStep, targetHz, qualityStep,
      startedAtMs: atMs, observedDurationMs: 0, sustainableWindows: 0,
    } : null;
    this.lastTransitionAtMs = atMs;
    this.lastAdaptiveDecision = { reason, fromTargetHz, fromQualityStep, targetHz, qualityStep, atMs };
    this.clearEvidence();
    for (const [key, until] of Object.entries(this.failedTrials)) if (until <= atMs) delete this.failedTrials[key];
    return this.decision(reason, true, { classification, trial: this.pendingTrial });
  }

  snapshot() {
    return {
      nativeHz: this.nativeHz, targetHz: this.targetHz, qualityStep: this.qualityStep,
      adaptiveCandidates: this.adaptiveCandidates.map(candidate => ({ ...candidate })),
      state: this.pendingTrial ? `${this.pendingTrial.direction}-trial`
        : this.loadOverloadStreak || this.deliveryOverloadStreak ? 'overload-observed'
        : this.stableWindowCount ? 'headroom-observed' : 'observing',
      heavyQualityBoundaryHz: this.cadenceRates[this.heavyQualityBoundaryIndex],
      overloadStreak: Math.max(this.loadOverloadStreak, this.deliveryOverloadStreak),
      loadOverloadStreak: this.loadOverloadStreak, deliveryOverloadStreak: this.deliveryOverloadStreak,
      deliveryOverloadDurationMs: this.deliveryOverloadDurationMs,
      stableDurationMs: this.stableDurationMs, stableWindowCount: this.stableWindowCount,
      lastTransitionAtMs: this.lastTransitionAtMs, failedTrials: { ...this.failedTrials },
      pendingTrial: this.pendingTrial ? { ...this.pendingTrial } : null,
      lastAdaptiveDecision: this.lastAdaptiveDecision ? { ...this.lastAdaptiveDecision } : null,
      classification: this.lastClassification, lastWindowKey: this.lastWindowKey, lastWindowEndMs: this.lastWindowEndMs,
    };
  }

  decision(reason, changed, extras = {}) {
    return { targetHz: this.targetHz, qualityStep: this.qualityStep, changed, reason, ...extras, state: this.snapshot() };
  }
}

export function chooseQualityDecision(summary, state = {}) {
  return new AdaptiveController(state).observe(summary);
}
