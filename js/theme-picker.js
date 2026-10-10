import { S as runtimeState } from './context.js';
import { applyImageEffectsTheme } from './passes.js';
import { defaultTheme, getActiveTheme, selectTheme, themes } from './themes.js';
import { freshSceneDefaults, installTuningPanel } from './tuning-panel.js';
import { desktopToolsAvailable } from './ui/floating-window.js';
import { installInteractionRouter, setThemeMenuController } from './ui/interaction-router.js';

let themeMenu;
let launchers;

installThemeTools();

const initialTheme = selectTheme(defaultTheme.id);
applyTheme(initialTheme);
window.addEventListener('synova-r136a1:scene-ready', () => applyTheme(selectTheme(getActiveTheme().id)));

function installThemeTools() {
  if (typeof document === 'undefined') return;
  installInteractionRouter();
  installLaunchers();
  installThemeMenu();
  const params = new URLSearchParams(window.location.search);
  if (params.has('tune')) queueMicrotask(() => window.dispatchEvent(new Event('synova-r136a1:show-tuning')));
  if (params.has('perf')) queueMicrotask(() => window.dispatchEvent(new Event('synova-r136a1:show-performance')));
}

function installLaunchers() {
  if (launchers) return launchers;
  launchers = document.createElement('div');
  launchers.id = 'synova-r136a1-tool-launchers';
  launchers.className = 'synova-r136a1-tool-launchers';
  launchers.dataset.synovaR136a1Ui = 'launcher-group';
  const performance = createLauncher('performance-launcher', 'Open Performance', 'performance');
  const tuning = createLauncher('tuning-launcher', 'Open Visual Tuning', 'tuning');
  performance.addEventListener('click', () => window.dispatchEvent(new Event('synova-r136a1:show-performance')));
  tuning.addEventListener('click', () => window.dispatchEvent(new Event('synova-r136a1:show-tuning')));
  launchers.append(performance, tuning);
  document.body.append(launchers);
  syncLauncherVisibility();
  window.addEventListener('resize', syncLauncherVisibility, { passive: true });
  return launchers;
}

function syncLauncherVisibility() {
  if (!launchers) return;
  launchers.hidden = !desktopToolsAvailable();
}

function createLauncher(id, label, kind) {
  const button = document.createElement('button');
  button.id = id;
  button.type = 'button';
  button.className = `synova-r136a1-tool-launcher synova-r136a1-tool-launcher--${kind}`;
  button.dataset.synovaR136a1Ui = 'launcher';
  button.setAttribute('aria-label', label);
  button.title = label;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (kind === 'performance') {
    svg.innerHTML = '<path d="M3 14.5 7.1 10l3.1 2.2L16.5 5M14 5h2.5v2.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.35"/><path d="M3 17h14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.1" opacity=".55"/>';
  } else {
    svg.innerHTML = '<path d="M4 5h12M4 10h12M4 15h12" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.25"/><circle cx="8" cy="5" r="1.7" fill="var(--page-background-color)" stroke="currentColor" stroke-width="1.1"/><circle cx="13" cy="10" r="1.7" fill="var(--page-background-color)" stroke="currentColor" stroke-width="1.1"/><circle cx="7" cy="15" r="1.7" fill="var(--page-background-color)" stroke="currentColor" stroke-width="1.1"/>';
  }
  button.append(svg);
  return button;
}

function installThemeMenu() {
  if (themeMenu) return themeMenu;
  const element = document.createElement('div');
  element.id = 'theme-menu';
  element.className = 'theme-menu';
  element.dataset.synovaR136a1Ui = 'theme-menu';
  element.setAttribute('role', 'menu');
  element.setAttribute('aria-label', 'Visual theme');
  const options = new Map();
  for (const theme of themes) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'theme-menu__option';
    option.dataset.themeId = theme.id;
    option.setAttribute('role', 'menuitemradio');
    option.setAttribute('aria-checked', String(theme.id === getActiveTheme().id));
    option.setAttribute('aria-label', theme.name);
    const swatches = document.createElement('span');
    swatches.className = 'theme-menu__swatches';
    for (const color of themeSwatches(theme)) {
      const swatch = document.createElement('span');
      swatch.className = 'theme-menu__swatch';
      swatch.style.background = color;
      swatches.append(swatch);
    }
    const name = document.createElement('span');
    name.className = 'theme-menu__name';
    name.textContent = theme.name;
    const check = document.createElement('span');
    check.className = 'theme-menu__check';
    check.setAttribute('aria-hidden', 'true');
    check.textContent = '✓';
    option.append(swatches, name, check);
    option.addEventListener('click', () => {
      applyTheme(selectTheme(theme.id));
      updateThemeMenu();
      menuApi.close();
    });
    options.set(theme.id, option);
    element.append(option);
  }
  document.body.append(element);

  let previousFocus;
  const menuApi = {
    element,
    isOpen: () => !element.hidden,
    open(x = window.innerWidth / 2, y = window.innerHeight / 2) {
      if (window.matchMedia && (!window.matchMedia('(pointer: fine)').matches
        || !window.matchMedia('(hover: hover)').matches || window.innerWidth < 800)) return false;
      updateThemeMenu();
      previousFocus = document.activeElement;
      element.hidden = false;
      element.classList.add('is-open');
      element.style.left = `${Math.max(8, Math.min(Number(x) || 0, window.innerWidth - 12))}px`;
      element.style.top = `${Math.max(8, Math.min(Number(y) || 0, window.innerHeight - 12))}px`;
      const rect = element.getBoundingClientRect();
      element.style.left = `${Math.max(8, Math.min(Number(x) || 0, window.innerWidth - rect.width - 8))}px`;
      element.style.top = `${Math.max(8, Math.min(Number(y) || 0, window.innerHeight - rect.height - 8))}px`;
      options.get(getActiveTheme().id)?.focus({ preventScroll: true });
      return true;
    },
    close() {
      element.hidden = true;
      const restoreFocus = element.contains(document.activeElement);
      element.classList.remove('is-open');
      if (restoreFocus && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    },
  };
  const updateThemeMenu = () => {
    const active = getActiveTheme().id;
    for (const [id, option] of options) option.setAttribute('aria-checked', String(id === active));
  };
  element.addEventListener('keydown', event => {
    const buttons = [...options.values()];
    const index = buttons.indexOf(document.activeElement);
    let next;
    if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
    if (event.key === 'ArrowUp') next = (index + buttons.length - 1) % buttons.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = buttons.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      buttons[next].focus({ preventScroll: true });
    }
  });
  menuApi.close();
  themeMenu = menuApi;
  setThemeMenuController(menuApi);
  window.addEventListener('resize', () => menuApi.close(), { passive: true });
  window.addEventListener('blur', () => menuApi.close(), { passive: true });
  window.addEventListener('synova-r136a1:theme-applied', updateThemeMenu);
  return themeMenu;
}

function themeSwatches(theme) {
  const primary = theme.orb?.primaryLightColor || theme.orb?.fresnelHighlightColor;
  const accent = theme.orb?.cloudTintColor || theme.particles?.randomHighlightBaseColor;
  return [theme.page.backgroundColor, theme.renderer.clearColor, colorToCss(primary), colorToCss(accent)];
}

function colorToCss(color) {
  if (typeof color === 'string') return color;
  if (!color) return 'currentColor';
  const channels = [color.red, color.green, color.blue].map(value => Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 255));
  return `rgb(${channels.join(' ')} / ${Math.max(0, Math.min(1, Number(color.alpha) || 1))})`;
}

export function applyTheme(theme) {
  const sceneThemeValues = freshSceneDefaults(theme);
  runtimeState.theatre.project?.applyTheme(sceneThemeValues);
  applyPageTheme(theme);
  applyImageEffectsTheme(theme);

  const renderer = runtimeState.WebGL?.renderer;
  renderer?.setClearColor(theme.renderer.clearColor, theme.renderer.clearAlpha);

  const world = Object.values(runtimeState.theatre.objects)
    .flatMap(objects => Object.values(objects))
    .map(object => object._webglObject)
    .find(object => object?.sun && object?.dirLight2);
  if (world) {
    world.sun.color.set(theme.lighting.sunDirectionalLightColor);
    world.sun.intensity = theme.lighting.sunDirectionalLightIntensity;
    world.dirLight2.color.set(theme.lighting.secondaryDirectionalLightColor);
    world.dirLight2.intensity = theme.lighting.secondaryDirectionalLightIntensity;
  }
  window.dispatchEvent(new CustomEvent('synova-r136a1:theme-applied', { detail: { theme } }));
}

function applyPageTheme(theme) {
  const root = document.documentElement;
  root.style.setProperty('--page-background-color', theme.page.backgroundColor);
  root.style.setProperty('--page-text-color', theme.page.textColor);
  root.style.setProperty('--theme-picker-background-color', theme.page.themePicker.panelBackgroundColor);
  root.style.setProperty('--theme-picker-text-color', theme.page.themePicker.panelTextColor);
  root.style.setProperty('--theme-picker-border-color', theme.page.themePicker.panelBorderColor);
  root.style.setProperty('--theme-picker-focus-color', theme.page.themePicker.focusOutlineColor);
  root.style.setProperty('--theme-picker-shadow-color', theme.page.themePicker.shadowColor);
  root.style.setProperty('--theme-picker-opacity', theme.page.themePicker.opacity);
}
