export const QUALITY_STEPS = Object.freeze([
  Object.freeze({ id: 0, name: 'Full', dprMultiplier: 1, bloomMultiplier: 1, fxaaSamples: 8, fluidIterationsMultiplier: 1, particleMultiplier: 1 }),
  Object.freeze({ id: 1, name: 'Resolution', dprMultiplier: 0.85, bloomMultiplier: 1, fxaaSamples: 8, fluidIterationsMultiplier: 1, particleMultiplier: 1 }),
  Object.freeze({ id: 2, name: 'Balanced', dprMultiplier: 0.70, bloomMultiplier: 0.75, fxaaSamples: 6, fluidIterationsMultiplier: 1, particleMultiplier: 0.85 }),
  Object.freeze({ id: 3, name: 'Visual floor', dprMultiplier: 0.50, bloomMultiplier: 0.50, fxaaSamples: 4, fluidIterationsMultiplier: 0.50, particleMultiplier: 0.65 }),
]);
