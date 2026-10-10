import test from 'node:test';
import assert from 'node:assert/strict';
import { PresentationMotion, interpolateParticleShader } from '../js/presentation-motion.js';

const shader = 'uniform sampler2D tPosition;void main(){vec4 particlePosition=texture2D(tPosition,aFboUv);}';
const particle = () => ({ mesh: { rotation: { y: 0 }, material: { vertexShader: shader, uniforms: {} } },
  positionSim: { texture: 'current', alternateTexture: 'previous' } });

test('high-rate presentation interpolates motion and textures without altering simulation state', () => {
  const state = { motion: { orbRotationSpeed: 0.120 }, pointerActivity: 0,
    WebGL: { clockDelta: 1 / 60, globalUniforms: { uTime: { value: 1 / 60 } } } };
  const orb = { rotation: { y: 0 }, mainMaterial: { uniforms: { uCloudPhase: { value: 0 }, uCloudNoiseSpeed: { value: 1 } } } };
  const world = { components: { orb, particles: particle(), flares: particle() },
    smoothMouse: [{ x: 0, y: 0 }, { x: 0, y: 0 }] };
  const motion = new PresentationMotion(state, world);
  motion.beforeStep(); orb.update();
  world.smoothMouse[0].x = 0.8;
  world.smoothMouse[1].y = 0.4;
  motion.afterStep();
  const positions = [];
  for (const alpha of [0, 0.25, 0.50, 0.75]) {
    motion.prepare(alpha, 1 / 60);
    assert.equal(world.smoothMouse[0].x, alpha * 0.8);
    assert.equal(world.smoothMouse[1].y, alpha * 0.4);
    positions.push(orb.rotation.y);
    assert.equal(world.components.particles.mesh.material.uniforms.uSimulationAlpha.value, alpha);
    assert.equal(world.components.particles.mesh.material.uniforms.tPreviousPosition.value, 'previous');
    motion.restore();
    assert.equal(orb.rotation.y, 0.002);
    assert.equal(world.smoothMouse[0].x, 0.8);
    assert.equal(world.smoothMouse[1].y, 0.4);
    assert.equal(state.WebGL.globalUniforms.uTime.value, 1 / 60);
  }
  assert.deepEqual(positions, [0, 0.0005, 0.001, 0.0015]);
  assert.match(world.components.particles.mesh.material.vertexShader, /mix\(previousPosition,particlePosition,uSimulationAlpha\)/);
});

test('particle respawns retain current positions instead of blending across a reset', () => {
  assert.match(interpolateParticleShader(shader), /abs\(previousPosition.w-particlePosition.w\)<0.25/);
  assert.throws(() => interpolateParticleShader('changed shader'), /no longer exposes/);
});
