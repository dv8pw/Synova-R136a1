import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateCadence, startCadenceProbe } from '../js/performance/cadence.js';

function quantizedIntervals(rate, count = 480, phaseMs = 0) {
  const timestamps = Array.from({ length: count + 1 }, (_, index) =>
    Math.round(index * 1000 / rate + phaseMs));
  return timestamps.slice(1).map((timestamp, index) => timestamp - timestamps[index]);
}

test('quantized 144 Hz timestamps retain the 6/7 ms buckets and snap to 144 Hz', () => {
  const intervals = quantizedIntervals(144, 480, 0.25);
  const result = estimateCadence(intervals, { durationMs: intervals.reduce((sum, value) => sum + value, 0) });

  assert.equal(result.stable, true);
  assert.equal(result.rejectedCount, 0);
  assert.equal(result.targetHz, 144);
  assert.equal(result.snappedHz, 144);
  assert.ok(Math.abs(result.observedHz - 144) < 0.2);
  assert.ok(result.rawMedianMs === 6 || result.rawMedianMs === 7);
  assert.ok(result.retainedDurationMs > 0);
});

test('quantized 239.7 Hz timestamps aggregate to 240 instead of false 250 Hz', () => {
  for (const rate of [239.7, 240]) for (const phaseMs of [0, 0.25, 0.5, 0.75]) {
    const intervals = quantizedIntervals(rate, 600, phaseMs);
    const result = estimateCadence(intervals, { durationMs: intervals.reduce((sum, value) => sum + value, 0) });

    assert.equal(result.stable, true);
    assert.equal(result.targetHz, 240);
    assert.equal(result.snappedHz, 240);
    assert.ok(result.observedHz < 245);
    assert.ok(Math.abs(result.observedHz - 239.7) < 0.4);
    assert.equal(result.rejectedCount, 0);
  }
});

test('MAD filtering rejects stalls while preserving adjacent quantized intervals and invalid samples', () => {
  const base = quantizedIntervals(239.7, 360, 0.5);
  const intervals = [...base.slice(0, 80), 120, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, ...base.slice(80)];
  const result = estimateCadence(intervals, { durationMs: intervals.reduce((sum, value) => sum + (Number.isFinite(value) && value > 0 ? value : 0), 0) });

  assert.equal(result.stable, true);
  assert.equal(result.rejectedCount, 1);
  assert.equal(result.invalidCount, 4);
  assert.equal(result.targetHz, 240);
  assert.ok(Math.abs(result.observedHz - 239.7) < 0.5);
});

test('cadence probe reaches a stable 240 Hz result from quantized RAF timestamps', async () => {
  const callbacks = [];
  const intervals = quantizedIntervals(239.7, 600, 0.25);
  let index = 0;
  const probe = startCadenceProbe({
    now: () => 0,
    requestFrame(callback) {
      callbacks.push(callback);
      return callbacks.length;
    },
    minSamples: 60,
    minDurationMs: 1000,
    maxDurationMs: 2500,
  });

  while (callbacks.length > 0 && index <= intervals.length) {
    const timestamp = index === 0
      ? 0
      : intervals.slice(0, index).reduce((sum, value) => sum + value, 0);
    callbacks.shift()(timestamp);
    index++;
  }

  const result = await probe.promise;
  assert.equal(result.cancelled, false);
  assert.equal(result.stable, true);
  assert.equal(result.targetHz, 240);
  assert.equal(result.snappedHz, 240);
});
