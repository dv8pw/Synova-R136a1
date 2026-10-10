const DEFAULT_WIDTH = 680;
const DEFAULT_HEIGHT = 520;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;
const VIEWPORT_MARGIN = 12;
const DRAG_THRESHOLD = 5;

const INTERACTIVE_SELECTOR = [
  'input', 'button', 'select', 'textarea', 'option', 'a', 'summary',
  '[contenteditable="true"]', '[role="button"]', '[role="slider"]',
  '[data-interactive]', '[data-resize]', '[data-window-action]',
].join(',');

let manager;

function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function canUseDesktopTools() {
  if (typeof window === 'undefined') return false;
  if (window.innerWidth < 800) return false;
  const pointer = typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: fine)').matches : true;
  const hover = typeof window.matchMedia === 'function'
    ? window.matchMedia('(hover: hover)').matches : true;
  return pointer && hover;
}

function isInteractiveTarget(target) {
  return target instanceof Element && Boolean(target.closest(INTERACTIVE_SELECTOR));
}

function iconSvg(kind) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('floating-window__icon');
  if (kind === 'pin') {
    svg.innerHTML = '<path d="m5.25 2.25 8.5 8.5m-5.25-7.25 3.9 3.9-1.8 1.8.4 3.2-1.2 1.2-1.9-3.1-4.2-4.2 3.1-1.9 1.2-1.2Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.2"/>';
  } else {
    svg.innerHTML = '<path d="m4 4 8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.3"/>';
  }
  return svg;
}

function createWindowButton(action, label, kind) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `floating-window__button floating-window__button--${action}`;
  button.dataset.windowAction = action;
  button.setAttribute('aria-label', label);
  button.title = label;
  if (action === 'pin') button.setAttribute('aria-pressed', 'false');
  button.append(iconSvg(kind));
  return button;
}

function ensureTitleBar(state) {
  let titlebar = state.element.querySelector(':scope > .floating-window__titlebar');
  if (!titlebar) {
    titlebar = document.createElement('div');
    titlebar.className = 'floating-window__titlebar';
    titlebar.dataset.synovaR136a1Ui = 'window-titlebar';
    const title = document.createElement('span');
    title.className = 'floating-window__title';
    title.textContent = state.title;
    title.id = `${state.id}-window-title`;
    const actions = document.createElement('div');
    actions.className = 'floating-window__actions';
    actions.append(
      createWindowButton('pin', `Pin ${state.title} window`, 'pin'),
      createWindowButton('close', `Close ${state.title} window`, 'close'),
    );
    titlebar.append(title, actions);
    state.element.prepend(titlebar);
  }
  state.titlebar = titlebar;
  state.element.setAttribute('aria-labelledby', `${state.id}-window-title`);
  state.pinButton = titlebar.querySelector('[data-window-action="pin"]');
  state.closeButton = titlebar.querySelector('[data-window-action="close"]');
  state.pinButton?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    manager.togglePin(state.id);
  });
  state.closeButton?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    manager.close(state.id);
  });
}

function ensureResizeHandles(state) {
  for (const edge of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
    if (state.element.querySelector(`[data-resize="${edge}"]`)) continue;
    const handle = document.createElement('span');
    handle.className = `floating-window__resize-handle floating-window__resize-handle--${edge}`;
    handle.dataset.resize = edge;
    handle.dataset.synovaR136a1Ui = 'window-resize';
    handle.setAttribute('aria-hidden', 'true');
    state.element.append(handle);
  }
}

class FloatingWindowManager {
  constructor() {
    this.windows = new Map();
    this.zIndex = 20;
    this.gesture = null;
    this.lastRightGesture = null;
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onPointerCancel = this.onPointerCancel.bind(this);
    this.onViewportChange = this.onViewportChange.bind(this);
    document.addEventListener('pointerdown', this.onPointerDown, true);
    document.addEventListener('pointermove', this.onPointerMove, true);
    document.addEventListener('pointerup', this.onPointerUp, true);
    document.addEventListener('pointercancel', this.onPointerCancel, true);
    document.addEventListener('lostpointercapture', event => {
      if (this.gesture?.pointerId === event.pointerId) this.onPointerCancel();
    }, true);
    document.addEventListener('focusin', event => {
      const state = this.stateForTarget(event.target);
      if (state) this.bringToFront(state.id);
    });
    window.addEventListener('resize', this.onViewportChange, { passive: true });
    window.addEventListener('blur', this.onPointerCancel, { passive: true });
  }

  register(element, options = {}) {
    if (!element || typeof document === 'undefined') return null;
    const id = options.id || element.id;
    if (!id) throw new Error('Floating windows need a stable id.');
    const existing = this.windows.get(id);
    if (existing) return existing.api;
    const state = {
      id,
      element,
      title: options.title || id,
      width: finite(options.width, DEFAULT_WIDTH),
      height: finite(options.height, DEFAULT_HEIGHT),
      fitContent: Boolean(options.fitContent),
      fitContentReserve: Math.max(0, finite(options.fitContentReserve, 0)),
      minWidth: finite(options.minWidth, MIN_WIDTH),
      minHeight: finite(options.minHeight, MIN_HEIGHT),
      margin: finite(options.margin, VIEWPORT_MARGIN),
      open: false,
      pinned: false,
      geometry: null,
      titlebar: null,
      pinButton: null,
      closeButton: null,
    };
    element.dataset.synovaR136a1Ui = 'floating-window';
    element.dataset.windowId = id;
    element.classList.add('floating-window');
    element.hidden = true;
    element.setAttribute('aria-hidden', 'true');
    ensureTitleBar(state);
    ensureResizeHandles(state);
    const api = {
      id,
      open: () => this.open(id),
      close: () => this.close(id),
      toggle: () => this.toggle(id),
      pin: () => this.setPinned(id, true),
      unpin: () => this.setPinned(id, false),
      isOpen: () => Boolean(this.windows.get(id)?.open),
      isPinned: () => Boolean(this.windows.get(id)?.pinned),
      element,
    };
    state.api = api;
    this.windows.set(id, state);
    this.updatePinButton(state);
    return api;
  }

  get(id) {
    return this.windows.get(id)?.api || null;
  }

  getState(id) {
    return this.windows.get(id) || null;
  }

  stateForTarget(target) {
    const element = target instanceof Element ? target.closest('.floating-window') : null;
    if (!element) return null;
    return [...this.windows.values()].find(state => state.element === element) || null;
  }

  isLauncherTarget(target) {
    return target instanceof Element && Boolean(target.closest('[data-synova-r136a1-ui="launcher"]'));
  }

  isWindowTarget(target) {
    return Boolean(this.stateForTarget(target));
  }

  open(id) {
    const state = this.windows.get(id);
    if (!state || !canUseDesktopTools()) return false;
    if (!state.open) {
      state.opener = document.activeElement;
      state.open = true;
      state.pinned = false;
      state.geometry = null;
      state.element.hidden = false;
      state.element.setAttribute('aria-hidden', 'false');
      state.element.classList.add('is-open');
      this.setDefaultGeometry(state);
      this.updatePinButton(state);
      state.element.dispatchEvent(new CustomEvent('synova-r136a1:window-opened', { bubbles: true, detail: { id } }));
      if (state.fitContent) this.fitDefaultContent(state);
    }
    this.bringToFront(id);
    this.clampState(state);
    state.pinButton?.focus({ preventScroll: true });
    return true;
  }

  close(id) {
    const state = this.windows.get(id);
    if (!state) return false;
    const wasOpen = state.open;
    const restoreFocus = state.element.contains(document.activeElement);
    state.open = false;
    state.pinned = false;
    state.geometry = null;
    state.element.hidden = true;
    state.element.setAttribute('aria-hidden', 'true');
    state.element.classList.remove('is-open');
    this.updatePinButton(state);
    this.clearGesture(state);
    if (restoreFocus && state.opener?.isConnected) state.opener.focus({ preventScroll: true });
    if (wasOpen) state.element.dispatchEvent(new CustomEvent('synova-r136a1:window-closed', { bubbles: true, detail: { id } }));
    return wasOpen;
  }

  toggle(id) {
    const state = this.windows.get(id);
    if (!state) return false;
    return state.open ? (this.close(id), false) : this.open(id);
  }

  setPinned(id, pinned) {
    const state = this.windows.get(id);
    if (!state || !state.open) return false;
    state.pinned = Boolean(pinned);
    this.updatePinButton(state);
    this.bringToFront(id);
    return state.pinned;
  }

  togglePin(id) {
    const state = this.windows.get(id);
    return state ? this.setPinned(id, !state.pinned) : false;
  }

  updatePinButton(state) {
    if (!state.pinButton) return;
    state.pinButton.setAttribute('aria-pressed', String(state.pinned));
    const label = state.pinned ? `Unpin ${state.title} window` : `Pin ${state.title} window`;
    state.pinButton.setAttribute('aria-label', label);
    state.pinButton.title = label;
    state.element.dataset.pinned = String(state.pinned);
  }

  bringToFront(id) {
    const state = this.windows.get(id);
    if (!state || !state.open) return;
    const ordered = [...this.windows.values()].filter(other => other.open && other !== state)
      .sort((a, b) => finite(a.element.style.zIndex, 0) - finite(b.element.style.zIndex, 0));
    ordered.push(state);
    ordered.forEach((other, index) => {
      other.element.style.zIndex = String(20 + index);
      other.element.classList.toggle('is-active', other === state);
    });
  }

  topmostUnpinned() {
    return [...this.windows.values()]
      .filter(state => state.open && !state.pinned)
      .sort((left, right) => finite(right.element.style.zIndex, 0) - finite(left.element.style.zIndex, 0))[0] || null;
  }

  closeTopUnpinned() {
    const state = this.topmostUnpinned();
    return state ? this.close(state.id) : false;
  }

  dismissOutside(target) {
    for (const state of this.windows.values()) {
      if (state.open && !state.pinned && !state.element.contains(target)) this.close(state.id);
    }
  }

  setDefaultGeometry(state) {
    const count = [...this.windows.values()].filter(candidate => candidate.open && candidate !== state).length;
    const width = Math.min(state.width, Math.max(state.minWidth, window.innerWidth - state.margin * 2));
    const height = Math.min(state.height, Math.max(state.minHeight, window.innerHeight - state.margin * 2));
    const offset = Math.min(36, count * 24);
    state.geometry = {
      left: window.innerWidth - width - state.margin - offset,
      top: 64 + offset,
      width,
      height,
    };
  }

  fitDefaultContent(state) {
    const body = state.element.querySelector(':scope > .tuning-panel__body');
    if (!body) return;
    const bounds = this.viewportBounds(state);
    const top = Math.max(bounds.top, state.geometry.top);
    const maxHeight = Math.max(bounds.minHeight, innerHeight - top - state.margin);
    const right = state.geometry.left + state.geometry.width;
    // Measure the real grid after the opened event has populated its values.
    // Widen only as needed to show all groups; short screens keep native scrolling.
    const startWidth = Math.min(state.width, bounds.width);
    for (let width = startWidth; ; width = Math.min(width + 80, bounds.width)) {
      state.geometry.width = width;
      state.geometry.height = maxHeight;
      state.geometry.left = right - width;
      state.geometry.top = top;
      this.clampState(state);
      const chromeHeight = state.element.offsetHeight - body.clientHeight;
      const bodyTop = body.getBoundingClientRect().top;
      const contentBottom = Math.max(bodyTop, ...Array.from(body.children, child => child.getBoundingClientRect().bottom));
      const paddingBottom = parseFloat(getComputedStyle(body).paddingBottom) || 0;
      const contentHeight = Math.ceil(contentBottom - bodyTop + paddingBottom) + chromeHeight + 2 + state.fitContentReserve;
      if (contentHeight <= maxHeight || width === bounds.width) {
        state.geometry.height = Math.min(maxHeight, Math.max(bounds.minHeight, contentHeight));
        this.clampState(state);
        break;
      }
    }
  }

  viewportBounds(state) {
    const top = Math.min(64, state.margin + Math.max(0, innerHeight - state.minHeight - 2 * state.margin));
    const width = Math.max(0, innerWidth - state.margin * 2);
    const height = Math.max(0, innerHeight - top - state.margin);
    return { top, width, height, minWidth: Math.min(state.minWidth, width), minHeight: Math.min(state.minHeight, height) };
  }

  clampState(state) {
    if (!state.geometry) return;
    const bounds = this.viewportBounds(state);
    const width = clamp(state.geometry.width, bounds.minWidth, bounds.width);
    const height = clamp(state.geometry.height, bounds.minHeight, bounds.height);
    state.geometry = {
      left: clamp(state.geometry.left, state.margin, innerWidth - width - state.margin),
      top: clamp(state.geometry.top, bounds.top, innerHeight - height - state.margin),
      width, height,
    };
    state.element.style.minWidth = `${bounds.minWidth}px`;
    state.element.style.minHeight = `${bounds.minHeight}px`;
    state.element.style.left = `${state.geometry.left}px`;
    state.element.style.top = `${state.geometry.top}px`;
    state.element.style.width = `${width}px`;
    state.element.style.height = `${height}px`;
  }

  updateDrag(state, dx, dy) {
    state.geometry.left += dx;
    state.geometry.top += dy;
    this.clampState(state);
  }

  updateResize(state, edges, dx, dy) {
    const geometry = state.geometry;
    const bounds = this.viewportBounds(state);
    const right = geometry.left + geometry.width;
    const bottom = geometry.top + geometry.height;
    if (edges.includes('e')) geometry.width = clamp(right + dx, geometry.left + bounds.minWidth, innerWidth - state.margin) - geometry.left;
    if (edges.includes('s')) geometry.height = clamp(bottom + dy, geometry.top + bounds.minHeight, innerHeight - state.margin) - geometry.top;
    if (edges.includes('w')) {
      geometry.left = clamp(geometry.left + dx, state.margin, right - bounds.minWidth);
      geometry.width = right - geometry.left;
    }
    if (edges.includes('n')) {
      geometry.top = clamp(geometry.top + dy, bounds.top, bottom - bounds.minHeight);
      geometry.height = bottom - geometry.top;
    }
    this.clampState(state);
  }

  onPointerDown(event) {
    this.dismissOutside(event.target);
    const state = this.stateForTarget(event.target);
    if (!state || !state.open) {
      if (!state && !this.isLauncherTarget(event.target) && !(event.target instanceof Element && event.target.closest('[data-synova-r136a1-ui="theme-menu"]'))) {
        this.dismissOutside(event.target);
      }
      return;
    }
    this.bringToFront(state.id);
    if (event.target.closest('[data-window-action]')) return;
    const resize = event.target.closest('[data-resize]')?.dataset.resize;
    if (resize && (event.button === 0 || event.button === 2)) {
      this.beginGesture(state, event, 'resize', resize);
      event.preventDefault();
      return;
    }
    if ((event.button !== 0 && event.button !== 2) || isInteractiveTarget(event.target)) return;
    for (let element = event.target; element instanceof Element && state.element.contains(element); element = element.parentElement) {
      const rect = element.getBoundingClientRect();
      if ((element.scrollHeight > element.clientHeight && element.offsetWidth - element.clientWidth > 2
        && event.clientX >= rect.left + element.clientWidth)
        || (element.scrollWidth > element.clientWidth && element.offsetHeight - element.clientHeight > 2
          && event.clientY >= rect.top + element.clientHeight)) return;
    }
    this.beginGesture(state, event, 'drag', '');
    if (event.button === 2) event.preventDefault();
  }

  beginGesture(state, event, type, edges) {
    this.gesture = {
      state,
      type,
      edges,
      pointerId: event.pointerId,
      button: event.button,
      target: event.target,
      startX: event.clientX,
      startY: event.clientY,
      startGeometry: { ...state.geometry },
      moved: false,
    };
    // Preserve native label activation on stationary left clicks.
    if (event.button === 2 || type === 'resize') state.element.setPointerCapture?.(event.pointerId);
  }

  onPointerMove(event) {
    const gesture = this.gesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!gesture.moved && Math.hypot(dx, dy) <= DRAG_THRESHOLD) return;
    gesture.moved = true;
    if (!gesture.state.element.hasPointerCapture?.(event.pointerId)) gesture.state.element.setPointerCapture?.(event.pointerId);
    gesture.state.geometry = { ...gesture.startGeometry };
    if (gesture.type === 'drag') this.updateDrag(gesture.state, dx, dy);
    else this.updateResize(gesture.state, gesture.edges, dx, dy);
    this.bringToFront(gesture.state.id);
    event.preventDefault();
  }

  onPointerUp(event) {
    if (!this.gesture || this.gesture.pointerId !== event.pointerId) return;
    const gesture = this.gesture;
    if (gesture.button === 2) {
      this.lastRightGesture = { state: gesture.state, moved: gesture.moved, target: gesture.target, at: Date.now() };
    }
    this.clearGesture(gesture.state);
  }

  onPointerCancel() {
    if (this.gesture) this.clearGesture(this.gesture.state);
  }

  clearGesture(state) {
    if (!this.gesture || (state && this.gesture.state !== state)) return;
    const gesture = this.gesture;
    this.gesture = null;
    if (gesture.state.element.hasPointerCapture?.(gesture.pointerId)) {
      gesture.state.element.releasePointerCapture(gesture.pointerId);
    }
  }

  consumeRightGesture(state) {
    const gesture = this.lastRightGesture;
    if (!gesture || gesture.state !== state || Date.now() - gesture.at > 700) return null;
    this.lastRightGesture = null;
    return gesture;
  }

  peekRightGesture(state) {
    const gesture = this.lastRightGesture;
    if (!gesture || gesture.state !== state || Date.now() - gesture.at > 700) return null;
    return gesture;
  }

  pendingRightGesture(state) {
    const gesture = this.gesture;
    if (!gesture || gesture.state !== state || gesture.button !== 2) return null;
    return gesture;
  }

  markRightGestureHandled(state) {
    if (this.lastRightGesture?.state === state) this.lastRightGesture.handled = true;
  }

  onViewportChange() {
    if (!canUseDesktopTools()) {
      for (const state of this.windows.values()) this.close(state.id);
      return;
    }
    for (const state of this.windows.values()) if (state.open) this.clampState(state);
  }
}

export function getFloatingWindowManager() {
  if (typeof document === 'undefined') return null;
  manager ||= new FloatingWindowManager();
  return manager;
}

export function desktopToolsAvailable() {
  return canUseDesktopTools();
}

export { DEFAULT_WIDTH, DEFAULT_HEIGHT, MIN_WIDTH, MIN_HEIGHT, VIEWPORT_MARGIN, DRAG_THRESHOLD };
