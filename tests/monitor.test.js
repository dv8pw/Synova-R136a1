import test from 'node:test';
import assert from 'node:assert/strict';
import { PerformanceMonitor, normalizeCadence } from '../js/performance/monitor.js';
import { AnimationClock, PresentationClock } from '../js/animation-clock.js';

class TimedGL {
  constructor() { this.time = 0; this.active = null; this.queries = new Set(); }
  getExtension() { return { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 }; }
  createQuery() { const query = {}; this.queries.add(query); return query; }
  beginQuery(target, query) { assert.equal(this.active, null); this.active = query; query.start = this.time; }
  endQuery() { this.active.result = (this.time - this.active.start) * 1e6; this.active = null; }
  getQueryParameter(query, parameter) { return parameter === 0x8867 ? true : query.result; }
  getParameter() { return false; }
  deleteQuery(query) { this.queries.delete(query); }
}

async function run({ gl = null, gpuSimulationMs = 0, gpuPresentationMs = 0, targetHz = 240, seconds = 8, skipPresentation = () => false } = {}) {
  let now = 0;
  const clock = new AnimationClock();
  const scheduler = new PresentationClock(240, 240, targetHz);
  const transitions = [];
  const monitor = new PerformanceMonitor({ gl, cadence: { observedHz: 240, targetHz: 240, stable: true },
    getWorkload: () => ({ version: 1 }), now: () => now,
    onProfile: (rate, step) => { transitions.push({ rate, step }); scheduler.configure(240, 240, rate); },
    onProbe: () => { throw new Error('An unchanged display must not be reclassified.'); } });
  monitor.controller.reset({ nativeHz: 240, targetHz });
  monitor.start(0, targetHz === 240);
  for (let index = 0; index <= seconds * 240; index++) {
    const timestamp = index * 1000 / 240;
    now = timestamp;
    monitor.beforeCallback(timestamp);
    let token;
    const frame = clock.advance(timestamp, () => {
      token ??= monitor.beginPhase('simulation');
      now += 0.1;
      if (gl) gl.time += gpuSimulationMs;
    });
    monitor.endPhase(token, frame.steps ?? 0);
    const presentation = scheduler.advance(timestamp);
    if (presentation.render && !skipPresentation(index)) {
      const renderToken = monitor.beginPhase('presentation');
      now += 0.1;
      if (gl) gl.time += gpuPresentationMs;
      monitor.endPhase(renderToken);
      monitor.presentedFrame(timestamp);
    }
    monitor.afterCallback(timestamp);
    await Promise.resolve();
  }
  return { monitor, transitions };
}

test('missing GPU timers complete qualification with CPU/frame evidence and no cap', async () => {
  const { monitor, transitions } = await run();
  assert.equal(monitor.stage, 'Monitoring');
  assert.equal(monitor.targetHz, 240);
  assert.equal(monitor.evidence, 'cpu-delivery-gpu-unavailable');
  assert.equal(monitor.metrics.gpu, null);
  assert.ok(monitor.metrics.deliveredHz > 239);
  assert.deepEqual(transitions, []);
});

test('complete GPU intervals capture simulation cost and test Q1 before a lower rate', async () => {
  const gl = new TimedGL();
  const { monitor, transitions } = await run({ gl, gpuSimulationMs: 4, gpuPresentationMs: 1, seconds: 12 });
  assert.deepEqual(transitions, [{ rate: 240, step: 1 }, { rate: 120, step: 0 }]);
  assert.equal(monitor.targetHz, 120);
  assert.equal(monitor.evidence, 'cpu-gpu-delivery');
  const native = monitor.history.filter(window => window.targetHz === 240);
  assert.ok(native.length >= 2);
  assert.ok(native.every(window => window.gpu.p95 >= 4.99));
  assert.ok(monitor.metrics.gpu.p95 >= 4.99 && monitor.metrics.gpu.p95 < 5.01);
  assert.equal(gl.active, null);
});

test('configuration changes discard previous workload populations', async () => {
  const { monitor } = await run({ seconds: 2 });
  const previousEpoch = monitor.epoch;
  monitor.invalidate('Theme changed', { timestamp: 2000 });
  assert.equal(monitor.epoch, previousEpoch + 1);
  assert.equal(monitor.stage, 'Settling');
  assert.equal(monitor.metrics, null);
  assert.equal(monitor.windows.size, 0);
  assert.equal(monitor.interval, null);
});

test('30 Hz presentation includes both 60 Hz simulation steps between frame boundaries', async () => {
  const { monitor } = await run({ gl: new TimedGL(), targetHz: 30, gpuSimulationMs: 4, gpuPresentationMs: 1 });
  assert.equal(monitor.targetHz, 30);
  assert.equal(monitor.metrics.gpu.median, 9);
  assert.equal(monitor.metrics.gpu.p95, 9);
  assert.ok(monitor.metrics.simulationSampleSteps.every(steps => steps === 2));
});

test('monitor windows expose coherent classified and explicitly live diagnostics', async () => {
  const { monitor } = await run({ seconds: 4 });
  const latest = monitor.history.at(-1);
  const snapshot = monitor.snapshot();
  assert.ok(Number.isInteger(latest.frameCount));
  assert.ok(Number.isInteger(latest.lateCount));
  assert.ok(Number.isInteger(latest.missedFrames));
  assert.ok(Number.isFinite(latest.durationMs));
  assert.ok(Number.isFinite(latest.deliveryRatio));
  assert.equal(snapshot.classifiedWindow.windowId, latest.windowId);
  assert.equal(snapshot.classifiedWindow.epoch, latest.epoch);
  assert.equal(snapshot.classifiedWindow.metrics.deliveryRatio, latest.deliveryRatio);
  assert.equal(snapshot.classifiedWindow.metrics.lateCount, latest.lateCount);
  assert.equal(snapshot.classifiedWindow.metrics.missedFrames, latest.missedFrames);
  assert.equal(snapshot.classifiedWindow.classification.evidence, snapshot.classifiedWindow.evidence);
  assert.equal(snapshot.metrics, snapshot.classifiedWindow.metrics);
  if (snapshot.liveWindow) {
    assert.equal(snapshot.liveWindow.kind, 'live/current-window');
    assert.notEqual(snapshot.liveWindow.windowId, snapshot.classifiedWindow.windowId);
  }
});

test('demoting monitor diagnostics retain the triggering window and pre-reset streaks', async () => {
  let snapshot;
  for (const seconds of [4, 6, 8, 10, 12]) {
    const { monitor } = await run({ gl: new TimedGL(), gpuSimulationMs: 4, gpuPresentationMs: 1, seconds });
    const candidate = monitor.snapshot();
    if (candidate.classifiedWindow?.decision.changed) { snapshot = candidate; break; }
  }
  assert.ok(snapshot, 'a completed window triggers a demotion');
  const window = snapshot.classifiedWindow;
  assert.equal(window.classification.loadOverloaded, true);
  assert.equal(window.controllerEvidence.loadOverloadStreak, 2);
  assert.equal(snapshot.controller.loadOverloadStreak, 0);
  assert.equal(window.decision.fromTargetHz, window.targetHz);
  assert.equal(window.decision.fromQualityStep, window.qualityStep);
  assert.equal(window.decision.reason, 'overload-lower-quality');
  assert.equal(snapshot.metrics, window.metrics);
  assert.equal(snapshot.classification, window.classification);
});

test('lifecycle requalification preserves the active cadence and quality pair', async () => {
  const { monitor } = await run({ seconds: 2 });
  monitor.controller.targetHz = 120;
  monitor.controller.qualityStep = 2;
  monitor.invalidate('Viewport changed', { timestamp: 2000, resetController: false });
  assert.equal(monitor.targetHz, 120);
  assert.equal(monitor.controller.qualityStep, 2);
  assert.equal(monitor.stage, 'Settling');
  assert.equal(monitor.metrics, null);
});


test('normalization distinguishes robust observed cadence from nominal snapping', () => {
  const snapped = normalizeCadence({ observedHz: 239.7, snappedHz: 240, targetHz: 240, stable: true });
  assert.equal(snapped.observedRefreshHz, 239.7);
  assert.equal(snapped.snappedRefreshHz, 240);
  assert.equal(snapped.targetRefreshHz, 240);
  const raw = normalizeCadence({ observedHz: 220, snappedHz: NaN, targetHz: 220, stable: true });
  assert.equal(raw.observedRefreshHz, 220);
  assert.equal(Number.isNaN(raw.snappedRefreshHz), true);
  assert.equal(raw.targetRefreshHz, 220);
});

test('real monitor windows validate a promotion twice before accepting it', async () => {
  const { monitor, transitions } = await run({ targetHz: 120, seconds: 25 });
  assert.deepEqual(transitions, [{ rate: 240, step: 1 }]);
  assert.ok(monitor.history.some(window => window.reason === 'trial-observing'));
  assert.ok(monitor.history.some(window => window.reason === 'cadence-trial-accepted'));
  assert.equal(monitor.controller.pendingTrial, null);
  assert.equal(monitor.controller.lastAdaptiveDecision.reason, 'stable-raise-rate');
});

test('no-GPU delivery failures require consecutive real windows and six measured seconds while isolated missed frames do not demote', async () => {
  const isolated = await run({ seconds: 12, skipPresentation: index => index > 0 && index % 480 === 0 });
  assert.deepEqual(isolated.transitions, []);
  assert.ok(isolated.monitor.history.some(window => window.missedFrames > 0));
  const poor = await run({ seconds: 10, skipPresentation: index => index % 5 === 0 });
  assert.deepEqual(poor.transitions, [{ rate: 240, step: 1 }]);
  const overload = poor.monitor.history.filter(window => window.qualityStep === 0 && window.classification.deliveryOverloaded);
  assert.equal(overload.length, 4);
  assert.ok(overload.reduce((sum, window) => sum + window.durationMs, 0) >= 6000);
  assert.ok(overload.every(window => window.missedFrames >= 6 && window.deliveryRatio < 0.88));
});

test('lifecycle invalidation clears pending trials and stale GPU results, retaining the pair and last decision', async () => {
  const { monitor } = await run({ seconds: 2 });
  monitor.controller.transition(240, 1, 'overload-lower-quality', 'quality', 'demotion', 2000, {});
  monitor.lastAdaptiveDecision = monitor.controller.lastAdaptiveDecision;
  const staleEpoch = monitor.epoch;
  monitor.invalidate('Replay opening', { timestamp: 2000 });
  assert.equal(monitor.targetHz, 240);
  assert.equal(monitor.controller.qualityStep, 1);
  assert.equal(monitor.controller.pendingTrial, null);
  assert.equal(monitor.controller.snapshot().lastAdaptiveDecision.reason, 'overload-lower-quality');
  const cpuBefore = monitor.metrics;
  monitor.gpu.poll = () => [{ valid: true, windowId: 1, epoch: staleEpoch, totalMs: 1000 }];
  monitor.beforeCallback(2500);
  assert.equal(monitor.metrics, cpuBefore);
  assert.equal(monitor.windows.size, 0);
});

test('same-native reprobe preserves pair and candidate cooldown', async () => {
  const { monitor } = await run({ seconds: 2 });
  monitor.controller.targetHz = 120;
  monitor.controller.qualityStep = 1;
  monitor.controller.failedTrials['240:0'] = 100_000;
  monitor.invalidate('Visibility returned', { timestamp: 2000,
    cadence: { observedHz: 239.7, snappedHz: 240, targetHz: 240, stable: true } });
  assert.equal(monitor.targetHz, 120);
  assert.equal(monitor.controller.qualityStep, 1);
  assert.equal(monitor.controller.failedTrials['240:0'], 100_000);
});


test('new native classification preserves the adapted divisor while respecting heavy-quality eligibility', async () => {
  const { monitor } = await run({ seconds: 2 });
  monitor.controller.targetHz = 120;
  monitor.controller.qualityStep = 1;
  monitor.invalidate('Display changed', { resetController: true,
    cadence: { observedHz: 144, snappedHz: 144, targetHz: 144, stable: true } });
  assert.equal(monitor.targetHz, 72);
  assert.equal(monitor.controller.qualityStep, 1);
  monitor.controller.qualityStep = 3;
  monitor.invalidate('Display changed again', { resetController: true,
    cadence: { observedHz: 240, snappedHz: 240, targetHz: 240, stable: true } });
  assert.equal(monitor.targetHz, 30);
  assert.equal(monitor.controller.qualityStep, 3);
});


test('delayed older GPU window cannot replace accepted classified diagnostics', () => {
  const monitor = new PerformanceMonitor({ cadence: { observedHz: 240, targetHz: 240, confidence: 1 }, getWorkload: () => 'test', onProfile: () => {}, onProbe: () => {}, now: () => 4000 });
  monitor.controller.reset({ nativeHz: 240 });
  monitor.start(0, 240);
  const makeWindow = (id, startMs, cpuMs) => ({
    id, epoch: monitor.epoch, mode: 'monitoring', startMs, endMs: startMs + 2000,
    cadence: monitor.cadence, targetHz: 240, qualityStep: 0, frameBudgetMs: 1000 / 240,
    workload: monitor.workload, attempted: 0, invalidGpu: 0, gpuSamples: [],
    raf: Array(480).fill(1000 / 240), presentation: Array(480).fill(1000 / 240),
    cpu: [cpuMs], callbackCpu: [cpuMs], simulationCpu: [cpuMs], presentationCpu: [0],
  });
  monitor.finishWindow(makeWindow(2, 2000, 0.1));
  const accepted = monitor.snapshot();
  const historyLength = monitor.history.length;
  assert.equal(accepted.classifiedWindow.windowId, 2);
  assert.equal(accepted.classification.loadOverloaded, false);
  monitor.finishWindow(makeWindow(1, 0, 10));
  const after = monitor.snapshot();
  assert.equal(after.classifiedWindow, accepted.classifiedWindow);
  assert.equal(after.metrics, accepted.metrics);
  assert.equal(after.classification, accepted.classification);
  assert.equal(monitor.history.length, historyLength);
  assert.equal(monitor.controller.lastWindowEndMs, 4000);
});
