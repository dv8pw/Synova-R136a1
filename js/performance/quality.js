import { S as state, viewportSubscribers } from '../context.js';
import sceneTuning from '../initial-values.js';
import { getActiveTheme } from '../themes.js';
import { QUALITY_STEPS } from './profiles.js';
export { QUALITY_STEPS } from './profiles.js';

export function effectiveQuality(step, dpr, iterations, counts) {
  const profile = QUALITY_STEPS[step];
  const baseDPR = Math.min(dpr, 2);
  return {
    pixelRatio: Math.min(baseDPR, Math.max(0.75, baseDPR * profile.dprMultiplier)),
    bloomScale: profile.bloomMultiplier,
    fxaaSamples: profile.fxaaSamples,
    fluidIterations: iterations === 0 ? 0 : Math.max(1, Math.ceil(iterations * profile.fluidIterationsMultiplier)),
    mainParticles: Math.floor(counts.main * profile.particleMultiplier),
    flareParticles: Math.floor(counts.flares * profile.particleMultiplier),
  };
}

export class QualityManager {
  constructor(world) {
    this.world = world;
    this.step = 0;
    this.requested = {};
    this.captureRequested();
  }

  captureRequested() {
    const fluid = sceneTuning['Global WebGL']['Fluid Sim'];
    this.requested.fluidIterations = fluid.fluid.iterations;
    this.requested.counts = {
      main: sceneTuning.LandingOrb.LandingOrbParticles.count ?? this.world.components.particles.ACTIVE_PARTICLE_COUNT,
      flares: sceneTuning.LandingOrb.LandingOrbFlareParticles.count ?? this.world.components.flares.ACTIVE_PARTICLE_COUNT,
    };
  }

  apply(step = this.step, resize = false) {
    this.step = step;
    this.effective = effectiveQuality(step, state.window.dpr, this.requested.fluidIterations, this.requested.counts);
    const webgl = state.WebGL;
    const ratioChanged = webgl.renderer.getPixelRatio() !== this.effective.pixelRatio;
    webgl.fluidSim.options.fluid.iterations = this.effective.fluidIterations;
    this.world.components.particles.mesh.count = this.effective.mainParticles;
    this.world.components.flares.mesh.count = this.effective.flareParticles;
    webgl.edgePass.uniforms.uSamples.value = this.effective.fxaaSamples;
    if (ratioChanged || resize) {
      webgl.renderer.setPixelRatio(this.effective.pixelRatio);
      webgl.renderer.setSize(state.window.w, state.window.h);
      webgl.composer.setPixelRatio(this.effective.pixelRatio);
      webgl.composer.setSize(state.window.w, state.window.h);
      webgl.renderer.getDrawingBufferSize(webgl.globalUniforms.uResolution.value);
      for (const hook of viewportSubscribers) hook();
    }
    // Composer sizing invokes every pass: apply the bloom reduction afterwards.
    const resolution = webgl.globalUniforms.uResolution.value;
    webgl.bloomPass.setSize(Math.max(1, Math.round(resolution.x * this.effective.bloomScale)),
      Math.max(1, Math.round(resolution.y * this.effective.bloomScale)));
  }

  snapshot() {
    const webgl = state.WebGL;
    return {
      theme: getActiveTheme().id,
      viewport: [state.window.w, state.window.h],
      renderDimensions: [webgl.globalUniforms.uResolution.value.x, webgl.globalUniforms.uResolution.value.y],
      devicePixelRatio: state.window.dpr,
      rendererPixelRatio: webgl.renderer.getPixelRatio(),
      qualityStep: this.step,
      qualitySteps: QUALITY_STEPS,
      requested: structuredClone(this.requested),
      effective: { ...this.effective },
      bloom: { enabled: webgl.bloomPass.enabled, strength: webgl.bloomPass.strength,
        threshold: webgl.bloomPass.threshold, radius: webgl.bloomPass.radius, resolutionScale: this.effective.bloomScale,
        tintColors: webgl.bloomPass.bloomTintColors?.map(color => color.toArray()) },
      fxaaSamples: webgl.edgePass.uniforms.uSamples.value,
      fluid: { textureWidth: webgl.fluidSim.options.textureWidth, ...webgl.fluidSim.options.fluid,
        uniforms: Object.fromEntries(Object.entries(webgl.fluidSim.options.simulationOpts.uniforms)
          .filter(([key]) => ['uMouseRadius', 'uCurlStrength', 'uDissipation', 'uClearValue', 'uViscosity', 'uPressure'].includes(key))
          .map(([key, uniform]) => [key, uniform.value])) },
      particleCounts: { main: this.world.components.particles.mesh.count, flares: this.world.components.flares.mesh.count },
      costlyFeatures: { clouds: true, fluid: true, particles: true, bloom: webgl.bloomPass.enabled,
        finishing: webgl.compositePass.uniforms.uEnabled.value },
      postProcessing: Object.fromEntries(Object.entries(webgl.compositePass.uniforms)
        .filter(([name]) => name.startsWith('u')).map(([name, uniform]) => [name,
          uniform.value?.isColor ? uniform.value.getHex() : uniform.value?.toArray ? uniform.value.toArray() : uniform.value])),
      cameraBasePosition: this.world.activeCamera._position?.toArray(),
      tuning: structuredClone({ scene: sceneTuning, motion: state.motion, opening: state.opening }),
    };
  }
}
