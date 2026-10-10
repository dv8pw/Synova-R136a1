const frameTasks = new Map();
export const viewportSubscribers = new Set();
const runtimeState = {
  WebGL: null,
  AssetLoader: null,
  RAFCollection: {
    add(task, queueRank = 0) {
      frameTasks.set(task, queueRank);
      task._remove = () => frameTasks.delete(task);
      return task._remove;
    },
    remove(task) { frameTasks.delete(task); },
  },
  urlParams: new URLSearchParams(),
  motion: {
    orbRotationSpeed: 0.120, particleRotationSpeed: 0.300,
    mouseEnergyIntensity: 1, attackMs: 125, releaseMs: 500,
  },
  opening: { holdMs: 500, cameraDistance: 1, fadeMs: 2000 },
  pointerActivity: 0,
  openingCameraDistance: 0,
  env: 'production',
  sceneName: 'landing-orb',
  window: { w: 0, h: 0, dpr: 1 },
  breakpoints: {
    is(breakpointKind) {
      return breakpointKind === 'touch' ? matchMedia('(pointer: coarse)').matches
        : breakpointKind === 'md' && matchMedia('(min-width: 1024px)').matches;
    },
  },
  pointer: { x: 0, y: 0 },
  theatre: {
    project: null,
    sheets: {},
    objects: {},
    studioSheets: {},
    studioObjects: {},
    rafDriver: null,
  },
};

const entryData = sample => sample;
const controlSchema = {
  types: { number: entryData, boolean: entryData, compound: entryData, rgba: entryData,
    stringLiteral: entryData, image: entryData },
};
const preserveReference = entryData;
function observeViewport(task, runNow) {
  viewportSubscribers.add(task);
  if (runNow) task();
  return { remove: () => viewportSubscribers.delete(task) };
}
export function drainAnimationQueue(animationMilliseconds) {
  for (const [task] of [...frameTasks].sort((leftTask, rightTask) => leftTask[1] - rightTask[1])) task(animationMilliseconds);
}

export { runtimeState as S, controlSchema as Te, preserveReference as si, observeViewport as oc };
