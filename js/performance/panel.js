import { S as state } from '../context.js';
import { getFloatingWindowManager } from '../ui/floating-window.js';
import { installInteractionRouter } from '../ui/interaction-router.js';

const PANEL_ID = 'performance-panel';
let panel;
let lastUpdate = -Infinity;
const outputs = new Map();

const number = (value, suffix = '', digits = 2) => Number.isFinite(Number(value))
  ? `${Number(value).toFixed(digits)}${suffix}` : 'Unavailable';
const timing = value => value
  ? `${number(value.median, ' ms')} / ${number(value.p95, ' ms')}` : 'Unavailable';
const duration = value => Number.isFinite(Number(value))
  ? `${(Number(value) / 1000).toFixed(1)} s` : 'Unavailable';

function trialValue(trial) {
  if (!trial) return 'None';
  return `${trial.direction} ${trial.kind}: ${number(trial.fromTargetHz, ' Hz', 1)} / Q${trial.fromQualityStep}`
    + ` → ${number(trial.targetHz, ' Hz', 1)} / Q${trial.qualityStep} • ${trial.reason}`;
}

function decisionValue(decision) {
  if (!decision) return 'None';
  return `${decision.reason}: ${number(decision.fromTargetHz, ' Hz', 1)} / Q${decision.fromQualityStep}`
    + ` → ${number(decision.targetHz, ' Hz', 1)} / Q${decision.qualityStep}`;
}

function windowId(value) {
  return value?.windowId ?? value?.id ?? 'Unavailable';
}

function windowLabel(value) {
  if (!value) return 'Unavailable';
  const start = Number.isFinite(Number(value.startMs)) ? Number(value.startMs).toFixed(0) : '?';
  const end = Number.isFinite(Number(value.endMs)) ? Number(value.endMs).toFixed(0) : '?';
  return `#${windowId(value)} • ${start}–${end} ms`;
}

function addGroup(body, title, values) {
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'tuning-panel__group';
  fieldset.dataset.copyGroup = title;
  fieldset.dataset.copyLabel = title;
  const legend = document.createElement('legend');
  legend.textContent = title;
  fieldset.append(legend);
  for (const [label, value] of Object.entries(values)) {
    const row = document.createElement('div');
    row.className = 'performance-panel__row';
    row.dataset.copyRow = 'true';
    row.dataset.copyLabel = label;
    const name = document.createElement('span');
    name.textContent = label;
    const output = document.createElement('output');
    output.dataset.copyValue = String(value ?? 'Waiting');
    output.textContent = value ?? 'Waiting';
    row.dataset.copyValue = String(value ?? 'Waiting');
    row.append(name, output);
    fieldset.append(row);
    outputs.set(label, output);
  }
  body.append(fieldset);
}

export function installPerformancePanel() {
  if (panel || typeof document === 'undefined') return panel;

  panel = document.createElement('section');
  panel.id = PANEL_ID;
  panel.className = 'tuning-panel performance-panel floating-window';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Performance');
  panel.dataset.synovaR136a1Ui = 'floating-window';

  const body = document.createElement('div');
  body.className = 'tuning-panel__body';
  addGroup(body, 'Qualification', {
    State: 'Waiting',
    'Controller state': 'Waiting',
    Reason: 'Waiting',
    Evidence: 'Waiting',
    'Overload evidence': 'Waiting',
    'GPU availability': 'Waiting',
    'Classified window': 'Waiting',
    'Consecutive overload': 'Waiting',
    'Load overload': 'Waiting',
    'Delivery overload': 'Waiting',
    'Stable recovery': 'Waiting',
    'Pending trial': 'Waiting',
    'Classified decision': 'Waiting',
    Epoch: 'Waiting',
    'Promotion / demotion': 'Waiting',
  });
  addGroup(body, 'Cadence', {
    'Raw observed cadence': 'Waiting',
    'Snapped cadence': 'Waiting',
    'Supported rates': 'Waiting',
    'Fallback rates': 'Waiting',
    'Target / delivered (classified)': 'Waiting',
    'Frame budget': 'Waiting',
    'RAF median / p95': 'Waiting',
    'Frame intervals (classified)': 'Waiting',
    'Late / missed (classified)': 'Waiting',
    'Delivery ratio (classified)': 'Waiting',
    'Live window': 'Waiting',
    'Late / missed (live)': 'Waiting',
    'Delivery ratio (live)': 'Waiting',
  });
  addGroup(body, 'CPU / GPU (median / p95)', {
    'CPU total': 'Waiting',
    'CPU callback': 'Waiting',
    'CPU simulation': 'Waiting',
    'CPU submission': 'Waiting',
    'GPU total': 'Waiting',
    'GPU simulation': 'Waiting',
    'GPU presentation': 'Waiting',
    'Timer queries': 'Waiting',
    'GPU samples': 'Waiting',
  });
  addGroup(body, 'Effective quality', {
    'Quality step': 'Waiting',
    'Available steps': 'Waiting',
    'Requested / effective DPR': 'Waiting',
    'Render resolution': 'Waiting',
    'Bloom / FXAA': 'Waiting',
    'Fluid iterations': 'Waiting',
    'Particle counts': 'Waiting',
    'Costly features': 'Waiting',
  });
  const note = document.createElement('p');
  note.className = 'performance-panel__note';
  note.textContent = 'Classified values come from the last completed Synova-R136a1 window. Live values describe the current window in progress.';
  body.append(note);
  panel.append(body);
  document.body.append(panel);

  getFloatingWindowManager()?.register(panel, {
    id: PANEL_ID,
    title: 'Performance',
    width: 960,
    height: 520,
    fitContent: true,
    // Live qualification details can wrap onto extra lines after first opening.
    fitContentReserve: 96,
    minWidth: 320,
    minHeight: 240,
  });
  installInteractionRouter();
  panel.addEventListener('synova-r136a1:window-opened', () => {
    lastUpdate = -Infinity;
    updatePerformancePanel(performance.now());
  });
  if (new URLSearchParams(window.location.search).has('perf')) {
    queueMicrotask(() => getFloatingWindowManager()?.open(PANEL_ID));
  }
  updatePerformancePanel(performance.now());
  return panel;
}

export function updatePerformancePanel(timestamp) {
  if (!panel || panel.hidden || timestamp - lastUpdate < 250) return;
  lastUpdate = timestamp;
  const snapshot = state.WebGL?.performance?.snapshot();
  if (!snapshot) {
    outputs.get('State')?.replaceChildren(document.createTextNode('Probing browser cadence'));
    return;
  }

  const classifiedWindow = snapshot.classifiedWindow;
  const classifiedMetrics = classifiedWindow?.metrics || {};
  const liveMetrics = snapshot.liveWindow?.metrics;
  const classification = classifiedWindow?.classification;
  const quality = snapshot.workload;
  const cadence = snapshot.cadence || {};
  const controller = snapshot.controller || {};
  const evidence = classifiedWindow?.controllerEvidence || {};
  const gpu = snapshot.gpu || {};
  const classifiedTargetHz = Number.isFinite(Number(classifiedWindow?.targetHz))
    ? Number(classifiedWindow.targetHz) : Number(snapshot.targetHz);
  const classifiedFrameBudget = Number.isFinite(classifiedTargetHz) && classifiedTargetHz > 0
    ? 1000 / classifiedTargetHz : snapshot.frameBudgetMs;
  const classifiedDelivery = Number.isFinite(Number(classifiedMetrics.deliveryRatio))
    ? number(Number(classifiedMetrics.deliveryRatio) * 100, '%') : 'Unavailable';
  const liveDelivery = Number.isFinite(Number(liveMetrics?.deliveryRatio))
    ? number(Number(liveMetrics.deliveryRatio) * 100, '%') : 'Collecting';
  const values = {
    State: snapshot.stage,
    'Controller state': controller.state ?? 'Collecting',
    Reason: classifiedWindow?.reason || snapshot.reason,
    Evidence: snapshot.evidence,
    'Overload evidence': classification?.overloadCauses?.join(', ') || 'None',
    'GPU availability': gpu.status ?? 'Unavailable',
    'Classified window': windowLabel(classifiedWindow),
    'Consecutive overload': `${Math.max(evidence.loadOverloadStreak || 0, evidence.deliveryOverloadStreak || 0)} windows`,
    'Load overload': `${evidence.loadOverloadStreak ?? 0} / 2 windows`,
    'Delivery overload': `${evidence.deliveryOverloadStreak ?? 0} / 3 windows • ${duration(evidence.deliveryOverloadDurationMs)} / 6 s`,
    'Stable recovery': `${duration(evidence.stableDurationMs)} / 15 s • ${evidence.stableWindowCount ?? 0} / 5 windows`,
    'Pending trial': trialValue(controller.pendingTrial),
    'Classified decision': decisionValue(classifiedWindow?.decision),
    Epoch: String(snapshot.epoch ?? 'Waiting'),
    'Promotion / demotion': snapshot.transition || 'Monitoring',
    'Raw observed cadence': `${number(cadence.observedRefreshHz, ' Hz')} (${cadence.confident ? 'stable' : 'provisional'})`,
    'Snapped cadence': Number.isFinite(cadence.snappedRefreshHz) ? number(cadence.snappedRefreshHz, ' Hz', 1) : 'None',
    'Supported rates': (snapshot.supportedRates || []).join(', '),
    'Fallback rates': (snapshot.fallbackRates || []).map(value => number(value, '', 1)).join(', '),
    'Target / delivered (classified)': `${number(classifiedTargetHz, ' Hz', 1)} / ${number(classifiedMetrics.deliveredHz, ' Hz', 1)}`,
    'Frame budget (classified)': number(classifiedFrameBudget, ' ms'),
    'RAF median / p95': timing(classifiedMetrics.raf),
    'Frame intervals (classified)': classifiedMetrics.presentation
      ? `${timing(classifiedMetrics.presentation)} / p99 ${number(classifiedMetrics.presentation.p99, ' ms')}` : 'Collecting',
    'Late / missed (classified)': `${number(Number(classifiedMetrics.lateFraction) * 100, '%')} / ${classifiedMetrics.lateCount ?? '—'} / ${classifiedMetrics.missedFrames ?? '—'}`,
    'Delivery ratio (classified)': classifiedDelivery,
    'Live window': liveMetrics ? windowLabel(snapshot.liveWindow || { ...liveMetrics, windowId: liveMetrics.windowId }) : 'None',
    'Late / missed (live)': liveMetrics
      ? `${number(Number(liveMetrics.lateFraction) * 100, '%')} / ${liveMetrics.lateCount ?? '—'} / ${liveMetrics.missedFrames ?? '—'}` : 'None',
    'Delivery ratio (live)': liveDelivery,
    'CPU total': timing(classifiedMetrics.cpu),
    'CPU callback': timing(classifiedMetrics.callbackCpu),
    'CPU simulation': timing(classifiedMetrics.simulationCpu),
    'CPU submission': timing(classifiedMetrics.presentationCpu),
    'GPU total': timing(classifiedMetrics.gpu),
    'GPU simulation': timing(classifiedMetrics.simulationGpu),
    'GPU presentation': timing(classifiedMetrics.presentationGpu),
    'Timer queries': `${gpu.status ?? 'Unavailable'} • ${gpu.pending ?? 0} pending`,
    'GPU samples': `${gpu.valid ?? 0} valid / ${gpu.attempted ?? 0} attempted / ${gpu.skipped ?? 0} skipped`,
  };
  if (quality) Object.assign(values, {
    'Quality step': `Q${quality.qualityStep} • ${quality.qualitySteps[quality.qualityStep].name}`,
    'Available steps': quality.qualitySteps.map((step, index) => `Q${index} ${step.name}`).join(' → '),
    'Requested / effective DPR': `${number(Math.min(quality.devicePixelRatio, 2))} / ${number(quality.rendererPixelRatio)}`,
    'Render resolution': quality.renderDimensions.join(' × '),
    'Bloom / FXAA': `${quality.bloom.enabled ? number(quality.bloom.resolutionScale * 100, '%', 0) : 'Off'} / ${quality.fxaaSamples} samples`,
    'Fluid iterations': `${number(quality.requested.fluidIterations)} requested / ${number(quality.effective.fluidIterations)} effective`,
    'Particle counts': `${quality.particleCounts.main} main / ${quality.particleCounts.flares} flares`,
    'Costly features': Object.entries(quality.costlyFeatures || {}).filter(([, value]) => value).map(([key]) => key).join(', '),
  });
  for (const [label, value] of Object.entries(values)) {
    const output = outputs.get(label);
    if (!output) continue;
    const text = value ?? 'Waiting';
    if (output.textContent !== text) output.textContent = text;
    const row = output.closest('[data-copy-row]');
    if (row) row.dataset.copyValue = String(text);
    output.dataset.copyValue = String(text);
  }
}

window.addEventListener('synova-r136a1:show-performance', () => {
  const installed = installPerformancePanel();
  getFloatingWindowManager()?.open(installed?.id || PANEL_ID);
});
