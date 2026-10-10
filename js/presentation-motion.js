import { STEP_SECONDS } from './animation-clock.js';

export const interpolate = (previous, current, alpha) => previous + (current - previous) * alpha;

export function interpolateParticleShader(source) {
  const declaration = 'uniform sampler2D tPosition;';
  const fetch = 'vec4 particlePosition=texture2D(tPosition,aFboUv);';
  if (!source.includes(declaration) || !source.includes(fetch)) {
    throw new Error('The particle shader no longer exposes its simulation position.');
  }
  return source.replace(declaration,
    declaration + 'uniform sampler2D tPreviousPosition;uniform float uSimulationAlpha;')
    .replace(fetch, fetch + 'vec4 previousPosition=texture2D(tPreviousPosition,aFboUv);'
      + 'if(abs(previousPosition.w-particlePosition.w)<0.25){'
      + 'particlePosition=mix(previousPosition,particlePosition,uSimulationAlpha);}');
}

// GPU simulations retain fixed steps. Presentation interpolates their existing ping-pong
// textures and rotations, and draws procedural clouds at the presentation cadence.
export class PresentationMotion {
  constructor(state, world) {
    this.state = state;
    this.world = world;
    const orb = world.components.orb;
    this.values = [
      { object: orb.rotation, key: 'y' },
      { object: world.components.particles.mesh.rotation, key: 'y' },
      { object: orb.mainMaterial.uniforms.uCloudPhase, key: 'value' },
      ...(world.smoothMouse || []).flatMap(object => [{ object, key: 'x' }, { object, key: 'y' }]),
    ];
    orb.update = () => {
      const multiplier = 1 + 2 * state.pointerActivity;
      orb.rotation.y += state.motion.orbRotationSpeed * multiplier * state.WebGL.clockDelta;
      orb.mainMaterial.uniforms.uCloudPhase.value += orb.mainMaterial.uniforms.uCloudNoiseSpeed.value
        * multiplier * state.WebGL.clockDelta;
    };
    this.particles = [world.components.particles, world.components.flares];
    for (const component of this.particles) {
      const material = component.mesh.material;
      material.vertexShader = interpolateParticleShader(material.vertexShader);
      material.uniforms.tPreviousPosition = { value: component.positionSim.texture };
      material.uniforms.uSimulationAlpha = { value: 1 };
      material.needsUpdate = true;
      const depth = component.mesh.customDepthMaterial;
      if (depth) {
        depth.vertexShader = material.vertexShader;
        depth.uniforms.tPreviousPosition = material.uniforms.tPreviousPosition;
        depth.uniforms.uSimulationAlpha = material.uniforms.uSimulationAlpha;
        depth.needsUpdate = true;
      }
    }
    this.reset();
  }

  reset() {
    for (const value of this.values) value.previous = value.current = value.object[value.key];
  }

  beforeStep() {
    for (const value of this.values) value.previous = value.object[value.key];
  }

  afterStep() {
    for (const value of this.values) value.current = value.object[value.key];
  }

  prepare(alpha, simulationSeconds) {
    this.savedTime = this.state.WebGL.globalUniforms.uTime.value;
    this.state.WebGL.globalUniforms.uTime.value = Math.max(0, simulationSeconds - STEP_SECONDS + alpha * STEP_SECONDS);
    for (const value of this.values) value.object[value.key] = interpolate(value.previous, value.current, alpha);
    for (const component of this.particles) {
      component.mesh.material.uniforms.tPreviousPosition.value = component.positionSim.alternateTexture || component.positionSim.texture;
      component.mesh.material.uniforms.uSimulationAlpha.value = alpha;
    }
  }

  renderClouds() {
    const orb = this.world.components.orb;
    const renderer = this.state.WebGL.renderer;
    const target = renderer.getRenderTarget();
    orb.material = orb.cloudsMaterial;
    try {
      renderer.setRenderTarget(orb.cloudsRT);
      renderer.render(orb, this.world.activeCamera);
    } finally {
      renderer.setRenderTarget(target);
      orb.material = orb.mainMaterial;
    }
    orb.mainMaterial.uniforms.tClouds.value = orb.cloudsRT.texture;
  }

  restore() {
    for (const value of this.values) value.object[value.key] = value.current;
    // Simulations read model matrices on the next fixed step. Do not leave the
    // interpolated presentation pose in those matrices after restoring rotation.
    this.world.components.orb.updateMatrixWorld?.(true);
    for (const component of this.particles) component.mesh.updateMatrixWorld?.(true);
    this.state.WebGL.globalUniforms.uTime.value = this.savedTime;
  }
}
