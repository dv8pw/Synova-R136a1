export const STEP_SECONDS = 1 / 60;
const EPSILON = 1e-7;

// The browser supplies opportunities to render; this clock supplies simulation time.
export class AnimationClock {
  constructor() {
    this.seconds = 0;
    this.simulationSeconds = 0;
    this.accumulator = 0;
    this.previousTimestamp = null;
  }

  pause() {
    this.previousTimestamp = null;
    this.accumulator = 0;
  }

  advance(timestamp, simulate) {
    if (this.previousTimestamp === null) {
      this.previousTimestamp = timestamp;
      return { render: false, elapsedSeconds: 0 };
    }
    const elapsedMs = Math.max(0, timestamp - this.previousTimestamp);
    this.previousTimestamp = timestamp;
    if (elapsedMs >= 1000) {
      this.pause();
      this.previousTimestamp = timestamp;
      return { render: false, elapsedSeconds: 0, paused: true };
    }
    const elapsedSeconds = elapsedMs / 1000;
    this.seconds += elapsedSeconds;
    this.accumulator += elapsedSeconds;
    let steps = 0;
 while (this.accumulator + EPSILON >= STEP_SECONDS) {
      this.simulationSeconds += STEP_SECONDS;
      simulate(STEP_SECONDS, this.simulationSeconds);
      this.accumulator = Math.max(0, this.accumulator - STEP_SECONDS);
      steps++;
    }
    return { render: elapsedMs > 0, elapsedSeconds, steps, alpha: this.accumulator / STEP_SECONDS };
  }
}

// Integer divisions of browser cadence give evenly spaced presentation opportunities.
export class PresentationClock {
  constructor(observedHz = 60, selectedHz = observedHz, targetHz = selectedHz) {
    this.configure(observedHz, selectedHz, targetHz);
  }

  configure(observedHz, selectedHz, targetHz) {
    this.observedHz = observedHz;
    this.targetHz = targetHz;
    this.division = Math.max(1, Math.round(selectedHz / targetHz));
    this.pause();
  }

  pause() { this.opportunities = 0; this.previousPresentation = null; }

  advance(timestamp) {
    const opportunity = this.opportunities++;
    if (opportunity % this.division !== 0) return { render: false };
    const elapsedSeconds = this.previousPresentation === null ? 0 : (timestamp - this.previousPresentation) / 1000;
    this.previousPresentation = timestamp;
    return { render: true, elapsedSeconds };
  }
}
