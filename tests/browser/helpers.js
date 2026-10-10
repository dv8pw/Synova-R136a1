import { expect } from '@playwright/test';

export function watchErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on('response', response => {
    if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`);
  });
  return errors;
}

export async function ready(page, url = '/') {
  await page.goto(url);
  await expect(page.locator('#opening-reveal')).toHaveAttribute('data-state', 'complete');
  await expect(page.locator('#visual-background')).toBeVisible();
}

export async function drag(page, locator, dx, dy, button = 'left') {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button });
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 3 });
  await page.mouse.up({ button });
}

export async function checkGeometry(page, panel) {
  const state = await panel.evaluate(root => {
    const rect = root.getBoundingClientRect();
    const title = root.querySelector('.floating-window__titlebar') || root.firstElementChild;
    const t = title.getBoundingClientRect();
    const groups = [...root.querySelectorAll('.tuning-panel__group')].map(group => {
      const r = group.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
    });
    return {
      x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom,
      width: rect.width, height: rect.height, viewport: [innerWidth, innerHeight],
      title: { y: t.y, bottom: t.bottom },
      overflow: root.scrollWidth > root.clientWidth + 1 || [...root.querySelectorAll('.tuning-panel__body')].some(body => body.scrollWidth > body.clientWidth + 1),
      groupsOverlap: groups.some((a, i) => groups.slice(i + 1).some(b =>
        a.x < b.right - 1 && a.right > b.x + 1 && a.y < b.bottom - 1 && a.bottom > b.y + 1)),
    };
  });
  expect(state.x).toBeGreaterThanOrEqual(11);
  expect(state.y).toBeGreaterThanOrEqual(11);
  expect(state.right).toBeLessThanOrEqual(state.viewport[0] - 11);
  expect(state.bottom).toBeLessThanOrEqual(state.viewport[1] - 11);
  expect(state.width).toBeGreaterThanOrEqual(Math.min(319, state.viewport[0] - 24));
  expect(state.height).toBeGreaterThanOrEqual(Math.min(239, state.viewport[1] - 24));
  expect(state.title.y).toBeGreaterThanOrEqual(0);
  expect(state.title.bottom).toBeLessThanOrEqual(state.viewport[1]);
  expect(state.overflow).toBe(false);
  expect(state.groupsOverlap).toBe(false);
  return state;
}

export async function recordClipboard(page) {
  await page.addInitScript(() => {
    window.__copies = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async text => { window.__copies.push(text); } },
    });
  });
}
