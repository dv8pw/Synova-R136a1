import { ke as Color } from './renderer.js';

function simulationTargets(state, world) {
  return [...Object.values(state.WebGL.fluidSim).filter(value => value?.renderTargets),
    ...[world.components.particles, world.components.flares].flatMap(component =>
      [component.positionSim, component.velocitySim].filter(Boolean))];
}

// Three recreates its resource caches on restoration. Dispose target handles
// while the old context is lost, so their old disposal listeners cannot delete
// stale handles when the retained targets are resized in the restored context.
export function releaseLostRenderTargets(state, world) {
  const composer = state.WebGL.composer;
  const targets = new Set([
    composer.renderTarget1, composer.renderTarget2, world.components.orb.cloudsRT,
    ...composer.passes.flatMap(pass => Object.values(pass).flatMap(value =>
      Array.isArray(value) ? value : [value])).filter(value => value?.isWebGLRenderTarget),
    ...simulationTargets(state, world).flatMap(simulation =>
      [simulation.renderTargets.a, simulation.renderTargets.b]),
  ]);
  for (const target of targets) target?.dispose();
}

// WebGL recreates texture objects after restoration; ping-pong simulation contents
// must also be initialized before those textures are used as inputs again.
export function reseedSimulationTargets(state, world) {
  const renderer = state.WebGL.renderer;
  const target = renderer.getRenderTarget();
  const color = renderer.getClearColor(new Color()).clone();
  const alpha = renderer.getClearAlpha();
  const simulations = simulationTargets(state, world);
  try {
    renderer.setClearColor(0, 0);
    for (const simulation of simulations) {
      for (const buffer of [simulation.renderTargets.a, simulation.renderTargets.b].filter(Boolean)) {
        renderer.setRenderTarget(buffer);
        renderer.clear(true, false, false);
      }
    }
    for (const component of [world.components.particles, world.components.flares]) {
      for (const simulation of [component.positionSim, component.velocitySim].filter(Boolean)) {
        if (!simulation.originalTexture) continue;
        simulation.originalTexture.needsUpdate = true;
        for (const name of ['tTexture', 'tPrevTexture', 'tOriginalTexture']) {
          if (simulation.uniforms[name]) simulation.uniforms[name].value = simulation.originalTexture;
        }
        const setup = simulation.uniforms.uSetup;
        const previous = setup?.value;
        if (setup) setup.value = 1;
        simulation.update(false);
        simulation.update(false);
        if (setup) setup.value = previous;
      }
      component.mesh.material.uniforms.tPosition.value = component.positionSim.texture;
      if (component.velocitySim) component.mesh.material.uniforms.tVelocity.value = component.velocitySim.texture;
    }
  } finally {
    renderer.setRenderTarget(target);
    renderer.setClearColor(color, alpha);
  }
}
