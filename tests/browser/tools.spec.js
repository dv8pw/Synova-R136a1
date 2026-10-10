import { expect, test } from '@playwright/test';
import { ready, watchErrors, drag, checkGeometry, recordClipboard } from './helpers.js';

test.beforeEach(async ({}, info) => {
  test.skip(info.project.name !== 'desktop', 'Desktop tool interactions');
});

const tuning = page => page.locator('#tuning-panel');
const performance = page => page.locator('#performance-panel');
const pin = panel => panel.locator('[data-window-action="pin"]');
const close = panel => panel.locator('[data-window-action="close"]');

test('initial tool windows fit their contents when space allows and stay bounded on short screens', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1320 });
  await ready(page);
  for (const name of ['performance', 'tuning']) {
    await page.locator(`#${name}-launcher`).click();
    const panel = page.locator(`#${name}-panel`);
    const body = panel.locator('.tuning-panel__body');
    await expect.poll(() => body.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
    await close(panel).click();
  }
  await page.setViewportSize({ width: 800, height: 600 });
  for (const name of ['performance', 'tuning']) {
    await page.locator(`#${name}-launcher`).click();
    const panel = page.locator(`#${name}-panel`);
    const rect = await panel.boundingBox();
    expect(rect.y).toBeGreaterThanOrEqual(64);
    expect(rect.y + rect.height).toBeLessThanOrEqual(588);
    expect(rect.x).toBeGreaterThanOrEqual(12);
    expect(rect.x + rect.width).toBeLessThanOrEqual(788);
    const body = panel.locator('.tuning-panel__body');
    expect(await body.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await close(panel).click();
  }
});

test('inputs never drag the window and lost pointer capture cancels movement', async ({ page }) => {
  const errors = watchErrors(page);
  await ready(page, '/?tune');
  const original = await tuning(page).boundingBox();
  await page.locator('label[for="tuning-panel-soft-bloom-radius"]').click();
  await expect(page.locator('#tuning-panel-soft-bloom-radius')).toBeFocused();
  await drag(page, page.locator('#tuning-panel-soft-bloom-radius'), -40, 20);
  expect(await tuning(page).boundingBox()).toEqual(original);
  await tuning(page).evaluate(root => root.addEventListener('pointerdown', event => {
    window.__testPointerId = event.pointerId;
  }, { once: true }));
  const box = await tuning(page).locator('legend').first().boundingBox();
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 20, y);
  const captured = await tuning(page).boundingBox();
  await tuning(page).evaluate(root => root.releasePointerCapture(window.__testPointerId));
  await page.mouse.move(x - 100, y);
  await page.mouse.up();
  expect(await tuning(page).boundingBox()).toEqual(captured);
  expect(errors).toEqual([]);
});

test('displayed decision metrics use the classified window after demotion and stop updating when closed', async ({ page }) => {
  const errors = watchErrors(page);
  await ready(page, '/?perf');
  await page.evaluate(async () => {
    const { S } = await import('/js/context.js');
    const { updatePerformancePanel } = await import('/js/performance/panel.js');
    S.WebGL.performance.suspend('Diagnostic display fixture');
    window.__diagnosticReads = 0;
    const metrics = { deliveredHz: 125.28, deliveryRatio: 0.87, lateFraction: 0.06, lateCount: 6, missedFrames: 7 };
    S.WebGL.performance.snapshot = () => {
      window.__diagnosticReads++;
      return { targetHz: 72, frameBudgetMs: 1000 / 72, controller: { loadOverloadStreak: 0, deliveryOverloadStreak: 0 },
        classifiedWindow: { windowId: 10, epoch: 1, targetHz: 144, qualityStep: 2, metrics,
          classification: { overloadCauses: ['delivery-deficit', 'late-frames'] },
          controllerEvidence: { deliveryOverloadStreak: 3, deliveryOverloadDurationMs: 6000 },
          decision: { reason: 'overload-lower-rate', fromTargetHz: 144, fromQualityStep: 2, targetHz: 72, qualityStep: 0 } },
        liveWindow: { windowId: 11, targetHz: 72, metrics: { deliveryRatio: 1, lateFraction: 0, lateCount: 0, missedFrames: 0 } } };
    };
    updatePerformancePanel(performance.now() + 1000);
  });
  const value = label => performance(page).locator('.performance-panel__row')
    .filter({ has: page.getByText(label, { exact: true }) }).locator('output');
  await expect(value('Target / delivered (classified)')).toHaveText('144.0 Hz / 125.3 Hz');
  await expect(value('Delivery ratio (classified)')).toHaveText('87.00%');
  await expect(value('Late / missed (classified)')).toHaveText('6.00% / 6 / 7');
  await expect(value('Delivery overload')).toHaveText('3 / 3 windows • 6.0 s / 6 s');
  await expect(value('Classified decision')).toContainText('144.0 Hz / Q2 → 72.0 Hz / Q0');
  await expect(value('Delivery ratio (live)')).toHaveText('100.00%');
  await close(performance(page)).click();
  await page.evaluate(async () => {
    window.__diagnosticReads = 0;
    const { updatePerformancePanel } = await import('/js/performance/panel.js');
    updatePerformancePanel(performance.now() + 2000);
    updatePerformancePanel(performance.now() + 3000);
  });
  expect(await page.evaluate(() => window.__diagnosticReads)).toBe(0);
  await page.locator('#performance-launcher').click();
  expect(await page.evaluate(() => window.__diagnosticReads)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('first opening after a theme change captures the active theme baseline', async ({ page }) => {
  const errors = watchErrors(page);
  await ready(page);
  await page.mouse.click(30, 30, { button: 'right' });
  await page.getByRole('menuitemradio', { name: 'Deep Current', exact: true }).click();
  const expected = await page.evaluate(async () => {
    const { getActiveTheme } = await import('/js/themes.js');
    return getActiveTheme().particles.randomHighlightSelection;
  });
  await page.locator('#tuning-launcher').click();
  const input = page.locator('#tuning-panel-random-highlight-selection');
  await expect(input.locator('..')).toHaveAttribute('data-copy-value', String(expected));
  await input.focus();
  await page.keyboard.press('ArrowLeft');
  await tuning(page).getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(input.locator('..')).toHaveAttribute('data-copy-value', String(expected));
  expect(await page.evaluate(async () => (await import('/js/tuning-panel.js')).getTuningSettings().theme.id)).toBe('theme-2');
  expect(errors).toEqual([]);
});

test('keyboard launchers and page context menu remain accessible', async ({ page }) => {
  const errors = watchErrors(page);
  await ready(page);
  await page.locator('#performance-launcher').focus();
  await page.keyboard.press('Enter');
  await expect(performance(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(performance(page)).not.toBeVisible();
  await page.locator('#tuning-launcher').focus();
  await page.keyboard.press('Enter');
  await expect(tuning(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tuning(page)).not.toBeVisible();
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('independent windows, pinning, outside dismissal, Escape and reopening', async ({ page }) => {
  const errors = watchErrors(page);
  await ready(page);
  await page.locator('#tuning-launcher').click();
  await expect(tuning(page)).toBeVisible();
  await page.mouse.click(20, 300);
  await expect(tuning(page)).not.toBeVisible();
  await page.locator('#tuning-launcher').click();
  const original = await tuning(page).boundingBox();
  await pin(tuning(page)).click();
  await page.locator('#performance-launcher').click();
  await expect(tuning(page)).toBeVisible();
  await expect(performance(page)).toBeVisible();
  await pin(performance(page)).click();
  const z = () => page.evaluate(() => ['tuning-panel', 'performance-panel'].map(id =>
    Number(getComputedStyle(document.getElementById(id)).zIndex)));
  expect((await z())[1]).toBeGreaterThan((await z())[0]);
  await tuning(page).locator('.floating-window__title').click();
  expect((await z())[0]).toBeGreaterThan((await z())[1]);
  await page.keyboard.press('Escape');
  await expect(tuning(page)).toBeVisible();
  await expect(performance(page)).toBeVisible();
  await pin(performance(page)).focus();
  await pin(performance(page)).click();
  await page.keyboard.press('Escape');
  await expect(performance(page)).not.toBeVisible();
  await expect(tuning(page)).toBeVisible();
  await drag(page, tuning(page).locator('legend').first(), -140, 70);
  await close(tuning(page)).click();
  await page.locator('#tuning-launcher').click();
  expect(await tuning(page).boundingBox()).toEqual(original);
  await expect(pin(tuning(page))).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.click(20, 300);
  await expect(tuning(page)).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('both-button content dragging and all eight resize directions remain clamped', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  await recordClipboard(page);
  await ready(page, '/?tune');
  await pin(tuning(page)).click();
  // Leave movement space now that initial content fitting can fill the viewport.
  await drag(page, tuning(page).locator('[data-resize="se"]'), -400, -200);
  await drag(page, tuning(page).locator('.floating-window__titlebar'), 200, 40);
  for (const button of ['left', 'right']) {
    const before = await tuning(page).boundingBox();
    await drag(page, tuning(page).locator('legend').first(), -45, 25, button);
    const after = await tuning(page).boundingBox();
    expect(after.x).toBeCloseTo(before.x - 45, 0);
    expect(after.y).toBeCloseTo(before.y + 25, 0);
  }
  expect(await page.evaluate(() => window.__copies.length)).toBe(0);
  for (const direction of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
    const handle = tuning(page).locator(`[data-resize="${direction}"]`);
    const before = await tuning(page).boundingBox();
    await drag(page, handle, direction.includes('e') ? -40 : direction.includes('w') ? 40 : 0,
      direction.includes('s') ? -30 : direction.includes('n') ? 30 : 0);
    const after = await tuning(page).boundingBox();
    if (direction.includes('e') || direction.includes('w')) expect(after.width).toBeLessThan(before.width);
    if (direction.includes('n') || direction.includes('s')) expect(after.height).toBeLessThan(before.height);
    if (direction.includes('n')) expect(after.y + after.height).toBeCloseTo(before.y + before.height, 1);
    if (direction.includes('s')) expect(after.y).toBeCloseTo(before.y, 1);
    if (direction.includes('w')) expect(after.x + after.width).toBeCloseTo(before.x + before.width, 1);
    if (direction.includes('e')) expect(after.x).toBeCloseTo(before.x, 1);
    await checkGeometry(page, tuning(page));
  }
  await drag(page, tuning(page).locator('[data-resize="se"]'), -3000, -3000);
  let rect = await checkGeometry(page, tuning(page));
  expect(rect.width).toBeCloseTo(320, 0);
  expect(rect.height).toBeCloseTo(240, 0);
  await drag(page, tuning(page).locator('legend').first(), -3000, -3000);
  rect = await checkGeometry(page, tuning(page));
  expect(rect.x).toBeCloseTo(12, 0);
  expect(rect.y).toBeCloseTo(64, 0);
  await drag(page, tuning(page).locator('[data-resize="se"]'), 4000, 4000);
  await checkGeometry(page, tuning(page));
  expect(errors).toEqual([]);
});

test('five-pixel stationary copy and six-pixel right drag use the strict boundary', async ({ page }) => {
  const errors = watchErrors(page);
  await recordClipboard(page);
  await ready(page, '/?tune');
  const legend = tuning(page).locator('legend').first();
  const original = await tuning(page).boundingBox();
  for (const distance of [5, 6]) {
    const box = await legend.boundingBox();
    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + box.height / 2);
    await page.mouse.move(x, y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(x - distance, y);
    await page.mouse.up({ button: 'right' });
    if (distance === 5) {
      await expect.poll(() => page.evaluate(() => window.__copies.length)).toBe(1);
      expect((await tuning(page).boundingBox()).x).toBe(original.x);
      await page.waitForTimeout(3050);
    } else {
      expect((await tuning(page).boundingBox()).x).toBeCloseTo(original.x - 6, 1);
      expect(await page.evaluate(() => window.__copies.length)).toBe(1);
    }
  }
  expect(errors).toEqual([]);
});

test('continuous geometry changes and group reflow at representative browser content sizes', async ({ page }, info) => {
  test.setTimeout(600_000);
  const errors = watchErrors(page);
  await ready(page, '/?tune');
  await pin(tuning(page)).click();
  const columns = new Set();
  for (const [width, height] of [[1280, 720], [1920, 960], [2560, 1320], [3840, 2040]]) {
    await page.setViewportSize({ width, height });
    await drag(page, tuning(page).locator('legend').first(), -4000, -4000);
    const handle = tuning(page).locator('[data-resize="se"]');
    await drag(page, handle, -4000, -4000);
    for (const [targetWidth, targetHeight] of [[320, 240], [700, 350], [400, height - 24], [width - 24, 400], [width - 24, height - 24]]) {
      const box = await tuning(page).boundingBox();
      const h = await handle.boundingBox();
      await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
      await page.mouse.down();
      for (let step = 1; step <= 6; step++) {
        await page.mouse.move(h.x + h.width / 2 + (targetWidth - box.width) * step / 6,
          h.y + h.height / 2 + (targetHeight - box.height) * step / 6);
        await checkGeometry(page, tuning(page));
      }
      await page.mouse.up();
      const count = await tuning(page).evaluate(root => {
        const groups = [...root.querySelectorAll('.tuning-panel__group')];
        const firstY = groups[0].getBoundingClientRect().y;
        return groups.filter(group => Math.abs(group.getBoundingClientRect().y - firstY) < 2).length;
      });
      columns.add(count);
      const body = tuning(page).locator('.tuning-panel__body');
      await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await expect(tuning(page).getByRole('button', { name: 'Replay opening', exact: true })).toBeInViewport({ ratio: 1 });
      await body.evaluate(el => { el.scrollTop = 0; });
    }
    await page.screenshot({ path: info.outputPath(`tools-${width}.png`) });
  }
  expect(columns.has(1)).toBe(true);
  expect(columns.has(2)).toBe(true);
  expect([...columns].some(count => count >= 3)).toBe(true);
  expect(errors).toEqual([]);
});

test('group copy payload, right-drag cancellation and shared silent cooldown', async ({ page }) => {
  const errors = watchErrors(page);
  await recordClipboard(page);
  await ready(page, '/?tune&perf');
  await pin(tuning(page)).focus();
  await page.keyboard.press('Space');
  await pin(performance(page)).focus();
  await page.keyboard.press('Space');
  await pin(tuning(page)).focus();
  const group = tuning(page).locator('.tuning-panel__group').first();
  await group.locator('.tuning-panel__row > label').first().click({ button: 'right' });
  await expect.poll(() => page.evaluate(() => window.__copies.length)).toBe(1);
  expect(await page.evaluate(() => window.__copies[0])).toMatch(/\[random-highlight-selection\]:/);
  await pin(performance(page)).focus();
  await performance(page).locator('legend').first().click({ button: 'right' });
  expect(await page.evaluate(() => window.__copies.length)).toBe(1);
  await page.waitForTimeout(3050);
  await pin(performance(page)).focus();
  await performance(page).locator('legend').first().click({ button: 'right' });
  await expect.poll(() => page.evaluate(() => window.__copies.length)).toBe(2);
  expect(await page.evaluate(() => window.__copies[1])).toMatch(/State:/);
  expect(await page.evaluate(() => window.__copies.every(text => !text.endsWith('\n')))).toBe(true);
  await pin(tuning(page)).focus();
  await drag(page, tuning(page).locator('legend').first(), -25, 20, 'right');
  expect(await page.evaluate(() => window.__copies.length)).toBe(2);
  expect(errors).toEqual([]);
});

test('Performance groups reflow and scroll through minimum, intermediate and maximum sizes', async ({ page }, info) => {
  test.setTimeout(360_000);
  const errors = watchErrors(page);
  await ready(page, '/?perf');
  await pin(performance(page)).click();
  for (const [width, height] of [[1280, 720], [1920, 960], [2560, 1320], [3840, 2040]]) {
    await page.setViewportSize({ width, height });
    await drag(page, performance(page).locator('legend').first(), -4000, -4000);
    for (const [w, h] of [[320, 240], [700, 500], [width - 24, height - 24]]) {
      const box = await performance(page).boundingBox();
      await drag(page, performance(page).locator('[data-resize="se"]'), w - box.width, h - box.height);
      await checkGeometry(page, performance(page));
      await performance(page).locator('.tuning-panel__body').evaluate(el => { el.scrollTop = el.scrollHeight; });
      await expect(performance(page).locator('.performance-panel__note')).toBeInViewport({ ratio: 1 });
      await performance(page).locator('.tuning-panel__body').evaluate(el => { el.scrollTop = 0; });
    }
    await page.screenshot({ path: info.outputPath(`performance-${width}.png`) });
  }
  expect(errors).toEqual([]);
});

test('numeric reset, theme defaults, input usability and native interaction suppression', async ({ page }) => {
  const errors = watchErrors(page);
  await recordClipboard(page);
  await ready(page, '/?tune');
  await pin(tuning(page)).click();
  const input = page.locator('#tuning-panel-soft-bloom-radius');
  const row = input.locator('..');
  const baseline = await input.inputValue();
  await input.fill('0.2');
  await input.dispatchEvent('input');
  await expect(row).toHaveAttribute('data-default', 'false');
  await input.dblclick();
  await expect(input).toHaveValue(baseline);
  await expect(row).toHaveAttribute('data-default', 'true');
  const slider = page.locator('#tuning-panel-random-highlight-selection');
  const sliderBaseline = await slider.inputValue();
  await slider.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(slider.locator('..')).toHaveAttribute('data-default', 'false');
  await slider.dblclick();
  await expect(slider).toHaveValue(sliderBaseline);
  await expect(slider.locator('..')).toHaveAttribute('data-default', 'true');
  await input.fill('0.2');
  await input.dispatchEvent('input');
  await input.focus();
  await page.keyboard.press('ArrowUp');
  expect(Number(await input.inputValue())).toBeCloseTo(0.21, 8);
  await input.fill('0.123456789');
  await input.dispatchEvent('input');
  await row.locator('output').click({ button: 'right' });
  expect(await page.evaluate(() => window.__copies.at(-1))).toContain('0.123456789');
  const prevented = await page.evaluate(() => {
    const input = document.getElementById('tuning-panel-soft-bloom-radius');
    return ['contextmenu', 'selectstart', 'copy', 'cut', 'paste', 'dragstart'].map(type => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      return event.defaultPrevented;
    });
  });
  expect(prevented).toEqual([true, true, true, true, true, true]);
  const value = await input.inputValue();
  await page.keyboard.press('Control+V');
  await expect(input).toHaveValue(value);
  await drag(page, page.locator('h1'), 100, 0);
  expect(await page.evaluate(() => getSelection().toString())).toBe('');
  await page.mouse.click(30, 30, { button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  await page.getByRole('menuitemradio', { name: 'Deep Current', exact: true }).click();
  await expect(row).toHaveAttribute('data-default', 'true');
  const newBaseline = await input.inputValue();
  await input.fill('0.1');
  await input.dispatchEvent('input');
  await input.dblclick();
  await expect(input).toHaveValue(newBaseline);
  await tuning(page).locator('legend').first().click({ button: 'right' });
  await expect(page.getByRole('menu')).not.toBeVisible();
  await page.mouse.click(30, 30, { button: 'right' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).not.toBeVisible();
  await expect(tuning(page)).toBeVisible();
  expect(errors).toEqual([]);
});
