import { S as runtimeState } from './context.js';
import sceneTuning from './initial-values.js';
import { applyImageEffectsTheme } from './passes.js';
import { getActiveTheme, getSceneThemeValues } from './themes.js';
import { getFloatingWindowManager } from './ui/floating-window.js';
import { installInteractionRouter } from './ui/interaction-router.js';

const PANEL_ID = 'tuning-panel';
const MAX_PARTICLES = 65536;
const MAX_FLARES = 9216;

let panel;
let controls = new Map();
let activeTheme = getActiveTheme();
let workingTheme = cloneValues(activeTheme);
let baseline;
const immutableConfigBaseline = cloneValues(sceneTuning);
const immutableMotionBaseline = cloneValues(runtimeState.motion || {});
const immutableOpeningBaseline = cloneValues(runtimeState.opening || {});
let immutableLiveBaseline;
let immutableMaterialDefaults = {};
let sceneMaterialDefaults = {};

const scenePaths = {
  orb: ['LandingOrb', 'Landing Orb'],
  particles: ['LandingOrb', 'LandingOrbParticles'],
  flareParticles: ['LandingOrb', 'LandingOrbFlareParticles'],
  camera: ['LandingOrb', 'Cameras / Settings'],
  fluid: ['Global WebGL', 'Fluid Sim'],
};

const CONTROL_DEFINITIONS = [
  {
    id: 'random-highlight-selection', label: 'Synova-R136a1 Selection threshold', group: 'Theme',
    min: 0, max: 1, step: 0.001,
    get: () => numberAt(valueAt(['particles', 'randomHighlightSelection'], sceneValue(scenePaths.particles, ['uniforms', 'uRandomHighlightSelect'], 0.975)), 0.975),
    set: value => {
      setThemeValue(['particles', 'randomHighlightSelection'], value);
      setSceneValue(scenePaths.particles, ['uniforms', 'uRandomHighlightSelect'], value);
      applyThemeEffects();
    },
  },
  {
    id: 'orb-opacity', label: 'Orb opacity', group: 'Theme', min: 0, max: 1, step: 0.01,
    get: () => numberAt(valueAt(['orb', 'surfaceOpacity'], sceneValue(scenePaths.orb, ['uniforms', 'uOpacity'], 1)), 1),
    set: value => {
      setThemeValue(['orb', 'surfaceOpacity'], value);
      setVisualOpacity(scenePaths.orb, value);
    },
  },
  {
    id: 'particle-opacity', label: 'Particle opacity', group: 'Theme', min: 0, max: 1, step: 0.01,
    get: () => numberAt(valueAt(['particles', 'opacity'], sceneValue(scenePaths.particles, ['uniforms', 'uOpacity'], 1)), 1),
    set: value => {
      setThemeValue(['particles', 'opacity'], value);
      setVisualOpacity(scenePaths.particles, value);
    },
  },
  {
    id: 'soft-bloom-strength', label: 'Bloom strength', group: 'Bloom', min: 0, max: 3, step: 0.01,
    get: () => numberAt(valueAt(activeBloomPath('strength'), 0), 0),
    set: value => setBloomValue('strength', value),
  },
  {
    id: 'soft-bloom-threshold', label: 'Bloom threshold', group: 'Bloom', min: 0, max: 3, step: 0.01,
    get: () => numberAt(valueAt(activeBloomPath('threshold'), 0), 0),
    set: value => setBloomValue('threshold', value),
  },
  {
    id: 'soft-bloom-radius', label: 'Bloom radius', group: 'Bloom', type: 'number', min: 0, max: 1, step: 0.01,
    get: () => numberAt(valueAt(activeBloomPath('radius'), 0), 0),
    set: value => setBloomValue('radius', value),
    // Theme baselines can exceed the editor range; reset preserves the canonical value.
    reset: value => {
      setThemeValue(activeBloomPath('radius'), value);
      applyThemeEffects();
    },
  },
  {
    id: 'chromatic-distortion', label: 'Chromatic distortion', group: 'Theme', min: 0, max: 2, step: 0.01,
    get: () => numberAt(valueAt(['postProcessing', 'frame', 'chromaticAberrationMaximumDistortion'], 0), 0),
    set: value => {
      setThemeValue(['postProcessing', 'frame', 'chromaticAberrationMaximumDistortion'], value);
      applyThemeEffects();
    },
  },
  {
    id: 'cloud-smoothing-start', label: 'Cloud smoothing start', group: 'Orb', min: 0, max: 1, step: 0.001,
    get: () => numberAt(sceneValue(scenePaths.orb, ['uniforms', 'uCloudsSmoothstep', 'x'], 0), 0),
    set: value => setSceneValue(scenePaths.orb, ['uniforms', 'uCloudsSmoothstep', 'x'], value),
  },
  {
    id: 'cloud-smoothing-end', label: 'Cloud smoothing end', group: 'Orb', min: 0, max: 1, step: 0.001,
    get: () => numberAt(sceneValue(scenePaths.orb, ['uniforms', 'uCloudsSmoothstep', 'y'], 1), 1),
    set: value => setSceneValue(scenePaths.orb, ['uniforms', 'uCloudsSmoothstep', 'y'], value),
  },
  {
    id: 'main-particle-size', label: 'Main particle size', group: 'Particles', min: 0, max: 2, step: 0.001,
    get: () => numberAt(sceneValue(scenePaths.particles, ['uniforms', 'uParticleSize'], 0.36), 0.36),
    set: value => setSceneValue(scenePaths.particles, ['uniforms', 'uParticleSize'], value),
  },
  {
    id: 'flare-particle-size', label: 'Flare particle size', group: 'Particles', min: 0, max: 2, step: 0.001,
    get: () => numberAt(sceneValue(scenePaths.flareParticles, ['uniforms', 'uParticleSize'], 0.307), 0.307),
    set: value => setSceneValue(scenePaths.flareParticles, ['uniforms', 'uParticleSize'], value),
  },
  {
    id: 'main-particle-decay', label: 'Main particle decay', group: 'Particles', min: 0, max: 2, step: 0.001,
    get: () => numberAt(sceneValue(scenePaths.particles, ['simulation', 'uniforms', 'uDecay'], 0), 0),
    set: value => setSceneValue(scenePaths.particles, ['simulation', 'uniforms', 'uDecay'], value),
  },
  {
    id: 'main-particle-decay-2', label: 'Main particle decay 2', group: 'Particles', min: 0, max: 2, step: 0.001,
    get: () => numberAt(sceneValue(scenePaths.particles, ['simulation', 'uniforms', 'uDecay2'], 0), 0),
    set: value => setSceneValue(scenePaths.particles, ['simulation', 'uniforms', 'uDecay2'], value),
  },
  {
    id: 'flare-particle-decay', label: 'Flare particle decay', group: 'Particles', min: 0, max: 2, step: 0.001,
    get: () => numberAt(sceneValue(scenePaths.flareParticles, ['simulation', 'uniforms', 'uDecay'], 0), 0),
    set: value => setSceneValue(scenePaths.flareParticles, ['simulation', 'uniforms', 'uDecay'], value),
  },
  {
    id: 'main-particle-count', label: 'Main particle count', group: 'Particles', min: 1, max: MAX_PARTICLES, step: 1,
    get: () => getParticleCount(false),
    set: value => setParticleCount(false, value),
  },
  {
    id: 'flare-particle-count', label: 'Flare particle count', group: 'Particles', min: 1, max: MAX_FLARES, step: 1,
    get: () => getParticleCount(true),
    set: value => setParticleCount(true, value),
  },
  {
    id: 'fluid-mouse-radius', label: 'Fluid mouse radius', group: 'Fluid', min: 0, max: 2, step: 0.001,
    get: () => numberAt(fluidValue('simulation', 'mouseRadius'), 0),
    set: value => setFluidValue('simulation', 'mouseRadius', value),
  },
  {
    id: 'fluid-curl-strength', label: 'Fluid curl strength', group: 'Fluid', min: 0, max: 4, step: 0.001,
    get: () => numberAt(fluidValue('simulation', 'curlStrength'), 0),
    set: value => setFluidValue('simulation', 'curlStrength', value),
  },
  {
    id: 'fluid-dissipation', label: 'Fluid dissipation', group: 'Fluid', min: 0, max: 1, step: 0.001,
    get: () => numberAt(fluidValue('simulation', 'dissipation'), 0),
    set: value => setFluidValue('simulation', 'dissipation', value),
  },
  {
    id: 'fluid-clear-value', label: 'Fluid clear value', group: 'Fluid', min: 0, max: 1, step: 0.001,
    get: () => numberAt(fluidValue('simulation', 'clearValue'), 0),
    set: value => setFluidValue('simulation', 'clearValue', value),
  },
  {
    id: 'fluid-viscosity', label: 'Fluid viscosity', group: 'Fluid', min: 0, max: 2, step: 0.001,
    get: () => numberAt(fluidValue('simulation', 'viscosity'), 0),
    set: value => setFluidValue('simulation', 'viscosity', value),
  },
  {
    id: 'fluid-pressure', label: 'Fluid pressure', group: 'Fluid', min: 0, max: 2, step: 0.001,
    get: () => numberAt(fluidValue('simulation', 'pressure'), 0),
    set: value => setFluidValue('simulation', 'pressure', value),
  },
  {
    id: 'fluid-force', label: 'Fluid force', group: 'Fluid', min: 0, max: 100, step: 0.01,
    get: () => numberAt(fluidValue('fluid', 'force'), 0),
    set: value => setFluidValue('fluid', 'force', value),
  },
  {
    id: 'fluid-force-clamp', label: 'Fluid force clamp', group: 'Fluid', min: 0, max: 2000, step: 1,
    get: () => numberAt(fluidValue('fluid', 'forceClamp'), 0),
    set: value => setFluidValue('fluid', 'forceClamp', value),
  },
  {
    id: 'fluid-iterations', label: 'Fluid iterations', group: 'Fluid', min: 0, max: 8, step: 0.1,
    get: () => numberAt(fluidValue('fluid', 'iterations'), 0),
    set: value => setFluidValue('fluid', 'iterations', value),
  },
  {
    id: 'camera-x', label: 'Camera X position', group: 'Camera', min: -50, max: 50, step: 0.01,
    get: () => numberAt(cameraBasePosition('x'), 0),
    set: value => setCameraBasePosition('x', value),
  },
  {
    id: 'camera-y', label: 'Camera Y position', group: 'Camera', min: -50, max: 50, step: 0.01,
    get: () => numberAt(cameraBasePosition('y'), 0),
    set: value => setCameraBasePosition('y', value),
  },
  {
    id: 'camera-z', label: 'Camera Z position', group: 'Camera', min: -50, max: 50, step: 0.01,
    get: () => numberAt(cameraBasePosition('z'), 20),
    set: value => setCameraBasePosition('z', value),
  },
  {
    id: 'camera-pivot-strength', label: 'Camera pivot strength', group: 'Camera', min: 0, max: 4, step: 0.01,
    get: () => numberAt(worldOption('cameraPivotStrength', sceneValue(scenePaths.camera, ['cameraPivotStrength'], 0)), 0),
    set: value => setCameraOption('cameraPivotStrength', value),
  },
  {
    id: 'camera-pivot-offset', label: 'Camera pivot offset', group: 'Camera', min: -50, max: 50, step: 0.01,
    get: () => numberAt(worldOption('cameraPivotOffset', sceneValue(scenePaths.camera, ['cameraPivotOffset'], 0)), 0),
    set: value => setCameraOption('cameraPivotOffset', value),
  },
  {
    id: 'camera-pivot-angle-x', label: 'Camera pivot angle X', group: 'Camera', min: -3.2, max: 3.2, step: 0.001,
    get: () => numberAt(worldOption('cameraPivotAngle', sceneValue(scenePaths.camera, ['cameraPivotAngle', 'x'], 0), 'x'), 0),
    set: value => setCameraPivotAngle('x', value),
  },
  {
    id: 'camera-pivot-angle-y', label: 'Camera pivot angle Y', group: 'Camera', min: -3.2, max: 3.2, step: 0.001,
    get: () => numberAt(worldOption('cameraPivotAngle', sceneValue(scenePaths.camera, ['cameraPivotAngle', 'y'], 0), 'y'), 0),
    set: value => setCameraPivotAngle('y', value),
  },
  {
    id: 'camera-pivot-roll', label: 'Camera pivot roll', group: 'Camera', min: -3.2, max: 3.2, step: 0.001,
    get: () => numberAt(worldOption('cameraPivotRollAmount', 0), 0),
    set: value => setCameraOption('cameraPivotRollAmount', value),
  },
  {
    id: 'orb-rotation-speed', label: 'Orb rotation speed (rad/s)', group: 'Motion', min: -2, max: 2, step: 0.001,
    get: () => numberAt(runtimeState.motion?.orbRotationSpeed, 0.12),
    set: value => setRuntimeValue('motion', 'orbRotationSpeed', value),
  },
  {
    id: 'particle-rotation-speed', label: 'Particle rotation speed (rad/s)', group: 'Motion', min: -2, max: 2, step: 0.001,
    get: () => numberAt(runtimeState.motion?.particleRotationSpeed, 0.3),
    set: value => setRuntimeValue('motion', 'particleRotationSpeed', value),
  },
  {
    id: 'mouse-energy-intensity', label: 'Mouse energy intensity', group: 'Motion', min: 0, max: 4, step: 0.01,
    get: () => numberAt(runtimeState.motion?.mouseEnergyIntensity, 1),
    set: value => setRuntimeValue('motion', 'mouseEnergyIntensity', value),
  },
  {
    id: 'mouse-energy-attack', label: 'Mouse energy attack (ms)', group: 'Motion', min: 16, max: 1000, step: 1,
    get: () => numberAt(runtimeState.motion?.attackMs, 125),
    set: value => setRuntimeValue('motion', 'attackMs', value),
  },
  {
    id: 'mouse-energy-release', label: 'Mouse energy release (ms)', group: 'Motion', min: 16, max: 2000, step: 1,
    get: () => numberAt(runtimeState.motion?.releaseMs, 500),
    set: value => setRuntimeValue('motion', 'releaseMs', value),
  },
  {
    id: 'opening-hold', label: 'Opening white hold (ms)', group: 'Opening', min: 500, max: 5000, step: 10,
    get: () => numberAt(runtimeState.opening?.holdMs, 500),
    set: value => setRuntimeValue('opening', 'holdMs', value),
  },
  {
    id: 'opening-distance', label: 'Opening camera distance', group: 'Opening', min: 0, max: 10, step: 0.01,
    get: () => numberAt(runtimeState.opening?.cameraDistance, 1),
    set: value => setRuntimeValue('opening', 'cameraDistance', value),
  },
  {
    id: 'opening-fade', label: 'Opening fade (ms)', group: 'Opening', min: 200, max: 10000, step: 10,
    get: () => numberAt(runtimeState.opening?.fadeMs, 2000),
    set: value => setRuntimeValue('opening', 'fadeMs', value),
  },
];

export function installTuningPanel() {
  if (panel || typeof document === 'undefined') return panel;

  panel = document.createElement('section');
  panel.id = PANEL_ID;
  panel.className = 'tuning-panel floating-window';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Visual tuning');
  panel.dataset.synovaR136a1Ui = 'floating-window';

  const body = document.createElement('div');
  body.className = 'tuning-panel__body';
  const groups = new Map();
  for (const definition of CONTROL_DEFINITIONS) {
    if (!groups.has(definition.group)) {
      const fieldset = document.createElement('fieldset');
      fieldset.className = 'tuning-panel__group';
      fieldset.dataset.copyGroup = definition.group;
      fieldset.dataset.copyLabel = definition.group;
      const legend = document.createElement('legend');
      legend.textContent = definition.group;
      fieldset.append(legend);
      groups.set(definition.group, fieldset);
      body.append(fieldset);
    }
    const control = createControl(definition);
    groups.get(definition.group).append(control.row);
    controls.set(definition.id, control);
  }

  const actions = document.createElement('div');
  actions.className = 'tuning-panel__actions';
  const reset = createAction('Reset', resetTuning);
  const replay = createAction('Replay opening', replayOpening);
  actions.append(reset, replay);
  body.append(actions);
  panel.append(body);
  document.body.append(panel);

  getFloatingWindowManager()?.register(panel, {
    id: PANEL_ID,
    title: 'Visual Tuning',
    width: 680,
    height: 520,
    fitContent: true,
    minWidth: 320,
    minHeight: 240,
  });
  installInteractionRouter();

  window.addEventListener('synova-r136a1:theme-applied', event => {
    captureImmutableLiveBaseline();
    restoreSharedBaseline();
    activeTheme = event.detail?.theme || getActiveTheme();
    captureSceneMaterialDefaults();
    syncVisualOpacityFromScene();
    captureBaseline();
  });
  window.addEventListener('synova-r136a1:scene-ready', () => {
    captureImmutableLiveBaseline();
    captureSceneMaterialDefaults();
    syncVisualOpacityFromScene();
    captureBaseline();
    syncControls();
  });
  captureBaseline();
  if (new URLSearchParams(window.location.search).has('tune')) {
    queueMicrotask(() => getFloatingWindowManager()?.open(PANEL_ID));
  }
  return panel;
}

window.addEventListener('synova-r136a1:show-tuning', () => {
  const installed = installTuningPanel();
  getFloatingWindowManager()?.open(installed?.id || PANEL_ID);
});

export function freshSceneDefaults(theme = activeTheme) {
  const freshScene = cloneValues(immutableConfigBaseline);
  mergeValues(freshScene, getSceneThemeValues(theme));
  restoreObject(sceneTuning, freshScene);
  captureSceneMaterialDefaults();
  return cloneValues(freshScene);
}

export function resetTuning() {
  if (!baseline) captureBaseline();
  if (!baseline) return;

  restoreObject(sceneTuning, baseline.scene);
  runtimeState.theatre.project?.applyTheme(cloneValues(baseline.scene));
  restoreObject(runtimeState.motion, baseline.motion);
  restoreObject(runtimeState.opening, baseline.opening);
  restoreFluidOptions(baseline.fluid);
  restoreParticleCounts(baseline.particleCounts);
  restoreCameraSnapshot(baseline.camera);
  workingTheme = cloneValues(baseline.theme);
  syncVisualOpacityFromScene();
  applyThemeEffects();
  syncControls();
  window.dispatchEvent(new Event('synova-r136a1:tuning-changed'));
}

export function getTuningSettings() {
  return {
    theme: cloneValues(workingTheme),
    scene: {
      orb: cloneValues(sceneTuning.LandingOrb?.['Landing Orb'] || {}),
      particles: cloneValues(sceneTuning.LandingOrb?.LandingOrbParticles || {}),
      flareParticles: cloneValues(sceneTuning.LandingOrb?.LandingOrbFlareParticles || {}),
      camera: {
        ...cloneValues(sceneTuning.LandingOrb?.['Cameras / Settings'] || {}),
        basePosition: snapshotCamera().basePosition,
      },
      fluid: cloneValues(sceneTuning['Global WebGL']?.['Fluid Sim'] || {}),
      particleCounts: getParticleCounts(),
    },
    motion: cloneValues(runtimeState.motion || {}),
    opening: cloneValues(runtimeState.opening || {}),
  };
}

export function replayOpening() {
  if (typeof runtimeState.replayOpening === 'function') {
    runtimeState.replayOpening();
    showActionState('Replay opening', 'Replayed');
  } else {
    showActionState('Replay opening', 'Not ready');
  }
}

function createControl(definition) {
  const row = document.createElement('div');
  row.className = 'tuning-panel__row';
  row.dataset.copyRow = 'true';
  row.dataset.controlId = definition.id;
  row.dataset.copyLabel = definition.label;
  const name = document.createElement('label');
  name.htmlFor = `${PANEL_ID}-${definition.id}`;
  name.textContent = definition.label;
  const input = document.createElement('input');
  input.id = `${PANEL_ID}-${definition.id}`;
  input.type = definition.type || 'range';
  input.setAttribute('aria-label', definition.label);
  input.dataset.controlId = definition.id;
  input.dataset.interactive = 'true';
  if (input.type === 'range' || input.type === 'number') {
    input.min = String(definition.min);
    input.max = String(definition.max);
    input.step = String(definition.step);
  }
  const output = document.createElement('output');
  output.className = 'tuning-panel__value';
  output.htmlFor = input.id;
  output.dataset.copyValue = '';
  const defaultState = document.createElement('span');
  defaultState.id = `${input.id}-default-state`;
  defaultState.className = 'visually-hidden';
  input.setAttribute('aria-describedby', defaultState.id);
  let defaultValue;
  const update = () => {
    const value = definition.get();
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else input.value = input.type === 'range' ? String(clamp(value, definition.min, definition.max)) : String(value);
    output.textContent = formatValue(value, definition);
    row.dataset.copyValue = String(value);
    output.dataset.copyValue = String(value);
    const isDefault = defaultValue !== undefined && sameValue(value, defaultValue);
    row.dataset.default = String(isDefault);
    input.dataset.default = String(isDefault);
    output.dataset.default = String(isDefault);
    row.classList.toggle('is-default', isDefault);
    defaultState.textContent = isDefault ? 'Default' : 'Modified';
    output.title = isDefault ? 'Default value' : 'Modified value';
  };
  const setDefault = () => {
    defaultValue = definition.get();
    update();
  };
  input.addEventListener('input', () => {
    const value = input.type === 'checkbox' ? input.checked : Number(input.value);
    if (Number.isFinite(value) || input.type === 'checkbox') {
      definition.set(value);
      update();
      window.dispatchEvent(new Event('synova-r136a1:tuning-changed'));
    }
  });
  input.addEventListener('dblclick', event => {
    if (input.type !== 'range' && input.type !== 'number') return;
    event.preventDefault();
    if (defaultValue === undefined) return;
    (definition.reset || definition.set)(defaultValue);
    update();
    window.dispatchEvent(new Event('synova-r136a1:tuning-changed'));
  });
  row.append(name, input, output, defaultState);
  return { row, input, output, update, setDefault, definition };
}

function captureBaseline() {
  activeTheme = getActiveTheme();
  captureSceneMaterialDefaults();
  baseline = {
    theme: cloneValues(activeTheme),
    scene: cloneValues(sceneTuning),
    motion: cloneValues(runtimeState.motion || {}),
    opening: cloneValues(runtimeState.opening || {}),
    fluid: snapshotFluidOptions(),
    camera: snapshotCamera(),
    particleCounts: getParticleCounts(),
  };
  workingTheme = cloneValues(activeTheme);
  for (const control of controls.values()) control.setDefault();
}

function captureImmutableLiveBaseline() {
  if (immutableLiveBaseline) return;
  const world = worldController();
  if (!world?.components?.orb?.mainMaterial || !world?.components?.particles?.mesh?.material) return;
  immutableLiveBaseline = {
    fluid: cloneValues(immutableConfigBaseline['Global WebGL']?.['Fluid Sim'] || {}),
    camera: snapshotCamera(immutableConfigBaseline.LandingOrb?.['Cameras / Settings']),
    particleCounts: { main: MAX_PARTICLES, flares: MAX_FLARES },
  };
  const components = world?.components || {};
  immutableMaterialDefaults = {
    orb: {
      main: snapshotMaterialDefaults(components.orb?.mainMaterial),
    },
    particles: snapshotMaterialDefaults(components.particles?.mesh?.material),
  };
  captureSceneMaterialDefaults();
}

function restoreSharedBaseline() {
  restoreObject(runtimeState.motion, immutableMotionBaseline);
  restoreObject(runtimeState.opening, immutableOpeningBaseline);
  restoreFluidOptions(immutableLiveBaseline?.fluid || immutableConfigBaseline['Global WebGL']?.['Fluid Sim']);
  restoreParticleCounts(immutableLiveBaseline?.particleCounts);
  restoreCameraSnapshot(immutableLiveBaseline?.camera);
}

function syncControls() {
  for (const control of controls.values()) control.update();
}

function setThemeValue(path, value) {
  setPath(workingTheme, path, value);
}

function valueAt(path, fallback) {
  const value = getPath(workingTheme, path);
  return value === undefined ? fallback : value;
}

function activeBloomPath(key) {
  return ['postProcessing', 'softGlow', key];
}

function setBloomValue(key, value) {
  setThemeValue(['postProcessing', 'softGlow', key], key === 'radius' ? clamp(value, 0, 1) : value);
  applyThemeEffects();
}

function applyThemeEffects() {
  applyImageEffectsTheme(cloneValues(workingTheme));
}

function sceneValue(path, valuePath, fallback) {
  const value = getPath(sceneTuning, [...path, ...valuePath]);
  return value === undefined ? fallback : value;
}

function setSceneValue(path, valuePath, value) {
  const fullPath = [...path, ...valuePath];
  setPath(sceneTuning, fullPath, value);
  const sheet = path[0];
  const entry = path[1];
  const entryData = sceneTuning[sheet]?.[entry];
  if (entryData) runtimeState.theatre.project?.applyTheme({ [sheet]: { [entry]: cloneValues(entryData) } });
}

function setVisualOpacity(path, value) {
  const opacity = clamp(numberAt(value, 1), 0, 1);
  const key = path === scenePaths.orb ? 'orb' : path === scenePaths.particles ? 'particles' : null;
  if (!key) return;

  const defaults = getVisualMaterialDefaults(path)[0] || {};
  const transparent = opacity < 1 ? true : Boolean(defaults.transparent);
  const depthWrite = opacity < 1 ? false : Boolean(defaults.depthWrite);

  // The custom shaders read uOpacity. Keep Three's material opacity at its
  // original value and only change the flags needed for correct blending.
  setSceneValue(path, ['uniforms', 'uOpacity'], opacity);
  setSceneValue(path, ['material', 'transparent'], transparent);
  setSceneValue(path, ['material', 'depthWrite'], depthWrite);
  applyLiveVisualOpacity(path, opacity);
}

function syncVisualOpacityFromScene() {
  const orbOpacity = numberAt(sceneValue(scenePaths.orb, ['uniforms', 'uOpacity'], 1), 1);
  const particleOpacity = numberAt(sceneValue(scenePaths.particles, ['uniforms', 'uOpacity'], 1), 1);
  applyVisualOpacityState(scenePaths.orb, orbOpacity);
  applyVisualOpacityState(scenePaths.particles, particleOpacity);
}

function applyVisualOpacityState(path, opacity) {
  const key = path === scenePaths.orb ? 'orb' : path === scenePaths.particles ? 'particles' : null;
  if (!key) return;
  applyLiveVisualOpacity(path, opacity);
}

function applyLiveVisualOpacity(path, opacity) {
  const materials = getVisualMaterials(path);
  const defaults = getVisualMaterialDefaults(path);
  for (const [index, material] of materials.entries()) {
    if (!material) continue;
    const uniform = material.uniforms?.uOpacity;
    if (uniform) uniform.value = opacity;
    const original = defaults[index] || defaults[0] || {};
    material.transparent = opacity < 1 ? true : Boolean(original.transparent);
    material.depthWrite = opacity < 1 ? false : Boolean(original.depthWrite);
    material.needsUpdate = true;
  }
}

function getVisualMaterialDefaults(path) {
  const key = path === scenePaths.orb ? 'orb' : path === scenePaths.particles ? 'particles' : null;
  if (!key) return [];
  return sceneMaterialDefaults[key] || [];
}

function getVisualMaterials(path) {
  const components = worldController()?.components || {};
  if (path === scenePaths.orb) {
    // The cloud material is an offscreen field; it shares uOpacity but not blending flags.
    return [components.orb?.mainMaterial];
  }
  if (path === scenePaths.particles) return [components.particles?.mesh?.material];
  return [];
}

function captureSceneMaterialDefaults() {
  const orbConfig = getPath(sceneTuning, [...scenePaths.orb, 'material']) || {};
  const particleConfig = getPath(sceneTuning, [...scenePaths.particles, 'material']) || {};
  const orbLive = immutableMaterialDefaults.orb || {};
  const particleLive = immutableMaterialDefaults.particles || {};
  sceneMaterialDefaults = {
    orb: [
      {
        transparent: orbLive.main?.transparent ?? orbConfig.transparent ?? false,
        depthWrite: orbLive.main?.depthWrite ?? orbConfig.depthWrite ?? false,
      },
    ],
    particles: [{
      transparent: particleLive.transparent ?? particleConfig.transparent ?? true,
      depthWrite: particleLive.depthWrite ?? particleConfig.depthWrite ?? false,
    }],
  };
}

function fluidValue(section, key) {
  if (section === 'fluid' && key === 'iterations' && runtimeState.WebGL?.qualityManager) {
    return runtimeState.WebGL.qualityManager.requested.fluidIterations;
  }
  const runtime = runtimeState.WebGL?.fluidSim?.options?.[section]?.[key];
  if (runtime !== undefined) return runtime;
  return sceneValue(scenePaths.fluid, [section, key], 0);
}

function setFluidValue(section, key, value) {
  setSceneValue(scenePaths.fluid, [section, key], value);
  if (section === 'fluid' && key === 'iterations' && runtimeState.WebGL?.qualityManager) {
    runtimeState.WebGL.qualityManager.requested.fluidIterations = value;
  }
  const options = runtimeState.WebGL?.fluidSim?.options;
  if (options?.[section]) options[section][key] = value;
  const uniform = options?.simulationOpts?.uniforms?.[`u${key[0].toUpperCase()}${key.slice(1)}`];
  if (uniform) uniform.value = value;
}

function setRuntimeValue(section, key, value) {
  const target = runtimeState[section] || (runtimeState[section] = {});
  target[key] = value;
}

function worldController() {
  return runtimeState.WebGL?.worldController || runtimeState.WebGL?.activeScene || null;
}

function worldOption(key, fallback, componentKey) {
  const world = worldController();
  const value = componentKey ? world?.options?.[key]?.[componentKey] : world?.options?.[key];
  return value === undefined ? fallback : value;
}

function cameraBasePosition(axis) {
  const camera = worldController()?.activeCamera || worldController()?.camera;
  return camera?._position?.[axis] ?? camera?.position?.[axis] ?? 0;
}

function setCameraBasePosition(axis, value) {
  const camera = worldController()?.activeCamera || worldController()?.camera;
  if (!camera) return;
  if (camera._position) camera._position[axis] = value;
  else if (camera.position) camera.position[axis] = value;
  camera.updateProjectionMatrix?.();
}

function setCameraOption(key, value) {
  const world = worldController();
  if (world?.options) {
    if (typeof world.options[key] === 'object' && world.options[key] !== null && key === 'cameraPivotAngle') {
      world.options[key].x = value;
    } else world.options[key] = value;
  }
  setSceneValue(scenePaths.camera, [key], value);
}

function setCameraPivotAngle(axis, value) {
  const world = worldController();
  if (world?.options?.cameraPivotAngle) world.options.cameraPivotAngle[axis] = value;
  setSceneValue(scenePaths.camera, ['cameraPivotAngle', axis], value);
}

function getParticleMesh(isFlare) {
  const components = worldController()?.components;
  return (isFlare ? components?.flares : components?.particles)?.mesh;
}

function getParticleCount(isFlare) {
  const requested = runtimeState.WebGL?.qualityManager?.requested.counts;
  if (requested) return isFlare ? requested.flares : requested.main;
  const fallback = numberAt(sceneValue(isFlare ? scenePaths.flareParticles : scenePaths.particles, ['count'], isFlare ? 9216 : 65536), isFlare ? 9216 : 65536);
  return numberAt(getParticleMesh(isFlare)?.count, fallback);
}

function getParticleCounts() {
  return { main: getParticleCount(false), flares: getParticleCount(true) };
}

function setParticleCount(isFlare, value) {
  const maximum = isFlare ? MAX_FLARES : MAX_PARTICLES;
  const count = Math.round(clamp(value, 1, maximum));
  const path = isFlare ? scenePaths.flareParticles : scenePaths.particles;
  setSceneValue(path, ['count'], count);
  const requested = runtimeState.WebGL?.qualityManager?.requested.counts;
  if (requested) requested[isFlare ? 'flares' : 'main'] = count;
  const mesh = getParticleMesh(isFlare);
  if (mesh) mesh.count = count;
}

function snapshotFluidOptions() {
  const options = runtimeState.WebGL?.fluidSim?.options;
  const snapshot = { simulation: {}, fluid: {} };
  for (const key of ['mouseRadius', 'curlStrength', 'dissipation', 'clearValue', 'viscosity', 'pressure']) {
    snapshot.simulation[key] = numberAt(options?.simulationOpts?.uniforms?.[`u${capitalize(key)}`]?.value,
      numberAt(sceneValue(scenePaths.fluid, ['simulation', key], 0), 0));
  }
  for (const key of ['force', 'forceClamp', 'iterations']) {
    snapshot.fluid[key] = key === 'iterations' ? fluidValue('fluid', key)
      : numberAt(options?.fluid?.[key], numberAt(sceneValue(scenePaths.fluid, ['fluid', key], 0), 0));
  }
  return snapshot;
}

function snapshotMaterialDefaults(material) {
  if (!material) return {};
  return { transparent: Boolean(material.transparent), depthWrite: Boolean(material.depthWrite) };
}

function restoreFluidOptions(snapshot) {
  const options = runtimeState.WebGL?.fluidSim?.options;
  if (!options || !snapshot) return;
  for (const [key, value] of Object.entries(snapshot.simulation || {})) {
    const uniform = options.simulationOpts?.uniforms?.[`u${capitalize(key)}`];
    if (uniform) uniform.value = value;
  }
  for (const [key, value] of Object.entries(snapshot.fluid || {})) {
    if (options.fluid) options.fluid[key] = value;
  }
}

function snapshotCamera(fallbackConfig = null) {
  const world = worldController();
  const camera = world?.activeCamera || world?.camera;
  const options = world?.options || {};
  const fallback = fallbackConfig || sceneTuning.LandingOrb?.['Cameras / Settings'] || {};
  const source = fallbackConfig || options;
  return {
    options: {
      cameraXTranslate: numberAt(source.cameraXTranslate, numberAt(fallback.cameraXTranslate, 0)),
      cameraYTranslate: numberAt(source.cameraYTranslate, numberAt(fallback.cameraYTranslate, 0)),
      cameraZTranslate: numberAt(source.cameraZTranslate, numberAt(fallback.cameraZTranslate, 0)),
      cameraPivotStrength: numberAt(source.cameraPivotStrength, numberAt(fallback.cameraPivotStrength, 0)),
      cameraPivotOffset: numberAt(source.cameraPivotOffset, numberAt(fallback.cameraPivotOffset, 0)),
      cameraPivotAngle: {
        x: numberAt(source.cameraPivotAngle?.x, numberAt(fallback.cameraPivotAngle?.x, 0)),
        y: numberAt(source.cameraPivotAngle?.y, numberAt(fallback.cameraPivotAngle?.y, 0)),
      },
      cameraPivotRollAmount: numberAt(source.cameraPivotRollAmount,
        numberAt(fallback.cameraPivotRollAmount, fallbackConfig ? 0.2 : numberAt(options.cameraPivotRollAmount, 0.2))),
    },
    basePosition: camera?._position
      ? { x: camera._position.x, y: camera._position.y, z: camera._position.z }
      : camera?.position
        ? { x: camera.position.x, y: camera.position.y, z: camera.position.z }
        : null,
  };
}

function restoreCameraSnapshot(snapshot) {
  if (!snapshot) return;
  const world = worldController();
  if (world?.options && snapshot.options) {
    for (const key of ['cameraXTranslate', 'cameraYTranslate', 'cameraZTranslate', 'cameraPivotStrength', 'cameraPivotOffset', 'cameraPivotRollAmount']) {
      if (snapshot.options[key] !== undefined) world.options[key] = snapshot.options[key];
    }
    if (world.options.cameraPivotAngle) {
      world.options.cameraPivotAngle.x = snapshot.options.cameraPivotAngle.x;
      world.options.cameraPivotAngle.y = snapshot.options.cameraPivotAngle.y;
    }
  }
  const camera = world?.activeCamera || world?.camera;
  if (camera && snapshot.basePosition) {
    if (camera._position?.copy) camera._position.copy(snapshot.basePosition);
    else if (camera._position) Object.assign(camera._position, snapshot.basePosition);
    if (camera.position?.copy) camera.position.copy(snapshot.basePosition);
    else if (camera.position) Object.assign(camera.position, snapshot.basePosition);
  }
  camera?.updateProjectionMatrix?.();
}

function restoreParticleCounts(counts) {
  if (!counts) return;
  setParticleCount(false, counts.main);
  setParticleCount(true, counts.flares);
}

function restoreObject(target, source) {
  if (!target || !source) return;
  for (const key of Object.keys(target)) {
    if (!(key in source)) delete target[key];
  }
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) target[key] = {};
      restoreObject(target[key], value);
    } else {
      target[key] = cloneValues(value);
    }
  }
}

function getPath(object, path) {
  return path.reduce((current, key) => current?.[key], object);
}

function setPath(object, path, value) {
  let target = object;
  for (const key of path.slice(0, -1)) {
    if (!target[key] || typeof target[key] !== 'object') target[key] = {};
    target = target[key];
  }
  target[path[path.length - 1]] = value;
}

function numberAt(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function sameValue(left, right) {
  if (typeof left === 'boolean' || typeof right === 'boolean') return Boolean(left) === Boolean(right);
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
    ? Math.abs(leftNumber - rightNumber) <= 1e-9
    : left === right;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function clamp(value, min = -Infinity, max = Infinity) {
  const number = numberAt(value, min);
  return Math.min(max, Math.max(min, number));
}

function formatValue(value, definition) {
  if (definition.type === 'checkbox') return value ? 'on' : 'off';
  if (definition.step >= 1) return String(Math.round(Number(value)));
  return Number(value).toFixed(definition.step < 0.01 ? 3 : 2);
}

function cloneValues(value) {
  if (Array.isArray(value)) return value.map(cloneValues);
  if (value && typeof value === 'object') {
    const clone = {};
    for (const [key, child] of Object.entries(value)) {
      if (typeof child !== 'function') clone[key] = cloneValues(child);
    }
    return clone;
  }
  return value;
}

function mergeValues(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) target[key] = {};
      mergeValues(target[key], value);
    } else {
      target[key] = cloneValues(value);
    }
  }
  return target;
}

function stopPanelInput(event) {
  event.stopPropagation();
}

function createAction(label, listener) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tuning-panel__action';
  button.textContent = label;
  button.dataset.defaultLabel = label;
  button.addEventListener('click', listener);
  return button;
}

function showActionState(label, state) {
  const button = [...(panel?.querySelectorAll('.tuning-panel__action') || [])]
    .find(candidate => candidate.dataset.defaultLabel === label);
  if (!button) return;
  button.textContent = state;
  window.setTimeout(() => { button.textContent = label; }, 1200);
}
