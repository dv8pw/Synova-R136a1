import { S as runtimeState, drainAnimationQueue } from './context.js';
import sceneTuning from './initial-values.js';
import { assembleControlWorkspace } from './static-settings.js';
import { composeEntranceMotion } from './intro.js';
import { installImageEffects } from './passes.js';
import { applyTheme } from './theme-picker.js';
import { getActiveTheme } from './themes.js';
import { AnimationClock, PresentationClock, STEP_SECONDS } from './animation-clock.js';
import { PointerEnergy } from './pointer-energy.js';
import { createOpeningReveal } from './opening-reveal.js';
import { createTitleIntroduction } from './title-introduction.js';
import { PresentationMotion } from './presentation-motion.js';
import { releaseLostRenderTargets, reseedSimulationTargets } from './context-recovery.js';
import { startCadenceProbe } from './performance/cadence.js';
import { PerformanceMonitor, normalizeCadence } from './performance/monitor.js';
import { QualityManager } from './performance/quality.js';
import { installPerformancePanel, updatePerformancePanel } from './performance/panel.js';
import {
  Tce as WorldDirector, qne as WebGLRenderer, Cre as EffectComposer,
  wle as FluidSimulation, efe as TheatreBridge, dr as gsap,
  Re as Vector2, li as WebGLRenderTarget, nn as HalfFloatType,
  eo as KTX2Loader, xn as Texture, Fs as LinearMipmapLinearFilter, Yt as LinearFilter,
  ti as RepeatWrapping, mi as LinearSRGBColorSpace, Wx as UVMapping,
  jue as SortedPassRegistry, zo as VarianceShadowMap, xue as configureShaderLibrary,
} from './renderer.js';

const backdrop = document.querySelector('#visual-background');
const heading = document.querySelector('h1');
const clock = new AnimationClock();
const energy = new PointerEnergy(runtimeState.motion);
const presentationClock = new PresentationClock();
let gpuPainter, renderPipeline, worldController, titleIntroduction;
let presentationMotion, qualityManager, performanceMonitor, refreshProbe, cadence;
let checkingRefresh = false;
let contextLost = false;
let hiddenAt = null;
let probeGeneration = 0;
let lastDprCheck = 0;
let sceneStarted = false;
let sceneReady = false;
let openingComplete = false;
let openingInProgress = true;
let pendingRefreshReason = null;
let stopped = false;
let decoder;
const reveal = createOpeningReveal(runtimeState, {
  onStart: () => {
    window.dispatchEvent(new Event('synova-r136a1:opening-start'));
  },
  onProgress: progress => {
    worldController.entranceProgress = progress;
    worldController.introAnimation.totalProgress(progress).pause();
  },
  onFinish: () => window.dispatchEvent(new Event('synova-r136a1:opening-complete')),
});

runtimeState.replayOpening = () => {
  if (!sceneReady) return;
  window.dispatchEvent(new Event('synova-r136a1:opening-start'));
  worldController.entranceProgress = 0;
  worldController.introAnimation.totalProgress(0).pause();
  reveal.replay(clock.seconds);
};
if (new URLSearchParams(location.search).has('perf')) installPerformancePanel();
document.addEventListener('visibilitychange', () => {
  clock.pause();
  presentationClock.pause();
  energy.reset();
  if (document.hidden) {
    hiddenAt = performance.now();
    refreshProbe?.cancel();
    if (openingComplete) performanceMonitor?.suspend('Hidden');
  } else if (sceneReady && !contextLost && openingComplete && !openingInProgress) {
    if (performance.now() - (hiddenAt ?? performance.now()) >= 1000) void recheckRefresh('Return from hidden page');
    else performanceMonitor?.invalidate('Visibility resumed', { resetController: false });
  }
});

window.addEventListener('synova-r136a1:opening-start', () => {
  openingInProgress = true;
  titleIntroduction?.reset();
  performanceMonitor?.suspend('Opening reveal');
});

window.addEventListener('synova-r136a1:opening-complete', () => {
  titleIntroduction?.start(clock.seconds);
  if (!performanceMonitor || contextLost || !sceneReady) return;
  openingInProgress = false;
  if (!openingComplete) {
    openingComplete = true;
    performanceMonitor.start(performance.now(), true);
  } else if (!document.hidden && !performanceMonitor.active) {
    applyCadenceMeasurement('Opening reveal complete', cadence);
  }
  if (pendingRefreshReason && !document.hidden) void recheckRefresh(pendingRefreshReason);
});

try {
  await initializeScene();
} catch (error) {
  stopped = true;
  decoder?.dispose();
  reveal.fail();
  console.error('Synova-R136a1 scene initialization failed:', error);
}

async function initializeScene() {
  gsap.ticker.remove(gsap.updateRoot);
  cadence = normalizeCadence(await probeVisibleCadence());
  presentationClock.configure(cadence.observedRefreshHz, cadence.targetRefreshHz, cadence.targetRefreshHz);
  captureViewport();
  runtimeState.pointer.gl = new Vector2();
  runtimeState.pointer.glNormalized = new Vector2();
  runtimeState.pointer.glScreenSpace = new Vector2();
  runtimeState.theatre.project = assembleControlWorkspace(sceneTuning);
  runtimeState.theatre.helper = new TheatreBridge();
  runtimeState.theatre.sheets['Global WebGL'] = runtimeState.theatre.project.sheet('Global WebGL');

  gpuPainter = new WebGLRenderer({ alpha: false, antialias: false, canvas: backdrop,
    powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: true });
  gpuPainter.setPixelRatio(Math.min(runtimeState.window.dpr, 2));
  gpuPainter.setSize(runtimeState.window.w, runtimeState.window.h);
  gpuPainter.info.autoReset = false;
  gpuPainter.shadowMap.enabled = false;
  gpuPainter.shadowMap.autoUpdate = false;
  gpuPainter.shadowMap.type = VarianceShadowMap;
  gpuPainter.debug.onShaderError = () => { throw new Error('A WebGL shader could not compile.'); };
  renderPipeline = new EffectComposer(gpuPainter, new WebGLRenderTarget(
    runtimeState.window.w, runtimeState.window.h, { type: HalfFloatType }));
  renderPipeline.setSize(runtimeState.window.w, runtimeState.window.h);
  runtimeState.WebGL = {
    renderer: gpuPainter, composer: renderPipeline,
    composerPasses: new SortedPassRegistry(renderPipeline.passes),
    composerPassOrder: { 'landing-orb': 0, postfx: 200 },
    globalUniforms: {
      uDelta: { value: STEP_SECONDS }, uNormalizedDelta: { value: 1 }, uTime: { value: 0 },
      uResolution: { value: new Vector2(runtimeState.window.w * gpuPainter.getPixelRatio(),
        runtimeState.window.h * gpuPainter.getPixelRatio()) },
      uDevCameraActive: { value: false },
    },
    generateTexture: configureSurface, clockDelta: STEP_SECONDS, normalizedDelta: 1,
    animationClock: clock,
  };
  configureShaderLibrary();
  requestAnimationFrame(animate);

  decoder = new KTX2Loader();
  // Resolve the decoder directory from the page: Vite rewrites module-relative directories.
  decoder.setTranscoderPath(new URL('./assets/basis/', document.baseURI).href);
  decoder.detectSupport(gpuPainter);
  const assetPromises = [];
  runtimeState.AssetLoader = {
    loadTexture(resourceLocator, samplingProfile) {
      const promise = decoder.loadAsync(new URL('../assets/normal-map-sphere.ktx2', import.meta.url).href)
        .then(asset => configureSurface(asset, samplingProfile));
      assetPromises.push(promise);
      return promise;
    },
  };
  const fluid = new FluidSimulation({ simulationOpts: { uniforms: {} }, fluid: { force: 10.06, forceClamp: 20.3 } });
  runtimeState.WebGL.fluidSim = fluid;
  const profile = sceneTuning['Global WebGL']['Fluid Sim'];
  Object.assign(fluid.options.fluid, profile.fluid);
  for (const [key, value] of Object.entries(profile.simulation)) {
    fluid.options.simulationOpts.uniforms['u' + key[0].toUpperCase() + key.slice(1)].value = value;
  }
  installImageEffects();
  worldController = new WorldDirector();
  runtimeState.WebGL.worldController = worldController;
  await Promise.all(assetPromises);
  await document.fonts.ready;
  worldController.build();
  await Promise.all(assetPromises);
  decoder.dispose();
  decoder = null;

  titleIntroduction = createTitleIntroduction(heading, gsap, {
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  });
  composeEntranceMotion(worldController);
  worldController.start();
  worldController.introAnimation.pause(0);
  fluid.addEvents();
  applyTheme(getActiveTheme());
  qualityManager = new QualityManager(worldController);
  runtimeState.WebGL.qualityManager = qualityManager;
  qualityManager.apply(0);
  presentationMotion = new PresentationMotion(runtimeState, worldController);
  backdrop.style.opacity = '0.98';
  backdrop.style.visibility = 'visible';
  sceneStarted = true;
  // Initialize cloud/particle/flare targets before exposing the first screen frame.
  await warmScene(STEP_SECONDS);
  if (gpuPainter.getContext().isContextLost()) throw new Error('The WebGL context was lost.');
  sceneReady = true;
  performanceMonitor = new PerformanceMonitor({ gl: gpuPainter.getContext(), cadence,
    getWorkload: () => qualityManager.snapshot(),
    onProfile: (targetHz, step) => {
      qualityManager.apply(step);
      const refresh = performanceMonitor.cadence;
      presentationClock.configure(refresh.observedRefreshHz, refresh.targetRefreshHz, targetHz);
    },
    onProbe: reason => { void recheckRefresh(reason); },
  });
  runtimeState.WebGL.performance = performanceMonitor;
  reveal.markReady();
  window.dispatchEvent(new Event('synova-r136a1:scene-ready'));
  installInput();
}

function simulate(deltaSeconds, seconds, timestamp) {
  presentationMotion?.beforeStep();
  const webgl = runtimeState.WebGL;
  webgl.clockDelta = deltaSeconds;
  webgl.normalizedDelta = deltaSeconds * 60;
  webgl.globalUniforms.uDelta.value = deltaSeconds;
  webgl.globalUniforms.uNormalizedDelta.value = deltaSeconds * 60;
  webgl.globalUniforms.uTime.value = seconds;
  runtimeState.pointerActivity = energy.advance(deltaSeconds, timestamp);
  gpuPainter.info.reset();
  drainAnimationQueue(seconds * 1000);
  presentationMotion?.afterStep();
}

function animate(timestamp) {
  if (stopped) return;
  const callbackStart = performance.now();
  try {
    if (!document.hidden && !checkingRefresh && !contextLost) {
      performanceMonitor?.beforeCallback(timestamp);
      if (checkingRefresh) { requestAnimationFrame(animate); return; }
      let simulationToken;
      const frame = clock.advance(timestamp, (delta, seconds) => {
        if (!simulationToken) simulationToken = performanceMonitor?.beginPhase('simulation');
        simulate(delta, seconds, timestamp);
      });
      performanceMonitor?.endPhase(simulationToken, frame.steps ?? 0);
      if (frame.paused) energy.reset();
      if (sceneStarted) { gsap.updateRoot(clock.seconds); reveal.update(clock.seconds); titleIntroduction?.update(clock.seconds); }
      const presentation = sceneReady && frame.render ? presentationClock.advance(timestamp) : { render: false };
      if (presentation.render) {
        const token = performanceMonitor?.beginPhase('presentation');
        presentationMotion.prepare(frame.alpha, clock.simulationSeconds);
        worldController.updateCameras();
        try {
          presentationMotion.renderClouds();
          renderPipeline.render(presentation.elapsedSeconds || STEP_SECONDS);
        } finally { presentationMotion.restore(); }
        performanceMonitor?.endPhase(token);
        performanceMonitor?.presentedFrame(timestamp);
      }
      if (sceneReady && openingComplete && !openingInProgress && performanceMonitor?.active && timestamp - lastDprCheck >= 250) {
        lastDprCheck = timestamp;
        if (devicePixelRatio !== runtimeState.window.dpr) {
          captureViewport();
          qualityManager.apply(qualityManager.step, true);
          void recheckRefresh('Device pixel ratio changed');
        }
      }
    }
    updatePerformancePanel(timestamp);
    performanceMonitor?.afterCallback(callbackStart);
    requestAnimationFrame(animate);
  } catch (error) {
    stopped = true;
    reveal.fail();
    console.error('Synova-R136a1 rendering failed:', error);
  }
}

function installInput() {
  window.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.target.closest?.('[data-synova-r136a1-ui], #opening-reveal')) return;
    energy.leave();
    trackCursor(event);
  }, { passive: true });
  window.addEventListener('pointermove', event => {
    if (!event.isPrimary) return;
    if (event.target.closest?.('[data-synova-r136a1-ui], #opening-reveal')) { energy.leave(); return; }
    const coalesced = event.getCoalescedEvents?.();
    for (const sample of coalesced?.length ? coalesced : [event]) {
      let timestamp = sample.timeStamp || performance.now();
      if (timestamp > 1e12) timestamp -= performance.timeOrigin;
      energy.sample(sample.clientX, sample.clientY, timestamp,
        Math.hypot(runtimeState.window.w, runtimeState.window.h));
    }
    trackCursor(event);
  }, { passive: true });
  window.addEventListener('dragover', trackCursor, { passive: true });
  document.documentElement.addEventListener('pointerenter', () => energy.leave(), { passive: true });
  document.documentElement.addEventListener('pointerleave', () => energy.leave(), { passive: true });
  window.addEventListener('pointercancel', () => energy.leave(), { passive: true });
  window.addEventListener('pointerup', event => { if (event.pointerType !== 'mouse') energy.leave(); }, { passive: true });
  const workloadChanged = reason => {
    energy.reset();
    qualityManager.captureRequested();
    qualityManager.apply(qualityManager.step);
    presentationMotion.reset();
    if (openingComplete && !openingInProgress && performanceMonitor?.active && !checkingRefresh && !contextLost) {
      performanceMonitor.invalidate(reason, { resetController: false });
    }
  };
  window.addEventListener('synova-r136a1:theme-applied', () => workloadChanged('Theme changed'));
  window.addEventListener('synova-r136a1:tuning-changed', () => workloadChanged('Visual tuning changed'));
  let viewportHold;
  window.addEventListener('resize', () => {
    clearTimeout(viewportHold);
    energy.leave();
    viewportHold = setTimeout(() => {
      const dprChanged = devicePixelRatio !== runtimeState.window.dpr;
      captureViewport();
      qualityManager.apply(qualityManager.step, true);
      if (!openingComplete || openingInProgress || !performanceMonitor?.active || contextLost) return;
      if (dprChanged) void recheckRefresh('Device pixel ratio changed');
      else performanceMonitor.invalidate('Viewport changed', { resetController: false });
    }, 100);
  });
  backdrop.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    contextLost = true;
    sceneReady = false;
    clock.pause();
    presentationClock.pause();
    refreshProbe?.cancel();
    probeGeneration++;
    performanceMonitor.suspend('WebGL context lost');
    releaseLostRenderTargets(runtimeState, worldController);
  });
  backdrop.addEventListener('webglcontextrestored', async () => {
    const generation = probeGeneration + 1;
    const isCurrent = () => generation === probeGeneration && !gpuPainter.getContext().isContextLost();
    try {
      const measurement = await probeVisibleCadence();
      if (!measurement || !isCurrent()) return;
      const nextCadence = normalizeCadence(measurement);
      reseedSimulationTargets(runtimeState, worldController);
      qualityManager.apply(qualityManager.step, true);
      await warmScene(0, isCurrent);
      if (!isCurrent()) return;
      performanceMonitor.replaceContext(gpuPainter.getContext());
      contextLost = false;
      sceneReady = true;
      clock.pause();
      energy.reset();
      if (openingComplete && !openingInProgress && !document.hidden) {
        applyCadenceMeasurement('WebGL context restored', nextCadence);
      } else {
        cadence = nextCadence;
        performanceMonitor.cadence = nextCadence;
        presentationClock.configure(nextCadence.observedRefreshHz, nextCadence.targetRefreshHz,
          openingComplete ? performanceMonitor.targetHz : nextCadence.targetRefreshHz);
        performanceMonitor.suspend(document.hidden ? 'Hidden' : 'Opening reveal');
      }
    } catch (error) {
      if (!isCurrent()) return;
      stopped = true;
      reveal.fail();
      console.error('Synova-R136a1 context restoration failed:', error);
    }
  });
}

async function probeVisibleCadence() {
  refreshProbe?.cancel();
  const generation = ++probeGeneration;
  while (true) {
    if (document.hidden) await new Promise(resolve => {
      const visible = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', visible); resolve(); } };
      document.addEventListener('visibilitychange', visible);
    });
    if (generation !== probeGeneration) return null;
    const probe = startCadenceProbe();
    refreshProbe = probe;
    const measurement = await probe.promise;
    if (refreshProbe === probe) refreshProbe = null;
    if (generation !== probeGeneration) return null;
    if (!measurement.cancelled) return measurement;
  }
}

async function recheckRefresh(reason) {
  if (contextLost || !sceneReady) return;
  if (!openingComplete || openingInProgress) { pendingRefreshReason = reason; return; }
  if (checkingRefresh) return;
  pendingRefreshReason = null;
  checkingRefresh = true;
  clock.pause();
  presentationClock.pause();
  energy.reset();
  performanceMonitor.suspend(`Probing refresh: ${reason}`);
  try {
    const measurement = await probeVisibleCadence();
    if (measurement && !contextLost) {
      if (!openingInProgress && !document.hidden) applyCadenceMeasurement(reason, measurement);
      else {
        cadence = normalizeCadence(measurement);
        performanceMonitor.cadence = cadence;
      }
    }
  } finally {
    checkingRefresh = false;
    clock.pause();
    presentationClock.pause();
    presentationMotion.reset();
  }
}

function applyCadenceMeasurement(reason, measurement) {
  const nextCadence = normalizeCadence(measurement);
  const previousNative = performanceMonitor?.controller.nativeHz ?? cadence?.targetRefreshHz;
  const nativeChanged = Number.isFinite(previousNative)
    && Math.abs(previousNative - nextCadence.targetRefreshHz) > 0.001;
  cadence = nextCadence;
  if (performanceMonitor) {
    performanceMonitor.invalidate(reason, { cadence: nextCadence, resetController: nativeChanged });
  }
}

async function warmScene(delta, isCurrent = () => true) {
  simulate(delta, clock.simulationSeconds, performance.now());
  presentationMotion.reset();
  if (gpuPainter.compileAsync) await gpuPainter.compileAsync(worldController, worldController.activeCamera);
  else gpuPainter.compile(worldController, worldController.activeCamera);
  if (!isCurrent()) return;
  presentationMotion.prepare(1, clock.simulationSeconds);
  worldController.updateCameras();
  try {
    presentationMotion.renderClouds();
    renderPipeline.render(STEP_SECONDS);
  } finally { presentationMotion.restore(); }
}

function captureViewport() {
  runtimeState.window.w = innerWidth;
  runtimeState.window.h = innerHeight;
  runtimeState.window.dpr = devicePixelRatio;
}
function trackCursor(event) {
  const { clientX: x, clientY: y } = event;
  runtimeState.pointer.x = x;
  runtimeState.pointer.y = y;
  runtimeState.pointer.gl.set(x - runtimeState.window.w / 2, -y + runtimeState.window.h / 2);
  runtimeState.pointer.glNormalized.set(x / runtimeState.window.w * 2 - 1, -y / runtimeState.window.h * 2 + 1);
  runtimeState.pointer.glScreenSpace.set(x / runtimeState.window.w, 1 - y / runtimeState.window.h);
}
function configureSurface(asset, sampling = {}) {
  if (asset instanceof HTMLImageElement) asset = new Texture(asset);
  asset.minFilter = sampling.minFilter || LinearMipmapLinearFilter;
  asset.magFilter = sampling.magFilter || LinearFilter;
  asset.wrapS = asset.wrapT = sampling.wrapping || RepeatWrapping;
  asset.flipY = sampling.flipY !== undefined ? sampling.flipY : true;
  asset.colorSpace = sampling.colorSpace || LinearSRGBColorSpace;
  asset.mapping = sampling.mapping || UVMapping;
  if (!asset.isCompressedTexture) asset.generateMipmaps = sampling.generateMipmaps !== undefined ? sampling.generateMipmaps : true;
  asset.anisotropy = sampling.anisotropy || 1;
  gpuPainter.initTexture(asset);
  return asset;
}
