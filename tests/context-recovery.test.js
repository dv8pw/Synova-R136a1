import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseLostRenderTargets } from '../js/context-recovery.js';

test('context loss releases all retained targets once before restored resizing', () => {
  const disposed = [];
  const target = name => ({ isWebGLRenderTarget: true, dispose() { disposed.push(name); } });
  const scene = target('scene');
  const swap = target('swap');
  const bright = target('bloom bright');
  const horizontal = target('bloom horizontal');
  const vertical = target('bloom vertical');
  const clouds = target('clouds');
  const simulation = name => ({ renderTargets: { a: target(`${name} a`), b: target(`${name} b`) } });
  const state = { WebGL: {
    composer: { renderTarget1: scene, renderTarget2: swap,
      passes: [{ renderTargetBright: bright, renderTargetsHorizontal: [horizontal],
        renderTargetsVertical: [vertical], sharedTarget: scene, unrelated: {} }] },
    fluidSim: { advection: simulation('fluid'), options: {} },
  } };
  const world = { components: {
    orb: { cloudsRT: clouds },
    particles: { positionSim: simulation('particles'), velocitySim: simulation('velocity') },
    flares: { positionSim: simulation('flares') },
  } };
  releaseLostRenderTargets(state, world);
  assert.equal(disposed.length, 14);
  assert.equal(new Set(disposed).size, 14);
  assert.ok(disposed.includes('clouds'));
  assert.ok(disposed.includes('bloom vertical'));
  assert.ok(disposed.includes('velocity b'));
});
