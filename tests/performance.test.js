import test from 'node:test';
import assert from 'node:assert/strict';
import { median, mad, percentileNearestRank, summarize } from '../js/performance/stats.js';
import { createCadenceProbe, estimateCadence, startCadenceProbe } from '../js/performance/cadence.js';
import { GpuTimerSampler } from '../js/performance/gpu-timer.js';
import {
  AdaptiveController,
  classifyPerformanceWindow,
  getCadenceFallbacks,
} from '../js/performance/controller.js';

test('statistics use a stable median, MAD, and nearest-rank percentiles', () => {
  assert.equal(median([3, 1, 2, 4]), 2.5);
  assert.equal(mad([1, 2, 3, 4]), 1);
  assert.equal(percentileNearestRank([1, 2, 3, 4, 5], 0.95), 5);
  assert.equal(percentileNearestRank([1, 2, 3, 4, 5], 0), 1);
  assert.deepEqual(summarize([1, 2, 3]), {
    count: 3,
    min: 1,
    max: 3,
    median: 2,
    mad: 1,
    p50: 2,
    p95: 3,
    p99: 3,
    sum: 6,
  });
});

test('cadence estimation rejects stalls and snaps a stable 240 Hz cadence', () => {
  const intervals = Array.from({ length: 241 }, (_, index) => index === 20 ? 120 : 1000 / 240);
  const result = estimateCadence(intervals, { durationMs: intervals.reduce((a, b) => a + b, 0) });
  assert.equal(result.stable, true);
  assert.equal(result.targetHz, 240);
  assert.equal(result.snapped, true);
  assert.equal(result.rejectedCount, 1);
  assert.ok(result.madRatio < 0.05);
  assert.equal(result.raw.p95Ms, 1000 / 240);
});

test('unstable cadence retains the raw observed rate instead of snapping', () => {
  const intervals = Array.from({ length: 60 }, (_, index) => index % 2 ? 16 : 17.9);
  const result = estimateCadence(intervals, { durationMs: intervals.reduce((a, b) => a + b, 0) });
  assert.equal(result.stable, false);
  assert.equal(result.snapped, false);
  assert.ok(Math.abs(result.targetHz - result.observedHz) < 1e-12);
  assert.ok(result.rawMadRatio > 0.05);
});

test('cadence probe is bounded and injectable without a browser', async () => {
  const callbacks = [];
  let now = 0;
  const probe = startCadenceProbe({
    now: () => now,
    requestFrame(callback) {
      callbacks.push(callback);
      return callbacks.length;
    },
    minSamples: 60,
    minDurationMs: 1000,
    maxDurationMs: 2500,
  });
  let index = 0;
  while (callbacks.length > 0 && index <= 300) {
    now = index * 1000 / 240;
    callbacks.shift()(now);
    index += 1;
  }
  const result = await probe.promise;
  assert.equal(result.stable, true);
  assert.equal(result.targetHz, 240);
  assert.equal(result.cancelled, false);

  const directProbe = createCadenceProbe({
    now: () => 0,
    requestFrame(callback) {
      queueMicrotask(() => callback(0));
      return 1;
    },
    minSamples: 1,
    minDurationMs: 0,
    maxDurationMs: 0,
  });
  const direct = await directProbe;
  assert.equal(direct.cancelled, false);
});

function fakeGl() {
  const extension = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
  let nextId = 0;
  let active = null;
  const queries = new Set();
  const gl = {
    QUERY_RESULT_AVAILABLE: 3,
    QUERY_RESULT: 4,
    getExtension(name) {
      return name === 'EXT_disjoint_timer_query_webgl2' ? extension : null;
    },
    createQuery() {
      const query = { id: ++nextId, available: false, result: 0, deleted: false };
      queries.add(query);
      return query;
    },
    beginQuery(target, query) {
      assert.equal(target, extension.TIME_ELAPSED_EXT);
      assert.equal(active, null);
      active = query;
    },
    endQuery(target) {
      assert.equal(target, extension.TIME_ELAPSED_EXT);
      assert.ok(active);
      active = null;
    },
    getParameter(parameter) {
      if (parameter === extension.GPU_DISJOINT_EXT) return false;
      return false;
    },
    getQueryParameter(query, parameter) {
      if (parameter === gl.QUERY_RESULT_AVAILABLE) return query.available;
      if (parameter === gl.QUERY_RESULT) return query.result;
      throw new Error('unexpected query parameter');
    },
    deleteQuery(query) {
      query.deleted = true;
    },
    queries,
  };
  return gl;
}

test('GPU timer publishes complete simulation and presentation intervals asynchronously', async () => {
  const gl = fakeGl();
  const sampler = new GpuTimerSampler(gl, { now: () => 0 });
  const interval = sampler.beginInterval({ epoch: 7, windowId: 12 });
  const simulationA = sampler.beginScope('simulation', interval);
  assert.equal(sampler.endScope(simulationA), true);
  await Promise.resolve();
  const simulationB = sampler.beginScope('simulation', interval);
  assert.equal(sampler.endScope(simulationB), true);
  const presentation = sampler.beginScope('presentation', interval);
  assert.equal(sampler.endScope(presentation), true);
  sampler.closeInterval(interval);
  assert.deepEqual(sampler.poll(), []);
  await Promise.resolve();
  const queries = [...gl.queries];
  queries[0].result = 1_250_000;
  queries[1].result = 2_500_000;
  queries[2].result = 750_000;
  for (const query of queries) query.available = true;
  const [sample] = sampler.poll();
  assert.equal(sample.valid, true);
  assert.equal(sample.epoch, 7);
  assert.equal(sample.windowId, 12);
  assert.equal(sample.simulationMs, 3.75);
  assert.equal(sample.presentationMs, 0.75);
  assert.equal(sample.totalMs, 4.5);
  assert.equal(sample.scopeCount, 3);
  assert.ok(queries.every(query => query.deleted));
});

test('GPU timer invalidates a partial interval and enforces the unresolved-query cap', async () => {
  const gl = fakeGl();
  const sampler = new GpuTimerSampler(gl, { maxPendingQueries: 1, now: () => 0 });
  const interval = sampler.beginInterval({ epoch: 1 });
  const first = sampler.beginScope('simulation', interval);
  assert.equal(sampler.endScope(first), true);
  const missing = sampler.beginScope('presentation', interval);
  assert.equal(missing, null);
  sampler.closeInterval(interval);
  await Promise.resolve();
  const query = [...gl.queries][0];
  query.available = true;
  query.result = 1_000_000;
  const [sample] = sampler.poll();
  assert.equal(sample.valid, false);
  assert.equal(sample.reason, 'query-cap-reached');
  assert.equal(sampler.pendingQueryCount, 0);
});

test('GPU timer queues unavailable interval results for the next poll', () => {
  const sampler = new GpuTimerSampler(null);
  const interval = sampler.beginInterval({ epoch: 4, windowId: 2 });
  const result = sampler.closeInterval(interval);
  assert.equal(result.valid, false);
  const [queued] = sampler.poll();
  assert.equal(queued.valid, false);
  assert.equal(queued.reason, 'gpu-timer-unavailable');
});

test('cadence fallbacks are integer divisors and preserve native sub-30 Hz', () => {
  assert.deepEqual(getCadenceFallbacks(240), [240, 120, 80, 60, 48, 40, 240 / 7, 30]);
  assert.deepEqual(getCadenceFallbacks(29.97), [29.97]);
});
