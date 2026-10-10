export function smootherstep(progress) {
  const t = Math.min(1, Math.max(0, progress));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function createOpeningReveal(state, { onStart, onProgress, onFinish }) {
  const overlay = document.querySelector('#opening-reveal');
  let holdStart = 0;
  let fadeStart = null;
  let ready = false;
  let completed = false;
  let settings = { ...state.opening };
  overlay.dataset.state = 'loading';

  function replay(seconds) {
    settings = { ...state.opening };
    holdStart = seconds;
    fadeStart = null;
    completed = false;
    overlay.hidden = false;
    overlay.style.visibility = 'visible';
    overlay.style.pointerEvents = 'auto';
    overlay.style.opacity = '1';
    overlay.dataset.state = ready ? 'holding' : 'loading';
    state.openingCameraDistance = settings.cameraDistance;
  }

  replay(0);
  // Parsing and loading can already have held the overlay after its first paint.
  holdStart = -Math.max(0, performance.now() - (window.__synovaR136a1FirstPaintTimestamp ?? performance.now())) / 1000;
  return {
    replay,
    markReady() { ready = true; overlay.dataset.state = 'holding'; },
    update(seconds) {
      if (!ready || completed) return;
      if (fadeStart === null) {
        if ((seconds - holdStart) * 1000 < settings.holdMs) return;
        fadeStart = seconds;
        overlay.dataset.state = 'revealing';
        onStart();
      }
      const progress = settings.fadeMs > 0 ? Math.min(1, (seconds - fadeStart) * 1000 / settings.fadeMs) : 1;
      overlay.style.opacity = String(1 - progress);
      state.openingCameraDistance = settings.cameraDistance * (1 - smootherstep(progress));
      onProgress(progress);
      if (progress >= 1) {
        completed = true;
        state.openingCameraDistance = 0;
        overlay.style.opacity = '0';
        overlay.hidden = true;
        overlay.style.visibility = 'hidden';
        overlay.style.pointerEvents = 'none';
        overlay.dataset.state = 'complete';
        onFinish();
      }
    },
    fail() {
      ready = false;
      overlay.hidden = false;
      overlay.style.visibility = 'visible';
      overlay.style.pointerEvents = 'auto';
      overlay.style.opacity = '1';
      overlay.dataset.state = 'failed';
      overlay.textContent = 'The scene could not load. Reload to try again.';
    },
  };
}
