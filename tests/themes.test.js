import test from 'node:test';
import assert from 'node:assert/strict';
import { themes, getSceneThemeValues } from '../js/themes.js';

test('all scene themes keep inner particles visible without the tuning panel', () => {
  for (const theme of themes) {
    const scene = getSceneThemeValues(theme).LandingOrb;
    const shell = scene['Landing Orb'];
    assert.ok(shell.uniforms.uOpacity < 1, `${theme.id}: shell is translucent`);
    assert.equal(shell.material.transparent, true, `${theme.id}: shell must blend`);
    assert.equal(shell.material.depthWrite, false, `${theme.id}: shell cannot hide interior particles`);
    assert.equal(scene.LandingOrbParticles.material.transparent, true, `${theme.id}: particle alpha must blend`);
  }
});
