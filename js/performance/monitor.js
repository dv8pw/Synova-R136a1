import { summarize } from './stats.js';
import { DEFAULT_REFRESH_RATES, estimateCadence } from './cadence.js';
import { GpuTimerSampler } from './gpu-timer.js';
import { AdaptiveController, classifyPerformanceWindow, getCadenceFallbacks } from './controller.js';

export function normalizeCadence(measurement) {
  const observed = measurement.observedRefreshHz ?? measurement.observedHz;
  const snapped = measurement.snappedRefreshHz ?? measurement.snappedHz;
  const target = measurement.targetRefreshHz ?? measurement.targetHz ?? snapped;
  return { ...measurement, observedRefreshHz: Number.isFinite(observed) && observed > 0 ? observed : 60,
    snappedRefreshHz: Number.isFinite(snapped) && snapped > 0 ? snapped : Number.NaN,
    targetRefreshHz: Number.isFinite(target) && target > 0 ? target : 60,
    confident: Boolean(measurement.stable ?? measurement.confident) };
}

export class PerformanceMonitor {
  constructor({ gl, cadence, getWorkload, onProfile, onProbe, now = () => performance.now(), sampler }) {
    this.now = now;
    this.cadence = normalizeCadence(cadence);
    this.controller = new AdaptiveController({ nativeHz: this.cadence.targetRefreshHz, now });
    this.gpu = sampler || new GpuTimerSampler(gl, { now });
    this.getWorkload = getWorkload;
    this.onProfile = onProfile;
    this.onProbe = onProbe;
    this.epoch = 0;
    this.windowSerial = 0;
    this.windows = new Map();
    this.history = [];
    this.active = false;
    this.stage = 'Loading';
    this.reason = 'Waiting for the first complete scene frame';
    this.evidence = 'Collecting';
    this.lastProbeAt = -Infinity;
    this.cadenceShiftWindows = 0;
    this.metrics = null;
    this.classifiedWindow = null;
    this.lastAdaptiveDecision = null;
  }

  get targetHz() { return this.controller.targetHz; }

  start(timestamp, initial = true) {
    if (initial) this.controller.reset({ nativeHz: this.cadence.targetRefreshHz, qualityStep: 0 });
    this.invalidate(initial ? 'Initial full-quality qualification' : 'Qualification resumed',
      { timestamp, initial });
  }

  invalidate(reason, { timestamp = this.now(), initial = false, resetController = false,
    cadence, monitoring = false, keepMetrics = false, requalify = true } = {}) {
    if (cadence) this.cadence = normalizeCadence(cadence);
    if (resetController) {
      // A genuine native-rate change keeps the current divisor where possible.
      const oldDivisor = Math.max(1, Math.round(this.controller.nativeHz / this.controller.targetHz));
      const rates = getCadenceFallbacks(this.cadence.targetRefreshHz);
      const heavyBoundary = Math.max(0, rates.findLastIndex(rate => rate >= 60));
      const quality = this.controller.qualityStep;
      const index = quality === 3 ? rates.length - 1
        : Math.max(Math.min(oldDivisor - 1, rates.length - 1), quality === 2 ? heavyBoundary : 0);
      this.controller.reset({ nativeHz: this.cadence.targetRefreshHz,
        targetHz: rates[index], qualityStep: quality });
    } else if (requalify) {
      this.controller.requalify();
    }
    if (cadence) this.onProfile(this.controller.targetHz, this.controller.qualityStep);
    this.epoch++;
    this.gpu.resetEpoch(this.epoch);
    this.windows.clear();
    this.window = null;
    this.interval = null;
    this.previousRaf = null;
    this.previousPresentation = null;
    this.frameIndex = 0;
    this.randomState = 0x6d2b79f5;
    this.selectedBucket = -1;
    this.callbackWindow = null;
    this.callbackInterval = null;
    this.active = true;
    this.mode = monitoring ? 'monitoring' : 'qualifying';
    this.stage = monitoring ? 'Monitoring' : 'Settling';
    this.reason = reason;
    this.settleStartedAt = timestamp;
    this.settleFrames = 0;
    this.settleMinFrames = initial ? 30 : 15;
    this.settleMinMs = initial ? 500 : 250;
    this.workload = this.getWorkload();
    if (!keepMetrics) {
      this.metrics = null;
      this.evidence = 'Collecting';
      this.controller.lastClassification = null;
    }
    this.cadenceShiftWindows = 0;
  }

  suspend(reason) {
    this.active = false;
    this.stage = reason;
    this.reason = reason;
    this.epoch++;
    this.gpu.resetEpoch(this.epoch);
    this.windows.clear();
    this.window = this.interval = null;
    this.controller.requalify();
    this.evidence = 'Collecting';
    this.cadenceShiftWindows = 0;
  }

  replaceContext(gl) {
    this.gpu.resetEpoch(this.epoch + 1);
    this.gpu = new GpuTimerSampler(gl, { now: this.now });
  }

  beforeCallback(timestamp) {
    this.timestamp = timestamp;
    if (!this.active) return;
    for (const result of this.gpu.poll({ now: this.now(), maxAgeMs: 250 })) {
      const window = this.windows.get(result.windowId);
      if (!window || result.epoch !== this.epoch) continue;
      if (result.valid) window.gpuSamples.push(result);
      else { window.invalidGpu++; window.lastGpuFailure = result.reason; }
    }
    for (const window of [...this.windows.values()]) {
      if (!window.closed) continue;
      if (window.gpuSamples.length + window.invalidGpu >= window.attempted || this.now() >= window.deadline) {
        this.finishWindow(window);
        if (!this.active) return;
      }
    }
    if (this.window && this.previousRaf !== null) this.window.raf.push(timestamp - this.previousRaf);
    this.previousRaf = timestamp;
    this.callbackWindow = this.window;
    this.callbackInterval = this.interval;
    this.presented = false;
  }

  beginPhase(kind) {
    if (!this.active) return null;
    const interval = this.interval;
    return { kind, startedAt: this.now(), interval,
      scope: interval?.gpu ? this.gpu.beginScope(kind, interval.gpu) : null };
  }

  endPhase(token, simulationSteps = 0) {
    if (!token) return;
    if (token.scope) this.gpu.endScope(token.scope);
    if (token.interval) {
      const key = token.kind === 'simulation' ? 'simulationCpu' : 'presentationCpu';
      token.interval[key] += this.now() - token.startedAt;
      token.interval.simulationSteps += simulationSteps;
    }
  }

  presentedFrame(timestamp) {
    if (!this.active) return;
    this.presented = true;
    if (!this.window) {
      this.settleFrames++;
      if (this.mode === 'monitoring' || (this.settleFrames >= this.settleMinFrames && timestamp - this.settleStartedAt >= this.settleMinMs)) {
        this.openWindow(timestamp);
        this.previousPresentation = timestamp;
      }
      return;
    }
    const intervalMs = timestamp - this.previousPresentation;
    this.previousPresentation = timestamp;
    this.window.presentation.push(intervalMs);
    this.window.endMs = timestamp;
    if (this.interval?.gpu) {
      this.interval.gpu.metadata.simulationSteps = this.interval.simulationSteps;
      this.gpu.closeInterval(this.interval.gpu);
    }
  }

  afterCallback(startedAt) {
    if (!this.active) return;
    const cpuMs = this.now() - startedAt;
    if (this.callbackWindow && this.callbackInterval) {
      this.callbackWindow.callbackCpu.push(cpuMs);
      this.callbackInterval.cpu += cpuMs;
      if (this.presented) {
        this.callbackWindow.cpu.push(this.callbackInterval.cpu);
        this.callbackWindow.simulationCpu.push(this.callbackInterval.simulationCpu);
        this.callbackWindow.presentationCpu.push(this.callbackInterval.presentationCpu);
      }
    }
    if (!this.presented || !this.window) return;
    const duration = this.window.endMs - this.window.startMs;
    const enoughGpu = !this.gpu.available || this.window.gpuSamples.length >= 45;
    const close = this.window.mode === 'monitoring' ? duration >= 3000 : duration >= 3000 || (duration >= 1500 && enoughGpu);
    if (close) {
      this.window.closed = true;
      this.window.deadline = this.now() + 250;
      this.openWindow(this.timestamp);
    }
    this.armInterval();
  }

  openWindow(timestamp) {
    this.stage = this.mode === 'monitoring' ? 'Monitoring' : 'Qualifying';
    this.window = { id: ++this.windowSerial, epoch: this.epoch, mode: this.mode,
      startMs: timestamp, endMs: timestamp, targetHz: this.targetHz, qualityStep: this.controller.qualityStep,
      cadence: { ...this.cadence }, frameBudgetMs: 1000 / this.targetHz,
      workload: this.workload, cpu: [], callbackCpu: [], simulationCpu: [], presentationCpu: [],
      raf: [], presentation: [], gpuSamples: [], attempted: 0, invalidGpu: 0, closed: false };
    this.windows.set(this.window.id, this.window);
  }

  armInterval() {
    const stride = Math.max(1, Math.round(this.targetHz / (this.mode === 'monitoring' ? 10 : 60)));
    const index = this.frameIndex++;
    const bucket = Math.floor(index / stride);
    if (bucket !== this.selectedBucket) {
      this.selectedBucket = bucket;
      let seed = this.randomState;
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      this.randomState = seed >>> 0;
      this.selectedPhase = Math.floor(this.randomState / 0x100000000 * stride);
    }
    const sampled = this.gpu.available && index % stride === this.selectedPhase;
    this.interval = { cpu: 0, simulationCpu: 0, presentationCpu: 0, simulationSteps: 0,
      gpu: sampled ? this.gpu.beginInterval({ epoch: this.epoch, windowId: this.window.id, targetHz: this.targetHz }) : null };
    if (sampled) this.window.attempted++;
  }

  buildMetrics(window, final = false) {
    const gpuMin = window.mode === 'monitoring' ? 20 : 45;
    const validFraction = window.attempted ? window.gpuSamples.length / window.attempted : 0;
    const gpuReliable = this.gpu.available && window.gpuSamples.length >= gpuMin && validFraction >= 0.8;
    const budget = 1000 / window.targetHz;
    const intervalSum = window.presentation.reduce((sum, interval) => sum + interval, 0);
    return {
      raf: summarize(window.raf), presentation: summarize(window.presentation),
      cpu: summarize(window.cpu), callbackCpu: summarize(window.callbackCpu),
      simulationCpu: summarize(window.simulationCpu), presentationCpu: summarize(window.presentationCpu),
      gpu: gpuReliable || (!final && window.gpuSamples.length) ? summarize(window.gpuSamples.map(sample => sample.totalMs)) : null,
      simulationGpu: gpuReliable || (!final && window.gpuSamples.length) ? summarize(window.gpuSamples.map(sample => sample.simulationMs)) : null,
      presentationGpu: gpuReliable || (!final && window.gpuSamples.length) ? summarize(window.gpuSamples.map(sample => sample.presentationMs)) : null,
      deliveredHz: intervalSum > 0 ? window.presentation.length * 1000 / intervalSum : NaN,
      lateCount: window.presentation.filter(interval => interval > 1.5 * budget).length,
      lateFraction: window.presentation.length ? window.presentation.filter(interval => interval > 1.5 * budget).length / window.presentation.length : NaN,
      missedFrames: window.presentation.reduce((sum, interval) => sum + Math.max(0, Math.round(interval / budget) - 1), 0),
      presentationDurationMs: intervalSum,
      deliveryRatio: intervalSum > 0 ? window.presentation.length / Math.max(1, intervalSum / budget) : NaN,
      gpuReliable, gpuValidFraction: validFraction,
      validGpuSamples: window.gpuSamples.length, attemptedGpuSamples: window.attempted,
      skippedGpuSamples: final ? window.attempted - window.gpuSamples.length : window.invalidGpu, frameCount: window.presentation.length,
      simulationSampleSteps: window.gpuSamples.map(sample => sample.metadata.simulationSteps),
    };
  }

  finishWindow(window) {
    this.windows.delete(window.id);
    if (window.epoch !== this.epoch) return;
    const metrics = this.buildMetrics(window, true);
    const summary = { windowId: window.id, epoch: window.epoch, startMs: window.startMs, endMs: window.endMs,
      cadence: window.cadence, frameBudgetMs: window.frameBudgetMs,
      durationMs: window.endMs - window.startMs, targetHz: window.targetHz, qualityStep: window.qualityStep,
      cpu: metrics.cpu, gpu: metrics.gpu, gpuAvailable: metrics.gpuReliable,
      gpuSamples: metrics.validGpuSamples, gpuValidFraction: metrics.gpuValidFraction,
      deliveredHz: metrics.deliveredHz, lateFraction: metrics.lateFraction, settled: true };
    summary.frameCount = metrics.frameCount;
    summary.lateCount = metrics.lateCount;
    summary.missedFrames = metrics.missedFrames;
    summary.presentationDurationMs = metrics.presentationDurationMs;
    summary.deliveryRatio = metrics.deliveryRatio;
    const classification = classifyPerformanceWindow(summary, {
      ...this.controller.config,
      targetHz: this.targetHz,
    });
    const decision = this.controller.observe(summary);
    // Delayed GPU results may complete behind an already consumed window.
    // Keep diagnostics tied to the last accepted controller observation.
    if (!decision.classification) return;
    this.metrics = metrics;
    // The controller classifies the exact summary it just consumed. Use that
    // result as the authoritative diagnostic evidence so displayed metrics,
    // overload rows, and the adaptive decision all name one completed window.
    const classified = decision.classification ?? classification;
    const previousEvidence = this.evidence;
    this.evidence = classified.evidence;
    this.lastAdaptiveDecision = this.controller.lastAdaptiveDecision ?? this.lastAdaptiveDecision;
    this.reason = decision.reason === 'hold' ? (classified.overloaded ? 'Overload observed; waiting for a consecutive window'
      : classified.sustainable ? 'Configuration sustainable' : 'Configuration marginal') : decision.reason;
    this.classifiedWindow = {
      windowId: window.id,
      epoch: window.epoch,
      startMs: window.startMs,
      endMs: window.endMs,
      durationMs: summary.durationMs,
      targetHz: window.targetHz,
      qualityStep: window.qualityStep,
      metrics,
      controllerEvidence: { ...this.controller.lastWindowEvidence },
      classification: classified,
      evidence: classified.evidence,
      reason: this.reason,
      decision: {
        reason: decision.reason,
        fromTargetHz: window.targetHz,
        fromQualityStep: window.qualityStep,
        changed: decision.changed,
        targetHz: decision.targetHz,
        qualityStep: decision.qualityStep,
      },
    };
    this.history.push({ ...summary, gpu: metrics.gpu, reason: this.reason, classification: classified,
      workload: window.workload, missedFrames: metrics.missedFrames });
    if (this.history.length > 24) this.history.shift();

    const rafEstimate = estimateCadence(window.raf, {
      minSamples: 1,
      minRetainedSamples: 1,
      minDurationMs: 0,
      durationMs: window.raf.reduce((sum, interval) => sum + interval, 0),
    });
    const rawHz = rafEstimate.observedRefreshHz ?? rafEstimate.observedHz;
    this.cadenceShiftWindows = Number.isFinite(rawHz) && Math.abs(rawHz / this.cadence.observedRefreshHz - 1) > 0.05
      ? this.cadenceShiftWindows + 1 : 0;
    if (decision.changed) {
      this.onProfile(decision.targetHz, decision.qualityStep);
      this.invalidate(decision.reason, { timestamp: this.timestamp, resetController: false, keepMetrics: false, requalify: false });
    } else if (!classification.overloaded && window.mode === 'qualifying') {
      this.invalidate(this.reason, { timestamp: this.timestamp, resetController: false, monitoring: true, keepMetrics: true, requalify: false });
    } else if (window.mode === 'monitoring' && previousEvidence === 'cpu-delivery-gpu-unavailable' && metrics.gpuReliable) {
      this.invalidate('GPU timing recovered; requalifying', { timestamp: this.timestamp, resetController: false });
    }
    if (this.cadenceShiftWindows >= 2 && this.now() - this.lastProbeAt >= 60_000) {
      this.lastProbeAt = this.now();
      this.cadenceShiftWindows = 0;
      this.onProbe('Persistent browser cadence change');
    }
  }

  snapshot() {
    const liveMetrics = this.window?.presentation.length ? this.buildMetrics(this.window) : null;
    const currentMetrics = this.classifiedWindow?.metrics ?? null;
    const displayedEvidence = this.classifiedWindow?.evidence ?? this.evidence;
    const stats = this.gpu.snapshot();
    return {
      stage: this.stage, reason: this.reason, evidence: displayedEvidence, epoch: this.epoch,
      cadence: this.cadence, supportedRates: DEFAULT_REFRESH_RATES,
      fallbackRates: this.controller.cadenceRates, targetHz: this.targetHz, frameBudgetMs: 1000 / this.targetHz,
      workload: this.workload, metrics: currentMetrics,
      classifiedWindow: this.classifiedWindow,
      classification: this.classifiedWindow?.classification ?? null,
      liveWindow: this.window && liveMetrics ? {
        kind: 'live/current-window',
        windowId: this.window.id,
        epoch: this.window.epoch,
        startMs: this.window.startMs,
        endMs: this.window.endMs,
        targetHz: this.window.targetHz,
        qualityStep: this.window.qualityStep,
        metrics: liveMetrics,
      } : null,
      transition: this.controller.pendingTrial
        ? `${this.controller.pendingTrial.direction ?? this.controller.pendingTrial.kind} trial` : `Load windows ${this.controller.loadOverloadStreak}/2; delivery windows ${this.controller.deliveryOverloadStreak}/3`,
      lastAdaptiveDecision: this.lastAdaptiveDecision ?? this.controller.lastAdaptiveDecision,
      gpu: { status: !stats.available ? 'Unavailable' : currentMetrics?.gpuReliable ? 'Available' : 'Collecting / provisional',
        pending: stats.unresolvedQueries, valid: currentMetrics?.validGpuSamples ?? 0,
        attempted: currentMetrics?.attemptedGpuSamples ?? 0, skipped: currentMetrics?.skippedGpuSamples ?? 0 },
      controller: this.controller.snapshot(), history: this.history,
    };
  }
}
