import { expect, test } from '@playwright/test';
import { ready, watchErrors } from './helpers.js';

test('coarse-pointer mobile and tablet never expose desktop tools or theme selector', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = watchErrors(page);
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1024, height: 1366 }]) {
      await page.setViewportSize(viewport);
      await ready(page, '/?tune&perf');
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      for (const selector of ['#performance-launcher', '#tuning-launcher', '#performance-panel', '#tuning-panel', '#theme-picker']) {
        await expect(page.locator(selector)).not.toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('clipboard fallback is invisible, guarded and restores focus', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    window.__fallbackCopies = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    document.execCommand = command => {
      if (command !== 'copy') return false;
      const selected = getSelection().toString() || document.activeElement.value;
      const event = new Event('copy', { bubbles: true, cancelable: true });
      document.activeElement.dispatchEvent(event);
      const el = document.activeElement;
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      window.__fallbackCopies.push({ selected, prevented: event.defaultPrevented,
        invisible: style.opacity === '0' || box.right <= 0 || box.bottom <= 0 || style.clipPath !== 'none' });
      return true;
    };
  });
  await ready(page, '/?tune');
  const input = page.locator('#tuning-panel-soft-bloom-radius');
  await input.focus();
  await tuningGroup(page).click({ button: 'right' });
  await expect.poll(() => page.evaluate(() => window.__fallbackCopies.length)).toBe(1);
  expect(await page.evaluate(() => window.__fallbackCopies[0])).toMatchObject({ prevented: false, invisible: true });
  expect(await page.evaluate(() => window.__fallbackCopies[0].selected)).toContain('random-highlight-selection');
  expect(await page.evaluate(() => getSelection().toString())).toBe('');
  await expect(input).toBeFocused();
  await expect(page.locator('textarea')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('pending clipboard writes are serialized and failures do not start cooldown', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    window.__writeAttempts = 0;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: () => { window.__writeAttempts++; return new Promise((resolve, reject) => {
        window.__finishWrite = resolve; window.__failWrite = reject;
      }); },
    } });
    document.execCommand = () => false;
  });
  await ready(page, '/?tune');
  await tuningGroup(page).click({ button: 'right' });
  await tuningGroup(page).click({ button: 'right' });
  expect(await page.evaluate(() => window.__writeAttempts)).toBe(1);
  await page.evaluate(() => window.__failWrite(new Error('Clipboard denied for test')));
  await expect.poll(() => page.locator('#synova-r136a1-copy-feedback').innerText()).toMatch(/failed|unavailable|could not/i);
  await tuningGroup(page).click({ button: 'right' });
  await expect.poll(() => page.evaluate(() => window.__writeAttempts)).toBe(2);
  await page.evaluate(() => window.__finishWrite());
  expect(errors).toEqual([]);
});

const tuningGroup = page => page.locator('#tuning-panel legend').first();

test('opening, viewport, DPR and context restoration preserve rendering and tools', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'desktop');
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  await ready(page, '/?tune');
  await page.locator('#tuning-panel [data-window-action="pin"]').click();
  const state = () => page.evaluate(async () => {
    const { S } = await import('/js/context.js');
    return { frame: S.WebGL.renderer.info.render.frame, controller: S.WebGL.performance.controller.snapshot(),
      active: S.WebGL.performance.active, dpr: S.window.dpr };
  });
  const initial = await state();
  const radius = page.locator('#tuning-panel-soft-bloom-radius');
  await radius.fill('0.13');
  await radius.dispatchEvent('input');
  await page.setViewportSize({ width: 1920, height: 960 });
  await expect.poll(async () => (await state()).frame).toBeGreaterThan(initial.frame);
  const afterResize = await state();
  expect(afterResize.controller.qualityStep).toBe(initial.controller.qualityStep);
  expect(afterResize.controller.targetHz).toBe(initial.controller.targetHz);
  await page.locator('#tuning-panel').getByRole('button', { name: 'Replay opening', exact: true }).click();
  await expect(page.locator('#opening-reveal')).toHaveAttribute('data-state', 'complete');
  await expect.poll(async () => (await state()).active).toBe(true);
  await expect(page.locator('#tuning-panel')).toBeVisible();
  await expect(radius).toHaveValue('0.13');
  const client = await context.newCDPSession(page);
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1920, height: 960, deviceScaleFactor: 2, mobile: false,
  });
  await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(2);
  await expect.poll(async () => (await state()).dpr).toBe(2);
  await expect.poll(async () => (await state()).active).toBe(true);
  await expect(page.locator('#tuning-panel')).toBeVisible();
  await expect(radius).toHaveValue('0.13');
  await page.screenshot({ path: info.outputPath('tools-scaled-4k.png') });
  await page.evaluate(() => {
    const extension = document.getElementById('visual-background').getContext('webgl2').getExtension('WEBGL_lose_context');
    if (!extension) throw new Error('WEBGL_lose_context unavailable');
    window.__restoreContext = () => extension.restoreContext();
    extension.loseContext();
  });
  await expect.poll(() => page.locator('#visual-background').evaluate(canvas => canvas.getContext('webgl2').isContextLost())).toBe(true);
  await page.evaluate(() => window.__restoreContext());
  await expect.poll(() => page.locator('#visual-background').evaluate(canvas => canvas.getContext('webgl2').isContextLost())).toBe(false);
  await expect.poll(async () => (await state()).active).toBe(true);
  const restored = await state();
  await expect.poll(async () => (await state()).frame).toBeGreaterThan(restored.frame);
  await expect(page.locator('#tuning-panel')).toBeVisible();
  await expect(radius).toHaveValue('0.13');
  expect(errors).toEqual([]);
});
