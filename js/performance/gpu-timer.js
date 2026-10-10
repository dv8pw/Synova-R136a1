const TIMER_EXTENSION = 'EXT_disjoint_timer_query_webgl2';
const DEFAULT_TIME_ELAPSED = 0x88bf;
const DEFAULT_QUERY_RESULT_AVAILABLE = 0x8867;
const DEFAULT_QUERY_RESULT = 0x8866;
const DEFAULT_GPU_DISJOINT = 0x8fbb;

/**
 * Asynchronous WebGL2 timer-query collection.
 *
 * A caller explicitly opens an interval, records sequential simulation and
 * presentation scopes, closes the interval, and polls on later RAF callbacks.
 * Samples are published only when every query belonging to a closed interval
 * has completed successfully.
 */
export class GpuTimerSampler {
  constructor(gl, options = {}) {
    this.gl = gl ?? null;
    this.extension = options.extension
      ?? this.gl?.getExtension?.(TIMER_EXTENSION)
      ?? null;
    this.maxPendingQueries = Math.max(1, options.maxPendingQueries ?? 8);
    this.maxAgeFrames = Math.max(1, options.maxAgeFrames ?? 120);
    this.maxAgeMs = Math.max(1, options.maxAgeMs ?? 5000);
    this.now = options.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
    this.epoch = options.epoch ?? 0;
    this.windowId = options.windowId ?? 0;
    this.queryId = 0;
    this.intervalId = 0;
    this.pollCount = 0;
    this.pending = new Map();
    this.intervals = new Map();
    this.activeScope = null;
    this.currentInterval = null;
    this.resultQueue = [];
    this.lastResults = [];
  }

  get available() {
    return Boolean(
      this.extension
      && typeof this.gl?.createQuery === 'function'
      && typeof this.gl?.beginQuery === 'function'
      && typeof this.gl?.endQuery === 'function'
      && typeof this.gl?.getQueryParameter === 'function',
    );
  }

  get pendingQueryCount() {
    return this.pending.size + (this.activeScope ? 1 : 0);
  }

  beginInterval(metadata = {}) {
    if (this.activeScope) {
      const previous = this.intervals.get(this.activeScope.intervalId);
      if (previous) this.invalidateInterval(previous, 'query-scope-carried-between-callbacks');
      this.abortActiveScope();
    }
    const interval = {
      id: ++this.intervalId,
      epoch: metadata.epoch ?? this.epoch,
      windowId: metadata.windowId ?? this.windowId,
      metadata: { ...metadata },
      startedAt: this.now(),
      closed: false,
      invalid: !this.available,
      invalidReason: this.available ? null : 'gpu-timer-unavailable',
      missingScope: false,
      expectedQueryIds: new Set(),
      scopeKinds: new Set(),
      scopeResults: [],
    };
    this.intervals.set(interval.id, interval);
    this.currentInterval = interval;
    return interval;
  }

  /** Alias for integrations that call an interval a presentation frame. */
  beginFrame(metadata = {}) {
    return this.beginInterval(metadata);
  }

  openInterval(metadata = {}) {
    return this.beginInterval(metadata);
  }

  beginScope(kind, intervalOrMetadata = this.currentInterval, maybeMetadata = {}) {
    const { interval, metadata } = this.resolveScopeArguments(intervalOrMetadata, maybeMetadata);
    if (!interval) return null;
    if (this.activeScope) {
      this.invalidateInterval(interval, 'nested-query-scope');
      return null;
    }
    if (!this.available) {
      interval.invalid = true;
      interval.invalidReason = interval.invalidReason ?? 'gpu-timer-unavailable';
      interval.missingScope = true;
      return null;
    }
    if (this.pendingQueryCount >= this.maxPendingQueries) {
      interval.invalid = true;
      interval.invalidReason = 'query-cap-reached';
      interval.missingScope = true;
      return null;
    }

    let query;
    try {
      query = this.gl.createQuery();
      if (!query) throw new Error('createQuery returned no query.');
      this.gl.beginQuery(this.timeElapsedTarget, query);
    } catch {
      if (query) this.deleteQuery(query);
      interval.invalid = true;
      interval.invalidReason = 'query-start-failed';
      interval.missingScope = true;
      return null;
    }

    const scope = {
      id: ++this.queryId,
      query,
      kind: String(kind ?? 'other'),
      intervalId: interval.id,
      epoch: interval.epoch,
      windowId: interval.windowId,
      metadata: { ...metadata },
      closed: false,
    };
    this.activeScope = scope;
    return scope;
  }

  endScope(scope) {
    if (!scope) return false;
    const interval = this.intervals.get(scope.intervalId);
    if (!interval || this.activeScope !== scope || scope.closed) {
      if (interval) this.invalidateInterval(interval, 'query-scope-mismatch');
      return false;
    }

    try {
      this.gl.endQuery(this.timeElapsedTarget);
    } catch {
      this.activeScope = null;
      scope.closed = true;
      this.invalidateInterval(interval, 'query-end-failed');
      this.deleteQuery(scope.query);
      return false;
    }

    scope.closed = true;
    this.activeScope = null;
    interval.expectedQueryIds.add(scope.id);
    interval.scopeKinds.add(scope.kind);
    this.pending.set(scope.id, {
      scope,
      enqueuedAt: this.now(),
      enqueuedPoll: this.pollCount,
      ready: false,
    });
    // Prevent a same-task readback even when the caller invokes poll directly
    // after endScope. A later RAF has already passed this microtask boundary.
    Promise.resolve().then(() => {
      const pending = this.pending.get(scope.id);
      if (pending) pending.ready = true;
    });
    return true;
  }

  closeInterval(intervalOrId) {
    const interval = this.resolveInterval(intervalOrId);
    if (!interval) return null;
    interval.closed = true;
    if (this.activeScope?.intervalId === interval.id) {
      interval.invalid = true;
      interval.invalidReason = 'unclosed-query-scope';
      this.abortActiveScope();
    }
    if (interval.expectedQueryIds.size === 0 && this.available) {
      interval.invalid = true;
      interval.invalidReason = interval.invalidReason ?? 'missing-query-scope';
      interval.missingScope = true;
    }
    if (!interval.scopeKinds.has('presentation')) {
      interval.invalid = true;
      interval.invalidReason = interval.invalidReason ?? 'missing-presentation-scope';
      interval.missingScope = true;
    }
    if (this.currentInterval === interval) this.currentInterval = null;
    return this.maybeFinalize(interval);
  }

  finishInterval(intervalOrId) {
    return this.closeInterval(intervalOrId);
  }

  /**
   * Poll only from a later callback. Results contain valid complete samples
   * and explicit invalid entries for intervals lost to disjoint/expiry/etc.
   */
  poll(options = {}) {
    this.pollCount += 1;
    this.lastResults = this.resultQueue.splice(0);
    if (!this.available) {
      this.discardPending('gpu-timer-unavailable');
      if (this.resultQueue.length > 0) this.lastResults.push(...this.resultQueue.splice(0));
      return this.lastResults;
    }

    if (this.isDisjoint()) {
      for (const pending of [...this.pending.values()]) {
        this.invalidatePending(pending, 'gpu-disjoint');
      }
    }

    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : this.now();
    for (const pending of [...this.pending.values()]) {
      if (!pending.ready) continue;
      const age = this.pollCount - pending.enqueuedPoll;
      const expired = age > this.maxAgeFrames
        || (Number.isFinite(now) && Number.isFinite(pending.enqueuedAt)
          && now - pending.enqueuedAt > (options.maxAgeMs ?? this.maxAgeMs));
      if (expired) {
        this.invalidatePending(pending, 'query-expired');
        continue;
      }

      let available = false;
      try {
        available = Boolean(this.gl.getQueryParameter(pending.scope.query, this.queryAvailableParameter));
      } catch {
        this.invalidatePending(pending, 'query-status-failed');
        continue;
      }
      if (!available) continue;

      let nanoseconds;
      try {
        nanoseconds = Number(this.gl.getQueryParameter(pending.scope.query, this.queryResultParameter));
      } catch {
        this.invalidatePending(pending, 'query-result-failed');
        continue;
      }
      if (!Number.isFinite(nanoseconds) || nanoseconds < 0) {
        this.invalidatePending(pending, 'invalid-query-result');
        continue;
      }

      this.pending.delete(pending.scope.id);
      this.deleteQuery(pending.scope.query);
      this.recordResult(pending.scope, nanoseconds / 1e6);
    }

    if (this.resultQueue.length > 0) this.lastResults.push(...this.resultQueue.splice(0));
    return this.lastResults;
  }

  resetEpoch(epoch = this.epoch + 1, windowId = this.windowId) {
    this.discardPending('epoch-reset');
    this.epoch = epoch;
    this.windowId = windowId;
    this.currentInterval = null;
    this.intervals.clear();
    this.activeScope = null;
    this.resultQueue.length = 0;
  }

  setContext({ epoch = this.epoch, windowId = this.windowId } = {}) {
    this.epoch = epoch;
    this.windowId = windowId;
  }

  snapshot() {
    return {
      available: this.available,
      pendingQueries: this.pending.size,
      unresolvedQueries: this.pendingQueryCount,
      openIntervals: [...this.intervals.values()].filter(interval => !interval.closed).length,
      epoch: this.epoch,
      windowId: this.windowId,
    };
  }

  get timeElapsedTarget() {
    return this.extension?.TIME_ELAPSED_EXT ?? DEFAULT_TIME_ELAPSED;
  }

  get queryAvailableParameter() {
    return this.gl?.QUERY_RESULT_AVAILABLE ?? DEFAULT_QUERY_RESULT_AVAILABLE;
  }

  get queryResultParameter() {
    return this.gl?.QUERY_RESULT ?? DEFAULT_QUERY_RESULT;
  }

  resolveInterval(intervalOrId) {
    if (intervalOrId && typeof intervalOrId === 'object') {
      return this.intervals.get(intervalOrId.id) ?? null;
    }
    return this.intervals.get(intervalOrId) ?? null;
  }

  resolveScopeArguments(intervalOrMetadata, maybeMetadata) {
    if (intervalOrMetadata && typeof intervalOrMetadata === 'object') {
      if (Number.isFinite(intervalOrMetadata.id) && this.intervals.has(intervalOrMetadata.id)) {
        return { interval: this.intervals.get(intervalOrMetadata.id), metadata: maybeMetadata };
      }
      if (intervalOrMetadata.interval) {
        return {
          interval: this.resolveInterval(intervalOrMetadata.interval),
          metadata: { ...intervalOrMetadata, interval: undefined },
        };
      }
    }
    return { interval: this.currentInterval, metadata: intervalOrMetadata ?? {} };
  }

  recordResult(scope, milliseconds) {
    const interval = this.intervals.get(scope.intervalId);
    if (!interval) return;
    interval.scopeResults.push({
      kind: scope.kind,
      milliseconds,
      epoch: scope.epoch,
      windowId: scope.windowId,
      metadata: scope.metadata,
    });
    interval.expectedQueryIds.delete(scope.id);
    this.maybeFinalize(interval);
  }

  maybeFinalize(interval) {
    if (!interval.closed || interval.expectedQueryIds.size > 0) return null;
    this.intervals.delete(interval.id);
    if (interval.invalid || interval.missingScope) {
      const invalid = {
        valid: false,
        reason: interval.invalidReason ?? 'invalid-gpu-interval',
        epoch: interval.epoch,
        windowId: interval.windowId,
        intervalId: interval.id,
        metadata: interval.metadata,
      };
      this.resultQueue.push(invalid);
      return invalid;
    }
    const simulationMs = interval.scopeResults
      .filter(result => result.kind === 'simulation')
      .reduce((sum, result) => sum + result.milliseconds, 0);
    const presentationMs = interval.scopeResults
      .filter(result => result.kind === 'presentation')
      .reduce((sum, result) => sum + result.milliseconds, 0);
    const totalMs = interval.scopeResults
      .reduce((sum, result) => sum + result.milliseconds, 0);
    const sample = {
      valid: true,
      epoch: interval.epoch,
      windowId: interval.windowId,
      intervalId: interval.id,
      simulationMs,
      presentationMs,
      totalMs,
      scopeCount: interval.scopeResults.length,
      metadata: interval.metadata,
    };
    this.resultQueue.push(sample);
    return sample;
  }

  invalidateInterval(interval, reason) {
    interval.invalid = true;
    interval.invalidReason = interval.invalidReason ?? reason;
  }

  invalidatePending(pending, reason) {
    const interval = this.intervals.get(pending.scope.intervalId);
    this.pending.delete(pending.scope.id);
    this.deleteQuery(pending.scope.query);
    if (!interval) return;
    this.invalidateInterval(interval, reason);
    interval.expectedQueryIds.delete(pending.scope.id);
    this.maybeFinalize(interval);
  }

  discardPending(reason) {
    for (const pending of [...this.pending.values()]) this.invalidatePending(pending, reason);
    if (this.activeScope) {
      const interval = this.intervals.get(this.activeScope.intervalId);
      if (interval) this.invalidateInterval(interval, reason);
      this.abortActiveScope();
    }
  }

  abortActiveScope() {
    if (!this.activeScope) return;
    try {
      this.gl?.endQuery?.(this.timeElapsedTarget);
    } catch {
      // A lost context may reject the end operation; cleanup remains best-effort.
    }
    this.deleteQuery(this.activeScope.query);
    this.activeScope = null;
  }

  isDisjoint() {
    try {
      return Boolean(this.gl.getParameter(
        this.extension?.GPU_DISJOINT_EXT ?? this.gl?.GPU_DISJOINT_EXT ?? DEFAULT_GPU_DISJOINT,
      ));
    } catch {
      return true;
    }
  }

  deleteQuery(query) {
    try {
      this.gl?.deleteQuery?.(query);
    } catch {
      // Query cleanup is best-effort after a lost context.
    }
  }
}

export function createGpuTimerSampler(gl, options = {}) {
  return new GpuTimerSampler(gl, options);
}
