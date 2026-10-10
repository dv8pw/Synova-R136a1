import { expect, test } from '@playwright/test';

test('SwiftShader renders Synova-R136a1 with WebGL2 and working theme controls', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on('response', response => {
    if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`);
  });

  await page.goto('/');
  await expect(page.locator('#opening-reveal')).toHaveAttribute('data-state', 'complete');
  await expect(page.locator('#visual-background')).toBeVisible();
  const graphics = await page.locator('#visual-background').evaluate(canvas => {
    const gl = canvas.getContext('webgl2');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      webgl2: gl instanceof WebGL2RenderingContext,
      lost: gl?.isContextLost(),
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      width: gl?.drawingBufferWidth,
      height: gl?.drawingBufferHeight,
    };
  });
  expect(graphics.webgl2).toBe(true);
  expect(graphics.lost).toBe(false);
  expect(graphics.renderer).toMatch(/SwiftShader/i);
  expect(graphics.width).toBeGreaterThan(0);
  expect(graphics.height).toBeGreaterThan(0);
  await testInfo.attach('webgl2', { body: JSON.stringify(graphics), contentType: 'application/json' });

  const background = () => page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--page-background-color'));
  const initialBackground = await background();
  if (testInfo.project.name === 'desktop') {
    await page.mouse.click(30, 30, { button: 'right' });
    await page.getByRole('menuitemradio', { name: 'Deep Current', exact: true }).click();
  } else {
    await page.evaluate(async () => {
      const { applyTheme } = await import('/js/theme-picker.js');
      const { selectTheme } = await import('/js/themes.js');
      applyTheme(selectTheme('theme-2'));
    });
    await expect(page.locator('#performance-launcher')).not.toBeVisible();
    await expect(page.locator('#tuning-launcher')).not.toBeVisible();
  }
  await expect.poll(background).not.toBe(initialBackground);
  // Theme CSS changes immediately; wait for the scene to render it before capture.
  const renderedFrame = () => page.evaluate(async () => {
    const { S } = await import('/js/context.js');
    return S.WebGL.renderer.info.render.frame;
  });
  const themeFrame = await renderedFrame();
  await expect.poll(renderedFrame).toBeGreaterThan(themeFrame);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('synova-r136a1.png') });
  expect(errors).toEqual([]);
});
