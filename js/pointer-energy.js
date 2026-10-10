export class PointerEnergy {
  constructor(settings) {
    this.settings = settings;
    this.activity = 0;
    this.target = 0;
    this.previous = null;
    this.lastMovement = -Infinity;
  }

  sample(x, y, timestamp, diagonal) {
    const previous = this.previous;
    this.previous = { x, y, timestamp };
    if (!previous || timestamp - previous.timestamp >= 250 || diagonal <= 0) {
      this.target = 0;
      return;
    }
    const elapsedSeconds = (timestamp - previous.timestamp) / 1000;
    if (elapsedSeconds <= 0) return;
    const speed = Math.hypot(x - previous.x, y - previous.y) / elapsedSeconds / diagonal;
    this.target = Math.min(1, Math.max(0, speed * this.settings.mouseEnergyIntensity));
    this.lastMovement = timestamp;
  }

  leave() {
    this.previous = null;
    this.target = 0;
  }

  reset() {
    this.leave();
    this.activity = 0;
    this.lastMovement = -Infinity;
  }

  advance(deltaSeconds, timestamp) {
    if (timestamp - this.lastMovement > 100) this.target = 0;
    const milliseconds = this.target > this.activity ? this.settings.attackMs : this.settings.releaseMs;
    const blend = milliseconds > 0 ? -Math.expm1(-deltaSeconds * 1000 / milliseconds) : 1;
    this.activity += (this.target - this.activity) * blend;
    this.activity = Math.min(1, Math.max(0, this.activity));
    return this.activity;
  }
}
