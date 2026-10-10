import test from 'node:test';
import assert from 'node:assert/strict';
import { AnimationClock, PresentationClock, STEP_SECONDS } from '../js/animation-clock.js';
import { PointerEnergy } from '../js/pointer-energy.js';
import { smootherstep } from '../js/opening-reveal.js';

function trace(rate, jitter = false) {
  const clock = new AnimationClock();
  let steps = 0, renders = 0, rotation = 0;
  clock.advance(0, () => {});
  for (let i = 1; i <= rate * 4; i++) {
    const time = i * 1000 / rate + (jitter && i < rate * 4 ? (i % 2 ? 0.7 : -0.7) : 0);
    const result = clock.advance(time, delta => { steps++; rotation += 0.120 * delta; });
    if (result.render) renders++;
  }
  return { steps, renders, rotation, clock };
}

test('simulation advances at 60 Hz across display rates and timestamp jitter', () => {
  for (const rate of [30, 60, 120, 144, 165, 200, 240]) {
    for (const jitter of [false, true]) {
      const { steps, renders, rotation, clock } = trace(rate, jitter);
      assert.equal(steps, 240, 'fixed updates must match elapsed time');
      assert.ok(Math.abs(rotation - 0.48) < 1e-12);
      assert.equal(renders, rate * 4, 'simulation must not cap presentation opportunities');
      assert.ok(clock.accumulator < STEP_SECONDS);
    }
  }
});

test('presentation uses evenly spaced display divisions and resumes without catch-up frames', () => {
  // Quantized 4.2 ms RAF timestamps estimate 238.095 Hz on this 239.76 Hz display.
  // That estimation error must not create periodic extra skipped presentations.
  const scheduler = new PresentationClock(238.095, 240, 120);
  const indices = [];
  for (let index = 0; index < 2400; index++) {
    if (scheduler.advance(index * 1000 / 239.76).render) indices.push(index);
  }
  assert.equal(indices.length, 1200);
  assert.ok(indices.slice(1).every((value, index) => value - indices[index] === 2));
  scheduler.pause();
  assert.equal(scheduler.advance(10000).elapsedSeconds, 0);
  scheduler.configure(239.76, 240, 240);
  assert.ok(Array.from({ length: 240 }, (_, index) => scheduler.advance(20000 + index * 1000 / 239.76).render).every(Boolean));
});

test('short stalls catch up simulation and rotation before rendering', () => {
 const clock = new AnimationClock();
 let rotation = 0;
 clock.advance(0, () => {});
 const result = clock.advance(500, delta => { rotation += 0.120 * delta; });
 assert.equal(result.steps, 30);
 assert.equal(result.render, true);
 assert.ok(Math.abs(rotation - 0.060) < 1e-12);
 assert.ok(Math.abs(clock.simulationSeconds - clock.seconds) < 1e-12);
 assert.ok(clock.accumulator < 1e-7);
});

test('hidden and multi-second pauses do not produce a catch-up burst', () => {
  const clock = new AnimationClock();
  let count = 0;
  clock.advance(0, () => {});
  clock.advance(100, () => count++);
  assert.equal(count, 6);
  assert.equal(clock.advance(2100, () => count++).paused, true);
  assert.equal(count, 6);
  assert.equal(clock.seconds, 0.1);
  clock.pause();
  clock.advance(20000, () => count++);
  clock.advance(20000 + 1000 / 60, () => count++);
  assert.equal(count, 7);
});

const settings = () => ({ mouseEnergyIntensity: 1, attackMs: 125, releaseMs: 500 });

test('pointer velocity is normalized by elapsed seconds and viewport diagonal', () => {
  for (const rate of [30, 60, 120, 240]) {
    const energy = new PointerEnergy(settings());
    energy.sample(0, 0, 0, 1000);
    energy.sample(1000 / rate, 0, 1000 / rate, 1000);
    assert.ok(Math.abs(energy.target - 1) < 1e-12);
    const activity = energy.advance(0.125, 1000 / rate);
    assert.ok(Math.abs(activity - (1 - Math.exp(-1))) < 1e-12);
    energy.leave();
    assert.ok(Math.abs(energy.advance(0.5, 1000) - activity / Math.E) < 1e-12);
  }
});

test('pointer re-entry, stale movement, and long sample gaps cannot spike energy', () => {
  const energy = new PointerEnergy(settings());
  energy.sample(0, 0, 0, 1000);
  energy.sample(1000, 0, 16, 1000);
  assert.equal(energy.target, 1);
  energy.advance(1 / 60, 117);
  assert.equal(energy.target, 0);
  energy.leave();
  energy.sample(-10000, 4000, 150, 1000);
  assert.equal(energy.target, 0);
  energy.sample(10000, -4000, 450, 1000);
  assert.equal(energy.target, 0);
  energy.sample(10000, -4000, 450, 1000);
  assert.ok(Number.isFinite(energy.advance(1 / 60, 450)));
});

test('attack/release response and multiplier limits are independent of update size', () => {
  for (const rate of [30, 60, 120, 144]) {
    const energy = new PointerEnergy(settings());
    energy.sample(0, 0, 0, 1000);
    for (let i = 1; i <= rate; i++) {
      const time = i * 1000 / rate;
      energy.sample(time, 0, time, 1000);
      energy.advance(1 / rate, time);
      assert.ok(1 + energy.activity <= 2);
      assert.ok(1 + 2 * energy.activity <= 3);
    }
    assert.ok(Math.abs(energy.activity - (1 - Math.exp(-8))) < 1e-12);
    energy.leave();
    for (let i = 0; i < rate; i++) energy.advance(1 / rate, 2000);
    assert.ok(Math.abs(energy.activity - (1 - Math.exp(-8)) * Math.exp(-2)) < 1e-12);
  }
});

test('camera easing is monotonic and starts and finishes with zero velocity', () => {
  assert.equal(smootherstep(0), 0);
  assert.equal(smootherstep(1), 1);
  let previous = 0;
  for (let i = 0; i <= 100; i++) {
    const next = smootherstep(i / 100);
    assert.ok(next >= previous);
    previous = next;
  }
  const epsilon = 1e-4;
  assert.ok(smootherstep(epsilon) / epsilon < 1e-6);
  assert.ok((1 - smootherstep(1 - epsilon)) / epsilon < 1e-6);
});
