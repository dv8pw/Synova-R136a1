import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveController, classifyPerformanceWindow, chooseQualityDecision, getAdaptiveCandidates, getCadenceFallbacks } from '../js/performance/controller.js';

function stream(controller, defaults = {}) {
  let id = 0;
  let endMs = 0;
  return (overrides = {}) => {
    const durationMs = overrides.durationMs ?? 3000;
    const startMs = overrides.startMs ?? endMs;
    endMs = startMs + durationMs;
    return controller.observe({
      windowId: ++id, startMs, endMs, durationMs,
      targetHz: controller.targetHz, qualityStep: controller.qualityStep,
      cpuLoad: 0.4, gpuAvailable: false, deliveryRatio: 0.999,
      lateFraction: 0, lateCount: 0, missedFrames: 0, frameCount: Math.floor(controller.targetHz * durationMs / 1000),
      settled: true, ...defaults, ...overrides,
    });
  };
}
const load = { cpuLoad: 0.95 };
const delivery = { deliveryRatio: 0.85, missedFrames: 20, lateFraction: 0.08, lateCount: 10 };

test('144 Hz reverse hybrid promotion retraces each intermediate compromise', () => {
  const controller = new AdaptiveController({ nativeHz: 144, targetHz: 48, qualityStep: 0 });
  const next = stream(controller);
  for (const [targetHz, qualityStep] of [[72, 2], [72, 1], [72, 0], [144, 1], [144, 0]]) {
    const from = [controller.targetHz, controller.qualityStep];
    let decision;
    for (let window = 0; window < 10; window++) {
      decision = next();
      if (decision.changed) break;
    }
    assert.equal(decision.changed, true);
    assert.deepEqual([controller.targetHz, controller.qualityStep], [targetHz, qualityStep]);
    assert.deepEqual([controller.pendingTrial.fromTargetHz, controller.pendingTrial.fromQualityStep], from);
  }
  next();
  next();
  assert.equal(controller.pendingTrial, null);
});

test('triggering window evidence survives transition streak resets', () => {
  const controller = new AdaptiveController({ nativeHz: 144 });
  const next = stream(controller);
  next(load);
  const decision = next(load);
  assert.equal(decision.changed, true);
  assert.equal(controller.loadOverloadStreak, 0);
  assert.equal(controller.lastWindowEvidence.loadOverloadStreak, 2);
  assert.equal(controller.lastWindowEvidence.deliveryOverloadStreak, 0);
  const deliveryController = new AdaptiveController({ nativeHz: 144 });
  const deliveryNext = stream(deliveryController);
  deliveryNext(delivery);
  deliveryNext(delivery);
  assert.equal(deliveryNext(delivery).changed, true);
  assert.equal(deliveryController.deliveryOverloadStreak, 0);
  assert.equal(deliveryController.lastWindowEvidence.deliveryOverloadStreak, 3);
  assert.equal(deliveryController.lastWindowEvidence.deliveryOverloadDurationMs, 9000);
});

test('adaptive candidates form the exact forward and reverse ladder', () => {
  const serialize = nativeHz => getAdaptiveCandidates(nativeHz)
    .map(({ targetHz, qualityStep }) => `${targetHz}/${qualityStep}`);
  assert.deepEqual(serialize(30), ['30/0', '30/1', '30/2', '30/3']);
  assert.deepEqual(serialize(60), ['60/0', '60/1', '60/2', '30/0', '30/1', '30/2', '30/3']);
  assert.deepEqual(serialize(120), [
    '120/0', '120/1', '60/0', '60/1', '60/2',
    '40/0', '40/1', '40/2', '30/0', '30/1', '30/2', '30/3',
  ]);
  assert.deepEqual(serialize(144), [
    '144/0', '144/1', '72/0', '72/1', '72/2',
    '48/0', '48/1', '48/2', '36/0', '36/1', '36/2', '36/3',
  ]);
  assert.deepEqual(serialize(165), [
    '165/0', '165/1', '82.5/0', '82.5/1', '82.5/2',
    '55/0', '55/1', '55/2', '41.25/0', '41.25/1', '41.25/2',
    '33/0', '33/1', '33/2', '33/3',
  ]);
  assert.deepEqual(serialize(240), [
    '240/0', '240/1', '120/0', '120/1', '80/0', '80/1',
    '60/0', '60/1', '60/2', '48/0', '48/1', '48/2', '40/0', '40/1', '40/2',
    `${240 / 7}/0`, `${240 / 7}/1`, `${240 / 7}/2`, '30/0', '30/1', '30/2', '30/3',
  ]);
  const candidates = getAdaptiveCandidates(144);
  assert.deepEqual(candidates.slice().reverse().map(({ targetHz, qualityStep }) => `${targetHz}/${qualityStep}`).slice(0, 5),
    ['36/3', '36/2', '36/1', '36/0', '48/2']);
});

test('adaptive overload thresholds use strict boundaries and required evidence', () => {
  const base = { targetHz: 60, cpuLoad: 0.4, gpuAvailable: false, deliveryRatio: 0.999, lateFraction: 0, lateCount: 0, missedFrames: 0 };
  assert.equal(classifyPerformanceWindow({ ...base, cpuLoad: 0.92 }).loadOverloaded, false);
  assert.equal(classifyPerformanceWindow({ ...base, cpuLoad: 0.920001 }).loadOverloaded, true);
  assert.equal(classifyPerformanceWindow({ ...base, deliveryRatio: 0.88, missedFrames: 6 }).deliveryOverloaded, false);
  assert.equal(classifyPerformanceWindow({ ...base, deliveryRatio: 0.879999, missedFrames: 6 }).deliveryOverloaded, true);
  assert.equal(classifyPerformanceWindow({ ...base, lateFraction: 0.06, lateCount: 6 }).deliveryOverloaded, true);
  assert.equal(classifyPerformanceWindow({ ...base, lateFraction: 0.06, lateCount: 5 }).deliveryOverloaded, false);
  const gpu = { ...base, cpuLoad: 0.4, gpuAvailable: true, gpuLoad: 0.92, gpuSamples: 20, gpuValidFraction: 0.8 };
  assert.equal(classifyPerformanceWindow(gpu).loadOverloaded, false);
  assert.equal(classifyPerformanceWindow({ ...gpu, gpuLoad: 0.920001 }).loadOverloaded, true);
});

for (const nativeHz of [144, 240]) {
  test(`${nativeHz} Hz overload tests Q1 before lowering cadence`, () => {
    const c = new AdaptiveController({ nativeHz });
    const next = stream(c, load);
    assert.equal(next().changed, false);
    const quality = next();
    assert.equal(quality.reason, 'overload-lower-quality');
    assert.equal(quality.targetHz, nativeHz);
    assert.equal(quality.qualityStep, 1);
    assert.equal(quality.state.pendingTrial.direction, 'demotion');
    assert.equal(next().changed, false);
    const rate = next();
    assert.equal(rate.reason, 'overload-lower-rate');
    assert.equal(rate.targetHz, nativeHz / 2);
    assert.equal(rate.qualityStep, 0);
  });

  test(`${nativeHz} Hz conservative recovery tests quality before rate`, () => {
    const c = new AdaptiveController({ nativeHz, targetHz: nativeHz / 2, qualityStep: 1 });
    const next = stream(c);
    for (let i = 0; i < 4; i++) assert.equal(next().changed, false);
    assert.equal(next().reason, 'stable-raise-quality');
    assert.equal(c.targetHz, nativeHz / 2);
    next(); next();
    for (let i = 0; i < 4; i++) assert.equal(next().changed, false);
    assert.equal(next().reason, 'stable-raise-rate');
    assert.equal(c.targetHz, nativeHz);
  });

  test(`${nativeHz} Hz hybrid visits Q0/Q1 above boundary, Q2 below, Q3 only at floor`, () => {
    const c = new AdaptiveController({ nativeHz });
    const next = stream(c, load);
    const rates = getCadenceFallbacks(nativeHz);
    const boundary = rates.findLastIndex(rate => rate >= 60);
    for (let index = 0; index < rates.length; index++) {
      const maxQuality = index === rates.length - 1 ? 3 : index >= boundary ? 2 : 1;
      assert.equal(c.targetHz, rates[index]);
      assert.equal(c.qualityStep, 0);
      for (let quality = 1; quality <= maxQuality; quality++) {
        next();
        const result = next();
        assert.equal(result.reason, 'overload-lower-quality');
        assert.equal(result.targetHz, rates[index]);
        assert.equal(result.qualityStep, quality);
      }
      next();
      const result = next();
      if (index < rates.length - 1) {
        assert.equal(result.reason, 'overload-lower-rate');
        assert.equal(result.targetHz, rates[index + 1]);
        assert.equal(result.qualityStep, 0);
      } else assert.equal(result.reason, 'overload-at-floor');
    }
  });

  test(`${nativeHz} Hz ignores isolated delivery disturbances and small deficits`, () => {
    const c = new AdaptiveController({ nativeHz });
    const next = stream(c);
    next({ deliveryRatio: 0.96, lateFraction: 1 / 90, lateCount: 1, missedFrames: 1 });
    next({ deliveryRatio: 0.96, lateFraction: 1 / 90, lateCount: 1, missedFrames: 1 });
    assert.equal(c.qualityStep, 0);
    next(delivery);
    next();
    next(delivery);
    assert.equal(c.qualityStep, 0);
    assert.equal(c.snapshot().deliveryOverloadStreak, 1);
  });
}

test('delivery alone requires relative and absolute evidence', () => {
  const base = { targetHz: 240, cpuLoad: 0.4, gpuAvailable: false, deliveryRatio: 0.85, lateFraction: 0.1 };
  assert.equal(classifyPerformanceWindow(base).overloaded, false);
  assert.equal(classifyPerformanceWindow({ ...base, missedFrames: 1, lateCount: 1 }).overloaded, false);
  assert.equal(classifyPerformanceWindow({ ...base, missedFrames: 6 }).deliveryOverloaded, true);
  assert.equal(classifyPerformanceWindow({ ...base, deliveryRatio: 0.99, lateCount: 6 }).deliveryOverloaded, true);
  assert.equal(classifyPerformanceWindow({ ...base, deliveryRatio: 0.96, lateFraction: 0.02, missedFrames: 100, lateCount: 100 }).overloaded, false);
});

test('delivery demotion needs consecutive windows and at least six measured seconds', () => {
  const c = new AdaptiveController({ nativeHz: 240 });
  const next = stream(c, { ...delivery, durationMs: 1500 });
  next(); next();
  assert.equal(next().changed, false);
  const changed = next();
  assert.equal(changed.reason, 'overload-lower-quality');
  assert.equal(changed.qualityStep, 1);
});

test('CPU/GPU p95 overload thresholds and reliable GPU requirements remain intact', () => {
  for (const fields of [{ cpu: { p95: 4 } }, { cpuLoad: 0.4, gpuAvailable: true, gpu: { p95: 4 }, gpuSamples: 45 }]) {
    const c = new AdaptiveController({ nativeHz: 240 });
    const next = stream(c, { cpuLoad: undefined, ...fields });
    const first = next();
    assert.equal(first.classification.loadOverloaded, true);
    assert.equal(first.changed, false);
    assert.equal(next().reason, 'overload-lower-quality');
  }
  const gpu = { targetHz: 240, cpuLoad: 0.4, gpuAvailable: true, gpuLoad: 0.95, gpuSamples: 20, gpuValidFraction: 0.8 };
  assert.equal(classifyPerformanceWindow(gpu).loadOverloaded, true);
  assert.equal(classifyPerformanceWindow({ ...gpu, gpuSamples: 19 }).loadOverloaded, false);
  assert.equal(classifyPerformanceWindow({ ...gpu, gpuValidFraction: 0.79 }).loadOverloaded, false);
  const reliable = classifyPerformanceWindow(gpu);
  assert.equal(reliable.cpuLoad, 0.4);
  assert.equal(reliable.gpuLoad, 0.95);
});

test('load and delivery evidence cannot borrow each other’s consecutive-window streak', () => {
  const c = new AdaptiveController({ nativeHz: 240 });
  const next = stream(c);
  next(load);
  assert.equal(next(delivery).changed, false);
  assert.equal(next(load).changed, false);
  assert.equal(c.snapshot().deliveryOverloadStreak, 0);
  assert.equal(next(delivery).changed, false);
  assert.equal(next(delivery).changed, false);
  assert.equal(next(delivery).reason, 'overload-lower-quality');
});

test('promotion needs fifteen measured seconds and five eligible windows; quality precedes cadence', () => {
  const c = new AdaptiveController({ nativeHz: 240, targetHz: 60, qualityStep: 2 });
  const next = stream(c);
  for (let i = 0; i < 4; i++) assert.equal(next().changed, false);
  const quality = next();
  assert.equal(quality.reason, 'stable-raise-quality');
  assert.equal(quality.targetHz, 60);
  assert.equal(quality.qualityStep, 1);
  assert.equal(next().reason, 'trial-observing');
  assert.equal(next().reason, 'quality-trial-accepted');
  for (let i = 0; i < 4; i++) next();
  assert.equal(next().reason, 'stable-raise-quality');
  assert.equal(c.targetHz, 60);
  assert.equal(c.qualityStep, 0);
  next(); next();
  for (let i = 0; i < 4; i++) next();
  const rate = next();
  assert.equal(rate.reason, 'stable-raise-rate');
  assert.equal(rate.targetHz, 80);
  assert.equal(rate.qualityStep, 1);
});

test('promotion counts measured windows rather than wall time or missing duration', () => {
  const c = new AdaptiveController({ nativeHz: 240, targetHz: 120 });
  const next = stream(c);
  for (let i = 0; i < 4; i++) next();
  assert.equal(next({ startMs: 100_000 }).changed, false);
  assert.equal(c.snapshot().stableWindowCount, 1);
  assert.equal(c.snapshot().stableDurationMs, 3000);
  next({ deliveryRatio: 0.98 });
  assert.equal(c.snapshot().stableWindowCount, 0);
  const d = new AdaptiveController({ nativeHz: 240, targetHz: 120 });
  for (let id = 1; id < 20; id++) {
    assert.equal(d.observe({ windowId: id, endMs: id * 30_000, targetHz: 120, cpuLoad: 0.2,
      deliveryRatio: 0.999, lateFraction: 0 }).changed, false);
  }
});

function promotionTrial(qualityStep = 0) {
  const c = new AdaptiveController({ nativeHz: 240, targetHz: 120, qualityStep });
  const next = stream(c);
  for (let i = 0; i < 5; i++) next();
  assert.equal(c.pendingTrial.direction, 'promotion');
  return { c, next };
}

test('one delivery disturbance cannot roll back a promotion, and two sustainable windows accept it', () => {
  const { c, next } = promotionTrial();
  assert.equal(next(delivery).changed, false);
  assert.equal(c.targetHz, 240);
  next();
  assert.equal(next().reason, 'cadence-trial-accepted');
  assert.equal(c.targetHz, 240);
});

test('promotion load failure requires two consecutive overloaded windows', () => {
  const { c, next } = promotionTrial();
  assert.equal(next(load).changed, false);
  const failed = next(load);
  assert.equal(failed.reason, 'cadence-trial-failed-restore');
  assert.equal(c.targetHz, 120);
  assert.equal(c.qualityStep, 0);
  assert.equal(c.failedTrials['240:1'], 81_000);
  next(load);
  assert.equal(next(load).reason, 'overload-lower-quality');
});

test('delivery-only promotion failure requires full consecutive count and duration', () => {
  const { c, next } = promotionTrial();
  for (let i = 0; i < 3; i++) assert.equal(next({ ...delivery, durationMs: 1500 }).changed, false);
  const failed = next({ ...delivery, durationMs: 1500 });
  assert.equal(failed.reason, 'cadence-trial-failed-restore');
  assert.equal(c.targetHz, 120);
});

test('marginal promotion times out and restores its exact pair; marginal demotion keeps the new pair', () => {
  const { c, next } = promotionTrial(1);
  for (let i = 0; i < 3; i++) next({ cpuLoad: 0.85 });
  assert.equal(next({ cpuLoad: 0.85 }).reason, 'quality-trial-inconclusive-restore');
  assert.equal(c.targetHz, 120);
  assert.equal(c.qualityStep, 1);
  assert.equal(c.pendingTrial, null);
  const d = new AdaptiveController({ nativeHz: 240 });
  const dn = stream(d);
  dn(load); dn(load);
  for (let i = 0; i < 3; i++) dn({ cpuLoad: 0.85 });
  assert.equal(dn({ cpuLoad: 0.85 }).reason, 'quality-demotion-trial-inconclusive-kept');
  assert.equal(d.targetHz, 240);
  assert.equal(d.qualityStep, 1);
  assert.equal(d.pendingTrial, null);
});

test('candidate cooldown cannot suppress a different cadence/quality pair', () => {
  const c = new AdaptiveController({ nativeHz: 240, targetHz: 120, qualityStep: 0,
    failedTrials: { '240:1': 100_000 } });
  const next = stream(c);
  for (let i = 0; i < 4; i++) next();
  assert.equal(next().reason, 'hold');
  assert.equal(c.targetHz, 120);
  assert.equal(c.qualityStep, 0);
  assert.equal(c.pendingTrial, null);
  // Continuous headroom eventually allows the adjacent blocked candidate after
  // its cooldown; recovery must not skip directly to 240/Q0.
  while (c.lastWindowEndMs < 100_000 && !c.pendingTrial) next();
  assert.equal(c.pendingTrial.targetHz, 240);
  assert.equal(c.pendingTrial.qualityStep, 1);
});

test('stale, duplicate and unsettled populations cannot advance a trial or evidence', () => {
  const { c, next } = promotionTrial();
  const before = c.snapshot();
  assert.equal(next({ settled: false }).reason, 'trial-settling');
  assert.equal(c.pendingTrial.observedDurationMs, 0);
  assert.equal(next({ targetHz: 120 }).reason, 'configuration-mismatch');
  assert.equal(c.pendingTrial.observedDurationMs, 0);
  const duplicate = { windowId: before.lastWindowKey, startMs: 12_000, endMs: 15_000, ...load };
  assert.equal(c.observe(duplicate).changed, false);
  assert.equal(c.pendingTrial.observedDurationMs, 0);
});

test('last adaptive reason remains available across monitoring holds and snapshot roundtrips', () => {
  const c = new AdaptiveController({ nativeHz: 144 });
  const next = stream(c);
  next(load); next(load);
  next(); next(); next();
  assert.equal(c.snapshot().lastAdaptiveDecision.reason, 'overload-lower-quality');
  const state = c.snapshot();
  const decision = chooseQualityDecision({ windowId: 6, startMs: 15_000, endMs: 18_000, durationMs: 3000,
    targetHz: 144, qualityStep: 1, cpuLoad: 0.4, gpuAvailable: false, deliveryRatio: 0.999, lateFraction: 0 }, state);
  assert.equal(decision.state.stableWindowCount, state.stableWindowCount + 1);
  assert.equal(decision.state.lastAdaptiveDecision.reason, state.lastAdaptiveDecision.reason);
});
