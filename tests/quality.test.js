import test from 'node:test';
import assert from 'node:assert/strict';
import { S as state } from '../js/context.js';
import { effectiveQuality, QualityManager } from '../js/performance/quality.js';

test('quality retains requested values while reducing actual rendering cost and preserving effects', () => {
  const counts = { main: 65536, flares: 9216 };
  const full = effectiveQuality(0, 2, 1.91, counts);
  const floor = effectiveQuality(3, 2, 1.91, counts);
  assert.equal(full.pixelRatio, 2);
  assert.equal(full.fluidIterations, 2);
  assert.equal(floor.pixelRatio, 1);
  assert.equal(floor.fluidIterations, 1);
  assert.equal(floor.mainParticles, Math.floor(65536 * 0.65));
  assert.equal(floor.fxaaSamples, 4);
  assert.equal(effectiveQuality(3, 1, 0, counts).pixelRatio, 0.75);
  assert.equal(effectiveQuality(3, 1, 0, counts).fluidIterations, 0);
  assert.equal(effectiveQuality(3, 0.5, 0, counts).pixelRatio, 0.5);
  assert.deepEqual(counts, { main: 65536, flares: 9216 });
});

test('workload snapshot handles bloom Vector3 tints and records requested/effective settings', () => {
  const previous = state.WebGL;
  const particles = count => ({ ACTIVE_PARTICLE_COUNT: count, mesh: { count } });
  const world = { components: { particles: particles(65536), flares: particles(9216) },
    activeCamera: { _position: { toArray: () => [0, 3.18, 16.767] } } };
  state.WebGL = {
    renderer: { getPixelRatio: () => 1 }, globalUniforms: { uResolution: { value: { x: 1920, y: 1080 } } },
    bloomPass: { enabled: true, bloomTintColors: [{ toArray: () => [1, 1, 1] }] },
    edgePass: { uniforms: { uSamples: { value: 8 } } },
    compositePass: { uniforms: { uEnabled: { value: true } } },
    fluidSim: { options: { textureWidth: 128, fluid: { iterations: 2 }, simulationOpts: { uniforms: {} } } },
  };
  try {
    const manager = new QualityManager(world);
    manager.effective = effectiveQuality(0, 1, manager.requested.fluidIterations, manager.requested.counts);
    const snapshot = manager.snapshot();
    assert.deepEqual(snapshot.bloom.tintColors, [[1, 1, 1]]);
    assert.equal(snapshot.requested.fluidIterations, 1.91);
    assert.equal(snapshot.effective.fluidIterations, 2);
    assert.deepEqual(snapshot.renderDimensions, [1920, 1080]);
    assert.deepEqual(snapshot.cameraBasePosition, [0, 3.18, 16.767]);
  } finally { state.WebGL = previous; }
});
