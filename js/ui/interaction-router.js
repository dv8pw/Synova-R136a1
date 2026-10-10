import { getFloatingWindowManager } from './floating-window.js';

let routerInstalled = false;
let themeMenu;
let copyCooldownUntil = 0;
let copyNotice;

const CONTROL_SELECTOR = 'input,button,select,textarea,option,[contenteditable="true"],[data-resize],[data-window-action]';

function isControlTarget(target) {
  return target instanceof Element && Boolean(target.closest(CONTROL_SELECTOR));
}

function groupForTarget(target, state) {
  if (!(target instanceof Element) || !state) return null;
  const group = target.closest('[data-copy-group]');
  return group && state.element.contains(group) ? group : null;
}

function groupText(group) {
  const label = group.dataset.copyLabel || group.querySelector('legend')?.textContent?.trim() || 'Group';
  const lines = [];
  const rows = group.querySelectorAll('[data-copy-row], .tuning-panel__row, .performance-panel__row');
  for (const row of rows) {
    const rowLabel = row.dataset.copyLabel
      || row.querySelector('[data-copy-label], span, .tuning-panel__value')?.textContent?.trim()
      || row.textContent?.trim();
    const value = row.dataset.copyValue
      ?? row.querySelector('[data-copy-value]')?.textContent?.trim()
      ?? row.querySelector('output')?.textContent?.trim()
      ?? row.querySelector('input')?.value
      ?? '';
    if (!rowLabel || rowLabel === value) continue;
    const id = row.dataset.controlId ? ` [${row.dataset.controlId}]` : '';
    lines.push(`${rowLabel}${id}: ${value}`);
  }
  return { label, text: `${label}\n${lines.join('\n')}` };
}

function ensureCopyNotice() {
  if (copyNotice) return copyNotice;
  copyNotice = document.createElement('div');
  copyNotice.id = 'synova-r136a1-copy-feedback';
  copyNotice.className = 'synova-r136a1-copy-feedback';
  copyNotice.dataset.synovaR136a1Ui = 'copy-feedback';
  copyNotice.setAttribute('role', 'status');
  copyNotice.setAttribute('aria-live', 'polite');
  copyNotice.hidden = true;
  document.body.append(copyNotice);
  return copyNotice;
}

function showCopyNotice(label, copied = true) {
  const notice = ensureCopyNotice();
  notice.textContent = copied ? `Copied ${label}` : label;
  notice.hidden = false;
  clearTimeout(showCopyNotice.timer);
  showCopyNotice.timer = setTimeout(() => { notice.hidden = true; }, 1700);
}

async function fallbackCopy(text) {
  if (typeof document.execCommand !== 'function') return false;
  const textarea = document.createElement('textarea');
  const previousFocus = document.activeElement;
  textarea.value = text;
  textarea.setAttribute('aria-hidden', 'true');
  textarea.dataset.synovaR136a1CopyFallback = 'true';
  textarea.tabIndex = -1;
  textarea.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
  document.body.append(textarea);
  let copied = false;
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    copied = Boolean(document.execCommand('copy'));
  } catch {
    copied = false;
  }
  getSelection()?.removeAllRanges();
  textarea.remove();
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  return copied;
}

async function copyGroup(group) {
  const now = Date.now();
  if (now < copyCooldownUntil || copyGroup.inFlight) return false;
  copyGroup.inFlight = true;
  const { label, text } = groupText(group);
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      copied = true;
    } else copied = await fallbackCopy(text);
  } catch {
    copied = await fallbackCopy(text);
  }
  copyGroup.inFlight = false;
  if (copied) {
    copyCooldownUntil = Date.now() + 3000;
    showCopyNotice(label);
  } else showCopyNotice('Copy unavailable', false);
  return copied;
}

function onContextMenu(event) {
  const manager = getFloatingWindowManager();
  if (!manager) return;
  event.preventDefault();
  const state = manager.stateForTarget(event.target);
  if (state) {
    if (manager.pendingRightGesture(state)) return;
    const gesture = manager.consumeRightGesture(state);
    if (!gesture || gesture.moved || gesture.handled) return;
    const copyTarget = gesture.target || event.target;
    const group = groupForTarget(copyTarget, state);
    if (group && !isControlTarget(copyTarget)) void copyGroup(group);
    return;
  }
  if (manager.isLauncherTarget(event.target)) return;
  themeMenu?.open(event.clientX, event.clientY);
}

function onPointerDown(event) {
  if (themeMenu?.isOpen() && !(event.target instanceof Element && event.target.closest('[data-synova-r136a1-ui="theme-menu"]'))) {
    themeMenu.close();
  }
}

function onPointerUp(event) {
  if (event.button !== 2) return;
  const manager = getFloatingWindowManager();
  const state = manager?.stateForTarget(event.target);
  if (!state) return;
  const gesture = manager.peekRightGesture(state);
  if (!gesture || gesture.moved || gesture.handled) return;
  const copyTarget = gesture.target || event.target;
  const group = groupForTarget(copyTarget, state);
  if (group && !isControlTarget(copyTarget)) {
    manager.markRightGestureHandled(state);
    void copyGroup(group);
  }
}

function onKeyDown(event) {
  const manager = getFloatingWindowManager();
  if (!manager) return;
  if ((event.ctrlKey || event.metaKey) && ['a', 'c', 'x', 'v'].includes(event.key.toLowerCase())) {
    event.preventDefault();
    return;
  }
  if ((event.shiftKey && ['Insert', 'Delete'].includes(event.key))
    || (event.ctrlKey && event.key === 'Insert')
    || (event.shiftKey && event.target instanceof HTMLInputElement
      && event.target.type !== 'range' && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))) {
    event.preventDefault();
    return;
  }
  if (event.key === 'Escape') {
    if (themeMenu?.isOpen()) themeMenu.close();
    else manager.closeTopUnpinned();
    event.preventDefault();
    return;
  }
  if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
  if (manager.isWindowTarget(event.target) || manager.isLauncherTarget(event.target)) return;
  const rect = event.target instanceof Element ? event.target.getBoundingClientRect() : null;
  themeMenu?.open(rect ? rect.left + Math.min(rect.width / 2, 80) : window.innerWidth / 2,
    rect ? rect.bottom : window.innerHeight / 2);
  event.preventDefault();
}

function suppressSelection(event) {
  event.preventDefault();
}

function suppressClipboard(event) {
  if (event.target instanceof Element && event.target.dataset.synovaR136a1CopyFallback === 'true') return;
  event.preventDefault();
}

export function installInteractionRouter() {
  if (routerInstalled || typeof document === 'undefined') return;
  routerInstalled = true;
  getFloatingWindowManager();
  document.addEventListener('contextmenu', onContextMenu, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('selectstart', suppressSelection, true);
  document.addEventListener('dragstart', suppressSelection, true);
  document.addEventListener('copy', suppressClipboard, true);
  document.addEventListener('cut', suppressClipboard, true);
  document.addEventListener('paste', suppressClipboard, true);
  document.addEventListener('drop', suppressSelection, true);
  document.addEventListener('beforeinput', event => {
    if (/insertFromPaste|insertFromDrop|insertFromYank|deleteByCut/.test(event.inputType)) event.preventDefault();
  }, true);
}

export function setThemeMenuController(controller) {
  themeMenu = controller;
  installInteractionRouter();
}

export function getCopyCooldownUntil() {
  return copyCooldownUntil;
}

export { copyGroup };
